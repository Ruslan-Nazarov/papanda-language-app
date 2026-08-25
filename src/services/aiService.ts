import { AI_SYSTEM_PROMPT } from './aiPrompt';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

export async function explainSentenceWithAI(sentence: string, targetLanguage: string, nativeTranslation: string): Promise<string> {
  // Use EXPO_PUBLIC variable. Note: you might need to restart the bundler for it to pick it up initially.
  const apiKey = process.env.EXPO_PUBLIC_GROQ_API_KEY;

  if (!apiKey) {
    throw new Error('API ключ не найден. Проверьте файл .env');
  }

  const userPrompt = `Пожалуйста, разбери это предложение (язык оригинала: ${targetLanguage}): "${sentence}".
Его перевод: "${nativeTranslation}".`;

  try {
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-20b',
        messages: [
          { role: 'system', content: AI_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 1024,
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Ошибка API: ${response.status} ${errorData.error?.message || ''}`);
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || 'Нет ответа от ИИ';
  } catch (error: any) {
    console.error('AI Service Error:', error);
    throw new Error(error.message || 'Не удалось получить объяснение');
  }
}
