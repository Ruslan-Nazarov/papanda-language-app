import { it } from 'node:test';
import assert from 'node:assert/strict';
import type { Sentence } from '../src/models/types';
import { createQueueOrder, selectTrainerQueue, trimGeneratedCache } from '../src/utils/sentenceQueue';

const card = (id: string, extra: Partial<Sentence> = {}): Sentence => ({ id, language: 'English', sentence: id, words: [], ...extra });

it('queue excludes series members and keeps order stable when cards arrive later', () => {
  const order = createQueueOrder();
  const first = selectTrainerQueue([card('a'), card('b'), card('c'), card('s0', { chainStep: 0 })], order);
  assert.deepEqual(first.map(item => item.id).sort(), ['a', 'b', 'c']);
  const second = selectTrainerQueue([card('d'), card('e'), ...first], order);
  assert.deepEqual(second.slice(0, 3).map(item => item.id), first.map(item => item.id));
  assert.deepEqual(second.slice(3).map(item => item.id).sort(), ['d', 'e']);
});

it('queue falls back to series members when no stand-alone card exists', () => {
  const queue = selectTrainerQueue([card('s0', { chainStep: 0 }), card('s1', { chainStep: 1 })], createQueueOrder());
  assert.equal(queue.length, 2);
});

it('queue is actually shuffled', () => {
  const ids = Array.from({ length: 20 }, (_, index) => `x${index}`);
  const queue = selectTrainerQueue(ids.map(id => card(id)), createQueueOrder(), (() => { let n = 7; return () => (n = (n * 37 + 11) % 100) / 100; })());
  assert.notDeepEqual(queue.map(item => item.id), ids);
});

it('cache trimming drops series whose first step was evicted', () => {
  const list = [
    card('s1', { chainStep: 1, generationBatchId: 'b1' }), card('s2', { chainStep: 2, generationBatchId: 'b1' }),
    card('p'), card('t0', { chainStep: 0, generationBatchId: 'b2' }), card('t1', { chainStep: 1, generationBatchId: 'b2' }),
  ];
  assert.deepEqual(trimGeneratedCache(list, 10).map(item => item.id), ['p', 't0', 't1']);
  // Cut at 4: s2 survives the slice but its series lost step 0, so it is dropped too.
  assert.deepEqual(trimGeneratedCache(list, 4).map(item => item.id), ['p', 't0', 't1']);
  assert.deepEqual(trimGeneratedCache(list, 2).map(item => item.id), ['t0', 't1']);
});
