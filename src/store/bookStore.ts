import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { BookLocation } from '../models/book';
import { isBookLocation } from '../services/bookService';

interface BookState {
  lastLocation?: BookLocation;
  bookmarks: BookLocation[];
  fontSize: number;
  remember: (location: BookLocation) => void;
  toggleBookmark: (location: BookLocation) => void;
  setFontSize: (size: number) => void;
}
const same = (a: BookLocation, b: BookLocation) => a.chapterId === b.chapterId && a.blockId === b.blockId;
export const useBookStore = create<BookState>()(persist((set) => ({
  bookmarks: [], fontSize: 17,
  remember: location => { if (isBookLocation(location)) set({ lastLocation: location }); },
  toggleBookmark: location => { if (isBookLocation(location)) set(state => ({ bookmarks: state.bookmarks.some(b => same(b, location)) ? state.bookmarks.filter(b => !same(b, location)) : [...state.bookmarks, location].slice(-100) })); },
  setFontSize: size => set({ fontSize: Math.min(23, Math.max(15, size)) }),
}), {
  name: 'papanda-book-reader', storage: createJSONStorage(() => AsyncStorage),
  partialize: ({ lastLocation, bookmarks, fontSize }) => ({ lastLocation, bookmarks, fontSize }),
  merge: (persisted, current) => {
    const value = persisted as Partial<BookState> | undefined;
    return { ...current, lastLocation: isBookLocation(value?.lastLocation) ? value.lastLocation : undefined,
      bookmarks: Array.isArray(value?.bookmarks) ? value.bookmarks.filter(isBookLocation).slice(-100) : [],
      fontSize: typeof value?.fontSize === 'number' && Number.isFinite(value.fontSize) ? Math.min(23, Math.max(15, value.fontSize)) : 17 };
  },
}));
