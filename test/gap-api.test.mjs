import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {Store} from '../lib/store.mjs';
import {createApp} from '../server.mjs';

async function fixture(t,{items=0,dispatch=async()=> 'Synthetic advice',probe}={}) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'harness-gap-api-'));
  const home=path.join(dir,'home'),repoA=path.join(dir,'repo-a'),repoB=path.join(dir,'repo-b');
  await fs.mkdir(home);await fs.mkdir(repoA);await fs.mkdir(repoB);
  const store=await new Store(path.join(dir,'data')).init();
  await store.write('inventory/current.json',{scannedAt:'2026-01-01T00:00:00Z',repos:[repoA,repoB],warnings:[],coverage:{partial:false},items:Array.from({length:items},(_,i)=>({id:'asset-'+i,name:'Fixture '+i,type:'skill',agent:'codex',scope:'project',repo:repoA,path:path.join(repoA,'skill-'+i+'.md'),residentTokens:10,bytes:40,estTokens:10,loadMode:'unknown',usage:'unknown'}))});
  const app=await createApp({home,dataDir:store.root,dispatch,probe:probe|| (async()=>[{id:'codex',installed:true,auth:'signed-in',dispatch:'direct'}])});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  t.after(async()=>{await new Promise(resolve=>app.server.close(resolve));await fs.rm(dir,{recursive:true,force:true});});
  const root='http://127.0.0.1:'+app.server.address().port;
  const state=()=>fetch(root+'/api/state').then(r=>r.json());
  const token=(await state()).csrfToken;
  const post=async(route,body)=>{const response=await fetch(root+route,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':token},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
  const gap=async(repo=repoA,title='Fixture gap')=>{const result=await post('/api/gap',{repo,title,evidence:'A reproducible fixture limitation',nextStep:'Draft and verify a scoped improvement'});assert.equal(result.status,200);return result.body;};
  return {app,dir,root,state,post,gap,repoA,repoB};
}
async function until(fn) {for(let i=0;i<200;i++){const result=await fn();if(result)return result;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Expected activity did not finish');}

test('state polling and rejected inputs do not manufacture gap observations',async t=>{
  let probes=0,requests=0;
  const {root,state,post}=await fixture(t,{probe:async()=>{probes++;return [{id:'codex',installed:true,auth:'signed-in',dispatch:'direct'}];},dispatch:async()=>{requests++;return 'Advice';}});
  const initial=(await state()).gaps;
  assert.ok(initial.some(g=>g.key==='capability.exact-loading-usage'));
  await state();await state();
  assert.equal((await post('/api/context',{sections:['unknown']})).status,400);
  assert.equal((await post('/api/gap',{title:'',evidence:'Invalid'})).status,400);
  assert.equal((await post('/api/prune',{days:2,preview:true})).status,400);
  assert.equal((await post('/api/journal',{})).status,400);
  assert.equal((await post('/api/unknown',{})).status,400);
  assert.equal((await fetch(root+'/api/gap',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,400);
  assert.deepEqual((await state()).gaps,initial);assert.equal(probes,1);assert.equal(requests,0);
});

test('manual gap API deduplicates by scope, redacts, and enforces effective resolution evidence',async t=>{
  const {post,state,repoA,repoB}=await fixture(t);
  const hidden='synthetic-value';const evidence=['token',hidden].join('=');
  const first=await post('/api/gap',{repo:repoA,title:'Repeat fixture',evidence});assert.equal(first.status,200);
  const again=await post('/api/gap',{repo:repoA,title:'Repeat fixture',evidence});assert.equal(again.body.id,first.body.id);assert.equal(again.body.occurrences,2);
  const other=await post('/api/gap',{repo:repoB,title:'Repeat fixture',evidence:'Separate repo fixture'});assert.notEqual(other.body.id,first.body.id);
  assert.equal(JSON.stringify((await state()).gaps).includes(hidden),false);
  assert.equal((await post('/api/gap',{id:first.body.id,status:'resolved'})).status,400);
  assert.equal((await post('/api/gap',{id:first.body.id,status:'resolved',verificationNote:'Synthetic regression passes'})).status,200);
  assert.equal((await post('/api/gap',{id:first.body.id,verificationNote:''})).status,400);
  const recurrence=await post('/api/gap',{repo:repoA,title:'Repeat fixture',evidence:'A new observation'});
  assert.equal(recurrence.body.status,'open');assert.equal(recurrence.body.verificationNote,'');
  assert.ok(recurrence.body.events.some(e=>e.type==='resolved'&&e.note.includes('Synthetic regression passes')));
});

test('gap context and activity reject other scopes and canonical conversations retain their link',async t=>{
  let requests=0;
  const {post,gap,repoA,repoB,state}=await fixture(t,{dispatch:async()=>{requests++;return 'Unused fixture';}});
  const a=await gap(repoA,'Only repo A'),b=await gap(repoB,'Only repo B');
  assert.equal((await post('/api/context',{repo:repoB,sections:['gaps'],gapIds:[a.id]})).status,400);
  const local=await post('/api/context',{repo:repoB,sections:['gaps']});
  assert.deepEqual(JSON.parse(local.body.text).gaps.map(g=>g.id),[b.id]);assert.equal(local.body.text.includes('Only repo A'),false);
  assert.equal((await post('/api/chat',{repo:repoB,agent:'claude',gapId:a.id,prompt:'Work on this gap'})).status,400);
  assert.equal((await post('/api/chat',{repo:repoA,agent:'claude',gapId:'missing',prompt:'Work on this gap'})).status,400);
  const work=await post('/api/chat',{repo:repoA,agent:'claude',gapId:a.id,prompt:'Work on this gap',sections:[]});
  assert.equal(work.status,200);assert.equal(work.body.status,'handoff');assert.deepEqual(JSON.parse(work.body.context.text).gaps.map(g=>g.id),[a.id]);
  let record=(await state()).gaps.find(g=>g.id===a.id);assert.equal(record.status,'in-progress');assert.deepEqual(record.conversationIds,[work.body.id]);
  await post('/api/reply',{id:work.body.id,content:'A draft improvement'});
  assert.equal((await state()).gaps.find(g=>g.id===a.id).status,'in-progress');
  assert.equal((await post('/api/chat',{id:work.body.id,gapId:b.id,prompt:'Change the link'})).status,400);
  await post('/api/gap',{id:a.id,status:'resolved',verificationNote:'Manually verified the fixture'});
  assert.equal((await post('/api/chat',{id:work.body.id,prompt:'Explain the result'})).status,200);
  record=(await state()).gaps.find(g=>g.id===a.id);assert.equal(record.status,'resolved');assert.deepEqual(record.conversationIds,[work.body.id]);assert.equal(requests,0);
});

test('agent failures become redacted scoped gaps without automatically resolving the linked gap',async t=>{
  const hidden='synthetic-failure-value';
  const {post,gap,repoA,state}=await fixture(t,{dispatch:async()=>{throw new Error('Fixture failure '+['token',hidden].join('='));}});
  const record=await gap();
  const work=await post('/api/chat',{repo:repoA,agent:'codex',gapId:record.id,prompt:'Investigate the fixture'});assert.equal(work.body.status,'running');
  const failed=await until(async()=> (await state()).gaps.find(g=>g.kind==='failure'&&g.source==='agent request'));
  assert.equal(failed.repo,repoA);assert.equal(failed.agent,'codex');assert.equal(failed.occurrences,1);assert.equal(failed.evidence.includes(hidden),false);
  const current=await state();assert.equal(current.conversations.find(c=>c.id===work.body.id).status,'failed');assert.equal(current.gaps.find(g=>g.id===record.id).status,'in-progress');
});

test('user cancellation does not create an operational failure gap',async t=>{
  const {post,gap,repoA,state}=await fixture(t,{dispatch:({signal})=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(new Error('Cancelled fixture')),{once:true});})});
  const record=await gap();const work=await post('/api/chat',{repo:repoA,agent:'codex',gapId:record.id,prompt:'Investigate this fixture'});
  assert.equal((await post('/api/cancel',{id:work.body.id})).status,200);
  await until(async()=> (await state()).conversations.find(c=>c.id===work.body.id&&c.status==='cancelled'));
  assert.equal((await state()).gaps.filter(g=>g.kind==='failure').length,0);
});

test('partial imports and bounded request context are logged, while repeated previews are deduplicated',async t=>{
  const {post,repoA,state,dir}=await fixture(t,{items:101});
  assert.equal((await post('/api/import-audit',{path:path.join(dir,'absent-audit')})).status,400);
  const audit=path.join(dir,'partial-audit');await fs.mkdir(audit);await fs.writeFile(path.join(audit,'inventory.csv'),'name,type\nFixture,skill\n');
  const partial=await post('/api/import-audit',{path:audit});assert.equal(partial.status,200);assert.ok(partial.body.warnings.length);
  const malformed=path.join(dir,'malformed.jsonl');await fs.writeFile(malformed,'not valid JSON');
  assert.equal((await post('/api/mine',{paths:[malformed]})).status,400);
  const body={repo:repoA,sections:['inventory']};assert.equal((await post('/api/context',body)).body.truncated,true);
  await post('/api/context',body);
  const records=(await state()).gaps;
  assert.ok(records.some(g=>g.kind==='failure'&&g.source==='audit import'));assert.ok(records.some(g=>g.key==='coverage:audit import'));assert.ok(records.some(g=>g.key==='coverage:transcript mining'));
  const context=records.find(g=>g.key==='coverage:request-context');assert.equal(context.repo,repoA);assert.equal(context.occurrences,1);
});

test('gaps context previews never count their own coverage warning as fresh evidence',async t=>{
  const {post,gap,repoA,state}=await fixture(t,{items:101});
  await post('/api/context',{repo:repoA,sections:['inventory']});
  for(let i=0;i<31;i++)await gap(repoA,'Short gap '+i);
  const body={repo:repoA,sections:['gaps']};assert.equal((await post('/api/context',body)).body.truncated,true);
  const before=(await state()).gaps.find(g=>g.key==='coverage:request-context').occurrences;
  await post('/api/context',body);await post('/api/context',body);
  assert.equal((await state()).gaps.find(g=>g.key==='coverage:request-context').occurrences,before);
});
