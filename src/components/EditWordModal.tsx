import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { Word } from '../models/types';
import { useStore } from '../store/useStore';
import { LANGUAGES } from '../constants/languages';

interface EditWordModalProps {
  visible: boolean;
  onClose: () => void;
  wordToEdit?: Word | null; // If null, adding new word
}

export default function EditWordModal({ visible, onClose, wordToEdit }: EditWordModalProps) {
  const { activeLanguages, updateWordDetails, addCustomWord, saveWordAssociation } = useStore();

  const [tempWord, setTempWord] = useState({ eng: '', ru: '', personal_association: '', translations: {} as Record<string, string> });
  const isAddingNew = !wordToEdit;

  useEffect(() => {
    if (visible) {
      if (wordToEdit) {
        const trans: Record<string, string> = {};
        activeLanguages.forEach(l => {
          trans[l] = (wordToEdit[l as keyof Word] || (wordToEdit.translations && wordToEdit.translations[l]) || '') as string;
        });

        setTempWord({
          eng: wordToEdit.eng || wordToEdit.word || '',
          ru: wordToEdit.ru || '',
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
        alert("Поле 'Оригинал' не может быть пустым");
        return;
      }
      const newWord: Word = {
        id: 'custom_' + Date.now().toString(),
        word: tempWord.eng.trim(),
        eng: tempWord.eng.trim(),
        ru: tempWord.ru.trim(),
        translations: tempWord.translations,
        personal_association: tempWord.personal_association.trim(),
        count: 0,
        is_learned: 0,
        knowledge_stats: {},
        show_stats: {}
      };
      addCustomWord(newWord);
    } else if (wordToEdit) {
      const editingWordKey = wordToEdit.eng || wordToEdit.word || '';
      updateWordDetails(editingWordKey, {
        word: tempWord.eng.trim(),
        ru: tempWord.ru.trim(),
        translations: tempWord.translations
      });
      saveWordAssociation(editingWordKey, tempWord.personal_association.trim());
    }
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{isAddingNew ? 'Новое слово' : 'Редактировать'}</Text>

          <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
            {isAddingNew && (
              <>
                <Text style={styles.inputLabel}>Оригинал (Англ / Основной ключ)*</Text>
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
    fontWeight: '600',
  },
  modalSave: {
    backgroundColor: '#007BFF',
  },
  modalSaveText: {
    color: '#FFF',
    fontWeight: 'bold',
  },
});
