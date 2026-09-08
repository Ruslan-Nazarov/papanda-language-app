export type Language = 'EN' | 'RU' | 'ES' | 'IT' | 'DE' | 'KZ';

export interface WordTranslation {
  [lang: string]: string | undefined;
}

export interface Word {
  id?: string;
  word?: string; // from mock
  meaning?: string; // from mock
  translations?: Record<string, string>; // from mock
  
  eng?: string;
  ru?: string;
  it?: string;
  es?: string;
  de?: string;
  fr?: string;
  count: number;
  is_learned: number;
  last_shown?: string; // ISO date string
  knowledge_stats?: string | Record<string, boolean>; // JSON string from DB, parsed to object
  show_stats?: string | Record<string, number>; // JSON string from DB, parsed to object
  personal_association?: string; // user's personal context/meaning
  is_favorite?: boolean;
  /** Language of a word added from a sentence; the internal `eng` field remains its stable key. */
  source_language?: string;
}

export type SyntaxRole =
  | 'Predicate'
  | 'Subject'
  | 'Attribute'
  | 'Attribute_Subject'
  | 'Object'
  | 'Attribute_Object'
  | 'Circumstance'
  | 'Adverbial'
  | 'Conjunction'
  | 'Preposition'
  | 'Particle'
  | 'Article'
  | 'Other';

export interface Token {
  text: string;
  label: string;
  role: SyntaxRole;
  parts?: string[]; // In new data parts is just an array of strings
  translation: string;
  is_in_my_dict: boolean;
  /** Existing dictionary reference; null means that this token is not yet in the user's dictionary. */
  dictionary_word?: string | null;
  /** Canonical lemma for adding the token to the dictionary, even when it is not there yet. */
  dictionary_form?: string;
}

export interface Sentence {
  id: string;
  language: string;
  sentence: string; // The original text is now in 'sentence' property
  words: Token[];   // Tokens are now in 'words' property
  source?: 'seed' | 'manual' | 'generated';
  /** Epoch ms when a generated sentence was created; used to surface fresh batches first. */
  createdAt?: number;
}
