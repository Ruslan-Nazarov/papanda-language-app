import React, { useEffect, useRef, useState } from 'react';
import { View, Text } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { StudyButton } from './StudyUI';

/** Old/off-format replies remain fully readable; layered replies disclose detail on demand. */
export default function SentenceExplanation({ text, style, onLinkPress, loadDetails }: {
  text: string;
  style: React.ComponentProps<typeof Markdown>['style'];
  onLinkPress: (url: string) => boolean;
  loadDetails?: () => Promise<string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [details, setDetails] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const pending = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const index = text.search(/^\s*(?:#{1,4}\s*)?(?:\*\*)?Подробности(?:\*\*)?\s*[:.]*\s*$/mi);
  const toggle = async () => {
    if (pending.current) return;
    if (expanded) { setExpanded(false); return; }
    if (index >= 0 || details !== null || !loadDetails) { setExpanded(true); return; }
    pending.current = true;
    setLoading(true);
    setError('');
    try {
      const result = await loadDetails();
      if (mounted.current) { setDetails(result); setExpanded(true); }
    } catch (cause) {
      if (mounted.current && !(cause instanceof Error && cause.name === 'AbortError')) {
        setError(cause instanceof Error ? cause.message : 'Не удалось загрузить подробности.');
      }
    } finally {
      pending.current = false;
      if (mounted.current) setLoading(false);
    }
  };
  if (index < 0 && !loadDetails) return <Markdown style={style} onLinkPress={onLinkPress}>{text}</Markdown>;
  return <View>
    <Markdown style={style} onLinkPress={onLinkPress}>{index < 0 ? text : text.slice(0, index)}</Markdown>
    <StudyButton title={loading ? 'Загружаем подробности…' : expanded ? 'Свернуть разбор слов' : error ? 'Повторить загрузку подробностей' : 'Разобрать слова и окончания'} disabled={loading} onPress={() => void toggle()} />
    {!!error && <Text accessibilityRole="alert" style={{ color: '#9A3412', marginVertical: 8 }}>{error}</Text>}
    {expanded && <Markdown style={style} onLinkPress={onLinkPress}>{index < 0 ? details || '' : text.slice(index)}</Markdown>}
  </View>;
}
