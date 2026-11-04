import './setup';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStatisticsPrompt,
  generateHeuristicReport,
  analyzeStatisticsWithAi,
  type StatisticsReportPayload,
} from '../src/services/statisticsAiService';

const samplePayload: StatisticsReportPayload = {
  summary: {
    totalWords: 500,
    seenWords: 120,
    learnedWords: 35,
    showsToday: 15,
  },
  activity: {
    totalShows14Days: 140,
    activeDays: 10,
  },
  languages: [
    { code: 'kz', label: 'Казахский', knownWords: 80 },
    { code: 'en', label: 'Английский', knownWords: 40 },
  ],
  repetition: {
    unseenWords: 380,
    buckets: [
      { label: '1–5 показов', count: 45 },
      { label: '6–15 показов', count: 40 },
      { label: '16–40 показов', count: 20 },
      { label: '41–80 показов', count: 10 },
      { label: 'больше 80', count: 5 },
    ],
  },
  imw: {
    overall: 18.5,
    byLanguage: [
      { code: 'kz', label: 'Казахский', score: 22.0 },
      { code: 'en', label: 'Английский', score: 15.0 },
    ],
  },
  workoutEfficiency: {
    totalAnswers: 50,
    knownAnswers: 42,
    percent: 84,
  },
  sentenceStatistics: {
    totalAnalyses: 12,
    uniqueSentences: 8,
    todayAnalyses: 3,
    topForms: [
      { title: 'Именительный падеж', count: 6, sentences: 5 },
      { title: 'Past Simple', count: 5, sentences: 4 },
      { title: 'Местный падеж', count: 2, sentences: 2 },
    ],
    topCategories: [
      { title: 'Существительное', count: 10 },
      { title: 'Глагол', count: 8 },
    ],
  },
  structureSkills: [
    { role: 'Predicate', roleLabel: 'Сказуемое', language: 'kz', independent: 4, assisted: 1, errors: 2 },
    { role: 'Subject', roleLabel: 'Подлежащее', language: 'kz', independent: 6, assisted: 0, errors: 0 },
  ],
};

it('builds a structured prompt containing student metrics and formatting guidelines', () => {
  const prompt = buildStatisticsPrompt(samplePayload);
  assert.ok(prompt.includes('500'));
  assert.ok(prompt.includes('120'));
  assert.ok(prompt.includes('18.5'));
  assert.ok(prompt.includes('Именительный падеж'));
  assert.ok(prompt.includes('Сказуемое'));
  assert.ok(prompt.includes('### 📊 Оценка темпа и словарного запаса'));
  assert.ok(prompt.includes('### 🎯 Грамматика и разбор предложений'));
  assert.ok(prompt.includes('### 💡 Персональные рекомендации и план'));
});

it('generates a detailed heuristic report with all 3 core sections', () => {
  const report = generateHeuristicReport(samplePayload);
  assert.ok(report.includes('### 📊 Оценка темпа и словарного запаса'));
  assert.ok(report.includes('### 🎯 Грамматика и разбор предложений'));
  assert.ok(report.includes('### 💡 Персональные рекомендации и план'));
  assert.ok(report.includes('120 из 500'));
  assert.ok(report.includes('18.5 / 100'));
  assert.ok(report.includes('Именительный падеж'));
  assert.ok(report.includes('Сказуемое'));
  assert.ok(report.includes('Подлежащее'));
});

it('analyzeStatisticsWithAi safely falls back to heuristic report when Gemini is unconfigured', async () => {
  const report = await analyzeStatisticsWithAi(samplePayload);
  assert.ok(typeof report === 'string');
  assert.ok(report.length > 50);
  assert.ok(report.includes('Оценка темпа и словарного запаса'));
});
