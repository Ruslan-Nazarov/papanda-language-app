import './setup';
import { beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { developmentExamples, comparisonExamples } from '../src/data/studyExamples';
import { LANGUAGES } from '../src/constants/languages';
import { studyGroups, selectionResult, structureSummary, recommendStructureCard, addedTokenIndices, validateReadingSegments, suggestReadingSegments } from '../src/utils/structureStudy';
import { tokensMatchSentence, preservesSentenceBasis } from '../src/utils/sentenceValidation';
import { useStore } from '../src/store/useStore';
import { createDefaultProgress } from '../src/store/progressTypes';
import { parseProgress } from '../src/store/progressValidation';
import type { StructureAttempt } from '../src/models/study';
import type { Sentence } from '../src/models/types';

beforeEach(() => { useStore.getState().importProgress(createDefaultProgress()); });
const attempt = (overrides: Partial<StructureAttempt> = {}): StructureAttempt => ({ id:'a', sentenceId:'s', language:'English', role:'Predicate', clauseIndex:0, selected:[1], expected:[1], result:'correct', hintLevel:0, createdAt:'2026-10-09T00:00:00Z', ...overrides });
it('keeps discontinuous predicates together and separates clauses', () => {
  const roles = ['Subject','Predicate','Circumstance','Predicate','Subject','Predicate'] as const;
  const sentence: Sentence = { id:'test', language:'English', sentence:'She has already left; he stays.', words: ['She','has','already','left','he','stays'].map((text,i)=>({text,role:roles[i],label:'tag',translation:'перевод',is_in_my_dict:false,clauseIndex:i<4?0:1})) };
  const groups = studyGroups(sentence);
  assert.deepEqual(groups.filter(g=>g.role==='Predicate').map(g=>g.tokenIndices), [[1,3],[5]]);
  assert.deepEqual(selectionResult([1,2,2],[1,3]), {correct:false,missing:[3],extra:[2]});
  assert.equal(selectionResult([3,1,1],[1,3]).correct,true);
});
it('distinguishes independent, assisted and disputed answers without changing word progress', () => {
  const state = useStore.getState(), words = state.userWordProgress;
  [attempt(), attempt({id:'b',hintLevel:2}), attempt({id:'c',result:'incorrect'}), attempt({id:'d',result:'incorrect'})].forEach(state.recordStructureAttempt);
  state.disputeStructureAttempt('d');
  assert.deepEqual(structureSummary(useStore.getState().structureAttempts), [{language:'English',role:'Predicate',total:3,independent:1,assisted:1,errors:1}]);
  assert.equal(useStore.getState().userWordProgress, words);
  state.recordStructureAttempt(attempt({result:'incorrect'}));
  assert.equal(useStore.getState().structureAttempts.length,4);
});
it('recommends a card with the weak role in the same language', () => {
  const en = developmentExamples('en'), de = developmentExamples('de');
  assert.equal(recommendStructureCard([...de,...en], [attempt({role:'Object',result:'incorrect'})], 'English')?.id,en[2].id);
  assert.notEqual(recommendStructureCard(en,[], 'English',en[0].id)?.id,en[0].id);
});
it('all seven authored chains preserve the basis and highlight only new occurrences', () => {
  assert.equal(comparisonExamples().length,7);
  for (const {code} of LANGUAGES) {
    const chain = developmentExamples(code);
    for (const [i,sentence] of chain.entries()) {
      assert.ok(tokensMatchSentence(sentence.sentence,sentence.words),sentence.id);
      assert.ok(sentence.markerHints?.every(h=>h.evidence.every(e=>sentence.words[e.tokenIndex].text.includes(e.form))),sentence.id);
      if (i) {
        assert.ok(preservesSentenceBasis(chain[i-1],sentence),sentence.id);
        const added = addedTokenIndices(chain[i-1],sentence).map(j=>sentence.words[j].role);
        assert.ok(added.includes(i===1?'Attribute_Subject':i===2?'Object':'Circumstance'), sentence.id);
        assert.ok(!added.includes('Predicate') && !added.includes('Subject'),sentence.id);
      }
    }
  }
  const base=developmentExamples('en')[0];
  assert.deepEqual(addedTokenIndices(base,{...base,words:[...base.words,base.words[1]]}),[base.words.length]);
});
it('splits text as an editable proposal and rejects excess without truncating', () => {
  assert.equal(suggestReadingSegments('She reads. He listens!'), 'She reads.\nHe listens!');
  assert.deepEqual(validateReadingSegments('One.\n\nTwo.'), ['One.','Two.']);
  assert.throws(()=>validateReadingSegments('x'.repeat(601)),/600/);
  assert.throws(()=>validateReadingSegments(Array(21).fill('One.').join('\n')),/20/);
  assert.throws(()=>validateReadingSegments(Array(20).fill('x'.repeat(400)).join('\n')),/6000/);
});
it('backs up reading position, annotations and structure attempts; accepts old backups', () => {
  const card = developmentExamples('en')[0];
  useStore.getState().saveReadingText({id:'r',title:'Reading',language:'English',segments:['Other.',card.sentence],position:1,cards:{1:card}});
  useStore.getState().recordStructureAttempt(attempt());
  const saved = useStore.getState().exportProgress();
  useStore.getState().importProgress(createDefaultProgress());
  assert.equal(useStore.getState().importProgress(saved).ok,true);
  assert.equal(useStore.getState().readingTexts[0].position,1);
  assert.deepEqual(useStore.getState().readingTexts[0].cards['1'].markerHints, card.markerHints);
  assert.equal(useStore.getState().structureAttempts.length,1);
  useStore.getState().resetStatistics();
  assert.equal(useStore.getState().structureAttempts.length,0);
  assert.equal(useStore.getState().readingTexts.length,1);
  assert.deepEqual(parseProgress({userWordProgress:{}}).readingTexts,[]);
});
it('rejects invalid reading indices, text substitutions and marker references atomically', () => {
  const card = developmentExamples('en')[0];
  const valid = {id:'r',title:'Reading',language:'English',segments:[card.sentence],position:0,cards:{0:card}};
  const before = useStore.getState();
  for (const reading of [{...valid,position:1},{...valid,cards:{1:card}},{...valid,segments:['Changed.']},{...valid,language:'Deutsch'},
    {...valid,cards:{0:{...card,markerHints:[{...card.markerHints![0],evidence:[{tokenIndex:999,form:'x'}]}]}}}]) {
    assert.equal(useStore.getState().importProgress({...createDefaultProgress(),readingTexts:[reading]}).ok,false);
    assert.equal(useStore.getState(),before);
  }
  for(let i=0;i<10;i++) useStore.getState().saveReadingText({...valid,id:String(i)});
  assert.throws(()=>useStore.getState().saveReadingText({...valid,id:'11'}),/10 текстов/);
  assert.equal(useStore.getState().readingTexts.length,10);
});
