import { LANGUAGES } from '../constants/languages';
import { developmentExamples } from '../data/studyExamples';
import type { Sentence, SyntaxRole } from '../models/types';
import type { StructureAttempt } from '../models/study';
import type { ExerciseCheckpoint, LessonFocus, LessonItem, LessonPurpose, LessonSummary, SentenceLesson, SentenceLessonProgress } from '../models/sentenceLessons';
import { localDateKey } from './date';
import { studyGroups, structureSummary } from './structureStudy';
import { sentenceFingerprint } from './sentenceValidation';

export const LESSON_FOCUSES: { id: LessonFocus; title: string; goal: string; roles: SyntaxRole[] }[] = [
  { id: 'core', title: 'Основа предложения', goal: 'Найти сказуемое и подлежащее: что происходит и о ком говорится.', roles: ['Predicate', 'Subject'] },
  { id: 'attribute', title: 'Признаки предмета', goal: 'Найти основу и слова, которые уточняют признаки предметов.', roles: ['Attribute', 'Attribute_Subject', 'Attribute_Object'] },
  { id: 'object', title: 'Дополнение', goal: 'От основы перейти к тому, на что направлено действие.', roles: ['Object'] },
  { id: 'circumstance', title: 'Обстоятельства', goal: 'Найти основу и уточнения: где, когда и как происходит действие.', roles: ['Circumstance', 'Adverbial'] },
  { id: 'complex', title: 'Несколько основ', goal: 'Найти основы в разных частях предложения и понять их связь.', roles: ['Predicate', 'Subject'] },
];
export const lessonFocus = (focus: LessonFocus) => LESSON_FOCUSES.find(item => item.id === focus)!;
export const lessonRoles = (focus: LessonFocus): SyntaxRole[] => [...new Set<SyntaxRole>(['Predicate', 'Subject', ...lessonFocus(focus).roles])];
export const lessonGroups = (sentence: Sentence, focus: LessonFocus) => studyGroups(sentence).filter(group => lessonRoles(focus).includes(group.role));
const key = (sentence: Sentence) => sentenceFingerprint(sentence.language, sentence.sentence);
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const emptyLessonProgress = (): SentenceLessonProgress => ({ current: null, history: [], reviews: [] });
export const createExerciseCheckpoint = (hint = 0): ExerciseCheckpoint => ({ id: uid(), step: 0, selected: [], hint, checked: false, disputed: false, translation: false, translationSeen: false, outcomes: [] });
const successfulSummary = (item: LessonSummary) => item.focusTotal >= 2 && item.focusIndependent / item.focusTotal >= 0.8 && !item.sentencesSkipped;

function retainLessonHistory(history: LessonSummary[]): LessonSummary[] {
  if (history.length <= 60) return history;
  const keep = new Set(history.slice(-50).map(item => item.id));
  // Keep two successful days per topic so trimming old results cannot lock an acquired topic again.
  for (const focus of LESSON_FOCUSES) {
    const days = new Set<string>();
    for (const item of history) if (item.focus === focus.id && successfulSummary(item) && !days.has(item.day) && days.size < 2) {
      days.add(item.day); keep.add(item.id);
    }
  }
  return history.filter(item => keep.has(item.id));
}

function matches(sentence: Sentence, focus: LessonFocus) {
  const groups = studyGroups(sentence);
  return groups.some(group => group.role === 'Predicate') && groups.some(group => group.role === 'Subject') &&
    (focus === 'complex' ? new Set(groups.map(group => group.clauseIndex)).size > 1 : groups.every(group => group.clauseIndex === 0)) &&
    lessonFocus(focus).roles.some(role => groups.some(group => group.role === role));
}

/** The home screen and planner must offer topics from the same eligible cards. */
export function sentenceLessonCatalog(code: string, catalog: Sentence[]): Sentence[] {
  const language = LANGUAGES.find(item => item.code === code);
  if (!language) return [];
  return [...new Map([...catalog, ...developmentExamples(code)].filter(sentence => sentence.language === language.label &&
    sentence.chainStep === undefined && studyGroups(sentence).length > 0).map(sentence => [key(sentence), sentence])).values()];
}

/** Advance only after independent success on different calendar days. */
export function nextLessonFocus(sentences: Sentence[], progress: SentenceLessonProgress): LessonFocus {
  const available = LESSON_FOCUSES.filter(focus => new Set(sentences.filter(sentence => matches(sentence, focus.id)).map(key)).size >= 3);
  const unmastered = available.find(focus => new Set(progress.history.filter(item => item.focus === focus.id && successfulSummary(item)).map(item => item.day)).size < 2);
  return unmastered?.id ?? available[available.length - 1]?.id ?? 'core';
}

/** Fixed snapshots keep a lesson stable when AI cache entries are replaced. No AI request is needed. */
export function planSentenceLesson(code: string, catalog: Sentence[], progress = emptyLessonProgress(), attempts: StructureAttempt[] = [], count = 5, now = new Date()): SentenceLesson | null {
  const language = LANGUAGES.find(item => item.code === code);
  if (!language || ![3, 5].includes(count)) return null;
  const pool = sentenceLessonCatalog(code, catalog);
  const focus = nextLessonFocus(pool, progress);
  const candidates = pool.filter(sentence => matches(sentence, focus)).sort((a, b) => studyGroups(a).length - studyGroups(b).length || a.words.length - b.words.length);
  if (candidates.length < count) {
    // A small offline catalog can still support a lesson, using other single-clause cards for the warm-up.
    for (const sentence of pool.filter(sentence => matches(sentence, 'core'))) if (!candidates.some(item => key(item) === key(sentence))) candidates.push(sentence);
  }
  if (candidates.length < count) return null;
  const id = uid(), used = new Set<string>();
  const recent = new Set(progress.reviews.map(review => key(review.sentence)));
  const due = progress.reviews.filter(review => Date.parse(review.dueAt) <= now.getTime()).sort((a, b) => Number(b.difficult) - Number(a.difficult) || Date.parse(a.dueAt) - Date.parse(b.dueAt));
  const weak = structureSummary(attempts, language.label).find(row => row.errors || row.assisted)?.role;
  const items: LessonItem[] = [];
  const add = (sentence: Sentence | undefined, purpose: LessonPurpose) => {
    if (!sentence || used.has(key(sentence))) return false;
    used.add(key(sentence));
    items.push({ sentence: JSON.parse(JSON.stringify(sentence)), purpose, progress: createExerciseCheckpoint(purpose === 'learn' ? 2 : 0) });
    return true;
  };
  const take = (filter: (sentence: Sentence) => boolean) => candidates.find(sentence => !used.has(key(sentence)) && filter(sentence));
  for (let slot = 0; slot < count; slot++) {
    if (slot < count - 3) {
      const remainingFocus = candidates.filter(sentence => !used.has(key(sentence)) && matches(sentence, focus)).length;
      const review = due.find(item => !used.has(key(item.sentence)) && (matches(item.sentence, 'core') || matches(item.sentence, focus)) &&
        (!matches(item.sentence, focus) || !candidates.some(sentence => key(sentence) === key(item.sentence)) || remainingFocus > 3));
      if (review && add(review.sentence, review.difficult ? 'repair' : 'review')) continue;
    }
    const purpose: LessonPurpose = slot === count - 1 ? 'transfer' : count === 3 ? 'practice' : slot === 2 ? 'learn' : slot === 3 ? 'practice' : 'warmup';
    // Reserve three examples of the new construction for explanation, practice and transfer.
    if (slot < count - 3) {
      const warmup = take(sentence => !matches(sentence, focus));
      if (warmup && add(warmup, 'warmup')) continue;
    }
    // New contexts come before recently studied ones; the last example is not a warmed-up duplicate.
    const sameFocus = (sentence: Sentence) => matches(sentence, focus);
    const selected = (slot === 1 && weak ? take(sentence => sameFocus(sentence) && sentence.words.some(word => word.role === weak) && !recent.has(key(sentence))) : undefined) ??
      take(sentence => sameFocus(sentence) && !recent.has(key(sentence))) ?? take(sameFocus) ?? take(() => true);
    add(selected, purpose);
  }
  return { id, languageCode: code, focus, startedAt: now.toISOString(), completedAt: null, position: 0, items };
}

export function summarizeLesson(lesson: SentenceLesson): LessonSummary {
  const outcomes = lesson.items.flatMap(item => item.progress.outcomes);
  const focus = outcomes.filter(item => lessonFocus(lesson.focus).roles.includes(item.role) && item.result !== 'disputed');
  const completedAt = lesson.completedAt ?? lesson.startedAt;
  const independent = (item: typeof outcomes[number]) => item.result === 'correct' && item.hintLevel === 0;
  return { id: lesson.id, focus: lesson.focus, completedAt, day: localDateKey(new Date(completedAt)),
    independent: outcomes.filter(independent).length,
    assisted: outcomes.filter(item => item.result === 'correct' && item.hintLevel > 0).length,
    errors: outcomes.filter(item => item.result === 'incorrect').length,
    skipped: outcomes.filter(item => item.result === 'skipped').length,
    disputed: outcomes.filter(item => item.result === 'disputed').length,
    sentencesCompleted: lesson.items.filter(item => item.progress.outcomes.length > 0 && item.progress.outcomes.every(answer => answer.result !== 'skipped')).length,
    sentencesSkipped: lesson.items.filter(item => item.progress.outcomes.some(answer => answer.result === 'skipped')).length,
    focusIndependent: focus.filter(independent).length, focusTotal: focus.length };
}

export function advanceLesson(progress: SentenceLessonProgress, skip = false, now = new Date()): SentenceLessonProgress {
  const lesson = progress.current;
  if (!lesson || lesson.completedAt) return progress;
  const item = lesson.items[lesson.position], groups = lessonGroups(item.sentence, lesson.focus);
  if (!skip && item.progress.step < groups.length) return progress;
  const checkpoint = skip ? { ...item.progress, step: groups.length, checked: false, disputed: false, selected: [],
    outcomes: groups.map((group, index) => item.progress.outcomes[index] ?? { role: group.role, result: 'skipped' as const, hintLevel: item.progress.hint }) } : item.progress;
  const items = lesson.items.map((old, index) => index === lesson.position ? { ...old, progress: checkpoint } : old);
  const position = lesson.position + 1;
  const current = { ...lesson, items, position, completedAt: position === items.length ? now.toISOString() : null };
  if (!current.completedAt) return { ...progress, current };
  const reviews = new Map(progress.reviews.map(review => [key(review.sentence), review]));
  for (const card of items) {
    // Disputed annotations cannot provide reliable repetition or mastery signals.
    if (card.progress.outcomes.some(answer => answer.result === 'disputed')) { reviews.delete(key(card.sentence)); continue; }
    const difficult = card.progress.outcomes.some(answer => answer.result !== 'correct' || answer.hintLevel > 0);
    const successes = difficult ? 0 : (reviews.get(key(card.sentence))?.successes ?? 0) + 1;
    const due = new Date(now); due.setDate(due.getDate() + (difficult ? 1 : [1, 3, 7, 14][Math.min(successes - 1, 3)]));
    reviews.delete(key(card.sentence));
    reviews.set(key(card.sentence), { sentence: card.sentence, dueAt: due.toISOString(), difficult, successes });
  }
  return { current, history: retainLessonHistory([...progress.history, summarizeLesson(current)]), reviews: [...reviews.values()].slice(-20) };
}

const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
const timestamp = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const focusId = (value: unknown): value is LessonFocus => LESSON_FOCUSES.some(focus => focus.id === value);
export function isExerciseCheckpoint(value: unknown, sentence: Sentence, focus: LessonFocus): value is ExerciseCheckpoint {
  if (!object(value)) return false;
  const groups = lessonGroups(sentence, focus);
  return typeof value.id === 'string' && !!value.id && integer(value.step) && value.step <= groups.length &&
    Array.isArray(value.selected) && value.selected.every((index: unknown) => integer(index) && (index as number) < sentence.words.length) && new Set(value.selected).size === value.selected.length &&
    integer(value.hint) && value.hint <= 2 && ['checked', 'disputed', 'translation', 'translationSeen'].every(field => typeof value[field] === 'boolean') &&
    (!value.disputed || value.checked) && (!value.checked || value.step < groups.length) &&
    Array.isArray(value.outcomes) && value.outcomes.length === value.step + Number(value.checked) && value.outcomes.every((answer: unknown, index: number) => object(answer) && answer.role === groups[index]?.role &&
      ['correct', 'incorrect', 'disputed', 'skipped'].includes(answer.result) && integer(answer.hintLevel) && answer.hintLevel <= 2);
}
/** Strict import checks: snapshots and their saved steps must describe the same exercise. */
export function isSentenceLessonProgress(value: unknown, checkSentence: (value: unknown) => boolean, code: string): value is SentenceLessonProgress {
  if (!object(value) || !Array.isArray(value.history) || value.history.length > 60 || !Array.isArray(value.reviews) || value.reviews.length > 20) return false;
  const language = LANGUAGES.find(item => item.code === code)?.label;
  if (!language) return false;
  const validSentence = (sentence: unknown): sentence is Sentence => checkSentence(sentence) && (sentence as Sentence).language === language;
  if (!value.history.every((item: unknown) => object(item) && typeof item.id === 'string' && focusId(item.focus) && timestamp(item.completedAt) &&
    typeof item.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.day) &&
    ['independent', 'assisted', 'errors', 'skipped', 'disputed', 'sentencesCompleted', 'sentencesSkipped', 'focusIndependent', 'focusTotal'].every(field => integer(item[field])) &&
    item.focusIndependent <= item.focusTotal && item.sentencesCompleted + item.sentencesSkipped >= 3 && item.sentencesCompleted + item.sentencesSkipped <= 5)) return false;
  if (!value.reviews.every((review: unknown) => object(review) && validSentence(review.sentence) && timestamp(review.dueAt) && integer(review.successes) && typeof review.difficult === 'boolean')) return false;
  const lesson = value.current;
  if (lesson === null) return true;
  if (!object(lesson) || typeof lesson.id !== 'string' || !lesson.id || lesson.languageCode !== code || !focusId(lesson.focus) || !timestamp(lesson.startedAt) ||
    !Array.isArray(lesson.items) || ![3, 5].includes(lesson.items.length) || !integer(lesson.position) || lesson.position > lesson.items.length ||
    !(lesson.completedAt === null ? lesson.position < lesson.items.length : timestamp(lesson.completedAt) && Date.parse(lesson.completedAt) >= Date.parse(lesson.startedAt) && lesson.position === lesson.items.length)) return false;
  if (!lesson.items.every((item: unknown, index: number) => object(item) && validSentence(item.sentence) && lessonGroups(item.sentence, lesson.focus).length > 0 &&
    ['warmup', 'review', 'repair', 'learn', 'practice', 'transfer'].includes(item.purpose) && isExerciseCheckpoint(item.progress, item.sentence, lesson.focus) &&
    (index >= lesson.position || item.progress.step === lessonGroups(item.sentence, lesson.focus).length))) return false;
  return new Set(lesson.items.map((item: LessonItem) => key(item.sentence))).size === lesson.items.length;
}
