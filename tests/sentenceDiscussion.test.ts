import './setup';
import { afterEach, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { discussSentence, DiscussionContext } from '../src/services/sentenceDiscussion';

const originalFetch = globalThis.fetch;
const originalURL = process.env.EXPO_PUBLIC_GEMINI_PROXY_URL;
beforeEach(() => { process.env.EXPO_PUBLIC_GEMINI_PROXY_URL = 'https://test.invalid/generate'; });
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalURL === undefined) delete process.env.EXPO_PUBLIC_GEMINI_PROXY_URL;
  else process.env.EXPO_PUBLIC_GEMINI_PROXY_URL = originalURL;
});
const context: DiscussionContext = {
  sentence: 'Birds fly.', language: 'English', translation: 'Птицы летают.',
  tokens: [], explanation: 'fly — сказуемое.',
};

it('sends the displayed explanation, sentence and prior turns with the follow-up question', async () => {
  const history = [{ role: 'user' as const, text: 'Где действие?' }, { role: 'assistant' as const, text: 'Действие — fly.' }];
  globalThis.fetch = async (_, init) => {
    const prompt = JSON.parse(init!.body as string).prompt as string;
    const payload = JSON.parse(prompt.slice(prompt.indexOf('{')));
    assert.deepEqual(payload, { context, history, question: 'Почему?' });
    return Response.json({ text: 'Потому что это действие птиц.' });
  };
  assert.equal(await discussSentence(context, history, ' Почему? '), 'Потому что это действие птиц.');
});

it('rejects empty questions without sending and honors cancellation before and after the response', async () => {
  let calls = 0;
  const request = new AbortController();
  globalThis.fetch = async () => { calls++; request.abort(); return Response.json({ text: 'Поздний ответ' }); };
  assert.throws(() => discussSentence(context, [], '  '), /Введите вопрос/);
  assert.equal(calls, 0);
  await assert.rejects(discussSentence(context, [], 'Почему?', request.signal), { name: 'AbortError' });
  assert.equal(calls, 1);
  await assert.rejects(discussSentence(context, [], 'Почему?', request.signal), { name: 'AbortError' });
  assert.equal(calls, 1);
});

it('bounds long conversations to recent complete turns without mutating visible history', async () => {
  const history = Array.from({ length: 80 }, (_, index) => ({
    role: index % 2 ? 'assistant' as const : 'user' as const,
    text: `${index}:` + 'x'.repeat(1000),
  }));
  globalThis.fetch = async (_, init) => {
    const prompt = JSON.parse(init!.body as string).prompt as string;
    const payload = JSON.parse(prompt.slice(prompt.indexOf('{')));
    assert.ok(prompt.length < 60000, 'Long sessions must fit the proxy prompt limit');
    assert.deepEqual(payload.history, history.slice(-10));
    assert.equal(payload.history[0].role, 'user');
    return Response.json({ text: 'Ответ.' });
  };
  await discussSentence(context, history, 'Ещё вопрос');
  assert.equal(history.length, 80);
  assert.throws(() => discussSentence(context, [], 'x'.repeat(2001)), /2000/);
});
