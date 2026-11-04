import { generateGeminiText, isGeminiConfigured } from './geminiClient';

export interface StatisticsReportPayload {
  summary: {
    totalWords: number;
    seenWords: number;
    learnedWords: number;
    showsToday: number;
  };
  activity: {
    totalShows14Days: number;
    activeDays: number;
  };
  languages: { code: string; label: string; knownWords: number }[];
  repetition: {
    unseenWords: number;
    buckets: { label: string; count: number }[];
  };
  imw: {
    overall: number;
    byLanguage: { code: string; label: string; score: number }[];
  };
  workoutEfficiency?: {
    totalAnswers: number;
    knownAnswers: number;
    percent: number;
  };
  sentenceStatistics?: {
    totalAnalyses: number;
    uniqueSentences: number;
    todayAnalyses: number;
    topForms: { title: string; count: number; sentences: number }[];
    topCategories: { title: string; count: number }[];
  };
  structureSkills?: {
    role: string;
    roleLabel: string;
    language: string;
    independent: number;
    assisted: number;
    errors: number;
  }[];
}

export function buildStatisticsPrompt(payload: StatisticsReportPayload): string {
  return `Ты — опытный лингвистический наставник и персональный репетитор в приложении Papanda для интервального изучения иностранных языков.
Проанализируй подробную статистику ученика и составь структурированный, вдохновляющий и практичный отчёт с рекомендациями.

Данные статистики ученика:
${JSON.stringify(payload, null, 2)}

Требования к ответу:
1. Отвечай на русском языке в дружелюбном, ясном и мотивирующем тоне.
2. Используй простой Markdown (заголовки ###, списки *, жирный шрифт **слово**). Не используй таблицы и HTML.
3. Ответ должен содержать строго 3 логических блока:

### 📊 Оценка темпа и словарного запаса
- Оцени охват базы (${payload.summary.seenWords} из ${payload.summary.totalWords}) и процент выученных слов (${payload.summary.learnedWords}).
- Оцени индекс долговременного закрепления iMW (${payload.imw.overall.toFixed(1)}/100) и регулярность за 14 дней (${payload.activity.activeDays} акт. дней, ${payload.activity.totalShows14Days} показов).

### 🎯 Грамматика и разбор предложений
- Обрати внимание на частые грамматические формы и синтаксические роли из разборов.
- Отметь, какие формы уже встречаются регулярно, а где ученику требовалась помощь (подсказки или ошибки в определении ролей: подлежащее, сказуемое и т.д.).

### 💡 Персональные рекомендации и план
- Сформулируй 2–4 чётких конкретных действия на сегодня и ближайшие 2–3 дня (например: довести слова из определенной корзины показов, попрактиковать разбор конкретной роли, распределить нагрузку).

Будь конкретен, опирайся на реальные цифры ученика, избегай абстрактных общих фраз.`;
}

export function generateHeuristicReport(payload: StatisticsReportPayload): string {
  const parts: string[] = [];

  // 1. Оценка темпа и словарного запаса
  parts.push('### 📊 Оценка темпа и словарного запаса');
  const seenPct = payload.summary.totalWords > 0
    ? Math.round((payload.summary.seenWords / payload.summary.totalWords) * 100)
    : 0;
  const learnedPct = payload.summary.seenWords > 0
    ? Math.round((payload.summary.learnedWords / payload.summary.seenWords) * 100)
    : 0;

  parts.push(
    `* **Охват словаря**: начато **${payload.summary.seenWords} из ${payload.summary.totalWords}** слов (${seenPct}% всей базы). Полностью закреплено: **${payload.summary.learnedWords}** (${learnedPct}% от просмотренных).`
  );

  const imwScore = payload.imw.overall;
  let imwComment = 'начальный уровень закрепления.';
  if (imwScore >= 50) imwComment = 'отличная глубина долговременной памяти!';
  else if (imwScore >= 20) imwComment = 'хорошая основа, словарный запас начинает надежно оседать в памяти.';
  else if (imwScore > 0) imwComment = 'слова находятся на начальных стадиях интервального повторения.';

  parts.push(
    `* **Индекс прочности iMW**: **${imwScore.toFixed(1)} / 100** — ${imwComment}`
  );

  if (payload.activity.activeDays > 0) {
    parts.push(
      `* **Регулярность**: **${payload.activity.activeDays}** из 14 дней были активными (суммарно **${payload.activity.totalShows14Days}** показов).`
    );
  }

  // 2. Грамматика и разбор предложений
  parts.push('\n### 🎯 Грамматика и разбор предложений');
  if (payload.sentenceStatistics && payload.sentenceStatistics.totalAnalyses > 0) {
    const topForms = payload.sentenceStatistics.topForms.slice(0, 4).map(f => `**${f.title}** (${f.count})`).join(', ');
    parts.push(
      `* **Синтаксический разбор**: выполнено **${payload.sentenceStatistics.totalAnalyses}** завершённых разборов (${payload.sentenceStatistics.uniqueSentences} уникальных предложений).`
    );
    if (topForms) {
      parts.push(`* **Часто встречающиеся формы**: ${topForms}.`);
    }
  } else {
    parts.push(
      '* Разборы предложений пока не начаты или их мало. Регулярный разбор фраз помогает видеть грамматику в живом контексте.'
    );
  }

  if (payload.structureSkills && payload.structureSkills.length > 0) {
    const weak = payload.structureSkills.filter(s => s.errors > 0 || s.assisted > 0);
    const strong = payload.structureSkills.filter(s => s.independent > 0 && s.errors === 0 && s.assisted === 0);
    if (strong.length > 0) {
      parts.push(`* **Уверенно определяются роли**: ${strong.map(s => s.roleLabel).join(', ')}.`);
    }
    if (weak.length > 0) {
      parts.push(
        `* **Требуют закрепления**: ${weak.map(s => `**${s.roleLabel}** (${s.errors} ошибок, ${s.assisted} с подсказкой)`).join(', ')}.`
      );
    }
  }

  // 3. Персональные рекомендации и план
  parts.push('\n### 💡 Персональные рекомендации и план');
  if (payload.repetition.unseenWords > 20) {
    parts.push(
      '1. **Подключайте новые слова**: в базе ещё много неначатых карточек. Добавляйте по 5–10 новых слов в ежедневные сессии.'
    );
  } else {
    parts.push(
      '1. **Интервальное повторение**: почти вся база уже начата. Сосредоточьтесь на словах с 6–15 показами, чтобы перевести их в долговременную память.'
    );
  }

  const weakSkill = payload.structureSkills?.find(s => s.errors > 0 || s.assisted > 0);
  if (weakSkill) {
    parts.push(
      `2. **Фокус на синтаксисе**: в самостоятельном разборе обратите внимание на роль **«${weakSkill.roleLabel.toLowerCase()}»** — старайтесь находить её без подсказок.`
    );
  } else {
    parts.push(
      '2. **Практика связей**: разберите 2–3 предложения во вкладке «Разбор», обращая внимание на окончания и порядок слов.'
    );
  }

  if (payload.summary.showsToday < 10) {
    parts.push(
      '3. **Цель на сегодня**: пройти хотя бы одну полноценную тренировку слов (10–15 показов), чтобы поддержать дневную динамику.'
    );
  } else {
    parts.push(
      '3. **Отличный темп**: план показов на сегодня выполнен. Краткое повторение перед сном поможет закрепить изученное.'
    );
  }

  return parts.join('\n');
}

export async function analyzeStatisticsWithAi(
  payload: StatisticsReportPayload,
  signal?: AbortSignal
): Promise<string> {
  if (!isGeminiConfigured()) {
    return generateHeuristicReport(payload);
  }
  try {
    const prompt = buildStatisticsPrompt(payload);
    return await generateGeminiText(
      prompt,
      {
        temperature: 0.4,
        maxOutputTokens: 2048,
        thinkingConfig: { thinkingBudget: 256 },
      },
      undefined,
      signal
    );
  } catch (error) {
    console.warn('AI analysis failed or offline, using heuristic fallback:', error);
    return generateHeuristicReport(payload);
  }
}
