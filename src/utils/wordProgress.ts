import type { Word, WordReview } from '../models/types';
import type { UserWordProgress } from '../store/progressTypes';
import { readWordStats } from './statistics';

/** Imported custom definitions may already contain progress. Overrides win. */
export function effectiveWordProgress(word: Word | undefined, progress: UserWordProgress = {}): UserWordProgress {
  return {
    count: word?.count ?? 0,
    is_learned: word?.is_learned ?? 0,
    knowledge_stats: Object.fromEntries(Object.entries(readWordStats(word?.knowledge_stats))
      .filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')),
    show_stats: Object.fromEntries(Object.entries(readWordStats(word?.show_stats))
      .filter((entry): entry is [string, number] => typeof entry[1] === 'number')),
    last_shown: word?.last_shown,
    last_shown_by_lang: word?.last_shown_by_lang,
    snoozed_until_by_lang: word?.snoozed_until_by_lang,
    review_by_lang: word?.review_by_lang,
    ...progress,
  };
}

export interface KnowledgeUndo {
  before: Record<string, boolean | undefined>;
  applied: boolean;
  reviewsBefore?: Record<string, WordReview | undefined>;
  reviewsApplied?: Record<string, WordReview | undefined>;
}

export function captureKnowledgeUndo(word: Word, languages: string[], applied: boolean): KnowledgeUndo {
  const knowledge = readWordStats(word.knowledge_stats);
  return { before: Object.fromEntries(languages.map(lang => [lang,
    typeof knowledge[lang] === 'boolean' ? knowledge[lang] : undefined])), applied,
    reviewsBefore: Object.fromEntries(languages.map(lang => [lang, word.review_by_lang?.[lang]])) };
}

/** Undo only this answer. Visits, edits, favourites and other languages survive. */
export function undoKnowledge(progress: UserWordProgress, undo: KnowledgeUndo, languages: string[]): UserWordProgress {
  const knowledge = { ...progress.knowledge_stats };
  const reviews = { ...progress.review_by_lang };
  for (const [lang, before] of Object.entries(undo.before)) {
    if (knowledge[lang] !== undo.applied) continue;
    if (undo.reviewsApplied && JSON.stringify(reviews[lang]) !== JSON.stringify(undo.reviewsApplied[lang])) continue;
    if (before === undefined) delete knowledge[lang];
    else knowledge[lang] = before;
    if (undo.reviewsBefore) {
      const review = undo.reviewsBefore[lang];
      if (review) reviews[lang] = review;
      else delete reviews[lang];
    }
  }
  return { ...progress, knowledge_stats: knowledge, review_by_lang: reviews,
    is_learned: languages.length > 0 && languages.every(lang => knowledge[lang] === true) ? 1 : 0 };
}
