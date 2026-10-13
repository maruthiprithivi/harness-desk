import test from 'node:test';
import assert from 'node:assert/strict';
import {capturePiVerification} from '../lib/pi-verification.mjs';
import {compareContextEvidence} from '../lib/context-evidence.mjs';
const options={agent:'omp',cwd:'/synthetic/project',repo:'/synthetic/project',input:'A fixed task.',started:1000,finished:2000,version:'18.6.0'};
const rows=()=>[
  {type:'session',version:3,id:'session-one',cwd:options.cwd,timestamp:new Date(1000).toISOString()},
  {type:'message_end',message:{role:'user',content:options.input}},
  {type:'message_update',usage:{input:99999}},
  {type:'message_end',message:{role:'assistant',provider:'fixture',model:'model',stopReason:'stop',content:[{type:'text',text:'Expected answer'}],usage:{input:10,cacheRead:20,cacheWrite:30,output:4}}},
  {type:'agent_end',messages:[],isTerminal:true}
];
const capture=(r=rows(),o=options)=>capturePiVerification(r.map(v=>JSON.stringify(v)).join('\n'),o);
test('Pi and OMP use completed response counters once, with their own profile and method',()=>{
  for(const agent of ['pi','omp']){const r=capture(rows(),{...options,agent});assert.equal(r.measurement.inputTokens,60);assert.equal(r.measurement.capacity,null);assert.equal(r.measurement.method,agent+'-first-request-input');assert.equal(r.measurement.model,'fixture/model');assert.equal(r.toolActivity,false);assert.equal(r.launch.sandbox,'none');}
});
test('resumed, extra-turn, interrupted, malformed and unmatched Pi streams fail closed',()=>{
  for(const mutate of [
    r=>r[0].parentSession='old',r=>r[0].timestamp=new Date(0).toISOString().replace('1970','1960'),r=>r[0].cwd='/other',r=>r[0].version=2,
    r=>r[1].message.content='Other task',r=>r.splice(2,0,r[1]),r=>r.splice(4,0,r[3]),r=>r[3].message.stopReason='error',
    r=>r[3].message.usage.input=-1,r=>delete r[3].message.usage.cacheRead,r=>r.pop(),r=>r.push({type:'agent_settled',aborted:true}),
    r=>r.splice(2,0,{type:'auto_retry_start'}),r=>r.splice(2,0,{type:'compaction_start'}),r=>r[3].message.role='custom'
  ]){const r=rows();mutate(r);assert.throws(()=>capture(r));}
});
test('observed tool execution is flagged and matching Pi runs can be compared',()=>{
  const r=rows();r.splice(3,0,{type:'tool_execution_start',args:{privateDetail:'PRIVATE'}});const result=capture(r);assert.equal(result.toolActivity,true);assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
  const before=capture().measurement,next=rows();next[0].id='session-two';next[3].message.usage.input=5;const after=capture(next).measurement;
  assert.equal(compareContextEvidence(before,after).reductionTokens,5);
});
