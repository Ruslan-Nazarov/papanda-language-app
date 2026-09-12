import { Token } from '../models/types';
import { AI_SYSTEM_PROMPT } from './aiPrompt';
import { generateGeminiText } from './geminiClient';

/** The trainer already has a correct token-level breakdown (role, morphemes,
 * contextual translation) from generation — hand it to the model as ground
 * truth instead of asking it to re-derive the whole analysis blind from a bare
 * string. This turns "analyze from scratch" into "narrate this known structure
 * in Russian", which a small model does far more reliably and consistently
 * with what the trainer already shows on screen. */
const describeTokens = (tokens: Token[]): string =>
  tokens
    .map((token, index) => {
      const morphemes = token.parts && token.parts.length > 1 ? token.parts.join('-') : '(неделимо)';
      return `${index + 1}. "${token.text}" — роль: ${token.role}; часть речи: ${token.label}; морфемы: ${morphemes}; словарная форма: ${token.dictionary_form || token.text}; перевод здесь: ${token.translation || '—'}`;
    })
    .join('\n');

// Nothing enforces AI_SYSTEM_PROMPT's hard rules besides hoping the model complies —
// this is a cheap post-check that catches the most common violations (a table, raw
// HTML, or an untranslated grammar term) so a bad answer gets one automatic repair
// pass instead of being shown to the learner as-is.
const FORBIDDEN_ENGLISH_TERMS = [
  'auxiliary', 'present simple', 'past simple', 'present perfect', 'past perfect',
  'present continuous', 'past continuous', 'future simple', 'bare infinitive',
  'gerund', 'participle', 'subordinate clause', 'main clause', 'modal verb'
];

interface ExplanationIssue {
  code: 'table' | 'html' | 'english_term';
  detail: string;
}

const findExplanationIssues = (text: string): ExplanationIssue[] => {
  const issues: ExplanationIssue[] = [];

  const pipeLines = text.split('\n').filter(line => line.includes('|')).length;
  if (pipeLines >= 2) {
    issues.push({ code: 'table', detail: 'ответ похож на Markdown-таблицу (несколько строк с "|")' });
  }

  if (/<\/?(table|tr|td|th|br|b|i|div|span|ul|li|ol)\b/i.test(text)) {
    issues.push({ code: 'html', detail: 'ответ содержит HTML-теги' });
  }

  const lowerText = text.toLocaleLowerCase();
  const foundTerm = FORBIDDEN_ENGLISH_TERMS.find(term => lowerText.includes(term));
  if (foundTerm) {
    issues.push({ code: 'english_term', detail: `использован непереведённый термин "${foundTerm}"` });
  }

  return issues;
};

export async function explainSentenceWithAI(
  sentence: string,
  targetLanguage: string,
  nativeTranslation: string,
  tokens?: Token[]
): Promise<string> {
  const tokenBlock = tokens && tokens.length > 0
    ? `\nГотовый разбор по токенам (используй его как основу — это уже проверенные роли и морфемы, не придумывай другой разбор структуры, а объясни именно этот, по-русски и педагогично):\n${describeTokens(tokens)}\n`
    : '';

  const userPrompt = `Пожалуйста, разбери это предложение (язык оригинала: ${targetLanguage}): "${sentence}".
Его перевод: "${nativeTranslation}".
${tokenBlock}`;

  const ask = async (extraInstruction?: string): Promise<string> => {
    const prompt = extraInstruction
      ? `${AI_SYSTEM_PROMPT}\n\n${userPrompt}\n\nИСПРАВЬ ПРЕДЫДУЩИЙ ОТВЕТ: ${extraInstruction} Перепиши разбор целиком с соблюдением всех правил.`
      : `${AI_SYSTEM_PROMPT}\n\n${userPrompt}`;
    // gemini-3.x models spend part of the output budget on hidden reasoning, so
    // 2048 was routinely truncating the visible answer. Cap the thinking and give
    // the response room.
    return generateGeminiText(prompt, {
      temperature: 0.5,
      maxOutputTokens: 8192,
      thinkingConfig: { thinkingBudget: 1024 }
    });
  };

  try {
    const first = await ask();
    const issues = findExplanationIssues(first);
    if (issues.length === 0) return first;

    // One automatic repair pass, naming exactly what was wrong. If it still isn't
    // fully compliant, show it anyway — a slightly non-compliant but otherwise
    // correct explanation beats throwing the answer away entirely.
    return await ask(issues.map(i => i.detail).join('; '));
  } catch (error: unknown) {
    throw new Error(error instanceof Error ? error.message : 'Не удалось получить объяснение');
  }
}
