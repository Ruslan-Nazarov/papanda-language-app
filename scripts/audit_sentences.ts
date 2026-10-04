// Live quality sample; consumes the configured proxy's quota. No application data is changed.
// node --env-file=.env --import tsx scripts/audit_sentences.ts [output directory]
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { generateSentenceBatch } from '../src/services/sentenceGeneration';
import { baseStaticSentences, baseStaticWords } from '../src/store/catalog';
import { getLanguagePrompt } from '../src/services/sentencePrompts';

interface Case { id: string; code: string; count: number; lemma?: string }
interface Trace { stage: string; prompt: string; generationConfig: unknown; status?: number; response?: unknown; error?: string; elapsedMs?: number }
interface Run { scenario: Case; startedAt: string; elapsedMs: number; accepted: number; error?: string; sentences: Awaited<ReturnType<typeof generateSentenceBatch>>; requests: Trace[] }
const fullGroups: Case[][] = [
  [{ id: 'en-1', code: 'en', count: 10 }, { id: 'en-2', code: 'en', count: 10 },
    { id: 'en-expression', code: 'en', count: 1, lemma: 'take care of' }, { id: 'en-negative', code: 'en', count: 1, lemma: 'never' }],
  [{ id: 'kz-1', code: 'kz', count: 10 }, { id: 'kz-2', code: 'kz', count: 10 },
    { id: 'kz-noun', code: 'kz', count: 1, lemma: 'үй' }, { id: 'kz-verb', code: 'kz', count: 1, lemma: 'оқу' }],
  ...['de', 'fr', 'it', 'es', 'la'].map(code => [{ id: `${code}-1`, code, count: 8 }]),
];
const focusedGroups: Case[][] = [
  [{ id: 'en-1', code: 'en', count: 8 }, { id: 'en-expression', code: 'en', count: 1, lemma: 'take care of' }],
  [{ id: 'kz-1', code: 'kz', count: 8 }, { id: 'kz-noun', code: 'kz', count: 1, lemma: 'үй' }],
  ...['de', 'fr', 'it'].map(code => [{ id: `${code}-1`, code, count: 8 }]),
];

async function main() {
  const output = resolve(process.argv[2] || `sentence-audit-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  const groups = process.argv[3] === 'focused' ? focusedGroups : fullGroups;
  await mkdir(output, { recursive: true });
  const files = ['src/services/sentenceGeneration.ts', 'src/services/sentencePrompts.ts', 'src/services/sentenceCurriculum.ts', 'src/utils/sentenceValidation.ts'];
  const hashes = Object.fromEntries(await Promise.all(files.map(async file => [file, createHash('sha256').update(await readFile(file)).digest('hex')])));
  await writeFile(resolve(output, 'manifest.json'), JSON.stringify({ startedAt: new Date().toISOString(), node: process.version,
    dictionary: 'bundled static catalog; no personal progress', dictionarySize: baseStaticWords.length,
    scenarios: groups.flat(), hashes, maxRequests: 38, concurrency: 2 }, null, 2));
  const context = new AsyncLocalStorage<Trace[]>();
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  let stopReason = '';
  globalThis.fetch = async (input, init) => {
    if (stopReason || requestCount >= 38) {
      stopReason ||= 'Audit request budget reached';
      return Response.json({ error: stopReason, retryable: false }, { status: 429 });
    }
    requestCount++;
    const body = JSON.parse(String(init?.body));
    const trace: Trace = { stage: body.prompt.split('\n')[0], prompt: body.prompt, generationConfig: body.generationConfig };
    context.getStore()?.push(trace);
    const started = Date.now();
    try {
      const response = await originalFetch(input, init);
      trace.status = response.status;
      trace.response = await response.clone().json().catch(() => null);
      if (response.status === 429) stopReason = 'Proxy quota/rate limit reached';
      return response;
    } catch (error) {
      trace.error = String(error);
      throw error;
    } finally { trace.elapsedMs = Date.now() - started; }
  };
  const results: Run[] = [];
  const queue = [...groups];
  const worker = async () => {
    while (queue.length && !stopReason) {
      const group = queue.shift()!;
      const label = getLanguagePrompt(group[0].code).label;
      const history = baseStaticSentences.filter(sentence => sentence.language === label).map(sentence => sentence.sentence);
      for (const scenario of group) {
        if (stopReason) break;
        const run: Run = { scenario, startedAt: new Date().toISOString(), elapsedMs: 0, accepted: 0, sentences: [], requests: [] };
        const started = Date.now();
        await context.run(run.requests, async () => {
          try {
            run.sentences = await generateSentenceBatch(scenario.code, baseStaticWords, scenario.count,
              scenario.lemma ? { lemma: scenario.lemma } : undefined, history);
            run.accepted = run.sentences.length;
            history.push(...run.sentences.map(sentence => sentence.sentence));
          } catch (error) { run.error = error instanceof Error ? error.message : String(error); }
        });
        run.elapsedMs = Date.now() - started;
        await writeFile(resolve(output, `${scenario.id}.json`), JSON.stringify(run, null, 2));
        results.push(run);
        console.log(`${scenario.id}: ${run.accepted}/${scenario.count}, ${run.requests.length} requests, ${Math.round(run.elapsedMs / 1000)}s${run.error ? `; ${run.error}` : ''}`);
      }
    }
  };
  try { await Promise.all([worker(), worker()]); }
  finally { globalThis.fetch = originalFetch; }
  const summary = { finishedAt: new Date().toISOString(), requestCount, stopReason: stopReason || null,
    results: results.map(({ sentences: _sentences, requests, ...result }) => ({ ...result, requestCount: requests.length })),
    skipped: groups.flat().filter(scenario => !results.some(run => run.scenario.id === scenario.id)) };
  await writeFile(resolve(output, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(`Saved ${results.length} runs to ${output}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
