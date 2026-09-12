import { getInstallId } from './installId';

interface GeminiThinkingConfig {
  thinkingBudget?: number;
  includeThoughts?: boolean;
}

export interface GeminiGenerationConfig {
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  responseMimeType?: 'application/json';
  responseJsonSchema?: unknown;
  thinkingConfig?: GeminiThinkingConfig;
}

interface ProxyResponse {
  text?: string;
  error?: string;
  code?: string;
  retryable?: boolean;
  daily?: boolean;
}

const REQUEST_TIMEOUT_MS = 45000;
const MAX_ATTEMPTS = 4;

// A Cloudflare Worker (papanda-app/gemini-proxy) that holds the real Gemini key
// and rate-limits per install. The URL is not a secret.
const getProxyUrl = () => process.env.EXPO_PUBLIC_GEMINI_PROXY_URL?.trim();

export const isGeminiConfigured = () => Boolean(getProxyUrl());

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Thrown when retrying won't help (quota gone, bad request, proxy misconfigured). */
class GeminiFatalError extends Error {}

/** Optional per-call override of which upstream the proxy uses. Leave unset to
 * use the Worker's own DEFAULT_PROVIDER (gemini-proxy/wrangler.toml) — that
 * lets provider/model be swapped without an app release. */
export type AiProvider = 'gemini' | 'cerebras' | 'groq';

export const generateGeminiText = async (
  prompt: string,
  generationConfig: GeminiGenerationConfig = {},
  provider?: AiProvider
): Promise<string> => {
  const proxyUrl = getProxyUrl();
  if (!proxyUrl) {
    throw new Error('ИИ-функции пока не подключены в этой сборке.');
  }

  const installId = await getInstallId();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await delay(Math.min(1500 * 2 ** (attempt - 1), 10000));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(proxyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Install-Id': installId,
        },
        body: JSON.stringify({ prompt, generationConfig, provider }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      const data = (await response.json().catch(() => null)) as ProxyResponse | null;

      if (response.ok && data?.text) {
        return data.text;
      }

      const message = data?.error || `Сервис генерации вернул ошибку ${response.status}.`;

      // The proxy already classified the failure.
      if (data && data.retryable === false) {
        throw new GeminiFatalError(message);
      }
      if (data?.daily) {
        throw new GeminiFatalError(message);
      }

      lastError = new Error(message);
      continue;
    } catch (err: any) {
      clearTimeout(timer);
      if (err instanceof GeminiFatalError) throw err;
      if (err?.name === 'AbortError') {
        lastError = new Error('Превышено время ожидания ответа (45 сек).');
        continue;
      }
      lastError = new Error(err?.message || 'Ошибка сети при обращении к сервису генерации.');
    }
  }

  throw lastError || new Error('Не удалось получить ответ от сервиса генерации.');
};
