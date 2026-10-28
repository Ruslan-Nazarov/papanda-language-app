import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import Markdown from 'react-native-markdown-display';
import type { Word } from '../models/types';
import { explainWordForm, WordFormContext } from '../services/wordFormExplanation';
import { isGeminiConfigured } from '../services/geminiClient';
import { ACCENT } from '../constants/theme';
import { useStore } from '../store/useStore';
import { getWordTranslation } from '../utils/words';
import EditWordModal from './EditWordModal';
import { StudyButton, studyStyles } from './StudyUI';

export default function WordFormModal({ context, word, onClose, onCreateNote }: {
  context: WordFormContext;
  word: Word;
  onClose: () => void;
  onCreateNote?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [explanation, setExplanation] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const configured = isGeminiConfigured();
  const words = useStore(state => state.words);
  const currentWord = words.find(candidate => (candidate.eng || candidate.word) === (word.eng || word.word))
    || (word.source_language ? words.find(candidate => getWordTranslation(candidate, word.source_language!).toLowerCase()
      === getWordTranslation(word, word.source_language!).toLowerCase()) : undefined)
    || word;

  useEffect(() => {
    if (!configured) return;
    const request = new AbortController();
    setLoading(true);
    setError('');
    setExplanation('');
    void explainWordForm(context, request.signal).then(answer => {
      if (!request.signal.aborted) setExplanation(answer);
    }).catch(cause => {
      if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : 'Не удалось объяснить форму слова.');
    }).finally(() => {
      if (!request.signal.aborted) setLoading(false);
    });
    return () => request.abort();
  }, [context, configured, attempt]);

  if (editing) return <EditWordModal visible wordToEdit={currentWord} onClose={() => setEditing(false)} onCreateNote={onCreateNote} />;

  return <Modal visible transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.overlay}>
      <View style={styles.card} testID="word-form-modal">
        <Text style={studyStyles.title}>Почему такая форма?</Text>
        <ScrollView style={styles.scroll} contentContainerStyle={{ gap: 12 }}>
          <Text selectable style={styles.word}>{context.token.text}</Text>
          <Text selectable style={studyStyles.text}>{context.sentence}</Text>
          {!!context.token.translation && <Text style={studyStyles.small}>В предложении: {context.token.translation}</Text>}
          {loading && <View style={{ gap: 8 }}>
            <ActivityIndicator color={ACCENT} accessibilityLabel="Объясняем форму слова" />
            <Text style={studyStyles.small}>Разбираем форму и её связь с предложением…</Text>
          </View>}
          {!configured && <Text style={studyStyles.text}>Объяснение формы требует подключения ИИ. В этой сборке он пока недоступен.</Text>}
          {!!explanation && <Markdown onLinkPress={() => false} style={{ body: studyStyles.text }}>{explanation}</Markdown>}
          {!!error && <View style={{ gap: 10 }}>
            <Text accessibilityRole="alert" style={studyStyles.warning}>{error}</Text>
            <StudyButton compact title="Повторить объяснение" onPress={() => setAttempt(value => value + 1)} />
          </View>}
        </ScrollView>
        <View style={styles.actions}>
          <StudyButton compact title="Редактировать слово" onPress={() => setEditing(true)} />
          {onCreateNote && <StudyButton compact testID="word-create-note" title="Создать заметку" onPress={onCreateNote} />}
          <StudyButton compact title="Закрыть" onPress={onClose} />
        </View>
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  card: { backgroundColor: '#FFF', borderRadius: 16, padding: 20, maxHeight: '90%', maxWidth: 480, width: '100%', alignSelf: 'center', gap: 16 },
  scroll: { flexShrink: 1 },
  word: { fontSize: 26, fontWeight: '700', color: '#172033' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
});
