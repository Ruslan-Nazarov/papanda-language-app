import { performance } from 'node:perf_hooks';
import { baseStaticWords, baseStaticSentences } from '../src/store/catalog';
import { getAllDictionaryCandidates } from '../src/services/sentencePrompts';
import { validateGeneratedSentences } from '../src/utils/sentenceValidation';

// Offline CPU benchmark: eight of the longest built-in English cards, full dictionary.
const dictionary = getAllDictionaryCandidates(baseStaticWords, 'en');
const cards = baseStaticSentences.filter(card => card.language === 'English')
  .sort((a, b) => b.words.length - a.words.length).slice(0, 8);
console.log({ dictionary: dictionary.length, tokens: cards.reduce((sum, card) => sum + card.words.length, 0) });
for (let run = 0; run < 5; run++) {
  const start = performance.now();
  const result = validateGeneratedSentences(cards, 'en', 'English', dictionary);
  if (result.sentences.length !== cards.length) throw new Error(result.errors.join('\n'));
  console.log(`Validation: ${(performance.now() - start).toFixed(1)} ms`);
}
