import ReviewPlan from '../components/ReviewPlan';
import { StructureProgress } from '../components/StructureExercise';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { MainTabParamList } from '../navigation/types';
import { useShallow } from 'zustand/react/shallow';
import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../store/useStore';
import { LANGUAGES } from '../constants/languages';
import { Word } from '../models/types';
import { getWordTranslation } from '../utils/words';
import {
  calculateTotalVolume,
  calculateSeenWords,
  calculateFullyLearned,
  calculateShownToday,
  calculateIMWIndex,
  formatIMWScore,
  calculateKnownByLanguage,
  calculateKnowledgeDistribution,
  calculateFamiliarWordsEfficiency,
  WORD_MEMORY
} from '../utils/statistics';
import { ACCENT, ACCENT_DARK } from '../constants/theme';

const LANG_COLORS: Record<string, string> = {
  en: '#6366F1', it: '#10B981', de: '#EAB308', es: '#EC4899', fr: '#F97316', kz: '#0EA5E9', la: '#8B5CF6'
};

const ACTIVITY_DAYS = 14;

const formatDay = (d: Date) => `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}`;

interface SectionProps {
  icon: string;
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  help?: string;
}

function Section({ icon, title, children, defaultOpen = true, help }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [showHelp, setShowHelp] = useState(false);
  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.cardHeader} activeOpacity={0.7} onPress={() => setOpen(o => !o)}>
        <View style={styles.cardTitleRow}>
          <Text style={styles.cardHeaderIcon}>{icon}</Text>
          <Text style={styles.cardHeaderTitle}>{title}</Text>
        </View>
        {help && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`Как считается: ${title}`}
            onPress={() => setShowHelp(true)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={styles.helpBtn}
          >
            <Text style={styles.helpBtnText}>?</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.cardChevron}>{open ? '▾' : '▸'}</Text>
      </TouchableOpacity>
      {open && <View style={styles.cardBody}>{children}</View>}

      {help && (
        <Modal visible={showHelp} transparent animationType="fade" onRequestClose={() => setShowHelp(false)}>
          <TouchableOpacity style={styles.helpOverlay} activeOpacity={1} onPress={() => setShowHelp(false)}>
            <View style={styles.helpCard}>
              <Text style={styles.helpTitle}>{icon}  {title}</Text>
              <Text style={styles.helpText}>{help}</Text>
              <TouchableOpacity style={styles.helpClose} onPress={() => setShowHelp(false)}>
                <Text style={styles.helpCloseText}>Понятно</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      )}
    </View>
  );
}

// One labelled horizontal bar.
function BarRow({ label, value, max, color, valueText }: { label: string; value: number; max: number; color: string; valueText?: string }) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 2;
  return (
    <View style={styles.barRow}>
      <Text style={styles.barLabel} numberOfLines={1}>{label}</Text>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
      <Text style={styles.barValue}>{valueText ?? value}</Text>
    </View>
  );
}

export default function StatisticsScreen({ navigation }: BottomTabScreenProps<MainTabParamList, 'Statistics'>) {
  const insets = useSafeAreaInsets();
  const topPadding = Math.max(insets.top, Platform.OS === 'android' ? 24 : 16);
  const { words, activeLanguages, dailyShows, workoutSnapshots, recordImwSnapshot } = useStore(useShallow(state => ({
    words: state.words,
    activeLanguages: state.activeLanguages,
    dailyShows: state.dailyShows,
    workoutSnapshots: state.workoutSnapshots,
    recordImwSnapshot: state.recordImwSnapshot,
  })));

  // Refresh today's iMW point whenever the user opens this screen.
  useEffect(() => { recordImwSnapshot(); }, [recordImwSnapshot]);

  const activeLangObjs = LANGUAGES.filter(l => activeLanguages.includes(l.code));

  const summary = useMemo(() => ({
    total: calculateTotalVolume(words),
    seen: calculateSeenWords(words, activeLanguages),
    learned: calculateFullyLearned(words, activeLanguages),
    today: calculateShownToday(dailyShows)
  }), [words, activeLanguages, dailyShows]);

  // Activity: last N days of word shows.
  const activity = useMemo(() => {
    const now = new Date();
    const days = [];
    for (let i = ACTIVITY_DAYS - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const iso = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
      days.push({ label: formatDay(d), shows: dailyShows?.[iso] || 0 });
    }
    return days;
  }, [dailyShows]);
  const activityTotal = activity.reduce((s, d) => s + d.shows, 0);
  const activityMax = Math.max(...activity.map(d => d.shows), 1);

  const byLanguage = useMemo(() => {
    const known = calculateKnownByLanguage(words, activeLanguages);
    return activeLangObjs.map(lang => ({
      ...lang,
      known: known[lang.code]?.count || 0,
      color: LANG_COLORS[lang.code] || '#3B82F6'
    }));
  }, [words, activeLanguages]);
  const byLanguageMax = Math.max(...byLanguage.map(l => l.known), 5);

  // Repetition buckets — "new" (never shown) is shown as a note, not a bar,
  // so it doesn't dwarf everything else.
  const repetition = useMemo(() => {
    const d = calculateKnowledgeDistribution(words, activeLanguages);
    return {
      new: d.new,
      buckets: [
        { label: '1–5 показов', count: d.beginner, color: '#FCD34D' },
        { label: '6–15 показов', count: d.intermediate, color: '#FBBF24' },
        { label: '16–40 показов', count: d.advanced, color: '#FB923C' },
        { label: '41–80 показов', count: d.expert, color: '#F97316' },
        { label: 'больше 80', count: d.master, color: '#22C55E' }
      ]
    };
  }, [words, activeLanguages]);
  const repetitionMax = Math.max(...repetition.buckets.map(b => b.count), 1);

  const imw = useMemo(() => {
    const res = calculateIMWIndex(words, activeLanguages);
    return {
      overall: res.overall,
      langs: activeLangObjs.map(lang => ({ ...lang, pct: res.byLanguage[lang.code] || 0 }))
    };
  }, [words, activeLanguages]);

  const efficiency = useMemo(() => {
    if (!workoutSnapshots?.length) return [];
    return calculateFamiliarWordsEfficiency(workoutSnapshots)
      .filter(item => item.total > 0)
      .slice(-10)
      .reverse()
      .map(item => ({ ...item, displayDate: item.date.split('-').reverse().join('.') }));
  }, [workoutSnapshots]);
  const efficiencyTotal = efficiency.reduce((sum, day) => sum + day.total, 0);
  const efficiencyKnown = efficiency.reduce((sum, day) => sum + day.absolute, 0);

  const frequentWords = useMemo(
    () => words.filter(w => (w.count || 0) > 0).sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 15),
    [words]
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.scroll, { paddingTop: topPadding }]}>
      <Text style={styles.screenTitle}>Статистика обучения</Text>

      <ReviewPlan onStart={() => navigation.navigate('Brain Workout')} />
      <StructureProgress />
      {/* Summary tiles */}
      <View style={styles.tilesRow}>
        <View style={styles.tile}>
          <Text style={styles.tileValue}>{summary.total}</Text>
          <Text style={styles.tileLabel}>слов в базе</Text>
        </View>
        <View style={styles.tile}>
          <Text style={styles.tileValue}>{summary.seen}</Text>
          <Text style={styles.tileLabel}>просмотрено</Text>
        </View>
      </View>
      <View style={styles.tilesRow}>
        <View style={styles.tile}>
          <Text style={[styles.tileValue, { color: '#16A34A' }]}>{summary.learned}</Text>
          <Text style={styles.tileLabel}>выучено полностью</Text>
        </View>
        <View style={styles.tile}>
          <Text style={[styles.tileValue, { color: ACCENT_DARK }]}>{summary.today}</Text>
          <Text style={styles.tileLabel}>показов сегодня</Text>
        </View>
      </View>

      {/* Activity */}
      <Section
        icon="📅"
        title={`Активность за ${ACTIVITY_DAYS} дней`}
        help="Сколько раз в день приложение показывало тебе слова — в тренировке, в тройках слов и в разборе предложений. Помогает следить за регулярностью занятий: важнее заниматься понемногу каждый день, чем помногу раз в неделю."
      >
        <Text style={styles.sectionNote}>Всего показов за период: {activityTotal}</Text>
        <View style={styles.activityChart}>
          {activity.map((d, i) => (
            <View key={i} style={styles.activityCol}>
              <Text style={styles.activityValue}>{d.shows > 0 ? d.shows : ''}</Text>
              <View style={styles.activityTrack}>
                <View
                  style={[
                    styles.activityFill,
                    { height: `${d.shows > 0 ? Math.max(6, (d.shows / activityMax) * 100) : 0}%` }
                  ]}
                />
              </View>
              <Text style={styles.activityDay}>{d.label.slice(0, 2)}</Text>
            </View>
          ))}
        </View>
      </Section>

      {/* Knowledge by language */}
      <Section
        icon="🌍"
        title="Знание по языкам"
        help="Сколько слов ты отметил как «выучено» отдельно по каждому языку. Отметка ставится в тренировке кнопкой «Знаю» или когда проходишь тройку слов целиком. Одно и то же слово может быть выучено на одном языке и не выучено на другом."
      >
        {byLanguage.length === 0 ? (
          <Text style={styles.emptyText}>Нет активных языков.</Text>
        ) : (
          byLanguage.map(lang => (
            <BarRow
              key={lang.code}
              label={`${lang.flag} ${lang.label}`}
              value={lang.known}
              max={byLanguageMax}
              color={lang.color}
            />
          ))
        )}
        <Text style={styles.sectionNote}>Слов, отмеченных как выученные, по каждому языку.</Text>
      </Section>

      {/* Repetition */}
      <Section
        icon="🔁"
        title="По количеству повторений"
        help="Распределение начатых слов по тому, сколько раз ты их видел (в среднем по языкам, которые учишь). Цель — около 80 показов на слово: примерно столько повторений нужно, чтобы слово надёжно осело в долговременной памяти. Слова, которые ни разу не показывались, вынесены отдельной строкой."
      >
        {repetition.buckets.map(b => (
          <BarRow key={b.label} label={b.label} value={b.count} max={repetitionMax} color={b.color} />
        ))}
        <Text style={styles.sectionNote}>Ещё {repetition.new} слов ни разу не показывались.</Text>
      </Section>

      {/* Efficiency */}
      <Section
        icon="🎯"
        title="Результаты тренировок"
        help="Здесь учитываются ответы в завершённых тренировках слов. «Знаю» — вы отметили, что вспомнили перевод; «Не знаю» — что не вспомнили. Процент — число ответов «Знаю», делённое на число всех ответов. Повторный ответ на то же слово считается отдельно. Несколько тренировок в один день объединяются. Показаны последние 10 дней с ответами. Это ваша самооценка: состав и сложность слов могут меняться, поэтому процент сам по себе не доказывает рост знаний."
      >
        {efficiency.length === 0 ? (
          <View testID="workout-results-empty">
            <Text style={styles.explanation}>Пока нет завершённых тренировок слов.</Text>
            <Text style={styles.resultDetail}>После тренировки здесь появится, сколько раз вы ответили «Знаю» и «Не знаю».</Text>
            <TouchableOpacity accessibilityRole="button" style={styles.startButton} onPress={() => navigation.navigate('Brain Workout')}>
              <Text style={styles.startButtonText}>Начать тренировку</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View testID="workout-results">
            <Text style={styles.explanation}>Как часто вы вспоминали перевод в завершённых тренировках слов.</Text>
            <View style={styles.resultSummary}>
              <Text style={styles.resultPercent}>{Math.round(efficiencyKnown / efficiencyTotal * 100)}%</Text>
              <Text style={styles.resultLabel}>ответов «Знаю»</Text>
              <Text style={styles.resultDetail}>Вспомнили: {efficiencyKnown} из {efficiencyTotal} ответов</Text>
              <Text style={styles.resultDetail}>«Не знаю»: {efficiencyTotal - efficiencyKnown}</Text>
              <Text style={styles.resultPeriod}>Итого за показанные ниже дни с тренировками</Text>
            </View>
            <Text style={styles.resultLabel}>По датам · сначала новые</Text>
            {efficiency.map(e => (
              <View key={e.date} style={styles.resultDay}>
                <Text style={styles.resultDate}>{e.displayDate}</Text>
                <Text style={styles.resultDayKnown}>«Знаю»: {e.absolute} из {e.total} · {Math.round(e.percentage)}%</Text>
                <Text style={styles.resultDetail}>«Не знаю»: {e.total - e.absolute}</Text>
              </View>
            ))}
            <Text style={styles.explanation}>Это ваши отметки, а не проверка перевода. Результат зависит и от сложности выбранных слов.</Text>
          </View>
        )}
      </Section>

      {/* iMW */}
      <Section
        icon="🧠"
        title="Оценка закрепления"
        defaultOpen={false}
        help={
          `Индекс iMW от 0 до 100 оценивает закрепление всего словаря: ${summary.total} слов в активных языках. Непоказанные слова тоже учитываются, с нулевым вкладом.\n\n` +
          `Вес каждого слова зависит от числа показов, отметки «Знаю» и давности занятий. ${WORD_MEMORY.TARGET_SHOWS} показов дают полный балл за повторения; без «Знаю» вклад вдвое меньше. После перерыва вклад постепенно снижается. Итог — сумма весов, делённая на число всех слов и активных языков, умноженная на 100.\n\n` +
          'Число 80 — настройка расчёта, а не обязательное число повторений для запоминания. Оценка относится к вашему словарю, не измеряет знание всего языка и не гарантирует, что вы помните перевод.'
        }
      >
        <View testID="memory-estimate">
          <Text style={styles.explanation}>Закрепление всего словаря с учётом повторений, отметок «Знаю» и давности занятий.</Text>
          <View style={styles.resultSummary}>
            <Text testID="memory-score" style={styles.memoryScore}>{formatIMWScore(imw.overall)} из 100</Text>
            <Text style={styles.resultDetail}>По всему словарю: {summary.total} слов</Text>
          </View>
          {imw.langs.map(lang => (
            <View key={lang.code} style={styles.memoryRow}>
              <Text style={styles.memoryLanguage}>{lang.flag} {lang.label}</Text>
              <Text testID={`memory-score-${lang.code}`} style={styles.memoryValue}>{formatIMWScore(lang.pct)} / 100</Text>
            </View>
          ))}
          <Text style={styles.explanation}>Непоказанные слова дают нулевой вклад. Индекс растёт по мере изучения и закрепления базы; после перерыва может снижаться.</Text>
        </View>
      </Section>

      {/* Frequent words */}
      <Section
        icon="🔥"
        title="Частые слова"
        defaultOpen={false}
        help="Слова, которые встречались тебе чаще всего — по суммарному числу показов во всех разделах. Обычно это самая частотная лексика, которую ты уже почти не путаешь."
      >
        {frequentWords.length === 0 ? (
          <Text style={styles.emptyText}>Слова появятся здесь после тренировок.</Text>
        ) : (
          frequentWords.map((word, i) => (
            <View key={word.eng || word.word || i} style={styles.wordCard}>
              <View style={styles.wordCardHeader}>
                <Text style={styles.wordRu} numberOfLines={1}>{word.ru || getWordTranslation(word, word.source_language || 'en') || word.word}</Text>
                <Text style={styles.wordCount}>{word.count || 0}×</Text>
              </View>
              <View style={styles.wordTransRow}>
                {activeLangObjs.map(lang => {
                  const trans = (word[lang.code as keyof Word] || word.translations?.[lang.code]) as string | undefined;
                  if (!trans) return null;
                  return (
                    <Text key={lang.code} style={styles.wordTrans}>
                      {lang.flag} <Text style={styles.wordTransText}>{trans}</Text>
                    </Text>
                  );
                })}
              </View>
            </View>
          ))
        )}
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F6F8' },
  scroll: { padding: 16, paddingBottom: 48 },
  screenTitle: { fontSize: 24, fontWeight: 'bold', color: '#1A202C', marginBottom: 16 },

  tilesRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  tile: {
    flex: 1, backgroundColor: '#FFF', borderRadius: 16, paddingVertical: 16, paddingHorizontal: 14,
    borderWidth: 1, borderColor: '#ECEFF1', alignItems: 'flex-start'
  },
  tileValue: { fontSize: 26, fontWeight: 'bold', color: '#1A202C' },
  tileLabel: { fontSize: 12, color: '#64748B', marginTop: 2 },

  card: {
    backgroundColor: '#FFF', borderRadius: 16, marginTop: 12,
    borderWidth: 1, borderColor: '#ECEFF1', overflow: 'hidden'
  },
  cardHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16
  },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  cardHeaderIcon: { fontSize: 18 },
  cardHeaderTitle: { fontSize: 16, fontWeight: 'bold', color: '#1A202C', flex: 1 },
  cardChevron: { fontSize: 16, color: '#94A3B8' },
  cardBody: { paddingHorizontal: 16, paddingBottom: 16 },

  helpBtn: {
    width: 22, height: 22, borderRadius: 11, marginRight: 18,
    backgroundColor: '#EEF2F7', borderWidth: 1, borderColor: '#D9E1EC',
    alignItems: 'center', justifyContent: 'center',
  },
  helpBtnText: { fontSize: 13, fontWeight: '800', color: '#64748B', lineHeight: 15 },
  helpOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  helpCard: { backgroundColor: '#FFF', borderRadius: 16, padding: 20, maxWidth: 420, width: '100%' },
  helpTitle: { fontSize: 16, fontWeight: 'bold', color: '#1A202C', marginBottom: 10 },
  helpText: { fontSize: 14, color: '#475569', lineHeight: 21 },
  helpClose: { marginTop: 18, alignSelf: 'flex-end', paddingVertical: 8, paddingHorizontal: 18, borderRadius: 10, backgroundColor: ACCENT },
  helpCloseText: { color: '#FFF', fontWeight: 'bold', fontSize: 14 },

  sectionNote: { fontSize: 12, color: '#94A3B8', marginTop: 10, lineHeight: 17 },
  emptyText: { fontSize: 13, color: '#64748B', fontStyle: 'italic', textAlign: 'center', paddingVertical: 14 },

  barRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 10 },
  barLabel: { width: 96, fontSize: 12, color: '#475569', fontWeight: '600' },
  barTrack: { flex: 1, height: 16, backgroundColor: '#F1F5F9', borderRadius: 8, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 8 },
  barValue: { width: 48, fontSize: 12, fontWeight: 'bold', color: '#334155', textAlign: 'right' },

  activityChart: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    height: 150, marginTop: 12
  },
  activityCol: { flex: 1, alignItems: 'center', height: '100%', justifyContent: 'flex-end' },
  activityValue: { fontSize: 9, color: '#64748B', fontWeight: '600', marginBottom: 3 },
  activityTrack: { width: 12, flex: 1, backgroundColor: '#F1F5F9', borderRadius: 4, justifyContent: 'flex-end', overflow: 'hidden' },
  activityFill: { width: '100%', backgroundColor: ACCENT, borderRadius: 4 },
  activityDay: { fontSize: 9, color: '#94A3B8', marginTop: 5 },

  explanation: { fontSize: 13, color: '#475569', lineHeight: 19, marginBottom: 12 },
  resultSummary: { backgroundColor: '#F8FAFC', borderRadius: 12, padding: 16, marginBottom: 16 },
  resultPercent: { fontSize: 32, fontWeight: '800', color: '#15803D' },
  resultLabel: { fontSize: 13, fontWeight: '700', color: '#334155', lineHeight: 19 },
  resultDetail: { fontSize: 13, color: '#475569', lineHeight: 20, marginTop: 4 },
  resultPeriod: { fontSize: 12, color: '#64748B', lineHeight: 18, marginTop: 10 },
  resultDay: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#E2E8F0', marginBottom: 10 },
  resultDate: { fontSize: 12, fontWeight: '600', color: '#64748B', marginBottom: 4 },
  resultDayKnown: { fontSize: 14, fontWeight: '700', color: '#1E293B', lineHeight: 21 },
  startButton: { backgroundColor: ACCENT, borderRadius: 10, padding: 12, alignItems: 'center', marginTop: 14 },
  startButtonText: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  memoryScore: { fontSize: 26, fontWeight: '800', color: '#334155' },
  memoryRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  memoryLanguage: { flex: 1, fontSize: 13, color: '#475569' },
  memoryValue: { fontSize: 13, fontWeight: '700', color: '#334155' },

  divider: { height: 1, backgroundColor: '#F1F5F9', marginVertical: 12 },

  wordCard: { backgroundColor: '#F8FAFC', borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#F1F5F9' },
  wordCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  wordRu: { fontSize: 15, fontWeight: 'bold', color: '#1E293B', flex: 1 },
  wordCount: { fontSize: 12, fontWeight: '700', color: '#C2410C', marginLeft: 8 },
  wordTransRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  wordTrans: { fontSize: 13 },
  wordTransText: { color: '#475569', fontWeight: '500' }
});
