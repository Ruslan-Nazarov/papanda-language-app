import './setup';
import { beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Sentence, Token } from '../src/models/types';
import { snapshotSentenceAnalysis, summarizeSentenceAnalyses } from '../src/utils/sentenceStatistics';
import { useStore } from '../src/store/useStore';
import { createDefaultProgress } from '../src/store/progressTypes';
import { parseProgress } from '../src/store/progressValidation';
import { previewBackup } from '../src/services/backupFormat';

const now = new Date(2026, 10, 1, 12).getTime();
const token = (text: string, label: string): Token => ({ text, label, role: 'Predicate', translation: '', is_in_my_dict: false });
const sentence: Sentence = { id: 'sample', language: 'English', sentence: 'She read and wrote.',
  words: [token('She', 'Pronoun'), token('read', 'Verb (Past)'), token('wrote', 'Verb (Past)')] };
beforeEach(() => { useStore.getState().importProgress(createDefaultProgress()); });

it('counts token occurrences separately from analyses, ranks forms, and filters languages and days', () => {
  const first = snapshotSentenceAnalysis(sentence, 'one', now);
  const repeat = snapshotSentenceAnalysis(sentence, 'two', now - 86400000);
  const italian = snapshotSentenceAnalysis({ ...sentence, language: 'Italiano', words: [token('letto', 'Participle')] }, 'three', now);
  const summary = summarizeSentenceAnalyses([first, repeat, italian], undefined, now);
  assert.equal(summary.total, 3);
  assert.equal(summary.unique, 2);
  assert.equal(summary.today, 2);
  assert.deepEqual(summary.forms.map(row => [row.title, row.count, row.sentences]), [
    ['Прошедшее время', 4, 2], ['Причастие', 1, 1],
  ]);
  assert.deepEqual(summary.forms[0].examples, ['read', 'wrote']);
  assert.equal(summary.categories[0].title, 'Местоимение');
  assert.equal(summarizeSentenceAnalyses([first, repeat, italian], 'Italiano', now).total, 1);
});

it('merges equivalent labels without counting an analysis twice and preserves unknown annotations', () => {
  const snapshot = snapshotSentenceAnalysis({ ...sentence, words: [
    token('one', 'Verb (Neg)'), token('two', ' verb (Negative) '), token('three', 'Verb (Passato prossimo)'), token('four', 'Verb'),
  ] }, 'one', now);
  const summary = summarizeSentenceAnalyses([snapshot], undefined, now);
  assert.deepEqual(summary.forms[0], { title: 'Отрицательная форма', form: true, count: 2, sentences: 1, examples: ['one', 'two'] });
  assert.equal(summary.forms[1].title, 'Passato prossimo');
  assert.equal(summary.categories[0].title, 'Глагол');
});

it('records once per presentation, allows a repeated analysis, and keeps snapshots after card changes or cache clearing', () => {
  const card = structuredClone(sentence);
  const store = useStore.getState();
  store.recordSentenceAnalysis(card, 'one');
  store.recordSentenceAnalysis(card, 'one');
  store.recordSentenceAnalysis(card, 'two');
  card.words[1].text = 'changed';
  card.words[1].label = 'Verb';
  store.clearGeneratedSentences();
  const analyses = useStore.getState().sentenceAnalyses;
  assert.equal(analyses.length, 2);
  assert.equal(analyses[0].labels[1].label, 'Verb (Past)');
  assert.deepEqual(analyses[0].labels[1].examples, ['read', 'wrote']);
});

it('round-trips history in backups and persisted fields and defaults legacy profiles to empty history', () => {
  useStore.getState().recordSentenceAnalysis(sentence, 'one');
  const exported = useStore.getState().exportProgress();
  const preview = previewBackup(JSON.stringify({ app: 'papanda', version: 1, data: exported }));
  assert.deepEqual(preview.data.sentenceAnalyses, exported.sentenceAnalyses);
  assert.deepEqual(useStore.persist.getOptions().partialize!(useStore.getState()).sentenceAnalyses, exported.sentenceAnalyses);
  assert.deepEqual(parseProgress({ userWordProgress: {} }).sentenceAnalyses, []);
  useStore.getState().resetStatistics();
  assert.deepEqual(useStore.getState().sentenceAnalyses, []);
  assert.equal(useStore.getState().importProgress(preview.data).ok, true);
  assert.deepEqual(useStore.getState().sentenceAnalyses, exported.sentenceAnalyses);
});

it('rejects malformed and duplicate history entries before changing user data', () => {
  const entry = snapshotSentenceAnalysis(sentence, 'one', now);
  for (const sentenceAnalyses of [[{ ...entry, createdAt: 'bad' }], [entry, entry],
    [{ ...entry, labels: [{ label: 'Verb', count: -1, examples: [] }] }]]) {
    const previous = useStore.getState();
    assert.equal(previous.importProgress({ userWordProgress: {}, sentenceAnalyses }).ok, false);
    assert.equal(useStore.getState(), previous);
  }
});

it('retains the last 500 analyses and ignores empty cards', () => {
  const sentenceAnalyses = Array.from({ length: 500 }, (_, index) => snapshotSentenceAnalysis(sentence, `${index}`, now));
  assert.equal(useStore.getState().importProgress({ userWordProgress: {}, sentenceAnalyses }).ok, true);
  useStore.getState().recordSentenceAnalysis({ ...sentence, words: [] }, 'empty');
  useStore.getState().recordSentenceAnalysis(sentence, 'new');
  const history = useStore.getState().sentenceAnalyses;
  assert.equal(history.length, 500);
  assert.equal(history[0].id, '1');
  assert.equal(history.at(-1)!.id, 'new');
});
