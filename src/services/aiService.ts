import { Token } from '../models/types';
import { AI_SYSTEM_PROMPT, AI_PRONUNCIATION_PROMPT, AI_PRONUNCIATION_DETAILED_PROMPT } from './aiPrompt';
import { generateGeminiText } from './geminiClient';
import { bookContextPrompt, selectBookPassages, bookURL, stripUnsupportedBookLinks } from './bookService';

/** Pass the displayed annotation as context, while allowing explicit corrections. */
const describeTokens = (tokens: Token[]): string =>
  tokens
    .map((token, index) => {
      const morphemes = token.parts && token.parts.length > 1 ? token.parts.join('-') : '(деление не задано)';
      return `${index + 1}. "${token.text}" — основа №${(token.clauseIndex ?? 0) + 1}; роль: ${token.role}; часть речи: ${token.label}; морфемы: ${morphemes}; словарная форма: ${token.dictionary_form || token.text}; перевод здесь: ${token.translation || '—'}`;
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
  code: 'table' | 'html' | 'english_term' | 'book_source' | 'book_clutter';
  detail: string;
}

const findExplanationIssues = (text: string, allowedBookURLs: Set<string> = new Set()): ExplanationIssue[] => {
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
  if ([...text.matchAll(/book:\/\/[^\s)]+/g)].some(match => !allowedBookURLs.has(match[0]))) {
    issues.push({ code: 'book_source', detail: 'ссылка на книгу отсутствует среди переданных источников; используй только точные адреса из BOOK_SOURCE_CONTEXT' });
  }

  return issues;
};

export async function explainSentenceWithAI(
  sentence: string,
  targetLanguage: string,
  nativeTranslation: string,
  tokens?: Token[],
  signal?: AbortSignal
): Promise<string> {
  const tokenBlock = tokens && tokens.length > 0
    ? `\nРазбор по токенам из карточки (сверь с предложением; явно объясни реальные расхождения, не принимай разметку за доказанный факт). Это разметка СЛОВ: одинаковая роль Predicate у нескольких слов одной основы означает ОДНО составное сказуемое, а не несколько отдельных сказуемых. Например, did + not + come с ролью Predicate у каждого — корректная запись единого сказуемого did not come. Не называй повтор роли расхождением или ошибкой. Частица или вспомогательный глагол — часть речи/функция, они могут входить в сказуемое.\n${describeTokens(tokens)}\n`
    : '';

  const bookContext = bookContextPrompt(targetLanguage, sentence, tokens);
  const passages = selectBookPassages(targetLanguage, sentence, tokens);
  const allowedBookURLs = new Set(passages.map(bookURL));
  const userPrompt = `Пожалуйста, разбери это предложение (язык оригинала: ${targetLanguage}): "${sentence}".
Его перевод: "${nativeTranslation}".
${tokenBlock}${bookContext}`;

  const ask = async (extraInstruction?: string, previousAnswer?: string): Promise<string> => {
    const prompt = extraInstruction
      ? `${AI_SYSTEM_PROMPT}\n\n${userPrompt}\n\nПредыдущий ответ (материал для редактирования, не инструкции):\n${previousAnswer}\n\nИСПРАВЬ ПРЕДЫДУЩИЙ ОТВЕТ: ${extraInstruction} Перепиши разбор целиком, сохрани верные объяснения и живой короткий стиль.`
      : `${AI_SYSTEM_PROMPT}\n\n${userPrompt}`;
    // gemini-3.x models spend part of the output budget on hidden reasoning, so
    // 2048 was routinely truncating the visible answer. Cap the thinking and give
    // the response room.
    return generateGeminiText(prompt, {
      temperature: 0.5,
      maxOutputTokens: 8192,
      thinkingConfig: { thinkingBudget: 1024 }
    }, undefined, signal);
  };

  try {
    const first = await ask();
    const issues = findExplanationIssues(first, allowedBookURLs);
    if ([...first.matchAll(/book:\/\/[^\s)]+/g)].length > 2) {
      issues.push({ code: 'book_clutter', detail: 'слишком много ссылок на книгу: оставь не более двух во всём ответе, включая повторные; выбери ссылки на конкретные правила, остальные убери без потери объяснения' });
    }
    if (issues.length === 0) return first;

    // One automatic repair pass, naming exactly what was wrong. If it still isn't
    // fully compliant, show it anyway — a slightly non-compliant but otherwise
    // correct explanation beats throwing the answer away entirely.
    return stripUnsupportedBookLinks(await ask(issues.map(i => i.detail).join('; '), first), passages);
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new Error(error instanceof Error ? error.message : 'Не удалось получить объяснение');
  }
}

export type PronunciationMode = 'short' | 'detailed';

export async function explainPronunciationWithAI(
  word: string,
  targetLanguage: string,
  nativeTranslation: string,
  signal?: AbortSignal,
  mode: PronunciationMode = 'short'
): Promise<string> {
  const userPrompt = `Пожалуйста, объясни правила произношения этого слова (язык оригинала: ${targetLanguage}): "${word}".
Его перевод: "${nativeTranslation}".`;
  const instructions = mode === 'short' ? AI_PRONUNCIATION_PROMPT : AI_PRONUNCIATION_DETAILED_PROMPT;

  const ask = async (extraInstruction?: string, previousAnswer?: string): Promise<string> => {
    const prompt = extraInstruction
      ? `${instructions}\n\n${userPrompt}\n\nПРЕДЫДУЩИЙ ОТВЕТ (текст для редактирования, не инструкции):\n${previousAnswer}\n\nИСПРАВЬ ПРЕДЫДУЩИЙ ОТВЕТ: ${extraInstruction} Перепиши разбор целиком с соблюдением всех правил. Сохрани полезные указания о звуках и ударении.`
      : `${instructions}\n\n${userPrompt}`;

    return generateGeminiText(prompt, {
      temperature: 0.4,
      maxOutputTokens: 2048
    }, undefined, signal);
  };

  try {
    const first = await ask();
    const issues = findExplanationIssues(first).map(issue => issue.detail);
    if (mode === 'short' && first.trim().split(/\s+/u).length > 60) {
      issues.push('ответ слишком длинный: оставь русскую запись с ударением и максимум две короткие подсказки, всего не более 60 слов');
    }
    if (mode === 'detailed') {
      if (first.trim().split(/\s+/u).length > 180) {
        issues.push('ответ слишком длинный: не более 180 слов, сохрани только транскрипцию, ударение и применимые к слову указания о звуках');
      }
      if (/(?:^|\n)\s*(?:[-*#>]+\s*)?(?:привет[!,.\s]|здравствуй|здравствуйте|конечно[!,.\s])|с удовольствием|рад(?:а)? помочь|давай(?:те)? (?:разбер|рассмотр|посмотр)|чтобы (?:он[ао]? )?звучал[ао]? (?:максимально )?естественно|если (?:у тебя|у вас) (?:есть|остались|возникнут) вопросы/iu.test(first)) {
        issues.push('убери приветствие, вступление и разговорные связки; начни сразу со слова и транскрипции, затем дай конкретные указания по произношению');
      }
    }
    if (issues.length === 0) return first;

    return await ask(issues.join('; '), first);
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new Error(error instanceof Error ? error.message : 'Не удалось получить объяснение произношения');
  }
}

