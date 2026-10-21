import AsyncStorage from '@react-native-async-storage/async-storage';
import { useStore } from '../store/useStore';
import { parseProgress } from '../store/progressValidation';

const KEY = 'papanda-before-import';
let busy = false;
export async function getRestorePointDate(): Promise<string | null> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return null;
  const snapshot = JSON.parse(raw);
  parseProgress(snapshot.data);
  return typeof snapshot.savedAt === 'string' ? snapshot.savedAt : null;
}
export async function importWithRestorePoint(data: unknown): Promise<void> {
  if (busy) throw new Error('Дождитесь завершения текущего восстановления.');
  const validated = parseProgress(data);
  busy = true;
  try {
    // If saving fails, do not replace the user's current progress.
    await AsyncStorage.setItem(KEY, JSON.stringify({ savedAt: new Date().toISOString(), data: useStore.getState().exportProgress() }));
    const result = useStore.getState().importProgress(validated);
    if (!result.ok) throw new Error(result.error);
  } finally { busy = false; }
}
export async function restoreBeforeImport(): Promise<void> {
  if (busy) throw new Error('Дождитесь завершения текущего восстановления.');
  busy = true;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) throw new Error('Нет сохранённого состояния до импорта.');
    const data = parseProgress(JSON.parse(raw).data);
    const result = useStore.getState().importProgress(data);
    if (!result.ok) throw new Error(result.error);
    // Keep the point available after a crash/restart and for repeated recovery.
  } finally { busy = false; }
}
