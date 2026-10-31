import type { SyntaxRole } from './types';

export interface StructureAttempt {
  id: string;
  sentenceId: string;
  language: string;
  role: SyntaxRole;
  clauseIndex: number;
  selected: number[];
  expected: number[];
  result: 'correct' | 'incorrect' | 'disputed';
  hintLevel: number;
  createdAt: string;
}
export interface MarkerHint {
  clauseIndex: number;
  role: SyntaxRole;
  explanation: string;
  evidence: { tokenIndex: number; form: string }[];
  source: 'authored' | 'ai';
}
