import './setup';
import { beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Word } from '../src/models/types';
import { buildStudyQueue, FAILURE_DELAY, nextWordReview, wordStudyState } from '../src/utils/wordStudy';
import { buildWordTour } from '../src/utils/wordCards';
import { buildWorkoutQueue } from '../src/utils/workout';
import { captureKnowledgeUndo } from '../src/utils/wordProgress';
import { createDefaultProgress } from '../src/store/progressTypes';
import { useStore } from '../src/store/useStore';

const now = Date.parse('2026-11-01T12:00:00Z');
const DAY = 86400000;
const word = (key: string, patch: Partial<Word> = {}): Word => ({ eng: key,
  translations: { en: key, it: `it-${key}` }, count: 0, is_learned: 0, ...patch });
const options = { activeLanguages: ['en', 'it'], workoutWordCount: 10, workoutFavoritesOnly: false };
beforeEach(() => { useStore.getState().importProgress(createDefaultProgress()); });

it('advances intervals only for successful recall when due, and resets after failure', () => {
  let review = nextWordReview(undefined, true, now);
  assert.equal(Date.parse(review.dueAt), now + DAY);
  const early = nextWordReview(review, true, now + 1000);
  assert.equal(early.streak, 1);
  assert.equal(early.dueAt, review.dueAt);
  for (const days of [3, 7, 14, 30, 60, 60]) {
    const at = Date.parse(review.dueAt);
    review = nextWordReview(review, true, at);
    assert.equal(Date.parse(review.dueAt), at + days * DAY);
  }
  review = nextWordReview(review, false, now);
  assert.equal(review.streak, 0);
  assert.equal(review.lapses, 1);
  assert.equal(Date.parse(review.dueAt), now + FAILURE_DELAY);
  assert.equal(nextWordReview(review, true, now + FAILURE_DELAY).streak, 1);
});

it('prioritizes difficult words without starving new words or maintenance', () => {
  const words = [
    ...Array.from({ length: 40 }, (_, i) => word(`failed-${i}`, { knowledge_stats: { en: false, it: false } })),
    ...Array.from({ length: 200 }, (_, i) => word(`new-${i}`)),
    ...Array.from({ length: 40 }, (_, i) => word(`known-${i}`, { knowledge_stats: { en: true, it: true } })),
  ];
  const queue = buildWorkoutQueue({ ...options, words }, now, () => 0.5);
  assert.equal(queue.length, 10);
  assert.equal(queue.filter(c => c.word.eng!.startsWith('failed')).length, 6);
  assert.equal(queue.filter(c => c.word.eng!.startsWith('new')).length, 2);
  assert.equal(queue.filter(c => c.word.eng!.startsWith('known')).length, 2);
  const cards = buildWordTour(words, ['en', 'it'], 10, now, () => 0.5);
  assert.equal(cards.filter(w => w.eng!.startsWith('failed')).length, 8);
  assert.equal(cards.filter(w => w.eng!.startsWith('new')).length, 2);
});

it('never repeats a word across languages or repeats the same visible form in a tour', () => {
  const words = [word('technique'), word('alias', { translations: { en: 'technique', it: 'it-technique' } }), word('other')];
  for (const mode of ['words', 'workout'] as const) {
    const queue = buildStudyQueue({ words, languages: ['en', 'it'], count: 10, mode }, now, () => 0.5);
    assert.equal(new Set(queue.map(c => c.word.eng)).size, queue.length);
    assert.ok(queue.length <= words.length);
    const forms = queue.map(c => `${c.langCode}:${c.word.translations![c.langCode]}`);
    assert.equal(new Set(forms).size, forms.length);
  }
  assert.equal(buildWordTour([word('only')], ['en'], 10).length, 1);
  assert.equal(buildWorkoutQueue({ ...options, words: [word('only')] }).length, 1);
});

it('ready words of any category precede recent words, regardless of the legacy known quota', () => {
  const recent = word('recent', { knowledge_stats: { en: true },
    review_by_lang: { en: nextWordReview(undefined, true, now) } });
  const queue = buildWorkoutQueue({ ...options, activeLanguages: ['en'], workoutWordCount: 1,
    workoutLearnedWordCount: 100, words: [recent, word('unseen')] }, now, () => 0.5);
  assert.equal(queue[0].word.eng, 'unseen');
});

it('chooses the weak language of a word, rotates equally needy languages, and respects snooze', () => {
  const mixed = word('mixed', { knowledge_stats: { en: true, it: false } });
  assert.equal(buildWorkoutQueue({ ...options, words: [mixed] }, now)[0].langCode, 'it');
  const queue = buildWorkoutQueue({ ...options,
    words: Array.from({ length: 10 }, (_, i) => word(`w-${i}`)) }, now, () => 0.5);
  assert.equal(queue.filter(c => c.langCode === 'en').length, 5);
  const snoozed = word('later', { snoozed_until_by_lang: { it: new Date(now + DAY).toISOString() } });
  assert.equal(buildWordTour([snoozed], ['en', 'it'], 10, now).length, 0);
  assert.deepEqual(buildWorkoutQueue({ ...options, words: [snoozed] }, now).map(c => c.langCode), ['en']);
});

it('word readiness uses answer due dates, including failures due later today, not exposure counts', () => {
  const failed = word('failed', { knowledge_stats: { en: false },
    review_by_lang: { en: nextWordReview(undefined, false, now) } });
  assert.equal(wordStudyState(failed, 'en', now).ready, false);
  assert.equal(wordStudyState(failed, 'en', now + FAILURE_DELAY).ready, true);
  const known = word('known', { knowledge_stats: { en: true }, show_stats: { en: 1 },
    review_by_lang: { en: nextWordReview(undefined, true, now) } });
  assert.equal(wordStudyState(known, 'en', now + FAILURE_DELAY).ready, false);
  assert.equal(wordStudyState({ ...known, show_stats: { en: 1000 } }, 'en', now + DAY).ready, true);
  assert.equal(buildWorkoutQueue({ ...options, activeLanguages: ['en'], words: [failed, known] }, now + FAILURE_DELAY)[0].word.eng, 'failed');
});

it('reading a translation preserves the answer schedule; undo preserves visits and later answers', () => {
  const store = useStore.getState();
  store.setLanguages(['en']);
  store.addCustomWord(word('schedule-test'));
  const getWord = () => useStore.getState().words.find(w => w.eng === 'schedule-test')!;
  const undo = captureKnowledgeUndo(getWord(), ['en'], false);
  store.markWordKnown('schedule-test', 'en', false);
  undo.reviewsApplied = getWord().review_by_lang;
  const review = getWord().review_by_lang;
  store.recordTripleCardShow('schedule-test');
  assert.deepEqual(getWord().review_by_lang, review);
  store.undoWordKnowledge('schedule-test', undo);
  assert.equal(getWord().review_by_lang?.en, undefined);
  assert.equal(getWord().count, 1);
  assert.equal(wordStudyState(getWord(), 'en').kind, 'weak');
  store.markWordKnown('schedule-test', 'en', false);
  store.markWordKnown('schedule-test', 'en', false);
  const later = getWord().review_by_lang;
  store.undoWordKnowledge('schedule-test', undo);
  assert.deepEqual(getWord().review_by_lang, later);
});

it('schedules survive backup round trips, reject malformed data, and clear with statistics', () => {
  const store = useStore.getState();
  store.addCustomWord(word('schedule-backup'));
  store.markWordKnown('schedule-backup', 'en', true);
  const saved = store.exportProgress();
  assert.equal(store.importProgress(saved).ok, true);
  assert.deepEqual(useStore.getState().userWordProgress['schedule-backup'].review_by_lang,
    saved.userWordProgress['schedule-backup'].review_by_lang);
  const broken = structuredClone(saved);
  broken.userWordProgress['schedule-backup'].review_by_lang!.en.streak = -1;
  assert.equal(store.importProgress(broken).ok, false);
  store.resetStatistics();
  assert.equal(useStore.getState().words.find(w => w.eng === 'schedule-backup')?.review_by_lang, undefined);
});
