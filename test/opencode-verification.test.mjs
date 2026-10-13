import test from 'node:test';
import assert from 'node:assert/strict';
import {openCodeSession,captureOpenCodeVerification} from '../lib/opencode-verification.mjs';
const session='ses_fixture123',cwd='/synthetic/project';
const opts={session,cwd,repo:cwd,input:'Fixed task',started:1000,finished:2000,version:'1.18.35'};
const events=()=>[{type:'step_start',sessionID:session},{type:'text',sessionID:session,part:{type:'text',text:'Ready'}},{type:'step_finish',sessionID:session,part:{reason:'stop'}}];
const fixture=()=>({info:{id:session,directory:cwd,time:{created:1000}},messages:[
  {info:{id:'msg_user',sessionID:session,role:'user',time:{created:1100}},parts:[{type:'text',text:opts.input}]},
  {info:{id:'msg_assistant',parentID:'msg_user',sessionID:session,role:'assistant',modelID:'model',providerID:'provider',time:{completed:1900},finish:'stop'},parts:[{type:'step-start'},{type:'text',text:'Ready'},{type:'step-finish',reason:'stop',tokens:{input:10,output:5,reasoning:2,cache:{read:20,write:30}}}]}
]});
test('OpenCode finds only the emitted session and captures its completed first step including cache',()=>{
  assert.equal(openCodeSession(events().map(e=>JSON.stringify(e)).join('\n')),session);
  const result=captureOpenCodeVerification(JSON.stringify(fixture()),opts);assert.equal(result.measurement.inputTokens,60);assert.equal(result.measurement.outputTokens,7);assert.equal(result.measurement.capacity,null);assert.equal(result.answer,'Ready');assert.equal(result.measurement.model,'provider/model');
});
test('OpenCode rejects mixed identities, missing completion and tool calls before exporting',()=>{
  for(const mutate of [r=>r.pop(),r=>r[1].sessionID='ses_other',r=>r.push(r[2]),r=>r[1].type='tool_use',r=>r[2].part.reason='tool-calls',r=>r[1].type='error']){const r=events();mutate(r);assert.throws(()=>openCodeSession(r.map(e=>JSON.stringify(e)).join('\n')));}
});
test('OpenCode rejects old, forked, changed-scope, extra-request or incomplete exports',()=>{
  for(const mutate of [
    d=>d.info.parentID='ses_parent',d=>d.info.time.created=-10000,d=>d.info.directory='/other',d=>d.info.id='ses_other',
    d=>d.messages.push(d.messages[1]),d=>d.messages[0].parts[0].text='Other task',d=>d.messages[1].info.parentID='other',
    d=>d.messages[1].info.error={},d=>d.messages[1].parts.push({type:'tool'}),d=>d.messages[1].parts[2].tokens.input=-1,
    d=>delete d.messages[1].parts[2].tokens.cache,d=>d.messages[1].parts.push(d.messages[1].parts[2])
  ]){const d=fixture();mutate(d);assert.throws(()=>captureOpenCodeVerification(JSON.stringify(d),opts));}
});
