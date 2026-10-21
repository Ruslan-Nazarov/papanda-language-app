import './setup';
import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { explainPronunciationWithAI } from '../src/services/aiService';

const originalFetch = globalThis.fetch;
const originalURL = process.env.EXPO_PUBLIC_GEMINI_PROXY_URL;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalURL === undefined) delete process.env.EXPO_PUBLIC_GEMINI_PROXY_URL;
  else process.env.EXPO_PUBLIC_GEMINI_PROXY_URL = originalURL;
});

it('repairs an overlong short pronunciation once instead of cutting off a sound instruction', async () => {
  process.env.EXPO_PUBLIC_GEMINI_PROXY_URL = 'https://test.invalid/v1/generate';
  let calls = 0;
  const short = '**thanks → сэ́нкс**\nПервый звук похож на «с», но кончик языка слегка высунь между зубами.';
  globalThis.fetch = async (_, init) => {
    calls++;
    const prompt = JSON.parse(init!.body as string).prompt;
    if (calls === 2) assert.match(prompt, /ИСПРАВЬ ПРЕДЫДУЩИЙ ОТВЕТ:.*ответ слишком длинный/);
    return Response.json({ text: calls === 1 ? 'длинное объяснение '.repeat(40) : short });
  };
  assert.equal(await explainPronunciationWithAI('thanks', 'Английский', 'спасибо'), short);
  assert.equal(calls, 2);
});

it('preserves a detailed explanation longer than the short limit', async () => {
  process.env.EXPO_PUBLIC_GEMINI_PROXY_URL = 'https://test.invalid/v1/generate';
  let calls = 0;
  const detailed = 'Подробное объяснение '.repeat(40).trim();
  globalThis.fetch = async () => { calls++; return Response.json({ text: detailed }); };
  assert.equal(await explainPronunciationWithAI('thanks', 'Английский', 'спасибо', undefined, 'detailed'), detailed);
  assert.equal(calls, 1);
});

it('cancels a pronunciation request without starting a repair request', async () => {
  process.env.EXPO_PUBLIC_GEMINI_PROXY_URL = 'https://test.invalid/v1/generate';
  const controller = new AbortController();
  let calls = 0;
  globalThis.fetch = async (_, init) => {
    calls++;
    return new Promise<Response>((_, reject) => {
      init!.signal!.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      controller.abort();
    });
  };
  await assert.rejects(explainPronunciationWithAI('thanks', 'Английский', 'спасибо', controller.signal), { name: 'AbortError' });
  assert.equal(calls, 1);
});
