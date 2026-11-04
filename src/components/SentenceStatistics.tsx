import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import { useStore } from '../store/useStore';
import { summarizeSentenceAnalyses, formatTimes } from '../utils/sentenceStatistics';
import { ACCENT, ACCENT_DARK, UI } from '../constants/theme';
import { LANGUAGES } from '../constants/languages';

type FrequencyRow = ReturnType<typeof summarizeSentenceAnalyses>['forms'][number];

function Frequencies({ rows }: { rows: FrequencyRow[] }) {
  const max = rows[0]?.count || 1;
  return (
    <View style={styles.frequencyList}>
      {rows.map((row, idx) => {
        const pct = Math.max(4, Math.round((row.count / max) * 100));
        return (
          <View key={`${row.title}-${idx}`} style={[styles.frequencyItem, idx > 0 && styles.frequencyDivider]}>
            <View style={styles.frequencyHeading}>
              <Text style={styles.frequencyLabel} numberOfLines={1}>{row.title}</Text>
              <View style={styles.countBadge}>
                <Text style={styles.countText}>{formatTimes(row.count)}</Text>
              </View>
            </View>

            <View style={styles.track}>
              <View style={[styles.fill, { width: `${pct}%` }]} />
            </View>

            <View style={styles.metaRow}>
              <Text style={styles.sentenceCount}>
                В разборах: <Text style={styles.sentenceCountNum}>{row.sentences}</Text>
              </Text>
              {row.examples.length > 0 && (
                <View style={styles.examplePills}>
                  {row.examples.map((ex, exIdx) => (
                    <View key={exIdx} style={styles.examplePill}>
                      <Text style={styles.examplePillText}>{ex}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const HELP_TEXT = 'Последние 500 завершённых разборов. Каждое слово считается по метке карточки; повторный полный разбор учитывается снова. Это частота встреч, а не оценка знаний. Сбор начинается с этого обновления.';

export default function SentenceStatistics({ now, defaultOpen = true }: { now: number; defaultOpen?: boolean }) {
  const analyses = useStore(state => state.sentenceAnalyses);
  const [open, setOpen] = useState(defaultOpen);
  const [selectedLanguage, setLanguage] = useState<string | undefined>();
  const [activeTab, setActiveTab] = useState<'forms' | 'categories' | 'all'>('forms');
  const [showAllForms, setShowAllForms] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const languages = useMemo(() => [...new Set(analyses.map(item => item.language))], [analyses]);
  const language = selectedLanguage && languages.includes(selectedLanguage) ? selectedLanguage : undefined;
  const summary = useMemo(() => summarizeSentenceAnalyses(analyses, language, now), [analyses, language, now]);

  const visibleForms = useMemo(() => {
    if (showAllForms || summary.forms.length <= 5) return summary.forms;
    return summary.forms.slice(0, 5);
  }, [summary.forms, showAllForms]);

  return (
    <View testID="sentence-statistics" style={styles.card}>
      <View style={[styles.cardHeader, !open && { marginBottom: 0 }]}>
        <TouchableOpacity
          style={styles.cardTitleTouchable}
          activeOpacity={0.7}
          onPress={() => setOpen(o => !o)}
          accessibilityRole="button"
          accessibilityLabel={`Разбор предложений, ${open ? 'свернуть' : 'развернуть'}`}
        >
          <Text style={styles.cardTitle}>Разбор предложений</Text>
        </TouchableOpacity>
        <View style={styles.headerRight}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Как считается: Разбор предложений"
            onPress={() => setShowHelp(true)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={styles.helpBtn}
          >
            <Text style={styles.helpBtnText}>?</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setOpen(o => !o)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel={open ? 'Свернуть' : 'Развернуть'}
          >
            <Text style={styles.cardChevron}>{open ? '▾' : '▸'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {open && (!analyses.length ? (
        <Text style={styles.emptyText}>
          Полностью раскройте предложение в разделе «Разбор». Здесь появятся частые грамматические формы и примеры из ваших разборов.
        </Text>
      ) : (
        <>
          {languages.length > 1 && (
            <View style={styles.languageRow}>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => setLanguage(undefined)}
                style={[styles.langChip, !language && styles.langChipActive]}
              >
                <Text style={[styles.langChipText, !language && styles.langChipTextActive]}>
                  Все языки
                </Text>
              </TouchableOpacity>
              {languages.map(code => {
                const langObj = LANGUAGES.find(l => l.code === code || l.label === code);
                const display = langObj ? `${langObj.flag} ${langObj.label}` : code;
                const isSelected = language === code;
                return (
                  <TouchableOpacity
                    key={code}
                    accessibilityRole="button"
                    onPress={() => setLanguage(code)}
                    style={[styles.langChip, isSelected && styles.langChipActive]}
                  >
                    <Text style={[styles.langChipText, isSelected && styles.langChipTextActive]}>
                      {display}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          <View testID="sentence-statistics-summary" style={styles.summaryContainer}>
            <View style={styles.summaryTile}>
              <Text style={styles.summaryValue}>{summary.total}</Text>
              <Text style={styles.summaryLabel}>Разборов: {summary.total}</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryTile}>
              <Text style={[styles.summaryValue, { color: ACCENT_DARK }]}>{summary.today}</Text>
              <Text style={styles.summaryLabel}>Сегодня: {summary.today}</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryTile}>
              <Text style={styles.summaryValue}>{summary.unique}</Text>
              <Text style={styles.summaryLabel}>Разных предложений: {summary.unique}</Text>
            </View>
          </View>

          {/* Segmented control tabs */}
          <View style={styles.tabBar}>
            <TouchableOpacity
              style={[styles.tabItem, activeTab === 'forms' && styles.tabItemActive]}
              onPress={() => setActiveTab('forms')}
              accessibilityRole="button"
            >
              <Text style={[styles.tabItemText, activeTab === 'forms' && styles.tabItemTextActive]}>
                Формы ({summary.forms.length})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tabItem, activeTab === 'categories' && styles.tabItemActive]}
              onPress={() => setActiveTab('categories')}
              accessibilityRole="button"
            >
              <Text style={[styles.tabItemText, activeTab === 'categories' && styles.tabItemTextActive]}>
                Части речи ({summary.categories.length})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tabItem, activeTab === 'all' && styles.tabItemActive]}
              onPress={() => setActiveTab('all')}
              accessibilityRole="button"
            >
              <Text style={[styles.tabItemText, activeTab === 'all' && styles.tabItemTextActive]}>
                Все
              </Text>
            </TouchableOpacity>
          </View>

          {/* Forms Section */}
          {(activeTab === 'forms' || activeTab === 'all') && (
            <View style={styles.sectionBlock}>
              <Text style={styles.subtitle}>Грамматические формы · сначала частые</Text>
              {summary.forms.length ? (
                <>
                  <Frequencies rows={visibleForms} />
                  {summary.forms.length > 5 && (
                    <TouchableOpacity
                      style={styles.moreButton}
                      onPress={() => setShowAllForms(v => !v)}
                      accessibilityRole="button"
                    >
                      <Text style={styles.moreButtonText}>
                        {showAllForms ? 'Свернуть формы' : `Показать все формы (${summary.forms.length})`}
                      </Text>
                    </TouchableOpacity>
                  )}
                </>
              ) : (
                <Text style={styles.emptySubtext}>
                  В этих предложениях нет уточнённых меток времени, падежа или других форм.
                </Text>
              )}
            </View>
          )}

          {/* Categories Section */}
          {(activeTab === 'categories' || activeTab === 'all') && (
            <View style={styles.sectionBlock}>
              <Text style={styles.subtitle}>Части речи и синтаксические роли</Text>
              {summary.categories.length ? (
                <Frequencies rows={summary.categories} />
              ) : (
                <Text style={styles.emptySubtext}>
                  Нет данных по частям речи.
                </Text>
              )}
            </View>
          )}

          <TouchableOpacity style={styles.footnoteRow} activeOpacity={0.7} onPress={() => setShowHelp(true)}>
            <Text style={styles.footnote}>
              Последние 500 завершённых разборов · частота встреч, а не оценка знаний
            </Text>
          </TouchableOpacity>
        </>
      ))}

      {/* Help Modal */}
      <Modal visible={showHelp} transparent animationType="fade" onRequestClose={() => setShowHelp(false)}>
        <TouchableOpacity style={styles.helpOverlay} activeOpacity={1} onPress={() => setShowHelp(false)}>
          <View style={styles.helpCard}>
            <Text style={styles.helpTitle}>Разбор предложений</Text>
            <Text style={styles.helpBody}>{HELP_TEXT}</Text>
            <TouchableOpacity style={styles.helpClose} onPress={() => setShowHelp(false)}>
              <Text style={styles.helpCloseText}>Понятно</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#ECEFF1',
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardTitleTouchable: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1A202C',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardChevron: {
    fontSize: 16,
    color: UI.muted,
    marginLeft: 4,
  },
  moreButton: {
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: 8,
  },
  moreButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  helpBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#EEF2F7',
    borderWidth: 1,
    borderColor: '#D9E1EC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  helpBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#64748B',
    lineHeight: 15,
  },
  emptyText: {
    ...UI.reading,
    color: '#64748B',
    lineHeight: 22,
    paddingVertical: 8,
  },
  emptySubtext: {
    fontSize: 13,
    color: '#94A3B8',
    fontStyle: 'italic',
    paddingVertical: 8,
  },

  languageRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  langChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  langChipActive: {
    backgroundColor: '#FFF7ED',
    borderColor: ACCENT,
  },
  langChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  langChipTextActive: {
    color: ACCENT_DARK,
    fontWeight: '700',
  },

  summaryContainer: {
    flexDirection: 'row',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ECEFF1',
    paddingVertical: 10,
    paddingHorizontal: 8,
    marginBottom: 14,
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  summaryTile: {
    flex: 1,
    alignItems: 'center',
  },
  summaryValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1A202C',
  },
  summaryLabel: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
    textAlign: 'center',
  },
  summaryDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#E2E8F0',
  },

  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    padding: 3,
    marginBottom: 14,
    gap: 4,
  },
  tabItem: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    borderRadius: 8,
  },
  tabItemActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  tabItemText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  tabItemTextActive: {
    color: '#1E293B',
    fontWeight: '700',
  },

  sectionBlock: {
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 8,
    marginTop: 4,
  },

  frequencyList: {
    gap: 10,
  },
  frequencyItem: {
    paddingVertical: 4,
  },
  frequencyDivider: {
    borderTopWidth: 1,
    borderTopColor: '#F8FAFC',
    paddingTop: 10,
  },
  frequencyHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  frequencyLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1E293B',
    flex: 1,
    marginRight: 8,
  },
  countBadge: {
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FED7AA',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  countText: {
    fontSize: 12,
    fontWeight: '700',
    color: ACCENT_DARK,
  },

  track: {
    height: 8,
    backgroundColor: '#F1F5F9',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 6,
  },
  fill: {
    height: '100%',
    backgroundColor: ACCENT,
    borderRadius: 4,
  },

  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  sentenceCount: {
    fontSize: 12,
    color: '#64748B',
    marginRight: 4,
  },
  sentenceCountNum: {
    fontWeight: '700',
    color: '#334155',
  },
  examplePills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  examplePill: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  examplePillText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#334155',
  },

  footnoteRow: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  footnote: {
    fontSize: 12,
    color: '#94A3B8',
    lineHeight: 16,
    textAlign: 'center',
  },

  helpOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  helpCard: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 20,
    maxWidth: 420,
    width: '100%',
  },
  helpTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1A202C',
    marginBottom: 10,
  },
  helpBody: {
    ...UI.reading,
    color: UI.body,
    fontSize: 14,
    lineHeight: 20,
  },
  helpClose: {
    marginTop: 18,
    alignSelf: 'flex-end',
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: ACCENT,
  },
  helpCloseText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 14,
  },
});
