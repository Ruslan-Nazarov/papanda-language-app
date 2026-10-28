import './setup';
import { before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { useStore } from '../src/store/useStore';
import { createDefaultProgress, pickPersistedFields } from '../src/store/progressTypes';
import { parseProgress } from '../src/store/progressValidation';
import { previewBackup } from '../src/services/backupFormat';
import { progressStorage } from '../src/services/progressStorage';
import { createLanguageNote, noteMatchesSource, linkNoteSource, sortNotes, searchNotes } from '../src/utils/notes';

const source = { sentenceId: 'ai-example', text: 'A learner reads a book.', translation: 'Ученик читает книгу.', token: 'reads' };
const makeNote = () => ({ ...createLanguageNote('en', source), body: 'Сначала ищу действие.', tags: ['разбор'] });
before(async () => { await useStore.persist.rehydrate(); });
beforeEach(() => { useStore.getState().importProgress(createDefaultProgress()); });

it('persists notes and editing drafts across hydration and backup round-trips', async () => {
  const store = useStore.getState();
  const note = makeNote();
  store.saveLanguageNote(note);
  store.saveNoteDraft({ ...note, body: 'Ещё не законченная новая мысль.' });
  const exported = store.exportProgress();
  const preview = previewBackup(JSON.stringify({ app: 'papanda', version: 1, data: exported }));
  assert.equal(preview.notes, 1);
  assert.equal(preview.noteDrafts, 1);
  const storage = useStore.persist.getOptions().storage;
  useStore.persist.setOptions({ storage: { getItem: async () => ({ state: preview.data, version: 0 }), setItem: async () => {}, removeItem: async () => {} } });
  try {
    store.importProgress(createDefaultProgress());
    await useStore.persist.rehydrate();
    assert.equal(useStore.getState().languageNotes[0].body, note.body);
    assert.equal(useStore.getState().noteDrafts[0].body, 'Ещё не законченная новая мысль.');
    assert.deepEqual(useStore.getState().languageNotes[0].sources, [source]);
  } finally { useStore.persist.setOptions({ storage }); }
});

it('saving commits a draft atomically, generates a title and detaches caller references', () => {
  const note = makeNote();
  useStore.getState().saveNoteDraft(note);
  useStore.getState().saveLanguageNote(note);
  assert.equal(useStore.getState().noteDrafts.length, 0);
  assert.equal(useStore.getState().languageNotes[0].title, 'Сначала ищу действие');
  note.sources[0].text = 'Caller mutation';
  note.tags.push('mutation');
  assert.equal(useStore.getState().languageNotes[0].sources[0].text, source.text);
  assert.deepEqual(useStore.getState().languageNotes[0].tags, ['разбор']);
});

it('drafts accept unfinished text, while invalid notes and imports cannot change live data', () => {
  const blank = createLanguageNote('kz');
  useStore.getState().saveNoteDraft(blank);
  assert.throws(() => useStore.getState().saveLanguageNote(blank), /Добавьте текст/);
  const initial = useStore.getState();
  for (const note of [null, { ...makeNote(), kind: 'unknown' }, { ...makeNote(), language: 'xx' },
    { ...makeNote(), body: 'x'.repeat(6001) }, { ...makeNote(), sources: [{ ...source, text: 3 }] },
    { ...makeNote(), sources: [{ ...source, sentenceId: '' }] }, { ...makeNote(), deletedAt: 'invalid' }]) {
    assert.equal(useStore.getState().importProgress({ ...createDefaultProgress(), languageNotes: [note] }).ok, false);
    assert.equal(useStore.getState(), initial);
  }
  const note = makeNote();
  assert.throws(() => parseProgress({ ...createDefaultProgress(), languageNotes: [note, note] }));
});

it('cache clearing and statistics reset retain notes, drafts and source snapshots', () => {
  const store = useStore.getState();
  store.addGeneratedSentences([{ id: source.sentenceId, sentence: source.text, language: 'English', words: [], createdAt: Date.now() }]);
  const note = makeNote();
  store.saveLanguageNote(note);
  store.saveNoteDraft({ ...createLanguageNote('it'), body: 'Una nota' });
  store.clearGeneratedSentences();
  store.resetStatistics();
  assert.equal(useStore.getState().generatedSentences.length, 0);
  assert.equal(useStore.getState().languageNotes[0].sources[0].text, source.text);
  assert.equal(useStore.getState().noteDrafts.length, 1);
});

it('linking one note to more examples retains editing drafts and avoids duplicate links', () => {
  const note = makeNote();
  const second = { sentenceId: 'second', text: 'Another example.' };
  useStore.getState().saveLanguageNote(note);
  useStore.getState().saveNoteDraft({ ...note, body: 'Несохранённая редактура' });
  useStore.getState().linkLanguageNote(note.id, second);
  useStore.getState().linkLanguageNote(note.id, second);
  assert.equal(useStore.getState().languageNotes.length, 1);
  assert.equal(useStore.getState().languageNotes[0].sources.length, 2);
  assert.equal(useStore.getState().noteDrafts[0].body, 'Несохранённая редактура');
  assert.equal(useStore.getState().noteDrafts[0].sources.length, 2);
  assert.equal(linkNoteSource(note, source).sources.length, 1);
  assert.ok(noteMatchesSource(note, 'en', { ...source, sentenceId: 'regenerated-id' }));
  assert.equal(noteMatchesSource(note, 'it', source), false);
});

it('archive and trash update drafts too; restoring cannot discard unsaved edits', () => {
  const note = makeNote();
  useStore.getState().saveLanguageNote(note);
  useStore.getState().saveNoteDraft({ ...note, body: 'Новая мысль' });
  useStore.getState().setNoteDisposition(note.id, { archived: true, deletedAt: new Date().toISOString() });
  assert.ok(useStore.getState().noteDrafts[0].deletedAt);
  useStore.getState().setNoteDisposition(note.id, { archived: false, deletedAt: undefined });
  const restored = useStore.getState().noteDrafts[0];
  assert.equal(restored.deletedAt, undefined);
  assert.equal(restored.archived, false);
  assert.equal(restored.body, 'Новая мысль');
  useStore.getState().discardNoteDraft(note.id);
  assert.equal(useStore.getState().languageNotes[0].body, note.body);
});

it('search covers topics, examples and sources; pinned notes sort before recent ones without mutating the list', () => {
  const first = { ...makeNote(), pinned: true, updatedAt: '2026-01-01T00:00:00.000Z' };
  const second = { ...createLanguageNote('en'), body: 'Something else', updatedAt: '2026-10-01T00:00:00.000Z' };
  const notes = [second, first];
  assert.deepEqual(sortNotes(notes).map(n => n.id), [first.id, second.id]);
  assert.equal(notes[0], second);
  assert.deepEqual(searchNotes(notes, 'РАЗБОР reads').map(n => n.id), [first.id]);
});

it('old profiles default to empty note collections and exports include only user data', async () => {
  const parsed = parseProgress({ userWordProgress: {} });
  assert.deepEqual(parsed.languageNotes, []);
  assert.deepEqual(parsed.noteDrafts, []);
  const picked = pickPersistedFields(useStore.getState());
  assert.equal('sentences' in picked, false);
  assert.equal('saveLanguageNote' in picked, false);
  await progressStorage.flush();
});
