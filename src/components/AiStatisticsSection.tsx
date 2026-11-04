import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Modal } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { ACCENT, ACCENT_DARK, UI } from '../constants/theme';
import { analyzeStatisticsWithAi, type StatisticsReportPayload } from '../services/statisticsAiService';

const HELP_TEXT =
  'ИИ анализирует охват словаря, прочность запоминания (индекс iMW), активность за 14 дней, а также частые формы и синтаксические роли в разборах предложений. На основе этих данных формируются индивидуальные рекомендации по тренировкам и грамматике.';

export default function AiStatisticsSection({ payload }: { payload: StatisticsReportPayload }) {
  const [report, setReport] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const mounted = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abortControllerRef.current?.abort();
    };
  }, []);

  const handleGenerate = async () => {
    if (loading) return;
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const result = await analyzeStatisticsWithAi(payload, controller.signal);
      if (mounted.current) {
        setReport(result);
      }
    } catch (err) {
      if (mounted.current && !(err instanceof Error && err.name === 'AbortError')) {
        setError(err instanceof Error ? err.message : 'Не удалось получить анализ.');
      }
    } finally {
      if (mounted.current) {
        setLoading(false);
      }
    }
  };

  return (
    <View testID="ai-statistics-section" style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.titleRow}>
          <Text style={styles.titleIcon}>✨</Text>
          <Text style={styles.cardTitle}>ИИ-анализ и рекомендации</Text>
        </View>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Как считается: ИИ-анализ и рекомендации"
          onPress={() => setShowHelp(true)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={styles.helpBtn}
        >
          <Text style={styles.helpBtnText}>?</Text>
        </TouchableOpacity>
      </View>

      {/* Initial state: button to generate */}
      {!report && !loading && (
        <View style={styles.introBox}>
          <Text style={styles.introText}>
            Персональный разбор вашего прогресса: оценка интервальной памяти, частых грамматических форм, слабых мест в разборе и план на ближайшие дни.
          </Text>
          <TouchableOpacity
            testID="ai-statistics-generate-btn"
            style={styles.primaryButton}
            onPress={handleGenerate}
            activeOpacity={0.8}
            accessibilityRole="button"
          >
            <Text style={styles.primaryButtonText}>Сформировать ИИ-анализ</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Loading state */}
      {loading && (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="small" color={ACCENT_DARK} />
          <Text style={styles.loadingText}>ИИ анализирует прогресс и подбирает рекомендации...</Text>
        </View>
      )}

      {/* Error state */}
      {error && !loading && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={handleGenerate} accessibilityRole="button">
            <Text style={styles.retryButtonText}>Повторить</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Result report */}
      {report && !loading && (
        <View style={styles.reportContainer}>
          <Markdown style={markdownStyles}>
            {report}
          </Markdown>

          <View style={styles.reportFooter}>
            <Text style={styles.footerNote}>Сформировано на основе вашей статистики</Text>
            <TouchableOpacity
              testID="ai-statistics-refresh-btn"
              style={styles.refreshButton}
              onPress={handleGenerate}
              activeOpacity={0.7}
              accessibilityRole="button"
            >
              <Text style={styles.refreshButtonText}>🔄 Обновить</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Help Modal */}
      <Modal visible={showHelp} transparent animationType="fade" onRequestClose={() => setShowHelp(false)}>
        <TouchableOpacity style={styles.helpOverlay} activeOpacity={1} onPress={() => setShowHelp(false)}>
          <View style={styles.helpCard}>
            <Text style={styles.helpTitle}>ИИ-анализ и рекомендации</Text>
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
    borderColor: '#FED7AA',
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  titleIcon: {
    fontSize: 18,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1A202C',
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

  introBox: {
    backgroundColor: '#FFFBF5',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#FFEDD5',
    gap: 12,
  },
  introText: {
    fontSize: 13,
    color: '#475569',
    lineHeight: 19,
  },
  primaryButton: {
    backgroundColor: ACCENT,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },

  loadingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 18,
    paddingHorizontal: 8,
  },
  loadingText: {
    fontSize: 13,
    color: '#64748B',
    flex: 1,
  },

  errorBox: {
    backgroundColor: '#FEF2F2',
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  errorText: {
    fontSize: 13,
    color: '#B91C1C',
  },
  retryButton: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: '#FEE2E2',
  },
  retryButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#B91C1C',
  },

  reportContainer: {
    gap: 8,
  },
  reportFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 12,
    marginTop: 8,
  },
  footerNote: {
    fontSize: 11,
    color: '#94A3B8',
    flex: 1,
  },
  refreshButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
  },
  refreshButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
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

const markdownStyles = StyleSheet.create({
  body: {
    fontSize: 13,
    lineHeight: 20,
    color: '#334155',
  },
  heading3: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E293B',
    marginTop: 10,
    marginBottom: 4,
  },
  bullet_list: {
    marginVertical: 4,
  },
  list_item: {
    marginVertical: 2,
    flexDirection: 'row',
  },
  strong: {
    fontWeight: '700',
    color: '#0F172A',
  },
  paragraph: {
    marginTop: 4,
    marginBottom: 6,
  },
});
