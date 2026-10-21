import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useStore } from '../store/useStore';
import { buildReviewPlan } from '../utils/reviewPlan';
import { getWordTranslation } from '../utils/words';
import { getLanguageLabel } from '../constants/languages';
import { ACCENT } from '../constants/theme';

export default function ReviewPlan({ onStart }: { onStart: () => void }) {
  const words = useStore(s => s.words);
  const languages = useStore(s => s.activeLanguages);
  const count = useStore(s => s.workoutWordCount);
  const plan = buildReviewPlan(words, languages);
  return <View style={{ padding: 16, backgroundColor: '#FFF7ED', borderRadius: 16, marginBottom: 16 }}>
    <Text style={{ fontSize: 18, fontWeight: 'bold' }}>Повторение на сегодня</Text>
    <Text style={{ marginVertical: 8 }}>{plan.length ? 'Пора повторить: ' + plan.length + '. В тренировке — до ' + count + '.' : 'На сегодня повторений нет. Можно изучать новые слова.'}</Text>
    {plan.slice(0,3).map(item => <Text key={(item.word.eng || item.word.word) + ':' + item.langCode} style={{ marginBottom: 4 }}>{getWordTranslation(item.word,item.langCode)} · {getLanguageLabel(item.langCode)} · {item.reason}</Text>)}
    <Text style={{ color: '#64748B', marginVertical: 8 }}>Выбираем уже встречавшиеся слова со слабым весом памяти или неуверенным ответом. Сегодняшние и отложенные слова пропускаем.</Text>
    {plan.length > 0 && <TouchableOpacity accessibilityRole="button" onPress={() => { useStore.getState().setWorkoutReviewOnly(true); onStart(); }} style={{ padding: 10, backgroundColor: ACCENT, borderRadius: 10 }}><Text style={{ color: '#FFF', textAlign: 'center' }}>Повторить сегодня</Text></TouchableOpacity>}
  </View>;
}
