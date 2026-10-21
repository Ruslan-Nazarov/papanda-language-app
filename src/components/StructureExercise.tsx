import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import type { Sentence } from '../models/types';
import { useStore } from '../store/useStore';
import { studyGroups, selectionResult, roleQuestion, markerObservation, structureSummary } from '../utils/structureStudy';
import { ROLE_TRANSLATIONS, getRoleColor } from '../constants/sentencePresentation';
import { StudyButton, studyStyles as s } from './StudyUI';
import { BookRuleLink } from './BookConnections';

/** Mount with a new key when the annotation changes: an attempt belongs to one exact card. */
export default function StructureExercise({ sentence, onNext }: { sentence: Sentence; onNext?: () => void }) {
  const [session] = useState(() => `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<number[]>([]);
  const [hint, setHint] = useState(0);
  const [checked, setChecked] = useState(false);
  const [disputed, setDisputed] = useState(false);
  const [translation, setTranslation] = useState(false);
  const [translationSeen, setTranslationSeen] = useState(false);
  const groups = studyGroups(sentence), group = groups[step];
  const result = group ? selectionResult(selected, group.tokenIndices) : undefined;
  const attemptId = `${session}:${step}`;
  const next = () => { setStep(step + 1); setSelected([]); setHint(translationSeen ? 2 : 0); setChecked(false); setDisputed(false); };
  const check = () => {
    if (!group || checked) return;
    useStore.getState().recordStructureAttempt({ id: attemptId, sentenceId: sentence.id, language: sentence.language,
      role: group.role, clauseIndex: group.clauseIndex, selected, expected: group.tokenIndices,
      result: result!.correct ? 'correct' : 'incorrect', hintLevel: hint, createdAt: new Date().toISOString() });
    setChecked(true);
  };
  const words = (indices: number[]) => indices.map(i => sentence.words[i].text).join(' · ');
  return <View style={s.card}>
    <Text style={s.title}>Разбери сам</Text>
    <Text style={s.text}>{sentence.sentence}</Text>
    {group ? <>
      <Text style={s.small}>Шаг {step + 1} из {groups.length} · часть предложения {group.clauseIndex + 1}</Text>
      <Text style={s.text}>Найдите: {ROLE_TRANSLATIONS[group.role].toLowerCase()}.</Text>
      <BookRuleLink language={sentence.language} role={group.role} sentence={sentence.sentence} tokens={sentence.words} onConsult={() => setHint(2)} />
      <Text style={s.small}>Нажмите на все нужные слова. Части сказуемого могут стоять отдельно. Артикли и предлоги в этой разметке выделены отдельно.</Text>
      <View style={s.row}>{sentence.words.map((word, i) => <TouchableOpacity key={i} accessibilityRole="checkbox"
        accessibilityLabel={`Слово ${i + 1}: ${word.text}`} accessibilityState={{ checked: selected.includes(i), disabled: checked }} disabled={checked}
        onPress={() => setSelected(old => old.includes(i) ? old.filter(index => index !== i) : [...old, i])}
        style={[s.token, { backgroundColor: selected.includes(i) ? '#DBEAFE' : '#F1F5F9', borderBottomColor: checked && group.tokenIndices.includes(i) ? getRoleColor(group.role) : 'transparent' }]}>
        <Text style={s.word}>{word.text}</Text>
        {checked && group.tokenIndices.includes(i) && <Text style={s.small}>По разметке ✓</Text>}
      </TouchableOpacity>)}</View>
      {hint >= 1 && <Text style={s.text}>{roleQuestion(group.role)}</Text>}
      {hint >= 2 && <Text style={s.text}>{markerObservation(sentence, group)}</Text>}
      {!checked ? <View style={s.row}>
        <StudyButton title="Проверить выбор" onPress={check} />
        <StudyButton title={hint === 0 ? 'Подсказка-вопрос' : 'Как это найти?'} disabled={hint === 2} onPress={() => setHint(hint + 1)} />
        <StudyButton title="Пропустить без оценки" onPress={next} />
      </View> : <>
        <Text accessibilityLiveRegion="polite" style={s.text}>{disputed ? 'Ответ исключён из статистики.' : result!.correct ? 'Совпадает с разметкой.' : 'Есть отличие от разметки.'}</Text>
        {!!result!.missing.length && <Text style={s.text}>Не выбрано: {words(result!.missing)}</Text>}
        {!!result!.extra.length && <Text style={s.text}>Лишнее: {words(result!.extra)}</Text>}
        <Text style={s.text}>{markerObservation(sentence, group)}</Text>
        <View style={s.row}>
          <StudyButton title="Следующий шаг" onPress={next} />
          <StudyButton title="Разбор спорный" disabled={disputed} onPress={() => { useStore.getState().disputeStructureAttempt(attemptId); setDisputed(true); }} />
        </View>
      </>}
    </> : <><Text style={s.text}>Разбор завершён. Самостоятельные ответы, ответы с подсказкой и ошибки учитываются отдельно от словарного запаса.</Text>{onNext && <StudyButton title="Следующее упражнение" onPress={onNext} />}</>}
    <StudyButton title={translation ? 'Скрыть перевод' : 'Открыть перевод'} onPress={() => {
      setTranslation(!translation);
      // Seeing the translation also assists all subsequent answers in this exercise.
      if (!translation) { setHint(2); setTranslationSeen(true); }
    }} />
    {translation && <Text style={s.text}>{sentence.literalTranslation || 'Перевод не задан.'}</Text>}
  </View>;
}
export function StructureProgress({ language }: { language?: string }) {
  const attempts = useStore(state => state.structureAttempts);
  const rows = structureSummary(attempts, language);
  return <View style={s.card}>
    <Text style={s.title}>Навыки разбора</Text>
    <Text style={s.small}>Последние 500 ответов. Спорные исключены; эти результаты не меняют знание слов.</Text>
    {!rows.length && <Text style={s.text}>Статистика появится после самостоятельного разбора.</Text>}
    {rows.map(row => <Text key={row.language + row.role} style={s.text}>{row.language} · {ROLE_TRANSLATIONS[row.role]}: самостоятельно {row.independent}, с подсказкой {row.assisted}, ошибок {row.errors}.</Text>)}
    {!!rows[0] && (rows[0].errors > 0 || rows[0].assisted > 0) && <Text style={s.text}>Стоит повторить: {ROLE_TRANSLATIONS[rows[0].role].toLowerCase()}. Следующее упражнение подбирается с этой ролью.</Text>}
  </View>;
}
