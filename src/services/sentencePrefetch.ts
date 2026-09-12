import { useStore } from '../store/useStore';
import { generateSentenceBatch, isSentenceGenerationConfigured } from './sentenceGeneration';
import { LANGUAGES } from '../constants/languages';

let isPrefetching = false;
let lastPrefetchTime = 0;
const MIN_PREFETCH_INTERVAL_MS = 25000; // at least 25 seconds between background prefetch checks
const PREFETCH_THRESHOLD = 6; // top up if fewer than this many unlearned generated sentences
const PREFETCH_BATCH_SIZE = 10;

export async function prefetchSentencesInBackground(): Promise<void> {
  if (isPrefetching) return;
  if (!isSentenceGenerationConfigured()) return;

  const now = Date.now();
  if (now - lastPrefetchTime < MIN_PREFETCH_INTERVAL_MS) return;

  const state = useStore.getState();
  const { activeLanguages, words, generatedSentences, learnedSentences, addGeneratedSentences } = state;
  if (!activeLanguages || activeLanguages.length === 0 || !words || words.length === 0) return;

  isPrefetching = true;
  lastPrefetchTime = now;

  try {
    for (const langCode of activeLanguages) {
      const langObj = LANGUAGES.find(l => l.code === langCode);
      if (!langObj) continue;

      const unlearnedCount = (generatedSentences || []).filter(s =>
        s.source === 'generated' &&
        s.language &&
        s.language.toLowerCase().includes(langObj.label.toLowerCase()) &&
        !learnedSentences.includes(s.id)
      ).length;

      if (unlearnedCount < PREFETCH_THRESHOLD) {
        try {
          const freshWords = useStore.getState().words;
          const batch = await generateSentenceBatch(langCode, freshWords, PREFETCH_BATCH_SIZE);
          if (batch && batch.length > 0) {
            addGeneratedSentences(batch);
          }
          // Brief breath between languages
          await new Promise(r => setTimeout(r, 2000));
        } catch (err) {
          console.warn(`[SentencePrefetch] error for ${langCode}:`, err);
        }
      }
    }
  } finally {
    isPrefetching = false;
  }
}
