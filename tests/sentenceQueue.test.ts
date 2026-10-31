import { it } from 'node:test';
import assert from 'node:assert/strict';
import type { Sentence } from '../src/models/types';
import { createQueueOrder, selectTrainerQueue, selectWorkoutBatch, trainerPool, trimGeneratedCache } from '../src/utils/sentenceQueue';

const card = (id: string, extra: Partial<Sentence> = {}): Sentence => ({ id, language: 'English', sentence: id, words: [], ...extra });

it('queue excludes series members and keeps order stable when cards arrive later', () => {
  const order = createQueueOrder();
  const first = selectTrainerQueue([card('a'), card('b'), card('c'), card('s0', { chainStep: 0 })], order);
  assert.deepEqual(first.map(item => item.id).sort(), ['a', 'b', 'c']);
  const second = selectTrainerQueue([card('d'), card('e'), ...first], order);
  assert.deepEqual(second.slice(0, 3).map(item => item.id), first.map(item => item.id));
  assert.deepEqual(second.slice(3).map(item => item.id).sort(), ['d', 'e']);
});

it('queue never falls back to series members', () => {
  const queue = selectTrainerQueue([card('s0', { chainStep: 0 }), card('s1', { chainStep: 1 })], createQueueOrder());
  assert.equal(queue.length, 0);
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

it('cached workshop chains cannot hide standalone generated cards or seed fallback', () => {
  const series = card('s0', { source: 'generated', chainStep: 0, createdAt: 200 });
  const seed = card('seed');
  const manual = card('saved', { source: 'manual' });
  const fallback = trainerPool([series, seed, manual], 100);
  assert.deepEqual(fallback.pool.map(item => item.id), ['seed', 'saved']);
  assert.equal(fallback.showingGenerated, false);
  assert.equal(fallback.generated.length, 0);
  const old = card('old', { source: 'generated', createdAt: 50 });
  assert.deepEqual(trainerPool([series, seed, manual, old], 100).pool.map(item => item.id), ['old', 'saved']);
});

it('selectWorkoutBatch selects specified batch size and wraps around on offset', () => {
  const cards = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'].map(id => card(id));
  const batch1 = selectWorkoutBatch(cards, 5, 0);
  assert.equal(batch1.length, 5);
  assert.deepEqual(batch1.map(c => c.id), ['s1', 's2', 's3', 's4', 's5']);

  const batch2 = selectWorkoutBatch(cards, 5, 5);
  assert.equal(batch2.length, 5);
  assert.deepEqual(batch2.map(c => c.id), ['s6', 's7', 's1', 's2', 's3']);
});

it('selectWorkoutBatch handles pool smaller than target count without duplication', () => {
  const cards = ['s1', 's2', 's3'].map(id => card(id));
  const batch = selectWorkoutBatch(cards, 5, 0);
  assert.equal(batch.length, 3);
  assert.deepEqual(batch.map(c => c.id), ['s1', 's2', 's3']);
  assert.deepEqual(selectWorkoutBatch([], 5), []);
  assert.deepEqual(selectWorkoutBatch(cards, 0), []);
});

it('trainerPool keeps cached AI cards alongside fresh session cards and prioritizes session cards in queue', () => {
  const order = createQueueOrder();
  const cached = ['c1', 'c2', 'c3', 'c4', 'c5'].map(id => card(id, { source: 'generated', createdAt: 50 }));
  const initialPool = trainerPool(cached, 100);
  const initialQueue = selectTrainerQueue(initialPool.pool, order, () => 0.5, 100);
  assert.deepEqual(initialQueue.map(c => c.id), ['c1', 'c2', 'c3', 'c4', 'c5']);

  const session = ['n1', 'n2', 'n3', 'n4'].map(id => card(id, { source: 'generated', createdAt: 150 }));
  const updatedPool = trainerPool([...cached, ...session], 100);
  const updatedQueue = selectTrainerQueue(updatedPool.pool, order, () => 0.5, 100);
  assert.equal(updatedQueue.length, 9);
  assert.deepEqual(updatedQueue.slice(0, 4).map(c => c.id), ['n1', 'n2', 'n3', 'n4']);
  // A 5-sentence workout takes the 4 fresh cards plus 1 from cache.
  const workout1 = selectWorkoutBatch(updatedQueue, 5, 0);
  assert.deepEqual(workout1.map(c => c.id), ['n1', 'n2', 'n3', 'n4', 'c1']);
  // Next workout while new cards are still generating takes unseen cards from cache.
  const seen = new Set(workout1.map(c => c.id));
  const workout2 = selectWorkoutBatch(updatedQueue, 5, 5, seen);
  assert.deepEqual(workout2.map(c => c.id), ['c2', 'c3', 'c4', 'c5', 'n1']);
});
