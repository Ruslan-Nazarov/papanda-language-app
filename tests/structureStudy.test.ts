import './setup';
import { beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { developmentExamples } from '../src/data/studyExamples';
import { LANGUAGES } from '../src/constants/languages';
import { studyGroups, selectionResult, structureSummary, addedTokenIndices } from '../src/utils/structureStudy';
import { tokensMatchSentence, preservesSentenceBasis } from '../src/utils/sentenceValidation';
import { useStore } from '../src/store/useStore';
import { createDefaultProgress } from '../src/store/progressTypes';
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
it('all seven authored chains preserve the basis and highlight only new occurrences', () => {
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
it('backs up structure attempts and accepts old backups', () => {
  useStore.getState().recordStructureAttempt(attempt());
  const saved = useStore.getState().exportProgress();
  useStore.getState().importProgress(createDefaultProgress());
  assert.equal(useStore.getState().importProgress(saved).ok,true);
  assert.equal(useStore.getState().structureAttempts.length,1);
  useStore.getState().resetStatistics();
  assert.equal(useStore.getState().structureAttempts.length,0);
});
