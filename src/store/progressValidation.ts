import { migrateProgress } from './progressMigration';
import { LANGUAGES } from '../constants/languages';
import type { Sentence } from '../models/types';
import type { PersistedProgress } from './progressTypes';
import { createDefaultProgress, pickPersistedFields } from './progressTypes';

type Check = (value: unknown) => boolean;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const string: Check = value => typeof value === 'string';
const boolean: Check = value => typeof value === 'boolean';
const number: Check = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const integer: Check = value => number(value) && Number.isSafeInteger(value);
const timestamp: Check = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const day: Check = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && timestamp(value);
const array = (check: Check): Check => value => Array.isArray(value) && value.every(check);
const dictionary = (check: Check): Check => value => record(value) && Object.values(value).every(check);
const shape = (required: Record<string, Check>, optional: Record<string, Check> = {}): Check => value =>
  record(value) && Object.entries(required).every(([key, check]) => check(value[key])) &&
  Object.entries(optional).every(([key, check]) => value[key] === undefined || check(value[key]));

const roles = new Set(['Predicate', 'Subject', 'Attribute', 'Attribute_Subject', 'Object', 'Attribute_Object',
  'Circumstance', 'Adverbial', 'Conjunction', 'Preposition', 'Particle', 'Article', 'Other']);
const token = shape({ text: string, label: string, translation: string, role: value => typeof value === 'string' && roles.has(value), is_in_my_dict: boolean }, {
  parts: array(string), dictionary_word: value => value === null || string(value), dictionary_form: string, clauseIndex: integer,
});
const sentenceShape = shape({ id: string, language: string, sentence: string, words: array(token) }, {
  source: value => ['seed', 'manual', 'generated'].includes(String(value)), createdAt: number,
  markerHints: array(shape({ clauseIndex: integer, role: value => typeof value === 'string' && roles.has(value), explanation: string,
    evidence: array(shape({ tokenIndex: integer, form: string })), source: value => value === 'authored' || value === 'ai' })),
  literalTranslation: string, learningGoal: string, generationTaskId: string,
  generationBatchId: string, chainStep: integer,
});
const sentence: Check = value => sentenceShape(value) && record(value) &&
  (value.markerHints === undefined || (value.markerHints as { evidence: { tokenIndex: number; form: string }[] }[]).every(hint =>
    hint.evidence.length > 0 && hint.evidence.every(e => typeof e.form === 'string' && !!e.form.trim() &&
      !!(value.words as { text: string }[])[e.tokenIndex]?.text.includes(e.form))));
const verification = shape({ status: value => value === 'verified' || value === 'flagged', checkedAt: timestamp }, {
  issues: array(shape({ lang: string, issue: string }, { suggestion: string })),
});
const statsFields = {
  count: integer, is_learned: value => value === 0 || value === 1,
  knowledge_stats: dictionary(boolean), show_stats: dictionary(integer),
  last_shown: timestamp, last_shown_by_lang: dictionary(timestamp),
  snoozed_until_by_lang: dictionary(timestamp), personal_association: string, is_favorite: boolean,
} satisfies Record<string, Check>;
const progress = shape({}, {
  ...statsFields, custom_word: string, custom_ru: string,
  custom_translations: dictionary(string), ai_verification: verification,
});
const legacyStats = (check: Check): Check => value => {
  try { return check(typeof value === 'string' ? JSON.parse(value) : value); } catch { return false; }
};
const wordFields = shape({ count: integer, is_learned: statsFields.is_learned }, {
  ...statsFields, knowledge_stats: legacyStats(dictionary(boolean)), show_stats: legacyStats(dictionary(integer)),
  id: string, word: string, eng: string, ru: string, it: string, de: string, es: string, fr: string,
  meaning: string, translations: dictionary(string), source_language: string,
});
const word: Check = value => wordFields(value) && record(value) &&
  ((typeof value.eng === 'string' && value.eng.trim().length > 0) || (typeof value.word === 'string' && value.word.trim().length > 0));
const languages = new Set(LANGUAGES.map(language => language.code));
const schema = shape({ userWordProgress: dictionary(progress) }, {
  structureAttempts: value => Array.isArray(value) && value.length <= 500 && value.every(shape({
    id: string, sentenceId: string, language: string, role: value => typeof value === 'string' && roles.has(value), clauseIndex: integer,
    selected: array(integer), expected: array(integer), result: value => typeof value === 'string' && ['correct','incorrect','disputed'].includes(value),
    hintLevel: value => integer(value) && (value as number) <= 2, createdAt: timestamp,
  })),
  readingTexts: value => Array.isArray(value) && value.length <= 10 && value.every(item =>
    shape({ id: string, title: string, language: string, segments: array(string), position: integer, cards: dictionary(sentence) })(item) &&
    LANGUAGES.some(language => language.label === item.language) &&
    item.segments.length > 0 && item.segments.length <= 20 && item.segments.every((s: string) => s.trim() && s.length <= 600) &&
    item.segments.join('\n').length <= 6000 && item.position < item.segments.length &&
    Object.entries(item.cards).every(([key, card]) => /^\d+$/.test(key) && Number(key) < item.segments.length &&
      (card as { sentence: string; language: string }).sentence === item.segments[Number(key)] && (card as { language: string }).language === item.language)) &&
    new Set(value.map(item => item.id)).size === value.length,
  // Accepted only for migrating profiles/backups from the removed card-report feature.
  sentenceReports: dictionary(shape({ sentence, reason: string, reportedAt: timestamp }, { tokenIndex: integer })),
  customWords: array(word), customSentences: array(sentence), generatedSentences: array(sentence),
  activeLanguages: value => Array.isArray(value) && value.length > 0 && value.every(code => languages.has(code)) && new Set(value).size === value.length,
  dailyShows: value => dictionary(integer)(value) && Object.keys(value as object).every(day),
  workoutSnapshots: array(value => shape({ date: day, total: integer, correct: integer })(value) &&
    record(value) && (value.correct as number) <= (value.total as number)),
  imwSnapshots: array(shape({ date: day, imw: number, byLang: dictionary(number) })),
  wordTourSize: value => integer(value) && (value as number) >= 1 && (value as number) <= 100,
  workoutWordCount: value => integer(value) && (value as number) >= 1 && (value as number) <= 100,
  workoutLearnedWordCount: value => integer(value) && (value as number) <= 100,
  workoutFavoritesOnly: boolean, hasSeenSnoozeHint: boolean,
});

/** Validate completely before changing live state. Missing legacy fields get defaults. */
export const parseProgress = (value: unknown): PersistedProgress => {
  if (!schema(value)) throw new Error('Файл прогресса повреждён или имеет неверный формат.');
  const result = pickPersistedFields({ ...createDefaultProgress(), ...value as Partial<PersistedProgress> });
  result.workoutLearnedWordCount = Math.min(result.workoutWordCount, result.workoutLearnedWordCount);
  // Detach from the caller: imports must not retain externally mutable objects.
  const { sentenceReports } = value as { sentenceReports?: Record<string, { sentence: Sentence }> };
  return migrateProgress(JSON.parse(JSON.stringify({ ...result, sentenceReports })));
};
