import { Word } from '../models/types';

export interface DailyShows {
  [dateString: string]: number; // dateString in YYYY-MM-DD
}

export interface WorkoutSnapshot {
  date: string; // YYYY-MM-DD
  total: number;
  correct: number;
}

/**
 * 1. Total Volume (Общий объем)
 * Общее количество уникальных слов в словаре пользователя.
 */
export const calculateTotalVolume = (words: Word[]): number => {
  return words.length;
};

/**
 * 2. Coverage (Охват базы)
 * Процент слов, которые пользователь встретил хотя бы один раз.
 */
export const calculateCoverage = (words: Word[], activeLangs: string[]) => {
  if (words.length === 0 || activeLangs.length === 0) {
    return { overall: 0, byLanguage: {} as Record<string, number> };
  }

  const byLanguage: Record<string, number> = {};
  let totalLangCoverage = 0;

  activeLangs.forEach(lang => {
    const coveredWords = words.filter(w => {
      const showStats = typeof w.show_stats === 'string' ? JSON.parse(w.show_stats) : w.show_stats;
      return showStats && showStats[lang] > 0;
    }).length;

    const langCoverage = (coveredWords / words.length) * 100;
    byLanguage[lang] = langCoverage;
    totalLangCoverage += langCoverage;
  });

  return {
    overall: totalLangCoverage / activeLangs.length,
    byLanguage
  };
};

/**
 * 3. iMW Index (Intelligent Memory Weight)
 * Индекс интеллектуального веса памяти. 80 показов - цель.
 */
export const calculateIMWIndex = (words: Word[], activeLangs: string[]) => {
  if (words.length === 0 || activeLangs.length === 0) return { overall: 0, byLanguage: {} as Record<string, number> };

  const byLanguage: Record<string, number> = {};
  let totalShows = 0;
  let overallTarget = 0;

  activeLangs.forEach(lang => {
    let langShows = 0;
    let activeWords = 0;
    
    words.forEach(w => {
      let showStats = w.show_stats;
      let statsObj: Record<string, number> = {};
      if (typeof showStats === 'string') {
        try {
          statsObj = JSON.parse(showStats);
        } catch (e) {
          statsObj = {};
        }
      } else if (showStats) {
        statsObj = showStats as Record<string, number>;
      }
      
      if (statsObj && statsObj[lang]) {
        langShows += statsObj[lang];
        activeWords++;
      }
    });

    const targetShows = activeWords * 80;
    const percentage = targetShows > 0 ? (langShows / targetShows) * 100 : 0;
    byLanguage[lang] = Math.min(100, Math.max(0, percentage)) || 0;
    
    totalShows += langShows;
    overallTarget += targetShows;
  });

  const overallPercentage = overallTarget > 0 ? (totalShows / overallTarget) * 100 : 0;
  const overall = Math.min(100, Math.max(0, overallPercentage)) || 0;

  return {
    overall,
    byLanguage
  };
};

/**
 * 4. Fully Learned (Полностью выученные)
 * Количество слов, которые отмечены как "Выучено" во ВСЕХ активных языках.
 */
export const calculateFullyLearned = (words: Word[], activeLangs: string[]): number => {
  if (activeLangs.length === 0) return 0;
  
  return words.filter(w => {
    const knowledgeStats = typeof w.knowledge_stats === 'string' ? JSON.parse(w.knowledge_stats) : w.knowledge_stats;
    if (!knowledgeStats) return false;
    
    // Check if it's learned (true or 1) in ALL active languages
    return activeLangs.every(lang => knowledgeStats[lang] === true || knowledgeStats[lang] === 1);
  }).length;
};

/**
 * 5. Known [Language] (Выучено по конкретному языку)
 * Количество выученных слов для каждого языка отдельно.
 */
export const calculateKnownByLanguage = (words: Word[], activeLangs: string[]) => {
  const byLanguage: Record<string, { count: number, percentage: number }> = {};
  
  if (words.length === 0) return byLanguage;

  activeLangs.forEach(lang => {
    const knownWords = words.filter(w => {
      const knowledgeStats = typeof w.knowledge_stats === 'string' ? JSON.parse(w.knowledge_stats) : w.knowledge_stats;
      return knowledgeStats && (knowledgeStats[lang] === true || knowledgeStats[lang] === 1);
    }).length;

    byLanguage[lang] = {
      count: knownWords,
      percentage: (knownWords / words.length) * 100
    };
  });

  return byLanguage;
};

/**
 * 6. Shown Today (Показано сегодня)
 * Общее количество показов слов за текущие сутки.
 */
export const calculateShownToday = (dailyShows: DailyShows): number => {
  const today = new Date().toISOString().split('T')[0];
  return dailyShows[today] || 0;
};

/**
 * 7. Distribution by Knowledge Level (Распределение по уровням знаний)
 * Группировка слов по среднему количеству показов.
 */
export const calculateKnowledgeDistribution = (words: Word[], activeLangs: string[]) => {
  const distribution = {
    new: 0,          // 0
    beginner: 0,     // 1-5
    intermediate: 0, // 6-15
    advanced: 0,     // 16-40
    expert: 0,       // 41-80
    master: 0        // 81+
  };

  if (activeLangs.length === 0) return distribution;

  words.forEach(w => {
    let totalWordShows = 0;
    const showStats = typeof w.show_stats === 'string' ? JSON.parse(w.show_stats) : w.show_stats;
    
    if (showStats) {
      activeLangs.forEach(lang => {
        if (showStats[lang]) {
          totalWordShows += showStats[lang];
        }
      });
    }

    const avgShows = totalWordShows / activeLangs.length;

    if (avgShows === 0) {
      distribution.new++;
    } else if (avgShows > 0 && avgShows <= 5) {
      distribution.beginner++;
    } else if (avgShows > 5 && avgShows <= 15) {
      distribution.intermediate++;
    } else if (avgShows > 15 && avgShows <= 40) {
      distribution.advanced++;
    } else if (avgShows > 40 && avgShows <= 80) {
      distribution.expert++;
    } else if (avgShows > 80) {
      distribution.master++;
    }
  });

  return distribution;
};

/**
 * 8. Familiar Words Efficiency (Эффективность тренировок)
 * Исторический график успешности прохождения тестов.
 */
export const calculateFamiliarWordsEfficiency = (snapshots: WorkoutSnapshot[]) => {
  return snapshots.map(snapshot => {
    const successRate = snapshot.total > 0 ? (snapshot.correct / snapshot.total) * 100 : 0;
    return {
      date: snapshot.date,
      absolute: snapshot.correct,
      percentage: successRate
    };
  });
};
