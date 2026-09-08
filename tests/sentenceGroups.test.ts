import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeSentenceGroups } from '../src/utils/sentenceGroups';
import { SyntaxRole, Token } from '../src/models/types';

const tok = (text: string, role: SyntaxRole): Token => ({
  text, role, label: role, parts: [text], translation: '', is_in_my_dict: false,
});

// Returns the reveal order as "role@clause" strings.
const order = (words: Token[]) =>
  computeSentenceGroups(words).map(g => `${g.role}@${g.clauseIndex}`);

describe('computeSentenceGroups', () => {
  it('keeps a multi-word verb group as ONE predicate group in one clause', () => {
    // "The poor guide did not support that industry."
    const words = [
      tok('The', 'Article'),
      tok('poor', 'Attribute_Subject'),
      tok('guide', 'Subject'),
      tok('did', 'Predicate'),
      tok('not', 'Predicate'),
      tok('support', 'Predicate'),
      tok('that', 'Attribute_Object'),
      tok('industry', 'Object'),
    ];
    const groups = computeSentenceGroups(words);
    // every clauseIndex is 0
    assert.ok(groups.every(g => g.clauseIndex === 0));
    // did / not / support are the same group
    const predicate = groups.find(g => g.role === 'Predicate')!;
    assert.deepStrictEqual(predicate.tokenIndices, [3, 4, 5]);
    // revealed predicate-first
    assert.deepStrictEqual(order(words)[0], 'Predicate@0');
  });

  it('does not split an English question ("Does the farmer grow corn?")', () => {
    const words = [
      tok('Does', 'Predicate'),
      tok('the', 'Article'),
      tok('farmer', 'Subject'),
      tok('grow', 'Predicate'),
      tok('corn', 'Object'),
    ];
    assert.ok(computeSentenceGroups(words).every(g => g.clauseIndex === 0));
  });

  it('splits into two clauses on a conjunction', () => {
    // "Қыз итті көрді және ұл кітапты оқыды."
    const words = [
      tok('Қыз', 'Subject'),
      tok('итті', 'Object'),
      tok('көрді', 'Predicate'),
      tok('және', 'Conjunction'),
      tok('ұл', 'Subject'),
      tok('кітапты', 'Object'),
      tok('оқыды', 'Predicate'),
    ];
    const groups = computeSentenceGroups(words);
    const maxClause = Math.max(...groups.map(g => g.clauseIndex));
    assert.strictEqual(maxClause, 1);
    assert.strictEqual(groups.find(g => g.tokenIndices.includes(6))!.clauseIndex, 1);
  });

  it('orders groups predicate → subject → attribute → object within a clause', () => {
    const words = [
      tok('The', 'Article'),
      tok('cat', 'Subject'),
      tok('drinks', 'Predicate'),
      tok('milk', 'Object'),
    ];
    assert.deepStrictEqual(order(words), ['Predicate@0', 'Subject@0', 'Object@0', 'Article@0']);
  });
});
