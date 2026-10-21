import { create } from 'zustand';

export const abortError = () => Object.assign(new Error('Генерация отменена.'), { name: 'AbortError' });
export function checkAborted(signal?: AbortSignal) { if (signal?.aborted) throw abortError(); }
export const isAbortError = (error: unknown) => error instanceof Error && error.name === 'AbortError';
const contexts = new Map<string, { signal: AbortSignal; controller: AbortController; version: number }>();
let version = 0;
export const useGenerationStatus = create<{ phases: Record<string, string> }>(() => ({ phases: {} }));
export function generationContext(language: string) {
  let context = contexts.get(language);
  if (!context) { const controller = new AbortController(); context = { controller, signal: controller.signal, version: ++version }; contexts.set(language, context); }
  return context;
}
export function cancelGenerations(language?: string) {
  for (const [code, context] of contexts) if (!language || code === language) {
    context.controller.abort(); contexts.delete(code);
  }
  useGenerationStatus.setState(state => ({ phases: language ? { ...state.phases, [language]: '' } : {} }));
}
export function generationPhase(language: string, signal: AbortSignal, phase: string) {
  checkAborted(signal);
  useGenerationStatus.setState(state => ({ phases: { ...state.phases, [language]: phase } }));
}
export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  checkAborted(signal);
  return new Promise((resolve, reject) => {
    const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(done, ms);
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(abortError()); };
    signal?.addEventListener('abort', abort, { once: true });
  });
}
