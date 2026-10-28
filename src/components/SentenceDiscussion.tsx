import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, View } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { discussSentence, DiscussionContext, DiscussionMessage, DISCUSSION_QUESTION_LIMIT } from '../services/sentenceDiscussion';
import { StudyButton, studyStyles } from './StudyUI';
import { ACCENT } from '../constants/theme';

export default function SentenceDiscussion({ context, enabled, markdownStyle, children }: {
  context: DiscussionContext;
  enabled: boolean;
  markdownStyle: React.ComponentProps<typeof Markdown>['style'];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<DiscussionMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const scroll = useRef<ScrollView>(null);
  useEffect(() => () => { controller.current?.abort(); }, []);

  const send = async () => {
    const question = draft.trim();
    if (!question || controller.current) return;
    const request = new AbortController();
    controller.current = request;
    setPending(question);
    setError('');
    try {
      const answer = await discussSentence(context, messages, question, request.signal);
      if (request.signal.aborted) return;
      setMessages(previous => [...previous, { role: 'user', text: question }, { role: 'assistant', text: answer }]);
      setDraft('');
    } catch (cause) {
      if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : 'Не удалось получить ответ. Попробуйте ещё раз.');
    } finally {
      if (!request.signal.aborted) {
        controller.current = null;
        setPending(null);
      }
    }
  };

  if (!open) return <View style={{ flexShrink: 1 }}>
    <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">{children}</ScrollView>
    {enabled && <View style={{ marginTop: 12 }}><StudyButton title="Обсудить с ИИ" onPress={() => setOpen(true)} /></View>}
  </View>;

  return <View testID="sentence-discussion" style={{ height: 420, flexShrink: 1, gap: 10 }}>
    <StudyButton title="← К объяснению" onPress={() => setOpen(false)} />
    <Text style={studyStyles.small}>{context.sentence}</Text>
    <ScrollView ref={scroll} style={{ flex: 1 }} keyboardShouldPersistTaps="handled"
      onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
      {!messages.length && !pending && <Text style={studyStyles.text}>Что осталось непонятным? Спросите о слове, окончании или роли в предложении.</Text>}
      {messages.map((message, index) => <View key={index} style={{ padding: 10, marginBottom: 8, borderRadius: 10, backgroundColor: message.role === 'user' ? '#EEF2F6' : '#FFF' }}>
        <Text style={studyStyles.small}>{message.role === 'user' ? 'Вы' : 'ИИ'}</Text>
        {message.role === 'user' ? <Text selectable style={studyStyles.text}>{message.text}</Text>
          : <Markdown style={markdownStyle} onLinkPress={() => false}>{message.text}</Markdown>}
      </View>)}
      {pending && <View><Text style={studyStyles.text}>{pending}</Text><ActivityIndicator color={ACCENT} accessibilityLabel="ИИ готовит ответ" /></View>}
    </ScrollView>
    {!!error && <Text accessibilityRole="alert" style={studyStyles.warning}>{error}</Text>}
    <TextInput accessibilityLabel="Вопрос по разбору" placeholder="Что непонятно в разборе?" multiline
      maxLength={DISCUSSION_QUESTION_LIMIT}
      value={draft} onChangeText={setDraft} editable={!pending} style={[studyStyles.input, { maxHeight: 100 }]} />
    <StudyButton title={pending ? 'Отвечаем…' : error ? 'Повторить отправку' : 'Отправить'} disabled={!!pending || !draft.trim()} onPress={() => { void send(); }} />
  </View>;
}
