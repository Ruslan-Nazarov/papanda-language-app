import * as Application from 'expo-application';
import type { BackupPreview } from '../services/backupFormat';
import { getRestorePointDate, importWithRestorePoint, restoreBeforeImport } from '../services/progressRestore';
import { useShallow } from 'zustand/react/shallow';
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Platform, ActivityIndicator, Modal } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../store/useStore';
import { LANGUAGES, getLanguageLabel } from '../constants/languages';
import { exportProgressToFile, previewProgressFromFile } from '../services/backupService';
import { ACCENT, ACCENT_LIGHT } from '../constants/theme';
import appConfig from '../../app.json';

const WORKOUT_COUNT_OPTIONS = [5, 7, 10, 15, 20];
const WORD_TOUR_COUNT_OPTIONS = [5, 10, 15, 20, 30, 50];
const ONBOARDING_KEY = 'papanda-onboarded';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const topPadding = Math.max(insets.top, Platform.OS === 'android' ? 24 : 16);
  const { activeLanguages, setLanguages, resetStatistics, workoutWordCount, setWorkoutWordCount, workoutLearnedWordCount, setWorkoutLearnedWordCount, wordTourSize, setWordTourSize } = useStore(useShallow(state => ({
    activeLanguages: state.activeLanguages,
    setLanguages: state.setLanguages,
    resetStatistics: state.resetStatistics,
    workoutWordCount: state.workoutWordCount,
    setWorkoutWordCount: state.setWorkoutWordCount,
    workoutLearnedWordCount: state.workoutLearnedWordCount,
    setWorkoutLearnedWordCount: state.setWorkoutLearnedWordCount,
    wordTourSize: state.wordTourSize,
    setWordTourSize: state.setWordTourSize,
  })));
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [restoreDate, setRestoreDate] = useState<string | null>(null);
  const [showRestore, setShowRestore] = useState(false);
  const [backupMessage, setBackupMessage] = useState('');
  useEffect(() => { void getRestorePointDate().then(setRestoreDate).catch(() => setBackupMessage('Не удалось прочитать точку восстановления.')); }, []);

  const toggleLanguage = (code: string) => {
    let newLangs = [...activeLanguages];
    if (newLangs.includes(code)) {
      if (newLangs.length <= 1) {
        Alert.alert("Ошибка", "Должен быть выбран хотя бы один язык.");
        return;
      }
      newLangs = newLangs.filter(l => l !== code);
    } else {
      newLangs.push(code);
    }
    setLanguages(newLangs);
  };

  const moveLanguage = (index: number, direction: number) => {
    const newLangs = [...activeLanguages];
    const targetIndex = index + direction;
    if (targetIndex >= 0 && targetIndex < newLangs.length) {
      const temp = newLangs[index];
      newLangs[index] = newLangs[targetIndex];
      newLangs[targetIndex] = temp;
      setLanguages(newLangs);
    }
  };

  const handleExport = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const result = await exportProgressToFile();
      if (!result.ok && result.error) {
        Alert.alert('Не удалось сохранить', result.error);
      }
    } finally {
      setIsExporting(false);
    }
  };

  const handleImport = async () => {
    if (isImporting) return;
    setIsImporting(true); setBackupMessage('');
    try { setPreview(await previewProgressFromFile()); }
    catch (error) { setBackupMessage(error instanceof Error ? error.message : 'Не удалось прочитать копию.'); }
    finally { setIsImporting(false); }
  };
  const commitImport = async (restore = false) => {
    if (isImporting || (!restore && !preview)) return;
    setIsImporting(true);
    try {
      if (restore) await restoreBeforeImport(); else await importWithRestorePoint(preview!.data);
      setPreview(null); setShowRestore(false);
      setRestoreDate(await getRestorePointDate());
      setBackupMessage(restore ? 'Состояние до импорта восстановлено.' : 'Прогресс импортирован. Предыдущее состояние сохранено на устройстве.');
    } catch (error) { setBackupMessage(error instanceof Error ? error.message : 'Не удалось восстановить прогресс.'); }
    finally { setIsImporting(false); }
  };

  const handleReplayOnboarding = () => {
    AsyncStorage.removeItem(ONBOARDING_KEY)
      .then(() => Alert.alert('Готово', 'Вводный экран покажется при следующем запуске приложения.'))
      .catch(() => Alert.alert('Не получилось', 'Попробуйте ещё раз.'));
  };

  const handleReset = () => {
    Alert.alert(
      "Сброс статистики",
      "Вы уверены, что хотите обнулить весь прогресс, показы и статус выученных слов?",
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Сбросить всё",
          style: "destructive",
          onPress: () => {
            resetStatistics();
            Alert.alert("Готово", "Статистика успешно сброшена.");
          }
        }
      ]
    );
  };

  return (
    <View style={[styles.container, { paddingTop: topPadding }]}>
      <Text style={styles.header}>Настройки</Text>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.sectionSub}>papanda {Application.nativeApplicationVersion ?? appConfig.expo.version} · {Application.nativeBuildVersion ? 'сборка ' + Application.nativeBuildVersion : 'web'}</Text>
        {/* Active Languages for Triples */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Изучаемые языки</Text>
          <Text style={styles.sectionSub}>Выберите языки, которые будут использоваться во всех заданиях (слова, тесты, предложения).</Text>
          {LANGUAGES.map(lang => {
            const isActive = activeLanguages.includes(lang.code);
            return (
              <TouchableOpacity
                key={`triple-${lang.code}`}
                style={[styles.row, isActive && styles.rowActive]}
                onPress={() => toggleLanguage(lang.code)}
              >
                <Text style={styles.rowText}>{lang.flag} {lang.label}</Text>
                {isActive && <Text style={styles.check}>✓</Text>}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Selected Triples Order */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Порядок языков для заданий</Text>
          <Text style={styles.sectionSub}>Влияет на порядок отображения во множественных заданиях</Text>
          {activeLanguages.map((code, index) => {
            return (
              <View key={`order-${code}`} style={styles.row}>
                <Text style={styles.rowText}>{index + 1}. {getLanguageLabel(code)}</Text>
                <View style={styles.orderControls}>
                  <TouchableOpacity
                    style={styles.orderBtn}
                    onPress={() => moveLanguage(index, -1)}
                    disabled={index === 0}
                  >
                    <Text style={[styles.orderBtnText, index === 0 && styles.disabledText]}>⬆️</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.orderBtn}
                    onPress={() => moveLanguage(index, 1)}
                    disabled={index === activeLanguages.length - 1}
                  >
                    <Text style={[styles.orderBtnText, index === activeLanguages.length - 1 && styles.disabledText]}>⬇️</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Карточки слов</Text>
          <Text style={styles.sectionSub}>Количество карточек за тур. По умолчанию — 10. Изменение начнёт новый тур.</Text>
          <View style={styles.optionsRow}>
            {WORD_TOUR_COUNT_OPTIONS.map(count => (
              <TouchableOpacity
                key={`word-tour-${count}`}
                accessibilityRole="button"
                accessibilityLabel={`Карточек за тур: ${count}`}
                accessibilityState={{ selected: wordTourSize === count }}
                aria-selected={wordTourSize === count}
                style={[styles.optionChip, wordTourSize === count && styles.optionChipActive]}
                onPress={() => setWordTourSize(count)}
              >
                <Text style={[styles.optionChipText, wordTourSize === count && styles.optionChipTextActive]}>{count}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Brain Workout Options */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Настройки тренировки (Brain Workout)</Text>

          <Text style={styles.sectionSub}>Количество слов за одну сессию</Text>
          <View style={[styles.optionsRow, {marginBottom: 20}]}>
            {WORKOUT_COUNT_OPTIONS.map(count => (
              <TouchableOpacity
                key={`count-${count}`}
                style={[styles.optionChip, workoutWordCount === count && styles.optionChipActive]}
                onPress={() => setWorkoutWordCount(count)}
              >
                <Text style={[styles.optionChipText, workoutWordCount === count && styles.optionChipTextActive]}>
                  {count}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.sectionSub}>Сколько из них — уже выученные слова (для повторения)</Text>
          <View style={styles.optionsRow}>
            {[0, 1, 2, 3, 5].map(count => (
              <TouchableOpacity
                key={`learned-${count}`}
                style={[styles.optionChip, workoutLearnedWordCount === count && styles.optionChipActive]}
                onPress={() => setWorkoutLearnedWordCount(count)}
              >
                <Text style={[styles.optionChipText, workoutLearnedWordCount === count && styles.optionChipTextActive]}>
                  {count}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Backup Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Резервная копия</Text>
          <Text style={styles.sectionSub}>
            Прогресс хранится только на этом телефоне и стирается при удалении приложения.
            Сохраните копию перед переустановкой.
          </Text>
          <TouchableOpacity style={styles.row} onPress={handleExport} disabled={isExporting}>
            <Text style={styles.rowText}>📤 Экспортировать прогресс</Text>
            {isExporting && <ActivityIndicator size="small" color={ACCENT} />}
          </TouchableOpacity>
          <TouchableOpacity style={styles.row} onPress={handleImport} disabled={isImporting}>
            <Text style={styles.rowText}>📥 Импортировать прогресс</Text>
            {isImporting && <ActivityIndicator size="small" color={ACCENT} />}
          </TouchableOpacity>
        </View>

        {restoreDate && <TouchableOpacity style={styles.row} onPress={() => setShowRestore(true)} disabled={isImporting}>
          <Text style={styles.rowText}>↩ Вернуть состояние до импорта</Text>
        </TouchableOpacity>}
        {backupMessage ? <Text accessibilityLiveRegion="polite" style={styles.sectionSub}>{backupMessage}</Text> : null}
        {/* About */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>О приложении</Text>
          <TouchableOpacity style={styles.row} onPress={handleReplayOnboarding}>
            <Text style={styles.rowText}>👋 Показать вводный экран снова</Text>
          </TouchableOpacity>
        </View>

        {/* Reset Data Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Сброс данных и прогресса</Text>
          <TouchableOpacity
            style={[styles.row, styles.resetRow]}
            onPress={handleReset}
          >
            <Text style={styles.resetText}>🗑️ Сбросить всю статистику и показы</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      <Modal visible={Boolean(preview) || showRestore} transparent animationType="fade" onRequestClose={() => { if (!isImporting) { setPreview(null); setShowRestore(false); } }}>
        <View style={{ flex: 1, backgroundColor: '#0008', justifyContent: 'center', padding: 24 }}>
          <View style={{ backgroundColor: '#FFF', padding: 24, borderRadius: 16 }}>
            <Text style={styles.sectionTitle}>{showRestore ? 'Восстановить прежний прогресс?' : 'Проверка резервной копии'}</Text>
            <Text style={styles.sectionSub}>{showRestore ? 'Текущие изменения будут заменены состоянием до последнего импорта.' :
              'Слов: ' + (preview?.customWords ?? 0) + ' · Предложений: ' + (preview?.sentences ?? 0) + '\nТекстов: ' + (preview?.readingTexts ?? 0) + ' · Ответов разбора: ' + (preview?.structureAttempts ?? 0) + '\nЗаписей прогресса: ' + (preview?.progressWords ?? 0) +
              '\nСовпадающих ключей: ' + (preview?.conflicts ?? 0) + '. Последняя пользовательская запись заменит совпадающую, без дублей.\nТекущий прогресс будет заменён. Сначала сохраним точку восстановления на этом устройстве.'}</Text>
            {backupMessage ? <Text>{backupMessage}</Text> : null}
            <TouchableOpacity style={styles.row} disabled={isImporting} onPress={() => void commitImport(showRestore)}><Text style={styles.rowText}>{isImporting ? 'Сохраняем…' : showRestore ? 'Восстановить' : 'Заменить прогресс'}</Text></TouchableOpacity>
            <TouchableOpacity style={styles.row} disabled={isImporting} onPress={() => { setPreview(null); setShowRestore(false); }}><Text>Отмена</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA', padding: 20 },
  header: { fontSize: 28, fontWeight: 'bold', marginBottom: 16, color: '#1A202C' },
  scroll: { paddingBottom: 40 },
  section: { marginBottom: 28 },
  sectionTitle: { fontSize: 16, color: '#4A5568', marginBottom: 4, fontWeight: '700' },
  sectionSub: { fontSize: 13, color: '#A0AEC0', marginBottom: 12 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFF',
    padding: 15,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  rowActive: { borderColor: ACCENT, backgroundColor: ACCENT_LIGHT },
  rowText: { fontSize: 15, fontWeight: '600', color: '#2D3748' },
  check: { color: ACCENT, fontWeight: 'bold', fontSize: 16 },
  orderControls: { flexDirection: 'row', gap: 8 },
  orderBtn: { padding: 6, backgroundColor: '#EDF2F7', borderRadius: 8, minWidth: 38, alignItems: 'center' },
  orderBtnText: { fontSize: 16 },
  disabledText: { opacity: 0.2 },
  resetRow: {
    backgroundColor: '#FFF5F5',
    borderColor: '#FEB2B2',
    justifyContent: 'center',
    paddingVertical: 16,
  },
  resetText: {
    color: '#E53E3E',
    fontWeight: 'bold',
    fontSize: 15,
  },
  optionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  optionChip: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    minWidth: 50,
    alignItems: 'center',
  },
  optionChipActive: {
    backgroundColor: ACCENT,
    borderColor: ACCENT,
  },
  optionChipText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#4A5568',
  },
  optionChipTextActive: {
    color: '#FFF',
  }
});
