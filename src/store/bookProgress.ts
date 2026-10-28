import type { BookLocation } from '../models/book';
import { isBookLocation } from '../services/bookService';

export interface BookProgress { lastLocation?: BookLocation; bookmarks: BookLocation[]; fontSize: number }
export const defaultBookProgress = (): BookProgress => ({ bookmarks: [], fontSize: 17 });

export function parseBookProgress(input: unknown): BookProgress {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Некорректные данные книги.');
  const value = input as Partial<BookProgress>;
  if ((value.lastLocation !== undefined && !isBookLocation(value.lastLocation)) ||
      !Array.isArray(value.bookmarks) || value.bookmarks.length > 100 || !value.bookmarks.every(isBookLocation) ||
      typeof value.fontSize !== 'number' || !Number.isFinite(value.fontSize) || value.fontSize < 15 || value.fontSize > 23) {
    throw new Error('Некорректные закладки или настройки книги.');
  }
  return JSON.parse(JSON.stringify({ lastLocation: value.lastLocation, bookmarks: value.bookmarks, fontSize: value.fontSize })) as BookProgress;
}
