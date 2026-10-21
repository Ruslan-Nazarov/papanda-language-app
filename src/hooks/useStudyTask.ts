import { useEffect, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { checkAborted, generationContext, isAbortError } from '../services/generationControl';

export function useStudyTask(scope: string) {
  const focused = useIsFocused();
  const active = useRef<AbortController | null>(null);
  const [phase, setPhase] = useState('');
  const [error, setError] = useState('');
  const cancel = () => { active.current?.abort(); active.current = null; setPhase(''); };
  useEffect(() => { cancel(); setError(''); return cancel; }, [scope, focused]);
  const run = async <T,>(work: (signal: AbortSignal, phase: (text: string) => void) => Promise<T>, accept: (value: T) => void) => {
    cancel(); setError('');
    const controller = new AbortController(); active.current = controller;
    const globalSignal = generationContext('workshop').signal;
    const abort = () => controller.abort();
    globalSignal.addEventListener('abort', abort, { once: true });
    if (globalSignal.aborted) abort();
    setPhase('Подготовка…');
    try {
      const value = await work(controller.signal, text => { if (active.current === controller && !controller.signal.aborted) setPhase(text); });
      checkAborted(controller.signal);
      if (active.current === controller) accept(value);
    } catch (err) {
      if (active.current === controller && !isAbortError(err)) setError(err instanceof Error ? err.message : 'Запрос не выполнен.');
    } finally {
      globalSignal.removeEventListener('abort', abort);
      if (active.current === controller) { active.current = null; setPhase(''); }
    }
  };
  return { phase, error, run, cancel, setError };
}
