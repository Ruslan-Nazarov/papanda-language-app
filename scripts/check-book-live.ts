// Explicit opt-in: this makes real requests to the configured app proxy.
import '../tests/setup';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { explainSentenceWithAI } from '../src/services/aiService';
import { selectBookPassages, bookURL } from '../src/services/bookService';
import type { Token } from '../src/models/types';
async function main() {
  if (!process.argv.includes('--live')) throw new Error('This uses live AI quota. Pass --live explicitly.');
  const env = fs.readFileSync('.env', 'utf8').match(/^EXPO_PUBLIC_GEMINI_PROXY_URL\s*=\s*(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
  if (!env || env.includes('smoke.invalid') || !env.startsWith('https://')) throw new Error('A real HTTPS proxy URL is required in .env.');
  process.env.EXPO_PUBLIC_GEMINI_PROXY_URL = env;
  const kazakh = process.argv.includes('--kazakh');
  const language = kazakh ? 'Қазақша' : 'English';
  const tokens: Token[] = kazakh ? [
    { text:'Қыз', role:'Subject', label:'существительное', translation:'девочка', is_in_my_dict:false },
    { text:'ұйықтаған', role:'Predicate', label:'глагольная форма', translation:'часть отрицательного сказуемого', parts:['ұйықта','ған'], is_in_my_dict:false },
    { text:'жоқ', role:'Predicate', label:'отрицательное слово', translation:'не', is_in_my_dict:false },
  ] : [
    { text:'She', role:'Subject', label:'местоимение', translation:'она', is_in_my_dict:false },
    { text:'did', role:'Predicate', label:'вспомогательный глагол', translation:'прошедшее время', is_in_my_dict:false },
    { text:'not', role:'Predicate', label:'частица', translation:'не', is_in_my_dict:false },
    { text:'come', role:'Predicate', label:'глагол', translation:'пришла', is_in_my_dict:false },
  ];
  const sentence = kazakh ? 'Қыз ұйықтаған жоқ.' : 'She did not come.';
  const text = await explainSentenceWithAI(sentence, language, kazakh ? 'Девочка не спала.' : 'Она не пришла.', tokens, AbortSignal.timeout(60000));
  const sources = selectBookPassages(language, sentence, tokens);
  const allowed = new Set(sources.map(bookURL));
  const links = [...text.matchAll(/book:\/\/[^\s)]+/g)].map(m => m[0]);
  const result = { sentence, sourceCount:sources.length, answerLength:text.length, links, allLinksSupported:links.every(url => allowed.has(url)),
    layered:/подробности/i.test(text) && /основа предложения/i.test(text), text };
  fs.writeFileSync(kazakh ? 'eas-book-live-kz-local.json' : 'eas-book-live-local.json', JSON.stringify(result, null, 2));
  assert.ok(kazakh ? text.includes('жоқ') && text.includes('ұйықта') : text.includes('did') && text.includes('come'));
  assert.ok(links.length > 0, 'The live explanation should cite the book.');
  assert.ok(result.allLinksSupported, 'All live citations must be provided sources.');
  assert.ok(result.layered, 'The live explanation should distinguish the basis and details.');
  console.log(JSON.stringify({ live:true, language, answerLength:text.length, bookCitations:links.length, allLinksSupported:result.allLinksSupported, layered:result.layered }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
