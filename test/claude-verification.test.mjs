import test from 'node:test';
import assert from 'node:assert/strict';
import { captureClaudeVerification } from '../lib/claude-verification.mjs';
import { compareContextEvidence } from '../lib/context-evidence.mjs';

const session='12345678-1234-4234-8234-123456789012';
const options={session,cwd:'/synthetic/project',repo:'/synthetic/project',input:'A fixed check.',started:1000,finished:2000};
const events=()=>[
  {type:'system',subtype:'hook_started',session_id:session},
  {type:'system',subtype:'init',session_id:session,cwd:options.cwd,claude_code_version:'2.1.296',model:'claude-model'},
  {type:'assistant',session_id:session,parent_tool_use_id:null,message:{id:'msg_one',role:'assistant',model:'claude-model',content:[{type:'text',text:'Expected answer'}],usage:{input_tokens:10,cache_read_input_tokens:100,cache_creation_input_tokens:200,output_tokens:12}}},
  {type:'result',session_id:session,subtype:'success',is_error:false,num_turns:1,result:'Expected answer',usage:{input_tokens:999999}}
];
const capture=(rows,opts=options)=>captureClaudeVerification(rows.map(row=>typeof row==='string'?row:JSON.stringify(row)).join('\n'),opts);

test('Claude captures first-response input including both cache fields, never cumulative result usage',()=>{
  const result=capture(events());assert.equal(result.measurement.inputTokens,310);assert.equal(result.measurement.outputTokens,12);assert.equal(result.measurement.capacity,null);
  assert.equal(result.answer,'Expected answer');assert.equal(result.toolActivity,false);assert.equal(result.measurement.agentVersion,'2.1.296');assert.equal(result.launch.sandbox,'none');
  assert.doesNotMatch(JSON.stringify(result),/999999|msg_one|A fixed check/);
});
test('missing identity, counters, completion and malformed records cannot become measured values',()=>{
  for(const mutate of [
    r=>r.pop(),r=>r.splice(1,1),r=>r[2].message.usage.input_tokens=-1,r=>delete r[2].message.usage.cache_read_input_tokens,
    r=>r[2].message.usage.cache_creation_input_tokens=null,r=>r[1].cwd='/other',r=>r[1].session_id='another',
    r=>delete r[1].claude_code_version,r=>r[2].parent_tool_use_id='subagent',r=>r[3].num_turns=2,r=>r[3].is_error=true,
    r=>r.splice(2,0,{type:'system',subtype:'compact_boundary'}),r=>r.push('broken JSON'),r=>r.push(r[3])
  ]){const rows=events();mutate(rows);assert.throws(()=>capture(rows));}
});
test('split assistant blocks do not double-count input or hide conflicting counters',()=>{
  const rows=events(),next=structuredClone(rows[2]);next.message.content=[{type:'text',text:'More text'}];next.message.usage.output_tokens=20;rows.splice(3,0,next);
  assert.equal(capture(rows).measurement.inputTokens,310);assert.equal(capture(rows).measurement.outputTokens,20);
  next.message.usage.input_tokens++;assert.throws(()=>capture(rows),/conflicting/);next.message.usage.input_tokens--;next.message.id='msg_two';assert.throws(()=>capture(rows),/more than one/);
});
test('tool attempts and denied permissions are independent failed-check evidence',()=>{
  const rows=events();rows[2].message.content.push({type:'tool_use',name:'Bash',input:{command:'PRIVATE'}});assert.equal(capture(rows).toolActivity,true);
  assert.doesNotMatch(JSON.stringify(capture(rows)),/PRIVATE|Bash/);
  const denied=events();denied[3].permission_denials=[{tool_name:'Bash'}];assert.equal(capture(denied).toolActivity,true);
});
test('Claude before-after comparison uses matching model, version, prompt and different sessions',()=>{
  const before=capture(events()).measurement,next=events();for(const row of next)row.session_id='22345678-1234-4234-8234-123456789012';next[2].message.usage.input_tokens=5;
  const after=capture(next,{...options,session:next[0].session_id}).measurement;
  assert.equal(compareContextEvidence(before,after).reductionTokens,5);assert.equal(compareContextEvidence(before,{...after,model:'other'}).comparable,false);
});
