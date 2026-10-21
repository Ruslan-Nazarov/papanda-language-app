import type { Sentence } from '../models/types';
import type { SentenceTask } from './sentenceCurriculum';
import { getLanguagePrompt } from './sentencePrompts';

const CHECKS = ['natural', 'translation', 'roles', 'morphology', 'chain'] as const;
type Check = typeof CHECKS[number];

export interface QualityVerdict { taskId: string; passed: boolean; reason: string }

export const QUALITY_VERDICT_SCHEMA = {
  type: 'array', items: { type: 'object', properties: {
    taskId: { type: 'string' },
    natural: { type: 'boolean' }, translation: { type: 'boolean' },
    roles: { type: 'boolean' }, morphology: { type: 'boolean' }, chain: { type: 'boolean' },
    reason: { type: 'string' },
  }, required: ['taskId', ...CHECKS, 'reason'] },
};

/** A separate pass sees the finished card, without the annotation model's own
 * review booleans or its original instructions. It can judge relations between
 * source, translation, roles and neighboring sentences as a single artifact.
 */
export const buildSentenceQualityPrompt = (
  code: string, tasks: SentenceTask[], proposed: Sentence[], accepted: Sentence[],
): string => `AUDIT_SENTENCE_CARDS
You are checking finished language-learning cards. You did not compose or annotate them. Be skeptical: a fluent-looking source can have a wrong translation or analysis. Return ONLY a JSON array with one verdict per CANDIDATE, in the requested schema. Do not rewrite cards. A missing or malformed verdict causes rejection.
LANGUAGE: ${getLanguagePrompt(code).label} (${code})
${getLanguagePrompt(code).grammar}
For each card judge independently:
natural: Is the source a grammatical, idiomatic, plausible complete utterance in a neutral context? Reject forced collocations, missing obligatory complements/articles and invented causal links. In a causal sentence, the second clause must actually explain the first rather than give its result.
translation: Is the WHOLE Russian sentence grammatical and faithful to every source phrase? Reject added or omitted participants, attributes, negation or tense; reject wrong agreement. Preserve source member order only when Russian remains grammatical. A neutral yes/no question should have natural Russian question order, not mechanically put «ли» after a whole declarative sentence. Token glosses may explain a construction but cannot excuse a wrong whole-sentence translation.
roles: Are the sentence-member roles and clause numbers correct? Read multiword lexical units as units; a piece of a subject expression must not become a separate object. Prepositional location is not a direct object. Every actual grammatical base needs a predicate. Reject an indivisible written token that hides a syntactic subject inside a predicate if the card cannot teach that distinction reliably.
Papanda treats all pieces of predicate negation as Predicate, including French ne … pas, Italian non, English not and German nicht. Do not reject that teaching convention as an error. For Kazakh, a bare direct object is normally immediately before the predicate; an intervening subject or circumstance signals an error or wrong role.
morphology: Are every stated morpheme boundary and dictionary form linguistically credible? Are the token glosses pedagogically accurate? An article is not «этот» or «один», and an auxiliary do/does next to a lexical verb is not lexical «делает». A Kazakh participial form in a negative construction with жоқ should not be glossed as an isolated feminine Russian participle. A single whole-word part is allowed when uncertain. Written concatenation alone does not prove a division is valid.
chain: When a task develops another, does it keep the same scene, participants, predicate MEANING, tense and earlier details, adding the requested member? The same verb spelling can change meaning when its complements change. For independent tasks mark chain true if the structural focus is met.
Use the language's own grammar. Do not demand an overt subject, copula, article or case ending where the language does not require it. Do not reject a simple sentence merely for being short or a literal Russian translation merely for having neutral source order. If genuinely uncertain about a card's correctness, set the relevant check false.
Each verdict: taskId, five booleans, reason. For a rejected card, reason must identify a concrete phrase and defect in concise Russian; for a fully accepted card, reason may be empty.
TASKS: ${JSON.stringify(tasks)}
ALREADY ACCEPTED CONTEXT: ${JSON.stringify(accepted.map(s => ({ taskId: s.generationTaskId, sentence: s.sentence, literalTranslation: s.literalTranslation, words: s.words.map(w => ({ text: w.text, role: w.role, translation: w.translation })) })))}
CANDIDATES: ${JSON.stringify(proposed.map(s => ({ taskId: s.generationTaskId, sentence: s.sentence, literalTranslation: s.literalTranslation,
  words: s.words.map(w => ({ text: w.text, role: w.role, clauseIndex: w.clauseIndex, parts: w.parts, translation: w.translation, dictionary_form: w.dictionary_form })) })))}`;

export const parseQualityVerdicts = (value: unknown, tasks: SentenceTask[]): QualityVerdict[] => {
  const items = Array.isArray(value) ? value : [];
  return tasks.map(task => {
    const matches = items.filter(item => item && item.taskId === task.id);
    if (matches.length !== 1 || CHECKS.some(check => typeof matches[0][check] !== 'boolean') ||
      typeof matches[0].reason !== 'string') {
      return { taskId: task.id, passed: false, reason: 'Отдельная проверка качества вернула неполный или противоречивый результат.' };
    }
    const item = matches[0] as Record<Check | 'reason', boolean | string>;
    const failed = CHECKS.filter(check => !item[check]);
    return { taskId: task.id, passed: failed.length === 0,
      reason: failed.length ? `${failed.join(', ')}: ${(item.reason as string).trim() || 'проверка не объяснила дефект'}` : '' };
  });
};
