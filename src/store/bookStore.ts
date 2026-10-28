import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { progressStorage } from '../services/progressStorage';
import { defaultBookProgress, parseBookProgress, type BookProgress } from './bookProgress';
import type { BookLocation } from '../models/book';
import { isBookLocation } from '../services/bookService';

interface BookState extends BookProgress {
  remember: (location: BookLocation) => void;
  toggleBookmark: (location: BookLocation) => void;
  setFontSize: (size: number) => void;
  exportProgress: () => BookProgress;
  importProgress: (progress: unknown) => void;
}
const same = (a: BookLocation, b: BookLocation) => a.chapterId === b.chapterId && a.blockId === b.blockId;
export const useBookHydrationState = create<{ ready: boolean; error: string | null }>(() => ({ ready: false, error: null }));
export const useBookStore = create<BookState>()(persist((set, get) => ({
  ...defaultBookProgress(),
  remember: location => { if (isBookLocation(location)) set({ lastLocation: location }); },
  toggleBookmark: location => { if (isBookLocation(location)) set(state => ({ bookmarks: state.bookmarks.some(b => same(b, location)) ? state.bookmarks.filter(b => !same(b, location)) : [...state.bookmarks, location].slice(-100) })); },
  setFontSize: size => { if (Number.isFinite(size)) set({ fontSize: Math.min(23, Math.max(15, size)) }); },
  exportProgress: () => parseBookProgress(get()),
  importProgress: progress => set(parseBookProgress(progress)),
}), {
  name: 'papanda-book-reader', storage: createJSONStorage(() => progressStorage),
  partialize: ({ lastLocation, bookmarks, fontSize }) => ({ lastLocation, bookmarks, fontSize }),
  merge: (persisted, current) => {
    const value = persisted as Partial<BookState> | undefined;
    return { ...current, lastLocation: isBookLocation(value?.lastLocation) ? value.lastLocation : undefined,
      bookmarks: Array.isArray(value?.bookmarks) ? value.bookmarks.filter(isBookLocation).slice(-100) : [],
      fontSize: typeof value?.fontSize === 'number' && Number.isFinite(value.fontSize) ? Math.min(23, Math.max(15, value.fontSize)) : 17 };
  },
  onRehydrateStorage: () => (_state, error) => {
    useBookHydrationState.setState({ ready: !error, error: error ? 'Не удалось прочитать закладки книги. Повторите загрузку.' : null });
  },
}));
