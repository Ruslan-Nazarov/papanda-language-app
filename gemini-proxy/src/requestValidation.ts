export interface GenerationConfig {
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  responseMimeType?: 'application/json';
  responseJsonSchema?: unknown;
  thinkingConfig?: { thinkingBudget?: number; includeThoughts?: boolean };
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const inRange = (value: unknown, min: number, max: number, integer = false) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));

export function parseGenerationRequest(value: unknown): { prompt: string; provider?: string; generationConfig: GenerationConfig } {
  if (!record(value) || typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 60_000) {
    throw new Error('prompt must be a non-empty string of at most 60000 characters.');
  }
  if (value.provider !== undefined && !['gemini', 'cerebras', 'groq'].includes(String(value.provider))) {
    throw new Error('Unknown provider.');
  }
  const config = value.generationConfig ?? {};
  if (!record(config) ||
    (config.temperature !== undefined && !inRange(config.temperature, 0, 2)) ||
    (config.topP !== undefined && !inRange(config.topP, 0, 1)) ||
    (config.maxOutputTokens !== undefined && !inRange(config.maxOutputTokens, 1, 16384, true)) ||
    (config.responseMimeType !== undefined && config.responseMimeType !== 'application/json') ||
    (config.responseJsonSchema !== undefined && !record(config.responseJsonSchema))) {
    throw new Error('Invalid generationConfig.');
  }
  if (config.thinkingConfig !== undefined) {
    const thinking = config.thinkingConfig;
    if (!record(thinking) ||
      (thinking.thinkingBudget !== undefined && !inRange(thinking.thinkingBudget, 0, 8192, true)) ||
      (thinking.includeThoughts !== undefined && typeof thinking.includeThoughts !== 'boolean')) {
      throw new Error('Invalid thinkingConfig.');
    }
  }
  return { prompt: value.prompt, provider: value.provider as string | undefined, generationConfig: config as GenerationConfig };
}

/** Bound memory use even for a chunked body without Content-Length. */
export async function readRequestJSON(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Body must be JSON.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 256_000) {
        await reader.cancel();
        throw new Error('Request body exceeds 256000 bytes.');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
