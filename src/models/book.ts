export interface BookCell {
  markdown: string;
  text: string;
  colSpan: number;
  rowSpan: number;
  header: boolean;
}
export type BookBlock =
  | { id: string; kind: 'heading'; text: string; level: number }
  | { id: string; kind: 'text'; text: string; markdown: string }
  | { id: string; kind: 'table'; text: string; rows: BookCell[][] };
export interface BookChapter {
  id: string;
  language: string;
  number: number;
  title: string;
  sourcePath: string;
  sourceHash: string;
  blocks: BookBlock[];
}
export interface BookLanguage { code: string; title: string; flag: string }
export interface BookLocation { chapterId: string; blockId?: string }
export interface BookPassage extends BookLocation {
  blockId: string;
  title: string;
  text: string;
}
