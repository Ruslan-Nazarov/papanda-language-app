import React, { useMemo, useState } from 'react';
import { ScrollView, View, Text, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import type { Sentence, SyntaxRole } from '../models/types';
import { LANGUAGES } from '../constants/languages';
import { ROLE_TRANSLATIONS } from '../constants/sentencePresentation';
import { useStore } from '../store/useStore';
import { developmentExamples, comparisonExamples } from '../data/studyExamples';
import { addedTokenIndices, recommendStructureCard, suggestReadingSegments, validateReadingSegments } from '../utils/structureStudy';
import { analyzeStudySentence, extendStudySentence, translateStudySentence } from '../services/sentenceStudy';
import { isGeminiConfigured } from '../services/geminiClient';
import { generateSentenceBatch } from '../services/sentenceGeneration';
import { useStudyTask } from '../hooks/useStudyTask';
import StructureExercise, { StructureProgress } from '../components/StructureExercise';
import { StudyButton, StudyTokens, studyStyles as s } from '../components/StudyUI';

type Mode = 'Самостоятельно' | 'Нарастающее' | 'Развитие' | 'Языки' | 'Мой текст';
const modes: Mode[] = ['Самостоятельно', 'Нарастающее', 'Развитие', 'Языки', 'Мой текст'];
const steps = ['Основа', '+ Определение', '+ Дополнение', '+ Обстоятельство'];
const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
export default function SentenceWorkshopScreen({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'SentenceWorkshop'>) {
  const insets = useSafeAreaInsets();
  const initialCode = LANGUAGES.some(l => l.code === route.params?.language) ? route.params!.language! : 'en';
  const [code, setCode] = useState(initialCode);
  const language = LANGUAGES.find(l => l.code === code)!;
  const [mode, setMode] = useState<Mode>(route.params?.mode ?? 'Самостоятельно');
  const sentences = useStore(state => state.sentences);
  // Growing-sentence task: complete series (base → +attribute → +object → +circumstance)
  // rebuilt from generated sentences of one batch, in a random order of series.
  const [seriesId, setSeriesId] = useState<string | null>(null);
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
  const activeSeries = seriesList.find(list => list[0].generationBatchId === seriesId)
    ?? (seriesList.length ? seriesList[Math.floor(seriesSeed * seriesList.length)] : builtInSeries);
  const seriesIsBuiltIn = !seriesList.length;
  const otherSeries = () => {
    const pool = seriesList.filter(list => list !== activeSeries);
    if (!pool.length) return;
    setSeriesId(pool[Math.floor(Math.random() * pool.length)][0].generationBatchId!);
    setSeriesStep(0); setShowAdded(false);
  };
  const readingTexts = useStore(state => state.readingTexts);
  const [card, setCard] = useState<Sentence>(() => sentences.find(s => s.id === route.params?.sentenceId && s.language === LANGUAGES.find(l => l.code === initialCode)!.label) ?? developmentExamples(initialCode)[3]);
  const [exerciseVersion, setExerciseVersion] = useState(0);
  const [chain, setChain] = useState(() => developmentExamples(initialCode));
  const [chainIndex, setChainIndex] = useState(0);
  const [addition, setAddition] = useState('');
  const [comparisons, setComparisons] = useState(comparisonExamples);
  const [compareBase, setCompareBase] = useState<Sentence | null>(null);
  const [target, setTarget] = useState('de');
  const [role, setRole] = useState<SyntaxRole | undefined>();
  const [draft, setDraft] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [creatingText, setCreatingText] = useState(false);
  const [readingId, setReadingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const reading = readingTexts.find(t => t.id === readingId);
  const readingCard = reading?.cards[String(reading.position)];
  const task = useStudyTask(`${code}:${mode}:${card.id}:${readingId}:${reading?.position}:${chainIndex}:${compareBase?.id ?? ''}:${target}`);
  const changeLanguage = (next: string) => {
    task.cancel(); setCode(next); setCard(developmentExamples(next)[3]); setExerciseVersion(v => v + 1);
    setChain(developmentExamples(next)); setChainIndex(0); setAddition(''); setReadingId(null);
    setSeriesId(null); setSeriesStep(0); setShowAdded(false);
  };
  const nextExercise = () => {
    const state = useStore.getState();
    const cards = [...developmentExamples(code), ...state.sentences];
    setCard(recommendStructureCard(cards, state.structureAttempts, language.label, card.id) ?? developmentExamples(code)[3]);
    setExerciseVersion(v => v + 1);
  };
  const aiDisabled = !!task.phase || !isGeminiConfigured();
  const saveText = () => {
    try {
      const segments = validateReadingSegments(draft);
      const id = newId();
      useStore.getState().saveReadingText({ id, title: segments[0].slice(0, 60), language: language.label, segments, position: 0, cards: {} });
      setReadingId(id); setDraft(''); setReviewed(false); setCreatingText(false); task.setError('');
    } catch (err) { task.setError(err instanceof Error ? err.message : 'Не удалось сохранить текст.'); }
  };
  const analyzeReading = () => {
    if (!reading) return;
    const captured = readingTexts;
    void task.run((signal, phase) => analyzeStudySentence(reading.segments[reading.position], code, signal, phase), result => {
      // Import, removal, navigation, or any intervening edit invalidates this result.
      if (useStore.getState().readingTexts !== captured) return;
      useStore.getState().saveReadingText({ ...reading, cards: { ...reading.cards, [reading.position]: result } });
    });
  };
  return <View testID="workshop-screen" style={{ flex: 1, backgroundColor: '#F8FAFC', paddingTop: Math.max(insets.top, 16) }}>
    <View style={{ paddingHorizontal: 16 }}><StudyButton title="Назад" onPress={() => navigation.goBack()} /></View>
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: Math.max(insets.bottom, 16) + 24, maxWidth: 850, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
      <Text style={s.title}>Мастерская предложения</Text>
      <Text style={s.text}>От целого предложения — к его основе, уточнениям и связному тексту.</Text>
      <View style={s.row}>{modes.map(item => <StudyButton key={item} title={item} selected={mode === item} onPress={() => { task.cancel(); setMode(item); }} />)}</View>
      {mode !== 'Языки' && <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ gap: 8, paddingVertical: 10 }}>{LANGUAGES.map(item => <StudyButton key={item.code} title={`${item.flag} ${item.label}`} selected={code === item.code} onPress={() => changeLanguage(item.code)} />)}</ScrollView>}
      {!isGeminiConfigured() && <Text style={s.warning}>ИИ сейчас не подключён. Встроенные упражнения, цепочки и сравнение семи языков доступны без интернета.</Text>}
      {task.phase ? <View style={s.card}><Text accessibilityLiveRegion="polite" style={s.text}>{task.phase}</Text><StudyButton title="Отменить запрос" onPress={task.cancel} /></View> : null}
      {!!task.error && <Text accessibilityRole="alert" style={s.warning}>{task.error}</Text>}
      {mode === 'Самостоятельно' && <>
        <StructureExercise key={`${card.id}:${exerciseVersion}`} sentence={card} onNext={nextExercise} />
        <View style={s.row}>
          <StudyButton title="Другое предложение" onPress={nextExercise} />
          <StudyButton title="Уточнить маркеры с ИИ" disabled={aiDisabled} onPress={() => void task.run((signal, phase) => analyzeStudySentence(card.sentence, code, signal, phase), result => { setCard(result); setExerciseVersion(v => v + 1); })} />
        </View>
        <Text style={s.small}>Уточнение отправляет ИИ только выбранное предложение. Полученный разбор проходит дополнительную проверку, но может содержать ошибки.</Text>
        <StructureProgress language={language.label} />
      </>}
      {mode === 'Нарастающее' && (() => {
        const step = Math.min(seriesStep, activeSeries.length - 1);
        const current = activeSeries[step];
        const previous = step > 0 ? activeSeries[step - 1] : null;
        const goTo = (next: number) => { setSeriesStep(next); setShowAdded(false); };
        return <View style={s.card}>
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
            <StudyButton title="Другая серия" disabled={seriesList.length < 2} onPress={otherSeries} />
            <StudyButton title="Новые серии (ИИ)" disabled={aiDisabled} onPress={() => void task.run(async (signal, phase) => {
              phase('Составляем серии предложений…');
              const state = useStore.getState();
              return generateSentenceBatch(code, state.words, 8, undefined, state.sentences.filter(item => item.language === language.label).map(item => item.sentence), { signal, phase });
            }, batch => { useStore.getState().addGeneratedSentences(batch); setSeriesId(batch.find(item => item.chainStep === 0)?.generationBatchId ?? null); setSeriesStep(0); setShowAdded(false); })} />
          </View>
        </View>;
      })()}
      {mode === 'Развитие' && <View style={s.card}>
        <Text style={s.title}>Как развивается мысль</Text>
        <Text style={s.text}>Основа сохраняется. Новая деталь отмечена словом «новое» и светлым фоном; цвет подчёркивания показывает роль.</Text>
        <View style={s.row}>{chain.map((item, i) => <StudyButton key={item.id} title={`${i + 1}. ${steps[i] ?? '+ Ваша деталь'}`} selected={i === chainIndex} onPress={() => setChainIndex(i)} />)}</View>
        {chainIndex > 0 && <Text style={s.small}>Было: {chain[chainIndex - 1].sentence}</Text>}
        <Text style={s.text}>{chain[chainIndex].sentence}</Text>
        <StudyTokens sentence={chain[chainIndex]} added={chainIndex ? addedTokenIndices(chain[chainIndex - 1], chain[chainIndex]) : []} />
        <Text style={s.text}>{chain[chainIndex].literalTranslation}</Text>
        <Text style={s.small}>Добавьте к выбранному шагу одну деталь. ИИ получит предложение и вашу формулировку; результат продолжит цепочку от этого шага.</Text>
        <View style={s.row}><StudyButton title="Добавить определение" onPress={() => setAddition('Добавь одно определение к подлежащему, сохранив всё остальное.')} /><StudyButton title="Добавить обстоятельство" onPress={() => setAddition('Добавь одно обстоятельство времени, сохранив всё остальное.')} /></View>
        <TextInput accessibilityLabel="Деталь для развития" style={s.input} multiline maxLength={200} value={addition} onChangeText={setAddition} placeholder="Например: добавить, когда это происходит" />
        <StudyButton title="Продолжить цепочку с ИИ" disabled={aiDisabled || !addition.trim() || chain.length >= 20} onPress={() => void task.run((signal, phase) => extendStudySentence(chain[chainIndex], code, addition, signal, phase), result => {
          setChain(old => [...old.slice(0, chainIndex + 1), result]); setChainIndex(chainIndex + 1); setAddition('');
        })} />
        <StudyButton title="Сохранить выбранное предложение" onPress={() => { useStore.getState().addSentence({ ...chain[chainIndex], id: `manual_${newId()}`, source: 'manual' }); task.setError('Предложение сохранено в тренажёре.'); }} />
        <Text style={s.small}>Свои продолжения остаются на этом экране до смены языка или выхода. Нужные предложения можно сохранить отдельно.</Text>
      </View>}
      {mode === 'Языки' && <>
        <View style={s.card}>
          <Text style={s.title}>Одна мысль — разные языки</Text>
          <Text style={s.text}>{compareBase ? `Исходное предложение: ${compareBase.sentence}` : 'Маленький мальчик читает здесь книгу.'}</Text>
          <Text style={s.small}>Порядок слов естественен для каждого языка. Нажмите на роль, чтобы сопоставить её во всех предложениях.</Text>
          <View style={s.row}>{(['Predicate', 'Subject', 'Attribute_Subject', 'Object', 'Circumstance'] as SyntaxRole[]).map(item => <StudyButton key={item} title={ROLE_TRANSLATIONS[item]} selected={role === item} onPress={() => setRole(role === item ? undefined : item)} />)}</View>
          <View style={s.row}><StudyButton title="Встроенное сравнение" onPress={() => { task.cancel(); setCompareBase(null); setComparisons(comparisonExamples()); }} /><StudyButton title="Сравнить моё предложение" onPress={() => { task.cancel(); setCompareBase(card); setComparisons([card]); }} /></View>
          {compareBase && <>
            <Text style={s.small}>Выберите язык. Перевод и проверка смысла запускаются только по кнопке; исходное предложение отправляется ИИ.</Text>
            <View style={s.row}>{LANGUAGES.filter(item => item.label !== compareBase.language).map(item => <StudyButton key={item.code} title={item.label} selected={target === item.code} onPress={() => setTarget(item.code)} />)}</View>
            <StudyButton title="Добавить перевод с ИИ" disabled={aiDisabled || LANGUAGES.find(l => l.code === target)?.label === compareBase.language} onPress={() => void task.run((signal, phase) => translateStudySentence(compareBase, target, signal, phase), result => setComparisons(old => [...old.filter(s => s.language !== result.language), result]))} />
          </>}
        </View>
        {comparisons.map(item => <View key={item.language} style={s.card}><Text style={s.title}>{item.language}</Text><Text style={s.text}>{item.sentence}</Text><StudyTokens sentence={item} role={role} /></View>)}
      </>}
      {mode === 'Мой текст' && <>
        {reading && <StudyButton title={creatingText ? 'Вернуться к чтению' : 'Добавить новый текст'} onPress={() => setCreatingText(!creatingText)} />}
        {(!reading || creatingText) && <View style={s.card}>
          <Text style={s.title}>Читать свой текст</Text>
          <Text style={s.text}>Вставьте небольшой абзац на выбранном языке. До 20 предложений, 6000 символов; до 10 сохранённых текстов.</Text>
          <TextInput accessibilityLabel="Текст для чтения" style={[s.input, { minHeight: 130, textAlignVertical: 'top' }]} multiline value={draft} onChangeText={value => { setDraft(value); setReviewed(false); }} placeholder="Вставьте текст…" />
          <StudyButton title="Предложить границы предложений" disabled={!draft.trim()} onPress={() => { setDraft(suggestReadingSegments(draft)); setReviewed(true); }} />
          {reviewed && <Text style={s.small}>Проверьте границы: одно предложение на строку. Автоматическое деление может ошибаться на сокращениях. Исправьте строки и сохраните.</Text>}
          <StudyButton title="Сохранить текст с этими границами" disabled={!draft.trim()} onPress={saveText} />
        </View>}
        {readingTexts.filter(t => t.language === language.label).map(item => <View key={item.id} style={s.card}>
          <Text style={s.text}>{item.title} · {item.position + 1}/{item.segments.length}</Text>
          <View style={s.row}><StudyButton title="Открыть текст" selected={readingId === item.id} onPress={() => setReadingId(item.id)} />
            <StudyButton title={deleteId === item.id ? 'Подтвердить удаление текста' : 'Удалить текст'} onPress={() => { if (deleteId === item.id) { task.cancel(); useStore.getState().removeReadingText(item.id); setDeleteId(null); } else setDeleteId(item.id); }} />
            {deleteId === item.id && <StudyButton title="Оставить текст" onPress={() => setDeleteId(null)} />}
          </View>
        </View>)}
        {reading && <View style={s.card}>
          <Text style={s.title}>Предложение {reading.position + 1} из {reading.segments.length}</Text>
          <Text style={s.text}>{reading.segments[reading.position]}</Text>
          <Text style={s.small}>Сначала попробуйте найти основу самостоятельно. Подготовка разметки отправляет ИИ только это предложение; перевод и ответы останутся скрыты до вашего действия.</Text>
          {!readingCard && <StudyButton title="Подготовить разбор ИИ" disabled={aiDisabled} onPress={analyzeReading} />}
          {readingCard && <StructureExercise key={`${reading.id}:${reading.position}:${readingCard.id}`} sentence={readingCard} />}
          <View style={s.row}>
            <StudyButton title="Предыдущее предложение" disabled={!reading.position} onPress={() => { task.cancel(); useStore.getState().saveReadingText({ ...reading, position: reading.position - 1 }); }} />
            <StudyButton title="Следующее предложение" disabled={reading.position >= reading.segments.length - 1} onPress={() => { task.cancel(); useStore.getState().saveReadingText({ ...reading, position: reading.position + 1 }); }} />
          </View>
        </View>}
      </>}
    </ScrollView>
  </View>;
}
