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

it('rewrites conversational filler in detailed pronunciation while preserving the original explanation as context', async () => {
  process.env.EXPO_PUBLIC_GEMINI_PROXY_URL = 'https://test.invalid/v1/generate';
  const verbose = 'Привет! С удовольствием помогу тебе разобраться.\n\nДавай разберём по звукам, чтобы звучало максимально естественно.\n\n**thanks** — [θæŋks].\nПервый звук произносится с языком между зубами.';
  const edited = '**thanks** — [θæŋks].\n- **Звуки:** для первого звука помести кончик языка между зубами и выдохни без голоса.';
  const prompts: string[] = [];
  globalThis.fetch = async (_, init) => {
    prompts.push(JSON.parse(init!.body as string).prompt);
    return Response.json({ text: prompts.length === 1 ? verbose : edited });
  };
  assert.equal(await explainPronunciationWithAI('thanks', 'English', 'спасибо', undefined, 'detailed'), edited);
  assert.equal(prompts.length, 2);
  assert.ok(prompts[1].includes(verbose));
  assert.match(prompts[1], /убери приветствие, вступление и разговорные связки/);
  assert.match(prompts[0], /Не считай количество слов и букв/);
});

it('bounds detailed pronunciation without applying the short-mode limit or truncating text', async () => {
  process.env.EXPO_PUBLIC_GEMINI_PROXY_URL = 'https://test.invalid/v1/generate';
  let calls = 0;
  const edited = '**word** — [wɜːd].\n- **Звуки:** объяснение артикуляции.';
  globalThis.fetch = async (_, init) => {
    calls++;
    if (calls === 2) assert.match(JSON.parse(init!.body as string).prompt, /ответ слишком длинный: не более 180 слов/);
    return Response.json({ text: calls === 1 ? 'лишние подробности '.repeat(100) : edited });
  };
  assert.equal(await explainPronunciationWithAI('word', 'English', 'слово', undefined, 'detailed'), edited);
  assert.equal(calls, 2);
});

it('does not mistake a greeting in the word translation for conversational filler', async () => {
  process.env.EXPO_PUBLIC_GEMINI_PROXY_URL = 'https://test.invalid/v1/generate';
  let calls = 0;
  const explanation = '**salut** («привет») — [saly].\n- Конечная t не читается.';
  globalThis.fetch = async () => { calls++; return Response.json({ text: explanation }); };
  assert.equal(await explainPronunciationWithAI('salut', 'Français', 'привет', undefined, 'detailed'), explanation);
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
