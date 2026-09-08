/**
 * Papanda Gemini proxy.
 *
 * The mobile app never sees the Gemini API key — it POSTs { prompt, generationConfig }
 * here with an X-Install-Id header. This Worker rate-limits per install (and globally),
 * then forwards to Gemini with the real key held as a Worker secret.
 */

export interface Env {
  GEMINI_API_KEY: string;      // secret:  wrangler secret put GEMINI_API_KEY
  GEMINI_MODEL?: string;       // var, default below — change model without an app release
  RL: KVNamespace;             // KV namespace binding for rate-limit counters
  PER_INSTALL_HOURLY?: string; // vars (strings) — override without redeploy
  PER_INSTALL_DAILY?: string;
  GLOBAL_DAILY?: string;
}

const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const GEMINI_URL = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

const LIMITS = (env: Env) => ({
  perInstallHourly: Number(env.PER_INSTALL_HOURLY) || 40,
  perInstallDaily: Number(env.PER_INSTALL_DAILY) || 200,
  globalDaily: Number(env.GLOBAL_DAILY) || 1500,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const INSTALL_ID_RE = /^[a-z0-9-]{8,64}$/i;

/** KV counter with TTL. KV is eventually consistent — fine for abuse prevention. */
async function bump(kv: KVNamespace, key: string, ttlSeconds: number): Promise<number> {
  const current = Number(await kv.get(key)) || 0;
  const next = current + 1;
  await kv.put(key, String(next), { expirationTtl: ttlSeconds });
  return next;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true });
    }
    if (request.method !== 'POST' || url.pathname !== '/v1/generate') {
      return json({ error: 'Not found.' }, 404);
    }
    if (!env.GEMINI_API_KEY) {
      return json({ error: 'Proxy is not configured.' }, 500);
    }

    const installId = request.headers.get('x-install-id') || '';
    if (!INSTALL_ID_RE.test(installId)) {
      return json({ error: 'Missing or malformed X-Install-Id.' }, 400);
    }

    let payload: { prompt?: unknown; generationConfig?: unknown };
    try {
      payload = await request.json();
    } catch {
      return json({ error: 'Body must be JSON.' }, 400);
    }
    const prompt = payload.prompt;
    if (typeof prompt !== 'string' || prompt.length < 1 || prompt.length > 60_000) {
      return json({ error: 'prompt must be a non-empty string.' }, 400);
    }
    const generationConfig =
      payload.generationConfig && typeof payload.generationConfig === 'object' ? payload.generationConfig : {};

    // ---- rate limiting ----
    const now = new Date();
    const hourBucket = now.toISOString().slice(0, 13);      // YYYY-MM-DDTHH
    const dayBucket = now.toISOString().slice(0, 10);       // YYYY-MM-DD
    const limits = LIMITS(env);

    const globalDay = await bump(env.RL, `g:${dayBucket}`, 90_000);
    if (globalDay > limits.globalDaily) {
      return json(
        { error: 'Дневной общий лимит генерации исчерпан. Попробуйте завтра.', code: 'GLOBAL_DAILY', retryable: false, daily: true },
        429,
      );
    }

    const instHour = await bump(env.RL, `i:${installId}:h:${hourBucket}`, 4000);
    const instDay = await bump(env.RL, `i:${installId}:d:${dayBucket}`, 90_000);
    if (instHour > limits.perInstallHourly) {
      return json({ error: 'Слишком много запросов за час. Подождите немного.', code: 'INSTALL_HOURLY', retryable: false }, 429);
    }
    if (instDay > limits.perInstallDaily) {
      return json({ error: 'Дневной лимит генерации для этого устройства исчерпан.', code: 'INSTALL_DAILY', retryable: false, daily: true }, 429);
    }

    // ---- forward to Gemini ----
    const model = env.GEMINI_MODEL || DEFAULT_MODEL;
    let upstream: Response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 40_000);
      upstream = await fetch(GEMINI_URL(model), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig }),
        signal: controller.signal,
      });
      clearTimeout(timer);
    } catch {
      return json({ error: 'Не удалось связаться с сервисом генерации.', retryable: true }, 502);
    }

    const data: any = await upstream.json().catch(() => null);

    if (!upstream.ok) {
      const message: string = data?.error?.message || `Gemini error ${upstream.status}.`;
      const isQuota = upstream.status === 429;
      const isOverload = upstream.status === 503 || upstream.status === 500;
      return json(
        {
          error: isQuota
            ? 'Сервис генерации временно перегружен запросами. Попробуйте позже.'
            : isOverload
              ? 'Серверы генерации перегружены. Попробуйте через минуту.'
              : message,
          code: isQuota ? 'UPSTREAM_QUOTA' : isOverload ? 'UPSTREAM_OVERLOAD' : 'UPSTREAM_ERROR',
          retryable: isOverload,
        },
        isOverload ? 503 : 429,
      );
    }

    const text: string = (data?.candidates?.[0]?.content?.parts || [])
      .map((p: any) => p?.text || '')
      .join('')
      .trim();
    const finishReason: string | undefined = data?.candidates?.[0]?.finishReason;

    if (!text) {
      return json(
        {
          error: finishReason === 'MAX_TOKENS' ? 'Ответ не поместился в лимит.' : 'Пустой ответ от сервиса генерации.',
          code: finishReason === 'MAX_TOKENS' ? 'MAX_TOKENS' : 'EMPTY',
          retryable: finishReason !== 'MAX_TOKENS',
        },
        502,
      );
    }

    return json({ text });
  },
};
