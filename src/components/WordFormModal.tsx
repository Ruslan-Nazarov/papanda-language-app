import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Markdown from 'react-native-markdown-display';
import type { Word } from '../models/types';
import { discussWordForm, explainWordForm, WordFormContext } from '../services/wordFormExplanation';
import { DiscussionMessage, DISCUSSION_QUESTION_LIMIT } from '../services/sentenceDiscussion';
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

  // Chat / Discussion state
  const [discussing, setDiscussing] = useState(false);
  const [messages, setMessages] = useState<DiscussionMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [chatError, setChatError] = useState('');
  const chatController = useRef<AbortController | null>(null);
  const chatScroll = useRef<ScrollView>(null);

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

  useEffect(() => () => {
    chatController.current?.abort();
  }, []);

  const sendQuestion = async () => {
    const question = draft.trim();
    if (!question || chatController.current) return;
    const request = new AbortController();
    chatController.current = request;
    setPendingQuestion(question);
    setChatError('');
    try {
      const answer = await discussWordForm(
        { ...context, explanation },
        messages,
        question,
        request.signal
      );
      if (request.signal.aborted) return;
      setMessages(prev => [...prev, { role: 'user', text: question }, { role: 'assistant', text: answer }]);
      setDraft('');
    } catch (cause) {
      if (!request.signal.aborted) {
        setChatError(cause instanceof Error ? cause.message : 'Не удалось получить ответ. Попробуйте ещё раз.');
      }
    } finally {
      if (!request.signal.aborted) {
        chatController.current = null;
        setPendingQuestion(null);
      }
    }
  };

  if (editing) return <EditWordModal visible wordToEdit={currentWord} onClose={() => setEditing(false)} onCreateNote={onCreateNote} />;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <View style={styles.card} testID="word-form-modal">
          {discussing ? (
            <>
              <View style={styles.headerRow}>
                <Text style={studyStyles.title}>Обсуждение формы</Text>
                <StudyButton compact title="← К объяснению" onPress={() => setDiscussing(false)} />
              </View>
              <View style={styles.contextBox}>
                <Text selectable style={styles.wordMini}>{context.token.text}</Text>
                <Text selectable numberOfLines={2} style={studyStyles.small}>{context.sentence}</Text>
                {!!context.token.translation && (
                  <Text style={studyStyles.small}>В предложении: {context.token.translation}</Text>
                )}
              </View>
              <ScrollView
                ref={chatScroll}
                style={styles.chatScroll}
                contentContainerStyle={{ gap: 10, paddingVertical: 4 }}
                keyboardShouldPersistTaps="handled"
                onContentSizeChange={() => chatScroll.current?.scrollToEnd({ animated: true })}
              >
                {!messages.length && !pendingQuestion && (
                  <Text style={studyStyles.text}>
                    Что осталось непонятным в форме слова? Спросите об окончании, времени, лице или роли в предложении.
                  </Text>
                )}
                {messages.map((message, index) => (
                  <View
                    key={index}
                    style={{
                      padding: 10,
                      borderRadius: 10,
                      backgroundColor: message.role === 'user' ? '#EEF2F6' : '#F8FAFC',
                      borderWidth: 1,
                      borderColor: message.role === 'user' ? '#E2E8F0' : '#EDF2F7',
                    }}
                  >
                    <Text style={studyStyles.small}>{message.role === 'user' ? 'Вы' : 'ИИ'}</Text>
                    {message.role === 'user' ? (
                      <Text selectable style={studyStyles.text}>{message.text}</Text>
                    ) : (
                      <Markdown onLinkPress={() => false} style={{ body: studyStyles.text }}>{message.text}</Markdown>
                    )}
                  </View>
                ))}
                {pendingQuestion && (
                  <View style={{ gap: 6 }}>
                    <View style={{ padding: 10, borderRadius: 10, backgroundColor: '#EEF2F6', borderWidth: 1, borderColor: '#E2E8F0' }}>
                      <Text style={studyStyles.small}>Вы</Text>
                      <Text style={studyStyles.text}>{pendingQuestion}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8 }}>
                      <ActivityIndicator color={ACCENT} accessibilityLabel="ИИ готовит ответ" />
                      <Text style={studyStyles.small}>ИИ готовит ответ…</Text>
                    </View>
                  </View>
                )}
              </ScrollView>
              {!!chatError && <Text accessibilityRole="alert" style={studyStyles.warning}>{chatError}</Text>}
              <TextInput
                accessibilityLabel="Вопрос по форме слова"
                placeholder="Что непонятно в форме слова?"
                multiline
                maxLength={DISCUSSION_QUESTION_LIMIT}
                value={draft}
                onChangeText={setDraft}
                editable={!pendingQuestion}
                style={[studyStyles.input, { maxHeight: 80 }]}
              />
              <View style={styles.actions}>
                <StudyButton
                  compact
                  title={pendingQuestion ? 'Отвечаем…' : chatError ? 'Повторить отправку' : 'Отправить'}
                  disabled={!!pendingQuestion || !draft.trim()}
                  onPress={() => { void sendQuestion(); }}
                />
                <StudyButton compact title="← К объяснению" onPress={() => setDiscussing(false)} />
                <StudyButton compact title="Редактировать слово" onPress={() => setEditing(true)} />
                {onCreateNote && <StudyButton compact testID="word-create-note" title="Создать заметку" onPress={onCreateNote} />}
                <StudyButton compact title="Закрыть" onPress={onClose} />
              </View>
            </>
          ) : (
            <>
              <Text style={studyStyles.title}>Почему такая форма?</Text>
              <ScrollView style={styles.scroll} contentContainerStyle={{ gap: 12, paddingBottom: 16 }}>
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
                {configured && !loading && (
                  <View style={{ marginTop: 4 }}>
                    <StudyButton
                      compact
                      title={messages.length > 0 ? `Обсудить с ИИ (${messages.length / 2})` : 'Обсудить с ИИ'}
                      onPress={() => setDiscussing(true)}
                    />
                  </View>
                )}
              </ScrollView>
              <View style={styles.actions}>
                <StudyButton compact title="Редактировать слово" onPress={() => setEditing(true)} />
                {onCreateNote && <StudyButton compact testID="word-create-note" title="Создать заметку" onPress={onCreateNote} />}
                <StudyButton compact title="Закрыть" onPress={onClose} />
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  card: { backgroundColor: '#FFF', borderRadius: 16, padding: 20, maxHeight: '90%', maxWidth: 480, width: '100%', alignSelf: 'center', gap: 16 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  contextBox: { backgroundColor: '#F8FAFC', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#EDF2F7', gap: 4 },
  wordMini: { fontSize: 18, fontWeight: '700', color: '#172033' },
  scroll: { flexShrink: 1 },
  chatScroll: { flexGrow: 1, flexShrink: 1, maxHeight: 320, minHeight: 140 },
  word: { fontSize: 26, fontWeight: '700', color: '#172033' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
});
