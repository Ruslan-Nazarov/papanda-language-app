import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useStore } from '../store/useStore';
import { summarizeSentenceAnalyses } from '../utils/sentenceStatistics';
import { ACCENT, UI } from '../constants/theme';
import { StudyButton, studyStyles as s } from './StudyUI';

type FrequencyRow = ReturnType<typeof summarizeSentenceAnalyses>['forms'][number];
function Frequencies({ rows }: { rows: FrequencyRow[] }) {
  const max = rows[0]?.count || 1;
  return <>{rows.map(row => <View key={row.title} style={styles.frequency}>
    <View style={styles.heading}>
      <Text style={styles.label}>{row.title}</Text>
      <Text style={styles.count}>{row.count} раз</Text>
    </View>
    <View style={styles.track}><View style={[styles.fill, { width: `${row.count / max * 100}%` }]} /></View>
    <Text style={s.small}>В разборах: {row.sentences} · {row.examples.join(' · ')}</Text>
  </View>)}</>;
}

export default function SentenceStatistics({ now }: { now: number }) {
  const analyses = useStore(state => state.sentenceAnalyses);
  const [selectedLanguage, setLanguage] = useState<string | undefined>();
  const [showCategories, setShowCategories] = useState(false);
  const languages = useMemo(() => [...new Set(analyses.map(item => item.language))], [analyses]);
  const language = selectedLanguage && languages.includes(selectedLanguage) ? selectedLanguage : undefined;
  const summary = useMemo(() => summarizeSentenceAnalyses(analyses, language, now), [analyses, language, now]);
  return <View testID="sentence-statistics" style={s.card}>
    <Text style={s.title}>Разбор предложений</Text>
    {!analyses.length ? <Text style={s.text}>Полностью раскройте предложение в разделе «Разбор». Здесь появятся частые грамматические формы и примеры из ваших разборов.</Text> : <>
      <View style={s.row}>
        <StudyButton title="Все языки" selected={!language} onPress={() => setLanguage(undefined)} />
        {languages.map(item => <StudyButton key={item} title={item} selected={language === item} onPress={() => setLanguage(item)} />)}
      </View>
      <View testID="sentence-statistics-summary" style={styles.summary}>
        <Text style={s.text}>Разборов: {summary.total} · Сегодня: {summary.today}</Text>
        <Text style={s.small}>Разных предложений: {summary.unique}</Text>
      </View>
      <Text style={styles.subtitle}>Грамматические формы · сначала частые</Text>
      {summary.forms.length ? <Frequencies rows={summary.forms} /> : <Text style={s.text}>В этих предложениях нет уточнённых меток времени, падежа или других форм.</Text>}
      <StudyButton title={showCategories ? 'Скрыть части речи и роли' : 'Показать части речи и роли'} onPress={() => setShowCategories(value => !value)} />
      {showCategories && <Frequencies rows={summary.categories} />}
    </>}
    <Text style={s.small}>Последние 500 завершённых разборов. Каждое слово считается по метке карточки; повторный полный разбор учитывается снова. Это частота встреч, а не оценка знаний. Сбор начинается с этого обновления.</Text>
  </View>;
}

const styles = StyleSheet.create({
  summary: { backgroundColor: UI.canvas, padding: 12, borderRadius: 8, gap: 4 },
  subtitle: { ...UI.reading, color: UI.body, fontWeight: '600' },
  frequency: { gap: 6, paddingVertical: 6 },
  heading: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  label: { ...UI.reading, color: UI.body, flex: 1 },
  count: { ...UI.caption, color: UI.body, fontWeight: '600' },
  track: { height: 6, backgroundColor: UI.border, borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: ACCENT },
});
