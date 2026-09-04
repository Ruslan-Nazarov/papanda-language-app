interface GeminiThinkingConfig {
  thinkingBudget?: number;
  includeThoughts?: boolean;
}

interface GeminiGenerationConfig {
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  responseMimeType?: 'application/json';
  responseJsonSchema?: unknown;
  thinkingConfig?: GeminiThinkingConfig;
}

interface GeminiErrorResponse {
  error?: { message?: string; status?: string; details?: Array<Record<string, unknown>> };
}

interface GeminiResponse {
  candidates?: Array<{
    finishReason?: string;
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

// gemini-3.5-flash-lite: stable, still available to new API projects, and has a
// far larger free-tier daily allowance than gemini-3.x-flash (which is capped at
// ~20 requests/day on the free tier). Override with EXPO_PUBLIC_GEMINI_MODEL.
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const REQUEST_TIMEOUT_MS = 35000;
const MAX_ATTEMPTS = 4;

const getApiKey = () => process.env.EXPO_PUBLIC_GEMINI_API_KEY?.trim();
const getModel = () => process.env.EXPO_PUBLIC_GEMINI_MODEL?.trim() || DEFAULT_MODEL;

export const isGeminiConfigured = () => Boolean(getApiKey());

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Google returns a machine-readable retry hint for 429/503 in error.details.
const getRetryDelayMs = (data: GeminiErrorResponse | null): number | null => {
  const details = data?.error?.details;
  if (!Array.isArray(details)) return null;
  for (const detail of details) {
    const seconds = typeof detail?.retryDelay === 'string' ? parseFloat(detail.retryDelay) : NaN;
    if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 30000);
  }
  return null;
};

// A 429 can mean either "too many requests this minute" (retryable) or
// "daily free-tier quota is gone" (not worth retrying today).
const isDailyQuotaExhausted = (data: GeminiErrorResponse | null): boolean => {
  const details = data?.error?.details;
  if (!Array.isArray(details)) return false;
  return details.some(detail => {
    const violations = (detail as { violations?: Array<{ quotaId?: string }> })?.violations;
    return Array.isArray(violations) && violations.some(v => /PerDay/i.test(v?.quotaId || ''));
  });
};

class GeminiFatalError extends Error {}

export const generateGeminiText = async (
  prompt: string,
  generationConfig: GeminiGenerationConfig = {}
): Promise<string> => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Gemini пока не подключён. Задайте EXPO_PUBLIC_GEMINI_API_KEY в .env (или в переменных окружения EAS) и пересоберите приложение.');
  }

  const model = getModel();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await delay(Math.min(1000 * 2 ** (attempt - 1), 8000));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
          },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig
          }),
          signal: controller.signal
        }
      );

      clearTimeout(timer);

      const data = await response.json().catch(() => null) as GeminiResponse | GeminiErrorResponse | null;

      if (!response.ok) {
        const errorData = data as GeminiErrorResponse | null;

        if (response.status === 429) {
          if (isDailyQuotaExhausted(errorData)) {
            throw new GeminiFatalError(
              `Исчерпан суточный лимит бесплатного доступа к Gemini для модели «${model}». Лимит обновится в течение суток, либо смените модель на более лёгкую (EXPO_PUBLIC_GEMINI_MODEL) или подключите биллинг в Google Cloud.`
            );
          }
          const wait = getRetryDelayMs(errorData);
          if (attempt < MAX_ATTEMPTS - 1) {
            await delay(wait ?? 20000);
            continue;
          }
          throw new GeminiFatalError('Слишком много запросов к Gemini подряд. Подождите минуту и попробуйте снова.');
        }

        if (response.status === 503 || response.status === 500) {
          if (attempt < MAX_ATTEMPTS - 1) {
            await delay(getRetryDelayMs(errorData) ?? 2000);
            continue;
          }
          throw new GeminiFatalError('Серверы Gemini временно перегружены. Попробуйте через минуту.');
        }

        if (response.status === 404) {
          throw new GeminiFatalError(
            `Модель «${model}» недоступна для этого ключа. Укажите доступную модель в EXPO_PUBLIC_GEMINI_MODEL (например, gemini-3.5-flash-lite).`
          );
        }

        if (response.status === 400 || response.status === 403) {
          throw new GeminiFatalError(errorData?.error?.message || `Gemini отклонил запрос (${response.status}). Проверьте ключ API и его ограничения.`);
        }

        lastError = new Error(errorData?.error?.message || `Gemini вернул ошибку ${response.status}.`);
        continue;
      }

      const candidate = (data as GeminiResponse | null)?.candidates?.[0];
      const text = candidate?.content?.parts
        ?.map(part => part.text || '')
        .join('')
        .trim();

      if (!text) {
        if (candidate?.finishReason === 'MAX_TOKENS') {
          throw new GeminiFatalError('Ответ Gemini не поместился в лимит токенов. Увеличьте maxOutputTokens.');
        }
        lastError = new Error('Gemini вернул пустой ответ.');
        continue;
      }
      return text;
    } catch (err: any) {
      clearTimeout(timer);
      if (err instanceof GeminiFatalError) throw err;
      if (err?.name === 'AbortError') {
        lastError = new Error('Превышено время ожидания ответа от Gemini (35 сек).');
        continue;
      }
      lastError = new Error(err?.message || 'Ошибка сети при обращении к Gemini.');
    }
  }

  throw lastError || new Error('Не удалось получить ответ от Gemini.');
};
