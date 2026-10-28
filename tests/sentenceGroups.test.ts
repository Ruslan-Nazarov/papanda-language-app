import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeSentenceGroups, computeSentenceRevealGroups, tokenRevealIndices } from '../src/utils/sentenceGroups';
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

  it('reveals Italian articles with their heads, including across an adjective', () => {
    const words = [tok('La', 'Article'), tok('giovane', 'Attribute_Subject'), tok('donna', 'Subject'),
      tok('legge', 'Predicate'), tok('un', 'Article'), tok('libro', 'Object')];
    assert.deepEqual(computeSentenceRevealGroups(words).map(group => group.tokenIndices), [[3], [0, 2], [1], [4, 5]]);
    assert.deepEqual(tokenRevealIndices(words, 0), [0, 2]);
    assert.deepEqual(tokenRevealIndices(words, 2), [0, 2]);
    assert.deepEqual(tokenRevealIndices(words, 1), [1]);
    assert.deepEqual(tokenRevealIndices(words, 4), [4, 5]);
    assert.deepEqual(tokenRevealIndices(words, 5), [4, 5]);
  });

  it('keeps articles attached to a nominal predicate or a circumstance', () => {
    const words = [tok('È', 'Predicate'), tok('un', 'Article'), { ...tok('medico', 'Predicate'), label: 'Noun' },
      tok('in', 'Preposition'), tok('una', 'Article'), tok('clinica', 'Circumstance')];
    assert.deepEqual(computeSentenceRevealGroups(words).map(group => group.tokenIndices), [[0, 1, 2], [4, 5], [3]]);
    assert.deepEqual(tokenRevealIndices(words, 2), [1, 2]);
    assert.deepEqual(tokenRevealIndices(words, 0), [0]);
  });

  it('keeps article roles separate and includes every token exactly once', () => {
    const words = [tok('The', 'Article'), tok('girl', 'Subject'), tok('reads', 'Predicate'),
      tok('a', 'Article'), tok('book', 'Object'), tok('and', 'Conjunction'),
      tok('a', 'Article'), tok('letter', 'Object')];
    const groups = computeSentenceGroups(words);
    assert.deepEqual(groups.filter(group => group.role === 'Article').map(group => group.tokenIndices), [[0, 3, 6]]);
    assert.deepEqual(groups.flatMap(group => group.tokenIndices).sort((a, b) => a - b), words.map((_, i) => i));
    assert.ok(groups.every(group => group.tokenIndices.every(i => words[i].role === group.role)));
    assert.deepEqual(computeSentenceRevealGroups(words).map(group => group.tokenIndices), [[2], [0, 1], [3, 4, 6, 7], [5]]);
    assert.deepEqual(tokenRevealIndices(words, 4), [3, 4]);
    assert.deepEqual(tokenRevealIndices(words, 7), [6, 7]);
  });

  it('does not attach an article across an explicit clause boundary or a preposition', () => {
    const words = [tok('un', 'Article'), tok('legge', 'Predicate'), tok('il', 'Article'), tok('libro', 'Object')]
      .map((word, i) => ({ ...word, clauseIndex: i === 0 ? 0 : 1 }));
    assert.deepEqual(computeSentenceRevealGroups(words), [
      { clauseIndex: 0, role: 'Article', tokenIndices: [0] },
      { clauseIndex: 1, role: 'Predicate', tokenIndices: [1] },
      { clauseIndex: 1, role: 'Object', tokenIndices: [2, 3] },
    ]);
    const detached = [tok('un', 'Article'), tok('di', 'Preposition'), tok('legno', 'Object')];
    assert.deepEqual(order(detached), ['Object@0', 'Preposition@0', 'Article@0']);
    assert.deepEqual(tokenRevealIndices(detached, 0), [0]);
    assert.deepEqual(tokenRevealIndices(words, 0), [0]);
  });

  it('keeps Italian homographic object pronouns separate from predicates and articles', () => {
    for (const [pronoun, verb] of [['Lo', 'leggo'], ['La', 'vedo'], ['Gli', 'parlo'], ['Le', 'scrivo']]) {
      const words = [{ ...tok(pronoun, 'Object'), label: 'Pronoun' }, { ...tok(verb, 'Predicate'), label: 'Verb' }];
      assert.deepEqual(computeSentenceRevealGroups(words).map(group => group.tokenIndices), [[1], [0]]);
      assert.deepEqual(tokenRevealIndices(words, 0), [0]);
      assert.deepEqual(tokenRevealIndices(words, 1), [1]);
    }
    const words = [tok('La', 'Article'), tok('ragazza', 'Subject'),
      { ...tok('la', 'Object'), label: 'Pronoun' }, { ...tok('vede', 'Predicate'), label: 'Verb' }];
    assert.deepEqual(computeSentenceRevealGroups(words).map(group => group.tokenIndices), [[3], [0, 1], [2]]);
    // An unreliable cached Article label must not attach a pronoun to a verb.
    words[2].role = 'Article';
    assert.deepEqual(tokenRevealIndices(words, 2), [2]);
  });
});

it('does not mistake coordinated nouns for clauses in legacy annotations', () => {
  for (const words of [
    [tok('Anna', 'Subject'), tok('and', 'Conjunction'), tok('Tom', 'Subject'), tok('work', 'Predicate')],
    [tok('Does', 'Predicate'), tok('Anna', 'Subject'), tok('and', 'Conjunction'), tok('Tom', 'Subject'), tok('work', 'Predicate')].map(word => ({ ...word, clauseIndex: 0 })),
  ]) assert.ok(computeSentenceGroups(words).every(group => group.clauseIndex === 0));
});
it('groups an interrupted main clause explicitly and reveals its predicate first', () => {
  const words = [tok('The', 'Article'), tok('man', 'Subject'), tok('who', 'Subject'), tok('called', 'Predicate'), tok('left', 'Predicate')]
    .map((word, i) => ({ ...word, clauseIndex: i === 2 || i === 3 ? 1 : 0 }));
  const groups = computeSentenceGroups(words);
  assert.deepEqual(groups[0], { clauseIndex: 0, role: 'Predicate', tokenIndices: [4] });
  assert.deepEqual(groups.find(group => group.clauseIndex === 1 && group.role === 'Predicate')?.tokenIndices, [3]);
});
