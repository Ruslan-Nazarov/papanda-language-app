import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
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
import { ACCENT, ACCENT_LIGHT, UI } from '../constants/theme';
import appConfig from '../../app.json';

const WORKOUT_COUNT_OPTIONS = [5, 7, 10, 15, 20];
const WORD_TOUR_COUNT_OPTIONS = [5, 10, 15, 20, 30, 50];
const SENTENCE_WORKOUT_COUNT_OPTIONS = [3, 5, 7, 10, 15, 20];
const ONBOARDING_KEY = 'papanda-onboarded';
const WORD_STUDY_HELP = [
  {
    title: 'Какие слова появляются чаще',
    text: 'Приоритет получают слова, которые вы не вспомнили или ещё не отметили знакомыми. Повторные ответы «Не знаю» повышают их приоритет. Добавляются новые слова и знакомые для проверки памяти. Сначала выбираются слова, срок повторения которых уже наступил. Состав тура подбирается автоматически.',
  },
  {
    title: '«Слова»: знакомство и закрепление',
    text: 'Карточка показывает переводы сразу на всех активных языках. Кнопка «Выучено» отмечает слово знакомым на всех этих языках. Переход к следующей карточке без этой отметки оставляет слово в изучении. Если слово знакомо на всех активных языках, оно исключается из «Слов», но остаётся доступным для проверки в «Повторе».',
  },
  {
    title: '«Повтор»: вспомните перевод',
    text: 'Вопрос задаётся на одном языке. Попробуйте вспомнить перевод, затем откройте ответ и выберите «Знаю» или «Не знаю». Ответ меняет отметку и расписание только для языка вопроса. Если вы учите несколько языков, для слова выбирается один из тех, которым нужна практика.',
  },
  {
    title: 'Когда повторять снова',
    text: 'После «Не знаю» следующий повтор назначается через 10 минут, а серия успешных ответов начинается заново. После успешных ответов в срок интервалы растут: 1, 3, 7, 14, 30 и 60 дней. Повторный ответ «Знаю» раньше назначенного срока не увеличивает уже начатую серию. Простое открытие перевода не считается успешным ответом и не переносит уже назначенный повтор. В обычном туре недавние слова могут появиться раньше срока, если других доступных слов не хватает.',
  },
  {
    title: 'Почему в туре нет повторов',
    text: 'Список карточек составляется в начале тура. Каждое слово встречается один раз, в «Повторе» — даже при нескольких активных языках. Одинаково написанные слова на одном языке также не дублируются. Если доступных слов меньше выбранного размера тура, тур будет короче. Добавление слов в словарь не начинает текущий тур заново. Возврат назад явно открывает предыдущую карточку; затем вы продолжаете ту же последовательность.',
  },
  {
    title: '«Реже» и план повторения',
    text: 'Кнопка «Реже» откладывает слово на 7 дней для языка вопроса. Отсрочка действует в обоих режимах: «Слова» временно скрывает всю карточку, если отложен хотя бы один из её активных языков.',
  },
  {
    title: 'Показы и отмена ответа',
    text: 'В «Словах» показ учитывается при открытии карточки, в «Повторе» — после ответа «Знаю» или «Не знаю». Число показов и ваша отметка о знании — разные вещи. Отмена ответа восстанавливает прежнюю отметку и расписание, сохраняя уже учтённые показы, изменения перевода и избранное. Знание и расписание хранятся отдельно для каждого языка и входят в резервную копию.',
  },
];
const STATISTICS_HELP = [
  {
    title: 'Слов в базе',
    text: 'Количество словарных записей: встроенные слова и добавленные вами. Это размер вашего словаря, а не число уже изученных слов.',
  },
  {
    title: 'Просмотрено',
    text: 'Сколько разных слов встретилось хотя бы один раз хотя бы на одном из активных языков. Повторные показы одного слова не увеличивают это число.',
  },
  {
    title: 'Выучено полностью и знание по языкам',
    text: '«Выучено полностью» — слова, отмеченные знакомыми на всех активных языках. «Знание по языкам» показывает такие отметки отдельно для каждого языка. В «Повторе» ответ «Знаю» относится только к языку вопроса, а «Выучено» в «Словах» — ко всем активным языкам. Это ваша самооценка. При смене активных языков эти показатели пересчитываются.',
  },
  {
    title: 'Показов сегодня и активность за 14 дней',
    text: 'Это количество учтённых показов, включая повторные. В «Словах» показ считается при открытии карточки, в «Повторе» — после ответа «Знаю» или «Не знаю». В тренажёре предложений учитывается каждое найденное в словаре слово; повтор одного слова внутри предложения считается один раз. Карточка «Слов» с несколькими языками даёт один общий показ. Самостоятельный разбор и чтение своего текста в этот график не входят. День определяется по местному времени устройства.',
  },
  {
    title: 'По количеству повторений',
    text: 'Группы показывают, сколько слов имеют 1–5, 6–15, 16–40, 41–80 или больше 80 показов. Для слова берётся среднее число показов по тем активным языкам, на которых оно уже встречалось. Слова без показов на активных языках вынесены отдельно. Большое число показов само по себе не означает, что вы помните перевод.',
  },
  {
    title: 'Результаты тренировок',
    text: 'Учитываются ответы в завершённых тренировках «Повтора». Процент равен числу ответов «Знаю», делённому на все ответы «Знаю» и «Не знаю», и умноженному на 100. Например, 7 ответов «Знаю» из 10 — это 70%. Несколько тренировок за день объединяются; показаны последние 10 дней с ответами. Итоговый процент считается по всем ответам этих дней. Состав и сложность слов могут меняться, поэтому сравнивайте и сами задания, и результаты.',
  },
  {
    title: 'Оценка закрепления — iMW',
    text: 'Условный индекс от 0 до 100 по всему словарю и всем активным языкам. Он учитывает число показов, отметку «Знаю» и давность занятий. Непоказанные слова дают нулевой вклад, без отметки «Знаю» вклад вдвое меньше, после перерыва он постепенно снижается. Поэтому после нескольких тренировок большой базы индекс может оставаться небольшим. Число 80 в расчёте — настройка шкалы показов, а не обязательное число повторений для запоминания. Индекс не измеряет владение всем языком и не определяет срок следующего повторения: расписание зависит от ваших ответов.',
  },
  {
    title: 'Частые слова',
    text: 'До 15 слов с наибольшим суммарным числом ваших показов во всех разделах. Это частота встреч именно в приложении, а не частотность слова в языке. В списке могут быть и хорошо знакомые, и трудные для вас слова.',
  },
  {
    title: 'Разбор предложений',
    text: 'Частота грамматических форм по меткам слов в последних 500 завершённых разборах. Учитывается полное раскрытие карточки или завершённое самостоятельное упражнение без пропусков и спорных ответов. Повторный полный разбор считается снова. Доступен выбор языка, число разборов за сегодня и примеры форм. Это частота встреч, а не оценка знаний. Сбор начинается с обновления; история входит в резервную копию.',
  },
  {
    title: 'Навыки разбора предложения',
    text: 'Отдельный учёт заданий на поиск сказуемого, подлежащего и других частей предложения. Результаты разделяются на самостоятельные правильные ответы, ответы с помощью и ошибки. Спорные ответы исключаются из расчёта. Эти задания не прибавляются к результатам тренировок слов.',
  },
];

export default function SettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const topPadding = Math.max(insets.top, Platform.OS === 'android' ? 24 : 16);
  const { activeLanguages, setLanguages, resetStatistics, workoutWordCount, setWorkoutWordCount, wordTourSize, setWordTourSize, sentenceWorkoutCount, setSentenceWorkoutCount } = useStore(useShallow(state => ({
    activeLanguages: state.activeLanguages,
    setLanguages: state.setLanguages,
    resetStatistics: state.resetStatistics,
    workoutWordCount: state.workoutWordCount,
    setWorkoutWordCount: state.setWorkoutWordCount,
    wordTourSize: state.wordTourSize,
    setWordTourSize: state.setWordTourSize,
    sentenceWorkoutCount: state.sentenceWorkoutCount,
    setSentenceWorkoutCount: state.setSentenceWorkoutCount,
  })));
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [showWordHelp, setShowWordHelp] = useState(false);
  const [showStatisticsHelp, setShowStatisticsHelp] = useState(false);

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
      if (restore) await restoreBeforeImport(); else await importWithRestorePoint(preview!.data, preview!.book);
      setPreview(null); setShowRestore(false);
      setRestoreDate(await getRestorePointDate());
      setBackupMessage(restore ? 'Состояние до импорта восстановлено.' : 'Прогресс импортирован. Предыдущее состояние сохранено на устройстве.');
    } catch (error) { setBackupMessage(error instanceof Error ? error.message : 'Не удалось восстановить прогресс.'); }
    finally { setRestoreDate(await getRestorePointDate().catch(() => null)); setIsImporting(false); }
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
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Книга и заметки</Text>
          <TouchableOpacity testID="settings-notes" accessibilityRole="button" style={styles.row} onPress={() => navigation.navigate('Notes')}>
            <Text style={styles.rowText}>Мои заметки</Text><Text style={styles.rowText}>›</Text>
          </TouchableOpacity>
          <Text style={styles.sectionSub}>Авторская методика и грамматика изучаемых языков. Доступны без интернета.</Text>
          <TouchableOpacity testID="book-entry" accessibilityRole="button" style={styles.row}
            onPress={() => navigation.navigate('Book', { language: activeLanguages[0] })}>
            <Text style={styles.rowText}>Открыть книгу</Text><Text style={styles.rowText}>›</Text>
          </TouchableOpacity>
        </View>
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

        {/* Sentence Workout Options */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Разбор предложений</Text>
          <Text style={styles.sectionSub}>Количество предложений за тренировку. По умолчанию — 5.</Text>
          <View style={styles.optionsRow}>
            {SENTENCE_WORKOUT_COUNT_OPTIONS.map(count => (
              <TouchableOpacity
                key={'sentence-workout-' + count}
                accessibilityRole="button"
                accessibilityLabel={'Предложений за тренировку: ' + count}
                accessibilityState={{ selected: sentenceWorkoutCount === count }}
                aria-selected={sentenceWorkoutCount === count}
                style={[styles.optionChip, sentenceWorkoutCount === count && styles.optionChipActive]}
                onPress={() => setSentenceWorkoutCount(count)}
              >
                <Text style={[styles.optionChipText, sentenceWorkoutCount === count && styles.optionChipTextActive]}>{count}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Brain Workout Options */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Повтор</Text>

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

          <Text style={styles.sectionSub}>Чаще появляются слова, которые вы не знаете или не вспомнили. Новые слова и знакомые для проверки добавляются автоматически. В одном туре каждое слово встречается один раз.</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Справка</Text>
          <TouchableOpacity
            testID="settings-word-help"
            accessibilityRole="button"
            accessibilityState={{ expanded: showWordHelp }}
            style={styles.row}
            onPress={() => setShowWordHelp(value => !value)}
          >
            <Text style={[styles.rowText, { flex: 1 }]}>Как работают «Слова» и «Повтор»</Text>
            <Text style={styles.check}>{showWordHelp ? '−' : '+'}</Text>
          </TouchableOpacity>
          {showWordHelp && (
            <View style={styles.helpCard}>
              {WORD_STUDY_HELP.map(item => (
                <View key={item.title}>
                  <Text style={styles.sectionTitle}>{item.title}</Text>
                  <Text style={styles.helpText}>{item.text}</Text>
                </View>
              ))}
            </View>
          )}
          <TouchableOpacity
            testID="settings-statistics-help"
            accessibilityRole="button"
            accessibilityState={{ expanded: showStatisticsHelp }}
            style={styles.row}
            onPress={() => setShowStatisticsHelp(value => !value)}
          >
            <Text style={[styles.rowText, { flex: 1 }]}>Что означает статистика</Text>
            <Text style={styles.check}>{showStatisticsHelp ? '−' : '+'}</Text>
          </TouchableOpacity>
          {showStatisticsHelp && (
            <View style={styles.helpCard}>
              {STATISTICS_HELP.map(item => (
                <View key={item.title}>
                  <Text style={styles.sectionTitle}>{item.title}</Text>
                  <Text style={styles.helpText}>{item.text}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Экспериментальные функции</Text>
          <Text style={styles.sectionSub}>Пробуйте изменения, сохраняйте заметки и историю запусков.</Text>
          <TouchableOpacity testID="settings-experiments" accessibilityRole="button" style={styles.row}
            onPress={() => navigation.navigate('Experiments')}>
            <Text style={styles.rowText}>Эксперименты</Text><Text style={styles.rowText}>›</Text>
          </TouchableOpacity>
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
              'Слов: ' + (preview?.customWords ?? 0) + ' · Предложений: ' + (preview?.sentences ?? 0) + '\nОтветов разбора: ' + (preview?.structureAttempts ?? 0) + '\nЗаметок: ' + (preview?.notes ?? 0) + ' · Черновиков: ' + (preview?.noteDrafts ?? 0) + '\nЗаписей прогресса: ' + (preview?.progressWords ?? 0) +
              (preview?.book ? '\nЗакладок книги: ' + preview.book.bookmarks.length + ' · Позиция и размер текста сохранены.' : '\nКнига отсутствует в этой копии; текущие закладки и позиция сохранятся.') +
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
  container: { flex: 1, backgroundColor: UI.canvas, padding: 16 },
  header: { ...UI.heading, marginBottom: 16, color: '#1A202C' },
  scroll: { width: '100%', maxWidth: UI.column, alignSelf: 'center', paddingBottom: 40 },
  section: { marginBottom: 28 },
  sectionTitle: { fontSize: 16, color: '#4A5568', marginBottom: 4, fontWeight: '700' },
  sectionSub: { ...UI.caption, color: UI.muted, marginBottom: 12 },
  helpCard: { backgroundColor: UI.surface, padding: 16, borderRadius: 12, gap: 20 },
  helpText: { ...UI.reading, color: UI.body },
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
  },
  rowActive: { borderColor: ACCENT, backgroundColor: ACCENT_LIGHT },
  rowText: { fontSize: 15, fontWeight: '600', color: '#2D3748' },
  check: { color: ACCENT, fontWeight: 'bold', fontSize: 16 },
  orderControls: { flexDirection: 'row', gap: 8 },
  orderBtn: { minHeight: 44, justifyContent: 'center', padding: 6, backgroundColor: '#EDF2F7', borderRadius: 8, minWidth: 38, alignItems: 'center' },
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
    borderRadius: 8,
    minWidth: 50,
    minHeight: 44,
    justifyContent: 'center',
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
    color: UI.onAccent,
  }
});
