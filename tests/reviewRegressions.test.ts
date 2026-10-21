import './setup';
import { beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { useStore } from '../src/store/useStore';
import { createDefaultProgress } from '../src/store/progressTypes';
import { captureKnowledgeUndo } from '../src/utils/wordProgress';
import { buildWordLookup } from '../src/utils/words';
import { pickWordCard } from '../src/utils/wordCards';
import type { Word } from '../src/models/types';

beforeEach(() => { useStore.getState().importProgress(createDefaultProgress()); });
const sample: Word = { eng: 'test-card', ru: 'пример', translations: { en: 'example', it: 'esempio' },
  count: 0, is_learned: 0, knowledge_stats: {}, show_stats: {} };

it('undoing an answer preserves later edits, favourites, visits and other languages', () => {
  const store = useStore.getState();
  store.setLanguages(['en', 'it']);
  store.addCustomWord(sample);
  const undo = captureKnowledgeUndo(sample, ['en'], true);
  store.markWordKnown('test-card', 'en', true);
  assert.equal(useStore.getState().userWordProgress['test-card'].is_learned, 0);
  store.incrementShowCount('test-card', 'en');
  store.updateWordDetails('test-card', { ru: 'новый перевод', personal_association: 'моя ассоциация' });
  store.toggleWordFavorite('test-card');
  store.markWordKnown('test-card', 'it', true);
  assert.equal(useStore.getState().userWordProgress['test-card'].is_learned, 1);
  store.undoWordKnowledge('test-card', undo);
  const word = useStore.getState().words.find(word => word.eng === 'test-card')!;
  assert.deepEqual(word.knowledge_stats, { it: true });
  assert.equal(word.count, 1);
  assert.deepEqual(word.show_stats, { en: 1 });
  assert.equal(word.ru, 'новый перевод');
  assert.equal(word.personal_association, 'моя ассоциация');
  assert.equal(word.is_favorite, true);
  assert.equal(word.is_learned, 0);
  assert.equal(Object.values(useStore.getState().dailyShows)[0], 1);
});

it('undo does not overwrite a later different answer in the same language', () => {
  const store = useStore.getState();
  store.addCustomWord({ ...sample, knowledge_stats: { en: true } });
  const word = useStore.getState().words.find(word => word.eng === sample.eng)!;
  const undo = captureKnowledgeUndo(word, ['en'], false);
  store.markWordKnown('test-card', 'en', false);
  store.markWordKnown('test-card', 'en', true);
  store.undoWordKnowledge('test-card', undo);
  assert.equal(useStore.getState().userWordProgress['test-card'].knowledge_stats?.en, true);
});

it('imported custom-word progress survives its first edit and next presentation', () => {
  const data = createDefaultProgress();
  data.activeLanguages = ['en', 'it'];
  data.customWords = [{ ...sample, count: 7, show_stats: { en: 7, it: 4 }, knowledge_stats: { it: true } }];
  const store = useStore.getState();
  assert.equal(store.importProgress(data).ok, true);
  store.saveWordAssociation('test-card', 'связь');
  store.recordTripleCardShow('test-card');
  const word = useStore.getState().words.find(word => word.eng === sample.eng)!;
  assert.equal(word.count, 8);
  assert.deepEqual(word.show_stats, { en: 8, it: 5 });
  assert.deepEqual(word.knowledge_stats, { it: true });
  assert.equal(store.importProgress(store.exportProgress()).ok, true);
  assert.equal(useStore.getState().words.find(word => word.eng === sample.eng)?.count, 8);
});

it('reset and import invalidate local sessions without persisting the revision', () => {
  const store = useStore.getState();
  const revision = store.progressRevision;
  store.resetStatistics();
  assert.equal(useStore.getState().progressRevision, revision + 1);
  assert.equal(store.importProgress(store.exportProgress()).ok, true);
  assert.equal(useStore.getState().progressRevision, revision + 2);
  assert.equal('progressRevision' in store.exportProgress(), false);
  assert.equal(store.importProgress({ activeLanguages: [] }).ok, false);
  assert.equal(useStore.getState().progressRevision, revision + 2);
});

it('word lookup cannot confuse Italian sale with English sale or a custom persistence key', () => {
  const salt = { ...sample, eng: 'salt', it: 'sale', translations: { en: 'salt' } };
  const sale = { ...sample, eng: 'sale', word: 'sale', it: 'vendita', translations: { en: 'sale' } };
  const custom = { ...sample, eng: 'user:de:salz', word: 'Salz', source_language: 'de',
    translations: { de: 'Salz' } };
  const lookup = buildWordLookup([salt, sale, custom], 'it');
  assert.equal(lookup.get('sale'), salt);
  assert.equal(lookup.get('vendita'), sale);
  assert.equal(lookup.has('salz'), false);
  assert.equal(lookup.has('user:de:salz'), false);
});

it('word cards avoid immediate repeats while allowing the last eligible word', () => {
  const second = { ...sample, eng: 'second' };
  assert.equal(pickWordCard([sample, second], ['en'], sample.eng, Date.now(), () => 0), second);
  assert.equal(pickWordCard([sample], ['en'], sample.eng), sample);
  assert.equal(pickWordCard([sample], []), null);
  assert.equal(pickWordCard([{ ...sample, knowledge_stats: { en: true } }], ['en']), null);
});
