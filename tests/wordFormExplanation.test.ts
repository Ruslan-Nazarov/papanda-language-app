import './setup';
import { afterEach, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { explainWordForm, WordFormContext } from '../src/services/wordFormExplanation';

const originalFetch = globalThis.fetch;
const originalURL = process.env.EXPO_PUBLIC_GEMINI_PROXY_URL;
beforeEach(() => { process.env.EXPO_PUBLIC_GEMINI_PROXY_URL = 'https://test.invalid/generate'; });
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalURL === undefined) delete process.env.EXPO_PUBLIC_GEMINI_PROXY_URL;
  else process.env.EXPO_PUBLIC_GEMINI_PROXY_URL = originalURL;
});
const context: WordFormContext = {
  sentence: 'I cuochi cucinano.', language: 'Italiano',
  token: { text: 'cuochi', dictionary_form: 'cuoco', parts: ['cuoch', 'i'], translation: 'повара', label: '', role: 'Subject', is_in_my_dict: false },
};

it('explains the displayed inflected form with its lemma and full sentence context', async () => {
  globalThis.fetch = async (_, init) => {
    const prompt = JSON.parse(init!.body as string).prompt as string;
    const payload = JSON.parse(prompt.slice(prompt.indexOf('{')));
    assert.deepEqual(payload, { context });
    return Response.json({ text: 'cuoco → cuochi: множественное число, -i; h сохраняет звук /k/.' });
  };
  assert.match(await explainWordForm(context), /cuoco → cuochi/);
});

it('discards a late explanation when the word window is closed', async () => {
  const request = new AbortController();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    request.abort();
    return Response.json({ text: 'Поздний ответ' });
  };
  await assert.rejects(explainWordForm(context, request.signal), { name: 'AbortError' });
  await assert.rejects(explainWordForm(context, request.signal), { name: 'AbortError' });
  assert.equal(calls, 1);
});
