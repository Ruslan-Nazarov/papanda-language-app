import type { Word, WordReview } from '../models/types';
import { getWordKey, getWordTranslation } from './words';
import { getWordLastShown, readWordStats } from './statistics';

const DAY = 86400000;
const SUCCESS_DAYS = [1, 3, 7, 14, 30, 60];
export const FAILURE_DELAY = 10 * 60000;

/** Only an explicit answer changes the schedule; reading a translation does not. */
export function nextWordReview(previous: WordReview | undefined, known: boolean, now = Date.now()): WordReview {
  // Repeated self-assessments before the due date must not inflate the streak.
  const streak = known ? previous && previous.streak > 0 && Date.parse(previous.dueAt) > now
    ? previous.streak : Math.min((previous?.streak ?? 0) + 1, SUCCESS_DAYS.length) : 0;
  const delay = known ? SUCCESS_DAYS[Math.max(0, streak - 1)] * DAY : FAILURE_DELAY;
  return { streak, lapses: (previous?.lapses ?? 0) + (known ? 0 : 1),
    answeredAt: new Date(now).toISOString(),
    dueAt: known && previous && previous.streak === streak && Date.parse(previous.dueAt) > now
      ? previous.dueAt : new Date(now + delay).toISOString() };
}

export type StudyKind = 'weak' | 'new' | 'known';
export function wordStudyState(word: Word, lang: string, now = Date.now()) {
  const knowledge = readWordStats(word.knowledge_stats)[lang];
  const shows = Number(readWordStats(word.show_stats)[lang]) || 0;
  const review = word.review_by_lang?.[lang];
  const last = Date.parse(getWordLastShown(word, lang) ?? '');
  const kind: StudyKind = knowledge === true ? 'known' : knowledge === false || shows > 0 ? 'weak' : 'new';
  // Old backups have no answer schedule: use a conservative fixed interval,
  // never the number of passive exposures as evidence of successful recall.
  const dueAt = review ? Date.parse(review.dueAt) : !Number.isFinite(last) ? 0
    : last + (knowledge === true ? 3 * DAY : knowledge === false ? FAILURE_DELAY : DAY);
  const overdue = Math.max(0, now - (dueAt || now)) / DAY;
  const priority = (knowledge === false ? 4 : 1) + Math.min(4, review?.lapses ?? 0)
    + Math.log1p(overdue);
  return { kind, dueAt, ready: dueAt <= now, priority,
    encountered: shows > 0 || typeof knowledge === 'boolean' || !!review };
}

export const canStudyWord = (word: Word, languages: string[], now = Date.now()) =>
  languages.length > 0 && languages.every(lang => !!getWordTranslation(word, lang)
    && !(Date.parse(word.snoozed_until_by_lang?.[lang] ?? '') > now));

export const studyFormKey = (word: Word, lang: string) =>
  JSON.stringify([lang, getWordTranslation(word, lang).normalize('NFC').toLowerCase().replace(/\s+/g, ' ')]);

export interface StudyCard { word: Word; langCode: string }
interface Candidate extends StudyCard {
  state: ReturnType<typeof wordStudyState>;
  key: string;
  forms: string[];
  jitter: number;
}

/** One shared selection policy for both word trainers. */
export function buildStudyQueue(options: {
  words: Word[]; languages: string[]; count: number;
  mode: 'words' | 'workout'; favoritesOnly?: boolean;
}, now = Date.now(), random = Math.random): StudyCard[] {
  const count = Math.max(0, Math.floor(options.count) || 0);
  const languages = [...new Set(options.languages)];
  const candidates: Candidate[] = [];
  for (const word of options.words) {
    if (!getWordKey(word) || options.favoritesOnly && !word.is_favorite) continue;
    if (options.mode === 'words' && !canStudyWord(word, languages, now)) continue;
    for (const langCode of languages) {
      if (!canStudyWord(word, [langCode], now)) continue;
      const state = wordStudyState(word, langCode, now);
      if (options.mode === 'words' && state.kind === 'known') continue;
      candidates.push({ word, langCode, state, jitter: random(), key: getWordKey(word),
        forms: (options.mode === 'words' ? languages : [langCode]).map(lang => studyFormKey(word, lang)) });
    }
  }

  const pickedWords = new Set<string>();
  const pickedForms = new Set<string>();
  const languageCounts = new Map<string, number>();
  const result: StudyCard[] = [];
  const bucketKey = (ready: boolean, kind: StudyKind, lang: string) => JSON.stringify([ready, kind, lang]);
  const buckets = new Map<string, { cards: Candidate[]; index: number }>();
  for (const candidate of candidates) {
    const key = bucketKey(candidate.state.ready, candidate.state.kind, candidate.langCode);
    if (!buckets.has(key)) buckets.set(key, { cards: [], index: 0 });
    buckets.get(key)!.cards.push(candidate);
  }
  // Sort each language/category once, then compare only their heads. Large
  // dictionaries must not be re-sorted for every card of a hundred-card tour.
  for (const bucket of buckets.values()) bucket.cards.sort((a, b) =>
    (!a.state.ready ? a.state.dueAt - b.state.dueAt : 0)
      || (b.state.priority + b.jitter) - (a.state.priority + a.jitter));
  const peek = (ready: boolean, kind: StudyKind): Candidate | undefined => {
    let best: Candidate | undefined;
    const score = (c: Candidate) => c.state.priority + c.jitter - (languageCounts.get(c.langCode) ?? 0) * 0.5;
    for (const lang of languages) {
      const bucket = buckets.get(bucketKey(ready, kind, lang));
      if (!bucket) continue;
      while (bucket.index < bucket.cards.length) {
        const card = bucket.cards[bucket.index];
        if (!pickedWords.has(card.key) && !card.forms.some(form => pickedForms.has(form))) break;
        bucket.index++;
      }
      const card = bucket.cards[bucket.index];
      if (card && (!best || (!ready && card.state.dueAt !== best.state.dueAt
        ? card.state.dueAt < best.state.dueAt : score(card) > score(best)))) best = card;
    }
    return best;
  };
  // Weak words get three opportunities out of five; new and known get one.
  // Missing categories lend their slots to others. Ready cards always precede cooling cards.
  const pattern: StudyKind[] = ['weak', 'weak', 'new', 'weak', 'known'];
  for (const ready of [true, false]) {
    let slot = 0;
    while (result.length < count) {
      const preferred = pattern[slot++ % pattern.length];
      const chosen = peek(ready, preferred) ?? peek(ready, 'weak') ?? peek(ready, 'new') ?? peek(ready, 'known');
      if (!chosen) break;
      pickedWords.add(chosen.key);
      chosen.forms.forEach(form => pickedForms.add(form));
      languageCounts.set(chosen.langCode, (languageCounts.get(chosen.langCode) ?? 0) + 1);
      result.push({ word: chosen.word, langCode: chosen.langCode });
    }
  }
  return result;
}
