import type { Word } from '../models/types';
import { getWordKey, getWordTranslation } from './words';
import { readWordStats, getWordLastShown, WORD_MEMORY } from './statistics';
import { localDateKey } from './date';

export interface QueueItem { word: Word; langCode: string }
export interface WorkoutOptions {
  words: Word[];
  activeLanguages: string[];
  workoutWordCount: number;
  workoutLearnedWordCount?: number;
  workoutFavoritesOnly?: boolean;
}

export const shuffle = <T,>(items: T[], random = Math.random): T[] => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface Candidate {
  item: QueueItem;
  key: string;
  isShownToday: boolean;
  lastMs: number;
  urgency: number;
}

/** Pure queue construction with random weighted selection and cooldown protection.
 * Words marked "Знаю" appear less frequently ("знаю уменьшает количество показов").
 * Unseen and failed words appear more frequently.
 */
export const buildWorkoutQueue = (options: WorkoutOptions, now = Date.now(), random = Math.random): QueueItem[] => {
  const count = Math.max(0, Math.min(100, Math.floor(options.workoutWordCount) || 0));
  if (count === 0 || !options.words?.length || !options.activeLanguages?.length) return [];

  const learned: Candidate[] = [];
  const failed: Candidate[] = [];
  const fresh: Candidate[] = [];
  const seen = new Set<string>();

  for (const word of options.words) {
    const wordKey = getWordKey(word);
    if (!wordKey) continue;
    if (options.workoutFavoritesOnly && !word.is_favorite) continue;

    const stats = readWordStats(word.knowledge_stats);
    for (const langCode of options.activeLanguages) {
      const key = `${wordKey}:${langCode}`;
      if (seen.has(key) || !getWordTranslation(word, langCode)) continue;
      const snoozed = word.snoozed_until_by_lang?.[langCode];
      if (snoozed && Date.parse(snoozed) > now) continue;
      seen.add(key);

      const lastShown = getWordLastShown(word, langCode);
      const lastMs = lastShown && Number.isFinite(Date.parse(lastShown)) ? Date.parse(lastShown) : 0;
      const isShownToday = lastMs > 0 && localDateKey(new Date(lastMs)) === localDateKey(new Date(now));
      const shows = readWordStats(word.show_stats)[langCode];
      const numShows = typeof shows === 'number' && Number.isFinite(shows) ? shows : 0;
      const deltaDays = lastMs > 0 ? Math.max(0, (now - lastMs) / MS_PER_DAY) : 30;

      const item: QueueItem = { word, langCode };

      if (stats[langCode] === true) {
        // Known words: memory retention decay. "Знаю" reduces priority substantially
        const stabilityDays = WORD_MEMORY.BASE_STABILITY_DAYS * (1 + numShows / 10) * 3;
        const retention = Math.exp(-deltaDays / stabilityDays);
        const baseUrgency = lastMs === 0 ? 1.5 : (1 - retention);
        const urgency = isShownToday ? baseUrgency - 100 : baseUrgency;
        learned.push({ item, key, isShownToday, lastMs, urgency });
      } else if (stats[langCode] === false) {
        // Failed words: prioritize over known words
        const baseUrgency = lastMs === 0 ? 1.5 : Math.min(1.0, deltaDays / 3);
        const urgency = isShownToday ? baseUrgency - 100 : baseUrgency;
        failed.push({ item, key, isShownToday, lastMs, urgency });
      } else {
        // Fresh words
        const urgency = isShownToday ? -100 : 0;
        fresh.push({ item, key, isShownToday, lastMs, urgency });
      }
    }
  }

  // Sort candidates by urgency with random jitter to ensure broad rotation across sessions
  const sortWithJitter = (list: Candidate[], jitter = 0.25) =>
    [...list]
      .map(entry => ({ entry, score: entry.urgency + random() * jitter }))
      .sort((a, b) => b.score - a.score)
      .map(x => x.entry);

  const defaultLearnedCount = Math.max(0, Math.floor(count * 0.2));
  const requestedLearned = Math.min(count, Math.max(0, Math.floor(options.workoutLearnedWordCount ?? defaultLearnedCount)));
  const targetLearned = Math.min(requestedLearned, learned.length);
  const targetUnlearned = count - targetLearned;

  let targetFailed = 0;
  let targetFresh = 0;

  if (targetUnlearned > 0) {
    if (failed.length > 0 && fresh.length > 0) {
      const maxFailed = Math.max(1, Math.min(failed.length, Math.ceil(targetUnlearned * 0.6)));
      targetFailed = Math.min(failed.length, maxFailed);
      targetFresh = Math.min(fresh.length, targetUnlearned - targetFailed);
      if (targetFailed + targetFresh < targetUnlearned) {
        targetFailed = Math.min(failed.length, targetUnlearned - targetFresh);
      }
    } else if (failed.length > 0) {
      targetFailed = Math.min(failed.length, targetUnlearned);
    } else if (fresh.length > 0) {
      targetFresh = Math.min(fresh.length, targetUnlearned);
    }
  }

  const learnedSorted = sortWithJitter(learned, 0.3);
  const failedSorted = sortWithJitter(failed, 0.4);

  const freshDue = fresh.filter(x => !x.isShownToday);
  const freshCooling = fresh.filter(x => x.isShownToday);
  const freshSorted = [...shuffle(freshDue, random), ...shuffle(freshCooling, random)];

  const selectedLearned = learnedSorted.slice(0, targetLearned);
  const selectedFailed = failedSorted.slice(0, targetFailed);
  const selectedFresh = freshSorted.slice(0, targetFresh);

  const result: QueueItem[] = [
    ...selectedLearned.map(x => x.item),
    ...selectedFailed.map(x => x.item),
    ...selectedFresh.map(x => x.item),
  ];

  const pickedWords = new Set(result.map(x => getWordKey(x.word)));

  // If there are still empty slots, fill from remaining candidates avoiding duplicate words
  if (result.length < count) {
    const remaining = [...learned, ...failed, ...fresh]
      .filter(entry => !pickedWords.has(getWordKey(entry.item.word)));
    const extra = sortWithJitter(remaining, 0.3).slice(0, count - result.length);
    for (const entry of extra) {
      result.push(entry.item);
      pickedWords.add(getWordKey(entry.item.word));
    }
  }

  return shuffle(result, random);
};
