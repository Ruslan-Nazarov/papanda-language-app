import './setup';
import { beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { useStore } from '../src/store/useStore';
import { createDefaultProgress } from '../src/store/progressTypes';
import { getWordKey, getWordTranslation } from '../src/utils/words';

beforeEach(() => { assert.equal(useStore.getState().importProgress(createDefaultProgress()).ok, true); });

it('rejects malformed imports atomically, including nested values', () => {
  const initial = useStore.getState();
  for (const value of [null, {}, [], { userWordProgress: [] }, { userWordProgress: { towel: { count: -1 } } },
    { userWordProgress: {}, customWords: [null] }, { userWordProgress: {}, customSentences: [{ words: [] }] },
    { userWordProgress: {}, activeLanguages: [5] }, { userWordProgress: {}, workoutWordCount: NaN }]) {
    assert.equal(useStore.getState().importProgress(value).ok, false);
    assert.equal(useStore.getState(), initial);
  }
});

it('keeps the progress key stable across rename, new progress and reload', () => {
  const word = useStore.getState().words[0];
  const key = getWordKey(word);
  useStore.getState().updateWordDetails(key, { word: 'renamed-word' });
  useStore.getState().incrementShowCount(key, 'en');
  useStore.getState().markWordKnown(key, 'en', true);
  const backup = useStore.getState().exportProgress();
  assert.equal(useStore.getState().importProgress(backup).ok, true);
  const restored = useStore.getState().words.find(item => getWordKey(item) === key)!;
  assert.equal(getWordTranslation(restored, 'en'), 'renamed-word');
  assert.equal(restored.count, 1);
  assert.deepEqual(restored.knowledge_stats, { en: true });
});

it('reset clears counters while preserving edits, favorites and associations', () => {
  const key = getWordKey(useStore.getState().words[0]);
  useStore.getState().updateWordDetails(key, { ru: 'перевод', personal_association: 'ассоциация' });
  useStore.getState().toggleWordFavorite(key);
  useStore.getState().incrementShowCount(key, 'en');
  useStore.getState().resetStatistics();
  const word = useStore.getState().words.find(item => getWordKey(item) === key)!;
  assert.equal(word.ru, 'перевод');
  assert.equal(word.personal_association, 'ассоциация');
  assert.equal(word.is_favorite, true);
  assert.equal(word.count, 0);
});

it('undo restores custom word translations and removes a newly added snooze', () => {
  const key = 'user:it:proprio-test';
  useStore.getState().addCustomWord({ eng: key, word: 'proprio', ru: 'свой', translations: { it: 'proprio' }, count: 0, is_learned: 0 });
  useStore.getState().snoozeWord(key, 'it', 7);
  useStore.getState().restoreWordProgress(key, null);
  const word = useStore.getState().words.find(item => item.eng === key)!;
  assert.equal(word.snoozed_until_by_lang, undefined);
  assert.equal(getWordTranslation(word, 'it'), 'proprio');
  useStore.getState().initializeStore();
  assert.deepEqual(useStore.getState().words.find(item => item.eng === key), word);
});

it('edited seed survives reload without duplicating its id', () => {
  const sentence = useStore.getState().sentences[0];
  useStore.getState().updateSentence(sentence.id, { ...sentence, sentence: 'Changed sentence.' });
  useStore.getState().initializeStore();
  const matches = useStore.getState().sentences.filter(item => item.id === sentence.id);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].sentence, 'Changed sentence.');
});

it('caps a single oversized batch in both persisted and displayed collections', () => {
  useStore.getState().addGeneratedSentences(Array.from({ length: 100 }, (_, index) => ({
    id: `batch-${index}`, language: 'English', sentence: `Unique sentence number ${index}`, words: [],
  })));
  assert.equal(useStore.getState().generatedSentences.length, 80);
  assert.equal(useStore.getState().sentences.filter(item => item.id.startsWith('batch-')).length, 80);
});

it('does not expose a foreign word persistence key as its English translation', () => {
  assert.equal(getWordTranslation({ eng: 'user:kz:сөз', word: 'сөз', source_language: 'kz', count: 0, is_learned: 0 }, 'en'), '');
});

it('clamps learned slots when total workout size decreases', () => {
  useStore.getState().setWorkoutLearnedWordCount(10);
  useStore.getState().setWorkoutWordCount(5);
  assert.equal(useStore.getState().workoutLearnedWordCount, 5);
});

it('export and import do not retain caller-owned references', () => {
  const data = useStore.getState().exportProgress();
  data.activeLanguages.push('invalid');
  assert.equal(useStore.getState().activeLanguages.includes('invalid'), false);
  const valid = createDefaultProgress();
  useStore.getState().importProgress(valid);
  valid.activeLanguages.push('invalid');
  assert.equal(useStore.getState().activeLanguages.includes('invalid'), false);
});
