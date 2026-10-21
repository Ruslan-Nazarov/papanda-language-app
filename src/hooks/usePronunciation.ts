import { useCallback, useEffect, useRef, useState } from 'react';
import { LANGUAGES } from '../constants/languages';
import { explainPronunciationWithAI, PronunciationMode } from '../services/aiService';

interface PronunciationWord { word: string; langCode: string; translation: string }

/** Shared modal state; a late AI response must not replace a newer card's result. */
export function usePronunciation() {
  const [isPronunciationModalVisible, setVisible] = useState(false);
  const [pronunciationExplanation, setExplanation] = useState<string | null>(null);
  const [isPronunciationLoading, setLoading] = useState(false);
  const [pronunciationMode, setMode] = useState<PronunciationMode>('short');
  const [pronunciationError, setError] = useState<string | null>(null);
  const currentWord = useRef<PronunciationWord | null>(null);
  const explanations = useRef<Partial<Record<PronunciationMode, string>>>({});
  const requestId = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { requestId.current++; controller.current?.abort(); }, []);

  const setIsPronunciationModalVisible = useCallback((visible: boolean) => {
    if (!visible) { controller.current?.abort(); requestId.current++; setLoading(false); }
    setVisible(visible);
  }, []);
  const setPronunciationExplanation = useCallback((value: string | null) => {
    controller.current?.abort();
    requestId.current++;
    setLoading(false);
    currentWord.current = null;
    explanations.current = {};
    setMode('short');
    setError(null);
    setExplanation(value);
  }, []);
  const loadPronunciation = useCallback(async (entry: PronunciationWord, mode: PronunciationMode) => {
    controller.current?.abort();
    const id = ++requestId.current;
    setMode(mode);
    setError(null);
    const cached = explanations.current[mode];
    if (cached !== undefined) {
      setExplanation(cached);
      setLoading(false);
      return;
    }
    const activeController = new AbortController();
    controller.current = activeController;
    setExplanation(null);
    setLoading(true);
    try {
      const language = LANGUAGES.find(item => item.code === entry.langCode)?.label || entry.langCode;
      const explanation = await explainPronunciationWithAI(entry.word, language, entry.translation, activeController.signal, mode);
      if (id === requestId.current) {
        explanations.current[mode] = explanation;
        setExplanation(explanation);
      }
    } catch (error) {
      if (id !== requestId.current) return;
      setError(error instanceof Error ? error.message : 'Не удалось загрузить произношение');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);
  const handlePronunciation = useCallback((word: string, langCode: string, translation: string) => {
    const entry = { word, langCode, translation };
    currentWord.current = entry;
    explanations.current = {};
    setVisible(true);
    return loadPronunciation(entry, 'short');
  }, [loadPronunciation]);
  const changePronunciationMode = useCallback((mode: PronunciationMode) => {
    if (currentWord.current) return loadPronunciation(currentWord.current, mode);
  }, [loadPronunciation]);
  const retryPronunciation = useCallback(() => changePronunciationMode(pronunciationMode), [changePronunciationMode, pronunciationMode]);
  return { isPronunciationModalVisible, setIsPronunciationModalVisible, pronunciationExplanation,
    setPronunciationExplanation, isPronunciationLoading, handlePronunciation,
    pronunciationMode, changePronunciationMode, pronunciationError, retryPronunciation };
}
