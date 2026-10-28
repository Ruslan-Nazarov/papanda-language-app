import type { Sentence } from '../models/types';

/** Remembers a random sort key per sentence id so the queue order is random but stable. */
export interface QueueOrder { keys: Map<string, number>; batch: number }
export const createQueueOrder = (): QueueOrder => ({ keys: new Map(), batch: 0 });

/** Fresh AI cards replace the seed fallback, but never the learner's saved/edited cards. */
export function trainerPool(sentences: Sentence[], sessionStart: number) {
  const standalone = sentences.filter(sentence => sentence.chainStep === undefined);
  const generated = standalone.filter(sentence => sentence.source === 'generated');
  const session = generated.filter(sentence => (sentence.createdAt ?? 0) >= sessionStart);
  const active = session.length ? session : generated;
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
 */
export function selectTrainerQueue(pool: Sentence[], order: QueueOrder, random: () => number = Math.random): Sentence[] {
  const cards = pool.filter(sentence => sentence.chainStep === undefined);
  if (cards.some(sentence => !order.keys.has(sentence.id))) {
    const base = ++order.batch;
    for (const sentence of cards) if (!order.keys.has(sentence.id)) order.keys.set(sentence.id, base + random() * 0.99);
  }
  return [...cards].sort((a, b) => order.keys.get(a.id)! - order.keys.get(b.id)!);
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
