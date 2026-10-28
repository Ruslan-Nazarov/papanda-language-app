import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LANGUAGES } from '../constants/languages';
import { ACCENT } from '../constants/theme';
import StructureExercise from '../components/StructureExercise';
import { StudyButton, studyStyles as s } from '../components/StudyUI';
import { useStore } from '../store/useStore';
import { emptyLessonProgress, lessonFocus, lessonRoles, nextLessonFocus, sentenceLessonCatalog, summarizeLesson } from '../utils/sentenceLessons';
import type { LessonPurpose } from '../models/sentenceLessons';

const PURPOSES: Record<LessonPurpose, string> = {
  warmup: 'Разминка · начните самостоятельно', review: 'Повторение · вспомните без подсказки',
  repair: 'Трудное место · попробуйте ещё раз', learn: 'Новый шаг · разбор с объяснением',
  practice: 'Практика · найдите сами', transfer: 'Проверка · другой пример той же конструкции',
};

export default function SentenceLessonsScreen({ onFree }: { onFree: () => void }) {
  const insets = useSafeAreaInsets();
  const activeLanguages = useStore(state => state.activeLanguages);
  const lessons = useStore(state => state.sentenceLessons);
  const sentences = useStore(state => state.sentences);
  const [selectedCode, setCode] = useState(activeLanguages[0] ?? 'en');
  const code = activeLanguages.includes(selectedCode) ? selectedCode : activeLanguages[0] ?? 'en';
  const language = LANGUAGES.find(item => item.code === code)!;
  const progress = lessons[code] ?? emptyLessonProgress();
  const current = progress.current;
  const [openedId, setOpenedId] = useState<string | null>(null);
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const scroll = useRef<ScrollView>(null);
  const catalog = useMemo(() => sentenceLessonCatalog(code, sentences), [sentences, code]);
  const nextFocus = useMemo(() => nextLessonFocus(catalog, progress), [catalog, progress]);
  const focus = lessonFocus(current && !current.completedAt ? current.focus : nextFocus);
  const studying = current && !current.completedAt && openedId === current.id;
  const result = current?.completedAt && dismissedId !== current.id ? summarizeLesson(current) : null;
  useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }); }, [current?.id, current?.position, code, studying]);
  const start = (count: 3 | 5) => {
    useStore.getState().startSentenceLesson(code, count);
    const lesson = useStore.getState().sentenceLessons[code]?.current;
    if (!lesson || lesson.completedAt) { setError('Пока не хватает разных предложений. Можно продолжить в свободном разборе.'); return; }
    setError(''); setOpenedId(lesson.id);
  };

  return <View testID="sentence-lessons-screen" style={{ flex: 1, backgroundColor: '#F8FAFC', paddingTop: Math.max(insets.top, 16) }}>
    <ScrollView ref={scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.eyebrow}>ЭКСПЕРИМЕНТ · КОРОТКИЕ ЗАНЯТИЯ</Text>
      <Text accessibilityRole="header" style={studying || result ? styles.compactHeading : styles.heading}>
        {studying ? `Занятие · ${language.label}` : result ? `Итог · ${language.label}` : 'Разбор предложений'}
      </Text>
      {!studying && !result && <View style={s.row}>{LANGUAGES.filter(item => activeLanguages.includes(item.code)).map(item =>
        <StudyButton key={item.code} title={`${item.flag} ${item.label}`} selected={item.code === code} onPress={() => { setCode(item.code); setError(''); }} />)}</View>}
      {studying ? <>
        <View style={s.card}>
          <Text style={s.title}>{focus.title}</Text>
          <Text testID="lesson-progress" accessibilityLiveRegion="polite" style={s.text}>Предложение {current.position + 1} из {current.items.length}</Text>
          <Text style={s.small}>{PURPOSES[current.items[current.position].purpose]}</Text>
          <Text style={s.text}>{focus.goal}</Text>
        </View>
        <StructureExercise key={current.items[current.position].progress.id}
          sentence={current.items[current.position].sentence} roles={lessonRoles(current.focus)}
          guided={current.items[current.position].purpose === 'learn'}
          checkpoint={current.items[current.position].progress}
          onCheckpoint={checkpoint => useStore.getState().updateSentenceLesson(code, current.id, current.position, checkpoint)}
          nextTitle={current.position === current.items.length - 1 ? 'Завершить занятие' : 'Следующее предложение'}
          onNext={() => useStore.getState().advanceSentenceLesson(code, current.id, current.position)} />
        <View style={s.row}>
          <StudyButton title="Продолжить позже" onPress={() => setOpenedId(null)} />
          <StudyButton title="Пропустить предложение" onPress={() => useStore.getState().advanceSentenceLesson(code, current.id, current.position, true)} />
        </View>
        <Text style={s.small}>Шаги и ответы сохраняются автоматически. Подсказки, перевод и обращение к книге считаются помощью.</Text>
      </> : result ? <View testID="lesson-result" style={s.card}>
        <Text style={s.title}>Занятие завершено · {current!.items.length} из {current!.items.length}</Text>
        <Text style={s.text}>Разобрано полностью: {result.sentencesCompleted}. С пропусками: {result.sentencesSkipped}.</Text>
        <Text style={s.text}>Ответы: самостоятельно {result.independent}, с помощью {result.assisted}, ошибок {result.errors}.</Text>
        {!!result.skipped && <Text style={s.text}>Шагов без оценки: {result.skipped}.</Text>}
        {!!result.disputed && <Text style={s.text}>Спорных ответов: {result.disputed}. Они исключены из оценки и подбора повторений.</Text>}
        <Text style={s.text}>{result.errors || result.assisted || result.skipped
          ? 'К трудным местам вернёмся в следующих занятиях. На сегодня можно закончить.'
          : result.independent ? 'В этом занятии вы находили части предложения самостоятельно. Проверим навык в другой день.' : 'Оценённых ответов пока нет. Можно вернуться к практике позже.'}</Text>
        <View style={s.row}>
          <StudyButton title="Закончить" onPress={() => setDismissedId(current!.id)} />
          <StudyButton title="Ещё 3 предложения" onPress={() => start(3)} />
        </View>
      </View> : <View testID="lesson-home" style={s.card}>
        <Text style={s.title}>{current && !current.completedAt ? 'Продолжить занятие' : 'Занятие на сегодня'}</Text>
        <Text style={styles.goal}>{focus.title}</Text>
        <Text style={s.text}>{focus.goal}</Text>
        <Text style={s.text}>{current && !current.completedAt
          ? `Завершено предложений: ${current.position} из ${current.items.length}. Текущий шаг сохранён.`
          : '5 предложений · ориентировочно 10–15 минут'}</Text>
        <Text style={s.small}>Разминка и повторение → объяснение → самостоятельная практика → проверка на другом примере.</Text>
        <StudyButton title={current && !current.completedAt ? 'Продолжить занятие' : 'Начать занятие'} selected onPress={() => start(5)} />
        <Text style={s.small}>Повторения входят в занятие. Пропущенные дни не увеличивают его объём.</Text>
      </View>}
      {!!error && <Text accessibilityRole="alert" style={s.warning}>{error}</Text>}
      {!studying && <Text style={s.small}>Темы: основа → признаки → дополнение → обстоятельства → несколько основ. Следующая тема открывается после самостоятельных результатов в разные дни.</Text>}
      <StudyButton title="Свободный разбор и свои тексты" onPress={onFree} />
      <Text style={s.small}>Эксперимент можно остановить в настройках. Начатое занятие и его результаты сохранятся.</Text>
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 32, maxWidth: 850, width: '100%', alignSelf: 'center', gap: 8 },
  eyebrow: { color: ACCENT, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  heading: { fontSize: 28, fontWeight: '800', color: '#172033' },
  compactHeading: { fontSize: 23, fontWeight: '800', color: '#172033' },
  goal: { fontSize: 22, fontWeight: '700', color: '#172033' },
});
