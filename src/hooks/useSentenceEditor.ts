import { useState } from 'react';
import { Alert } from 'react-native';
import type { Sentence, SyntaxRole, Token } from '../models/types';
import { tokensMatchSentence } from '../utils/sentenceValidation';
import { useStore } from '../store/useStore';

/** Editing stays local until Save; opening a card always starts a fresh draft. */
export function useSentenceEditor(language: string, setTargetSentenceId: (id: string) => void) {
  const { addSentence, updateSentence } = useStore.getState();
  // Modal state
  const [isModalVisible, setModalVisible] = useState(false);
  const [editingSentenceId, setEditingSentenceId] = useState<string | null>(null);
  const [originalSentence, setOriginalSentence] = useState<Sentence | null>(null);
  const [newSentenceText, setNewSentenceText] = useState('');
  const [parsedTokens, setParsedTokens] = useState<Token[]>([]);

  const openAddModal = () => {
    setEditingSentenceId(null);
    setOriginalSentence(null);
    setNewSentenceText('');
    setParsedTokens([]);
    setModalVisible(true);
  };

  const openEditModal = (currentSentence: Sentence | undefined) => {
    if (!currentSentence) return;
    setEditingSentenceId(currentSentence.id);
    setOriginalSentence(currentSentence);
    setNewSentenceText(currentSentence.sentence || currentSentence.words.map(w => w.text).join(' '));
    // Deep copy to avoid mutating store directly before save
    setParsedTokens(JSON.parse(JSON.stringify(currentSentence.words)));
    setModalVisible(true);
  };

  const parseSentence = () => {
    const words = newSentenceText.trim().split(/\s+/).filter(Boolean);
    const tokens: Token[] = words.map((w) => ({
      text: w,
      label: w,
      translation: '',
      role: 'Other',
      is_in_my_dict: false,
      parts: [w]
    }));
    setParsedTokens(tokens);
  };

  const updateTokenRole = (index: number, role: SyntaxRole) => {
    setParsedTokens(previous => previous.map((token, i) => i === index ? { ...token, role } : token));
  };

  const updateTokenParts = (index: number, partsStr: string) => {
    const parts = partsStr.split('-').map(p => p.trim()).filter(Boolean);
    setParsedTokens(previous => previous.map((token, i) => i === index ? { ...token, parts } : token));
  };

  const updateTokenTranslation = (index: number, trans: string) => {
    setParsedTokens(previous => previous.map((token, i) => i === index ? { ...token, translation: trans } : token));
  };

  const toggleTokenDict = (index: number) => {
    setParsedTokens(previous => previous.map((token, i) => i === index ? { ...token, is_in_my_dict: !token.is_in_my_dict } : token));
  };

  const saveSentence = () => {
    if (!newSentenceText.trim() || parsedTokens.length === 0 || parsedTokens.some(token => !token.text.trim())) {
      Alert.alert('Не хватает данных', 'Введите предложение и разберите его на слова.');
      return;
    }

    if (!tokensMatchSentence(newSentenceText.trim(), parsedTokens)) {
      Alert.alert('Обновите разбор', 'Текст изменился. Нажмите «Разбить на слова», затем проверьте перевод и роли.');
      return;
    }

    if (editingSentenceId) {
      updateSentence(editingSentenceId, {
        ...originalSentence!,
        id: editingSentenceId,
        language,
        sentence: newSentenceText.trim(),
        words: parsedTokens
      });
      setTargetSentenceId(editingSentenceId);
    } else {
      const id = `manual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      addSentence({
        id,
        language,
        sentence: newSentenceText.trim(),
        words: parsedTokens
      });
      setTargetSentenceId(id);
    }

    setModalVisible(false);
  };

  return { isModalVisible, editingSentenceId, newSentenceText, setNewSentenceText,
    parsedTokens, openAddModal, openEditModal, parseSentence, updateTokenRole,
    updateTokenParts, updateTokenTranslation, toggleTokenDict, saveSentence,
    close: () => setModalVisible(false) };
}
