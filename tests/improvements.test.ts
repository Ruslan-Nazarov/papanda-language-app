import './setup';
import { beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useStore } from '../src/store/useStore';
import { createDefaultProgress } from '../src/store/progressTypes';
import { parseProgress } from '../src/store/progressValidation';
import { previewBackup, MAX_BACKUP_BYTES } from '../src/services/backupFormat';
import { importWithRestorePoint, restoreBeforeImport } from '../src/services/progressRestore';
import { baseStaticWords, baseStaticSentences } from '../src/store/catalog';
import { buildReviewPlan, isDueForReview } from '../src/utils/reviewPlan';
import { buildWorkoutQueue } from '../src/utils/workout';
import { sentenceFingerprint, tokensMatchSentence } from '../src/utils/sentenceValidation';
import type { Word } from '../src/models/types';

beforeEach(() => { useStore.getState().importProgress(createDefaultProgress()); });

it('migrates the empty legacy key without losing newer counters, edits or timestamps', () => {
  const data = createDefaultProgress();
  data.userWordProgress = {
    '': { count: 8, show_stats: { it: 8 }, last_shown: '2026-09-01', last_shown_by_lang: { it: '2026-09-01' }, custom_ru: 'мой перевод', is_favorite: true },
    blind: { count: 2, show_stats: { it: 2, en: 3 }, last_shown: '2026-10-01', last_shown_by_lang: { it: '2026-10-01' }, knowledge_stats: { en: true } },
  };
  const migrated = parseProgress(data).userWordProgress;
  assert.equal(migrated[''], undefined);
  assert.equal(migrated.blind.count, 8);
  assert.deepEqual(migrated.blind.show_stats, { it: 8, en: 3 });
  assert.equal(migrated.blind.last_shown_by_lang?.it, '2026-10-01');
  assert.equal(migrated.blind.custom_ru, 'мой перевод');
  assert.equal(migrated.blind.is_favorite, true);
  assert.ok(data.userWordProgress[''], 'caller data must remain detached');
});

it('previews collisions without writes and applies the last custom definition only once', () => {
  const data = createDefaultProgress();
  const word = baseStaticWords[0];
  data.customWords = [{ ...word, ru: 'первый' }, { ...word, ru: 'последний' }];
  const before = useStore.getState();
  const preview = previewBackup(JSON.stringify({ app: 'papanda', version: 1, data }));
  assert.equal(preview.conflicts, 2);
  assert.equal(preview.customWords, 1);
  assert.equal(useStore.getState(), before);
  useStore.getState().importProgress(preview.data);
  const matches = useStore.getState().words.filter(item => item.eng === word.eng);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].ru, 'последний');
});

it('rejects incompatible, oversized and malformed backup payloads before writes', () => {
  const before = useStore.getState();
  for (const raw of ['null', '{', '{"app":"other","version":1}', '{"app":"papanda","version":2}', '{"app":"papanda","version":1,"data":{}}']) assert.throws(() => previewBackup(raw));
  assert.throws(() => previewBackup('я'.repeat(MAX_BACKUP_BYTES / 2 + 1)), /10 МБ/);
  assert.equal(useStore.getState(), before);
});

it('keeps the current progress if the recovery snapshot cannot be saved', async () => {
  const original = AsyncStorage.setItem;
  const before = useStore.getState();
  AsyncStorage.setItem = async () => { throw new Error('Disk full'); };
  try { await assert.rejects(importWithRestorePoint(createDefaultProgress()), /Disk full/); }
  finally { AsyncStorage.setItem = original; }
  assert.equal(useStore.getState(), before);
});

it('saves old progress before import and restores it repeatedly across hydration', async () => {
  const originalGet = AsyncStorage.getItem, originalSet = AsyncStorage.setItem;
  const storage = new Map<string, string>();
  AsyncStorage.setItem = async (key, value) => { storage.set(key, value); };
  AsyncStorage.getItem = async key => storage.get(key) ?? null;
  try {
    useStore.getState().setWorkoutWordCount(7);
    const next = createDefaultProgress(); next.workoutWordCount = 20;
    await importWithRestorePoint(next);
    assert.equal(useStore.getState().workoutWordCount, 20);
    useStore.getState().initializeStore();
    await restoreBeforeImport();
    assert.equal(useStore.getState().workoutWordCount, 7);
    useStore.getState().setWorkoutWordCount(15);
    await restoreBeforeImport();
    assert.equal(useStore.getState().workoutWordCount, 7);
  } finally { AsyncStorage.getItem = originalGet; AsyncStorage.setItem = originalSet; }
});

it('serializes imports while a recovery write is pending', async () => {
  const original = AsyncStorage.setItem;
  let release!: () => void;
  AsyncStorage.setItem = async key => { if (key === 'papanda-before-import') await new Promise<void>(resolve => { release = resolve; }); };
  try {
    const first = importWithRestorePoint(createDefaultProgress());
    await assert.rejects(importWithRestorePoint(createDefaultProgress()), /Дождитесь/);
    release(); await first;
  } finally { AsyncStorage.setItem = original; }
});

const now = new Date(2026, 9, 9, 12).getTime();
const due: Word = { eng: 'book', ru: 'книга', count: 4, is_learned: 0, show_stats: { en: 4 }, knowledge_stats: { en: false }, last_shown_by_lang: { en: '2026-09-01' } };
it('review plan excludes new, snoozed, untranslated and already shown today entries', () => {
  const words = [due,
    { ...due, eng: 'today', last_shown_by_lang: { en: new Date(now).toISOString() } },
    { ...due, eng: 'snoozed', snoozed_until_by_lang: { en: new Date(now + 86400000).toISOString() } },
    { ...due, eng: 'fresh', show_stats: {} },
    { ...due, eng: 'user:la:test', word: 'test', source_language: 'la' },
  ];
  assert.deepEqual(buildReviewPlan(words, ['en'], now).map(item => item.word.eng), ['book']);
  const queue = buildWorkoutQueue({ words, activeLanguages: ['en'], workoutWordCount: 10, workoutLearnedWordCount: 5, workoutFavoritesOnly: false, workoutReviewOnly: true }, now);
  assert.deepEqual(queue.map(item => item.word.eng), ['book']);
  assert.equal(isDueForReview(due, 'it', now), false);
});

it('restores previously hidden cards from legacy backups without keeping reports', () => {
  const sentence = { ...baseStaticSentences[0], id: 'reported', sentence: 'Unique reported card', source: 'generated' as const };
  const key = sentenceFingerprint(sentence.language, sentence.sentence);
  const legacy = { ...createDefaultProgress(), sentenceReports: {
    [key]: { sentence, reason: 'Проверить перевод', tokenIndex: 0, reportedAt: '2026-10-01' },
  } };
  assert.equal(useStore.getState().importProgress(legacy).ok, true);
  assert.ok(useStore.getState().sentences.some(item => item.id === sentence.id));
  const backup = useStore.getState().exportProgress();
  assert.equal('sentenceReports' in backup, false);
  assert.equal('sentenceReports' in useStore.getState(), false);
  assert.equal(useStore.getState().importProgress(backup).ok, true);
  assert.equal(useStore.getState().sentences.filter(item => item.id === sentence.id).length, 1);
  assert.equal(Object.keys(legacy.sentenceReports).length, 1, 'migration leaves caller data untouched');
});

it('legacy reports preserve current edits and do not duplicate seeds or cached cards', () => {
  const seed = baseStaticSentences[0];
  const cached = { ...seed, id: 'cached-card', sentence: 'Unique cached card' };
  const edited = { ...seed, sentence: 'My updated card' };
  const progress = parseProgress({ ...createDefaultProgress(), customSentences: [edited], generatedSentences: [cached],
    sentenceReports: Object.fromEntries([seed, cached, { ...cached, id: 'cached-copy' }].map(sentence => [sentence.id,
      { sentence, reason: 'Old report', reportedAt: '2026-10-01' }])) });
  assert.deepEqual(progress.customSentences, [edited]);
  assert.deepEqual(progress.generatedSentences, [cached]);
  assert.equal('sentenceReports' in progress, false);
});

it('migrates hidden cards during storage hydration and rewrites storage without reports', async () => {
  const originalGet = AsyncStorage.getItem, originalSet = AsyncStorage.setItem;
  const sentence = { ...baseStaticSentences[0], id: 'hidden-on-device', sentence: 'Previously hidden card' };
  const legacy = { ...createDefaultProgress(), sentenceReports: {
    legacy: { sentence, reason: 'Old report', reportedAt: '2026-10-01' },
  } };
  let stored = JSON.stringify({ state: legacy, version: 0 });
  AsyncStorage.getItem = async () => stored;
  AsyncStorage.setItem = async (_key, value) => { stored = value; };
  try {
    await useStore.persist.rehydrate();
    assert.ok(useStore.getState().sentences.some(card => card.id === sentence.id));
    assert.equal('sentenceReports' in JSON.parse(stored).state, false);
    assert.ok(JSON.parse(stored).state.customSentences.some((card: { id: string }) => card.id === sentence.id));
  } finally { AsyncStorage.getItem = originalGet; AsyncStorage.setItem = originalSet; }
});

it('offline additions cover their complete written text', () => {
  for (const card of baseStaticSentences.filter(card => card.id.startsWith('offline_'))) {
    assert.ok(tokensMatchSentence(card.sentence, card.words), card.id);
    assert.ok(card.words.every(token => token.translation && token.dictionary_form), card.id);
  }
});
