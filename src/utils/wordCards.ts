import type { Word } from '../models/types';
import { buildStudyQueue } from './wordStudy';
import { getWordKey } from './words';

export function buildWordTour(words: Word[], languages: string[], count: number, now = Date.now(), random = Math.random): Word[] {
  return buildStudyQueue({ words, languages, count: Math.min(100, count), mode: 'words' }, now, random).map(c => c.word);
}

/** Single-card compatibility helper; trainers use a fixed buildWordTour snapshot. */
export function pickWordCard(words: Word[], languages: string[], previousKey?: string, now = Date.now(), random = Math.random): Word | null {
  return buildWordTour(words.filter(word => getWordKey(word) !== previousKey), languages, 1, now, random)[0] ?? null;
}
