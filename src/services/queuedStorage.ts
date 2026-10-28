export interface StorageBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<unknown>;
  removeItem(key: string): Promise<unknown>;
}

/** Serialize writes per key; retain the latest snapshot after a device/storage error. */
export function createQueuedStorage(backend: StorageBackend, onErrors: (keys: string[]) => void = () => {}) {
  type Entry = { pending?: { value: string | null }; running?: Promise<void>; error?: Error };
  const entries = new Map<string, Entry>();
  const report = () => onErrors([...entries].filter(([, entry]) => entry.error).map(([key]) => key));
  const drain = (key: string, entry: Entry): Promise<void> => {
    if (entry.running) return entry.running;
    entry.running = Promise.resolve().then(async () => {
      try {
        while (entry.pending) {
          const next = entry.pending;
          entry.pending = undefined;
          try {
            if (next.value === null) await backend.removeItem(key);
            else await backend.setItem(key, next.value);
            entry.error = undefined;
          } catch (error) {
            entry.error = error instanceof Error ? error : new Error('Не удалось сохранить данные.');
            // A newer snapshot may have arrived while this write was in flight.
            if (!entry.pending) { entry.pending = next; break; }
          }
        }
      } finally {
        // Clear within the same continuation as the last write. A separate
        // Promise.finally leaves a window where a new snapshot can be stranded.
        entry.running = undefined;
        report();
      }
    });
    return entry.running;
  };
  const write = (key: string, value: string | null) => {
    const entry = entries.get(key) ?? {};
    entries.set(key, entry);
    entry.pending = { value };
    // Zustand does not await its writes. Failure is exposed via status/flush,
    // never as an unhandled rejection or a falsely successful disk write.
    return drain(key, entry);
  };
  const flush = async () => {
    for (const entry of entries.values()) {
      while (entry.running) await entry.running;
      if (entry.error) throw entry.error;
    }
  };
  return {
    getItem: async (key: string) => {
      const entry = entries.get(key);
      while (entry?.running) await entry.running;
      if (entry?.error) throw entry.error;
      return backend.getItem(key);
    },
    setItem: (key: string, value: string) => write(key, value),
    removeItem: (key: string) => write(key, null),
    flush,
    retry: async () => {
      await Promise.all([...entries].filter(([, entry]) => entry.pending).map(([key, entry]) => drain(key, entry)));
      await flush();
    },
  };
}
