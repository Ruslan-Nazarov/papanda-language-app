import './setup';
import { afterEach, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { auditWordManually } from '../src/services/wordAuditService';
import { useStore } from '../src/store/useStore';
import { createDefaultProgress } from '../src/store/progressTypes';
import type { Word } from '../src/models/types';

const originalFetch = globalThis.fetch;
const originalURL = process.env.EXPO_PUBLIC_GEMINI_PROXY_URL;
const sample: Word = { eng: 'audit-race', ru: 'пример', meaning: 'существительное',
  translations: { en: 'example', it: 'esempio' }, count: 0, is_learned: 0 };
const verdict = () => Response.json({ text: JSON.stringify({ isValid: true, issues: [] }) });
beforeEach(() => {
  process.env.EXPO_PUBLIC_GEMINI_PROXY_URL = 'https://test.invalid/v1/generate';
  useStore.getState().importProgress({ ...createDefaultProgress(), activeLanguages: ['en'], customWords: [sample] });
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalURL === undefined) delete process.env.EXPO_PUBLIC_GEMINI_PROXY_URL;
  else process.env.EXPO_PUBLIC_GEMINI_PROXY_URL = originalURL;
});

it('accepts a current verdict without overwriting visits, favorites or associations', async () => {
  globalThis.fetch = async () => {
    useStore.getState().toggleWordFavorite(sample.eng!);
    useStore.getState().recordTripleCardShow(sample.eng!);
    useStore.getState().saveWordAssociation(sample.eng!, 'ассоциация');
    return verdict();
  };
  assert.equal((await auditWordManually(sample, ['en'])).status, 'verified');
  const progress = useStore.getState().userWordProgress[sample.eng!];
  assert.equal(progress.ai_verification?.status, 'verified');
  assert.equal(progress.is_favorite, true);
  assert.equal(progress.count, 1);
  assert.equal(progress.personal_association, 'ассоциация');
});

for (const [field, change] of [
  ['translation', () => useStore.getState().updateWordDetails(sample.eng!, { translations: { en: 'changed' } })],
  ['Russian meaning', () => useStore.getState().updateWordDetails(sample.eng!, { ru: 'другое значение' })],
  ['context', () => useStore.setState(state => ({ words: state.words.map(word => word.eng === sample.eng ? { ...word, meaning: 'другой контекст' } : word) }))],
] as const) {
  it(`discards a late verdict after a change to ${field}`, async () => {
    globalThis.fetch = async () => { change(); return verdict(); };
    await assert.rejects(auditWordManually(sample, ['en']), { name: 'AbortError' });
    assert.equal(useStore.getState().userWordProgress[sample.eng!]?.ai_verification, undefined);
  });
}

for (const [action, change] of [
  ['import', () => useStore.getState().importProgress(useStore.getState().exportProgress())],
  ['reset', () => useStore.getState().resetStatistics()],
  ['language change', () => useStore.getState().setLanguages(['it'])],
] as const) {
  it(`aborts manual audit on ${action}, even when the transport returns a late reply`, async () => {
    let transportAborted = false;
    globalThis.fetch = async (_, init) => {
      init!.signal!.addEventListener('abort', () => { transportAborted = true; });
      change();
      return verdict();
    };
    await assert.rejects(auditWordManually(sample, ['en']), { name: 'AbortError' });
    assert.equal(transportAborted, true);
    assert.equal(useStore.getState().userWordProgress[sample.eng!]?.ai_verification, undefined);
  });
}

it('honors caller cancellation, including an already aborted request', async () => {
  const controller = new AbortController();
  let calls = 0;
  globalThis.fetch = async () => { calls++; controller.abort(); return verdict(); };
  await assert.rejects(auditWordManually(sample, ['en'], controller.signal), { name: 'AbortError' });
  await assert.rejects(auditWordManually(sample, ['en'], controller.signal), { name: 'AbortError' });
  assert.equal(calls, 1);
  assert.equal(useStore.getState().userWordProgress[sample.eng!]?.ai_verification, undefined);
});
