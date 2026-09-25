import './setup';
import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateGeminiText } from '../src/services/geminiClient';
import { getInstallId } from '../src/services/installId';
import { generateSentenceBatch } from '../src/services/sentenceGeneration';

const originalFetch = globalThis.fetch;
const originalURL = process.env.EXPO_PUBLIC_GEMINI_PROXY_URL;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalURL === undefined) delete process.env.EXPO_PUBLIC_GEMINI_PROXY_URL;
  else process.env.EXPO_PUBLIC_GEMINI_PROXY_URL = originalURL;
});
const configure = () => { process.env.EXPO_PUBLIC_GEMINI_PROXY_URL = 'https://test.invalid/v1/generate'; };
const draft = { taskId: 'task-1', sentence: 'The train stopped.' };
const annotation = { ...draft, literalTranslation: 'Поезд остановился.', review: { natural: true, taskFit: true, analysisReliable: true }, words: [
  { text: 'The', role: 'Article', dictionary_form: 'the' }, { text: 'train', role: 'Subject', dictionary_form: 'train' },
  { text: 'stopped', role: 'Predicate', dictionary_form: 'stop' },
].map(word => ({ ...word, label: 'tag', translation: 'перевод', clauseIndex: 0, parts: [word.text] })) };
const reply = (data: unknown) => Response.json({ text: JSON.stringify(data) });

it('concurrent first requests receive one installation id', async () => {
  const ids = await Promise.all(Array.from({ length: 20 }, () => getInstallId()));
  assert.equal(new Set(ids).size, 1);
  assert.match(ids[0], /^[a-z0-9-]{8,64}$/i);
});
it('does not retry an unclassified permanent HTTP error', async () => {
  configure();
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ error: 'Bad request' }, { status: 400 }); };
  await assert.rejects(generateGeminiText('test'), /Bad request/);
  assert.equal(calls, 1);
});
it('coalesces both pipeline stages and releases the batch afterward, even with no dictionary', async () => {
  configure();
  const stages: string[] = [];
  globalThis.fetch = async (_, init) => {
    const body = JSON.parse(init!.body as string);
    const stage = body.prompt.split('\n')[0];
    stages.push(stage);
    assert.ok(body.generationConfig.responseJsonSchema);
    return reply(stage === 'COMPOSE_SENTENCES' ? [draft] : [annotation]);
  };
  const first = generateSentenceBatch('en', [], 1);
  const second = generateSentenceBatch('en', [], 1);
  assert.equal(first, second);
  assert.equal((await first).length, 1);
  assert.deepEqual(stages, ['COMPOSE_SENTENCES', 'REVIEW_AND_ANNOTATE']);
  await generateSentenceBatch('en', [], 1);
  assert.equal(stages.length, 4);
});
it('rejects a weak review and supplies feedback for one bounded repair round', async () => {
  configure();
  let calls = 0;
  globalThis.fetch = async (_, init) => {
    calls++;
    if (calls === 3) assert.match(JSON.parse(init!.body as string).prompt, /не прошла проверку/);
    if (calls % 2) return reply([draft]);
    return reply([{ ...annotation, review: { ...annotation.review, natural: calls === 4 } }]);
  };
  assert.equal((await generateSentenceBatch('en', [], 1)).length, 1);
  assert.equal(calls, 4);
});
it('cannot claim targeted success when the requested word is missing', async () => {
  configure();
  let calls = 0;
  globalThis.fetch = async () => reply(++calls % 2 ? [draft] : [annotation]);
  await assert.rejects(generateSentenceBatch('en', [], 1, { lemma: 'book' }), /отсутствует запрошенное слово/);
  assert.equal(calls, 4);
});
it('honours an inflected requested lexeme and marks it even outside the existing dictionary', async () => {
  configure();
  let calls = 0;
  globalThis.fetch = async () => reply(++calls % 2 ? [draft] : [annotation]);
  const result = await generateSentenceBatch('en', [], 1, { lemma: 'stop' });
  assert.equal(result[0].words[2].dictionary_word, 'stop');
});
it('malformed drafts cannot start annotation requests or unbounded retries', async () => {
  configure();
  let calls = 0;
  globalThis.fetch = async () => { calls++; return reply({ unexpected: true }); };
  await assert.rejects(generateSentenceBatch('en', [], 1), /Не получены тексты/);
  assert.equal(calls, 2);
});
