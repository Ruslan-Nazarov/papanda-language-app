import './setup';
import { afterEach, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeStudySentence, extendStudySentence, translateStudySentence, parseMarkerHints } from '../src/services/sentenceStudy';
import { developmentExamples } from '../src/data/studyExamples';

const originalFetch=globalThis.fetch, originalURL=process.env.EXPO_PUBLIC_GEMINI_PROXY_URL;
beforeEach(()=>{process.env.EXPO_PUBLIC_GEMINI_PROXY_URL='https://test.invalid/v1/generate';});
afterEach(()=>{globalThis.fetch=originalFetch;if(originalURL===undefined)delete process.env.EXPO_PUBLIC_GEMINI_PROXY_URL;else process.env.EXPO_PUBLIC_GEMINI_PROXY_URL=originalURL;});
const base=developmentExamples('en')[0];
const annotate=(card=base)=>({...card,taskId:'task-1',review:{natural:true,taskFit:true,analysisReliable:true}});
const audit=[{taskId:'task-1',natural:true,translation:true,roles:true,morphology:true,chain:true,reason:''}];
const response=(data:unknown)=>Response.json({text:JSON.stringify(data)});
const phase=()=>{};
it('analyzes exact source and independently audits markers before returning',async()=>{
  const prompts:string[]=[];
  globalThis.fetch=async(_,init)=>{const prompt=JSON.parse(init!.body as string).prompt;prompts.push(prompt);return response(prompts.length===1?[annotate()]:audit);};
  const result=await analyzeStudySentence(base.sentence,'en',new AbortController().signal,phase);
  assert.equal(result.sentence,base.sentence);
  assert.equal(result.markerHints![0].source,'ai');
  assert.match(prompts[1],/marker explanations/);
  assert.equal(prompts.length,2);
});
it('rejects changed source before audit and fails closed on failed audit',async()=>{
  let calls=0;
  globalThis.fetch=async()=>{calls++;return response([{...annotate(),sentence:'The boy sleeps.'}]);};
  await assert.rejects(analyzeStudySentence(base.sentence,'en',new AbortController().signal,phase));
  assert.equal(calls,1);
  globalThis.fetch=async()=>response(++calls===2?[annotate()]:[{...audit[0],roles:false,reason:'wrong role'}]);
  await assert.rejects(analyzeStudySentence(base.sentence,'en',new AbortController().signal,phase),/wrong role/);
});
it('drops unanchored marker explanations rather than presenting invented forms',()=>{
  assert.deepEqual(parseMarkerHints([{...base.markerHints![0],evidence:[{tokenIndex:0,form:'invented'}]}],base),[]);
  assert.deepEqual(parseMarkerHints([{...base.markerHints![0],clauseIndex:99}],base),[]);
});
it('does not return a result that arrives after cancellation',async()=>{
  const controller=new AbortController();
  globalThis.fetch=async()=>{controller.abort();return response([annotate()]);};
  await assert.rejects(analyzeStudySentence(base.sentence,'en',controller.signal,phase), {name:'AbortError'});
});
it('accepts a preserved development and rejects changes to the predicate',async()=>{
  let next=developmentExamples('en')[1];
  globalThis.fetch=async(_,init)=>{const prompt=JSON.parse(init!.body as string).prompt;return response(prompt.startsWith('DEVELOP_')?{sentence:next.sentence}:prompt.startsWith('REVIEW_')?[annotate(next)]:audit);};
  assert.equal((await extendStudySentence(base,'en','добавь определение',new AbortController().signal,phase)).sentence,next.sentence);
  next={...next,sentence:next.sentence.replace('reads','sleeps'),words:next.words.map(w=>w.role==='Predicate'?{...w,text:'sleeps',dictionary_form:'sleep',translation:'спит',parts:['sleeps']}:w)};
  await assert.rejects(extendStudySentence(base,'en','добавь определение',new AbortController().signal,phase),/основу/);
});
it('checks semantic equivalence after translation and annotation',async()=>{
  const target=developmentExamples('de')[0];
  let equivalent=false;
  globalThis.fetch=async(_,init)=>{const prompt=JSON.parse(init!.body as string).prompt;return response(prompt.startsWith('TRANSLATE_')?{sentence:target.sentence}:prompt.startsWith('REVIEW_')?[annotate(target)]:prompt.startsWith('CHECK_')?{equivalent}:audit);};
  await assert.rejects(translateStudySentence(base,'de',new AbortController().signal,phase),/смысл/);
  equivalent=true;
  assert.equal((await translateStudySentence(base,'de',new AbortController().signal,phase)).language,'Deutsch');
});
