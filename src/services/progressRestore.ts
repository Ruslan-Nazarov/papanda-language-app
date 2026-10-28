import AsyncStorage from '@react-native-async-storage/async-storage';
import { useStore } from '../store/useStore';
import { parseProgress } from '../store/progressValidation';
import { useBookStore } from '../store/bookStore';
import { parseBookProgress } from '../store/bookProgress';
import { progressStorage } from './progressStorage';
import type { PersistedProgress } from '../store/progressTypes';
import type { BookProgress } from '../store/bookProgress';

const KEY = 'papanda-before-import';
let busy = false;
const currentSnapshot = () => ({ data: useStore.getState().exportProgress(), book: useBookStore.getState().exportProgress() });
async function applySnapshot(data: PersistedProgress, book?: BookProgress): Promise<void> {
  const previous = currentSnapshot();
  try {
    const result = useStore.getState().importProgress(data);
    if (!result.ok) throw new Error(result.error);
    if (book) useBookStore.getState().importProgress(book);
    await progressStorage.flush();
  } catch (error) {
    // Restore both the visible state and the pending disk snapshots. A failed
    // import must not leave the learner working with a partially applied backup.
    useStore.getState().importProgress(previous.data);
    useBookStore.getState().importProgress(previous.book);
    await progressStorage.flush().catch(() => {});
    throw new Error('Восстановление не сохранено; изменения отменены. ' + (error instanceof Error ? error.message : 'Ошибка записи на устройство.'));
  }
}
export async function getRestorePointDate(): Promise<string | null> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return null;
  const snapshot = JSON.parse(raw);
  parseProgress(snapshot.data);
  if (snapshot.book !== undefined) parseBookProgress(snapshot.book);
  return typeof snapshot.savedAt === 'string' ? snapshot.savedAt : null;
}
export async function importWithRestorePoint(data: unknown, book?: unknown): Promise<void> {
  if (busy) throw new Error('Дождитесь завершения текущего восстановления.');
  const validated = parseProgress(data);
  const validatedBook = book === undefined ? undefined : parseBookProgress(book);
  busy = true;
  try {
    // If saving fails, do not replace the user's current progress.
    await AsyncStorage.setItem(KEY, JSON.stringify({ savedAt: new Date().toISOString(), ...currentSnapshot() }));
    await applySnapshot(validated, validatedBook);
  } finally { busy = false; }
}
export async function restoreBeforeImport(): Promise<void> {
  if (busy) throw new Error('Дождитесь завершения текущего восстановления.');
  busy = true;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) throw new Error('Нет сохранённого состояния до импорта.');
    const snapshot = JSON.parse(raw);
    const data = parseProgress(snapshot.data);
    const book = snapshot.book === undefined ? undefined : parseBookProgress(snapshot.book);
    await applySnapshot(data, book);
    // Keep the point available after a crash/restart and for repeated recovery.
  } finally { busy = false; }
}
