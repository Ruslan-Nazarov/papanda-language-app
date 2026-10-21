// Runs the same two-stage pipeline as the app; uses no personal dictionary.
// node --env-file=.env --import tsx scripts/demo_sentences.ts en 8 [required expression]
import { generateSentenceBatch } from '../src/services/sentenceGeneration';

async function main() {
  const [code = 'en', size = '8', lemma] = process.argv.slice(2);
  const started = Date.now();
  const sentences = await generateSentenceBatch(code, [], Number(size), lemma ? { lemma } : undefined);
  console.log(JSON.stringify({ code, requested: Number(size), accepted: sentences.length,
    elapsedMs: Date.now() - started, sentences }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
