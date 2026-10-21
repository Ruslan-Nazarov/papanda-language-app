import type { Word } from '../models/types';
import { getWordTranslation } from './words';
import { readWordStats, wordMemoryWeight, getWordLastShown } from './statistics';
import { localDateKey } from './date';

export function isDueForReview(word: Word, lang: string, now = Date.now()): boolean {
  if (!getWordTranslation(word, lang)) return false;
  if (Date.parse(word.snoozed_until_by_lang?.[lang] ?? '') > now) return false;
  const shown = readWordStats(word.show_stats)[lang];
  if (typeof shown !== 'number' || shown <= 0) return false;
  const last = getWordLastShown(word, lang);
  if (last && localDateKey(new Date(last)) === localDateKey(new Date(now))) return false;
  return readWordStats(word.knowledge_stats)[lang] !== true || wordMemoryWeight(word, lang, now) < 0.65;
}
export function buildReviewPlan(words: Word[], languages: string[], now = Date.now()) {
  return words.flatMap(word => languages.filter(langCode => isDueForReview(word, langCode, now)).map(langCode => ({
    word, langCode, weight: wordMemoryWeight(word, langCode, now),
    reason: readWordStats(word.knowledge_stats)[langCode] === true ? 'Давно не повторяли' : 'Ответ был неуверенным',
  }))).sort((a,b) => a.weight-b.weight);
}
