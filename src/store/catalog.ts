import offlineSentences from '../data/offlineSentences.json';
import type { Sentence, Word } from '../models/types';
import type { PersistedProgress, UserWordProgress } from './progressTypes';
import wordsData from '../data/words.json';
import sentencesData from '../data/sentences.json';
import { getWordKey } from '../utils/words';

const translationsFromJSON = (value: string): Record<string, string> => {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
};

export const baseStaticWords: Word[] = wordsData.map((word, index) => {
  const translations = translationsFromJSON(word.translations);
  return {
    id: String(index), word: word.word, eng: word.eng, ru: word.ru,
    it: word.it, de: word.de, es: translations.es, fr: translations.fr,
    meaning: word.meaning, translations,
    count: 0, is_learned: 0, knowledge_stats: {}, show_stats: {},
    personal_association: '', is_favorite: false,
  };
});

export const baseStaticSentences = [...sentencesData, ...offlineSentences] as Sentence[];

/** `eng` is the legacy persistence key. Display edits must never change it. */
export const applyWordProgress = (word: Word, progress?: UserWordProgress): Word => {
  if (!progress) return word;
  const translations = { ...word.translations, ...progress.custom_translations };
  if (progress.custom_word !== undefined) translations[word.source_language || 'en'] = progress.custom_word;
  if (progress.custom_ru !== undefined) translations.ru = progress.custom_ru;
  return {
    ...word,
    word: progress.custom_word ?? word.word,
    ru: translations.ru ?? word.ru,
    it: translations.it ?? word.it, de: translations.de ?? word.de,
    es: translations.es ?? word.es, fr: translations.fr ?? word.fr,
    translations,
    count: progress.count ?? word.count,
    is_learned: progress.is_learned ?? word.is_learned,
    knowledge_stats: progress.knowledge_stats ?? word.knowledge_stats,
    show_stats: progress.show_stats ?? word.show_stats,
    last_shown: progress.last_shown ?? word.last_shown,
    last_shown_by_lang: progress.last_shown_by_lang ?? word.last_shown_by_lang,
    snoozed_until_by_lang: progress.snoozed_until_by_lang ?? word.snoozed_until_by_lang,
    personal_association: progress.personal_association ?? word.personal_association,
    is_favorite: progress.is_favorite ?? word.is_favorite,
  };
};

/** User edits override seeds/cache by id, including after a cold start. */
export const mergeSentences = (custom: Sentence[], generated: Sentence[]): Sentence[] =>
  [...new Map([...baseStaticSentences, ...generated, ...custom].map(sentence => [sentence.id, sentence])).values()];

export const deriveCatalog = (state: PersistedProgress) => {
  const customKeys = new Set(state.customWords.map(getWordKey));
  return {
    words: [...state.customWords, ...baseStaticWords.filter(base => !customKeys.has(getWordKey(base)))].map(word => applyWordProgress(word, state.userWordProgress[getWordKey(word)])),
    sentences: mergeSentences(state.customSentences, state.generatedSentences),
  };
};
