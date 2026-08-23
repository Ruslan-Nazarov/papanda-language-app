import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Dimensions, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../store/useStore';
import { LANGUAGES, getLanguageLabel } from '../constants/languages';
import { Word } from '../models/types';

type ChartTab = 'distribution' | 'byLanguage' | 'efficiency' | 'shownDay';

const SCREEN_WIDTH = Dimensions.get('window').width;

export default function StatisticsScreen() {
  const insets = useSafeAreaInsets();
  const topPadding = Math.max(insets.top, Platform.OS === 'android' ? 24 : 16);
  const { words, activeLanguages, activeLanguage } = useStore();
  const [activeTab, setActiveTab] = useState<ChartTab>('distribution');
  const [efficiencyMode, setEfficiencyMode] = useState<'absolute' | 'percentage'>('absolute');

  const totalWords = words.length;

  // 1. Distribution by knowledge level
  const distributionData = useMemo(() => {
    const counts = {
      new: 0,         // 0 shows
      beginner: 0,    // 1-5 shows
      intermediate: 0,// 6-15 shows
      advanced: 0,    // 16-40 shows
      expert: 0,      // 41-80 shows
      master: 0       // 80+ shows
    };

    words.forEach(w => {
      const c = w.count || 0;
      if (c === 0) counts.new++;
      else if (c <= 5) counts.beginner++;
      else if (c <= 15) counts.intermediate++;
      else if (c <= 40) counts.advanced++;
      else if (c <= 80) counts.expert++;
      else counts.master++;
    });

    return [
      { label: 'New (0)', count: counts.new, color: '#E5E7EB' },
      { label: 'Beginner (1-5)', count: counts.beginner, color: '#FDE68A' },
      { label: 'Intermediate (6-15)', count: counts.intermediate, color: '#FED7AA' },
      { label: 'Advanced (16-40)', count: counts.advanced, color: '#FDBA74' },
      { label: 'Expert (41-80)', count: counts.expert, color: '#FB923C' },
      { label: 'Master (80+)', count: counts.master, color: '#4ADE80' }
    ];
  }, [words]);

  // 2. Knowledge by Language
  const languageStats = useMemo(() => {
    return LANGUAGES.map(lang => {
      let knownCount = 0;
      let showCount = 0;

      words.forEach(w => {
        const knowStats = (w.knowledge_stats || {}) as Record<string, boolean>;
        if (knowStats[lang.code] === true) knownCount++;

        const showStats = (w.show_stats || {}) as Record<string, number>;
        if (showStats[lang.code]) showCount += showStats[lang.code];
      });

      // Colors matching screenshot
      let color = '#3B82F6';
      if (lang.code === 'it') color = '#10B981';
      else if (lang.code === 'de') color = '#EAB308';
      else if (lang.code === 'es') color = '#EC4899';
      else if (lang.code === 'kz') color = '#0EA5E9';
      else if (lang.code === 'en') color = '#6366F1';

      return {
        ...lang,
        knownCount,
        showCount,
        color
      };
    });
  }, [words]);

  // 3. iMW Index (Intelligent Memory Weight)
  const imwStats = useMemo(() => {
    // Calculate memory weight for active languages
    const langsIMW = activeLanguages.map(code => {
      const langObj = LANGUAGES.find(l => l.code === code);
      let learnedCount = 0;
      let practicedCount = 0;

      words.forEach(w => {
        const knowStats = (w.knowledge_stats || {}) as Record<string, boolean>;
        const showStats = (w.show_stats || {}) as Record<string, number>;
        if (knowStats[code]) learnedCount++;
        if (showStats[code] && showStats[code] > 0) practicedCount++;
      });

      // iMW formula: % of target memory retention
      const ratio = totalWords > 0 ? ((learnedCount + (practicedCount * 0.3)) / Math.max(1, totalWords)) * 100 : 0;
      const percentage = Math.min(100, Math.round(ratio * 10) / 10);

      return {
        code,
        label: langObj?.label || code.toUpperCase(),
        flag: langObj?.flag || '',
        percentage
      };
    });

    const overall = langsIMW.length > 0 
      ? Math.round((langsIMW.reduce((sum, item) => sum + item.percentage, 0) / langsIMW.length) * 10) / 10 
      : 0;

    return {
      langs: langsIMW,
      overall
    };
  }, [words, activeLanguages, totalWords]);

  // 4. Most Encountered Words
  const mostEncounteredWords = useMemo(() => {
    const sorted = [...words].sort((a, b) => (b.count || 0) - (a.count || 0));
    return sorted.slice(0, 15);
  }, [words]);

  // 5. Daily Shows Data (Mock / Last 30 days distribution)
  const dailyShows = useMemo(() => {
    const days: { date: string; shows: number }[] = [];
    const now = new Date();

    // Group actual last_shown dates or distribute
    const dateCounts: Record<string, number> = {};
    words.forEach(w => {
      if (w.last_shown) {
        try {
          const d = new Date(w.last_shown);
          const key = `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}`;
          dateCounts[key] = (dateCounts[key] || 0) + (w.count || 1);
        } catch (e) {}
      }
    });

    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const key = `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}`;
      days.push({
        date: key,
        shows: dateCounts[key] || 0
      });
    }

    return days;
  }, [words]);

  // Max value calculation for charts
  const maxDistributionCount = Math.max(...distributionData.map(d => d.count), 10);
  const maxShowsPerDay = Math.max(...dailyShows.map(d => d.shows), 10);

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.scroll, { paddingTop: topPadding }]}>
      {/* Title */}
      <Text style={styles.screenTitle}>Статистика обучения</Text>

      {/* CARD 1: Progress Charts */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardHeaderIcon}>📈</Text>
            <Text style={styles.cardHeaderTitle}>Progress Charts</Text>
          </View>
          <Text style={styles.cardToolsIcon}>🎨</Text>
        </View>

        {/* Tab Pills */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScroll} contentContainerStyle={styles.tabScrollContent}>
          <TouchableOpacity 
            style={[styles.tabBtn, activeTab === 'distribution' && styles.tabBtnActive]} 
            onPress={() => setActiveTab('distribution')}
          >
            <Text style={[styles.tabBtnText, activeTab === 'distribution' && styles.tabBtnTextActive]}>Distribution</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.tabBtn, activeTab === 'byLanguage' && styles.tabBtnActive]} 
            onPress={() => setActiveTab('byLanguage')}
          >
            <Text style={[styles.tabBtnText, activeTab === 'byLanguage' && styles.tabBtnTextActive]}>By Language</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.tabBtn, activeTab === 'efficiency' && styles.tabBtnActive]} 
            onPress={() => setActiveTab('efficiency')}
          >
            <Text style={[styles.tabBtnText, activeTab === 'efficiency' && styles.tabBtnTextActive]}>Efficiency</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.tabBtn, activeTab === 'shownDay' && styles.tabBtnActive]} 
            onPress={() => setActiveTab('shownDay')}
          >
            <Text style={[styles.tabBtnText, activeTab === 'shownDay' && styles.tabBtnTextActive]}>Shown/Day</Text>
          </TouchableOpacity>
        </ScrollView>

        {/* TAB CONTENT: Distribution */}
        {activeTab === 'distribution' && (
          <View style={styles.chartContainer}>
            <View style={styles.verticalBarsContainer}>
              {distributionData.map((item, idx) => {
                const heightPercent = maxDistributionCount > 0 ? (item.count / maxDistributionCount) * 100 : 0;
                return (
                  <View key={idx} style={styles.vBarColumn}>
                    <Text style={styles.vBarValue}>{item.count > 0 ? item.count : ''}</Text>
                    <View style={styles.vBarTrack}>
                      <View style={[styles.vBarFill, { height: `${Math.max(4, heightPercent)}%`, backgroundColor: item.color }]} />
                    </View>
                    <Text style={styles.vBarLabel} numberOfLines={2}>{item.label}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* TAB CONTENT: By Language */}
        {activeTab === 'byLanguage' && (
          <View style={styles.chartContainer}>
            <Text style={styles.subChartTitle}>Knowledge by Language</Text>
            {languageStats.map(lang => {
              const fillPercent = totalWords > 0 ? (lang.knownCount / totalWords) * 100 : 0;
              return (
                <View key={lang.code} style={styles.hBarRow}>
                  <Text style={styles.hBarLabel}>{lang.flag} {lang.label}</Text>
                  <View style={styles.hBarTrack}>
                    <View style={[styles.hBarFill, { width: `${Math.max(2, fillPercent)}%`, backgroundColor: lang.color }]} />
                  </View>
                  <Text style={styles.hBarValue}>{lang.knownCount}</Text>
                </View>
              );
            })}
            <View style={styles.axisRow}>
              <Text style={styles.axisLabel}>0</Text>
              <Text style={styles.axisLabel}>{Math.round(totalWords / 2)}</Text>
              <Text style={styles.axisLabel}>{totalWords}</Text>
            </View>
          </View>
        )}

        {/* TAB CONTENT: Efficiency */}
        {activeTab === 'efficiency' && (
          <View style={styles.chartContainer}>
            <View style={styles.efficiencyHeader}>
              <Text style={styles.subChartTitle}>Familiar Words Efficiency</Text>
              <View style={styles.modeToggle}>
                <TouchableOpacity 
                  style={[styles.modeBtn, efficiencyMode === 'absolute' && styles.modeBtnActive]}
                  onPress={() => setEfficiencyMode('absolute')}
                >
                  <Text style={[styles.modeBtnText, efficiencyMode === 'absolute' && styles.modeBtnTextActive]}>Absolute</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.modeBtn, efficiencyMode === 'percentage' && styles.modeBtnActive]}
                  onPress={() => setEfficiencyMode('percentage')}
                >
                  <Text style={[styles.modeBtnText, efficiencyMode === 'percentage' && styles.modeBtnTextActive]}>Percentage (%)</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.efficiencyContent}>
              {languageStats.map(lang => {
                const effPercent = lang.showCount > 0 ? Math.round((lang.knownCount / lang.showCount) * 100) : 0;
                const valueText = efficiencyMode === 'absolute' ? `${lang.knownCount} из ${lang.showCount}` : `${effPercent}%`;
                
                return (
                  <View key={lang.code} style={styles.effRow}>
                    <Text style={styles.effLabel}>{lang.flag} {lang.label}</Text>
                    <View style={styles.effTrack}>
                      <View style={[styles.effFill, { width: `${Math.min(100, effPercent)}%`, backgroundColor: lang.color }]} />
                    </View>
                    <Text style={styles.effVal}>{valueText}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* TAB CONTENT: Shown/Day */}
        {activeTab === 'shownDay' && (
          <View style={styles.chartContainer}>
            <Text style={styles.subChartTitle}>Words Shown Per Day (Last 30 days)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.dailyBarsContainer}>
                {dailyShows.map((d, i) => {
                  const hPercent = maxShowsPerDay > 0 ? (d.shows / maxShowsPerDay) * 100 : 0;
                  return (
                    <View key={i} style={styles.dailyBarCol}>
                      <Text style={styles.dailyBarVal}>{d.shows > 0 ? d.shows : ''}</Text>
                      <View style={styles.dailyBarTrack}>
                        <View style={[styles.dailyBarFill, { height: `${Math.max(d.shows > 0 ? 8 : 2, hPercent)}%` }]} />
                      </View>
                      <Text style={styles.dailyBarDate}>{d.date}</Text>
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        )}
      </View>

      {/* CARD 2: iMW Index */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardHeaderIcon}>🧠</Text>
            <Text style={styles.cardHeaderTitle}>iMW Index</Text>
          </View>
          <Text style={styles.cardToolsIcon}>▼</Text>
        </View>

        <Text style={styles.imwDescription}>
          Intelligent Memory Weight shows how close you are to the target repetition frequency.
        </Text>

        <View style={styles.imwLanguagesList}>
          {imwStats.langs.map(item => (
            <View key={item.code} style={styles.imwLangItem}>
              <View style={styles.imwLangHeader}>
                <Text style={styles.imwLangName}>{item.flag} {item.label}</Text>
                <Text style={styles.imwLangPercent}>{item.percentage.toFixed(1)}%</Text>
              </View>
              <View style={styles.imwProgressBarTrack}>
                <View style={[styles.imwProgressBarFill, { width: `${Math.max(2, item.percentage)}%` }]} />
              </View>
            </View>
          ))}
        </View>

        <View style={styles.divider} />

        <View style={styles.imwOverallRow}>
          <Text style={styles.imwOverallLabel}>Overall iMW Index</Text>
          <Text style={styles.imwOverallValue}>{imwStats.overall.toFixed(1)}%</Text>
        </View>
        <View style={styles.imwProgressBarTrack}>
          <View style={[styles.imwProgressBarFill, { width: `${Math.max(2, imwStats.overall)}%`, backgroundColor: '#007BFF' }]} />
        </View>
      </View>

      {/* CARD 3: Most Encountered Words */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardHeaderIcon}>🔥</Text>
            <Text style={styles.cardHeaderTitle}>Most Encountered Words</Text>
          </View>
          <Text style={styles.cardToolsIcon}>▼</Text>
        </View>

        <View style={styles.wordListContainer}>
          {mostEncounteredWords.map((word, index) => {
            return (
              <View key={word.eng || word.word || index} style={styles.wordCard}>
                <View style={styles.wordCardHeader}>
                  <Text style={styles.wordRussian}>{word.ru || word.eng || word.word}</Text>
                  <View style={styles.wordShowBadge}>
                    <Text style={styles.wordShowText}>{(word.count || 0)} пок.</Text>
                  </View>
                </View>

                {/* Sub row with flags and translations for current active triples languages */}
                <View style={styles.wordTranslationsRow}>
                  {activeLanguages.map(lang => {
                    const trans = (word[lang as keyof Word] || (word.translations && word.translations[lang])) as string;
                    const langFlag = LANGUAGES.find(l => l.code === lang)?.flag || '';
                    if (!trans) return null;

                    return (
                      <Text key={lang} style={styles.wordTransItem}>
                        {langFlag} <Text style={styles.wordTransText}>{trans}</Text>
                      </Text>
                    );
                  })}
                </View>
              </View>
            );
          })}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  scroll: {
    padding: 16,
    paddingBottom: 40,
  },
  screenTitle: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#1A202C',
    marginBottom: 16,
    marginTop: 4,
  },
  card: {
    backgroundColor: '#FFF',
    borderRadius: 20,
    padding: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#ECEFF1',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardHeaderIcon: {
    fontSize: 22,
  },
  cardHeaderTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1A202C',
  },
  cardToolsIcon: {
    fontSize: 16,
    color: '#A0AEC0',
  },
  tabScroll: {
    marginBottom: 16,
  },
  tabScrollContent: {
    gap: 8,
  },
  tabBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  tabBtnActive: {
    backgroundColor: '#007BFF',
    borderColor: '#007BFF',
  },
  tabBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  tabBtnTextActive: {
    color: '#FFF',
  },
  chartContainer: {
    paddingVertical: 10,
  },
  verticalBarsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 180,
    paddingTop: 20,
    paddingBottom: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  vBarColumn: {
    flex: 1,
    alignItems: 'center',
    height: '100%',
    justifyContent: 'flex-end',
  },
  vBarValue: {
    fontSize: 11,
    color: '#64748B',
    marginBottom: 4,
    fontWeight: '600',
  },
  vBarTrack: {
    width: 32,
    height: '70%',
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  vBarFill: {
    width: '100%',
    borderRadius: 8,
  },
  vBarLabel: {
    fontSize: 9,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 6,
    position: 'absolute',
    bottom: -22,
  },
  subChartTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#334155',
    marginBottom: 12,
  },
  hBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 10,
  },
  hBarLabel: {
    width: 90,
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  hBarTrack: {
    flex: 1,
    height: 18,
    backgroundColor: '#F1F5F9',
    borderRadius: 9,
    overflow: 'hidden',
  },
  hBarFill: {
    height: '100%',
    borderRadius: 9,
  },
  hBarValue: {
    width: 40,
    fontSize: 13,
    fontWeight: 'bold',
    color: '#334155',
    textAlign: 'right',
  },
  axisRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingLeft: 100,
    paddingRight: 40,
    marginTop: 6,
  },
  axisLabel: {
    fontSize: 11,
    color: '#94A3B8',
  },
  efficiencyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    padding: 2,
  },
  modeBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  modeBtnActive: {
    backgroundColor: '#FFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  modeBtnText: {
    fontSize: 11,
    color: '#64748B',
  },
  modeBtnTextActive: {
    color: '#0F172A',
    fontWeight: 'bold',
  },
  efficiencyContent: {
    gap: 12,
  },
  effRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  effLabel: {
    width: 90,
    fontSize: 13,
    color: '#475569',
    fontWeight: '600',
  },
  effTrack: {
    flex: 1,
    height: 12,
    backgroundColor: '#F1F5F9',
    borderRadius: 6,
    overflow: 'hidden',
  },
  effFill: {
    height: '100%',
    borderRadius: 6,
  },
  effVal: {
    width: 70,
    fontSize: 12,
    color: '#475569',
    textAlign: 'right',
    fontWeight: '600',
  },
  dailyBarsContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 160,
    gap: 8,
    paddingTop: 20,
    paddingBottom: 24,
  },
  dailyBarCol: {
    width: 28,
    alignItems: 'center',
    height: '100%',
    justifyContent: 'flex-end',
  },
  dailyBarVal: {
    fontSize: 10,
    color: '#EA580C',
    fontWeight: '600',
    marginBottom: 2,
  },
  dailyBarTrack: {
    width: 20,
    height: '70%',
    backgroundColor: '#FFF7ED',
    borderRadius: 6,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  dailyBarFill: {
    width: '100%',
    backgroundColor: '#F97316',
    borderRadius: 6,
  },
  dailyBarDate: {
    fontSize: 9,
    color: '#94A3B8',
    marginTop: 4,
    transform: [{ rotate: '-45deg' }],
  },
  imwDescription: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 18,
    marginBottom: 16,
  },
  imwLanguagesList: {
    gap: 14,
  },
  imwLangItem: {
    gap: 6,
  },
  imwLangHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  imwLangName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1E293B',
  },
  imwLangPercent: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#0F172A',
  },
  imwProgressBarTrack: {
    height: 6,
    backgroundColor: '#F1F5F9',
    borderRadius: 3,
    overflow: 'hidden',
  },
  imwProgressBarFill: {
    height: '100%',
    backgroundColor: '#38BDF8',
    borderRadius: 3,
  },
  divider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginVertical: 16,
  },
  imwOverallRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  imwOverallLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#0F172A',
  },
  imwOverallValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#0F172A',
  },
  wordListContainer: {
    gap: 10,
  },
  wordCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  wordCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  wordRussian: {
    fontSize: 17,
    fontWeight: 'bold',
    color: '#1E293B',
  },
  wordShowBadge: {
    backgroundColor: '#FFF7ED',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#FFEDD5',
  },
  wordShowText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#C2410C',
  },
  wordTranslationsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  wordTransItem: {
    fontSize: 14,
  },
  wordTransText: {
    color: '#475569',
    fontWeight: '500',
  },
});
