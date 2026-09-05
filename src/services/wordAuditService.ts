import { Word } from '../models/types';
import { useStore, WordAiVerification } from '../store/useStore';
import { generateGeminiText, isGeminiConfigured } from './geminiClient';
import { LANGUAGES } from '../constants/languages';
import { getWordTranslation } from '../utils/words';

let isAuditing = false;
let lastAuditTime = 0;
const MIN_AUDIT_INTERVAL_MS = 12000; // at least 12 seconds between background audits

interface AiCheckResponse {
  isValid: boolean;
  issues?: Array<{
    lang: string;
    issue: string;
    suggestion?: string;
  }>;
}

/**
 * Validates active translations of a word against Russian meaning using Gemini.
 */
export async function auditWordTranslations(
  word: Word,
  activeLanguages: string[]
): Promise<WordAiVerification | null> {
  if (!isGeminiConfigured()) return null;

  const validActiveTranslations = activeLanguages
    .map(langCode => {
      const translation = getWordTranslation(word, langCode);
      const langObj = LANGUAGES.find(l => l.code === langCode);
      return {
        langCode,
        langName: langObj?.label || langCode.toUpperCase(),
        translation: translation?.trim()
      };
    })
    .filter(t => Boolean(t.translation));

  if (validActiveTranslations.length === 0) return null;

  const russianWord = word.ru || word.word || '';
  if (!russianWord) return null;

  const prompt = `Ты — эксперт-лингвист и лексикограф. Проверь правильность перевода слова с русского языка на иностранные языки.
Слово на русском: "${russianWord}"
${word.meaning ? `Контекст / пояснение: "${word.meaning}"` : ''}

Переводы для проверки:
${validActiveTranslations.map(t => `- ${t.langName} (код: ${t.langCode}): "${t.translation}"`).join('\n')}

Критерии проверки:
1. Соответствует ли перевод русскому значению (с учётом контекста)?
2. Нет ли явных опечаток или искажений?
3. Является ли форма начальной словарной формой (инфинитив для глаголов, им. падеж ед. число для сущ.)?

Ответь строго в формате JSON:
{
  "isValid": true | false,
  "issues": [
    {
      "lang": "код языка (например kz, it, de, es, fr)",
      "issue": "краткое описание проблемы на русском (до 10 слов)",
      "suggestion": "рекомендуемый правильный вариант"
    }
  ]
}
Если переводы верны, верни: {"isValid": true, "issues": []}`;

  try {
    const text = await generateGeminiText(prompt, {
      temperature: 0.1,
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingBudget: 256 }
    });

    let result: AiCheckResponse;
    try {
      result = JSON.parse(text);
    } catch {
      return null;
    }

    const issues = Array.isArray(result.issues) ? result.issues : [];
    const isFlagged = !result.isValid || issues.length > 0;

    return {
      status: isFlagged ? 'flagged' : 'verified',
      issues: issues.map(iss => ({
        lang: iss.lang || 'unknown',
        issue: iss.issue || 'Неточность перевода',
        suggestion: iss.suggestion
      })),
      checkedAt: new Date().toISOString()
    };
  } catch (err) {
    // Background audit should fail silently
    console.warn('[WordAudit] Check error:', err);
    return null;
  }
}

/**
 * Periodically audits one unverified word in the background.
 */
export async function auditNextWordInBackground(): Promise<void> {
  if (isAuditing) return;
  if (!isGeminiConfigured()) return;

  const now = Date.now();
  if (now - lastAuditTime < MIN_AUDIT_INTERVAL_MS) return;

  const state = useStore.getState();
  const { words, activeLanguages, userWordProgress, setWordAiVerification } = state;
  if (!words || words.length === 0 || !activeLanguages || activeLanguages.length === 0) return;

  // Find a word that hasn't been verified in the last 30 days
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  const candidate = words.find(w => {
    const key = w.eng || w.word || '';
    if (!key) return false;
    const progress = userWordProgress[key];
    if (!progress?.ai_verification) return true;
    const checkedTime = new Date(progress.ai_verification.checkedAt).getTime();
    return isNaN(checkedTime) || checkedTime < thirtyDaysAgo;
  });

  if (!candidate) return;

  isAuditing = true;
  lastAuditTime = now;

  try {
    const verification = await auditWordTranslations(candidate, activeLanguages);
    if (verification) {
      const key = candidate.eng || candidate.word || '';
      setWordAiVerification(key, verification);
    }
  } finally {
    isAuditing = false;
  }
}
