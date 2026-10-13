import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {mineTranscripts,scopeCandidate} from '../lib/analysis.mjs';

async function fixture(t) {
  const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'mining-scope-')));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  return async(name,records)=>{
    const file=path.join(directory,name);
    await fs.writeFile(file,typeof records==='string'?records:records.map(record=>JSON.stringify(record)).join('\n'));
    return file;
  };
}
const repoA=path.resolve('/fixture/a'),repoB=path.resolve('/fixture/b');
const prompt='Check the fixture and report its result';
const user=(cwd,extra={})=>({type:'user',...(cwd===undefined?{}:{cwd}),message:{role:'user',content:prompt},...extra});
const meta=(cwd,id)=>({type:'session_meta',payload:{cwd,...(id?{id}:{})}});
const tool=name=>({type:'assistant',message:{role:'assistant',content:[{type:'tool_use',name,input:{}}]}});
const candidate=result=>result.candidates.find(item=>item.kind==='prompt');

test('invalid message content blocks cannot discard or alter valid prompt evidence',async t=>{
  const write=await fixture(t),record={type:'user',cwd:repoA,message:{role:'user',content:[null,7,'unsupported',[],{type:'text',text:prompt},{type:'text',text:42}]}};
  const one=await write('claude-one.jsonl',[{...record,sessionId:'one',uuid:'one-a'},{...record,sessionId:'one',uuid:'one-b'}]);
  const two=await write('claude-two.jsonl',[{...record,sessionId:'two',uuid:'two-a'}]);
  const result=await mineTranscripts([one,two]);
  assert.equal(candidate(result).pattern,prompt.toLowerCase());
  assert.equal(candidate(result).evidenceByRepo[repoA].occurrences,3);
  assert.equal(result.coverage.supportedRecords,3);assert.equal(result.coverage.partial,true);
  assert.ok(result.coverage.issues.some(issue=>issue.includes('message content blocks')));
});

test('recognized event labels with unsupported bodies cannot count as an analyzed event',async t=>{
  const write=await fixture(t),file=await write('claude-unsupported.jsonl',[
    {type:'user',cwd:repoA,message:{role:'user',content:42}},
    {type:'assistant',message:{role:'assistant',content:{unknown:'unreadable body'}}},
    {type:'user',message:{role:'user'}},
  ]);
  const result=await mineTranscripts([file]);assert.equal(result.coverage.supportedRecords,0);
  assert.equal(result.coverage.unsupportedRecords,3);assert.deepEqual(result.candidates,[]);
});

test('working repositories follow events and never look ahead to later metadata',async t=>{
  const write=await fixture(t);
  const one=await write('codex-one.jsonl',[user(),meta(repoA,'one'),user(),{type:'turn_context',payload:{cwd:repoB}},user(),user()]);
  const two=await write('codex-two.jsonl',[meta(repoA,'two'),user(),{type:'turn_context',payload:{cwd:repoB}},user()]);
  const result=await mineTranscripts([one,two]),found=candidate(result);
  assert.equal(found.occurrences,6);
  assert.equal(found.evidenceByRepo[repoA].occurrences,2);
  assert.equal(found.evidenceByRepo[repoB].occurrences,3);
  assert.equal(scopeCandidate(found,repoA),null);
  assert.equal(scopeCandidate(found,repoB).occurrences,3);
  assert.equal(result.summary.unattributedRecords,1);
  assert.equal(Object.hasOwn(found.evidenceByRepo,''),false);
});

test('unknown, empty, relative, invalid and redacted cwd never qualify as global evidence',async t=>{
  const write=await fixture(t);
  const one=await write('claude-one.jsonl',[user(),user(''),user('relative/project'),user(7)]);
  const foreignPath=path.sep==='/'?'C:\\fixture\\project':'C:fixture\\project';
  const two=await write('claude-two.jsonl',[user('[REDACTED]'),user('/fixture/token=private-value'),user(foreignPath)]);
  const result=await mineTranscripts([one,two]),found=candidate(result);
  assert.equal(found.occurrences,7);
  assert.deepEqual(found.evidenceByRepo,{});
  assert.deepEqual(found.repos,[]);
  assert.equal(scopeCandidate(found,'',true),null);
  assert.equal(result.summary.unattributedRecords,7);
  assert.equal(JSON.stringify(result).includes('private-value'),false);
  assert.equal(result.coverage.partial,true);
});

test('an explicit unknown cwd clears previous attribution and flushes a tool sequence',async t=>{
  const write=await fixture(t);
  const task=[user(repoA),tool('Read'),tool('Test'),{type:'turn_context',payload:{cwd:''}},tool('Report')];
  const one=await write('codex-one.jsonl',[meta(repoA,'one'),...task,...task]);
  const two=await write('codex-two.jsonl',[meta(repoA,'two'),...task]);
  const result=await mineTranscripts([one,two]);
  assert.equal(result.candidates.some(item=>item.kind==='tool sequence'),false);
  assert.equal(result.summary.unattributedRecords,3);
});

test('tools do not join across working repositories or recorded sessions',async t=>{
  const write=await fixture(t);
  for(const boundary of [
    {type:'turn_context',payload:{cwd:repoB}},
    {type:'assistant',sessionId:'next-session',message:{role:'assistant',content:[]}},
  ]) {
    const task=[user(repoA),tool('Read'),tool('Test'),boundary,tool('Report')];
    const one=await write('codex-one.jsonl',[meta(repoA,'one'),...task,meta(repoA,'one'),...task]);
    const two=await write('codex-two.jsonl',[meta(repoA,'two'),...task]);
    const result=await mineTranscripts([one,two]);
    assert.equal(result.candidates.some(item=>item.kind==='tool sequence'),false);
  }
});

test('a changed recorded session cannot inherit a previous session repository',async t=>{
  const write=await fixture(t);
  const one=await write('claude-one.jsonl',[user(repoA,{sessionId:'first'}),user(undefined,{sessionId:'second'}),user()]);
  const two=await write('claude-two.jsonl',[user(repoA,{sessionId:'third'})]);
  const result=await mineTranscripts([one,two]),found=candidate(result);
  assert.equal(found.evidenceByRepo[repoA].occurrences,2);
  assert.equal(scopeCandidate(found,repoA),null);
  assert.equal(result.summary.unattributedRecords,2);
});

test('resolved duplicate paths and identical file contents cannot inflate recurrence',async t=>{
  const write=await fixture(t);
  const one=await write('claude-one.jsonl',[user(repoA)]);
  const duplicate=await write('claude-copy.jsonl',[user(repoA)]);
  const two=await write('claude-two.jsonl',[{type:'user',cwd:repoA,message:{role:'user',content:prompt},timestamp:'different export'}]);
  const result=await mineTranscripts([one,path.join(path.dirname(one),'nested','..',path.basename(one)),duplicate,two]);
  assert.deepEqual(result.candidates,[]);
  assert.equal(result.summary.selectedFiles,4);
  assert.equal(result.summary.distinctPaths,3);
  assert.equal(result.summary.duplicatePaths,1);
  assert.equal(result.summary.readFiles,3);
  assert.equal(result.summary.duplicateContents,1);
  assert.equal(result.summary.analyzedFiles,2);
  assert.equal(result.summary.supportedRecords,2);
});

test('recorded session identities survive changed exports and remain hashed',async t=>{
  const write=await fixture(t);
  for(const identity of [sessionId=>({sessionId}),session_id=>({session_id})]) {
    const one=await write('claude-one.jsonl',[user(repoA,identity('same-private-session')),user(repoA,identity('same-private-session'))]);
    const two=await write('claude-two.jsonl',[user(repoA,identity('same-private-session'))]);
    assert.deepEqual((await mineTranscripts([one,two])).candidates,[]);
  }
  const one=await write('codex-one.jsonl',[meta(repoA,'same-private-session'),user(),user()]);
  const two=await write('codex-two.jsonl',[meta(repoA,'same-private-session'),user()]);
  assert.deepEqual((await mineTranscripts([one,two])).candidates,[]);
  const distinct=await write('codex-distinct.jsonl',[meta(repoA,'other-private-session'),user()]);
  const result=await mineTranscripts([one,distinct]);
  assert.equal(candidate(result).distinctSessions,2);
  assert.equal(JSON.stringify(result).includes('private-session'),false);
  assert.equal(candidate(result).sessions.every(session=>/^session-[0-9a-f]{16}$/.test(session)),true);
});

test('overlapping exports deduplicate stable event IDs and keep the first selected event',async t=>{
  const write=await fixture(t);
  for(const key of ['uuid','id']) {
    const one=await write('claude-one.jsonl',[user(repoA,{sessionId:'session-one',[key]:'event-one'})]);
    const copy=await write('claude-copy.jsonl',[user(repoB,{sessionId:'session-one',[key]:'event-one',timestamp:'changed export',message:{role:'user',content:prompt+' again'}})]);
    const two=await write('claude-two.jsonl',[user(repoA,{sessionId:'session-two',[key]:'event-two'})]);
    const result=await mineTranscripts([one,copy,two]);
    assert.deepEqual(result.candidates,[]);
    assert.equal(result.summary.supportedRecords,2);
    assert.equal(result.summary.duplicateRecords,1);
    assert.deepEqual(result.mistakes,[]);
    assert.equal(result.coverage.issues.some(issue=>/first selected occurrence/.test(issue)),true);
    assert.equal(JSON.stringify(result).includes('session-one'),false);
    assert.equal(JSON.stringify(result).includes('event-one'),false);
    const third=await write('claude-three.jsonl',[user(repoA,{sessionId:'session-three',[key]:'event-three'})]);
    const found=candidate(await mineTranscripts([one,copy,two,third]));
    assert.equal(found.occurrences,3);
    assert.deepEqual(found.repos,[repoA]);
    assert.equal(found.evidenceByRepo[repoB],undefined);
  }
});

test('equal prompt text with different stable IDs remains legitimate repeat evidence',async t=>{
  const write=await fixture(t);
  const one=await write('claude-one.jsonl',[user(repoA,{sessionId:'session-one',uuid:'event-one'}),user(repoA,{sessionId:'session-one',uuid:'event-two'})]);
  const two=await write('claude-two.jsonl',[user(repoA,{sessionId:'session-two',uuid:'event-three'})]);
  const result=await mineTranscripts([one,two]);
  assert.equal(candidate(result).occurrences,3);
  assert.equal(result.summary.duplicateRecords,0);
});

test('skipped overlapping events cannot bridge tools across a user-task boundary',async t=>{
  const write=await fixture(t);
  const original=await write('claude-original.jsonl',[user(repoA,{sessionId:'first',uuid:'seen-first'}),user(repoA,{sessionId:'second',uuid:'seen-second'})]);
  const task=sessionId=>[user(repoA,{sessionId}),tool('Read'),tool('Test'),user(repoA,{sessionId,uuid:'seen-'+sessionId}),tool('Report')];
  const one=await write('claude-one.jsonl',[...task('first'),...task('first')]);
  const two=await write('claude-two.jsonl',task('second'));
  const result=await mineTranscripts([original,one,two]);
  assert.equal(result.summary.duplicateRecords,3);
  assert.equal(result.candidates.some(item=>item.kind==='tool sequence'),false);
});

test('supported-event coverage distinguishes invalid imports from valid results without repeats',async t=>{
  const write=await fixture(t);
  const malformed=await write('malformed.jsonl','private-malformed-body\nnull\n{}\n'+JSON.stringify(meta(repoA,'metadata-only')));
  const unsupported=await write('unsupported.json','{"unrecognized":"private-body"}');
  const invalid=await mineTranscripts([malformed,unsupported]);
  assert.equal(invalid.summary.supportedRecords,0);
  assert.equal(invalid.summary.malformedRecords,1);
  assert.equal(invalid.summary.excludedRecords,1);
  assert.equal(invalid.summary.unsupportedRecords,2);
  assert.equal(invalid.coverage.partial,true);
  assert.equal(invalid.warnings.length,2);
  assert.equal(JSON.stringify(invalid).includes('private-body'),false);
  assert.equal(JSON.stringify(invalid).includes('private-malformed-body'),false);
  const valid=await write('codex-valid.jsonl',[meta(repoA,'valid'),
    {type:'user',message:{role:'user',content:'yes'}},
    {type:'assistant',message:{role:'assistant',content:'done'}},
    {type:'tool',content:'finished'},
    {type:'response_item',payload:{type:'function_call',name:'shell',arguments:'{"cmd":"echo fixture"}'}},
  ]);
  const result=await mineTranscripts([valid]);
  assert.equal(result.summary.supportedRecords,4);
  assert.equal(result.summary.unsupportedRecords,0);
  assert.equal(result.coverage.partial,false);
  assert.deepEqual(result.candidates,[]);
  assert.deepEqual((await mineTranscripts([])).candidates,[]);
  assert.equal((await mineTranscripts([])).summary.supportedRecords,0);
});

test('unreadable files report bounded generic coverage while valid files are still analyzed',async t=>{
  const write=await fixture(t),valid=await write('valid.jsonl',[user(repoA)]);
  const result=await mineTranscripts([path.join(path.dirname(valid),'missing.jsonl'),valid]);
  assert.equal(result.summary.unreadableFiles,1);
  assert.equal(result.summary.readFiles,1);
  assert.equal(result.summary.supportedRecords,1);
  assert.equal(result.coverage.partial,true);
  assert.equal(result.coverage.issues.some(issue=>issue.includes(path.dirname(valid))),false);
  assert.equal(result.coverage.issues.length<=8,true);
});
