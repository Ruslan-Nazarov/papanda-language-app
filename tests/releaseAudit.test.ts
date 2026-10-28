import './setup';
import { before, beforeEach, afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useStore } from '../src/store/useStore';
import { useBookStore } from '../src/store/bookStore';
import { defaultBookProgress } from '../src/store/bookProgress';
import { createDefaultProgress } from '../src/store/progressTypes';
import { progressStorage, useStorageStatus } from '../src/services/progressStorage';
import { previewBackup } from '../src/services/backupFormat';
import { importWithRestorePoint, restoreBeforeImport } from '../src/services/progressRestore';
import { bookChapters } from '../src/services/bookService';
import { createQueueOrder, selectTrainerQueue, trainerPool } from '../src/utils/sentenceQueue';
import { baseStaticSentences } from '../src/store/catalog';
import { calculateIMWIndex, calculateShownToday } from '../src/utils/statistics';
import { localDateKey } from '../src/utils/date';

const disk = new Map<string, string>();
const originalGet = AsyncStorage.getItem, originalSet = AsyncStorage.setItem;
const place = { chapterId: bookChapters[0].id, blockId: bookChapters[0].blocks[0].id };
before(async () => { await Promise.all([useStore.persist.rehydrate(), useBookStore.persist.rehydrate()]); await progressStorage.flush(); });
beforeEach(async () => {
  disk.clear();
  AsyncStorage.getItem = async key => disk.get(key) ?? null;
  AsyncStorage.setItem = async (key, value) => { disk.set(key, value); };
  useStore.getState().importProgress(createDefaultProgress());
  useBookStore.getState().importProgress(defaultBookProgress());
  await progressStorage.retry();
});
afterEach(async () => {
  AsyncStorage.setItem = async (key, value) => { disk.set(key, value); };
  await progressStorage.retry();
  AsyncStorage.getItem = originalGet; AsyncStorage.setItem = originalSet;
});

it('backup preview and import round-trip book state; restore point restores both stores after hydration', async () => {
  useBookStore.getState().remember(place);
  useBookStore.getState().toggleBookmark(place);
  useBookStore.getState().setFontSize(21);
  useStore.getState().setWorkoutWordCount(7);
  const book = useBookStore.getState().exportProgress();
  const preview = previewBackup(JSON.stringify({ app: 'papanda', version: 1, data: createDefaultProgress(), book }));
  assert.deepEqual(preview.book, book);
  await importWithRestorePoint(preview.data, defaultBookProgress());
  assert.equal(useBookStore.getState().bookmarks.length, 0);
  await Promise.all([useStore.persist.rehydrate(), useBookStore.persist.rehydrate()]);
  await restoreBeforeImport();
  assert.equal(useStore.getState().workoutWordCount, 7);
  assert.deepEqual(useBookStore.getState().exportProgress(), book);
  assert.deepEqual(JSON.parse(disk.get('papanda-book-reader')!).state, book);
});

it('legacy backups preserve current book data and malformed book data changes nothing', async () => {
  useBookStore.getState().remember(place);
  const book = useBookStore.getState().exportProgress();
  const preview = previewBackup(JSON.stringify({ app: 'papanda', version: 1, data: createDefaultProgress() }));
  await importWithRestorePoint(preview.data, preview.book);
  assert.deepEqual(useBookStore.getState().exportProgress(), book);
  const before = useStore.getState();
  await assert.rejects(importWithRestorePoint(createDefaultProgress(), { ...book, bookmarks: [null] }), /Некорректные/);
  assert.equal(useStore.getState(), before);
  assert.deepEqual(useBookStore.getState().exportProgress(), book);
});

it('import cannot report success when the progress write fails; the recovery point remains usable', async () => {
  useStore.getState().setWorkoutWordCount(7);
  await progressStorage.flush();
  AsyncStorage.setItem = async (key, value) => {
    if (key === 'papanda-storage') throw new Error('Disk full');
    disk.set(key, value);
  };
  await assert.rejects(importWithRestorePoint(createDefaultProgress()), /Disk full/);
  assert.equal(useStore.getState().workoutWordCount, 7, 'failed import rolls back the visible state');
  assert.deepEqual(useStorageStatus.getState().failedKeys, ['papanda-storage']);
  assert.equal(JSON.parse(disk.get('papanda-before-import')!).data.workoutWordCount, 7);
  AsyncStorage.setItem = async (key, value) => { disk.set(key, value); };
  await restoreBeforeImport();
  assert.equal(JSON.parse(disk.get('papanda-storage')!).state.workoutWordCount, 7);
  assert.deepEqual(useStorageStatus.getState().failedKeys, []);
});

it('manual cards, legacy custom cards and saved Workshop steps survive AI cache, import and fresh batches', () => {
  const seed = baseStaticSentences[0];
  const data = createDefaultProgress();
  data.customSentences = [{ ...seed, id: 'legacy', source: undefined }, { ...seed, id: 'workshop', source: 'manual', chainStep: 2, generationBatchId: 'old' }];
  data.generatedSentences = [{ ...seed, id: 'ai-old', source: 'generated', createdAt: 10 }, { ...seed, id: 'ai-new', source: 'generated', createdAt: 100 }];
  useStore.getState().importProgress(data);
  const pool = trainerPool(useStore.getState().sentences, 50);
  const ids = selectTrainerQueue(pool.pool, createQueueOrder()).map(card => card.id).sort();
  assert.deepEqual(ids, ['ai-new', 'legacy', 'workshop']);
  assert.equal(useStore.getState().sentences.find(card => card.id === 'workshop')?.chainStep, undefined);
  assert.equal(data.customSentences[1].chainStep, 2, 'source data is not mutated');
});

it('a reader write failure rolls back both stores and retry persists the original snapshot', async () => {
  useStore.getState().setWorkoutWordCount(7);
  useBookStore.getState().remember(place);
  await progressStorage.flush();
  const book = useBookStore.getState().exportProgress();
  AsyncStorage.setItem = async (key, value) => {
    if (key === 'papanda-book-reader') throw new Error('Reader write failed');
    disk.set(key, value);
  };
  await assert.rejects(importWithRestorePoint(createDefaultProgress(), defaultBookProgress()), /Reader write failed/);
  assert.equal(useStore.getState().workoutWordCount, 7);
  assert.equal(JSON.parse(disk.get('papanda-storage')!).state.workoutWordCount, 7);
  assert.deepEqual(useBookStore.getState().exportProgress(), book);
  AsyncStorage.setItem = async (key, value) => { disk.set(key, value); };
  await progressStorage.retry();
  assert.deepEqual(JSON.parse(disk.get('papanda-book-reader')!).state, book);
});

it('calendar counters and memory decay use the same explicit time after a day change', () => {
  const day1 = new Date(2026, 9, 23, 23, 59).getTime();
  const day2 = new Date(2026, 9, 24, 0, 1).getTime();
  const shows = { [localDateKey(new Date(day1))]: 9 };
  assert.equal(calculateShownToday(shows, day1), 9);
  assert.equal(calculateShownToday(shows, day2), 0);
  const word = { eng: 'test', count: 10, is_learned: 0, show_stats: { en: 10 }, last_shown: new Date(day1).toISOString() };
  assert.ok(calculateIMWIndex([word], ['en'], day2).overall < calculateIMWIndex([word], ['en'], day1).overall);
});
