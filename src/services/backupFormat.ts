import { parseProgress } from '../store/progressValidation';
import { baseStaticWords } from '../store/catalog';
import { getWordKey } from '../utils/words';
import type { PersistedProgress } from '../store/progressTypes';

export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;
export interface BackupPreview { data: PersistedProgress; exportedAt?: string; customWords: number; sentences: number; progressWords: number; conflicts: number; readingTexts: number; structureAttempts: number }
export function previewBackup(raw: string): BackupPreview {
  let bytes = 0;
  for (const char of raw) {
    const code = char.codePointAt(0)!;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (bytes > MAX_BACKUP_BYTES) throw new Error('Файл больше 10 МБ.');
  }
  let file: { app?: unknown; version?: unknown; data?: unknown; exportedAt?: unknown };
  try { file = JSON.parse(raw); } catch { throw new Error('Файл не является корректным JSON.'); }
  if (!file || file.app !== 'papanda') throw new Error('Это не резервная копия Papanda.');
  if (file.version !== 1) throw new Error('Эта версия резервной копии не поддерживается.');
  const data = parseProgress(file.data);
  const seen = new Set(baseStaticWords.map(getWordKey));
  let conflicts = 0;
  const original = file.data as PersistedProgress;
  for (const word of original.customWords ?? []) { const key = getWordKey(word); if (seen.has(key)) conflicts++; seen.add(key); }
  return { data, exportedAt: typeof file.exportedAt === 'string' ? file.exportedAt : undefined,
    customWords: data.customWords.length, sentences: data.customSentences.length + data.generatedSentences.length,
    progressWords: Object.keys(data.userWordProgress).length, conflicts, readingTexts: data.readingTexts.length, structureAttempts: data.structureAttempts.length };
}
