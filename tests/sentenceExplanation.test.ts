import './setup';
import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { explainSentenceWithAI } from '../src/services/aiService';
import type { Token } from '../src/models/types';

const originalFetch = globalThis.fetch;
const originalURL = process.env.EXPO_PUBLIC_GEMINI_PROXY_URL;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalURL === undefined) delete process.env.EXPO_PUBLIC_GEMINI_PROXY_URL;
  else process.env.EXPO_PUBLIC_GEMINI_PROXY_URL = originalURL;
});
const configure = () => { process.env.EXPO_PUBLIC_GEMINI_PROXY_URL = 'https://test.invalid/v1/generate'; };

it('loads the summary separately, reuses both sections, and invalidates edited context', async () => {
  configure();
  const requests: string[] = [];
  globalThis.fetch = async (_, init) => {
    const prompt = JSON.parse(init!.body as string).prompt;
    requests.push(prompt);
    return Response.json({ text: prompt.includes('нужен только раздел «Подробности»') ? '**Подробности**\nСлова и окончания.' : '**Основа предложения**\nПтицы летают.' });
  };
  const tokens: Token[] = [{ text: 'Birds', role: 'Subject', label: 'существительное', translation: 'птицы', is_in_my_dict: false }];
  const load = (section: 'summary' | 'details', translation = 'Птицы летают.', words = tokens, signal?: AbortSignal) =>
    explainSentenceWithAI('Birds fly.', 'English', translation, words, signal, section);
  const summary = await load('summary');
  assert.equal(requests.length, 1, 'Details must not be requested before expansion');
  assert.match(requests[0], /нужен только раздел «Основа предложения»/);
  const details = await load('details');
  assert.match(requests[1], /Не повторяй раздел «Основа предложения»/);
  assert.equal(await load('summary'), summary);
  assert.equal(await load('details'), details);
  assert.equal(requests.length, 2, 'Returning to a sentence must reuse both sections');
  await load('summary', 'Птички летят.');
  await load('summary', undefined, [{ ...tokens[0], label: 'новая разметка' }]);
  assert.equal(requests.length, 4);
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(load('summary', undefined, tokens, cancelled.signal), { name: 'AbortError' });
  assert.equal(requests.length, 4);
});

it('does not cache failed or cancelled explanation requests', async () => {
  configure();
  let calls = 0;
  const controller = new AbortController();
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return Response.json({ error: 'Unavailable', retryable: false }, { status: 503 });
    if (calls === 2) controller.abort();
    return Response.json({ text: 'Готовый разбор.' });
  };
  const load = (signal?: AbortSignal) => explainSentenceWithAI('Dogs run.', 'English', 'Собаки бегут.', undefined, signal, 'summary');
  await assert.rejects(load(), /Unavailable/);
  await assert.rejects(load(controller.signal), { name: 'AbortError' });
  assert.equal(await load(), 'Готовый разбор.');
  assert.equal(calls, 3);
});
