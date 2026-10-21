import { abortableDelay, checkAborted, isAbortError } from './generationControl';
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


/** Thrown when retrying won't help (quota gone, bad request, proxy misconfigured). */
class GeminiFatalError extends Error {}

/** Optional per-call override of which upstream the proxy uses. Leave unset to
 * use the Worker's own DEFAULT_PROVIDER (gemini-proxy/wrangler.toml) — that
 * lets provider/model be swapped without an app release. */
export type AiProvider = 'gemini' | 'cerebras' | 'groq';

export const generateGeminiText = async (
  prompt: string,
  generationConfig: GeminiGenerationConfig = {},
  provider?: AiProvider,
  signal?: AbortSignal
): Promise<string> => {
  checkAborted(signal);
  const proxyUrl = getProxyUrl();
  if (!proxyUrl) {
    throw new Error('ИИ-функции пока не подключены в этой сборке.');
  }

  const installId = await getInstallId();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    checkAborted(signal);
    if (attempt > 0) await abortableDelay(Math.min(1500 * 2 ** (attempt - 1), 10000), signal);

    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
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
      const raw: unknown = await response.json().catch(error => { if (isAbortError(error)) throw error; return null; });
      checkAborted(signal);
      const data = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as ProxyResponse : null;

      if (response.ok && typeof data?.text === 'string' && data.text.trim()) {
        return data.text;
      }

      const message = (typeof data?.error === 'string' && data.error) || `Сервис генерации вернул ошибку ${response.status}.`;

      // The proxy already classified the failure.
      if (data && data.retryable === false) {
        throw new GeminiFatalError(message);
      }
      if (data?.daily) {
        throw new GeminiFatalError(message);
      }
      if (response.status >= 400 && response.status < 500 && response.status !== 429 && response.status !== 408) {
        throw new GeminiFatalError(message);
      }

      lastError = new Error(message);
      continue;
    } catch (err: unknown) {
      checkAborted(signal);
      if (err instanceof GeminiFatalError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        lastError = new Error('Превышено время ожидания ответа (45 сек).');
        continue;
      }
      lastError = new Error(err instanceof Error ? err.message : 'Ошибка сети при обращении к сервису генерации.');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  throw lastError || new Error('Не удалось получить ответ от сервиса генерации.');
};
