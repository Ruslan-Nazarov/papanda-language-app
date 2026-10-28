export type NoteKind = 'rule' | 'question' | 'observation';
export type NoteUnderstanding = 'exploring' | 'understood' | 'review';

/** Keep a readable source even after an AI card is evicted or edited. */
export interface NoteSource {
  sentenceId: string;
  text: string;
  translation?: string;
  token?: string;
}

export interface LanguageNote {
  id: string;
  language: string;
  title: string;
  body: string;
  example: string;
  tags: string[];
  kind: NoteKind;
  understanding: NoteUnderstanding;
  sources: NoteSource[];
  showInContext: boolean;
  pinned: boolean;
  archived: boolean;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
}
