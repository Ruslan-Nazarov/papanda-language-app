/**
 * Papanda AI proxy.
 *
 * The mobile app never sees any provider API key — it POSTs { prompt, generationConfig }
 * here with an X-Install-Id header. This Worker rate-limits per install (and globally),
 * then forwards to whichever provider is configured (Gemini / Cerebras / Groq) with the
 * real key held as a Worker secret. The app's response contract never changes: { text }.
 */

export interface Env {
  // Secrets:  wrangler secret put <NAME>  — only the ones you actually use are required.
  GEMINI_API_KEY?: string;
  CEREBRAS_API_KEY?: string;
  GROQ_API_KEY?: string;

  // Vars — change provider/model without an app release.
  DEFAULT_PROVIDER?: string; // 'gemini' | 'cerebras' | 'groq', default 'gemini'
  GEMINI_MODEL?: string;
  CEREBRAS_MODEL?: string;
  GROQ_MODEL?: string;

  RL: KVNamespace; // KV namespace binding for rate-limit counters
  PER_INSTALL_HOURLY?: string; // vars (strings) — override without redeploy
  PER_INSTALL_DAILY?: string;
  GLOBAL_DAILY?: string;
}

type Provider = 'gemini' | 'cerebras' | 'groq';

const DEFAULT_MODELS: Record<Provider, string> = {
  gemini: 'gemini-3.5-flash-lite',
  cerebras: 'llama-3.3-70b',
  groq: 'llama-3.3-70b-versatile',
};

const GEMINI_URL = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
const CEREBRAS_URL = 'https://api.cerebras.ai/v1/chat/completions';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

interface GenerationConfig {
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  responseMimeType?: 'application/json';
  responseJsonSchema?: unknown;
  thinkingConfig?: { thinkingBudget?: number; includeThoughts?: boolean };
}

interface UpstreamResult {
  ok: true;
  text: string;
  finishReason?: string;
}
interface UpstreamError {
  ok: false;
  status: number;
  message: string;
}

const LIMITS = (env: Env) => ({
  perInstallHourly: Number(env.PER_INSTALL_HOURLY) || 40,
  perInstallDaily: Number(env.PER_INSTALL_DAILY) || 200,
  globalDaily: Number(env.GLOBAL_DAILY) || 1500,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const INSTALL_ID_RE = /^[a-z0-9-]{8,64}$/i;
const PROVIDERS: Provider[] = ['gemini', 'cerebras', 'groq'];

/** KV counter with TTL. KV is eventually consistent — fine for abuse prevention. */
async function bump(kv: KVNamespace, key: string, ttlSeconds: number): Promise<number> {
  const current = Number(await kv.get(key)) || 0;
  const next = current + 1;
  await kv.put(key, String(next), { expirationTtl: ttlSeconds });
  return next;
}

function apiKeyFor(provider: Provider, env: Env): string | undefined {
  if (provider === 'gemini') return env.GEMINI_API_KEY;
  if (provider === 'cerebras') return env.CEREBRAS_API_KEY;
  return env.GROQ_API_KEY;
}

function modelFor(provider: Provider, env: Env): string {
  if (provider === 'gemini') return env.GEMINI_MODEL || DEFAULT_MODELS.gemini;
  if (provider === 'cerebras') return env.CEREBRAS_MODEL || DEFAULT_MODELS.cerebras;
  return env.GROQ_MODEL || DEFAULT_MODELS.groq;
}

async function callGemini(
  apiKey: string,
  model: string,
  prompt: string,
  cfg: GenerationConfig,
  signal: AbortSignal
): Promise<UpstreamResult | UpstreamError> {
  const generationConfig: Record<string, unknown> = {};
  if (cfg.temperature !== undefined) generationConfig.temperature = cfg.temperature;
  if (cfg.topP !== undefined) generationConfig.topP = cfg.topP;
  if (cfg.maxOutputTokens !== undefined) generationConfig.maxOutputTokens = cfg.maxOutputTokens;
  if (cfg.responseMimeType) generationConfig.responseMimeType = cfg.responseMimeType;
  if (cfg.responseJsonSchema) generationConfig.responseJsonSchema = cfg.responseJsonSchema;
  if (cfg.thinkingConfig) generationConfig.thinkingConfig = cfg.thinkingConfig;

  const res = await fetch(GEMINI_URL(model), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig }),
    signal,
  });
  const data: any = await res.json().catch(() => null);

  if (!res.ok) {
    return { ok: false, status: res.status, message: data?.error?.message || `Gemini error ${res.status}.` };
  }

  const text: string = (data?.candidates?.[0]?.content?.parts || [])
    .map((p: any) => p?.text || '')
    .join('')
    .trim();
  const finishReason: string | undefined = data?.candidates?.[0]?.finishReason;
  return { ok: true, text, finishReason };
}

/** Cerebras and Groq both speak the OpenAI chat-completions dialect. */
async function callOpenAiCompatible(
  url: string,
  apiKey: string,
  model: string,
  prompt: string,
  cfg: GenerationConfig,
  signal: AbortSignal
): Promise<UpstreamResult | UpstreamError> {
  // Neither provider accepts an arbitrary JSON Schema the way Gemini does — fold the
  // schema into the prompt itself and fall back to their generic JSON object mode.
  // That mode (response_format: json_object) REQUIRES the top-level value to be a
  // JSON object — a schema whose root is an array (e.g. the sentence-batch schema)
  // gets rejected outright by the upstream's own validator ("Failed to validate
  // JSON..."), before any of our own parsing even runs. Wrap such schemas in
  // {"items": [...]} for the request and unwrap the response so the rest of the
  // pipeline (which expects the raw array back in `text`) doesn't need to change.
  const isArraySchema = Boolean(cfg.responseJsonSchema && (cfg.responseJsonSchema as any).type === 'array');
  const effectiveSchema = isArraySchema
    ? { type: 'object', properties: { items: cfg.responseJsonSchema }, required: ['items'] }
    : cfg.responseJsonSchema;

  let content = prompt;
  if (cfg.responseJsonSchema) {
    content = isArraySchema
      ? `${prompt}\n\nRespond with ONLY a single JSON object of the shape {"items": [...]}, where "items" strictly matches this JSON Schema, no prose, no Markdown fences:\n${JSON.stringify(effectiveSchema)}`
      : `${prompt}\n\nRespond with ONLY a single JSON value that strictly matches this JSON Schema, no prose, no Markdown fences:\n${JSON.stringify(effectiveSchema)}`;
  }

  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'user', content }],
  };
  if (cfg.temperature !== undefined) body.temperature = cfg.temperature;
  if (cfg.topP !== undefined) body.top_p = cfg.topP;
  if (cfg.responseMimeType === 'application/json') {
    body.response_format = { type: 'json_object' };
    // gpt-oss (Groq/Cerebras) is a reasoning model: without a cap it can spend the
    // whole token budget on hidden reasoning and return an EMPTY final answer, which
    // then fails the provider's own "must be valid JSON" check before we ever see
    // it. Keep reasoning short and guarantee enough budget for the actual JSON body
    // (our schemas run large — dictionary + few-shot example + an array of sentences).
    body.reasoning_effort = 'low';
    body.max_tokens = Math.max(cfg.maxOutputTokens ?? 0, 6144);
  } else if (cfg.maxOutputTokens !== undefined) {
    body.max_tokens = cfg.maxOutputTokens;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal,
  });
  const data: any = await res.json().catch(() => null);

  if (!res.ok) {
    return { ok: false, status: res.status, message: data?.error?.message || `Upstream error ${res.status}.` };
  }

  let text: string = (data?.choices?.[0]?.message?.content || '').trim();
  const finishReason: string | undefined = data?.choices?.[0]?.finish_reason;

  if (isArraySchema && text) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        // The model ignored the wrapper instruction and returned the array directly — fine.
      } else if (parsed && Array.isArray(parsed.items)) {
        text = JSON.stringify(parsed.items);
      }
    } catch {
      // Leave text as-is; downstream JSON.parse will surface the same failure it
      // always would have for genuinely malformed output.
    }
  }

  // Normalize to Gemini's vocabulary so the rest of the pipeline doesn't care which
  // provider answered.
  const normalizedFinish = finishReason === 'length' ? 'MAX_TOKENS' : finishReason;
  return { ok: true, text, finishReason: normalizedFinish };
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

    const installId = request.headers.get('x-install-id') || '';
    if (!INSTALL_ID_RE.test(installId)) {
      return json({ error: 'Missing or malformed X-Install-Id.' }, 400);
    }

    let payload: { prompt?: unknown; generationConfig?: unknown; provider?: unknown };
    try {
      payload = await request.json();
    } catch {
      return json({ error: 'Body must be JSON.' }, 400);
    }
    const prompt = payload.prompt;
    if (typeof prompt !== 'string' || prompt.length < 1 || prompt.length > 60_000) {
      return json({ error: 'prompt must be a non-empty string.' }, 400);
    }
    const generationConfig: GenerationConfig =
      payload.generationConfig && typeof payload.generationConfig === 'object'
        ? (payload.generationConfig as GenerationConfig)
        : {};

    const requestedProvider = typeof payload.provider === 'string' ? payload.provider : undefined;
    const defaultProvider = (env.DEFAULT_PROVIDER as Provider) || 'gemini';
    const provider: Provider = PROVIDERS.includes(requestedProvider as Provider)
      ? (requestedProvider as Provider)
      : PROVIDERS.includes(defaultProvider)
        ? defaultProvider
        : 'gemini';

    const apiKey = apiKeyFor(provider, env);
    if (!apiKey) {
      return json({ error: `Proxy is not configured for provider "${provider}".` }, 500);
    }

    // ---- rate limiting ----
    const now = new Date();
    const hourBucket = now.toISOString().slice(0, 13); // YYYY-MM-DDTHH
    const dayBucket = now.toISOString().slice(0, 10); // YYYY-MM-DD
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

    // ---- forward to the chosen provider ----
    const model = modelFor(provider, env);
    let result: UpstreamResult | UpstreamError;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 40_000);
      try {
        result =
          provider === 'gemini'
            ? await callGemini(apiKey, model, prompt, generationConfig, controller.signal)
            : await callOpenAiCompatible(
                provider === 'cerebras' ? CEREBRAS_URL : GROQ_URL,
                apiKey,
                model,
                prompt,
                generationConfig,
                controller.signal,
              );
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return json({ error: 'Не удалось связаться с сервисом генерации.', retryable: true }, 502);
    }

    if (!result.ok) {
      const isQuota = result.status === 429;
      const isOverload = result.status === 503 || result.status === 500;
      return json(
        {
          error: isQuota
            ? 'Сервис генерации временно перегружен запросами. Попробуйте позже.'
            : isOverload
              ? 'Серверы генерации перегружены. Попробуйте через минуту.'
              : result.message,
          code: isQuota ? 'UPSTREAM_QUOTA' : isOverload ? 'UPSTREAM_OVERLOAD' : 'UPSTREAM_ERROR',
          // A 429 from the upstream provider is a transient per-minute/per-second rate
          // limit (distinct from OUR OWN daily KV limits above, which set `daily: true`
          // and are correctly non-retryable) — worth the client's built-in backoff retry
          // rather than surfacing a hard failure to the learner immediately.
          retryable: isOverload || isQuota,
        },
        isOverload ? 503 : 429,
      );
    }

    if (!result.text) {
      return json(
        {
          error: result.finishReason === 'MAX_TOKENS' ? 'Ответ не поместился в лимит.' : 'Пустой ответ от сервиса генерации.',
          code: result.finishReason === 'MAX_TOKENS' ? 'MAX_TOKENS' : 'EMPTY',
          retryable: result.finishReason !== 'MAX_TOKENS',
        },
        502,
      );
    }

    return json({ text: result.text });
  },
};
