import './setup';
import { afterEach, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { explainWordForm, discussWordForm, WordFormContext } from '../src/services/wordFormExplanation';

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

it('sends the word form context, prior explanation, turns and follow-up question', async () => {
  const history = [
    { role: 'user' as const, text: 'Почему -i, а не -e?' },
    { role: 'assistant' as const, text: 'Потому что cuoco мужского рода.' },
  ];
  const discussionContext = { ...context, explanation: 'cuoco → cuochi' };
  globalThis.fetch = async (_, init) => {
    const prompt = JSON.parse(init!.body as string).prompt as string;
    const payload = JSON.parse(prompt.slice(prompt.indexOf('{')));
    assert.deepEqual(payload, { context: discussionContext, history, question: 'А буква h зачем?' });
    return Response.json({ text: 'Буква h сохраняет твердый звук [k].' });
  };
  const reply = await discussWordForm(discussionContext, history, ' А буква h зачем? ');
  assert.equal(reply, 'Буква h сохраняет твердый звук [k].');
});

it('rejects empty or oversized questions and honors abort signal for word form discussion', async () => {
  let calls = 0;
  const request = new AbortController();
  globalThis.fetch = async () => { calls++; request.abort(); return Response.json({ text: 'Поздний ответ' }); };
  assert.throws(() => discussWordForm(context, [], '   '), /Введите вопрос/);
  assert.equal(calls, 0);
  assert.throws(() => discussWordForm(context, [], 'a'.repeat(2001)), /2000/);
  await assert.rejects(discussWordForm(context, [], 'Вопрос', request.signal), { name: 'AbortError' });
  assert.equal(calls, 1);
});

it('bounds long word form discussions to recent turns', async () => {
  const history = Array.from({ length: 40 }, (_, index) => ({
    role: index % 2 ? 'assistant' as const : 'user' as const,
    text: `${index}: ` + 'x'.repeat(1000),
  }));
  globalThis.fetch = async (_, init) => {
    const prompt = JSON.parse(init!.body as string).prompt as string;
    const payload = JSON.parse(prompt.slice(prompt.indexOf('{')));
    assert.ok(prompt.length < 60000);
    assert.deepEqual(payload.history, history.slice(-10));
    assert.equal(payload.history[0].role, 'user');
    return Response.json({ text: 'Ответ.' });
  };
  await discussWordForm(context, history, 'Вопрос');
  assert.equal(history.length, 40);
});
