import { SyntaxRole, Token } from '../models/types';

// Reveal / display order of sentence members (Papanda dialectical method).
export const ROLE_DISPLAY_ORDER: SyntaxRole[] = [
  'Predicate', 'Subject', 'Attribute', 'Attribute_Subject', 'Object',
  'Attribute_Object', 'Circumstance', 'Adverbial', 'Conjunction',
  'Preposition', 'Particle', 'Article', 'Other',
];

export interface TokenGroup {
  clauseIndex: number;
  role: SyntaxRole;
  tokenIndices: number[];
}

/**
 * Splits a sentence's tokens into clauses, then groups each clause's tokens by
 * syntactic role and orders the groups the way the trainer reveals them.
 *
 * Clause boundary rules:
 *  - a conjunction (that / because / және / бірақ …) after a subject or predicate;
 *  - a fresh subject once the current clause already has BOTH a subject and a predicate.
 * A run of consecutive Predicate tokens is ONE verb group ("did not support",
 * "will not buy") and never starts a new clause.
 */
export const computeSentenceGroups = (words: Token[] | undefined | null): TokenGroup[] => {
  if (!words || words.length === 0) return [];

  let currentClause = 0;
  let seenPredicate = false;
  let seenSubject = false;

  const withClause = words.map((word, originalIndex) => {
    if (word.role === 'Conjunction' && (seenPredicate || seenSubject)) {
      currentClause++;
      seenPredicate = false;
      seenSubject = false;
    } else if (word.role === 'Subject' && seenPredicate && seenSubject) {
      currentClause++;
      seenPredicate = false;
      seenSubject = false;
    }

    if (word.role === 'Predicate') seenPredicate = true;
    if (word.role === 'Subject') seenSubject = true;

    return { role: word.role, clauseIndex: currentClause, originalIndex };
  });

  const groupsMap = new Map<string, TokenGroup>();
  withClause.forEach(w => {
    const key = `${w.clauseIndex}-${w.role}`;
    if (!groupsMap.has(key)) {
      groupsMap.set(key, { clauseIndex: w.clauseIndex, role: w.role, tokenIndices: [] });
    }
    groupsMap.get(key)!.tokenIndices.push(w.originalIndex);
  });

  return Array.from(groupsMap.values()).sort((a, b) => {
    if (a.clauseIndex !== b.clauseIndex) return a.clauseIndex - b.clauseIndex;
    const ia = ROLE_DISPLAY_ORDER.indexOf(a.role);
    const ib = ROLE_DISPLAY_ORDER.indexOf(b.role);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
};
