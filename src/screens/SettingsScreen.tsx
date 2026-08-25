import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../store/useStore';
import { LANGUAGES, getLanguageLabel } from '../constants/languages';

const WORKOUT_COUNT_OPTIONS = [5, 7, 10, 15, 20];

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const topPadding = Math.max(insets.top, Platform.OS === 'android' ? 24 : 16);
  const { activeLanguages, setLanguages, resetStatistics, workoutWordCount, setWorkoutWordCount } = useStore();

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

        {/* Brain Workout Options */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Настройки Brain Workout</Text>
          <Text style={styles.sectionSub}>Количество слов за одну тренировку</Text>
          <View style={styles.optionsRow}>
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
  rowActive: { borderColor: '#007BFF', backgroundColor: '#EBF5FF' },
  rowText: { fontSize: 15, fontWeight: '600', color: '#2D3748' },
  check: { color: '#007BFF', fontWeight: 'bold', fontSize: 16 },
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
    backgroundColor: '#007BFF',
    borderColor: '#007BFF',
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
