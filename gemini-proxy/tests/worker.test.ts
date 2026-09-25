import { it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker, { type Env } from '../src/worker';
import { reserveQuota, type QuotaState } from '../src/quota';
import { parseGenerationRequest } from '../src/requestValidation';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const env = (failure?: string): Env => ({
  GEMINI_API_KEY: 'test-key', DEFAULT_PROVIDER: 'gemini',
  QUOTA: { idFromName: () => 'test', get: () => ({ fetch: async () => Response.json({ failure }) }) } as unknown as Env['QUOTA'],
});
const request = (body: unknown) => new Request('https://proxy/v1/generate', {
  method: 'POST', headers: { 'x-install-id': 'test-install' }, body: JSON.stringify(body),
});

it('handles null and invalid config with a non-retryable 400', async () => {
  for (const body of [null, [], { prompt: '' }, { prompt: 'test', generationConfig: { maxOutputTokens: -1 } }]) {
    const response = await worker.fetch(request(body), env());
    assert.equal(response.status, 400);
    assert.equal((await response.json() as { retryable: boolean }).retryable, false);
  }
});

it('rejects oversized chunked requests before contacting the provider', async () => {
  const response = await worker.fetch(request({ prompt: 'a'.repeat(260000) }), env());
  assert.equal(response.status, 400);
});

it('supports browser preflight and CORS on errors', async () => {
  const response = await worker.fetch(new Request('https://proxy/v1/generate', { method: 'OPTIONS' }), env());
  assert.equal(response.status, 200);
  assert.match(response.headers.get('access-control-allow-headers')!, /X-Install-Id/);
  assert.equal((await worker.fetch(request(null), env())).headers.get('access-control-allow-origin'), '*');
});

it('rejects exhausted quotas without calling the AI provider', async () => {
  globalThis.fetch = async () => { throw new Error('Must not call upstream'); };
  const response = await worker.fetch(request({ prompt: 'test' }), env('INSTALL_DAILY'));
  assert.equal(response.status, 429);
  assert.equal((await response.json() as { daily: boolean }).daily, true);
});

it('maps network failures to retryable 503, not a fake quota error', async () => {
  globalThis.fetch = async () => { throw new Error('Network unavailable'); };
  const response = await worker.fetch(request({ prompt: 'test' }), env());
  assert.equal(response.status, 503);
  assert.equal((await response.json() as { retryable: boolean }).retryable, true);
});

it('uses the backup provider and unwraps its array response', async () => {
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return bodies.length === 1 ? Response.json({ error: { message: 'Busy' } }, { status: 503 }) :
      Response.json({ choices: [{ message: { content: '{"items":[{"sentence":"ok"}]}' }, finish_reason: 'stop' }] });
  };
  const response = await worker.fetch(request({ prompt: 'test', generationConfig: { responseMimeType: 'application/json', responseJsonSchema: { type: 'array' } } }), {
    ...env(), CEREBRAS_API_KEY: 'backup-key', CEREBRAS_MODEL: 'llama-3.3-70b',
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { text: '[{"sentence":"ok"}]' });
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].reasoning_effort, undefined);
});

it('rejects unsupported providers and non-finite configuration', () => {
  for (const config of [{ temperature: Infinity }, { topP: -1 }, { thinkingConfig: [] }]) {
    assert.throws(() => parseGenerationRequest({ prompt: 'test', generationConfig: config }));
  }
  assert.throws(() => parseGenerationRequest({ prompt: 'test', provider: 'unknown' }));
});

it('refused requests do not drain global budget and quotas reset by UTC bucket', () => {
  const limits = { perInstallHourly: 1, perInstallDaily: 2, globalDaily: 3 };
  const now = new Date('2026-09-24T12:00:00Z');
  const first = reserveQuota(undefined, 'one', limits, now);
  const rejected = reserveQuota(first.state, 'one', limits, now);
  assert.equal(rejected.failure, 'INSTALL_HOURLY');
  assert.equal(rejected.state.total, 1);
  const nextHour = reserveQuota(first.state, 'one', limits, new Date('2026-09-24T13:00:00Z'));
  assert.equal(nextHour.state.total, 2);
  assert.equal(reserveQuota(nextHour.state, 'one', limits, new Date('2026-09-24T14:00:00Z')).failure, 'INSTALL_DAILY');
  const nextDay = reserveQuota(nextHour.state, 'one', limits, new Date('2026-09-25T12:00:00Z'));
  assert.equal(nextDay.state.total, 1);
});

it('global quota caps admitted installations', () => {
  let state: QuotaState | undefined;
  const limits = { perInstallHourly: 5, perInstallDaily: 5, globalDaily: 2 };
  for (const id of ['one', 'two']) state = reserveQuota(state, id, limits, new Date()).state;
  assert.equal(reserveQuota(state, 'three', limits, new Date()).failure, 'GLOBAL_DAILY');
  assert.equal(Object.keys(state!.installs).length, 2);
});
