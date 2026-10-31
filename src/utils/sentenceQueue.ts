import type { Sentence } from '../models/types';

/** Remembers a random sort key per sentence id so the queue order is random but stable. */
export interface QueueOrder { keys: Map<string, number>; batch: number }
export const createQueueOrder = (): QueueOrder => ({ keys: new Map(), batch: 0 });

const CACHE_KEY_OFFSET = 1000;

/** Fresh AI cards are prioritized first, while cached AI cards and manual cards remain available; seeds are the fallback. */
export function trainerPool(sentences: Sentence[], sessionStart: number) {
  const standalone = sentences.filter(sentence => sentence.chainStep === undefined);
  const generated = standalone.filter(sentence => sentence.source === 'generated');
  const session = generated.filter(sentence => (sentence.createdAt ?? 0) >= sessionStart);
  const cached = generated.filter(sentence => (sentence.createdAt ?? 0) < sessionStart);
  const active = [...session, ...cached];
  const pool = active.length
    ? [...active, ...standalone.filter(sentence => sentence.source === 'manual')]
    : standalone.filter(sentence => sentence.source !== 'generated');
  return { generated, session, pool, showingGenerated: active.length > 0 };
}

/**
 * Cards for the main trainer: stand-alone sentences only (members of a growing
 * series belong to the Workshop task), in random order. Ids seen for the first
 * time get a key above every earlier one, so late arrivals are appended after
 * the cards already queued — the card on screen never moves under the learner.
 * When `sessionStart` is provided, fresh session cards sort ahead of older cached cards.
 */
export function selectTrainerQueue(pool: Sentence[], order: QueueOrder, random: () => number = Math.random, sessionStart?: number): Sentence[] {
  const cards = pool.filter(sentence => sentence.chainStep === undefined);
  if (cards.some(sentence => !order.keys.has(sentence.id))) {
    const base = ++order.batch;
    for (const sentence of cards) {
      if (!order.keys.has(sentence.id)) {
        const isCached = sessionStart !== undefined && (sentence.createdAt ?? 0) < sessionStart;
        order.keys.set(sentence.id, (isCached ? base + CACHE_KEY_OFFSET : base) + random() * 0.99);
      }
    }
  }
  return [...cards].sort((a, b) => order.keys.get(a.id)! - order.keys.get(b.id)!);
}

/**
 * Selects a batch of sentences for one workout session.
 * When `seenIds` is provided, prioritizes unseen sentences first (e.g. newly generated
 * or not yet practiced cached sentences) and wraps around to seen ones only if needed.
 * Otherwise takes up to `count` items starting from `offset`, wrapping around to the beginning.
 */
export function selectWorkoutBatch(queue: Sentence[], count: number, offset = 0, seenIds?: ReadonlySet<string>): Sentence[] {
  if (!queue.length || count <= 0) return [];
  const safeCount = Math.min(count, queue.length);
  if (seenIds && seenIds.size > 0) {
    const unseen = queue.filter(sentence => !seenIds.has(sentence.id));
    if (unseen.length >= safeCount) {
      return unseen.slice(0, safeCount);
    }
    const seen = queue.filter(sentence => seenIds.has(sentence.id));
    return [...unseen, ...seen.slice(0, safeCount - unseen.length)];
  }
  const start = ((offset % queue.length) + queue.length) % queue.length;
  if (start + safeCount <= queue.length) {
    return queue.slice(start, start + safeCount);
  }
  const head = queue.slice(start);
  const tail = queue.slice(0, safeCount - head.length);
  return [...head, ...tail];
}

/**
 * Keeps the newest `max` generated sentences. A series whose first step was cut
 * off can no longer be played (and is hidden from the trainer), so its leftover
 * steps are dropped instead of occupying the cache.
 */
export function trimGeneratedCache(list: Sentence[], max: number): Sentence[] {
  const kept = list.slice(-max);
  const rootBatches = new Set(kept.filter(item => item.chainStep === 0 && item.generationBatchId).map(item => item.generationBatchId));
  return kept.filter(item => item.chainStep === undefined || !item.generationBatchId || rootBatches.has(item.generationBatchId));
}
