import { Sentence, Word } from '../models/types';
import { generateGeminiText, isGeminiConfigured } from './geminiClient';
import { buildSentenceGenerationPrompt, getDictionaryCandidates, getLanguagePrompt, SENTENCE_ARRAY_SCHEMA } from './sentencePrompts';
import { sentenceFingerprint, validateGeneratedSentences } from '../utils/sentenceValidation';

const DEFAULT_BATCH_SIZE = 8;
// Strict per-sentence validation (predicate, ≥4 tokens, ≥2 dictionary words) plus a
// "lite" model means a single AI call often yields far fewer usable sentences than
// requested. Re-prompt for the shortfall instead of silently accepting whatever
// survived one pass — this is the fix for the "only 2 sentences, looping" symptom.
const MAX_GENERATION_ROUNDS = 3;

const requestOneRound = async (
  languageCode: string,
  dictionary: ReturnType<typeof getDictionaryCandidates>,
  languageLabel: string,
  count: number,
  avoidSentences: string[],
  requiredWord?: string
): Promise<{ sentences: Sentence[]; errors: string[] }> => {
  const text = await generateGeminiText(buildSentenceGenerationPrompt(languageCode, dictionary, count, avoidSentences, requiredWord), {
    // Higher temperature — the batch needs varied sentences, not the single most
    // probable "subject + verb" for the given words.
    temperature: 0.95,
    topP: 0.95,
    responseMimeType: 'application/json',
    responseJsonSchema: SENTENCE_ARRAY_SCHEMA
  });

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error('ИИ вернул некорректный JSON. Попробуйте ещё раз.');
  }

  return validateGeneratedSentences(body, languageCode, languageLabel, dictionary);
};

export const isSentenceGenerationConfigured = isGeminiConfigured;

export interface RequiredWord {
  lemma: string;
  translation?: string;
}

export const generateSentenceBatch = async (
  languageCode: string,
  words: Word[],
  count = DEFAULT_BATCH_SIZE,
  requiredWord?: RequiredWord
): Promise<Sentence[]> => {
  const language = getLanguagePrompt(languageCode);
  const dictionary = getDictionaryCandidates(words, languageCode);

  // The tapped word might not have made it into the random candidate sample
  // (or might not even be in the dictionary yet) — force it in so the model
  // is actually allowed to use it and satisfy the REQUIRED WORD instruction.
  if (requiredWord?.lemma) {
    const normalized = requiredWord.lemma.trim().toLocaleLowerCase();
    const alreadyThere = dictionary.some(item => item.lemma.trim().toLocaleLowerCase() === normalized);
    if (!alreadyThere && normalized) {
      dictionary.unshift({ lemma: requiredWord.lemma.trim(), translation: requiredWord.translation || '' });
    }
  }

  if (dictionary.length < 2) throw new Error('Для генерации нужны хотя бы два слова с переводом в активном словаре.');

  const collected: Sentence[] = [];
  const seenFingerprints = new Set<string>();
  const lastErrors: string[] = [];

  for (let round = 0; round < MAX_GENERATION_ROUNDS && collected.length < count; round++) {
    const shortfall = count - collected.length;
    // Ask for a bit more than the shortfall to absorb validation drop-off.
    const requestCount = round === 0 ? count : Math.min(count, Math.max(shortfall + 2, 4));
    const avoidSentences = collected.map(s => s.sentence);

    let result: { sentences: Sentence[]; errors: string[] };
    try {
      result = await requestOneRound(languageCode, dictionary, language.label, requestCount, avoidSentences, requiredWord?.lemma);
    } catch (error) {
      if (collected.length > 0) break; // keep what we already have rather than failing the whole batch
      throw error;
    }

    lastErrors.length = 0;
    lastErrors.push(...result.errors);

    for (const sentence of result.sentences) {
      const fp = sentenceFingerprint(sentence.language, sentence.sentence);
      if (seenFingerprints.has(fp)) continue;
      seenFingerprints.add(fp);
      collected.push(sentence);
      if (collected.length >= count) break;
    }
  }

  if (collected.length === 0) {
    throw new Error(lastErrors[0] || 'ИИ вернул предложения, не прошедшие проверку.');
  }
  return collected;
};
