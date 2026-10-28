import React from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Platform, KeyboardAvoidingView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useStore } from '../store/useStore';
import { activeExperimentRun, EXPERIMENTS } from '../models/experiments';
import { ACCENT, ACCENT_DARK, ACCENT_LIGHT } from '../constants/theme';

const dateLabel = (value: string) => new Date(value).toLocaleString('ru-RU', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

export default function ExperimentsScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Experiments'>) {
  const insets = useSafeAreaInsets();
  const experiments = useStore(state => state.experiments);
  const start = useStore(state => state.startExperiment);
  const stop = useStore(state => state.stopExperiment);
  const setNote = useStore(state => state.setExperimentNote);

  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    style={[styles.screen, { paddingTop: Math.max(insets.top, Platform.OS === 'android' ? 24 : 16) }]}>
    <View style={styles.header}>
      <TouchableOpacity testID="experiments-back" accessibilityRole="button" accessibilityLabel="Назад в настройки"
        style={styles.back} onPress={() => navigation.goBack()}>
        <Text style={styles.backText}>‹</Text>
      </TouchableOpacity>
      <Text style={styles.heading}>Эксперименты</Text>
    </View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}>
      <Text style={styles.description}>Здесь можно включать экспериментальные функции и возвращаться к обычному режиму. Каждый повторный запуск сохраняется отдельно.</Text>
      {EXPERIMENTS.map(definition => {
        const experiment = experiments[definition.id];
        const runs = experiment?.runs ?? [];
        const active = activeExperimentRun(experiment);
        return <View key={definition.id} style={styles.card}>
          <Text style={styles.title}>{definition.title}</Text>
          <Text style={styles.description}>{definition.description}</Text>
          <Text testID={`experiment-status-${definition.id}`} accessibilityLiveRegion="polite"
            style={[styles.status, active && styles.activeStatus]}>
            {active ? 'Идёт эксперимент' : runs.length ? 'Эксперимент остановлен' : 'Ещё не запускался'}
          </Text>
          <Text style={styles.label}>Заметка об эксперименте</Text>
          <TextInput testID={`experiment-note-${definition.id}`} accessibilityLabel={`Заметка об эксперименте: ${definition.title}`}
            multiline placeholder="Что хотим проверить и на что обратить внимание?" placeholderTextColor="#64748B"
            style={styles.input} value={experiment?.note ?? ''} onChangeText={note => setNote(definition.id, note)} />
          <Text style={styles.hint}>Заметки сохраняются автоматически.</Text>
          <TouchableOpacity testID={`experiment-toggle-${definition.id}`} accessibilityRole="button"
            style={[styles.button, active && styles.stopButton]} onPress={() => active ? stop(definition.id) : start(definition.id)}>
            <Text style={[styles.buttonText, active && styles.stopButtonText]}>
              {active ? 'Остановить эксперимент' : runs.length ? 'Запустить снова' : 'Запустить эксперимент'}
            </Text>
          </TouchableOpacity>
          <Text style={styles.historyTitle}>История запусков · {runs.length}</Text>
          {!runs.length && <Text style={styles.description}>После запуска здесь появятся даты начала и остановки.</Text>}
          {[...runs].reverse().map((run, index) => <View testID="experiment-run" key={run.id} style={styles.run}>
            <Text style={styles.runTitle}>Запуск {runs.length - index}{run.stoppedAt === null ? ' · идёт сейчас' : ''}</Text>
            <Text style={styles.date}>Начат: {dateLabel(run.startedAt)}</Text>
            <Text style={styles.date}>Остановлен: {run.stoppedAt === null ? 'ещё идёт' : dateLabel(run.stoppedAt)}</Text>
            <Text style={styles.label}>Заметка к запуску</Text>
            <TextInput testID={`experiment-run-note-${run.id}`} accessibilityLabel={`Заметка к запуску ${runs.length - index}`}
              multiline placeholder="Наблюдения и результат этого запуска" placeholderTextColor="#64748B"
              style={styles.input} value={run.note} onChangeText={note => setNote(definition.id, note, run.id)} />
          </View>)}
        </View>;
      })}
    </ScrollView>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F8F9FA' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 12, gap: 8 },
  back: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 32, color: '#334155' },
  heading: { fontSize: 24, fontWeight: 'bold', color: '#1A202C', flex: 1 },
  content: { paddingHorizontal: 16, gap: 16 },
  card: { backgroundColor: '#FFF', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#E2E8F0' },
  title: { fontSize: 18, fontWeight: '700', color: '#1A202C', marginBottom: 8 },
  description: { fontSize: 14, lineHeight: 21, color: '#475569' },
  status: { alignSelf: 'flex-start', backgroundColor: '#F1F5F9', color: '#475569', padding: 8, borderRadius: 8, marginVertical: 16, fontSize: 13, fontWeight: '600' },
  activeStatus: { backgroundColor: ACCENT_LIGHT, color: ACCENT_DARK },
  label: { fontSize: 13, fontWeight: '600', color: '#334155', marginBottom: 6, marginTop: 12 },
  input: { minHeight: 84, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 10, padding: 12, fontSize: 14, color: '#1A202C', backgroundColor: '#FFF', textAlignVertical: 'top' },
  hint: { fontSize: 12, lineHeight: 18, color: '#64748B', marginTop: 6 },
  button: { backgroundColor: ACCENT, borderRadius: 10, padding: 14, minHeight: 48, alignItems: 'center', marginTop: 16 },
  buttonText: { color: '#FFF', fontSize: 14, fontWeight: '700', textAlign: 'center' },
  stopButton: { backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#CBD5E1' },
  stopButtonText: { color: '#334155' },
  historyTitle: { fontSize: 16, fontWeight: '700', color: '#1A202C', marginTop: 24, marginBottom: 12 },
  run: { paddingVertical: 16, borderTopWidth: 1, borderTopColor: '#E2E8F0' },
  runTitle: { fontSize: 14, fontWeight: '700', color: '#334155', marginBottom: 8 },
  date: { fontSize: 13, color: '#475569', lineHeight: 21 },
});
