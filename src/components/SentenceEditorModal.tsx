import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal, TextInput, Platform, KeyboardAvoidingView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { useSentenceEditor } from '../hooks/useSentenceEditor';
import { STRICT_ORDER, ROLE_TRANSLATIONS, getRoleColor } from '../constants/sentencePresentation';
import { ACCENT } from '../constants/theme';

type Props = { editor: ReturnType<typeof useSentenceEditor> };

export default function SentenceEditorModal({ editor }: Props) {
  const insets = useSafeAreaInsets();
  const { isModalVisible, editingSentenceId, newSentenceText, setNewSentenceText,
    parsedTokens, parseSentence, updateTokenRole, updateTokenParts,
    updateTokenTranslation, toggleTokenDict, saveSentence, close } = editor;
  return (
    <Modal visible={isModalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalContainer}>
        <Text style={styles.modalHeader}>{editingSentenceId ? 'Редактировать предложение' : 'Добавить предложение'}</Text>
        <TextInput
          style={styles.mainInput}
          placeholder="Введите предложение"
          value={newSentenceText}
          onChangeText={setNewSentenceText}
          multiline
        />
        <TouchableOpacity style={[styles.button, {marginBottom: 15, width: '100%'}]} onPress={parseSentence}>
          <Text style={styles.buttonText}>Разбить на слова (Сброс)</Text>
        </TouchableOpacity>

        <ScrollView style={{flex: 1, width: '100%'}} contentContainerStyle={{paddingBottom: 20}}>
          {parsedTokens.map((token, i) => {
            const partsStr = (token.parts && token.parts.length > 0) ? token.parts.join('-') : token.text;

            return (
              <View key={i} style={styles.tokenEditorCard}>
                <View style={styles.tokenEditorHeader}>
                  <Text style={styles.tokenEditorText}>{token.text}</Text>
                  <TouchableOpacity
                    style={[styles.dictToggleBtn, token.is_in_my_dict && styles.dictToggleBtnActive]}
                    onPress={() => toggleTokenDict(i)}
                  >
                    <Text style={[styles.dictToggleText, token.is_in_my_dict && {color: '#FFF'}]}>
                      {token.is_in_my_dict ? 'В словаре ✓' : 'Не в словаре'}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.tokenInputsRow}>
                  <View style={styles.tokenInputGroup}>
                    <Text style={styles.tokenInputLabel}>Состав (через дефис)</Text>
                    <TextInput
                      style={styles.tokenInput}
                      placeholder="напр. оқы-ма-ды"
                      value={partsStr}
                      onChangeText={(val) => updateTokenParts(i, val)}
                    />
                  </View>
                  <View style={styles.tokenInputGroup}>
                    <Text style={styles.tokenInputLabel}>Перевод слова</Text>
                    <TextInput
                      style={styles.tokenInput}
                      placeholder="Перевод"
                      value={token.translation}
                      onChangeText={(val) => updateTokenTranslation(i, val)}
                    />
                  </View>
                </View>

                <Text style={styles.tokenInputLabel}>Роль в предложении</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{flexDirection: 'row', paddingTop: 5}}>
                  {STRICT_ORDER.map(role => {
                    const isActive = token.role === role;
                    return (
                      <TouchableOpacity
                        key={role}
                        style={[
                          styles.roleSelectBtn,
                          isActive && { backgroundColor: getRoleColor(role), borderColor: getRoleColor(role) }
                        ]}
                        onPress={() => updateTokenRole(i, role)}
                      >
                        <Text style={[styles.roleSelectText, isActive && {color: '#FFF', fontWeight: 'bold'}]}>
                          {ROLE_TRANSLATIONS[role] || role.replace('_', ' ')}
                        </Text>
                      </TouchableOpacity>
                    );
                    })}
                  </ScrollView>
                </View>
              );
            })}
          </ScrollView>

          <View style={[styles.controls, {width: '100%', marginBottom: insets.bottom || 20}]}>
            <TouchableOpacity style={[styles.button, styles.buttonSecondary]} onPress={close}>
              <Text style={styles.buttonText}>Отмена</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, styles.btnKnown]} onPress={saveSentence}>
              <Text style={styles.buttonText}>Сохранить</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

  );
}

const styles = StyleSheet.create({
  modalContainer: { flex: 1, padding: 20, backgroundColor: '#F8FAFC', alignItems: 'center' },
  modalHeader: { fontSize: 22, fontWeight: 'bold', marginBottom: 15, color: '#1E293B' },
  mainInput: { width: '100%', borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: '#FFF', padding: 15, borderRadius: 10, marginBottom: 15, fontSize: 16, minHeight: 80, textAlignVertical: 'top' },
  button: { flex: 1, backgroundColor: ACCENT, padding: 12, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#FFF', fontWeight: 'bold', fontSize: 13, textAlign: 'center' },
  tokenEditorCard: { backgroundColor: '#FFF', borderRadius: 12, padding: 15, marginBottom: 15, borderWidth: 1, borderColor: '#E2E8F0', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 2 },
  tokenEditorHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  tokenEditorText: { fontSize: 20, fontWeight: 'bold', color: '#0F172A' },
  dictToggleBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#CBD5E1' },
  dictToggleBtnActive: { backgroundColor: '#EAB308', borderColor: '#EAB308' },
  dictToggleText: { fontSize: 12, color: '#475569', fontWeight: '600' },
  tokenInputsRow: { flexDirection: 'row', gap: 10, marginBottom: 15 },
  tokenInputGroup: { flex: 1 },
  tokenInputLabel: { fontSize: 12, color: '#64748B', marginBottom: 4, fontWeight: '500' },
  tokenInput: { width: '100%', borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#F8FAFC', padding: 10, borderRadius: 8, fontSize: 14 },
  roleSelectBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', marginHorizontal: 4 },
  roleSelectText: { fontSize: 12, color: '#475569', fontWeight: '500' },
  controls: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 10, gap: 10 },
  buttonSecondary: { backgroundColor: '#6C757D' },
  btnKnown: { backgroundColor: '#28A745' },
});
