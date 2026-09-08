import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'papanda-install-id';

// Not cryptographic — just a stable per-install identifier the Gemini proxy
// rate-limits on. Format matches the proxy's INSTALL_ID_RE.
const makeId = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

let cached: string | null = null;

export async function getInstallId(): Promise<string> {
  if (cached) return cached;
  try {
    const existing = await AsyncStorage.getItem(KEY);
    if (existing && /^[a-z0-9-]{8,64}$/i.test(existing)) {
      cached = existing;
      return existing;
    }
  } catch {
    // fall through to a fresh (session-only) id
  }
  const fresh = makeId();
  cached = fresh;
  try {
    await AsyncStorage.setItem(KEY, fresh);
  } catch {
    // non-fatal; it just won't persist across launches
  }
  return fresh;
}
