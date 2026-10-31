import type { StructureAttempt } from '../models/study';
import type { Sentence, Word } from '../models/types';
import type { DailyShows, ImwSnapshot, WorkoutSnapshot } from '../utils/statistics';
import type { LanguageNote } from '../models/notes';
import type { ExperimentProgress } from '../models/experiments';
import type { SentenceLessonProgress } from '../models/sentenceLessons';

export interface WordAiIssue {
  lang: string;
  issue: string;
  suggestion?: string;
}

export interface WordAiVerification {
  status: 'verified' | 'flagged';
  issues?: WordAiIssue[];
  checkedAt: string;
  checkedLanguages?: string[];
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
  sentenceLessons: Record<string, SentenceLessonProgress>;
  experiments: Record<string, ExperimentProgress>;
  languageNotes: LanguageNote[];
  noteDrafts: LanguageNote[];
  structureAttempts: StructureAttempt[];
  userWordProgress: Record<string, UserWordProgress>;
  customSentences: Sentence[];
  generatedSentences: Sentence[];
  customWords: Word[];
  activeLanguages: string[];
  dailyShows: DailyShows;
  workoutSnapshots: WorkoutSnapshot[];
  imwSnapshots: ImwSnapshot[];
  wordTourSize: number;
  sentenceWorkoutCount: number;
  workoutWordCount: number;
  workoutLearnedWordCount: number;
  workoutFavoritesOnly: boolean;
  hasSeenSnoozeHint: boolean;
}

export const createDefaultProgress = (): PersistedProgress => ({
  sentenceLessons: {},
  experiments: {},
  languageNotes: [], noteDrafts: [],
  structureAttempts: [],
  userWordProgress: {}, customSentences: [], generatedSentences: [], customWords: [],
  activeLanguages: ['en', 'kz', 'it'], dailyShows: {}, workoutSnapshots: [], imwSnapshots: [],
  wordTourSize: 10, sentenceWorkoutCount: 5, workoutWordCount: 10, workoutLearnedWordCount: 5,
  workoutFavoritesOnly: false, hasSeenSnoozeHint: false,
});

export const pickPersistedFields = (state: PersistedProgress): PersistedProgress => ({
  sentenceLessons: state.sentenceLessons,
  experiments: state.experiments,
  languageNotes: state.languageNotes, noteDrafts: state.noteDrafts,
  structureAttempts: state.structureAttempts,
  userWordProgress: state.userWordProgress,
  customSentences: state.customSentences,
  generatedSentences: state.generatedSentences,
  customWords: state.customWords,
  activeLanguages: state.activeLanguages,
  dailyShows: state.dailyShows,
  workoutSnapshots: state.workoutSnapshots,
  imwSnapshots: state.imwSnapshots,
  wordTourSize: state.wordTourSize,
  sentenceWorkoutCount: state.sentenceWorkoutCount ?? 5,
  workoutWordCount: state.workoutWordCount,
  workoutLearnedWordCount: state.workoutLearnedWordCount,
  workoutFavoritesOnly: state.workoutFavoritesOnly,
  hasSeenSnoozeHint: state.hasSeenSnoozeHint,
});
