import { AI_SYSTEM_PROMPT } from './aiPrompt';
import { generateGeminiText } from './geminiClient';

export async function explainSentenceWithAI(sentence: string, targetLanguage: string, nativeTranslation: string): Promise<string> {
  const userPrompt = `Пожалуйста, разбери это предложение (язык оригинала: ${targetLanguage}): "${sentence}".
Его перевод: "${nativeTranslation}".`;

  try {
    // gemini-3.x models spend part of the output budget on hidden reasoning, so
    // 2048 was routinely truncating the visible answer. Cap the thinking and give
    // the response room.
    return await generateGeminiText(`${AI_SYSTEM_PROMPT}\n\n${userPrompt}`, {
      temperature: 0.5,
      maxOutputTokens: 8192,
      thinkingConfig: { thinkingBudget: 1024 }
    });
  } catch (error: unknown) {
    throw new Error(error instanceof Error ? error.message : 'Не удалось получить объяснение');
  }
}
