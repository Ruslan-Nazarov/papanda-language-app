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
export function wordStudyState(word: Word, lang: string, now = Date.now(), mode: 'words' | 'workout' = 'workout') {
  const knowledge = readWordStats(word.knowledge_stats)[lang];
  const shows = Number(readWordStats(word.show_stats)[lang]) || 0;
  const review = word.review_by_lang?.[lang];
  const last = Date.parse(getWordLastShown(word, lang) ?? '');
  const kind: StudyKind = knowledge === true ? 'known' : knowledge === false || shows > 0 ? 'weak' : 'new';
  // Old backups have no answer schedule: use a conservative fixed interval,
  // never the number of passive exposures as evidence of successful recall.
  const scheduledDue = review ? Date.parse(review.dueAt) : !Number.isFinite(last) ? 0
    : last + (knowledge === true ? 3 * DAY : knowledge === false ? FAILURE_DELAY : DAY);

  // Recency cooldown: a word shown recently cannot immediately repeat in the next tour or workout.
  // In 'words' mode (vocabulary discovery), already shown words cool down for DAY so unshown words take precedence.
  // In 'workout' mode, words just tested cool down for at least FAILURE_DELAY.
  const cooldown = mode === 'words' ? DAY : FAILURE_DELAY;
  const dueAt = Number.isFinite(last) ? Math.max(scheduledDue, last + cooldown) : scheduledDue;

  const overdue = Math.max(0, now - (scheduledDue || now)) / DAY;

  // Maximum variety:
  // - High exposures reduce priority so heavily shown words step aside for unshown or less-shown words.
  // - Lapses / "не знаю" MUST NOT inflate priority (that previously caused failed words to be shoved constantly).
  // - Modest boost for overdue retention decay.
  const priority = 1 + Math.log1p(overdue) - Math.min(3, shows * 0.3);

  return {
    kind,
    dueAt,
    ready: dueAt <= now,
    priority,
    shows,
    encountered: shows > 0 || typeof knowledge === 'boolean' || !!review,
  };
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
      const state = wordStudyState(word, langCode, now, options.mode);
      if (options.mode === 'words' && !options.favoritesOnly && state.kind === 'known') continue;
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
  // Sort each language/category once, then compare only their heads.
  // Prioritize readiness, then lowest exposures (maximum variety), then priority & jitter.
  for (const bucket of buckets.values()) bucket.cards.sort((a, b) =>
    (!a.state.ready ? a.state.dueAt - b.state.dueAt : 0)
      || (a.state.shows - b.state.shows)
      || ((a.word.count ?? 0) - (b.word.count ?? 0))
      || ((b.state.priority + b.jitter) - (a.state.priority + a.jitter)));
  const peek = (ready: boolean, kind: StudyKind): Candidate | undefined => {
    let best: Candidate | undefined;
    const score = (c: Candidate) =>
      c.state.priority + c.jitter - c.state.shows * 0.5 - (languageCounts.get(c.langCode) ?? 0) * 0.5;
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

  // Selection pattern tailored for maximum variety:
  // - In 'words' mode (vocabulary discovery), the priority is unshown words ('new') so that
  //   the user explores the entire dictionary with maximum variety. Once unshown words are
  //   exhausted, it falls back to 'weak' sorted by fewest exposures.
  // - In 'workout' mode, balances review, known maintenance, and new introductions.
  const pattern: StudyKind[] = options.mode === 'words'
    ? (options.favoritesOnly ? ['new', 'weak', 'known'] : ['new'])
    : ['weak', 'known', 'new', 'weak', 'known'];
  const fallbackOrder: StudyKind[] = options.mode === 'words'
    ? (options.favoritesOnly ? ['new', 'weak', 'known'] : ['new', 'weak'])
    : ['weak', 'known', 'new'];

  const resolveCard = (ready: boolean, preferred: StudyKind): Candidate | undefined => {
    const direct = peek(ready, preferred);
    if (direct) return direct;
    for (const alt of fallbackOrder) {
      if (alt !== preferred) {
        const candidate = peek(ready, alt);
        if (candidate) return candidate;
      }
    }
    return undefined;
  };

  for (const ready of [true, false]) {
    let slot = 0;
    while (result.length < count) {
      const preferred = pattern[slot++ % pattern.length];
      const chosen = resolveCard(ready, preferred);
      if (!chosen) break;
      pickedWords.add(chosen.key);
      chosen.forms.forEach(form => pickedForms.add(form));
      languageCounts.set(chosen.langCode, (languageCounts.get(chosen.langCode) ?? 0) + 1);
      result.push({ word: chosen.word, langCode: chosen.langCode });
    }
  }
  return result;
}
