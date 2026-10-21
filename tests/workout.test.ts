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
