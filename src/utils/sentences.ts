import type { Sentence } from '../models/types';

let sequence = 0;
export const makeGeneratedSentence = (sentence: Omit<Sentence, 'id' | 'source'>, languageCode: string): Sentence => {
  const createdAt = Date.now();
  return { ...sentence, id: `generated_${languageCode}_${createdAt}_${++sequence}`, source: 'generated', createdAt };
};

/** Manual changes invalidate the audited chain and morphology they came from. */
export function prepareSentenceEdit(original: Sentence | undefined, next: Sentence, id: string): Sentence {
  const textChanged = original?.sentence.trim() !== next.sentence.trim() || original?.language !== next.language;
  return { ...next, id, source: 'manual', markerHints: undefined,
    generationTaskId: undefined, generationBatchId: undefined, chainStep: undefined,
    learningGoal: undefined,
    ...(textChanged ? { literalTranslation: undefined } : {}),
  };
}
