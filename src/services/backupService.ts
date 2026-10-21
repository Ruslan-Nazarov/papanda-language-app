import { Platform } from 'react-native';
import { previewBackup, MAX_BACKUP_BYTES, type BackupPreview } from './backupFormat';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { useStore } from '../store/useStore';

const BACKUP_VERSION = 1;

interface BackupFile {
  app: 'papanda';
  version: number;
  exportedAt: string;
  data: unknown;
}

const backupFileName = () => {
  const now = new Date();
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `papanda-backup-${stamp}.json`;
};

/**
 * Writes the current progress (words, sentences, statistics, settings) to a
 * JSON file and opens the native share sheet so the user can save it
 * wherever they like (Files, Drive, a chat with themselves, ...).
 */
export async function exportProgressToFile(): Promise<{ ok: boolean; error?: string }> {
  try {
    const data = useStore.getState().exportProgress();
    const payload: BackupFile = {
      app: 'papanda',
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      data,
    };

    if (Platform.OS === 'web') {
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = backupFileName(); link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return { ok: true };
    }
    const dir = FileSystem.cacheDirectory;
    if (!dir) return { ok: false, error: 'Нет доступа к файловой системе на этом устройстве.' };

    const fileUri = dir + backupFileName();
    await FileSystem.writeAsStringAsync(fileUri, JSON.stringify(payload, null, 2));

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(fileUri, {
        mimeType: 'application/json',
        dialogTitle: 'Сохранить резервную копию прогресса',
      });
    } else {
      return { ok: false, error: 'На этом устройстве недоступна отправка файлов.' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Не удалось сохранить резервную копию.' };
  }
}

/** Picking and validating a file never mutates the current progress. */
export async function previewProgressFromFile(): Promise<BackupPreview | null> {
  const picked = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', '*/*'], copyToCacheDirectory: true });
  if (picked.canceled || !picked.assets?.length) return null;
  const asset = picked.assets[0];
  if ((asset.size ?? 0) > MAX_BACKUP_BYTES) throw new Error('Файл больше 10 МБ.');
  const raw = Platform.OS === 'web' && asset.file ? await asset.file.text() : await FileSystem.readAsStringAsync(asset.uri);
  return previewBackup(raw);
}
