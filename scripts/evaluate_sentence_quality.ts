// Recheck the saved September 26 cards with the new independent quality gate.
// node --env-file=.env --import tsx scripts/evaluate_sentence_quality.ts
import { readFile, writeFile } from 'node:fs/promises';
import { generateGeminiText } from '../src/services/geminiClient';
import { planSentenceBatch } from '../src/services/sentenceCurriculum';
import { buildSentenceQualityPrompt, parseQualityVerdicts, QUALITY_VERDICT_SCHEMA } from '../src/services/sentenceQuality';

const dir = 'sentence-audit-2026-09-26';
const ids = ['en-2', 'kz-1', 'de-1', 'fr-1', 'it-1'];
const provider = process.argv[2] === 'cerebras' ? 'cerebras' : undefined;
const chunkSize = process.argv.includes('chunk4') ? 4 : 100;
async function main() {
const findings = JSON.parse(await readFile(`${dir}/findings.json`, 'utf8')) as {
  fixes: { run: string; taskId: string }[]; weak: { run: string; taskId: string }[];
};
const results = [];
for (const id of ids) {
  const run = JSON.parse(await readFile(`${dir}/${id}.json`, 'utf8'));
  const tasks = planSentenceBatch(run.scenario.count);
  const candidates = run.sentences;
  const started = Date.now();
  try {
    const raw = [];
    for (let index = 0; index < candidates.length; index += chunkSize) {
      const chunk = candidates.slice(index, index + chunkSize);
      const output = await generateGeminiText(buildSentenceQualityPrompt(run.scenario.code,
        tasks.filter(task => chunk.some((item: { generationTaskId: string }) => item.generationTaskId === task.id)),
        chunk, candidates.slice(0, index)), {
        temperature: 0.1, maxOutputTokens: 4096,
        responseMimeType: 'application/json', responseJsonSchema: QUALITY_VERDICT_SCHEMA,
      }, provider);
      raw.push(...JSON.parse(output));
    }
    const verdicts = parseQualityVerdicts(raw, tasks).filter(item => candidates.some((candidate: { generationTaskId: string }) => candidate.generationTaskId === item.taskId));
    const expectedFix = findings.fixes.filter(item => item.run === id).map(item => item.taskId);
    const expectedWeak = findings.weak.filter(item => item.run === id).map(item => item.taskId);
    results.push({ id, elapsedMs: Date.now() - started, expectedFix, expectedWeak, raw, verdicts });
    console.log(`${id}: rejected ${verdicts.filter(item => !item.passed).length}/${candidates.length}; caught ${verdicts.filter(item => !item.passed && expectedFix.includes(item.taskId)).length}/${expectedFix.length} confirmed defects`);
  } catch (error) {
    results.push({ id, elapsedMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) });
    console.log(`${id}: ${error}`);
  }
  await writeFile(`${dir}/quality-gate-evaluation${provider ? '-cerebras' : ''}${chunkSize === 4 ? '-chunk4' : ''}.json`, JSON.stringify({ evaluatedAt: new Date().toISOString(), provider: provider || 'proxy default', chunkSize, results }, null, 2));
}
}
main().catch(error => { console.error(error); process.exitCode = 1; });
