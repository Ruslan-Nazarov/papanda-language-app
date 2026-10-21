import { isDueForReview } from './reviewPlan';
import type { Word } from '../models/types';
import { getWordKey, getWordTranslation } from './words';
import { readWordStats, wordMemoryWeight } from './statistics';

export interface QueueItem { word: Word; langCode: string }
interface WorkoutOptions {
  words: Word[];
  activeLanguages: string[];
  workoutWordCount: number;
  workoutLearnedWordCount: number;
  workoutFavoritesOnly: boolean;
  workoutReviewOnly?: boolean;
}

export const shuffle = <T,>(items: T[], random = Math.random): T[] => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

/** Pure queue construction, independent of screen state and persistence. */
export const buildWorkoutQueue = (options: WorkoutOptions, now = Date.now(), random = Math.random): QueueItem[] => {
  const failed: QueueItem[] = [], fresh: QueueItem[] = [], learned: QueueItem[] = [];
  const count = Math.max(0, Math.min(100, Math.floor(options.workoutWordCount) || 0));
  const seen = new Set<string>();
  for (const word of options.words) {
    const stats = readWordStats(word.knowledge_stats);
    for (const langCode of options.activeLanguages) {
      if (options.workoutReviewOnly && !isDueForReview(word, langCode, now)) continue;
      const key = `${getWordKey(word)}:${langCode}`;
      if (seen.has(key) || !getWordTranslation(word, langCode) || (options.workoutFavoritesOnly && !options.workoutReviewOnly && !word.is_favorite)) continue;
      const snoozed = word.snoozed_until_by_lang?.[langCode];
      if (snoozed && Date.parse(snoozed) > now) continue;
      seen.add(key);
      const item = { word, langCode };
      if (stats[langCode] === true) learned.push(item);
      else if (stats[langCode] === false) failed.push(item);
      else fresh.push(item);
    }
  }
  // Score once: generating random values inside a comparator violates sort's contract.
  const byDue = (items: QueueItem[]) => items.map(item => ({ item, score: wordMemoryWeight(item.word, item.langCode, now) + random() * 0.08 }))
    .sort((a, b) => a.score - b.score).map(entry => entry.item);
  const pickWindow = (items: QueueItem[], take: number) => shuffle(items.slice(0, Math.max(take + 4, take * 3)), random).slice(0, take);
  const learnedSorted = byDue(learned);
  const learnedCount = Math.min(count, Math.max(0, Math.floor(options.workoutLearnedWordCount) || 0), learned.length);
  const unlearnedCount = count - learnedCount;
  const failedCount = Math.min(failed.length, Math.max(Math.ceil(unlearnedCount * 0.6), unlearnedCount - fresh.length));
  const freshCount = Math.min(fresh.length, unlearnedCount - failedCount);
  const result = [
    ...pickWindow(byDue(failed), failedCount),
    ...shuffle(fresh, random).slice(0, freshCount),
    ...pickWindow(learnedSorted, learnedCount),
  ];
  const used = new Set(result.map(item => `${getWordKey(item.word)}:${item.langCode}`));
  const extra = learnedSorted.filter(item => !used.has(`${getWordKey(item.word)}:${item.langCode}`)).slice(0, Math.max(0, count - result.length));
  return shuffle([...result, ...extra], random);
};
