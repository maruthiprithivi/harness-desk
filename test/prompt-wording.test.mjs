import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {mineTranscripts,scopeCandidate} from '../lib/analysis.mjs';

const repo=path.resolve('/fixture/project'),other=path.resolve('/fixture/other');
const A='Please run the fixture checks and summarize any failures.';
const B='Run fixture checks, then summarize the failures.';
const C='Summarize failures after you run the fixture checks.';
const user=(text,sessionId,uuid,cwd=repo)=>({type:'user',cwd,sessionId,uuid,message:{role:'user',content:text}});
const hints=result=>result.candidates.filter(candidate=>candidate.kind==='similar prompts');
async function fixture(t) {
  const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'prompt-wording-')));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  return async(name,records)=>{
    const file=path.join(directory,name);
    await fs.writeFile(file,records.map(record=>JSON.stringify(record)).join('\n'));
    return file;
  };
}
async function group(t,wordings) {
  const write=await fixture(t);
  const files=await Promise.all([
    write('claude-one.jsonl',wordings.slice(0,2).map((text,index)=>user(text,'session-one','one-'+index))),
    write('claude-two.jsonl',wordings.slice(2).map((text,index)=>user(text,'session-two','two-'+index)))
  ]);
  return mineTranscripts(files);
}

test('local wording hints qualify phrasing and order variations with bounded scoped evidence and unknown savings',async t=>{
  const result=await group(t,[A,B,C]),candidate=hints(result)[0];
  assert.equal(hints(result).length,1);
  assert.equal(candidate.matching,'local-tfidf-v1');
  assert.equal(candidate.occurrences,3);assert.equal(candidate.distinctSessions,2);
  assert.equal(candidate.variants.length,3);assert.equal(candidate.examples.length,3);
  assert.equal(candidate.estTokens,Math.ceil((A.length+B.length+C.length)/4));
  assert.equal(candidate.estSaving,null);
  assert.deepEqual(candidate.repos,[repo]);assert.deepEqual(Object.keys(candidate.evidenceByRepo),[repo]);
  assert.deepEqual(candidate.evidenceByRepo[repo].variants,candidate.variants);
  const scoped=scopeCandidate(candidate,repo);
  assert.equal(scoped.estSaving,null);assert.equal(scoped.occurrences,3);assert.deepEqual(scoped.variants,candidate.variants);
  assert.equal(scopeCandidate(candidate,other),null);assert.equal(scopeCandidate(candidate,'',true),null);
  assert.deepEqual(result.coverage.wording,{method:'local-tfidf-v1',eligiblePatterns:3,comparedPatterns:3,limited:false});
  assert.equal(result.coverage.partial,false);
  for(const example of candidate.examples)assert.ok(example.length<=180);
  assert.equal(result.candidates.some(item=>item.kind==='prompt'),false);
});

test('unrelated tasks and a long shared instruction prefix do not establish task similarity',async t=>{
  const boilerplate=('Observe established architecture conventions while preserving compatibility documentation instrumentation boundary guarantees. ').repeat(8);
  const sets=[
    ['Inspect database migration transaction locking compatibility.','Inspect browser typography accessibility viewport contrast.'],
    [boilerplate+'Inspect invoice export currency rounding.',boilerplate+'Inspect customer account privacy deletion.']
  ];
  for(const [first,second]of sets)assert.deepEqual(hints(await group(t,[first,second,first])),[]);
});

test('negation, opposing actions and reversed directions remain exact-only',async t=>{
  for(const [first,second]of [
    ['Enable automatic invoice retry scheduling safely.','Disable automatic invoice retry scheduling safely.'],
    ['Keep generated regression fixture snapshot records.','Remove generated regression fixture snapshot records.'],
    ['Start scheduled database backup verification checks.','Stop scheduled database backup verification checks.'],
    ['Deploy invoice validation changes after successful tests.','Do not deploy invoice validation changes after successful tests.'],
    ['Increase automatic invoice retry scheduling safely.','Decrease automatic invoice retry scheduling safely.'],
    ['Allow automatic invoice retry scheduling safely.','Deny automatic invoice retry scheduling safely.'],
    ['Include automatic invoice retry scheduling safely.','Exclude automatic invoice retry scheduling safely.'],
    ['Increasing automatic invoice retry scheduling safely.','Decreasing automatic invoice retry scheduling safely.'],
    ['Allowed automatic invoice retry scheduling safely.','Denied automatic invoice retry scheduling safely.'],
    ['Including automatic invoice retry scheduling safely.','Excluding automatic invoice retry scheduling safely.'],
    ['Deploy invoice validation changes after successful tests.',"I won't deploy invoice validation changes after successful tests."],
    ['Activated automatic invoice retry scheduling safely.','Deactivated automatic invoice retry scheduling safely.'],
    ['Paused automatic invoice retry scheduling safely.','Resumed automatic invoice retry scheduling safely.'],
    ['Sent invoice reconciliation audit records from staging systems to production systems.','Sent invoice reconciliation audit records from production systems to staging systems.'],
    ['Keep HTML records and remove Markdown records.','Keep Markdown records and remove HTML records.'],
    ['Convert XML to JSON for invoice exports.','Convert JSON to XML for invoice exports.'],
    ['Move global agent instructions to repository instructions.','Move repository instructions to global agent instructions.']
  ])assert.deepEqual(hints(await group(t,[first,second,first])),[]);
});

test('complete-link grouping never turns a compatible bridge into a three-member group',async t=>{
  const first='Compare database migration rollback transaction schema index locking compatibility';
  const bridge=first+' cache timeout';
  const last='Compare rollback transaction schema index locking compatibility cache timeout';
  assert.equal(hints(await group(t,[first,bridge,first])).length,1);
  assert.equal(hints(await group(t,[bridge,last,bridge])).length,1);
  const result=await group(t,[first,bridge,first,last]);
  assert.equal(hints(result).length,1);assert.equal(hints(result)[0].variants.length,2);
  assert.ok(!hints(result)[0].variants.some(variant=>variant.pattern===last.toLowerCase()));
});

test('wording groups use only their own attributed repo and never borrow unknown evidence',async t=>{
  const write=await fixture(t);
  const one=await write('claude-one.jsonl',[user(A,'one','a1'),user(B,'one','a2'),user(B,'one','b1',other),user(C,'one','b2',other)]);
  const two=await write('claude-two.jsonl',[user(A,'two','a3'),user(C,'two','b3',other),user(C,'unknown','u1','relative/unknown')]);
  const result=await mineTranscripts([one,two]);
  assert.equal(hints(result).length,2);
  for(const candidate of hints(result)) {
    assert.equal(candidate.repos.length,1);assert.equal(candidate.occurrences,3);assert.equal(candidate.distinctSessions,2);
    assert.deepEqual(Object.keys(candidate.evidenceByRepo),candidate.repos);
    assert.equal(candidate.evidenceByRepo[candidate.repos[0]].occurrences,3);
    assert.equal(Object.hasOwn(candidate.evidenceByRepo,''),false);
  }
  assert.notEqual(hints(result)[0].id,hints(result)[1].id);
  const isolatedOne=await write('claude-isolated-one.jsonl',[user(A,'first','i1')]);
  const isolatedTwo=await write('claude-isolated-two.jsonl',[user(A,'second','i2'),user(B,'second','i3',other),user(B,'third','i4','relative/unknown')]);
  assert.deepEqual(hints(await mineTranscripts([isolatedOne,isolatedTwo])),[]);
});

test('session unions, agent attribution and overlapping exports preserve recurrence thresholds',async t=>{
  const write=await fixture(t);
  const one=await write('claude-one.jsonl',[user(A,'private-session-marker','event-one')]);
  const same=await write('claude-same.jsonl',[user(B,'private-session-marker','event-two'),user(C,'private-session-marker','event-three')]);
  assert.deepEqual(hints(await mineTranscripts([one,same])),[]);
  const codex=await write('codex-one.jsonl',[
    {type:'session_meta',payload:{cwd:repo,id:'private-session-marker'}},
    {type:'event_msg',uuid:'codex-one',payload:{type:'user_message',message:B}},
    {type:'event_msg',uuid:'codex-two',payload:{type:'user_message',message:C}}
  ]);
  const crossAgent=await mineTranscripts([one,codex]);
  assert.equal(hints(crossAgent).length,1);assert.deepEqual(hints(crossAgent)[0].agents,['claude','codex']);
  assert.equal(hints(crossAgent)[0].distinctSessions,2);
  assert.ok(!JSON.stringify(crossAgent).includes('private-session-marker'));
  const copy=await write('claude-copy.jsonl',[{...user(B,'private-session-marker','event-one'),exported:'overlap'}]);
  const two=await write('claude-two.jsonl',[user(C,'different-session','event-four')]);
  const deduplicated=await mineTranscripts([one,copy,two]);
  assert.equal(deduplicated.summary.duplicateRecords,1);assert.deepEqual(hints(deduplicated),[]);
  const identical=await write('claude-identical.jsonl',[user(A,'private-session-marker','event-one')]);
  const duplicated=await mineTranscripts([one,one,identical,two]);
  assert.equal(duplicated.summary.duplicatePaths,1);assert.equal(duplicated.summary.duplicateContents,1);assert.deepEqual(hints(duplicated),[]);
});

test('already qualifying exact prompts remain exact and do not overlap a local wording group',async t=>{
  const write=await fixture(t);
  const tool=name=>({type:'assistant',message:{role:'assistant',content:[{type:'tool_use',name,input:name==='Shell'?{command:'printf fixture'}:{}}]}});
  const task=(session,uuid)=>[user(A,session,uuid),tool('Read'),tool('Shell'),tool('Report')];
  const one=await write('claude-one.jsonl',[...task('one','one-a'),...task('one','one-b'),user(B,'one','one-c')]);
  const two=await write('claude-two.jsonl',[...task('two','two-a'),user(B,'two','two-b'),user(C,'two','two-c')]);
  const result=await mineTranscripts([one,two]),exact=result.candidates.find(item=>item.kind==='prompt');
  const digest=value=>createHash('sha256').update(value).digest('hex').slice(0,16);
  assert.equal(exact.id,digest('prompt'+A.toLowerCase()));assert.equal(exact.occurrences,3);assert.equal(exact.distinctSessions,2);
  assert.equal(result.candidates.find(item=>item.kind==='command').id,digest('commandprintf fixture'));
  assert.equal(result.candidates.find(item=>item.kind==='tool sequence').id,digest('tool sequenceRead → Shell → Report'));
  assert.equal(hints(result).length,1);
  assert.ok(hints(result)[0].variants.every(variant=>variant.pattern!==exact.pattern));
  assert.equal(hints(result)[0].occurrences,3);
});

test('variant membership and IDs are stable across selected file ordering, with five members maximum',async t=>{
  const write=await fixture(t),wordings=[A,B,C,
    'Fixture checks should run; summarize failures.',
    'Run checks for fixture and summarize failures.',
    'Summarize fixture failures and run checks.',
    'The fixture checks run and failures need a summary.'
  ];
  const one=await write('claude-one.jsonl',wordings.slice(0,3).map((text,index)=>user(text,'one','one-'+index)));
  const two=await write('claude-two.jsonl',wordings.slice(3).map((text,index)=>user(text,'two','two-'+index)));
  const first=hints(await mineTranscripts([one,two])),reordered=hints(await mineTranscripts([two,one]));
  assert.ok(first.length>0);assert.deepEqual(first,reordered);
  assert.ok(first.every(candidate=>candidate.variants.length<=5));
  assert.ok(first.every(candidate=>candidate.examples.length<=5));
});

test('comparison caps are deterministic and visible without treating short or oversized wording as corrupt',async t=>{
  const write=await fixture(t);
  const label=index=>'term'+String.fromCharCode(97+Math.floor(index/676),97+Math.floor(index/26)%26,97+index%26);
  const records=Array.from({length:514},(_,index)=>user('Inspect amber cedar maple willow '+label(index),'session-'+index,'event-'+index));
  const one=await write('claude-one.jsonl',records.slice(0,257)),two=await write('claude-two.jsonl',records.slice(257));
  const result=await mineTranscripts([one,two]),reordered=await mineTranscripts([two,one]);
  assert.deepEqual(result.coverage.wording,{method:'local-tfidf-v1',eligiblePatterns:514,comparedPatterns:512,limited:true});
  assert.deepEqual(result.coverage.wording,reordered.coverage.wording);
  assert.deepEqual(hints(result),hints(reordered));assert.equal(result.coverage.partial,true);
  assert.ok(result.coverage.issues.some(issue=>issue.includes('wording comparison was limited')));
  const ineligible=await write('claude-ineligible.jsonl',[user('Run tests please','one','short-one'),user('amber '.repeat(350),'two','long-one')]);
  const small=await mineTranscripts([ineligible]);assert.equal(small.coverage.partial,false);
  assert.deepEqual(small.coverage.wording,{method:'local-tfidf-v1',eligiblePatterns:0,comparedPatterns:0,limited:false});
});

test('wording hints cannot displace the existing hundred exact-match shortlist',async t=>{
  const write=await fixture(t);
  const exact=Array.from({length:100},(_,index)=>'Inspect fixed fixture checks for target'+String.fromCharCode(97+Math.floor(index/26),97+index%26)+' and summarize failures');
  const one=await write('claude-one.jsonl',[
    ...exact.flatMap((text,index)=>[user(text,'one','one-a-'+index),user(text,'one','one-b-'+index)]),
    user(A,'one','hint-a-one'),user(B,'one','hint-b-one')
  ]);
  const two=await write('claude-two.jsonl',[
    ...exact.map((text,index)=>user(text,'two','two-'+index)),
    user(A,'two','hint-a-two'),user(B,'two','hint-b-two')
  ]);
  const result=await mineTranscripts([one,two]);
  assert.equal(result.candidates.length,100);assert.deepEqual(hints(result),[]);
  const expected=new Set(exact.map(text=>createHash('sha256').update('prompt'+text.toLowerCase()).digest('hex').slice(0,16)));
  assert.deepEqual(new Set(result.candidates.map(candidate=>candidate.id)),expected);
  assert.ok(result.candidates.every(candidate=>candidate.kind==='prompt'&&candidate.occurrences===3&&candidate.distinctSessions===2));
  assert.deepEqual(result.coverage.wording,{method:'local-tfidf-v1',eligiblePatterns:2,comparedPatterns:2,limited:true});
  assert.equal(result.coverage.partial,true);
});

test('wording examples and patterns stay redacted and expose no raw session or event IDs',async t=>{
  const write=await fixture(t),marker=['gh','p_','syntheticfixturevalueforredaction'].join(''),field=['api','key'].join('_');
  const texts=[A,B,C].map(text=>text+' '+field+'='+marker);
  const one=await write('claude-one.jsonl',[user(texts[0],'private-identity-one','private-event-one'),user(texts[1],'private-identity-one','private-event-two')]);
  const two=await write('claude-two.jsonl',[user(texts[2],'private-identity-two','private-event-three')]);
  const result=await mineTranscripts([one,two]);assert.equal(hints(result).length,1);
  const serialized=JSON.stringify(result);
  for(const hidden of [marker,'private-identity-one','private-identity-two','private-event-one','private-event-two','private-event-three'])assert.ok(!serialized.includes(hidden));
  assert.ok(hints(result)[0].examples.every(example=>example.includes('[REDACTED]')));
});
