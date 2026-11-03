import type { Word } from '../models/types';
import { buildStudyQueue, type StudyCard } from './wordStudy';

export type QueueItem = StudyCard;
export interface WorkoutOptions {
  words: Word[];
  activeLanguages: string[];
  workoutWordCount: number;
  /** Legacy backup preference; selection now adapts to recall. */
  workoutLearnedWordCount?: number;
  workoutFavoritesOnly: boolean;
}

export const shuffle = <T,>(items: T[], random = Math.random): T[] => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

export const buildWorkoutQueue = (options: WorkoutOptions, now = Date.now(), random = Math.random): QueueItem[] =>
  buildStudyQueue({ words: options.words, languages: options.activeLanguages,
    count: Math.min(100, options.workoutWordCount),
    mode: 'workout', favoritesOnly: options.workoutFavoritesOnly }, now, random);
