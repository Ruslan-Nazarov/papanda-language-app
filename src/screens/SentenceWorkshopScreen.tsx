import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import type { Sentence } from '../models/types';
import { LANGUAGES } from '../constants/languages';
import { useStore } from '../store/useStore';
import { developmentExamples } from '../data/studyExamples';
import { addedTokenIndices } from '../utils/structureStudy';
import { isGeminiConfigured } from '../services/geminiClient';
import { generateSentenceBatch } from '../services/sentenceGeneration';
import { useStudyTask } from '../hooks/useStudyTask';
import { StudyButton, StudyTokens, studyStyles as s } from '../components/StudyUI';
import { UI } from '../constants/theme';

const steps = ['Основа', '+ Определение', '+ Дополнение', '+ Обстоятельство'];

export default function SentenceWorkshopScreen({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'SentenceWorkshop'>) {
  const insets = useSafeAreaInsets();
  const activeLanguages = useStore(state => state.activeLanguages);
  const workshopLanguages = useMemo(() => {
    const active = activeLanguages.map(c => LANGUAGES.find(l => l.code === c)).filter((l): l is typeof LANGUAGES[number] => Boolean(l));
    return active.length > 0 ? active : LANGUAGES;
  }, [activeLanguages]);
  const requestedLang = route.params?.language;
  const initialCode = (requestedLang && LANGUAGES.some(l => l.code === requestedLang))
    ? requestedLang
    : (workshopLanguages[0]?.code ?? 'en');
  const [code, setCode] = useState(initialCode);
  const language = LANGUAGES.find(l => l.code === code) ?? workshopLanguages[0] ?? LANGUAGES[0];
  const [choosingLanguage, setChoosingLanguage] = useState(false);
  const scroll = useRef<ScrollView>(null);
  useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }); }, [code]);
  const sentences = useStore(state => state.sentences);

  // Growing-sentence task: complete series (base → +attribute → +object → +circumstance)
  // rebuilt from generated sentences of one batch, in a random order of series.
  const [selectedSeries, setSelectedSeries] = useState<Sentence[] | null>(null);
  const [seriesStep, setSeriesStep] = useState(0);
  const [showAdded, setShowAdded] = useState(false);
  const [seriesSeed] = useState(Math.random);
  const seriesList = useMemo(() => {
    const batches = new Map<string, Sentence[]>();
    for (const s of sentences) {
      if (s.language !== language.label || !s.generationBatchId || s.chainStep === undefined) continue;
      batches.set(s.generationBatchId, [...(batches.get(s.generationBatchId) ?? []), s]);
    }
    return [...batches.values()].map(list => list.sort((a, b) => a.chainStep! - b.chainStep!))
      .filter(list => list.length >= 2 && list.every((s, i) => s.chainStep === i));
  }, [sentences, language.label]);
  const builtInSeries = useMemo(() => developmentExamples(code), [code]);
  // Keep the exercise the learner opened even if background generation adds or
  // evicts cache entries. Only an explicit choice/language change replaces it.
  const activeSeries = selectedSeries ?? (seriesList.length ? seriesList[Math.floor(seriesSeed * seriesList.length)] : builtInSeries);
  useEffect(() => { if (!selectedSeries) setSelectedSeries(activeSeries); }, [selectedSeries, activeSeries]);
  const seriesIsBuiltIn = !activeSeries[0].generationBatchId;
  const otherSeries = () => {
    const pool = seriesList.filter(list => list[0].generationBatchId !== activeSeries[0].generationBatchId);
    if (!pool.length) return;
    setSelectedSeries(pool[Math.floor(Math.random() * pool.length)]);
    setSeriesStep(0); setShowAdded(false);
  };

  const task = useStudyTask(`${code}:${activeSeries[0]?.id ?? ''}`);
  const changeLanguage = (next: string) => {
    task.cancel();
    setCode(next);
    setChoosingLanguage(false);
    setSelectedSeries(null);
    setSeriesStep(0);
    setShowAdded(false);
  };
  const aiDisabled = !!task.phase || !isGeminiConfigured();

  const step = Math.min(seriesStep, activeSeries.length - 1);
  const current = activeSeries[step];
  const previous = step > 0 ? activeSeries[step - 1] : null;
  const goTo = (next: number) => { setSeriesStep(next); setShowAdded(false); };

  return <View testID="workshop-screen" style={{ flex: 1, backgroundColor: UI.canvas, paddingTop: Math.max(insets.top, 16) }}>
    <View style={{ paddingHorizontal: 16 }}><StudyButton title="Назад" onPress={() => navigation.goBack()} /></View>
    <ScrollView ref={scroll} contentContainerStyle={{ padding: 16, paddingBottom: Math.max(insets.bottom, 16) + 24, maxWidth: 850, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header" style={ui.heading}>От короткого к полному</Text>
      <Text style={ui.intro}>Посмотрите, как к простой основе добавляются детали. Попробуйте заметить каждую новую часть.</Text>
      <View style={ui.language}>
        <Text style={s.small}>Язык упражнения</Text>
        <StudyButton title={`${language.flag} ${language.label} · изменить`} onPress={() => setChoosingLanguage(!choosingLanguage)} />
        {choosingLanguage && <View style={s.row}>{workshopLanguages.map(item => <StudyButton key={item.code} title={`${item.flag} ${item.label}`} selected={code === item.code} onPress={() => changeLanguage(item.code)} />)}</View>}
      </View>
      {!isGeminiConfigured() && <Text style={s.warning}>ИИ сейчас не подключён. Встроенные серии предложений доступны без интернета.</Text>}
      {task.phase ? <View style={s.card}><Text accessibilityLiveRegion="polite" style={s.text}>{task.phase}</Text><StudyButton title="Отменить запрос" onPress={task.cancel} /></View> : null}
      {!!task.error && <Text accessibilityRole="alert" style={s.warning}>{task.error}</Text>}
      <View style={s.card}>
        <Text style={s.title}>Предложение по нарастающей</Text>
        <Text style={s.text}>Серия: основа, затем к ней по одной детали. Сначала найдите основу, потом угадайте, что добавилось.</Text>
        {seriesIsBuiltIn && <Text style={s.small}>Своих серий для этого языка пока нет — показан встроенный пример.{isGeminiConfigured() ? ' Нажмите «Новые серии», чтобы составить их с ИИ.' : ''}</Text>}
        <View style={s.row}>{activeSeries.map((item, i) => <StudyButton key={item.id} title={`${i + 1}. ${steps[i] ?? '+ Деталь'}`} selected={i === step} onPress={() => goTo(i)} />)}</View>
        {previous && <Text style={s.small}>Было: {previous.sentence}</Text>}
        <Text style={s.text}>{current.sentence}</Text>
        {step > 0 && !showAdded && <StudyButton title="Что добавилось?" onPress={() => setShowAdded(true)} />}
        <StudyTokens sentence={current} added={showAdded && previous ? addedTokenIndices(previous, current) : []} />
        {(step === 0 || showAdded) && !!current.literalTranslation && <Text style={s.text}>{current.literalTranslation}</Text>}
        <View style={s.row}>
          <StudyButton title="Назад" disabled={step === 0} onPress={() => goTo(step - 1)} />
          <StudyButton title={step < activeSeries.length - 1 ? `Дальше: ${steps[step + 1] ?? '+ Деталь'}` : 'Серия закончена'} disabled={step >= activeSeries.length - 1} onPress={() => goTo(step + 1)} />
        </View>
        <View style={s.row}>
          <StudyButton title="Другая серия" disabled={!seriesList.some(list => list[0].generationBatchId !== activeSeries[0].generationBatchId)} onPress={otherSeries} />
          <StudyButton title="Новые серии (ИИ)" disabled={aiDisabled} onPress={() => void task.run(async (signal, phase) => {
            phase('Составляем серии предложений…');
            const state = useStore.getState();
            return generateSentenceBatch(code, state.words, 8, undefined, state.sentences.filter(item => item.language === language.label).map(item => item.sentence), { signal, phase }, 'development');
          }, batch => {
            useStore.getState().addGeneratedSentences(batch);
            const batchId = batch.find(item => item.chainStep === 0)?.generationBatchId;
            const series = batchId ? batch.filter(item => item.generationBatchId === batchId && item.chainStep !== undefined).sort((a, b) => a.chainStep! - b.chainStep!) : [];
            if (series.length >= 2) { setSelectedSeries(series); setSeriesStep(0); setShowAdded(false); }
            else task.setError('Новая серия не получилась. Текущее упражнение сохранено; можно повторить запрос.');
          })} />
        </View>
      </View>
    </ScrollView>
  </View>;
}

const ui = StyleSheet.create({
  heading: { ...UI.heading, color: '#172033', marginTop: 12, marginBottom: 10 },
  intro: { fontSize: 16, lineHeight: 24, color: '#475569', marginBottom: 20 },
  language: { backgroundColor: UI.surface, borderColor: UI.border, borderWidth: 1, borderRadius: 14, padding: 12, gap: 8, marginBottom: 12 },
});
