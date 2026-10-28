import type { Sentence, SyntaxRole } from './types';

export const SENTENCE_LESSON_EXPERIMENT = 'sentence-lessons';
export type LessonFocus = 'core' | 'attribute' | 'object' | 'circumstance' | 'complex';
export type LessonPurpose = 'warmup' | 'review' | 'repair' | 'learn' | 'practice' | 'transfer';
export interface ExerciseOutcome {
  role: SyntaxRole;
  result: 'correct' | 'incorrect' | 'disputed' | 'skipped';
  hintLevel: number;
}
export interface ExerciseCheckpoint {
  id: string;
  step: number;
  selected: number[];
  hint: number;
  checked: boolean;
  disputed: boolean;
  translation: boolean;
  translationSeen: boolean;
  outcomes: ExerciseOutcome[];
}
export interface LessonItem {
  sentence: Sentence;
  purpose: LessonPurpose;
  progress: ExerciseCheckpoint;
}
export interface SentenceLesson {
  id: string;
  languageCode: string;
  focus: LessonFocus;
  startedAt: string;
  completedAt: string | null;
  position: number;
  items: LessonItem[];
}
export interface LessonSummary {
  id: string;
  focus: LessonFocus;
  completedAt: string;
  day: string;
  independent: number;
  assisted: number;
  errors: number;
  skipped: number;
  disputed: number;
  sentencesCompleted: number;
  sentencesSkipped: number;
  focusIndependent: number;
  focusTotal: number;
}
export interface LessonReview {
  sentence: Sentence;
  dueAt: string;
  successes: number;
  difficult: boolean;
}
export interface SentenceLessonProgress {
  current: SentenceLesson | null;
  history: LessonSummary[];
  reviews: LessonReview[];
}
