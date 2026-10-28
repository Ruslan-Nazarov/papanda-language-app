import { LANGUAGES } from '../constants/languages';
import type { LanguageNote, NoteSource } from '../models/notes';
import { sentenceFingerprint } from './sentenceValidation';

export const NOTE_KINDS = { rule: 'Правило', question: 'Вопрос', observation: 'Наблюдение' } as const;
export const NOTE_UNDERSTANDING = { exploring: 'Разбираюсь', understood: 'Понял', review: 'Повторить' } as const;
export const NOTE_LIMITS = { title: 100, body: 6000, example: 2000, tag: 40, tags: 10, sources: 30 } as const;
let sequence = 0;

export function createLanguageNote(language: string, source?: NoteSource, body = ''): LanguageNote {
  const now = new Date().toISOString();
  return {
    id: `note-${Date.now().toString(36)}-${++sequence}-${Math.random().toString(36).slice(2, 8)}`,
    language, title: '', body: body.slice(0, NOTE_LIMITS.body), example: source?.token || '', tags: [],
    kind: 'rule', understanding: 'exploring', sources: source ? [{ ...source }] : [],
    showInContext: true, pinned: false, archived: false, createdAt: now, updatedAt: now,
  };
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;
const stamp = (value: unknown): boolean => typeof value === 'string' && Number.isFinite(Date.parse(value));
export function isNoteSource(value: unknown): value is NoteSource {
  return record(value) && text(value.sentenceId, 300) && !!value.sentenceId.trim() && text(value.text, 6000) && !!value.text.trim() &&
    (value.translation === undefined || text(value.translation, 6000)) && (value.token === undefined || text(value.token, 500));
}

export function isLanguageNote(value: unknown): value is LanguageNote {
  return record(value) && text(value.id, 200) && !!value.id.trim() && LANGUAGES.some(l => l.code === value.language) &&
    text(value.title, NOTE_LIMITS.title) && text(value.body, NOTE_LIMITS.body) && text(value.example, NOTE_LIMITS.example) &&
    Array.isArray(value.tags) && value.tags.length <= NOTE_LIMITS.tags && value.tags.every(tag => text(tag, NOTE_LIMITS.tag)) &&
    typeof value.kind === 'string' && Object.hasOwn(NOTE_KINDS, value.kind) &&
    typeof value.understanding === 'string' && Object.hasOwn(NOTE_UNDERSTANDING, value.understanding) &&
    Array.isArray(value.sources) && value.sources.length <= NOTE_LIMITS.sources && value.sources.every(isNoteSource) &&
    typeof value.showInContext === 'boolean' && typeof value.pinned === 'boolean' && typeof value.archived === 'boolean' &&
    (value.deletedAt === undefined || stamp(value.deletedAt)) && stamp(value.createdAt) && stamp(value.updatedAt);
}

export function prepareLanguageNote(note: LanguageNote, draft = false): LanguageNote {
  if (!isLanguageNote(note)) throw new Error('Заметка имеет неверный формат или превышает допустимую длину.');
  if (!draft && !note.body.trim()) throw new Error('Добавьте текст заметки своими словами.');
  const result: LanguageNote = JSON.parse(JSON.stringify(note));
  if (!draft) {
    result.body = result.body.trim();
    result.title = result.title.trim() || result.body.split(/[\n.!?]/)[0].slice(0, 80) || 'Моя заметка';
    result.example = result.example.trim();
    result.tags = [...new Set(result.tags.map(tag => tag.trim()).filter(Boolean))];
  }
  result.updatedAt = new Date().toISOString();
  return result;
}

export function noteMatchesSource(note: LanguageNote, language: string, source: NoteSource): boolean {
  return note.language === language && note.sources.some(saved => saved.sentenceId === source.sentenceId ||
    sentenceFingerprint(language, saved.text) === sentenceFingerprint(language, source.text));
}

export function linkNoteSource(note: LanguageNote, source: NoteSource): LanguageNote {
  if (note.sources.some(saved => saved.sentenceId === source.sentenceId && saved.text === source.text && saved.token === source.token)) {
    return { ...note, showInContext: true };
  }
  if (note.sources.length >= NOTE_LIMITS.sources) throw new Error('У заметки уже 30 примеров. Удалите ненужную связь в редакторе.');
  return { ...note, showInContext: true, sources: [...note.sources, { ...source }] };
}

export function sortNotes(notes: LanguageNote[]): LanguageNote[] {
  return [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id));
}

export function searchNotes(notes: LanguageNote[], query: string): LanguageNote[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return notes.filter(note => {
    const content = [note.title, note.body, note.example, ...note.tags, ...note.sources.map(s => `${s.text} ${s.token || ''}`)].join(' ').toLocaleLowerCase();
    return terms.every(term => content.includes(term));
  });
}
