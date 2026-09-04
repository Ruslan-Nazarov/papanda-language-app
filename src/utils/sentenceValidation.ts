import { Sentence, SyntaxRole, Token } from '../models/types';
import { DictionaryCandidate, makeGeneratedSentence } from '../services/sentencePrompts';

const VALID_ROLES = new Set<SyntaxRole>([
  'Predicate', 'Subject', 'Attribute', 'Attribute_Subject', 'Object',
  'Attribute_Object', 'Circumstance', 'Adverbial', 'Conjunction',
  'Preposition', 'Particle', 'Article', 'Other'
]);

const ROLE_ALIASES: Record<string, SyntaxRole> = {
  Verb: 'Predicate',
  Noun: 'Subject',
  Pronoun: 'Subject',
  Adjective: 'Attribute',
  Adverb: 'Adverbial',
  Circumstantial: 'Circumstance'
};

const normalize = (value: string) => value.trim().toLocaleLowerCase();

export interface ValidationResult {
  sentences: Sentence[];
  errors: string[];
}

export const validateGeneratedSentences = (
  value: unknown,
  languageCode: string,
  languageLabel: string,
  dictionary: DictionaryCandidate[]
): ValidationResult => {
  if (!Array.isArray(value)) return { sentences: [], errors: ['ИИ вернул данные не в виде массива.'] };

  const dictionaryMap = new Map<string, string>();
  dictionary.forEach(item => {
    dictionaryMap.set(normalize(item.lemma), item.lemma);
  });

  const errors: string[] = [];
  const valid: Sentence[] = [];

  value.forEach((candidate, index) => {
    const data = candidate as Partial<Sentence>;
    if (!data || typeof data.sentence !== 'string' || !Array.isArray(data.words) || data.words.length === 0) {
      errors.push(`Предложение ${index + 1}: отсутствуют sentence или words.`);
      return;
    }

    const rawTokens = data.words as Partial<Token>[];
    const sanitizedTokens: Token[] = [];
    let dictionaryTokenCount = 0;

    for (const raw of rawTokens) {
      if (!raw || typeof raw.text !== 'string') continue;
      // The contract forbids punctuation in token.text, but models sometimes emit a
      // stray "," or "." token, or glue sentence punctuation to a word. Strip the
      // sentence punctuation (keep apostrophes and hyphens — they belong to tokens
      // like French "n'" or compound words).
      const text = raw.text.trim().replace(/^[.,;:!?"«»„“”()]+|[.,;:!?"«»„“”()]+$/gu, '').trim();
      if (!text) continue;

      const label = (typeof raw.label === 'string' && raw.label.trim()) || text;
      
      let role: SyntaxRole = 'Other';
      if (raw.role && VALID_ROLES.has(raw.role as SyntaxRole)) {
        role = raw.role as SyntaxRole;
      } else if (raw.role && ROLE_ALIASES[raw.role]) {
        role = ROLE_ALIASES[raw.role];
      }

      // Check morpheme breakdown integrity
      let parts: string[] = [text];
      if (Array.isArray(raw.parts) && raw.parts.length > 0 && raw.parts.every(p => typeof p === 'string' && p.trim())) {
        const rebuilt = raw.parts.join('').replace(/[\s-]/g, '');
        if (normalize(rebuilt) === normalize(text.replace(/[\s-]/g, ''))) {
          parts = raw.parts;
        }
      }

      const dictForm = (typeof raw.dictionary_form === 'string' && raw.dictionary_form.trim()) || label;
      const rawDictWord = typeof raw.dictionary_word === 'string' ? raw.dictionary_word.trim() : null;

      let isInDict = Boolean(raw.is_in_my_dict);
      let matchedLemma: string | null = null;

      // Try matching dictionary lemma by dictionary_word, dictionary_form, or text
      if (rawDictWord && dictionaryMap.has(normalize(rawDictWord))) {
        matchedLemma = dictionaryMap.get(normalize(rawDictWord)) || rawDictWord;
      } else if (dictForm && dictionaryMap.has(normalize(dictForm))) {
        matchedLemma = dictionaryMap.get(normalize(dictForm)) || dictForm;
      } else if (dictionaryMap.has(normalize(text))) {
        matchedLemma = dictionaryMap.get(normalize(text)) || text;
      }

      if (matchedLemma) {
        isInDict = true;
        dictionaryTokenCount++;
      } else {
        isInDict = false;
        matchedLemma = null;
      }

      sanitizedTokens.push({
        text,
        label,
        role,
        parts,
        translation: typeof raw.translation === 'string' ? raw.translation : '',
        is_in_my_dict: isInDict,
        dictionary_word: matchedLemma,
        dictionary_form: dictForm
      });
    }

    if (sanitizedTokens.length === 0) {
      errors.push(`Предложение ${index + 1}: не удалось распознать токены.`);
      return;
    }

    // Structural floor: the trainer analyses members of a sentence, so a fragment
    // like "Адам айтады." (subject + verb, nothing else) is not worth showing.
    const hasPredicate = sanitizedTokens.some(token => token.role === 'Predicate');
    if (!hasPredicate) {
      errors.push(`Предложение ${index + 1}: нет сказуемого.`);
      return;
    }
    if (sanitizedTokens.length < 4) {
      errors.push(`Предложение ${index + 1}: слишком короткое (${sanitizedTokens.length} сл.).`);
      return;
    }
    if (dictionaryTokenCount < 2) {
      errors.push(`Предложение ${index + 1}: менее двух слов из словаря.`);
      return;
    }

    valid.push(
      makeGeneratedSentence(
        {
          language: languageLabel,
          sentence: data.sentence.trim(),
          words: sanitizedTokens
        },
        languageCode,
        index
      )
    );
  });

  return { sentences: valid, errors };
};
