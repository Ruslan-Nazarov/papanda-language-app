import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Modal, ScrollView, Alert } from 'react-native';
import { Word } from '../models/types';
import { useStore } from '../store/useStore';
import { LANGUAGES } from '../constants/languages';
import { getWordTranslation } from '../utils/words';
import { ACCENT } from '../constants/theme';

interface EditWordModalProps {
  visible: boolean;
  onClose: () => void;
  wordToEdit?: Word | null; // If null, adding new word
}

export default function EditWordModal({ visible, onClose, wordToEdit }: EditWordModalProps) {
  const { words, activeLanguages, updateWordDetails, addCustomWord, userWordProgress, setWordAiVerification } = useStore();
  const [tempWord, setTempWord] = useState<{
    eng: string;
    ru: string;
    personal_association: string;
    translations: Record<string, string>;
  }>({
    eng: '',
    ru: '',
    personal_association: '',
    translations: {}
  });

  const wordKey = wordToEdit?.eng || wordToEdit?.word || '';
  // A token tap can hand us a draft Word for a form that isn't in the dictionary
  // yet (see SentenceTrainerScreen.handleTokenPress) — treat that the same as
  // "adding new", since updateWordDetails only touches words that already exist.
  const existsInStore = Boolean(wordKey) && words.some(w => (w.eng || w.word) === wordKey);
  const isAddingNew = !wordToEdit || !existsInStore;
  const aiVerification = wordKey && existsInStore ? userWordProgress[wordKey]?.ai_verification : undefined;

  useEffect(() => {
    if (visible) {
      if (wordToEdit) {
        const trans: Record<string, string> = {};
        activeLanguages.forEach(l => {
          trans[l] = getWordTranslation(wordToEdit, l);
        });

        setTempWord({
          eng: wordToEdit.source_language ? (wordToEdit.word || '') : (wordToEdit.eng || wordToEdit.word || ''),
          ru: wordToEdit.ru || wordToEdit.translations?.ru || '',
          personal_association: wordToEdit.personal_association || '',
          translations: trans
        });
      } else {
        const trans: Record<string, string> = {};
        activeLanguages.forEach(l => { trans[l] = ''; });
        setTempWord({ eng: '', ru: '', personal_association: '', translations: trans });
      }
    }
  }, [visible, wordToEdit, activeLanguages]);

  // Only the fields that actually changed vs. `original` — so saving (e.g. just to
  // add a personal association) doesn't freeze every translation as a permanent
  // per-word override and block future corrections to the shipped dictionary data.
  const buildChangedDetails = (original: Word | null) => {
    const details: {
      word?: string;
      ru?: string;
      translations?: Record<string, string>;
      personal_association?: string;
    } = {};

    const newRu = tempWord.ru.trim();
    if (newRu !== (original?.ru || original?.translations?.ru || '').trim()) {
      details.ru = newRu;
    }

    const changedTranslations: Record<string, string> = {};
    activeLanguages.forEach(lang => {
      const before = original ? getWordTranslation(original, lang) : '';
      const after = (tempWord.translations[lang] || '').trim();
      if (after !== before) changedTranslations[lang] = after;
    });
    if (Object.keys(changedTranslations).length > 0) {
      details.translations = changedTranslations;
    }

    const newAssoc = tempWord.personal_association.trim();
    if (newAssoc !== (original?.personal_association || '')) {
      details.personal_association = newAssoc;
    }

    return details;
  };

  const handleSave = () => {
    const trimmedOriginal = tempWord.eng.trim();

    if (isAddingNew) {
      if (!trimmedOriginal) {
        Alert.alert('Заполните поле', "Поле «Оригинал» не может быть пустым.");
        return;
      }

      // A draft from tapping an unrecognized sentence token — check once more for
      // an existing dictionary entry (e.g. the user retyped it to match one)
      // before creating a duplicate.
      const sourceLanguage = wordToEdit?.source_language;
      const normalizedOriginal = trimmedOriginal.toLowerCase();
      const existingMatch = sourceLanguage
        ? words.find(w =>
            (w.source_language === sourceLanguage && (w.word || '').toLowerCase() === normalizedOriginal) ||
            getWordTranslation(w, sourceLanguage).toLowerCase() === normalizedOriginal
          )
        : undefined;

      if (existingMatch) {
        const existingKey = existingMatch.eng || existingMatch.word || '';
        const details = buildChangedDetails(existingMatch);
        if (Object.keys(details).length > 0) updateWordDetails(existingKey, details);
      } else {
        const eng = sourceLanguage ? `user:${sourceLanguage}:${normalizedOriginal}` : trimmedOriginal;
        const newWord: Word = {
          id: wordToEdit?.id || ('custom_' + Date.now().toString()),
          word: trimmedOriginal,
          eng,
          ru: tempWord.ru.trim(),
          personal_association: tempWord.personal_association.trim(),
          translations: { ...tempWord.translations, ...(sourceLanguage ? { [sourceLanguage]: trimmedOriginal } : {}) },
          source_language: sourceLanguage,
          count: 0,
          is_learned: 0,
          knowledge_stats: {},
          show_stats: {},
          is_favorite: false
        };
        addCustomWord(newWord);
      }
    } else {
      const details = buildChangedDetails(wordToEdit);
      if (Object.keys(details).length > 0) {
        updateWordDetails(wordKey, details);
      }

      if (aiVerification?.status === 'flagged') {
        setWordAiVerification(wordKey, { status: 'verified', checkedAt: new Date().toISOString() });
      }
    }
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{isAddingNew ? 'Новое слово' : 'Редактировать слово'}</Text>

          <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
            {aiVerification?.status === 'flagged' && aiVerification.issues && aiVerification.issues.length > 0 && (
              <View style={styles.aiSuggestionBox}>
                <Text style={styles.aiSuggestionTitle}>💡 Замечания и подсказки ИИ:</Text>
                {aiVerification.issues.map((iss, i) => (
                  <View key={i} style={styles.aiIssueRow}>
                    <Text style={styles.aiIssueText}>
                      • {iss.lang.toUpperCase()}: {iss.issue}
                    </Text>
                    {!!iss.suggestion && (
                      <TouchableOpacity
                        style={styles.applySuggestionBtn}
                        onPress={() => {
                          setTempWord(prev => ({
                            ...prev,
                            translations: { ...prev.translations, [iss.lang]: iss.suggestion! }
                          }));
                        }}
                      >
                        <Text style={styles.applySuggestionText}>Вставить «{iss.suggestion}»</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </View>
            )}

            {isAddingNew && (
              <>
                <Text style={styles.inputLabel}>Оригинал (Слово/Ключ)</Text>
                <TextInput
                  style={styles.modalInput}
                  value={tempWord.eng}
                  onChangeText={(text) => setTempWord({...tempWord, eng: text})}
                  placeholder="Например: Apple"
                  editable={isAddingNew}
                />
              </>
            )}

            <Text style={styles.inputLabel}>Русский перевод</Text>
            <TextInput
              style={styles.modalInput}
              value={tempWord.ru}
              onChangeText={(text) => setTempWord({...tempWord, ru: text})}
              placeholder="Например: Яблоко"
            />

            {activeLanguages.map(lang => {
              const langLabel = LANGUAGES.find(l => l.code === lang)?.label || lang.toUpperCase();
              return (
                <View key={lang}>
                  <Text style={styles.inputLabel}>Перевод ({langLabel})</Text>
                  <TextInput
                    style={styles.modalInput}
                    value={tempWord.translations[lang]}
                    onChangeText={(text) => setTempWord({...tempWord, translations: {...tempWord.translations, [lang]: text}})}
                    placeholder={`Перевод на ${langLabel}`}
                  />
                </View>
              );
            })}

            <Text style={styles.inputLabel}>Личная ассоциация</Text>
            <TextInput
              style={[styles.modalInput, { minHeight: 60 }]}
              multiline
              value={tempWord.personal_association}
              onChangeText={(text) => setTempWord({...tempWord, personal_association: text})}
              placeholder="Смысловой якорь..."
            />
          </ScrollView>

          <View style={styles.modalButtons}>
            <TouchableOpacity style={[styles.modalBtn, styles.modalCancel]} onPress={onClose}>
              <Text style={styles.modalCancelText}>Отмена</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.modalBtn, styles.modalSave]} onPress={handleSave}>
              <Text style={styles.modalSaveText}>Сохранить</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 6,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1A202C',
  },
  modalScroll: {
    maxHeight: 400,
    marginVertical: 10,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4A5568',
    marginBottom: 6,
    marginTop: 10,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#CBD5E0',
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    backgroundColor: '#F8FAFC',
    marginBottom: 4,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 10,
  },
  modalBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  modalCancel: {
    backgroundColor: '#EDF2F7',
  },
  modalCancelText: {
    color: '#4A5568',
    fontWeight: 'bold',
  },
  modalSave: {
    backgroundColor: ACCENT,
  },
  modalSaveText: {
    color: '#FFF',
    fontWeight: 'bold',
  },
  aiSuggestionBox: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    gap: 6,
  },
  aiSuggestionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#92400E',
    marginBottom: 2,
  },
  aiIssueRow: {
    gap: 4,
  },
  aiIssueText: {
    fontSize: 12,
    color: '#78350F',
  },
  applySuggestionBtn: {
    backgroundColor: '#FEF3C7',
    borderColor: '#F59E0B',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  applySuggestionText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#B45309',
  },
});
