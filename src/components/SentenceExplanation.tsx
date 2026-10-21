import React, { useState } from 'react';
import { View } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { StudyButton } from './StudyUI';

/** Old/off-format replies remain fully readable; layered replies disclose detail on demand. */
export default function SentenceExplanation({ text, style, onLinkPress }: {
  text: string;
  style: React.ComponentProps<typeof Markdown>['style'];
  onLinkPress: (url: string) => boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const index = text.search(/^\s*(?:#{1,4}\s*)?(?:\*\*)?Подробности(?:\*\*)?\s*[:.]*\s*$/mi);
  if (index < 0) return <Markdown style={style} onLinkPress={onLinkPress}>{text}</Markdown>;
  return <View>
    <Markdown style={style} onLinkPress={onLinkPress}>{text.slice(0, index)}</Markdown>
    <StudyButton title={expanded ? 'Свернуть разбор слов' : 'Разобрать слова и окончания'} onPress={() => setExpanded(!expanded)} />
    {expanded && <Markdown style={style} onLinkPress={onLinkPress}>{text.slice(index)}</Markdown>}
  </View>;
}
