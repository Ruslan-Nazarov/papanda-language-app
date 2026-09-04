import { Sentence, Word } from '../models/types';
import { generateGeminiText, isGeminiConfigured } from './geminiClient';
import { buildSentenceGenerationPrompt, getDictionaryCandidates, getLanguagePrompt, SENTENCE_ARRAY_SCHEMA } from './sentencePrompts';
import { validateGeneratedSentences } from '../utils/sentenceValidation';

const DEFAULT_BATCH_SIZE = 8;

export const isSentenceGenerationConfigured = isGeminiConfigured;

export const generateSentenceBatch = async (
  languageCode: string,
  words: Word[],
  count = DEFAULT_BATCH_SIZE
): Promise<Sentence[]> => {
  const language = getLanguagePrompt(languageCode);
  const dictionary = getDictionaryCandidates(words, languageCode);
  if (dictionary.length < 2) throw new Error('Для генерации нужны хотя бы два слова с переводом в активном словаре.');

  const text = await generateGeminiText(buildSentenceGenerationPrompt(languageCode, dictionary, count), {
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
    throw new Error('Gemini вернул некорректный JSON. Попробуйте ещё раз.');
  }

  const result = validateGeneratedSentences(body, languageCode, language.label, dictionary);
  if (result.sentences.length === 0) {
    throw new Error(result.errors[0] || 'ИИ вернул предложения, не прошедшие проверку.');
  }
  return result.sentences;
};
