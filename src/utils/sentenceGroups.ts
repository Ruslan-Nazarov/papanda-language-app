import { SyntaxRole, Token } from '../models/types';

// Reveal / display order of sentence members (Papanda dialectical method).
export const ROLE_DISPLAY_ORDER: SyntaxRole[] = [
  'Predicate', 'Subject', 'Attribute', 'Attribute_Subject', 'Object',
  'Attribute_Object', 'Circumstance', 'Adverbial', 'Conjunction',
  'Preposition', 'Particle', 'Article', 'Other',
];

const MODIFIERS = new Set<SyntaxRole>(['Attribute', 'Attribute_Subject', 'Attribute_Object']);
const ARTICLE_HEADS = new Set<SyntaxRole>(['Predicate', 'Subject', 'Object', 'Circumstance', 'Adverbial']);

export interface TokenGroup {
  clauseIndex: number;
  role: SyntaxRole;
  tokenIndices: number[];
}

/**
 * Splits a sentence's tokens into clauses, then groups each clause's tokens by
 * syntactic role and orders the groups the way the trainer reveals them.
 * Roles remain separate here for the independent structure exercise.
 * The trainer uses computeSentenceRevealGroups to reveal articles with heads.
 *
 * New annotations carry explicit clause IDs, including interrupted main clauses.
 * Legacy data uses a conservative heuristic: only split at a conjunction when
 * complete subject/predicate bases can be found on both sides.
 * A run of consecutive Predicate tokens is ONE verb group ("did not support",
 * "will not buy") and never starts a new clause.
 */
const clauseTokens = (words: Token[]) => {
  let currentClause = 0;
  let seenPredicate = false;
  let seenSubject = false;
  const hasExplicitClauses = words.every(word => Number.isSafeInteger(word.clauseIndex) && word.clauseIndex! >= 0);

  return words.map((word, originalIndex) => {
    if (hasExplicitClauses) return { role: word.role, clauseIndex: word.clauseIndex!, originalIndex };
    const rest = words.slice(originalIndex + 1);
    if (word.role === 'Conjunction' && seenPredicate && seenSubject &&
      rest.some(token => token.role === 'Subject') && rest.some(token => token.role === 'Predicate')) {
      currentClause++;
      seenPredicate = false;
      seenSubject = false;
    }

    if (word.role === 'Predicate') seenPredicate = true;
    if (word.role === 'Subject') seenSubject = true;

    return { role: word.role, clauseIndex: currentClause, originalIndex };
  });

};

const articleHeads = (words: Token[], withClause: ReturnType<typeof clauseTokens>) => {
  const heads = new Map<number, number>();
  withClause.forEach((word, index) => {
    if (word.role !== 'Article') return;
    // Look past prenominal modifiers, but never past a clause boundary or
    // another function word. Unknown attachments keep the fallback order.
    const head = withClause.slice(index + 1).find(next =>
      next.clauseIndex !== word.clauseIndex || !MODIFIERS.has(next.role));
    if (head?.clauseIndex === word.clauseIndex && ARTICLE_HEADS.has(head.role) &&
      (head.role !== 'Predicate' || /^(Noun|Adjective)$/iu.test(words[head.originalIndex].label))) {
      heads.set(index, head.originalIndex);
    }
  });
  return heads;
};

const buildGroups = (words: Token[] | undefined | null, reveal: boolean): TokenGroup[] => {
  if (!words?.length) return [];
  const withClause = clauseTokens(words);
  const heads = reveal ? articleHeads(words, withClause) : new Map<number, number>();

  const groupsMap = new Map<string, TokenGroup>();
  withClause.forEach(w => {
    const head = heads.get(w.originalIndex);
    const role = head === undefined ? w.role : words[head].role;
    const key = `${w.clauseIndex}-${role}`;
    if (!groupsMap.has(key)) {
      groupsMap.set(key, { clauseIndex: w.clauseIndex, role, tokenIndices: [] });
    }
    groupsMap.get(key)!.tokenIndices.push(w.originalIndex);
  });

  const rank = (group: TokenGroup) => {
    const index = ROLE_DISPLAY_ORDER.indexOf(group.role);
    return index === -1 ? 99 : index;
  };

  return Array.from(groupsMap.values()).sort((a, b) => {
    if (a.clauseIndex !== b.clauseIndex) return a.clauseIndex - b.clauseIndex;
    return rank(a) - rank(b);
  });
};

export const computeSentenceGroups = (words: Token[] | undefined | null): TokenGroup[] => buildGroups(words, false);

/** Reveal steps may contain articles; individual tokens keep their own roles. */
export const computeSentenceRevealGroups = (words: Token[] | undefined | null): TokenGroup[] => buildGroups(words, true);

/** A manual tap opens only this word and its articles, or the article and its head. */
export const tokenRevealIndices = (words: Token[], index: number): number[] => {
  const heads = articleHeads(words, clauseTokens(words));
  const head = heads.get(index) ?? index;
  return [head, ...[...heads].filter(([, linkedHead]) => linkedHead === head).map(([article]) => article)]
    .sort((a, b) => a - b);
};
