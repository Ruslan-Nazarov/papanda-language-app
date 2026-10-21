import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal, ActivityIndicator } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { ACCENT, ACCENT_DARK } from '../constants/theme';
import { PronunciationMode } from '../services/aiService';

interface Props {
  visible: boolean;
  loading: boolean;
  explanation: string | null;
  mode: PronunciationMode;
  onModeChange: (mode: PronunciationMode) => void;
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
}

export default function PronunciationModal({ visible, loading, explanation, mode, onModeChange, error, onRetry, onClose }: Props) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.pronunciationModalOverlay}>
        <View style={styles.pronunciationModalContent}>
          <View style={styles.pronunciationModalHeader}>
            <Text style={styles.pronunciationModalTitle}>Как сказать</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Закрыть разбор произношения" testID="pronunciation-close" onPress={onClose} hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}>
              <Text style={styles.pronunciationModalCloseText}>✕</Text>
            </TouchableOpacity>
          </View>

          <View accessibilityRole="tablist" style={styles.modeButtons}>
            {(['short', 'detailed'] as const).map(value => (
              <TouchableOpacity key={value} accessibilityRole="tab"
                accessibilityState={{ selected: mode === value }}
                aria-selected={mode === value}
                testID={`pronunciation-mode-${value}`}
                style={[styles.modeButton, mode === value && styles.modeButtonSelected]}
                onPress={() => { if (mode !== value) onModeChange(value); }}>
                <Text style={[styles.modeText, mode === value && styles.modeTextSelected]}>
                  {value === 'short' ? 'Коротко' : 'Подробнее'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {mode === 'short' && <Text style={styles.approximationLabel}>Примерно по-русски · ударение отмечено знаком ´</Text>}
          <ScrollView key={mode} style={styles.pronunciationModalScroll}>
            {loading ? (
              <View style={styles.pronunciationLoadingContainer}>
                <ActivityIndicator size="large" color={ACCENT} />
                <Text style={styles.pronunciationLoadingText}>{mode === 'short' ? 'Готовим короткую подсказку…' : 'Готовим подробный разбор…'}</Text>
              </View>
            ) : error ? (
              <View>
                <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text>
                <TouchableOpacity accessibilityRole="button" testID="pronunciation-retry" style={styles.modeButton} onPress={onRetry}>
                  <Text style={styles.modeText}>Повторить</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <Markdown
                style={{
                  body: { fontSize: 16, lineHeight: 24, color: '#334155' },
                  strong: { fontWeight: '700', color: '#0F172A' },
                  bullet_list: { marginTop: 10, marginBottom: 10 },
                  list_item: { marginBottom: 6 },
                }}
              >
                {explanation || ''}
              </Markdown>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  pronunciationModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  pronunciationModalContent: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: '80%',
    padding: 20,
  },
  pronunciationModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  pronunciationModalTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1E293B',
  },
  pronunciationModalCloseText: {
    fontSize: 24,
    color: '#64748B',
    fontWeight: '300',
  },
  pronunciationModalScroll: {
    flex: 1,
  },
  modeButtons: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  modeButton: { flex: 1, minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  modeButtonSelected: { backgroundColor: ACCENT_DARK },
  modeText: { fontSize: 15, color: '#334155', fontWeight: '600' },
  modeTextSelected: { color: '#FFF' },
  approximationLabel: { fontSize: 13, lineHeight: 19, color: '#64748B', marginBottom: 12 },
  errorText: { color: '#B91C1C', fontSize: 15, lineHeight: 22, marginBottom: 12 },
  pronunciationLoadingContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pronunciationLoadingText: {
    marginTop: 16,
    color: '#64748B',
    fontSize: 15,
  }
});
