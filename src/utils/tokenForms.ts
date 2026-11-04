import type { Token } from '../models/types';

const lower = (text: string) => text.normalize('NFC').toLocaleLowerCase();
const OPAQUE_ENGLISH = new Set(['does', 'did', 'has', 'had', 'is', 'was', 'were', 'are', 'am', 'have', 'went', 'children', 'men', 'women', 'feet', 'teeth', 'mice']);
// Reviewed repairs also cover old cards whose lemma is missing or is the inflected word.
const REVIEWED: Record<string, Record<string, string[]>> = {
  kz: { балалар: ['бала', 'лар'], киімдер: ['киім', 'дер'] },
  en: { stopped: ['stopp', 'ed'] },
  de: { neues: ['neu', 'es'] },
  la: { legit: ['leg', 'it'], dormit: ['dorm', 'it'], librum: ['libr', 'um'], bonum: ['bon', 'um'], parvus: ['parv', 'us'], domi: ['dom', 'i'] },
};

/** Limited, lemma-anchored recovery, not a suffix-only morphological guesser. */
function recoverParts(word: string, lemma: string, code: string): string[] | undefined {
  if (!lemma || word === lemma) return;
  if (code === 'kz') {
    // Nouns: plural → possession → case. Allow only the regular final-consonant
    // alternation; vowel loss and ambiguous/unknown stems need authored parts.
    const stems = [lemma, lemma.replace(/қ$/u, 'ғ').replace(/к$/u, 'г').replace(/п$/u, 'б')];
    for (const stem of stems) {
      if (!word.startsWith(stem)) continue;
      const suffixes = word.slice(stem.length).match(/^(лар|лер|дар|дер|тар|тер)?(ымыз|іміз|ыңыз|іңіз|мыз|міз|ңыз|ңіз|ым|ім|ың|ің|сы|сі|ы|і|м|ң)?(ның|нің|дың|дің|тың|тің|нан|нен|дан|ден|тан|тен|мен|бен|пен|нда|нде|ға|ге|қа|ке|на|не|ны|ні|ды|ді|ты|ті|да|де|та|те|н)?$/u);
      if (suffixes && suffixes[0]) return [stem, ...suffixes.slice(1).filter(Boolean)];
    }
    // Verbs: infinitive ending in -у/-ю. Recover past (жедел өткен шақ) and
    // present-future (ауыспалы) tense inflections, keeping vowel stems intact.
    if ((lemma.endsWith('у') || lemma.endsWith('ю')) && lemma.length > 2) {
      const verbStems = [lemma.slice(0, -1)];
      if (lemma === 'оқу') verbStems.push('оқы');
      if (lemma.endsWith('ю')) verbStems.push(lemma.slice(0, -1) + 'й');
      for (const stem of verbStems) {
        if (!word.startsWith(stem)) continue;
        const remainder = word.slice(stem.length);
        const past = remainder.match(/^(ба|бе|па|пе|ма|ме)?(ды|ді|ты|ті)(ңыздар|ңіздер|ңдар|ңдер|ңыз|ңіз|лар|лер|дар|дер|тар|тер|м|ң|қ|к)?$/u);
        if (past && past[0] === remainder) return [stem, ...past.slice(1).filter(Boolean)];
        const pres = remainder.match(/^(й|а|е)(ды|ді)(мыз|міз|сыздар|сіздер|сыз|сіз)?$/u);
        if (pres && pres[0] === remainder) return [stem, ...pres.slice(1).filter(Boolean)];
      }
    }
  }
  if (code === 'en') {
    for (const ending of ['s', 'es', 'ed', 'ing', 'er', 'est', "'s", '’s']) {
      const stems = [lemma];
      if (['es', 'ed', 'er', 'est'].includes(ending) && /[^aeiou]y$/u.test(lemma)) stems.push(lemma.slice(0, -1) + 'i');
      if (['ed', 'ing', 'er', 'est'].includes(ending)) {
        if (lemma.endsWith('e')) stems.push(lemma.slice(0, -1));
        if (/[aeiou][bcdfgklmnprst]$/u.test(lemma)) stems.push(lemma + lemma.slice(-1));
      }
      const stem = stems.find(stem => word === stem + ending);
      if (stem) return [stem, ending];
    }
  }
  if (['es', 'fr'].includes(code)) {
    for (const ending of code === 'es' ? ['s', 'es'] : ['s', 'x']) {
      if (word === lemma + ending) return [lemma, ending];
    }
  }
  if (code === 'it') {
    if (/[aoe]$/u.test(lemma) && word.length === lemma.length &&
        word.slice(0, -1) === lemma.slice(0, -1) && /[ie]$/u.test(word)) return [word.slice(0, -1), word.slice(-1)];
    if (lemma.endsWith('are') && lemma.length > 4) {
      const stem = lemma.slice(0, -3);
      if (word.startsWith(stem)) {
        const ending = word.slice(stem.length);
        if (['o', 'i', 'a', 'iamo', 'ate', 'ano', 'ato', 'ata', 'ati', 'ate', 'ava', 'avano'].includes(ending)) {
          return [stem, ending];
        }
      }
    }
  }
  if (code === 'de' && lemma.endsWith('en')) {
    const stem = lemma.slice(0, -2);
    if (word === 'ge' + stem + 't') return ['ge', stem, 't'];
  }
}

/** Always reproduce the actual token, including case and punctuation. Never
 * render stale parts instead of the word. Used for cached/manual and new cards. */
export function getTokenFormParts(token: Token, code: string): string[] {
  const text = token.text;
  const match = text.match(/^([^\p{L}\p{N}]*)(.*?[\p{L}\p{N}])([^\p{L}\p{N}]*)$/u);
  if (!match) return [text];
  const [, before, core, after] = match;
  const word = lower(core);
  if (code === 'en' && OPAQUE_ENGLISH.has(word)) return [text];
  const lemma = lower(token.dictionary_form || token.dictionary_word || '');
  let parts: string[] | undefined = REVIEWED[code]?.[word];
  // A split chain can still hide plural + possessive inside its first part.
  // Prefer an anchored, complete noun chain over such a partial annotation.
  if (!parts && code === 'kz') parts = recoverParts(word, lemma, code);
  if (!parts && token.parts?.length && token.parts.every(p => typeof p === 'string' && p.length > 0) &&
      lower(token.parts.join('')) === lower(text)) {
    let offset = 0;
    parts = token.parts.map(part => { const value = text.slice(offset, offset + part.length); offset += part.length; return value; });
    if (parts.join('') === text && parts.length > 1) return parts;
  }
  parts = parts && parts.length > 1 ? parts : recoverParts(word, lemma, code);
  if (!parts || parts.join('') !== word) return [text];
  let offset = 0;
  const surfaceParts = parts.map(part => { const value = core.slice(offset, offset + part.length); offset += part.length; return value; });
  surfaceParts[0] = before + surfaceParts[0];
  surfaceParts[surfaceParts.length - 1] += after;
  return surfaceParts.join('') === text ? surfaceParts : [text];
}

export function getTokenFormSegments(token: Token, code: string): { text: string; affixIndex: number | null }[] {
  const parts = getTokenFormParts(token, code);
  // German participles can have a prefix before the stem, including ein-ge-kauf-t.
  const ge = code === 'de' ? parts.findIndex(part => lower(part).replace(/^[^\p{L}\p{N}]+/u, '') === 'ge') : -1;
  const root = ge >= 0 && ge + 1 < parts.length - 1 ? ge + 1 : 0;
  let affixIndex = 0;
  return parts.map((text, index) => ({ text, affixIndex: index === root ? null : affixIndex++ }));
}
