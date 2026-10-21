import type { Word } from '../models/types';
import { getWordKey, getWordTranslation } from './words';
import { readWordStats, wordMemoryWeight } from './statistics';

export function pickWordCard(words: Word[], languages: string[], previousKey?: string, now = Date.now(), random = Math.random): Word | null {
  if (!languages.length) return null;
  const eligible = words.filter(word => {
    const knowledge = readWordStats(word.knowledge_stats);
    return languages.every(lang => Boolean(getWordTranslation(word, lang))) &&
      !languages.every(lang => knowledge[lang] === true);
  });
  const alternatives = eligible.filter(word => getWordKey(word) !== previousKey);
  const pending = alternatives.length ? alternatives : eligible;
  if (!pending.length) return null;
  const weights = pending.map(word => 0.15 + 1 -
    languages.reduce((sum, lang) => sum + wordMemoryWeight(word, lang, now), 0) / languages.length);
  let remainder = random() * weights.reduce((sum, weight) => sum + weight, 0);
  for (let index = 0; index < pending.length; index++) {
    remainder -= weights[index];
    if (remainder <= 0) return pending[index];
  }
  return pending[pending.length - 1];
}
