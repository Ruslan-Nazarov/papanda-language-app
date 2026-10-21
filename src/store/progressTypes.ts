import type { StructureAttempt, ReadingText } from '../models/study';
import type { Sentence, Word } from '../models/types';
import type { DailyShows, ImwSnapshot, WorkoutSnapshot } from '../utils/statistics';

export interface WordAiIssue {
  lang: string;
  issue: string;
  suggestion?: string;
}

export interface WordAiVerification {
  status: 'verified' | 'flagged';
  issues?: WordAiIssue[];
  checkedAt: string;
}

export interface UserWordProgress {
  count?: number;
  is_learned?: number;
  knowledge_stats?: Record<string, boolean>;
  show_stats?: Record<string, number>;
  last_shown?: string;
  last_shown_by_lang?: Record<string, string>;
  personal_association?: string;
  custom_word?: string;
  custom_ru?: string;
  custom_translations?: Record<string, string>;
  is_favorite?: boolean;
  snoozed_until_by_lang?: Record<string, string>;
  ai_verification?: WordAiVerification;
}

export interface PersistedProgress {
  structureAttempts: StructureAttempt[];
  readingTexts: ReadingText[];
  userWordProgress: Record<string, UserWordProgress>;
  customSentences: Sentence[];
  generatedSentences: Sentence[];
  customWords: Word[];
  activeLanguages: string[];
  dailyShows: DailyShows;
  workoutSnapshots: WorkoutSnapshot[];
  imwSnapshots: ImwSnapshot[];
  wordTourSize: number;
  workoutWordCount: number;
  workoutLearnedWordCount: number;
  workoutFavoritesOnly: boolean;
  hasSeenSnoozeHint: boolean;
}

export const createDefaultProgress = (): PersistedProgress => ({
  structureAttempts: [], readingTexts: [],
  userWordProgress: {}, customSentences: [], generatedSentences: [], customWords: [],
  activeLanguages: ['en', 'kz', 'it'], dailyShows: {}, workoutSnapshots: [], imwSnapshots: [],
  wordTourSize: 10, workoutWordCount: 10, workoutLearnedWordCount: 5,
  workoutFavoritesOnly: false, hasSeenSnoozeHint: false,
});

export const pickPersistedFields = (state: PersistedProgress): PersistedProgress => ({
  structureAttempts: state.structureAttempts, readingTexts: state.readingTexts,
  userWordProgress: state.userWordProgress,
  customSentences: state.customSentences,
  generatedSentences: state.generatedSentences,
  customWords: state.customWords,
  activeLanguages: state.activeLanguages,
  dailyShows: state.dailyShows,
  workoutSnapshots: state.workoutSnapshots,
  imwSnapshots: state.imwSnapshots,
  wordTourSize: state.wordTourSize,
  workoutWordCount: state.workoutWordCount,
  workoutLearnedWordCount: state.workoutLearnedWordCount,
  workoutFavoritesOnly: state.workoutFavoritesOnly,
  hasSeenSnoozeHint: state.hasSeenSnoozeHint,
});
