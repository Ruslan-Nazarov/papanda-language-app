import { Sentence, SyntaxRole, Token } from '../models/types';
import type { DictionaryCandidate } from '../services/sentencePrompts';
import type { SentenceDraft, SentenceTask } from '../services/sentenceCurriculum';
import { makeGeneratedSentence } from './sentences';
import { abortableDelay } from '../services/generationControl';

const VALID_ROLES = new Set<SyntaxRole>(['Predicate', 'Subject', 'Attribute', 'Attribute_Subject', 'Object',
  'Attribute_Object', 'Circumstance', 'Adverbial', 'Conjunction', 'Preposition', 'Particle', 'Article', 'Other']);
const surface = (value: string) => value.normalize('NFC').replace(/[’‘]/gu, "'");
const normalize = (value: string) => surface(value).trim().toLocaleLowerCase().replace(/\s+/g, ' ');
const edgePunctuation = /^[.,;:!?¿¡"«»„“”()…—–]+|[.,;:!?¿¡"«»„“”()…—–]+$/gu;
const separator = /[\s.,;:!?¿¡"«»„“”()…—–]/u;
const OPAQUE_ENGLISH_FORMS = new Set(['does', 'did', 'has', 'had', 'is', 'was', 'were', 'are', 'am', 'have']);

export const sentenceFingerprint = (label: string, text: string): string =>
  `${normalize(label)}:${normalize(text).replace(/[.,;:!?¿¡"«»„“”()]/gu, '').replace(/\s+/g, ' ').trim()}${text.includes('?') ? '?' : ''}`;

/** Compare surface spans, retaining word boundaries, apostrophes and hyphens.
 * Unlike stripping all whitespace, this cannot equate "a part" with "apart".
 */
export const tokensMatchSentence = (sentence: string, tokens: Pick<Token, 'text'>[]): boolean => {
  const source = surface(sentence);
  let cursor = 0;
  for (const token of tokens) {
    const text = surface(token.text);
    // Manual tokens retain punctuation; AI tokens normally omit it. Do not
    // skip an opening quote or ¿ when it is already part of the next token.
    while (cursor < source.length && separator.test(source[cursor]) && !source.startsWith(text, cursor)) cursor++;
    if (!text || /\s/u.test(text) || !source.startsWith(text, cursor)) return false;
    cursor += text.length;
    if (cursor < source.length && !separator.test(source[cursor]) && !text.endsWith("'")) return false;
  }
  while (cursor < source.length && separator.test(source[cursor])) cursor++;
  return cursor === source.length;
};

/** Match a headword or expression against actual surface/lemma sequences, not a
 * model's unverified dictionary_word reference. Lemma correctness needs review.
 */
export const findLemmaSpans = (tokens: Token[], lemma: string): number[][] => {
  const wanted = normalize(lemma).split(' ');
  const spans: number[][] = [];
  for (let i = 0; i <= tokens.length - wanted.length; i++) {
    if (wanted.every((part, j) => [tokens[i + j].text, tokens[i + j].dictionary_form || ''].some(form => normalize(form) === part))) {
      spans.push(wanted.map((_, j) => i + j));
    }
  }
  return spans;
};
export const findLemmaSpan = (tokens: Token[], lemma: string): number[] => findLemmaSpans(tokens, lemma)[0] || [];

/** A development may add detail, but cannot silently replace the participants
 * or predicate. This checks lexical continuity, not naturalness or grammar.
 * Keep the predicate's written form (tense/polarity) and all earlier details.
 * Compare other members by lemma to allow case changes in an expansion.
 */
export const preservesSentenceBasis = (base: Sentence, developed: Sentence): boolean => {
  for (const role of ['Subject', 'Predicate'] as const) {
    const identity = (word: Token) => normalize(role === 'Predicate' ? word.text : word.dictionary_form || word.text);
    const before = base.words.filter(word => word.role === role).map(identity);
    const after = developed.words.filter(word => word.role === role).map(identity);
    if (before.length !== after.length || before.some((lemma, index) => lemma !== after[index])) return false;
  }
  // A written predicate can keep its lemma and inflection while its sense
  // changes with a newly added complement (submit = yield vs file a document).
  // The Russian gloss supplied for the predicate is an inexpensive meaning
  // anchor; the later independent audit checks that both glosses are faithful.
  const predicateMeaning = (sentence: Sentence) => sentence.words.filter(word => word.role === 'Predicate')
    .map(word => normalize(word.translation)).join(' ');
  if (predicateMeaning(base) !== predicateMeaning(developed)) return false;
  const detailRoles = new Set<SyntaxRole>(['Attribute', 'Attribute_Subject', 'Attribute_Object', 'Object', 'Circumstance', 'Adverbial', 'Particle']);
  const detailKey = (word: Token) => `${word.role === 'Adverbial' ? 'Circumstance' : word.role}:${normalize(word.dictionary_form || word.text)}`;
  const remaining = developed.words.filter(word => detailRoles.has(word.role)).map(detailKey);
  for (const word of base.words.filter(word => detailRoles.has(word.role))) {
    const index = remaining.indexOf(detailKey(word));
    if (index < 0) return false;
    remaining.splice(index, 1);
  }
  return true;
};

export interface ValidationResult { sentences: Sentence[]; errors: string[] }
export interface GenerationValidationContext { tasks: SentenceTask[]; drafts: SentenceDraft[]; requiredWord?: string }

interface IndexedHeadword { lemma: string; parts: string[]; order: number }
type DictionaryIndex = Map<string, IndexedHeadword[]>;

const indexDictionary = (dictionary: DictionaryCandidate[]): DictionaryIndex => {
  const index: DictionaryIndex = new Map();
  dictionary.forEach((entry, order) => {
    const parts = normalize(entry.lemma).split(' ');
    if (!parts[0]) return;
    const headwords = index.get(parts[0]) ?? [];
    headwords.push({ lemma: entry.lemma, parts, order });
    index.set(parts[0], headwords);
  });
  return index;
};

// Normalize each token once and inspect only headwords beginning with its form
// or lemma. Sorting the actual matches preserves longest-expression priority,
// dictionary order for ties, and every occurrence of an inflected expression.
const markDictionaryWords = (tokens: Token[], dictionary: DictionaryIndex) => {
  const forms = tokens.map(token => new Set([normalize(token.text), normalize(token.dictionary_form || '')]));
  const matches: { entry: IndexedHeadword; start: number }[] = [];
  forms.forEach((alternatives, start) => {
    for (const form of alternatives) {
      for (const entry of dictionary.get(form) ?? []) {
        if (start + entry.parts.length <= tokens.length && entry.parts.every((part, offset) => forms[start + offset].has(part))) {
          matches.push({ entry, start });
        }
      }
    }
  });
  matches.sort((a, b) => b.entry.parts.length - a.entry.parts.length || a.entry.order - b.entry.order || a.start - b.start);
  for (const { entry, start } of matches) {
    for (let offset = 0; offset < entry.parts.length; offset++) {
      const token = tokens[start + offset];
      if (!token.is_in_my_dict) { token.is_in_my_dict = true; token.dictionary_word = entry.lemma; }
    }
  }
};

const validateWithDictionaryIndex = (
  value: unknown, code: string, label: string, dictionary: DictionaryIndex, context?: GenerationValidationContext,
  acceptedTasks = new Set<string>(), indexOffset = 0,
): ValidationResult => {
  if (!Array.isArray(value)) return { sentences: [], errors: ['ИИ вернул данные не в виде массива.'] };
  const sentences: Sentence[] = [];
  const errors: string[] = [];
  for (const [index, candidate] of value.entries()) {
    const fail = (reason: string) => errors.push(`Предложение ${indexOffset + index + 1}: ${reason}`);
    if (!candidate || typeof candidate !== 'object' || typeof candidate.sentence !== 'string' ||
      !candidate.sentence.trim() || !Array.isArray(candidate.words) || !candidate.words.length) {
      fail('отсутствуют sentence или words.'); continue;
    }
    const task = context?.tasks.find(item => item.id === candidate.taskId);
    if (context) {
      const draft = context.drafts.find(item => item.taskId === candidate.taskId);
      if (!task || !draft || draft.sentence !== candidate.sentence || acceptedTasks.has(task.id)) {
        fail('разбор не соответствует исходному заданию или тексту.'); continue;
      }
      if (candidate.review?.natural !== true || candidate.review?.taskFit !== true || candidate.review?.analysisReliable !== true) {
        fail(`${task.id}: фраза не прошла проверку естественности, задания или разбора.`); continue;
      }
      if (typeof candidate.literalTranslation !== 'string' || !candidate.literalTranslation.trim()) {
        fail(`${task.id}: отсутствует дословный перевод предложения.`); continue;
      }
    }
    const tokens: Token[] = [];
    let invalid = false;
    for (const raw of candidate.words) {
      if (!raw || typeof raw.text !== 'string' || !VALID_ROLES.has(raw.role)) { invalid = true; break; }
      const text = raw.text.trim().replace(edgePunctuation, '');
      if (!text || typeof raw.translation !== 'string' || (context && (!raw.translation.trim() ||
        typeof raw.label !== 'string' || !raw.label.trim() || typeof raw.dictionary_form !== 'string' || !raw.dictionary_form.trim()))) {
        invalid = true; break;
      }
      if ((context || raw.clauseIndex !== undefined) && (!Number.isSafeInteger(raw.clauseIndex) || raw.clauseIndex < 0)) { invalid = true; break; }
      // The trainer reveals predicate negation with the whole predicate.
      const role: SyntaxRole = code === 'it' && normalize(text) === 'non' && raw.role === 'Particle' ? 'Predicate' : raw.role;
      const parts = Array.isArray(raw.parts) && raw.parts.length > 0 && raw.parts.every((p: unknown) => typeof p === 'string' && p.trim()) &&
        surface(raw.parts.join('')) === surface(text) ? raw.parts : [text];
      // The written surface can be divided into arbitrary character slices;
      // common irregular auxiliaries have no trustworthy visible stem boundary.
      const safeParts = code === 'en' && OPAQUE_ENGLISH_FORMS.has(normalize(text)) ? [text] : parts;
      tokens.push({ text, label: typeof raw.label === 'string' ? raw.label : text, role, parts: safeParts,
        translation: raw.translation, dictionary_form: typeof raw.dictionary_form === 'string' ? raw.dictionary_form.trim() : text,
        is_in_my_dict: false, dictionary_word: null, ...(raw.clauseIndex !== undefined ? { clauseIndex: raw.clauseIndex } : {}) });
    }
    if (invalid) { fail('некорректные роли, перевод или номера частей предложения.'); continue; }
    if (!tokensMatchSentence(candidate.sentence, tokens)) { fail('токены не воспроизводят текст предложения.'); continue; }
    if (context && /\p{L}+-ли(?=$|[\s.,!?])/iu.test(candidate.literalTranslation)) {
      fail('частица «ли» в русском переводе пишется отдельно.'); continue;
    }
    if (context && code === 'kz' && task?.focus === 'question' && /\sли\s*\?$/iu.test(candidate.literalTranslation)) {
      fail('в нейтральном русском вопросе частица «ли» не ставится после всего повествовательного предложения.'); continue;
    }
    if (task && task.focus !== 'usage' && (task.focus === 'question') !== /\?/u.test(candidate.sentence)) {
      fail(`${task.id}: вопросительный знак не соответствует заданию.`); continue;
    }
    if (!tokens.some(token => token.role === 'Predicate')) { fail('нет сказуемого.'); continue; }
    if (context && code === 'kz') {
      const isolatedNegativeParticiple = tokens.some((token, index) => token.role === 'Predicate' &&
        normalize(tokens[index + 1]?.text || '') === 'жоқ' &&
        /(?:вш|ш)(?:ий|ая|ее|ие|ей|его|их)$/iu.test(normalize(token.translation)));
      if (isolatedNegativeParticiple) {
        fail('отрицательная конструкция с «жоқ» разобрана как русское причастие вместо части сказуемого.'); continue;
      }
      const misplacedBareObject = tokens.some((token, index) => {
        if (token.role !== 'Object') return false;
        const next = tokens[index + 1];
        if (!next || next.clauseIndex !== token.clauseIndex) return false;
        const bare = normalize(token.text) === normalize(token.dictionary_form || '');
        // An apparent object before the subject without an accusative ending
        // often reveals a mislabeled piece of a compound subject expression.
        const beforeSubjectWithoutAccusative = next.role === 'Subject' && !/(?:ны|ні|ды|ді|ты|ті|н)$/iu.test(token.text);
        return (bare && next.role !== 'Predicate') || beforeSubjectWithoutAccusative;
      });
      if (misplacedBareObject) {
        fail('проверьте позицию и падеж казахского дополнения либо роль части составного подлежащего.'); continue;
      }
    }
    if (tokens.some(token => token.clauseIndex !== undefined)) {
      const clauses = [...new Set(tokens.map(token => token.clauseIndex))].sort((a, b) => (a ?? -1) - (b ?? -1));
      if (clauses.some((clause, i) => clause !== i || !tokens.some(token => token.clauseIndex === clause && token.role === 'Predicate'))) {
        fail('каждая часть должна иметь сказуемое, номера частей — идти от нуля без пропусков.'); continue;
      }
      if (task && task.focus !== 'usage' && ((task.focus === 'complex') !== (clauses.length > 1))) {
        fail(`${task.id}: число грамматических основ не соответствует заданию.`); continue;
      }
    }
    const requiredRoles: Partial<Record<SentenceTask['focus'], SyntaxRole[]>> = {
      attribute: ['Attribute', 'Attribute_Subject', 'Attribute_Object'], object: ['Object'], circumstance: ['Circumstance', 'Adverbial'],
    };
    if (task && requiredRoles[task.focus] && !tokens.some(token => requiredRoles[task.focus]!.includes(token.role))) {
      fail(`${task.id}: отсутствует член предложения, который требуется найти.`); continue;
    }
    if (task?.id === 'task-1' && context?.requiredWord && !findLemmaSpan(tokens, context.requiredWord).length) {
      fail(`task-1: отсутствует запрошенное слово «${context.requiredWord}».`); continue;
    }
    if (context && code === 'en') {
      // Function words need grammatical explanations in the trainer. A model's
      // literal «этот», «один» or «делает» teaches the wrong lexical meaning.
      for (const [index, token] of tokens.entries()) {
        if (token.role === 'Article') {
          if (normalize(token.text) === 'the') token.translation = 'определённый артикль';
          if (['a', 'an'].includes(normalize(token.text))) token.translation = 'неопределённый артикль';
        }
        if (['do', 'does', 'did', 'have', 'has', 'had'].includes(normalize(token.text)) && token.role === 'Predicate' &&
          tokens.some((other, otherIndex) => otherIndex !== index && other.clauseIndex === token.clauseIndex &&
            other.role === 'Predicate' && /^verb$/iu.test(other.label))) {
          token.translation = 'вспомогательный глагол';
        }
      }
    }
    markDictionaryWords(tokens, dictionary);
    sentences.push(makeGeneratedSentence({ language: label, sentence: candidate.sentence.trim(), words: tokens,
      ...(context && task ? { literalTranslation: candidate.literalTranslation.trim(), learningGoal: task.goal, generationTaskId: task.id } : {}),
    }, code));
    if (task) acceptedTasks.add(task.id);
  }
  return { sentences, errors };
};

export const validateGeneratedSentences = (
  value: unknown, code: string, label: string, dictionary: DictionaryCandidate[], context?: GenerationValidationContext,
): ValidationResult => validateWithDictionaryIndex(value, code, label, indexDictionary(dictionary), context);

/** Let input, navigation and cancellation run between cards on the native JS thread. */
export const validateGeneratedSentencesAsync = async (
  value: unknown, code: string, label: string, dictionary: DictionaryCandidate[], context?: GenerationValidationContext,
  signal?: AbortSignal,
): Promise<ValidationResult> => {
  await abortableDelay(0, signal);
  const index = indexDictionary(dictionary);
  if (!Array.isArray(value)) return validateWithDictionaryIndex(value, code, label, index, context);
  const result: ValidationResult = { sentences: [], errors: [] };
  const acceptedTasks = new Set<string>();
  for (const [offset, candidate] of value.entries()) {
    await abortableDelay(0, signal);
    const checked = validateWithDictionaryIndex([candidate], code, label, index, context, acceptedTasks, offset);
    result.sentences.push(...checked.sentences);
    result.errors.push(...checked.errors);
  }
  return result;
};
