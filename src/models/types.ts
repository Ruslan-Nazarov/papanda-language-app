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
  dictionary_word?: string;
}

export interface Sentence {
  id: string;
  language: string;
  sentence: string; // The original text is now in 'sentence' property
  words: Token[];   // Tokens are now in 'words' property
}
