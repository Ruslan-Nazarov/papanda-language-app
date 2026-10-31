import { it } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkoutQueue } from '../src/utils/workout';
import type { Word } from '../src/models/types';

const words: Word[] = Array.from({ length: 30 }, (_, index): Word => ({
  eng: `word-${index}`, translations: { en: `word-${index}`, it: `parola-${index}` }, count: 0, is_learned: 0,
  knowledge_stats: index < 10 ? { en: true } : index < 20 ? { en: false } : {},
}));
const options = { words, activeLanguages: ['en'], workoutWordCount: 10, workoutLearnedWordCount: 3, workoutFavoritesOnly: false };

it('caps total even when requested learned slots exceed it', () => {
  const queue = buildWorkoutQueue({ ...options, workoutWordCount: 5, workoutLearnedWordCount: 20 });
  assert.equal(queue.length, 5);
  assert.equal(new Set(queue.map(item => item.word.eng)).size, 5);
});

it('reserves new words alongside failures and known words', () => {
  const queue = buildWorkoutQueue(options, 0, () => 0.5);
  assert.equal(queue.length, 10);
  assert.ok(queue.some(item => Number(item.word.eng!.split('-')[1]) >= 20));
  assert.ok(queue.some(item => Number(item.word.eng!.split('-')[1]) < 10));
});

it('filters missing translations, snoozes and favorites without mutating input', () => {
  const items = [
    { ...words[0], is_favorite: true, snoozed_until_by_lang: { en: '2030-01-01' } },
    { ...words[1], is_favorite: true },
    { ...words[2], is_favorite: false },
  ];
  const original = JSON.stringify(items);
  const queue = buildWorkoutQueue({ ...options, words: items, activeLanguages: ['en', 'kz'], workoutFavoritesOnly: true }, Date.parse('2026-01-01'));
  assert.equal(queue.length, 1);
  assert.equal(queue[0].word.eng, words[1].eng);
  assert.equal(JSON.stringify(items), original);
});

it('prioritizes learned words not shown today over words already shown today', () => {
  const now = new Date(2026, 9, 30, 10, 0, 0).getTime();
  const todayIso = new Date(now).toISOString();
  const pastIso = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

  const testWords: Word[] = [
    // Word shown today 4 times (like in the user screenshot)
    {
      eng: 'word-today',
      translations: { en: 'word-today' },
      count: 4,
      is_learned: 1,
      knowledge_stats: { en: true },
      show_stats: { en: 4 },
      last_shown_by_lang: { en: todayIso },
    },
    // Word not shown today (due for review)
    {
      eng: 'word-past',
      translations: { en: 'word-past' },
      count: 2,
      is_learned: 1,
      knowledge_stats: { en: true },
      show_stats: { en: 2 },
      last_shown_by_lang: { en: pastIso },
    },
  ];

  const queue = buildWorkoutQueue({
    words: testWords,
    activeLanguages: ['en'],
    workoutWordCount: 1,
    workoutLearnedWordCount: 1,
    workoutFavoritesOnly: false,
  }, now, () => 0.1);

  assert.equal(queue.length, 1);
  assert.equal(queue[0].word.eng, 'word-past');
});

it('consecutive workouts rotate through different words without repeating same cards', () => {
  const now = new Date(2026, 9, 30, 10, 0, 0).getTime();
  const catalog: Word[] = Array.from({ length: 40 }, (_, index): Word => ({
    eng: `vocab-${index}`,
    translations: { en: `vocab-${index}` },
    count: 0,
    is_learned: index < 20 ? 1 : 0,
    knowledge_stats: index < 20 ? { en: true } : {},
    show_stats: {},
  }));

  // Session 1: pick 10 words
  const session1 = buildWorkoutQueue({
    words: catalog,
    activeLanguages: ['en'],
    workoutWordCount: 10,
    workoutLearnedWordCount: 5,
    workoutFavoritesOnly: false,
  }, now, () => 0.5);

  assert.equal(session1.length, 10);
  const session1Keys = new Set(session1.map(item => item.word.eng));

  // Simulate user completing Session 1: mark all 10 words as shown today
  const updatedCatalog = catalog.map(w => {
    if (session1Keys.has(w.eng)) {
      return {
        ...w,
        count: w.count + 1,
        show_stats: { en: 1 },
        last_shown_by_lang: { en: new Date(now).toISOString() },
      };
    }
    return w;
  });

  // Session 2: immediately after session 1
  const session2 = buildWorkoutQueue({
    words: updatedCatalog,
    activeLanguages: ['en'],
    workoutWordCount: 10,
    workoutLearnedWordCount: 5,
    workoutFavoritesOnly: false,
  }, now + 60000, () => 0.5);

  assert.equal(session2.length, 10);

  // None of the words from session 1 should be repeated in session 2!
  for (const item of session2) {
    assert.equal(
      session1Keys.has(item.word.eng),
      false,
      `Word ${item.word.eng} was repeated in consecutive workout!`,
    );
  }
});

it('prioritizes overdue words with decayed retention over words with low shows', () => {
  const now = new Date(2026, 9, 30, 12, 0, 0).getTime();
  const wordWellPracticedOverdue: Word = {
    eng: 'overdue-practiced',
    translations: { en: 'overdue-practiced' },
    count: 15,
    is_learned: 1,
    knowledge_stats: { en: true },
    show_stats: { en: 15 },
    last_shown_by_lang: { en: new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString() }, // 60 days ago
  };
  const wordFewShowsRecent: Word = {
    eng: 'few-shows-recent',
    translations: { en: 'few-shows-recent' },
    count: 1,
    is_learned: 1,
    knowledge_stats: { en: true },
    show_stats: { en: 1 },
    last_shown_by_lang: { en: new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString() }, // yesterday
  };

  const queue = buildWorkoutQueue({
    words: [wordFewShowsRecent, wordWellPracticedOverdue],
    activeLanguages: ['en'],
    workoutWordCount: 1,
    workoutLearnedWordCount: 1,
    workoutFavoritesOnly: false,
  }, now, () => 0.0);

  assert.equal(queue.length, 1);
  assert.equal(queue[0].word.eng, 'overdue-practiced');
});
