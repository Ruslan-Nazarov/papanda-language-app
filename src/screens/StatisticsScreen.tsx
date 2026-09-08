import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../store/useStore';
import { LANGUAGES } from '../constants/languages';
import { Word } from '../models/types';
import {
  calculateTotalVolume,
  calculateSeenWords,
  calculateFullyLearned,
  calculateShownToday,
  calculateIMWIndex,
  calculateImwTrend,
  calculateKnownByLanguage,
  calculateKnowledgeDistribution,
  calculateFamiliarWordsEfficiency
} from '../utils/statistics';

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
}

function Section({ icon, title, children, defaultOpen = true }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.cardHeader} activeOpacity={0.7} onPress={() => setOpen(o => !o)}>
        <View style={styles.cardTitleRow}>
          <Text style={styles.cardHeaderIcon}>{icon}</Text>
          <Text style={styles.cardHeaderTitle}>{title}</Text>
        </View>
        <Text style={styles.cardChevron}>{open ? '▾' : '▸'}</Text>
      </TouchableOpacity>
      {open && <View style={styles.cardBody}>{children}</View>}
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

export default function StatisticsScreen() {
  const insets = useSafeAreaInsets();
  const topPadding = Math.max(insets.top, Platform.OS === 'android' ? 24 : 16);
  const { words, activeLanguages, dailyShows, workoutSnapshots, imwSnapshots, recordImwSnapshot } = useStore();
  const [efficiencyMode, setEfficiencyMode] = useState<'percentage' | 'absolute'>('percentage');

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

  const imwTrend = useMemo(() => calculateImwTrend(imwSnapshots || []).slice(-16), [imwSnapshots]);
  const imwTrendMax = Math.max(...imwTrend.map(p => p.imw), 10);

  const efficiency = useMemo(() => {
    if (!workoutSnapshots?.length) return [];
    return calculateFamiliarWordsEfficiency(workoutSnapshots)
      .slice(-10)
      .map(item => ({ ...item, shortDate: item.date.slice(5).split('-').reverse().join('.') }));
  }, [workoutSnapshots]);
  const efficiencyAbsMax = Math.max(...efficiency.map(e => e.total), 1);

  const frequentWords = useMemo(
    () => words.filter(w => (w.count || 0) > 0).sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 15),
    [words]
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.scroll, { paddingTop: topPadding }]}>
      <Text style={styles.screenTitle}>Статистика обучения</Text>

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
          <Text style={[styles.tileValue, { color: '#2563EB' }]}>{summary.today}</Text>
          <Text style={styles.tileLabel}>показов сегодня</Text>
        </View>
      </View>

      {/* Activity */}
      <Section icon="📅" title={`Активность за ${ACTIVITY_DAYS} дней`}>
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
      <Section icon="🌍" title="Знание по языкам">
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
      <Section icon="🔁" title="По количеству повторений">
        {repetition.buckets.map(b => (
          <BarRow key={b.label} label={b.label} value={b.count} max={repetitionMax} color={b.color} />
        ))}
        <Text style={styles.sectionNote}>Ещё {repetition.new} слов ни разу не показывались.</Text>
      </Section>

      {/* Efficiency */}
      <Section icon="🎯" title="Эффективность тренировок" defaultOpen={efficiency.length > 0}>
        {efficiency.length === 0 ? (
          <Text style={styles.emptyText}>Пройдите тренировку в разделе «Тренировка», чтобы увидеть график.</Text>
        ) : (
          <>
            <View style={styles.modeToggle}>
              <TouchableOpacity
                style={[styles.modeBtn, efficiencyMode === 'percentage' && styles.modeBtnActive]}
                onPress={() => setEfficiencyMode('percentage')}
              >
                <Text style={[styles.modeBtnText, efficiencyMode === 'percentage' && styles.modeBtnTextActive]}>Доля верных</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modeBtn, efficiencyMode === 'absolute' && styles.modeBtnActive]}
                onPress={() => setEfficiencyMode('absolute')}
              >
                <Text style={[styles.modeBtnText, efficiencyMode === 'absolute' && styles.modeBtnTextActive]}>Верных ответов</Text>
              </TouchableOpacity>
            </View>
            {efficiency.map((e, i) => (
              <BarRow
                key={i}
                label={e.shortDate}
                value={efficiencyMode === 'percentage' ? e.percentage : e.absolute}
                max={efficiencyMode === 'percentage' ? 100 : efficiencyAbsMax}
                color="#3B82F6"
                valueText={efficiencyMode === 'percentage' ? `${Math.round(e.percentage)}%` : `${e.absolute}/${e.total}`}
              />
            ))}
          </>
        )}
      </Section>

      {/* iMW */}
      <Section icon="🧠" title="Индекс закрепления (iMW)" defaultOpen={false}>
        <Text style={styles.sectionNote}>
          Средний «вес памяти» по начатым словам: прогресс к 80 повторениям × статус «выучено» × забывание со временем.
        </Text>

        {imwTrend.length >= 2 && (
          <>
            <Text style={[styles.sectionNote, { marginTop: 14, color: '#475569', fontWeight: '600' }]}>
              Динамика ({imwTrend.length} дн.)
            </Text>
            <View style={[styles.activityChart, { height: 110 }]}>
              {imwTrend.map((p, i) => (
                <View key={i} style={styles.activityCol}>
                  <Text style={styles.activityValue}>{i === imwTrend.length - 1 ? `${p.imw.toFixed(0)}` : ''}</Text>
                  <View style={styles.activityTrack}>
                    <View style={[styles.activityFill, { height: `${Math.max(4, (p.imw / imwTrendMax) * 100)}%`, backgroundColor: '#38BDF8' }]} />
                  </View>
                  <Text style={styles.activityDay}>{p.date.slice(8)}</Text>
                </View>
              ))}
            </View>
            <View style={styles.divider} />
          </>
        )}

        {imw.langs.map(lang => (
          <BarRow
            key={lang.code}
            label={`${lang.flag} ${lang.label}`}
            value={lang.pct}
            max={100}
            color="#38BDF8"
            valueText={`${lang.pct.toFixed(0)}%`}
          />
        ))}
        <View style={styles.divider} />
        <BarRow label="Итого" value={imw.overall} max={100} color="#2563EB" valueText={`${imw.overall.toFixed(0)}%`} />
      </Section>

      {/* Frequent words */}
      <Section icon="🔥" title="Частые слова" defaultOpen={false}>
        {frequentWords.length === 0 ? (
          <Text style={styles.emptyText}>Слова появятся здесь после тренировок.</Text>
        ) : (
          frequentWords.map((word, i) => (
            <View key={word.eng || word.word || i} style={styles.wordCard}>
              <View style={styles.wordCardHeader}>
                <Text style={styles.wordRu} numberOfLines={1}>{word.ru || word.eng || word.word}</Text>
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
  activityFill: { width: '100%', backgroundColor: '#3B82F6', borderRadius: 4 },
  activityDay: { fontSize: 9, color: '#94A3B8', marginTop: 5 },

  modeToggle: { flexDirection: 'row', backgroundColor: '#F1F5F9', borderRadius: 10, padding: 3, marginBottom: 14, alignSelf: 'flex-start' },
  modeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 7 },
  modeBtnActive: { backgroundColor: '#FFF', elevation: 1 },
  modeBtnText: { fontSize: 12, color: '#64748B', fontWeight: '600' },
  modeBtnTextActive: { color: '#0F172A' },

  divider: { height: 1, backgroundColor: '#F1F5F9', marginVertical: 12 },

  wordCard: { backgroundColor: '#F8FAFC', borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#F1F5F9' },
  wordCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  wordRu: { fontSize: 15, fontWeight: 'bold', color: '#1E293B', flex: 1 },
  wordCount: { fontSize: 12, fontWeight: '700', color: '#C2410C', marginLeft: 8 },
  wordTransRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  wordTrans: { fontSize: 13 },
  wordTransText: { color: '#475569', fontWeight: '500' }
});
