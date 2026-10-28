import './setup';
import { beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { useStore } from '../src/store/useStore';
import { createDefaultProgress } from '../src/store/progressTypes';
import { parseProgress } from '../src/store/progressValidation';
import { previewBackup } from '../src/services/backupFormat';
import { LANGUAGES } from '../src/constants/languages';
import { developmentExamples } from '../src/data/studyExamples';
import { SENTENCE_LESSON_EXPERIMENT, type SentenceLesson, type SentenceLessonProgress } from '../src/models/sentenceLessons';
import { advanceLesson, emptyLessonProgress, lessonGroups, nextLessonFocus, planSentenceLesson, sentenceLessonCatalog, summarizeLesson } from '../src/utils/sentenceLessons';

beforeEach(() => { assert.equal(useStore.getState().importProgress(createDefaultProgress()).ok, true); });
const catalog = () => useStore.getState().sentences;
const complete = (lesson: SentenceLesson, assisted = false): SentenceLesson => ({ ...lesson, items: lesson.items.map(item => {
  const groups = lessonGroups(item.sentence, lesson.focus);
  return { ...item, progress: { ...item.progress, step: groups.length, checked: false, outcomes: groups.map(group => ({
    role: group.role, result: 'correct' as const, hintLevel: assisted ? 2 : 0,
  })) } };
}) });

it('plans five distinct offline snapshots for each language without mixing languages or growing chains', () => {
  for (const language of LANGUAGES) {
    const chain = { ...catalog().find(item => item.language === language.label)!, id: 'excluded-chain', chainStep: 0 };
    const lesson = planSentenceLesson(language.code, [...catalog(), chain])!;
    assert.equal(lesson.items.length, 5, language.code);
    assert.equal(lesson.focus, 'core');
    assert.equal(new Set(lesson.items.map(item => item.sentence.sentence)).size, 5);
    assert.ok(lesson.items.every(item => item.sentence.language === language.label && item.sentence.id !== chain.id));
    assert.deepEqual(lesson.items.map(item => item.purpose), ['warmup', 'warmup', 'learn', 'practice', 'transfer']);
    assert.equal(lesson.items[2].progress.hint, 2);
    assert.equal(lesson.items[4].progress.hint, 0);
    const source = catalog().find(item => item.id === lesson.items[0].sentence.id);
    if (source) assert.notEqual(lesson.items[0].sentence.words, source.words);
  }
});

it('requires successful practice on different days before moving to the next available topic', () => {
  const lesson = complete(planSentenceLesson('en', catalog())!);
  const summary = summarizeLesson({ ...lesson, completedAt: '2026-10-20T12:00:00Z' });
  const pool = catalog().filter(item => item.language === 'English');
  const progress = { ...emptyLessonProgress(), history: [summary, { ...summary, id: 'second' }] };
  assert.equal(nextLessonFocus(pool, progress), 'core');
  progress.history[1] = { ...summary, id: 'second', day: '2026-10-21' };
  assert.equal(nextLessonFocus(pool, progress), 'attribute');
  progress.history[1] = { ...progress.history[1], focusIndependent: 0 };
  assert.equal(nextLessonFocus(pool, progress), 'core');
});

it('shows the planned topic even when only growing chains contain an unmastered construction', () => {
  const basics = catalog().filter(item => item.language === 'English' && lessonGroups(item, 'core').length === 2)
    .slice(0, 5).map(item => ({ ...item, words: item.words.filter(word => word.role === 'Predicate' || word.role === 'Subject') }));
  const chains = basics.slice(0, 3).map((item, index) => ({ ...item, id: `chain-${index}`, sentence: `chain ${index}`,
    chainStep: index, words: [...item.words, { ...item.words[0], role: 'Object' as const }] }));
  const summary = summarizeLesson({ ...complete(planSentenceLesson('en', basics)!), completedAt: '2026-10-20T12:00:00Z' });
  const history = (['core', 'attribute'] as const).flatMap(focus => [
    { ...summary, id: `${focus}-1`, focus, day: '2026-10-20' },
    { ...summary, id: `${focus}-2`, focus, day: '2026-10-21' },
  ]);
  const progress = { ...emptyLessonProgress(), history };
  const input = [...basics, ...chains];
  assert.equal(nextLessonFocus(input, progress), 'object', 'raw catalog offers a construction available only in chains');
  const eligible = sentenceLessonCatalog('en', input);
  assert.ok(eligible.every(item => item.chainStep === undefined && item.language === 'English'));
  assert.equal(nextLessonFocus(eligible, progress), planSentenceLesson('en', input, progress)!.focus);
  assert.equal(nextLessonFocus(eligible, progress), 'attribute');
});

it('trimming lesson history preserves the evidence that unlocked earlier topics', () => {
  const current = { ...complete(planSentenceLesson('en', catalog())!), position: 4 };
  const summary = summarizeLesson({ ...current, completedAt: '2026-01-01T12:00:00Z' });
  const history = [summary, { ...summary, id: 'next-day', day: '2026-01-02' }, ...Array.from({ length: 58 }, (_, index) => ({
    ...summary, id: `later-${index}`, focus: 'attribute' as const, focusIndependent: 0,
  }))];
  const progress = advanceLesson({ ...emptyLessonProgress(), history, current });
  assert.ok(progress.history.length <= 60);
  assert.equal(nextLessonFocus(catalog().filter(item => item.language === 'English'), progress), 'attribute');
});

it('limits overdue reviews to two slots and keeps new practice and a separate transfer example', () => {
  const first = planSentenceLesson('en', catalog())!;
  const progress = { ...emptyLessonProgress(), reviews: first.items.map(item => ({ sentence: item.sentence, dueAt: '2026-01-01T00:00:00Z', successes: 0, difficult: true })) };
  const lesson = planSentenceLesson('en', catalog(), progress)!;
  assert.deepEqual(lesson.items.slice(0, 2).map(item => item.purpose), ['repair', 'repair']);
  assert.ok(lesson.items.slice(2).every(item => !progress.reviews.some(review => review.sentence.sentence === item.sentence.sentence)));
  assert.equal(lesson.items[4].purpose, 'transfer');
  assert.equal(lesson.items.length, 5);
});

it('reserves the new construction for explanation, practice and transfer while reviewing an earlier topic', () => {
  const first = complete(planSentenceLesson('en', catalog())!);
  const summary = summarizeLesson({ ...first, completedAt: '2026-01-01T12:00:00Z' });
  const progress: SentenceLessonProgress = { ...emptyLessonProgress(), history: [summary, { ...summary, id: 'next-day', day: '2026-01-02' }] };
  const pool = catalog().filter(item => item.language === 'English');
  const hasAttribute = (sentence: typeof pool[number]) => lessonGroups(sentence, 'attribute').some(group => group.role.startsWith('Attribute'));
  const attributes = developmentExamples('en').slice(1);
  const basics = pool.filter(sentence => !hasAttribute(sentence) && lessonGroups(sentence, 'core').length === 2).slice(0, 5);
  assert.equal(attributes.length, 3);
  progress.reviews = [attributes[0], basics[0]].map(sentence => ({ sentence, dueAt: '2026-01-01T00:00:00Z', successes: 0, difficult: true }));
  const lesson = planSentenceLesson('en', [...attributes, ...basics], progress)!;
  assert.equal(lesson.focus, 'attribute');
  assert.equal(lesson.items[0].sentence.id, basics[0].id, 'repeat the earlier basis without consuming a reserved example');
  assert.ok(lesson.items.slice(2).every(item => hasAttribute(item.sentence)));
});

it('extends successful review intervals and removes previously scheduled disputed cards', () => {
  const first = complete(planSentenceLesson('en', catalog())!);
  const lastPosition = { ...first, position: 4 };
  let progress = advanceLesson({ ...emptyLessonProgress(), current: lastPosition });
  const review = progress.reviews[0];
  assert.equal(review.successes, 1);
  progress = advanceLesson({ ...progress, current: { ...lastPosition, id: 'second-lesson' } });
  assert.equal(progress.reviews[0].successes, 2);
  const secondDue = new Date(progress.reviews[0].dueAt);
  const secondCompleted = new Date(progress.current!.completedAt!);
  assert.ok(secondDue.getTime() - secondCompleted.getTime() >= 2.9 * 86400000);
  const disputed = complete(planSentenceLesson('en', catalog())!);
  disputed.items[0].sentence = review.sentence;
  const groups = lessonGroups(review.sentence, disputed.focus);
  disputed.items[0].progress.step = groups.length;
  disputed.items[0].progress.outcomes = groups.map(group => ({ role: group.role, result: 'disputed', hintLevel: 0 }));
  progress = advanceLesson({ ...progress, current: { ...disputed, position: 4 } });
  assert.ok(!progress.reviews.some(item => item.sentence.id === review.sentence.id));
});

it('skipping finishes a lesson without claiming independent success or unlocking a topic', () => {
  let progress: SentenceLessonProgress = { ...emptyLessonProgress(), current: planSentenceLesson('en', catalog()) };
  const now = new Date('2030-10-27T10:00:00Z');
  for (let i = 0; i < 5; i++) progress = advanceLesson(progress, true, now);
  assert.equal(progress.current!.position, 5);
  assert.equal(progress.history.length, 1);
  assert.equal(progress.history[0].independent, 0);
  assert.equal(progress.history[0].sentencesCompleted, 0);
  assert.equal(progress.history[0].sentencesSkipped, 5);
  assert.ok(progress.reviews.every(item => item.difficult && Date.parse(item.dueAt) > now.getTime()));
  assert.equal(advanceLesson(progress, true), progress);
});

it('ignores disputed annotations in scoring and repetition while retaining the visible result', () => {
  let lesson = complete(planSentenceLesson('en', catalog())!);
  lesson.items[0].progress.outcomes[0].result = 'disputed';
  lesson = { ...lesson, position: 4 };
  const progress = advanceLesson({ ...emptyLessonProgress(), current: lesson });
  assert.equal(progress.history[0].disputed, 1);
  assert.ok(!progress.reviews.some(review => review.sentence.id === lesson.items[0].sentence.id));
});

it('experiment gates changes, preserves paused steps and rejects duplicate or stale completion callbacks', () => {
  const store = useStore.getState();
  store.startSentenceLesson('en');
  assert.deepEqual(useStore.getState().sentenceLessons, {});
  store.startExperiment(SENTENCE_LESSON_EXPERIMENT);
  store.startSentenceLesson('en');
  const lesson = useStore.getState().sentenceLessons.en.current!;
  store.startSentenceLesson('en');
  assert.equal(useStore.getState().sentenceLessons.en.current, lesson);
  const checkpoint = { ...lesson.items[0].progress, selected: [0], hint: 1 };
  store.updateSentenceLesson('en', lesson.id, 0, checkpoint);
  store.stopExperiment(SENTENCE_LESSON_EXPERIMENT);
  const paused = useStore.getState().sentenceLessons;
  store.advanceSentenceLesson('en', lesson.id, 0, true);
  store.updateSentenceLesson('en', lesson.id, 0, { ...checkpoint, selected: [] });
  assert.equal(useStore.getState().sentenceLessons, paused);
  store.startExperiment(SENTENCE_LESSON_EXPERIMENT);
  store.startSentenceLesson('en');
  assert.deepEqual(useStore.getState().sentenceLessons.en.current!.items[0].progress, checkpoint);
  store.advanceSentenceLesson('en', lesson.id, 0);
  assert.equal(useStore.getState().sentenceLessons.en.current!.position, 0);
  store.advanceSentenceLesson('en', lesson.id, 0, true);
  store.advanceSentenceLesson('en', lesson.id, 0, true);
  assert.equal(useStore.getState().sentenceLessons.en.current!.position, 1);
  store.updateSentenceLesson('en', 'old-id', 1, checkpoint);
  assert.equal(useStore.getState().sentenceLessons.en.current!.position, 1);
});

it('backs up the exact checkpoint, resumes after rehydration, and clears learning results on statistics reset', async () => {
  const store = useStore.getState();
  store.startExperiment(SENTENCE_LESSON_EXPERIMENT);
  store.startSentenceLesson('en');
  const lesson = useStore.getState().sentenceLessons.en.current!;
  const group = lessonGroups(lesson.items[0].sentence, lesson.focus)[0];
  store.updateSentenceLesson('en', lesson.id, 0, { ...lesson.items[0].progress, selected: group.tokenIndices,
    checked: true, outcomes: [{ role: group.role, result: 'correct', hintLevel: 0 }] });
  const expected = store.exportProgress();
  const backup = previewBackup(JSON.stringify({ app: 'papanda', version: 1, data: expected }));
  assert.deepEqual(backup.data.sentenceLessons, expected.sentenceLessons);
  assert.equal(store.importProgress(backup.data).ok, true);
  const originalStorage = useStore.persist.getOptions().storage;
  useStore.persist.setOptions({ storage: { getItem: async () => ({ state: expected, version: 0 }), setItem: async () => {}, removeItem: async () => {} } });
  try {
    useStore.setState({ sentenceLessons: {} });
    await useStore.persist.rehydrate();
    assert.deepEqual(useStore.getState().sentenceLessons, expected.sentenceLessons);
  } finally { useStore.persist.setOptions({ storage: originalStorage }); }
  store.resetStatistics();
  assert.deepEqual(useStore.getState().sentenceLessons, {});
  assert.ok(useStore.getState().experiments[SENTENCE_LESSON_EXPERIMENT].runs.length);
});

it('rejects corrupt saved steps, foreign snapshots and positions atomically; old backups keep the experiment off', () => {
  const store = useStore.getState();
  store.startExperiment(SENTENCE_LESSON_EXPERIMENT);
  store.startSentenceLesson('en');
  const saved = store.exportProgress();
  for (const corrupt of [
    (lesson: SentenceLesson) => { lesson.position = 6; },
    (lesson: SentenceLesson) => { lesson.items[0].progress.step = 999; },
    (lesson: SentenceLesson) => { lesson.items[0].progress.selected = [999]; },
    (lesson: SentenceLesson) => { lesson.items[0].progress.checked = true; },
    (lesson: SentenceLesson) => { lesson.items[0].sentence.language = 'Italiano'; },
    (lesson: SentenceLesson) => { lesson.items[1] = lesson.items[0]; },
  ]) {
    const invalid = JSON.parse(JSON.stringify(saved));
    corrupt(invalid.sentenceLessons.en.current);
    const before = useStore.getState();
    assert.equal(store.importProgress(invalid).ok, false);
    assert.equal(useStore.getState(), before);
  }
  assert.deepEqual(parseProgress({ userWordProgress: {} }).sentenceLessons, {});
  assert.equal(store.importProgress({ userWordProgress: {} }).ok, true);
  assert.deepEqual(useStore.getState().experiments, {});
});

it('does not replace a pending lesson when starting an optional three-sentence extension', () => {
  const store = useStore.getState();
  store.startExperiment(SENTENCE_LESSON_EXPERIMENT);
  store.startSentenceLesson('en');
  const pending = useStore.getState().sentenceLessons.en.current!;
  store.startSentenceLesson('en', 3);
  assert.equal(useStore.getState().sentenceLessons.en.current, pending);
  for (let i = 0; i < 5; i++) store.advanceSentenceLesson('en', pending.id, i, true);
  store.startSentenceLesson('en', 3);
  const extension = useStore.getState().sentenceLessons.en.current!;
  assert.equal(extension.items.length, 3);
  assert.equal(extension.items[2].purpose, 'transfer');
  assert.notEqual(extension.id, pending.id);
  assert.doesNotThrow(() => parseProgress(store.exportProgress()));
});
