import type { PersistedProgress, UserWordProgress } from './progressTypes';
import { getWordKey } from '../utils/words';
import type { Sentence } from '../models/types';
import { mergeSentences } from './catalog';
import { sentenceFingerprint } from '../utils/sentenceValidation';

/** The removed empty-key row was a duplicate of blind. Never discard its progress. */
export function migrateProgress(progress: PersistedProgress & { sentenceReports?: Record<string, { sentence: Sentence }> }): PersistedProgress {
  // Restore previously hidden cards, including generated cards evicted from the cache.
  // Current edits take precedence over the older snapshot saved with a report.
  const cards = mergeSentences(progress.customSentences, progress.generatedSentences);
  const ids = new Set(cards.map(card => card.id));
  const fingerprints = new Set(cards.map(card => sentenceFingerprint(card.language, card.sentence)));
  for (const { sentence } of Object.values(progress.sentenceReports ?? {})) {
    const fingerprint = sentenceFingerprint(sentence.language, sentence.sentence);
    if (ids.has(sentence.id) || fingerprints.has(fingerprint)) continue;
    progress.customSentences.push(sentence);
    ids.add(sentence.id);
    fingerprints.add(fingerprint);
  }
  delete progress.sentenceReports;
  const legacy = progress.userWordProgress[''];
  if (legacy) {
    const current = progress.userWordProgress.blind ?? {};
    const merged: UserWordProgress = { ...legacy, ...current,
      count: Math.max(legacy.count ?? 0, current.count ?? 0),
      knowledge_stats: { ...legacy.knowledge_stats, ...current.knowledge_stats },
      show_stats: { ...legacy.show_stats },
      last_shown_by_lang: { ...legacy.last_shown_by_lang },
      custom_translations: { ...legacy.custom_translations, ...current.custom_translations },
      snoozed_until_by_lang: { ...legacy.snoozed_until_by_lang, ...current.snoozed_until_by_lang },
    };
    for (const [lang, count] of Object.entries(current.show_stats ?? {})) merged.show_stats![lang] = Math.max(count, merged.show_stats![lang] ?? 0);
    for (const [lang, stamp] of Object.entries(current.last_shown_by_lang ?? {})) {
      if (Date.parse(stamp) > Date.parse(merged.last_shown_by_lang![lang] ?? '') || !merged.last_shown_by_lang![lang]) merged.last_shown_by_lang![lang] = stamp;
    }
    merged.last_shown = [legacy.last_shown, current.last_shown].filter((s): s is string => Boolean(s)).sort((a,b)=>Date.parse(b)-Date.parse(a))[0];
    progress.userWordProgress = { ...progress.userWordProgress, blind: merged };
    delete progress.userWordProgress[''];
  }
  // A single canonical custom definition per key; later backup entries win.
  progress.customWords = [...new Map(progress.customWords.map(word => [getWordKey(word), word])).values()];
  return progress;
}
