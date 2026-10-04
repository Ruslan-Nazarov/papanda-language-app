import { Sentence, Word } from '../models/types';
import { generateGeminiText, isGeminiConfigured } from './geminiClient';
import { buildSentenceGenerationPrompt, buildSentenceAnnotationPrompt, getAllDictionaryCandidates, getLanguagePrompt, SENTENCE_ARRAY_SCHEMA, DRAFT_ARRAY_SCHEMA } from './sentencePrompts';
import { parseSentenceDrafts, planSentenceBatch, SentenceDraft } from './sentenceCurriculum';
import { buildSentenceQualityPrompt, parseQualityVerdicts, QUALITY_VERDICT_SCHEMA } from './sentenceQuality';
import { preservesSentenceBasis, sentenceFingerprint, validateGeneratedSentences } from '../utils/sentenceValidation';

const DEFAULT_BATCH_SIZE = 8;
// Composition, annotation, independent card audit; one bounded repair round.
const MAX_GENERATION_ROUNDS = 2;
export const isSentenceGenerationConfigured = isGeminiConfigured;
export interface RequiredWord { lemma: string; translation?: string }

const parseJSON = (text: string): unknown => {
  try { return JSON.parse(text); } catch { return null; }
};

const generateBatch = async (code: string, words: Word[], count: number, required: RequiredWord | undefined, avoid: string[]): Promise<Sentence[]> => {
  const language = getLanguagePrompt(code);
  const dictionary = getAllDictionaryCandidates(words, code);
  if (required?.lemma && !dictionary.some(entry => entry.lemma.toLocaleLowerCase() === required.lemma.trim().toLocaleLowerCase())) {
    dictionary.push({ lemma: required.lemma.trim(), translation: required.translation || '' });
  }
  const tasks = planSentenceBatch(count, Boolean(required?.lemma));
  const chainIds = new Set(tasks.filter(task => task.develops).flatMap(task => [task.id, task.develops!]));
  const accepted = new Map<string, Sentence>();
  const fingerprints = new Set(avoid.map(sentence => sentenceFingerprint(language.label, sentence)));
  let errors: string[] = [];
  for (let round = 0; round < MAX_GENERATION_ROUNDS && accepted.size < count; round++) {
    // Once a useful curriculum chain is complete, a second three-request
    // round just to fill optional independent cards spends quota quickly.
    if (round > 0 && !required?.lemma && accepted.size > 0 && [...chainIds].every(id => accepted.has(id))) break;
    const previousChain = new Map<string, Sentence>();
    if (round > 0 && [...chainIds].some(id => !accepted.has(id))) {
      // A valid base can still be unsuitable for its planned expansion (e.g.
      // "sleeps" cannot acquire a direct object). Reconsider the whole chain.
      for (const id of chainIds) {
        const sentence = accepted.get(id);
        if (sentence) {
          previousChain.set(id, sentence);
          fingerprints.delete(sentenceFingerprint(sentence.language, sentence.sentence));
        }
        accepted.delete(id);
      }
      errors.unshift('Пересоставьте всю связанную серию вместе: выберите основу, которую можно естественно дополнить признаком, дополнением и обстоятельством.');
    }
    const pending = tasks.filter(task => !accepted.has(task.id));
    const context: SentenceDraft[] = [...accepted].map(([taskId, sentence]) => ({ taskId, sentence: sentence.sentence }));
    // This is a structure exercise. Random entries from the full dictionary
    // produced forced collocations; vocabulary is used for lookup afterward.
    const seeds: { lemma: string; translation: string }[] = [];
    if (required?.lemma) seeds.unshift({ lemma: required.lemma.trim(), translation: required.translation || '' });
    try {
      const draftText = await generateGeminiText(buildSentenceGenerationPrompt(code, seeds, pending.length,
        [...avoid, ...context.map(item => item.sentence)], required?.lemma, pending, errors, context), {
        temperature: 0.8, topP: 0.92, maxOutputTokens: 4096,
        responseMimeType: 'application/json', responseJsonSchema: DRAFT_ARRAY_SCHEMA,
      });
      const drafts = parseSentenceDrafts(parseJSON(draftText), pending);
      if (!drafts.length) { errors = ['Не получены тексты для заданий.']; continue; }
      const annotationText = await generateGeminiText(buildSentenceAnnotationPrompt(code, pending, drafts, context), {
        temperature: 0.2, maxOutputTokens: 16384,
        responseMimeType: 'application/json', responseJsonSchema: SENTENCE_ARRAY_SCHEMA,
      });
      const result = validateGeneratedSentences(parseJSON(annotationText), code, language.label, dictionary,
        { tasks: pending, drafts, requiredWord: required?.lemma });
      errors = result.errors;
      const proposed = new Map<string, Sentence>();
      // Task order is authoritative even if the model reverses its response.
      for (const task of pending) {
        const sentence = result.sentences.find(item => item.generationTaskId === task.id);
        if (!sentence) { errors.push(`${task.id}: составьте новый естественный пример и надёжный разбор.`); continue; }
        const basis = task.develops && (proposed.get(task.develops) || accepted.get(task.develops));
        if (task.develops && !basis) {
          errors.push(`${task.id}: сначала нужна принятая основа ${task.develops}.`); continue;
        }
        if (basis && !preservesSentenceBasis(basis, sentence)) {
          errors.push(`${task.id}: сохраните значение и форму сказуемого, подлежащее и уже добавленные детали из ${task.develops}.`); continue;
        }
        const fingerprint = sentenceFingerprint(sentence.language, sentence.sentence);
        const duplicatesFallback = !chainIds.has(task.id) && [...previousChain.values()].some(previous =>
          sentenceFingerprint(previous.language, previous.sentence) === fingerprint);
        if (fingerprints.has(fingerprint) || [...proposed.values()].some(item => sentenceFingerprint(item.language, item.sentence) === fingerprint) || duplicatesFallback) {
          errors.push(`${task.id}: повтор предложения.`); continue;
        }
        proposed.set(task.id, sentence);
      }
      if (proposed.size) {
        const candidates = tasks.flatMap(task => proposed.has(task.id) ? [proposed.get(task.id)!] : []);
        const auditText = await generateGeminiText(buildSentenceQualityPrompt(code, pending, candidates, [...accepted.values()]), {
          temperature: 0.1, maxOutputTokens: 4096,
          responseMimeType: 'application/json', responseJsonSchema: QUALITY_VERDICT_SCHEMA,
        });
        const verdicts = parseQualityVerdicts(parseJSON(auditText), pending);
        for (const task of pending) {
          const sentence = proposed.get(task.id);
          if (!sentence) continue;
          const verdict = verdicts.find(item => item.taskId === task.id)!;
          if (!verdict.passed) { errors.unshift(`${task.id}: ${verdict.reason}`); continue; }
          if (task.develops && !accepted.has(task.develops)) {
            errors.push(`${task.id}: после проверки отсутствует основа ${task.develops}.`); continue;
          }
          fingerprints.add(sentenceFingerprint(sentence.language, sentence.sentence));
          accepted.set(task.id, sentence);
        }
      }
    } catch (error) {
      // Partial background batches are useful, but targeted generation must never
      // succeed without its requested lexeme.
      if ((accepted.size || previousChain.size) && (!required?.lemma || accepted.has('task-1'))) break;
      throw error;
    } finally {
      // Replace a chain as a unit. A failed repair must not discard a longer
      // validated prefix or mix sentences from two different scenes.
      const repairedSize = [...chainIds].filter(id => accepted.has(id)).length;
      if (repairedSize < previousChain.size) {
        for (const id of chainIds) accepted.delete(id);
        for (const [id, sentence] of previousChain) accepted.set(id, sentence);
        fingerprints.clear();
        for (const text of avoid) fingerprints.add(sentenceFingerprint(language.label, text));
        for (const sentence of accepted.values()) fingerprints.add(sentenceFingerprint(sentence.language, sentence.sentence));
      }
    }
  }
  if (!accepted.size || (required?.lemma && !accepted.has('task-1'))) {
    throw new Error(errors[0] || 'ИИ вернул предложения, не прошедшие проверку.');
  }
  return tasks.flatMap(task => accepted.has(task.id) ? [accepted.get(task.id)!] : []);
};

// Coalesce only genuinely identical work, including dictionary projection.
const pendingBatches = new Map<string, Promise<Sentence[]>>();
export const generateSentenceBatch = (code: string, words: Word[], count = DEFAULT_BATCH_SIZE, required?: RequiredWord, previousSentences: string[] = []): Promise<Sentence[]> => {
  if (!Number.isSafeInteger(count) || count < 1 || count > 20) return Promise.reject(new Error('Размер набора должен быть от 1 до 20.'));
  const avoid = [...new Set(previousSentences)].slice(-100);
  const key = JSON.stringify([code, count, required?.lemma?.trim().toLowerCase(), required?.translation, getAllDictionaryCandidates(words, code), avoid]);
  const pending = pendingBatches.get(key);
  if (pending) return pending;
  const task = generateBatch(code, words, count, required, avoid).finally(() => pendingBatches.delete(key));
  pendingBatches.set(key, task);
  return task;
};
