import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import type { Sentence, SyntaxRole } from '../models/types';
import type { ExerciseCheckpoint } from '../models/sentenceLessons';
import { createExerciseCheckpoint } from '../utils/sentenceLessons';
import { useStore } from '../store/useStore';
import { studyGroups, selectionResult, roleQuestion, markerObservation, structureSummary } from '../utils/structureStudy';
import { ROLE_TRANSLATIONS, getRoleColor } from '../constants/sentencePresentation';
import { StudyButton, studyStyles as s } from './StudyUI';
import { BookRuleLink } from './BookConnections';

/** Mount with a new key when the annotation changes: an attempt belongs to one exact card. */
export default function StructureExercise({ sentence, onNext, checkpoint, onCheckpoint, roles, guided = false, nextTitle = 'Следующее упражнение' }: {
  sentence: Sentence; onNext?: () => void; checkpoint?: ExerciseCheckpoint;
  onCheckpoint?: (progress: ExerciseCheckpoint) => void; roles?: SyntaxRole[]; guided?: boolean; nextTitle?: string;
}) {
  const [localProgress, setLocalProgress] = useState(createExerciseCheckpoint);
  const progress = checkpoint ?? localProgress;
  const { id: session, step, selected, hint, checked, disputed, translation, translationSeen } = progress;
  const commit = (change: Partial<ExerciseCheckpoint>) => {
    const next = { ...progress, ...change };
    if (onCheckpoint) onCheckpoint(next); else setLocalProgress(next);
  };
  const groups = studyGroups(sentence).filter(group => !roles || roles.includes(group.role)), group = groups[step];
  const result = group ? selectionResult(selected, group.tokenIndices) : undefined;
  const attemptId = `${session}:${step}`;
  const next = () => {
    const outcomes = checked ? progress.outcomes : [...progress.outcomes, { role: group.role, result: 'skipped' as const, hintLevel: hint }];
    commit({ step: step + 1, selected: [], hint: translationSeen || guided ? 2 : 0, checked: false, disputed: false, outcomes });
  };
  const check = () => {
    if (!group || checked) return;
    useStore.getState().recordStructureAttempt({ id: attemptId, sentenceId: sentence.id, language: sentence.language,
      role: group.role, clauseIndex: group.clauseIndex, selected, expected: group.tokenIndices,
      result: result!.correct ? 'correct' : 'incorrect', hintLevel: hint, createdAt: new Date().toISOString() });
    commit({ checked: true, outcomes: [...progress.outcomes, { role: group.role, result: result!.correct ? 'correct' : 'incorrect', hintLevel: hint }] });
  };
  const words = (indices: number[]) => indices.map(i => sentence.words[i].text).join(' · ');
  return <View style={s.card}>
    <Text style={s.title}>Разбери сам</Text>
    <Text style={s.text}>{sentence.sentence}</Text>
    {group ? <>
      <Text style={s.small}>Шаг {step + 1} из {groups.length} · часть предложения {group.clauseIndex + 1}</Text>
      <Text style={s.text}>Найдите: {ROLE_TRANSLATIONS[group.role].toLowerCase()}.</Text>
      <BookRuleLink language={sentence.language} role={group.role} sentence={sentence.sentence} tokens={sentence.words} onConsult={() => commit({ hint: 2 })} />
      <Text style={s.small}>Нажмите на все нужные слова. Части сказуемого могут стоять отдельно. Артикли и предлоги в этой разметке выделены отдельно.</Text>
      <View style={s.row}>{sentence.words.map((word, i) => <TouchableOpacity key={i} accessibilityRole="checkbox"
        accessibilityLabel={`Слово ${i + 1}: ${word.text}`} accessibilityState={{ checked: selected.includes(i), disabled: checked }} disabled={checked}
        onPress={() => commit({ selected: selected.includes(i) ? selected.filter(index => index !== i) : [...selected, i] })}
        style={[s.token, { backgroundColor: selected.includes(i) ? '#DBEAFE' : '#F1F5F9', borderBottomColor: checked && group.tokenIndices.includes(i) ? getRoleColor(group.role) : 'transparent' }]}>
        <Text style={s.word}>{word.text}</Text>
        {checked && group.tokenIndices.includes(i) && <Text style={s.small}>По разметке ✓</Text>}
      </TouchableOpacity>)}</View>
      {hint >= 1 && <Text style={s.text}>{roleQuestion(group.role)}</Text>}
      {hint >= 2 && <Text style={s.text}>{markerObservation(sentence, group)}</Text>}
      {!checked ? <View style={s.row}>
        <StudyButton title="Проверить выбор" onPress={check} />
        <StudyButton title={hint === 0 ? 'Подсказка-вопрос' : 'Как это найти?'} disabled={hint === 2} onPress={() => commit({ hint: hint + 1 })} />
        <StudyButton title="Пропустить без оценки" onPress={next} />
      </View> : <>
        <Text accessibilityLiveRegion="polite" style={s.text}>{disputed ? 'Ответ исключён из статистики.' : result!.correct ? 'Совпадает с разметкой.' : 'Есть отличие от разметки.'}</Text>
        {!!result!.missing.length && <Text style={s.text}>Не выбрано: {words(result!.missing)}</Text>}
        {!!result!.extra.length && <Text style={s.text}>Лишнее: {words(result!.extra)}</Text>}
        <Text style={s.text}>{markerObservation(sentence, group)}</Text>
        <View style={s.row}>
          <StudyButton title="Следующий шаг" onPress={next} />
          <StudyButton title="Разбор спорный" disabled={disputed} onPress={() => {
            useStore.getState().disputeStructureAttempt(attemptId);
            commit({ disputed: true, outcomes: progress.outcomes.map((answer, index) => index === step ? { ...answer, result: 'disputed' } : answer) });
          }} />
        </View>
      </>}
    </> : <><Text style={s.text}>Разбор завершён. Самостоятельные ответы, ответы с подсказкой и ошибки учитываются отдельно от словарного запаса.</Text>{onNext && <StudyButton title={nextTitle} onPress={onNext} />}</>}
    <StudyButton title={translation ? 'Скрыть перевод' : 'Открыть перевод'} onPress={() => {
      // Seeing the translation also assists all subsequent answers in this exercise.
      commit({ translation: !translation, ...(!translation ? { hint: 2, translationSeen: true } : {}) });
    }} />
    {translation && <Text style={s.text}>{sentence.literalTranslation || 'Перевод не задан.'}</Text>}
  </View>;
}
export function StructureProgress({ language, onOpenWorkshop }: { language?: string; onOpenWorkshop?: () => void }) {
  const attempts = useStore(state => state.structureAttempts);
  const rows = structureSummary(attempts, language);
  return <View style={s.card}>
    <Text style={s.title}>Навыки разбора предложения</Text>
    <Text style={s.small}>Последние 500 ответов. Спорные исключены; эти результаты не меняют знание слов.</Text>
    {!rows.length && <Text style={s.text}>Статистика появится после самостоятельного разбора.</Text>}
    {rows.map(row => <Text key={row.language + row.role} style={s.text}>{row.language} · {ROLE_TRANSLATIONS[row.role]}: самостоятельно {row.independent}, с подсказкой {row.assisted}, ошибок {row.errors}.</Text>)}
    {!!rows[0] && (rows[0].errors > 0 || rows[0].assisted > 0) && <Text style={s.text}>Стоит повторить: {ROLE_TRANSLATIONS[rows[0].role].toLowerCase()}. Следующее упражнение подбирается с этой ролью.</Text>}
    {onOpenWorkshop && <StudyButton title="Тренировки предложений →" onPress={onOpenWorkshop} />}
  </View>;
}
