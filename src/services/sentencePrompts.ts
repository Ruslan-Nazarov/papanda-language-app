import { Sentence, SyntaxRole, Token, Word } from '../models/types';
import { LANGUAGES } from '../constants/languages';
import { getWordTranslation } from '../utils/words';

export interface DictionaryCandidate {
  lemma: string;
  translation: string;
}

interface LanguagePrompt {
  label: string;
  idPrefix: string;
  grammar: string;
  morphology: string;
  /** Extra language-specific line appended to the pre-answer self-check. */
  verify?: string;
}

const LANGUAGE_PROMPTS: Record<string, LanguagePrompt> = {
  en: {
    label: 'English',
    idPrefix: 'en',
    grammar: 'Use natural English with clear SVO word order. Check agreement, tense, articles, prepositions. Vary across the batch: affirmative present and past, at least one negative (do/does/did not, will not), at least one yes/no or wh- question, and — for larger batches — at least one complex sentence with a subordinate clause (that / because / when / if).',
    morphology: 'Split only productive endings when the boundary is clear: works -> ["work","s"], melted -> ["melt","ed"], happier -> ["happy","er"]. Keep irregular forms (found, said, went) and function words whole. dictionary_form is the bare lemma: said -> "say", works -> "work".'
  },
  kz: {
    label: 'Қазақша',
    idPrefix: 'kz',
    grammar: `Use natural Kazakh with pedagogical SOV order (Subject … Object … Predicate) unless a question needs another order. Respect vowel harmony everywhere.
DIRECT-OBJECT CASE — the most common mistake: a direct object that is modified by an adjective, is specific/definite, or stands in a NEGATED sentence MUST take the accusative -ны/-ні/-ды/-ді/-ты/-ті. Examples: «үлкен апатты ұмытпады», «жаңа кітапты оқыды», «жаман хатты жазбады», «итті көрді». Only a bare, fully generic mass/indefinite object may stay unmarked («нан жеді», «су ішті»). When unsure, mark it.
Direction takes the dative -ға/-ге/-қа/-ке. Negation -ма/-ме/-ба/-бе/-па/-пе goes before the tense suffix. Past is -ды/-ді/-ты/-ті. Put the yes/no particle ма/ме/ба/бе/па/пе as its own final token. Vary the batch: affirmative past, negative, a question with the particle, and a complex sentence with және / бірақ / өйткені.`,
    morphology: 'Kazakh is agglutinative: split root + ordered affixes — оқыды -> ["оқы","ды"], жазбады -> ["жаз","ба","ды"], дүкенге -> ["дүкен","ге"], кітапты -> ["кітап","ты"], апатты -> ["апат","ты"]. dictionary_form is the verbal noun / base: оқыды -> "оқу", салды -> "салу", көрді -> "көру"; for nouns the bare stem: дүкенге -> "дүкен", кітапты -> "кітап".',
    verify: 'Kazakh: for EVERY direct object, if it is modified by an adjective, is specific, or the sentence is negated, it must carry the accusative -ны/-ні/-ды/-ді/-ты/-ті — fix any bare-nominative object that should be accusative.'
  },
  de: {
    label: 'Deutsch',
    idPrefix: 'de',
    grammar: 'Use natural German. Capitalize nouns, keep the finite verb in second position in main clauses and final in subordinate clauses, check gender/case on articles and adjectives. Vary the batch: present and Perfekt, a negative with nicht/kein, a yes/no question (verb first), and a complex sentence with dass / weil / wenn.',
    morphology: 'Split transparent productive endings and separable prefixes only when useful: gekauft -> ["ge","kauf","t"], aufsteht -> ["auf","steht"]. Keep irregular and inseparable units whole. dictionary_form is the infinitive / nominative singular.'
  },
  es: {
    label: 'Español',
    idPrefix: 'es',
    grammar: 'Use natural standard Spanish. Check gender/number agreement, verb conjugation, personal "a" before a human object, inverted question marks. Vary the batch: presente and pretérito, a negative with no, a question, and a complex sentence with que / porque / cuando.',
    morphology: 'Split transparent productive endings only where the boundary is clear: hablas -> ["habl","as"], comió -> ["com","ió"]. Keep irregular forms whole. dictionary_form is the infinitive / masculine singular.'
  },
  it: {
    label: 'Italiano',
    idPrefix: 'it',
    grammar: 'Use natural standard Italian. Check gender/number agreement, articles, verb conjugation, pronoun placement. Subject pronouns may be dropped when clear. Vary the batch: presente and passato prossimo, a negative with non, a question, and a complex sentence with che / perché / quando.',
    morphology: 'Split transparent productive endings only where clear: parli -> ["parl","i"], mangiato -> ["mangi","ato"]. Keep irregular forms and articulated prepositions (nel, della) whole. dictionary_form is the infinitive / masculine singular.'
  },
  fr: {
    label: 'Français',
    idPrefix: 'fr',
    grammar: 'Use natural standard French. Check gender/number agreement, articles, elision, negation (ne … pas), auxiliary choice in the passé composé. Vary the batch: présent and passé composé, a negative, a question (est-ce que / inversion), and a complex sentence with que / parce que / quand.',
    morphology: 'Keep elided or contracted forms as the written token (j’, l’, du). Split productive endings only when the boundary is genuinely clear. dictionary_form is the infinitive / masculine singular.'
  },
  la: {
    label: 'Latin',
    idPrefix: 'la',
    grammar: 'Use pedagogical Classical Latin with a clear canonical order (Subject … Object … Verb). Check case, number, gender, agreement and verb endings. Vary the batch: present and perfect, a negative with non, a question with -ne or nonne, and a complex sentence with quod / quia / cum.',
    morphology: 'Separate a transparent stem and ending only when the analysis is reliable: amat -> ["am","at"], puellam -> ["puell","am"]. Do not guess morphemes. dictionary_form is the dictionary head: nominative singular for nouns, first-person present (or infinitive) for verbs.'
  }
};

const ROLE_VALUES: SyntaxRole[] = [
  'Predicate', 'Subject', 'Attribute', 'Attribute_Subject', 'Object',
  'Attribute_Object', 'Circumstance', 'Adverbial', 'Conjunction',
  'Preposition', 'Particle', 'Article', 'Other'
];

const LABEL_VOCABULARY = [
  'Noun', 'Pronoun', 'Verb', 'Verb (Past)', 'Verb (Neg)', 'Auxiliary', 'Infinitive',
  'Adjective', 'Adverb', 'Article', 'Particle', 'Conjunction', 'Preposition', 'Numeral',
  'Place', 'Time'
];

// One worked example per language, in the exact shape the model must return.
// Curated from the hand-made trainer data so generated sentences match its depth.
const LANGUAGE_EXAMPLES: Record<string, string> = {
  en: `[
  {"language":"English","sentence":"The man said that the bridge was safe.","words":[
    {"text":"The","label":"Article","role":"Article","parts":["the"],"translation":"определённый артикль","is_in_my_dict":false,"dictionary_word":null,"dictionary_form":"the"},
    {"text":"man","label":"Noun","role":"Subject","parts":["man"],"translation":"мужчина","is_in_my_dict":true,"dictionary_word":"man","dictionary_form":"man"},
    {"text":"said","label":"Verb (Past)","role":"Predicate","parts":["said"],"translation":"сказал","is_in_my_dict":true,"dictionary_word":"say","dictionary_form":"say"},
    {"text":"that","label":"Conjunction","role":"Conjunction","parts":["that"],"translation":"что","is_in_my_dict":false,"dictionary_word":null,"dictionary_form":"that"},
    {"text":"the","label":"Article","role":"Article","parts":["the"],"translation":"определённый артикль","is_in_my_dict":false,"dictionary_word":null,"dictionary_form":"the"},
    {"text":"bridge","label":"Noun","role":"Subject","parts":["bridge"],"translation":"мост","is_in_my_dict":true,"dictionary_word":"bridge","dictionary_form":"bridge"},
    {"text":"was","label":"Auxiliary","role":"Predicate","parts":["was"],"translation":"был","is_in_my_dict":false,"dictionary_word":null,"dictionary_form":"be"},
    {"text":"safe","label":"Adjective","role":"Predicate","parts":["safe"],"translation":"безопасным","is_in_my_dict":true,"dictionary_word":"safe","dictionary_form":"safe"}
  ]},
  {"language":"English","sentence":"Does the farmer grow corn?","words":[
    {"text":"Does","label":"Auxiliary","role":"Predicate","parts":["does"],"translation":"вспомогательный глагол","is_in_my_dict":false,"dictionary_word":null,"dictionary_form":"do"},
    {"text":"the","label":"Article","role":"Article","parts":["the"],"translation":"определённый артикль","is_in_my_dict":false,"dictionary_word":null,"dictionary_form":"the"},
    {"text":"farmer","label":"Noun","role":"Subject","parts":["farmer"],"translation":"фермер","is_in_my_dict":true,"dictionary_word":"farmer","dictionary_form":"farmer"},
    {"text":"grow","label":"Verb","role":"Predicate","parts":["grow"],"translation":"выращивает","is_in_my_dict":true,"dictionary_word":"grow","dictionary_form":"grow"},
    {"text":"corn","label":"Noun","role":"Object","parts":["corn"],"translation":"кукурузу","is_in_my_dict":true,"dictionary_word":"corn","dictionary_form":"corn"}
  ]}
]`,
  kz: `[
  {"language":"Қазақша","sentence":"Жақсы дос жаман хатты жазбады.","words":[
    {"text":"Жақсы","label":"Adjective","role":"Attribute_Subject","parts":["жақсы"],"translation":"хороший","is_in_my_dict":true,"dictionary_word":"жақсы","dictionary_form":"жақсы"},
    {"text":"дос","label":"Noun","role":"Subject","parts":["дос"],"translation":"друг","is_in_my_dict":true,"dictionary_word":"дос","dictionary_form":"дос"},
    {"text":"жаман","label":"Adjective","role":"Attribute_Object","parts":["жаман"],"translation":"плохое","is_in_my_dict":true,"dictionary_word":"жаман","dictionary_form":"жаман"},
    {"text":"хатты","label":"Noun","role":"Object","parts":["хат","ты"],"translation":"письмо","is_in_my_dict":true,"dictionary_word":"хат","dictionary_form":"хат"},
    {"text":"жазбады","label":"Verb (Neg)","role":"Predicate","parts":["жаз","ба","ды"],"translation":"не написал","is_in_my_dict":true,"dictionary_word":"жазу","dictionary_form":"жазу"}
  ]},
  {"language":"Қазақша","sentence":"Қыз итті көрді және ұл жаңа кітапты оқыды.","words":[
    {"text":"Қыз","label":"Noun","role":"Subject","parts":["қыз"],"translation":"девочка","is_in_my_dict":true,"dictionary_word":"қыз","dictionary_form":"қыз"},
    {"text":"итті","label":"Noun","role":"Object","parts":["ит","ті"],"translation":"собаку","is_in_my_dict":true,"dictionary_word":"ит","dictionary_form":"ит"},
    {"text":"көрді","label":"Verb (Past)","role":"Predicate","parts":["көр","ді"],"translation":"увидела","is_in_my_dict":true,"dictionary_word":"көру","dictionary_form":"көру"},
    {"text":"және","label":"Conjunction","role":"Conjunction","parts":["және"],"translation":"и","is_in_my_dict":false,"dictionary_word":null,"dictionary_form":"және"},
    {"text":"ұл","label":"Noun","role":"Subject","parts":["ұл"],"translation":"сын","is_in_my_dict":true,"dictionary_word":"ұл","dictionary_form":"ұл"},
    {"text":"жаңа","label":"Adjective","role":"Attribute_Object","parts":["жаңа"],"translation":"новую","is_in_my_dict":true,"dictionary_word":"жаңа","dictionary_form":"жаңа"},
    {"text":"кітапты","label":"Noun","role":"Object","parts":["кітап","ты"],"translation":"книгу","is_in_my_dict":true,"dictionary_word":"кітап","dictionary_form":"кітап"},
    {"text":"оқыды","label":"Verb (Past)","role":"Predicate","parts":["оқы","ды"],"translation":"прочитал","is_in_my_dict":true,"dictionary_word":"оқу","dictionary_form":"оқу"}
  ]}
]`,
  it: `[
  {"language":"Italiano","sentence":"Il cane non ha mangiato la carne.","words":[
    {"text":"Il","label":"Article","role":"Article","parts":["il"],"translation":"артикль","is_in_my_dict":false,"dictionary_word":null,"dictionary_form":"il"},
    {"text":"cane","label":"Noun","role":"Subject","parts":["cane"],"translation":"собака","is_in_my_dict":true,"dictionary_word":"cane","dictionary_form":"cane"},
    {"text":"non","label":"Particle","role":"Predicate","parts":["non"],"translation":"не","is_in_my_dict":false,"dictionary_word":null,"dictionary_form":"non"},
    {"text":"ha","label":"Auxiliary","role":"Predicate","parts":["ha"],"translation":"вспом. глагол","is_in_my_dict":false,"dictionary_word":null,"dictionary_form":"avere"},
    {"text":"mangiato","label":"Verb (Past)","role":"Predicate","parts":["mangi","ato"],"translation":"съел","is_in_my_dict":true,"dictionary_word":"mangiare","dictionary_form":"mangiare"},
    {"text":"la","label":"Article","role":"Article","parts":["la"],"translation":"артикль","is_in_my_dict":false,"dictionary_word":null,"dictionary_form":"la"},
    {"text":"carne","label":"Noun","role":"Object","parts":["carne"],"translation":"мясо","is_in_my_dict":true,"dictionary_word":"carne","dictionary_form":"carne"}
  ]}
]`,
  de: `[
  {"language":"Deutsch","sentence":"Kauft der Mann das teure Auto?","words":[
    {"text":"Kauft","label":"Verb","role":"Predicate","parts":["kauf","t"],"translation":"покупает","is_in_my_dict":true,"dictionary_word":"kaufen","dictionary_form":"kaufen"},
    {"text":"der","label":"Article","role":"Article","parts":["der"],"translation":"артикль","is_in_my_dict":false,"dictionary_word":null,"dictionary_form":"der"},
    {"text":"Mann","label":"Noun","role":"Subject","parts":["Mann"],"translation":"мужчина","is_in_my_dict":true,"dictionary_word":"Mann","dictionary_form":"Mann"},
    {"text":"das","label":"Article","role":"Article","parts":["das"],"translation":"артикль","is_in_my_dict":false,"dictionary_word":null,"dictionary_form":"das"},
    {"text":"teure","label":"Adjective","role":"Attribute_Object","parts":["teur","e"],"translation":"дорогую","is_in_my_dict":true,"dictionary_word":"teuer","dictionary_form":"teuer"},
    {"text":"Auto","label":"Noun","role":"Object","parts":["Auto"],"translation":"машину","is_in_my_dict":true,"dictionary_word":"Auto","dictionary_form":"Auto"}
  ]}
]`,
  es: `[
  {"language":"Español","sentence":"La niña no compró el libro nuevo.","words":[
    {"text":"La","label":"Article","role":"Article","parts":["la"],"translation":"артикль","is_in_my_dict":false,"dictionary_word":null,"dictionary_form":"la"},
    {"text":"niña","label":"Noun","role":"Subject","parts":["niña"],"translation":"девочка","is_in_my_dict":true,"dictionary_word":"niña","dictionary_form":"niño"},
    {"text":"no","label":"Particle","role":"Predicate","parts":["no"],"translation":"не","is_in_my_dict":false,"dictionary_word":null,"dictionary_form":"no"},
    {"text":"compró","label":"Verb (Past)","role":"Predicate","parts":["compr","ó"],"translation":"купила","is_in_my_dict":true,"dictionary_word":"comprar","dictionary_form":"comprar"},
    {"text":"el","label":"Article","role":"Article","parts":["el"],"translation":"артикль","is_in_my_dict":false,"dictionary_word":null,"dictionary_form":"el"},
    {"text":"libro","label":"Noun","role":"Object","parts":["libro"],"translation":"книгу","is_in_my_dict":true,"dictionary_word":"libro","dictionary_form":"libro"},
    {"text":"nuevo","label":"Adjective","role":"Attribute_Object","parts":["nuevo"],"translation":"новую","is_in_my_dict":true,"dictionary_word":"nuevo","dictionary_form":"nuevo"}
  ]}
]`,
  fr: `[
  {"language":"Français","sentence":"La fille n’a pas acheté le livre.","words":[
    {"text":"La","label":"Article","role":"Article","parts":["la"],"translation":"артикль","is_in_my_dict":false,"dictionary_word":null,"dictionary_form":"la"},
    {"text":"fille","label":"Noun","role":"Subject","parts":["fille"],"translation":"девочка","is_in_my_dict":true,"dictionary_word":"fille","dictionary_form":"fille"},
    {"text":"n’","label":"Particle","role":"Predicate","parts":["ne"],"translation":"не","is_in_my_dict":false,"dictionary_word":null,"dictionary_form":"ne"},
    {"text":"a","label":"Auxiliary","role":"Predicate","parts":["a"],"translation":"вспом. глагол","is_in_my_dict":false,"dictionary_word":null,"dictionary_form":"avoir"},
    {"text":"pas","label":"Particle","role":"Predicate","parts":["pas"],"translation":"не","is_in_my_dict":false,"dictionary_word":null,"dictionary_form":"pas"},
    {"text":"acheté","label":"Verb (Past)","role":"Predicate","parts":["achet","é"],"translation":"купила","is_in_my_dict":true,"dictionary_word":"acheter","dictionary_form":"acheter"},
    {"text":"le","label":"Article","role":"Article","parts":["le"],"translation":"артикль","is_in_my_dict":false,"dictionary_word":null,"dictionary_form":"le"},
    {"text":"livre","label":"Noun","role":"Object","parts":["livre"],"translation":"книгу","is_in_my_dict":true,"dictionary_word":"livre","dictionary_form":"livre"}
  ]}
]`,
  la: `[
  {"language":"Latin","sentence":"Puella librum novum legit.","words":[
    {"text":"Puella","label":"Noun","role":"Subject","parts":["puell","a"],"translation":"девочка","is_in_my_dict":true,"dictionary_word":"puella","dictionary_form":"puella"},
    {"text":"librum","label":"Noun","role":"Object","parts":["libr","um"],"translation":"книгу","is_in_my_dict":true,"dictionary_word":"liber","dictionary_form":"liber"},
    {"text":"novum","label":"Adjective","role":"Attribute_Object","parts":["nov","um"],"translation":"новую","is_in_my_dict":true,"dictionary_word":"novus","dictionary_form":"novus"},
    {"text":"legit","label":"Verb","role":"Predicate","parts":["leg","it"],"translation":"читает","is_in_my_dict":true,"dictionary_word":"lego","dictionary_form":"lego"}
  ]}
]`
};

export const getLanguagePrompt = (languageCode: string): LanguagePrompt => {
  const prompt = LANGUAGE_PROMPTS[languageCode];
  if (!prompt) throw new Error(`Генерация для языка «${languageCode}» пока не настроена.`);
  return prompt;
};

const shuffle = <T>(items: T[]): T[] => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

// Build the pool of dictionary words offered to the model. Words the learner has
// actually engaged with (favorites, associations, previously shown) are always
// included; the rest of the slots are filled with a RANDOM sample so every batch
// draws on different vocabulary instead of the same alphabetical head.
export const getDictionaryCandidates = (words: Word[], languageCode: string, limit = 40): DictionaryCandidate[] => {
  const seen = new Set<string>();

  const scored = words
    .map(word => {
      const lemma = getWordTranslation(word, languageCode);
      return {
        lemma: lemma.trim(),
        translation: (word.ru || '').trim(),
        engaged: Boolean(word.is_favorite || word.personal_association || (word.count || 0) > 0),
        score: (word.is_favorite ? 1000 : 0) + (word.personal_association ? 100 : 0) + (word.count || 0)
      };
    })
    .filter(item => {
      const key = item.lemma.toLocaleLowerCase();
      // Skip empties, duplicates, and multi-word phrase entries — a phrase lemma
      // breaks the morpheme analysis and the "≥2 dictionary words" check.
      if (!item.lemma || item.lemma.length < 2 || /\s/.test(item.lemma) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const engaged = scored.filter(item => item.engaged).sort((a, b) => b.score - a.score).slice(0, limit);
  // For the random fill prefer shorter lemmas — very long ones tend to be rare
  // vocabulary that produces stilted sentences.
  const rest = shuffle(scored.filter(item => !item.engaged && item.lemma.length <= 16));

  const picked = [...engaged];
  for (const item of rest) {
    if (picked.length >= limit) break;
    picked.push(item);
  }

  return shuffle(picked).map(({ lemma, translation }) => ({ lemma, translation }));
};

const varietyLine = (count: number): string => {
  if (count <= 3) return 'Across the batch include at least one negative sentence and at least one question.';
  return `Across the ${count} sentences include at least ${Math.max(1, Math.round(count / 4))} negative, at least ${Math.max(1, Math.round(count / 4))} interrogative, and at least one complex (two-clause) sentence. The rest are affirmative statements. Mix present and past tense. Do not start two sentences with the same word.`;
};

export const buildSentenceGenerationPrompt = (
  languageCode: string,
  candidates: DictionaryCandidate[],
  count: number
) => {
  const language = getLanguagePrompt(languageCode);
  const languageLabel = LANGUAGES.find(item => item.code === languageCode)?.label || language.label;
  const dictionary = candidates.map(item => `- ${item.lemma} — ${item.translation || 'перевод уточнить'}`).join('\n');
  const example = LANGUAGE_EXAMPLES[languageCode] || LANGUAGE_EXAMPLES.en;

  return `You generate learning data for the Papanda Sentence Trainer, which teaches sentence structure top-down: first find the members of the sentence (predicate, subject, attributes, object, adverbials), then the meaningful parts inside each word. Return ONLY the JSON array required by the response schema — no prose, no Markdown.

LANGUAGE: ${languageLabel} (${languageCode})
TASK: Write exactly ${count} DIFFERENT sentences that a beginner would study.

SENTENCE QUALITY — every sentence must:
- be fully natural and grammatically correct in ${languageLabel};
- be a COMPLETE thought with an explicit subject and predicate; most sentences also have a direct object;
- use 4–9 words (before punctuation) — never a bare "subject + verb" with nothing else;
- add at least one attribute (adjective/article-carrying noun phrase) or one adverbial (place / time / manner) so there is real structure to analyse;
- use at least TWO distinct content words (noun, verb, adjective, adverb) from the DICTIONARY below;
- use NO content word that is not in the dictionary. Function words (articles, prepositions, particles, auxiliaries, pronouns, conjunctions) may be used freely as grammar requires.
${varietyLine(count)}

${language.grammar}

DICTIONARY — only these lemmas may get is_in_my_dict: true. Keep their spelling exactly:
${dictionary}

TOKEN CONTRACT (one token per whitespace-separated word, in reading order):
- "language" of every sentence object is exactly "${languageLabel}".
- "sentence" carries normal punctuation; each token.text carries NONE.
- Joining token.text with single spaces reproduces the sentence without its punctuation.
- role ∈ ${ROLE_VALUES.join(', ')}. Use Subject / Predicate / Object / Attribute_Subject / Attribute_Object / Adverbial / Circumstance / Conjunction consistently. A multi-word verb group (auxiliary + neg/particle + main verb) — every piece is Predicate. An article belongs to Article, not Attribute.
- label is a short pedagogical part-of-speech from: ${LABEL_VOCABULARY.join(', ')}.
- parts = the morpheme breakdown of token.text (see rule below). A single-morpheme word is ["<text>"].
- ${language.morphology}
- translation = a concise contextual Russian translation of THIS token as used here (e.g. an object noun in the accusative: "книгу", not "книга").
- dictionary_form = the canonical lemma of the token (used when the learner adds it to the dictionary), even for function words.
- If the token is one of the dictionary lemmas: is_in_my_dict = true and dictionary_word = that exact lemma. Otherwise is_in_my_dict = false and dictionary_word = null.

FOLLOW THIS SHAPE EXACTLY (structure and depth, not vocabulary):
${example}

BEFORE YOU ANSWER, silently verify: grammar and every case ending are correct; every sentence has a predicate and ≥4 words; token.text values rebuild the sentence; ≥2 dictionary content words per sentence; the negative / question / complex quota is met; no two sentences are near-duplicates.${language.verify ? `\n${language.verify}` : ''}`;
};

export const makeGeneratedSentenceId = (languageCode: string, offset: number) => {
  const prompt = getLanguagePrompt(languageCode);
  return `generated_${prompt.idPrefix}_${Date.now()}_${offset + 1}`;
};

export const makeGeneratedSentence = (sentence: Omit<Sentence, 'id' | 'source'>, languageCode: string, offset: number): Sentence => ({
  ...sentence,
  id: makeGeneratedSentenceId(languageCode, offset),
  source: 'generated',
  createdAt: Date.now()
});

export const TOKEN_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    label: { type: 'string' },
    role: { type: 'string', enum: ROLE_VALUES },
    parts: { type: 'array', items: { type: 'string' } },
    translation: { type: 'string' },
    is_in_my_dict: { type: 'boolean' },
    dictionary_word: { type: 'string', nullable: true },
    dictionary_form: { type: 'string' }
  },
  required: ['text', 'label', 'role', 'parts', 'translation', 'is_in_my_dict', 'dictionary_form']
};

export const SENTENCE_ARRAY_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      language: { type: 'string' },
      sentence: { type: 'string' },
      words: { type: 'array', items: TOKEN_SCHEMA }
    },
    required: ['language', 'sentence', 'words']
  }
};

export const asToken = (value: unknown): Token => value as Token;
