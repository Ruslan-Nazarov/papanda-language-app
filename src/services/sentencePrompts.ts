import { SyntaxRole, Word } from '../models/types';
import { getWordTranslation } from '../utils/words';
import { planSentenceBatch, SentenceDraft, SentenceTask } from './sentenceCurriculum';
import { bookContextPrompt } from './bookService';

export interface DictionaryCandidate { lemma: string; translation: string }
interface LanguagePrompt { label: string; grammar: string; morphology: string }

const LANGUAGE_PROMPTS: Record<string, LanguagePrompt> = {
  en: {
    label: 'English',
    grammar: 'Natural English: check agreement, tense, articles, collocations and prepositions. Keep neutral word order except where questions require inversion.',
    morphology: 'works → ["work","s"], melted → ["melt","ed"]. Keep went and irregular auxiliaries does/did/has/had/is/was whole; never invent stems like doe in does. Surface parts must concatenate to the written form: happier → ["happi","er"], dictionary_form happy, never parts ["happy","er"].',
  },
  kz: {
    label: 'Қазақша',
    grammar: 'Natural Kazakh: prefer neutral SOV order, check vowel harmony and case government. Attributive adjectives precede their noun. Direct-object marking depends on meaning (including specificity) and syntactic position: both кітап оқыды and кітапты оқыды can be appropriate in their respective contexts. Neither negation nor an adjective alone forces accusative. Choose a clear context; do not insert case suffixes mechanically. Direction commonly takes dative. Question particles ма/ме/ба/бе/па/пе are separate words. Nominal predicates need no invented copula.',
    morphology: 'жазбады → ["жаз","ба","ды"], дүкенге → ["дүкен","ге"]. Show reliable surface root/allomorph and affixes in order. dictionary_form is the headword: жазбады → жазу, оқыды → оқу. Do not substitute a lemma for a surface root.',
  },
  de: {
    label: 'Deutsch',
    grammar: 'Natural German: capitalize nouns, finite verb second in neutral main clauses, final in subordinate clauses; check article/adjective case and gender, separable verbs and negation scope.',
    morphology: 'gekauft → ["ge","kauf","t"]. Keep opaque forms whole. Separated verb particles belong to the predicate with its verb. dictionary_form is infinitive / nominative singular.',
  },
  es: {
    label: 'Español',
    grammar: 'Natural Spanish: agreement, conjugation, personal a where appropriate, inverted question marks and natural pronoun omission. Do not force an overt subject.',
    morphology: 'hablas → ["habl","as"]. Keep contractions and attached clitics as written tokens; do not invent whitespace. dictionary_form is the actual lexeme (niña for niña), infinitive for verbs.',
  },
  it: {
    label: 'Italiano',
    grammar: 'Natural Italian: agreement, articles, conjugation, clitic placement and natural subject omission. Use common compound forms where idiomatic; do not impose English tense preferences.',
    morphology: 'parli → ["parl","i"]. Keep articulated prepositions (nel, della) whole. dictionary_form is infinitive / singular.',
  },
  fr: {
    label: 'Français',
    grammar: 'Natural standard French: agreement, elision, negation scope (ne … pas), auxiliary choice. Use idiomatic compound forms where normal.',
    morphology: 'Elided clitics may be separated at the apostrophe: n’a → tokens n’ and a. n’ has parts ["n’"], dictionary_form ne. Keep du, au whole; explain their composition in the explanation, not by inventing letters in parts.',
  },
  la: {
    label: 'Latin',
    grammar: 'Idiomatic pedagogical Classical Latin: neutral order, case government and agreement, natural implicit subjects. Avoid translating modern idioms word for word.',
    morphology: 'amat → ["am","at"], puellam → ["puell","am"]. Only reliable surface divisions. dictionary_form is nominative singular for nouns, first-person present for verbs.',
  },
};

export const getLanguagePrompt = (code: string): LanguagePrompt => {
  const language = LANGUAGE_PROMPTS[code];
  if (!language) throw new Error(`Генерация для языка «${code}» пока не настроена.`);
  return language;
};

export const getAllDictionaryCandidates = (words: Word[], code: string): DictionaryCandidate[] => {
  const seen = new Set<string>();
  return words.flatMap(word => {
    const lemma = getWordTranslation(word, code).trim().replace(/\s+/g, ' ');
    const key = lemma.toLocaleLowerCase();
    if (!lemma || seen.has(key)) return [];
    seen.add(key);
    return [{ lemma, translation: (word.ru || '').trim() }];
  });
};

export const getSeedWords = (words: Word[], code: string, count = 25): DictionaryCandidate[] => {
  const candidates = getAllDictionaryCandidates(words, code);
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  return candidates.slice(0, count);
};

const METHOD = `Papanda follows the author's method, not a vocabulary drill:
The whole sentence is the unit of language and reflects a meaningful real-world action or state.
Find the predicate first, then subject, attributes of the subject, object and its attributes, circumstances; explain markers through word order, affixes and function words.
Develop from a simple basis to added meaning. Unknown words are allowed: structure can be recognised before vocabulary is learned.
Short complete sentences are valuable. State/nominal predicates and naturally implicit subjects are valid. Never pad a sentence just to add words.
Prefer typical neutral constructions, affirmative before negative before questions, present/past and third person most often. Follow each task; do not cram every construction into a small batch.
Use frequent idiomatic expressions, plausible agents/actions, concrete coherent situations. No accidental surrealism, moral platitudes or unrelated clauses glued together.
Modifiers, predicates and circumstances must be mutually compatible in the stated scene. Do not rescue a contradictory or odd example by imagining an unstated event or unusual conditions. For example, Cold water boils is unsuitable as a neutral beginner statement: the modifier conflicts with the stated action in an ordinary setting. Choose an attribute that adds useful, plausible information. Case/preposition choices must express the ordinary intended relation without requiring an unstated remote-work, metaphorical or other special context.
Preserve the language's own grammar. Do not force a universal SVO order or explicit copula/subject.`;

/** First pass: compose whole utterances without token annotation. */
export const buildSentenceGenerationPrompt = (
  code: string, seeds: DictionaryCandidate[], count: number, avoid: string[] = [], requiredWord?: string,
  tasks = planSentenceBatch(count), feedback: string[] = [], context: SentenceDraft[] = [],
): string => `COMPOSE_SENTENCES
${METHOD}
LANGUAGE: ${getLanguagePrompt(code).label} (${code})
${getLanguagePrompt(code).grammar}
Write one complete sentence per task, return ONLY JSON [{"taskId":"task-1","sentence":"..."}].
For core use a simple affirmative action/state. For attribute/object/circumstance keep it affirmative and make the focused member identifiable.
For negative/question use a simple, natural scene; complex needs a clear relation between two grammatical bases. Reading is an independent simple affirmative.
Usage is a natural example of a requested word/expression: allow a question, negation or multiple clauses if that is how it is normally used. Do not force words like why, never or because into a simple affirmative. Other tasks must not develop a usage task.
If develops is present, preserve the earlier scene, predicate and participants; add only the indicated detail. Each result must still sound natural on its own. Do not remove obligatory complements to make the base shorter.
Plan the whole development chain BACKWARDS from the object step: first choose one predicate and participant for which both the short core AND an added direct object are natural. Then derive all earlier and later steps from that same predicate and scene. Never switch verbs between task-1 and task-3. Keep the earlier details in every following step. Do not change tense, polarity, or the subject while adding a detail.
In a chain containing an object task, choose a predicate allowing an optional object (reading, drawing, drinking etc.), not an intransitive action like sleeping or arriving. If the verb requires an object, include it from task-1 and make it more specific at the object step. Do not write an incomplete core.
For complex, use two closely related actions with an obvious temporal or coordinating link. Use a causal conjunction only when the second clause really explains the first; the result of an action is not its cause.
Otherwise use independent scenes. Repeated structures and first words are allowed; avoid exact duplicate sentences.
TASKS: ${JSON.stringify(tasks)}
Already accepted development context: ${JSON.stringify(context)}
For ordinary tasks choose familiar, concrete words freely. Do not construct a scene from unrelated dictionary entries. Only a requested word is mandatory.
Requested word hint, if any: ${JSON.stringify(seeds)}
${requiredWord ? `The task task-1 must use the lexeme/expression ${JSON.stringify(requiredWord)} naturally, inflected if needed.` : ''}
Avoid exact duplicates: ${JSON.stringify(avoid)}
Correct these problems from the previous attempt: ${JSON.stringify(feedback.slice(0, 8))}`;

export const buildSentenceAnnotationPrompt = (code: string, tasks: SentenceTask[], drafts: SentenceDraft[], context: SentenceDraft[] = []): string => `REVIEW_AND_ANNOTATE
${METHOD}
${bookContextPrompt(code, drafts.map(d => d.sentence).join('\n'), [], false)}
LANGUAGE: ${getLanguagePrompt(code).label} (${code})
${getLanguagePrompt(code).grammar}
Review drafts independently on three criteria: naturalness/grammar and plausible meaning (natural), fit to assigned structural exercise including development relationship (taskFit), reliability of grammatical analysis AND Russian translation (analysisReliable).
Reject doubtful items by omitting them. Do not repair or change sentence text in this pass. A check is not automatically true because a previous model produced the sentence.
Check meaning before annotation: a grammatically well-formed sentence with an incompatible modifier/action or an unexplained unusual circumstance must be omitted. Do not mark natural:true merely because the words have identifiable grammatical roles.
TASKS: ${JSON.stringify(tasks)}
DRAFTS: ${JSON.stringify(drafts)}
Previously accepted context, only for checking development relationships (do not return it): ${JSON.stringify(context)}
For each accepted draft return taskId, sentence unchanged, review {natural:true,taskFit:true,analysisReliable:true}, literalTranslation and words.
literalTranslation: a complete grammatical Russian translation, not an interlinear gloss or list of token translations. Preserve the order of sentence MEMBERS as far as Russian grammar permits, but translate each phrase as a unit with normal Russian word order INSIDE it. She bought a book yesterday → Она купила книгу вчера, not Вчера она купила книгу. Russian prepositions must precede their noun even if the source uses postpositions. Do not concatenate grammatical labels instead of translating.
Russian must remain grammatical and convey the same tense and negation. Natural Russian word order takes priority over mechanically copying the source order, especially in questions: Қыз кітап оқыды ма? → Читала ли девочка книгу?, not Девочка книгу читала ли? Translate analytical predicates as a unit: Қыз ұйықтаған жоқ → Девочка не спала, never Девочка спавшей нет. Explain the source construction through token glosses, not by breaking the Russian whole-sentence translation.
For example, Кішкентай бала үстел басында хат жазады → Маленький ребёнок за столом письмо пишет. The phrase үстел басында is за столом, never стол у басы. No untranslated source fragments in the Russian sentence except proper names. Before accepting, read the Russian translation independently: every phrase must be meaningful Russian and must express the source meaning; otherwise correct the translation or omit the item.
words in reading order: text, label (part of speech), role, clauseIndex, parts, translation, dictionary_form.
text must match the written surface exactly, excluding surrounding sentence punctuation. Keep internal hyphens/apostrophes. No missing, added, reordered or merged words. French elisions may split immediately after apostrophe (n’ + a). Keep other written words whole.
role is a sentence member, NOT a part of speech: ${ROLE_VALUES.join(', ')}. A noun is not necessarily Subject. Every piece of a compound predicate, including auxiliaries and predicate negation, has role Predicate, even when separated by the subject. An adjective used predicatively is Predicate, not Attribute. Use Attribute_Subject for a subject's modifier and Attribute_Object for an object's modifier, so the trainer reveals each after its head. Articles retain Article.
clauseIndex: nonnegative integer identifying a grammatical base. Main clause 0, subordinate clauses 1 onwards in dependency order; coordinate clauses in reading order. Embedded clauses may interrupt another clause's tokens. Conjunction of nouns does NOT start a new clause. Put a clause linker in the clause it introduces. Each clause must include its predicate, including nominal predicates.
parts: surface pieces concatenating EXACTLY to text. If unsure keep [text]; this means segmentation unavailable, not proof of indivisibility. ${getLanguagePrompt(code).morphology}
dictionary_form: actual lemma, never a part-of-speech label or unrelated dictionary hint. Each token has its own lemma, not a multiword expression substituted for a single token.
translation: contextual Russian gloss of the token in its current form; concise grammatical gloss allowed for function words. A grammatical article is not a demonstrative or numeral: the ≠ этот, a ≠ один. When an English do/does/has auxiliary accompanies another verb, gloss its auxiliary function, not lexical «делает» or «имеет». In a Kazakh analytical negative with жоқ, the preceding verbal form must not receive an isolated Russian participial gloss such as «спавшая» or «сорвавшая».
Return ONLY the JSON array. Do not accept weak candidates to fill a quota.`;

const ROLE_VALUES: SyntaxRole[] = ['Predicate', 'Subject', 'Attribute', 'Attribute_Subject', 'Object', 'Attribute_Object',
  'Circumstance', 'Adverbial', 'Conjunction', 'Preposition', 'Particle', 'Article', 'Other'];

export const DRAFT_ARRAY_SCHEMA = {
  type: 'array', items: { type: 'object', properties: { taskId: { type: 'string' }, sentence: { type: 'string' } }, required: ['taskId', 'sentence'] },
};
export const TOKEN_SCHEMA = {
  type: 'object', properties: {
    text: { type: 'string' }, label: { type: 'string' }, role: { type: 'string', enum: ROLE_VALUES },
    clauseIndex: { type: 'integer' }, parts: { type: 'array', items: { type: 'string' } },
    translation: { type: 'string' }, dictionary_form: { type: 'string' },
  }, required: ['text', 'label', 'role', 'clauseIndex', 'parts', 'translation', 'dictionary_form'],
};
export const SENTENCE_ARRAY_SCHEMA = {
  type: 'array', items: {
    type: 'object', properties: {
      taskId: { type: 'string' }, sentence: { type: 'string' }, literalTranslation: { type: 'string' },
      review: { type: 'object', properties: { natural: { type: 'boolean' }, taskFit: { type: 'boolean' }, analysisReliable: { type: 'boolean' } }, required: ['natural', 'taskFit', 'analysisReliable'] },
      words: { type: 'array', items: TOKEN_SCHEMA },
    }, required: ['taskId', 'sentence', 'literalTranslation', 'review', 'words'],
  },
};
