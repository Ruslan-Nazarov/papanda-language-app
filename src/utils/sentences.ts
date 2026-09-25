import type { Sentence } from '../models/types';

let sequence = 0;
export const makeGeneratedSentence = (sentence: Omit<Sentence, 'id' | 'source'>, languageCode: string): Sentence => {
  const createdAt = Date.now();
  return { ...sentence, id: `generated_${languageCode}_${createdAt}_${++sequence}`, source: 'generated', createdAt };
};
