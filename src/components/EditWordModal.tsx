import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Modal, ScrollView, Alert } from 'react-native';
import { Word } from '../models/types';
import { useStore } from '../store/useStore';
import { LANGUAGES } from '../constants/languages';
import { getWordTranslation } from '../utils/words';

interface EditWordModalProps {
  visible: boolean;
  onClose: () => void;
  wordToEdit?: Word | null; // If null, adding new word
}

export default function EditWordModal({ visible, onClose, wordToEdit }: EditWordModalProps) {
  const { activeLanguages, updateWordDetails, addCustomWord, userWordProgress, setWordAiVerification } = useStore();
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

  const isAddingNew = !wordToEdit;
  const wordKey = wordToEdit?.eng || wordToEdit?.word || '';
  const aiVerification = wordKey ? userWordProgress[wordKey]?.ai_verification : undefined;

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

  const handleSave = () => {
    if (isAddingNew) {
      if (!tempWord.eng.trim()) {
        Alert.alert('Заполните поле', "Поле «Оригинал» не может быть пустым.");
        return;
      }
      const newWord: Word = {
        id: 'custom_' + Date.now().toString(),
        word: tempWord.eng.trim(),
        eng: tempWord.eng.trim(),
        ru: tempWord.ru.trim(),
        personal_association: tempWord.personal_association.trim(),
        translations: { ...tempWord.translations },
        count: 0,
        is_learned: 0,
        knowledge_stats: {},
        show_stats: {},
        is_favorite: false
      };
      addCustomWord(newWord);
    } else {
      const details: {
        word?: string;
        ru?: string;
        translations?: Record<string, string>;
        personal_association?: string;
      } = {
        personal_association: tempWord.personal_association.trim(),
        translations: { ...tempWord.translations }
      };

      if (wordToEdit.source_language) {
        details.word = tempWord.eng.trim();
      } else {
        details.word = tempWord.eng.trim();
      }

      details.ru = tempWord.ru.trim();

      updateWordDetails(wordKey, details);

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
    backgroundColor: '#007BFF',
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
