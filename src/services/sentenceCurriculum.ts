/** Method contract: book/preface.md and book/standart/chapters 1–7.
 * Structure, not vocabulary mastery, determines the exercise.
 * This is a batch composition policy, not a claim about learner proficiency.
 */
export type SentenceFocus = 'core' | 'attribute' | 'object' | 'circumstance' | 'negative' | 'reading' | 'question' | 'complex' | 'usage';

const GOALS: Record<SentenceFocus, string> = {
  core: 'Найдите сказуемое: что происходит? Затем определите, с кем или с чем это происходит.',
  attribute: 'Найдите сказуемое и подлежащее, затем признак предмета и маркер этого признака.',
  object: 'От сказуемого перейдите к подлежащему и определите, на что направлено действие.',
  circumstance: 'Найдите основу предложения, затем определите обстоятельства действия и их маркеры.',
  negative: 'Найдите всё сказуемое и определите, какими средствами выражено отрицание.',
  reading: 'Прочитайте предложение целиком. Найдите его основу по порядку слов и грамматическим маркерам.',
  question: 'Найдите сказуемое и подлежащее; определите, что делает предложение вопросом.',
  complex: 'Найдите грамматические основы и смысловую связь между ними.',
  usage: 'Прочитайте предложение целиком. Найдите сказуемое и определите, какую роль играет выбранное слово или выражение.',
};

export interface SentenceTask {
  id: string;
  focus: SentenceFocus;
  goal: string;
  /** Related sentences remain complete utterances; each step adds one detail. */
  develops?: string;
}

export interface SentenceDraft { taskId: string; sentence: string }

export const planSentenceBatch = (count: number, targeted = false): SentenceTask[] => {
  const sequence: SentenceFocus[] = ['core', 'attribute', 'object', 'circumstance', 'negative', 'reading', 'question', 'complex'];
  return Array.from({ length: count }, (_, i) => ({
    id: `task-${i + 1}`, focus: targeted && i === 0 ? 'usage' : sequence[i % sequence.length],
    goal: GOALS[targeted && i === 0 ? 'usage' : sequence[i % sequence.length]],
    ...(count >= 4 && !targeted && i > 0 && i < 4 ? { develops: `task-${i}` } : {}),
  }));
};

export const parseSentenceDrafts = (value: unknown, tasks: SentenceTask[]): SentenceDraft[] => {
  if (!Array.isArray(value)) return [];
  const ids = new Set(tasks.map(task => task.id));
  const seen = new Set<string>();
  const drafts: SentenceDraft[] = [];
  for (const item of value) {
    if (!item || typeof item.taskId !== 'string' || !ids.has(item.taskId) || seen.has(item.taskId) ||
      typeof item.sentence !== 'string' || !item.sentence.trim() || item.sentence.length > 600) continue;
    seen.add(item.taskId);
    drafts.push({ taskId: item.taskId, sentence: item.sentence.trim() });
  }
  return tasks.flatMap(task => drafts.filter(draft => draft.taskId === task.id));
};
