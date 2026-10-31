import { generationContext } from './generationControl';
import { parseWordAudit, selectWordAuditCandidate } from '../utils/wordAudit';
import { Word } from '../models/types';
import { useStore, WordAiVerification } from '../store/useStore';
import { generateGeminiText, isGeminiConfigured } from './geminiClient';
import { LANGUAGES } from '../constants/languages';
import { getWordTranslation } from '../utils/words';

let isAuditing = false;
let lastAuditTime = 0;
let lastAuditKey: string | undefined;
const MIN_AUDIT_INTERVAL_MS = 12000; // at least 12 seconds between background audits


/**
 * Validates active translations of a word against Russian meaning using Gemini.
 */
export async function auditWordTranslations(
  word: Word,
  activeLanguages: string[],
  signal?: AbortSignal,
  throwOnError = false
): Promise<WordAiVerification | null> {
  if (!isGeminiConfigured()) {
    if (throwOnError) throw new Error('ИИ-проверка сейчас недоступна: сервис ИИ не настроен.');
    return null;
  }

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

  if (validActiveTranslations.length === 0) {
    if (throwOnError) throw new Error('Нет переводов для проверки на выбранных языках.');
    return null;
  }

  const russianWord = word.ru || word.word || '';
  if (!russianWord) {
    if (throwOnError) throw new Error('Слово на русском языке не заполнено.');
    return null;
  }

  const prompt = `Ты — эксперт-лингвист и лексикограф. Проверь правильность написания и перевода слова с русского языка на иностранные языки.
Слово на русском: "${russianWord}"
${word.meaning ? `Контекст / пояснение: "${word.meaning}"` : ''}

Переводы для проверки:
${validActiveTranslations.map(t => `- ${t.langName} (код: ${t.langCode}): "${t.translation}"`).join('\n')}

Критерии проверки:
1. Правильно ли написано русское слово (нет ли орфографических ошибок)? Если в русском слове ошибка или опечатка, укажи замечание с кодом "lang": "ru".
2. Соответствует ли каждый иностранный перевод русскому значению (с учётом контекста)?
3. Нет ли явных опечаток или искажений в иностранных переводах (включая диакритику и буквы алфавита)?
4. Является ли форма начальной словарной формой (инфинитив для глаголов, им. падеж ед. число для сущ.)?

Ответь строго в формате JSON:
{
  "isValid": true | false,
  "issues": [
    {
      "lang": "код языка (например ru, kz, it, de, es, fr)",
      "issue": "краткое описание проблемы на русском (до 10 слов)",
      "suggestion": "рекомендуемый правильный вариант"
    }
  ]
}
Если слово и все переводы верны, верни строго: {"isValid": true, "issues": []}`;

  try {
    const text = await generateGeminiText(prompt, {
      temperature: 0.1,
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingBudget: 256 }
    }, undefined, signal);

    const verification = parseWordAudit(JSON.parse(text));
    return verification ? { ...verification, checkedLanguages: validActiveTranslations.map(item => item.langCode) } : null;
  } catch (err) {
    if (throwOnError) throw err;
    // Background audit should fail silently
    console.warn('[WordAudit] Check error:', err);
    return null;
  }
}

/**
 * Manually requests an audit for a specific word, updating the store and returning the verification.
 */
export async function auditWordManually(
  word: Word,
  activeLanguages: string[],
  signal?: AbortSignal
): Promise<WordAiVerification> {
  const verification = await auditWordTranslations(word, activeLanguages, signal, true);
  if (!verification) {
    throw new Error('Не удалось получить результат проверки от ИИ.');
  }

  const key = word.eng || word.word || '';
  if (key) {
    useStore.getState().setWordAiVerification(key, verification);
  }
  return verification;
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

  const candidate = selectWordAuditCandidate(words, activeLanguages, userWordProgress, now, lastAuditKey);

  if (!candidate) return;

  isAuditing = true;
  lastAuditTime = now;
  lastAuditKey = candidate.eng || candidate.word;

  try {
    const context = generationContext('word-audit');
    const verification = await auditWordTranslations(candidate, activeLanguages, context.signal);
    if (context.signal.aborted) return;
    const current = useStore.getState().words.find(word => (word.eng || word.word) === (candidate.eng || candidate.word));
    if (verification && current && current.ru === candidate.ru && activeLanguages.every(lang => getWordTranslation(current, lang) === getWordTranslation(candidate, lang))) {
      const key = candidate.eng || candidate.word || '';
      setWordAiVerification(key, verification);
    }
  } finally {
    isAuditing = false;
  }
}
