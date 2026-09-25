import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { LANGUAGES } from '../constants/languages';
import { explainPronunciationWithAI } from '../services/aiService';

/** Shared modal state; a late AI response must not replace a newer card's result. */
export function usePronunciation() {
  const [isPronunciationModalVisible, setVisible] = useState(false);
  const [pronunciationExplanation, setExplanation] = useState<string | null>(null);
  const [isPronunciationLoading, setLoading] = useState(false);
  const requestId = useRef(0);
  useEffect(() => () => { requestId.current++; }, []);

  const setIsPronunciationModalVisible = useCallback((visible: boolean) => {
    if (!visible) { requestId.current++; setLoading(false); }
    setVisible(visible);
  }, []);
  const setPronunciationExplanation = useCallback((value: string | null) => {
    requestId.current++;
    setLoading(false);
    setExplanation(value);
  }, []);
  const handlePronunciation = useCallback(async (word: string, langCode: string, translation: string) => {
    const id = ++requestId.current;
    setExplanation(null);
    setLoading(true);
    setVisible(true);
    try {
      const language = LANGUAGES.find(item => item.code === langCode)?.label || langCode;
      const explanation = await explainPronunciationWithAI(word, language, translation);
      if (id === requestId.current) setExplanation(explanation);
    } catch (error) {
      if (id !== requestId.current) return;
      Alert.alert('Ошибка', error instanceof Error ? error.message : 'Не удалось загрузить произношение');
      setVisible(false);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);
  return { isPronunciationModalVisible, setIsPronunciationModalVisible, pronunciationExplanation,
    setPronunciationExplanation, isPronunciationLoading, handlePronunciation };
}
