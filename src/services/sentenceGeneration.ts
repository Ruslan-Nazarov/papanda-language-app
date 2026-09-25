import { Sentence, Word } from '../models/types';
import { generateGeminiText, isGeminiConfigured } from './geminiClient';
import { buildSentenceGenerationPrompt, buildSentenceAnnotationPrompt, getAllDictionaryCandidates, getSeedWords, getLanguagePrompt, SENTENCE_ARRAY_SCHEMA, DRAFT_ARRAY_SCHEMA } from './sentencePrompts';
import { parseSentenceDrafts, planSentenceBatch, SentenceDraft } from './sentenceCurriculum';
import { sentenceFingerprint, validateGeneratedSentences } from '../utils/sentenceValidation';

const DEFAULT_BATCH_SIZE = 8;
// Two batched requests per round; one bounded repair round for rejected tasks.
const MAX_GENERATION_ROUNDS = 2;
export const isSentenceGenerationConfigured = isGeminiConfigured;
export interface RequiredWord { lemma: string; translation?: string }

const parseJSON = (text: string): unknown => {
  try { return JSON.parse(text); } catch { return null; }
};

const generateBatch = async (code: string, words: Word[], count: number, required?: RequiredWord): Promise<Sentence[]> => {
  const language = getLanguagePrompt(code);
  const dictionary = getAllDictionaryCandidates(words, code);
  if (required?.lemma && !dictionary.some(entry => entry.lemma.toLocaleLowerCase() === required.lemma.trim().toLocaleLowerCase())) {
    dictionary.push({ lemma: required.lemma.trim(), translation: required.translation || '' });
  }
  const tasks = planSentenceBatch(count);
  const accepted = new Map<string, Sentence>();
  const fingerprints = new Set<string>();
  let errors: string[] = [];
  for (let round = 0; round < MAX_GENERATION_ROUNDS && accepted.size < count; round++) {
    const pending = tasks.filter(task => !accepted.has(task.id));
    const context: SentenceDraft[] = [...accepted].map(([taskId, sentence]) => ({ taskId, sentence: sentence.sentence }));
    const seeds = getSeedWords(words, code);
    if (required?.lemma) seeds.unshift({ lemma: required.lemma.trim(), translation: required.translation || '' });
    try {
      const draftText = await generateGeminiText(buildSentenceGenerationPrompt(code, seeds, pending.length,
        context.map(item => item.sentence), required?.lemma, pending, errors, context), {
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
      // Task order is authoritative even if the model reverses its response.
      for (const task of pending) {
        const sentence = result.sentences.find(item => item.generationTaskId === task.id);
        if (!sentence) { errors.push(`${task.id}: составьте новый естественный пример и надёжный разбор.`); continue; }
        if (task.develops && !accepted.has(task.develops)) {
          errors.push(`${task.id}: сначала нужна принятая основа ${task.develops}.`); continue;
        }
        const fingerprint = sentenceFingerprint(sentence.language, sentence.sentence);
        if (fingerprints.has(fingerprint)) { errors.push(`${task.id}: повтор предложения.`); continue; }
        fingerprints.add(fingerprint);
        accepted.set(task.id, sentence);
      }
    } catch (error) {
      // Partial background batches are useful, but targeted generation must never
      // succeed without its requested lexeme.
      if (accepted.size && (!required?.lemma || accepted.has('task-1'))) break;
      throw error;
    }
  }
  if (!accepted.size || (required?.lemma && !accepted.has('task-1'))) {
    throw new Error(errors[0] || 'ИИ вернул предложения, не прошедшие проверку.');
  }
  return tasks.flatMap(task => accepted.has(task.id) ? [accepted.get(task.id)!] : []);
};

// Coalesce only genuinely identical work, including dictionary projection.
const pendingBatches = new Map<string, Promise<Sentence[]>>();
export const generateSentenceBatch = (code: string, words: Word[], count = DEFAULT_BATCH_SIZE, required?: RequiredWord): Promise<Sentence[]> => {
  if (!Number.isSafeInteger(count) || count < 1 || count > 20) return Promise.reject(new Error('Размер набора должен быть от 1 до 20.'));
  const key = JSON.stringify([code, count, required?.lemma?.trim().toLowerCase(), required?.translation, getAllDictionaryCandidates(words, code)]);
  const pending = pendingBatches.get(key);
  if (pending) return pending;
  const task = generateBatch(code, words, count, required).finally(() => pendingBatches.delete(key));
  pendingBatches.set(key, task);
  return task;
};
