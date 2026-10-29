import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useStore } from '../store/useStore';
import { buildReviewPlan } from '../utils/reviewPlan';
import { getWordTranslation } from '../utils/words';
import { getLanguageLabel } from '../constants/languages';
import { ACCENT, UI } from '../constants/theme';

export default function ReviewPlan({ onStart, now }: { onStart: () => void; now?: number }) {
  const words = useStore(s => s.words);
  const languages = useStore(s => s.activeLanguages);
  const count = useStore(s => s.workoutWordCount);
  const plan = buildReviewPlan(words, languages, now);
  return <View style={{ padding: 16, backgroundColor: UI.surface, borderWidth: 1, borderColor: UI.border, borderRadius: UI.radius, marginBottom: 16 }}>
    <Text style={{ fontSize: 18, fontWeight: 'bold' }}>Повторение на сегодня</Text>
    <Text style={{ ...UI.reading, color: UI.body, marginVertical: 8 }}>{plan.length ? 'Пора повторить: ' + plan.length + '. В тренировке — до ' + count + '.' : 'На сегодня повторений нет. Можно изучать новые слова.'}</Text>
    {plan.slice(0,3).map(item => <Text key={(item.word.eng || item.word.word) + ':' + item.langCode} style={{ ...UI.reading, color: UI.body, marginBottom: 4 }}>{getWordTranslation(item.word,item.langCode)} · {getLanguageLabel(item.langCode)} · {item.reason}</Text>)}
    <Text style={{ ...UI.caption, color: UI.muted, marginVertical: 8 }}>Выбираем уже встречавшиеся слова со слабым весом памяти или неуверенным ответом. Сегодняшние и отложенные слова пропускаем.</Text>
    {plan.length > 0 && <TouchableOpacity accessibilityRole="button" onPress={() => { useStore.getState().setWorkoutReviewOnly(true); onStart(); }} style={{ minHeight: 44, justifyContent: 'center', padding: 10, backgroundColor: ACCENT, borderRadius: 10 }}><Text style={{ color: UI.onAccent, fontSize: 15, fontWeight: '600', textAlign: 'center' }}>Повторить сегодня</Text></TouchableOpacity>}
  </View>;
}
