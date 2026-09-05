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

/**
 * Lets the user pick a previously exported JSON file and restores it,
 * REPLACING all current progress, custom words/sentences and settings.
 */
export async function importProgressFromFile(): Promise<{ ok: boolean; error?: string; canceled?: boolean }> {
  try {
    const picked = await DocumentPicker.getDocumentAsync({
      type: ['application/json', 'text/plain', '*/*'],
      copyToCacheDirectory: true,
    });
    if (picked.canceled || !picked.assets || picked.assets.length === 0) {
      return { ok: false, canceled: true };
    }

    const raw = await FileSystem.readAsStringAsync(picked.assets[0].uri);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, error: 'Файл не является корректным JSON.' };
    }

    const backup = parsed as Partial<BackupFile>;
    if (!backup || backup.app !== 'papanda' || typeof backup.data !== 'object') {
      return { ok: false, error: 'Это не похоже на резервную копию Papanda.' };
    }

    const result = useStore.getState().importProgress(backup.data);
    return result;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Не удалось прочитать файл.' };
  }
}
