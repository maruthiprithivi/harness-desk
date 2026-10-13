import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../lib/store.mjs';
import {createApp} from '../server.mjs';

const answer=()=>JSON.stringify({name:'check-fixture',description:'Check a fixture when requested.',instructions:'Run the bundled fixture script with a selected input. Stop on errors.',scripts:[{name:'run.mjs',content:'console.log("Synthetic fixture result");\n'}],verification:'Run in an isolated fixture and check the exit code and concise output.',trigger:'Check the fixture input.',nonTrigger:'Explain an unrelated algorithm.'});
async function fixture(t,{dispatch=async()=>answer(),direct=false}={}) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'reusable-api-'));
  const home=path.join(dir,'fixture-home'),repo=path.join(dir,'repos','a'),other=path.join(dir,'repos','b');
  for(const root of [home,repo,other])await fs.mkdir(root,{recursive:true});
  const original=path.join(repo,'AGENTS.md');await fs.writeFile(original,'Synthetic instructions unchanged.');
  const store=await new Store(path.join(dir,'data')).init();
  await store.write('inventory/current.json',{scannedAt:'2026-01-01T00:00:00Z',items:[],warnings:[],repos:[repo,other]});
  await store.write('patterns.json',{candidates:[{id:'shared-pattern',kind:'command',pattern:'check fixture <path>',occurrences:6,distinctSessions:4,repos:[repo,other],evidenceByRepo:{[repo]:{occurrences:3,distinctSessions:2,agents:['codex'],examples:['Private synthetic example A'],sessions:['Session A']},[other]:{occurrences:3,distinctSessions:2,agents:['claude'],examples:['Private synthetic example B'],sessions:['Session B']}}}],mistakes:[]});
  let calls=0,lastPrompt='';
  const options={home,dataDir:store.root,probe:async()=>[{id:'codex',auth:direct?'signed-in':'unknown',dispatch:direct?'direct':'handoff'}],dispatch:args=>{calls++;lastPrompt=args.prompt;return dispatch(args);}};
  const servers=[];
  async function start(){const app=await createApp(options);await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));servers.push(app.server);const root='http://127.0.0.1:'+app.server.address().port;const state=()=>fetch(root+'/api/state').then(r=>r.json());const token=(await state()).csrfToken;const post=async(route,body)=>{const r=await fetch(root+route,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':token},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};return {app,root,state,post};}
  t.after(async()=>{for(const server of servers)if(server.listening)await new Promise(resolve=>server.close(resolve));await fs.rm(dir,{recursive:true,force:true});});
  const current=await start();
  const body={repo,task:'Check a synthetic fixture',notes:'Use one local input and a concise result.',placement:'repo',targetAgent:'codex',invocation:'explicit',autoSave:false,agent:'codex',model:'fixture-model'};
  const generate=patch=>current.post('/api/reusable',{...body,...patch,action:'generate'});
  const unchanged=async()=>{assert.equal(await fs.readFile(original,'utf8'),'Synthetic instructions unchanged.');assert.deepEqual(await fs.readdir(repo),['AGENTS.md']);assert.equal(await fs.access(path.join(dir,'executed')).then(()=>true,()=>false),false);};
  return {...current,dir,repo,other,body,generate,start,unchanged,calls:()=>calls,lastPrompt:()=>lastPrompt};
}
async function until(fn){for(let index=0;index<200;index++){const result=await fn();if(result)return result;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Synthetic response did not finish');}
async function finished(f,id){return until(async()=>{const chat=(await f.state()).conversations.find(c=>c.id===id);return chat?.status!=='running'&&chat?.reusable?.status!=='awaiting-response'?chat:null;});}

test('preview is bounded, exact-scope, redacted and never dispatches or creates a conversation',async t=>{
  const f=await fixture(t);
  const preview=await f.post('/api/reusable',{...f.body,action:'preview',candidateId:'shared-pattern'});assert.equal(preview.status,200);
  assert.equal(preview.body.request.candidate.occurrences,3);assert.equal(preview.body.request.candidate.distinctSessions,2);
  for(const value of [f.other,'Private synthetic example A','Private synthetic example B','Session A','Session B'])assert.equal(preview.body.prompt.includes(value),false,value);
  assert.equal(f.calls(),0);assert.equal((await f.state()).conversations.length,0);
  assert.equal((await f.post('/api/reusable',{...f.body,action:'preview',repo:'',candidateId:'shared-pattern',placement:'global'})).status,400);
  assert.equal((await f.post('/api/reusable',{...f.body,action:'preview',repo:f.other+'/missing'})).status,400);
  assert.equal((await f.post('/api/reusable',{...f.body,action:'preview',placement:'global',notes:''})).status,400);
  const sensitive=['sk','-','syntheticcredential12345'].join('');
  const redacted=await f.post('/api/reusable',{...f.body,action:'preview',notes:'Use this note '+sensitive});assert.equal(redacted.status,200);assert.equal(redacted.body.prompt.includes(sensitive),false);
  assert.equal((await fetch(f.root+'/api/reusable',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...f.body,action:'generate'})})).status,400);
  await f.unchanged();
});

test('review mode parses a handoff response, saves real private files, and preserves immutable scoped identity',async t=>{
  const f=await fixture(t);let chat=(await f.generate()).body;
  assert.equal(chat.status,'handoff');assert.equal(chat.reusable.status,'awaiting-response');assert.equal(chat.pinned,true);
  const preview=await f.post('/api/reusable',{...f.body,action:'preview'});assert.equal(chat.handoffText,preview.body.prompt);
  assert.equal((await f.post('/api/reusable',{action:'save',id:chat.id})).status,400);
  chat=(await f.post('/api/reply',{id:chat.id,content:answer()})).body;assert.equal(chat.reusable.status,'ready');
  assert.equal(Object.values(f.app.store.manifest).some(entry=>entry.kind==='reusable-bundle'),false);
  assert.equal((await f.post('/api/reusable',{action:'save',id:chat.id,repo:f.other})).status,400);
  chat=(await f.post('/api/reusable',{action:'save',id:chat.id})).body;assert.equal(chat.reusable.status,'saved');
  const persisted=await f.app.store.read('reusable/'+chat.id+'/bundle.json');assert.deepEqual(persisted.bundle,chat.reusable.bundle);assert.equal(persisted.request.repo,f.repo);
  for(const file of persisted.bundle.files){const relative='reusable/'+chat.id+'/'+file.path;assert.equal(await fs.readFile(await f.app.store.location(relative),'utf8'),file.content);assert.equal(f.app.store.manifest[relative].pinned,true);}
  assert.deepEqual((await f.post('/api/reusable',{action:'save',id:chat.id})).body,chat);
  assert.equal((await f.post('/api/chat',{id:chat.id,prompt:'Replace the saved workflow'})).status,400);
  assert.equal((await f.post('/api/conversation',{id:chat.id,pinned:false})).status,400);
  for(const entry of Object.values(f.app.store.manifest))entry.updatedAt='2000-01-01T00:00:00Z';
  const prune=await f.post('/api/prune',{days:1,preview:false});assert.equal(prune.status,200);
  const resumed=await f.start();assert.deepEqual((await resumed.state()).conversations.find(c=>c.id===chat.id),chat);
  assert.equal(f.calls(),0);await f.unchanged();
});

test('one-click automatic saving uses the exact preview without executing or installing scripts',async t=>{
  const f=await fixture(t,{direct:true});
  const preview=await f.post('/api/reusable',{...f.body,autoSave:true,action:'preview'});
  const initial=(await f.generate({autoSave:true})).body;assert.equal(initial.status,'running');
  const chat=await finished(f,initial.id);assert.equal(chat.reusable.status,'saved');assert.equal(f.calls(),1);assert.equal(f.lastPrompt(),preview.body.prompt);
  assert.equal((await f.app.store.storage()).byKind['reusable-bundle']>0,true);
  await f.unchanged();
});

test('an explicitly blank generation model uses the agent default despite routing preferences',async t=>{
  const f=await fixture(t);
  await f.app.store.saveSettings({...f.app.store.settings,routes:{global:{build:{agent:'codex',model:'routing-model'}},repos:{}}});
  const chat=(await f.generate({model:''})).body;
  assert.equal(chat.model,'');assert.equal(chat.agent,'codex');assert.equal(chat.reusableRequest.repo,f.repo);await f.unchanged();
});

test('missing details, invalid envelopes and sensitive generated code stay recoverable without saving',async t=>{
  const f=await fixture(t);let chat=(await f.generate({autoSave:true})).body;
  chat=(await f.post('/api/reply',{id:chat.id,content:JSON.stringify({needsDetails:'Which command checks this project?'})})).body;assert.equal(chat.reusable.status,'needs-details');
  chat=(await f.post('/api/chat',{id:chat.id,prompt:'Use the fixture checker',repo:f.other,targetAgent:'claude',agent:'claude',reusableRequest:{task:'Injected task'}})).body;assert.equal(chat.repo,f.repo);assert.equal(chat.reusableRequest.targetAgent,'codex');assert.equal(chat.reusable.status,'awaiting-response');
  chat=(await f.post('/api/reply',{id:chat.id,content:'This is prose rather than JSON.'})).body;assert.equal(chat.reusable.status,'invalid');assert.equal((await f.post('/api/reusable',{id:chat.id,action:'save'})).status,400);
  chat=(await f.post('/api/chat',{id:chat.id,prompt:'Please return the required JSON schema'})).body;
  const sensitive=['sk','-','syntheticcredential12345'].join('');const invalid=JSON.parse(answer());invalid.scripts[0].content='console.log("'+sensitive+'");';
  chat=(await f.post('/api/reply',{id:chat.id,content:JSON.stringify(invalid)})).body;assert.equal(chat.reusable.status,'invalid');assert.equal(JSON.stringify(chat).includes(sensitive),false);
  assert.equal(Object.values(f.app.store.manifest).some(entry=>entry.kind==='reusable-bundle'),false);
  chat=(await f.post('/api/chat',{id:chat.id,prompt:'Remove the sensitive value and use only the fixture'})).body;
  chat=(await f.post('/api/reply',{id:chat.id,content:answer()})).body;assert.equal(chat.reusable.status,'saved');await f.unchanged();
});

test('a manifest write failure retains the draft and retries an already-materialized bundle safely',async t=>{
  const f=await fixture(t);let chat=(await f.generate()).body;chat=(await f.post('/api/reply',{id:chat.id,content:answer()})).body;
  const write=f.app.store.write.bind(f.app.store);let fail=true;
  f.app.store.write=async(relative,...args)=>{if(relative==='manifest.json'&&fail){fail=false;throw new Error('Synthetic manifest write failure');}return write(relative,...args);};
  const rejected=await f.post('/api/reusable',{action:'save',id:chat.id});assert.equal(rejected.status,400);
  chat=(await f.state()).conversations.find(c=>c.id===chat.id);assert.equal(chat.reusable.status,'save-failed');assert.ok(chat.reusable.bundle);
  const saved=await f.post('/api/reusable',{action:'save',id:chat.id});assert.equal(saved.status,200);assert.equal(saved.body.reusable.status,'saved');
  assert.deepEqual(await fs.readdir(path.join(f.app.store.root,'reusable')),[chat.id]);await f.unchanged();
});

test('save retry rejects missing or altered bundle files without silently rewriting them',async t=>{
  const f=await fixture(t);let chat=(await f.generate()).body;chat=(await f.post('/api/reply',{id:chat.id,content:answer()})).body;
  const write=f.app.store.write.bind(f.app.store);let fail=true;f.app.store.write=async(relative,...args)=>{if(relative==='manifest.json'&&fail){fail=false;throw new Error('Synthetic manifest failure');}return write(relative,...args);};
  assert.equal((await f.post('/api/reusable',{action:'save',id:chat.id})).status,400);
  const script=chat.reusable.bundle.files.find(file=>file.path.endsWith('/run.mjs')),location=await f.app.store.location('reusable/'+chat.id+'/'+script.path);
  await fs.unlink(location);assert.equal((await f.post('/api/reusable',{action:'save',id:chat.id})).status,400);assert.equal(await fs.access(location).then(()=>true,()=>false),false);
  await fs.writeFile(location,'Altered synthetic script');assert.equal((await f.post('/api/reusable',{action:'save',id:chat.id})).status,400);assert.equal(await fs.readFile(location,'utf8'),'Altered synthetic script');
  await fs.writeFile(location,script.content);assert.equal((await f.post('/api/reusable',{action:'save',id:chat.id})).body.reusable.status,'saved');await f.unchanged();
});

test('restart parses a retained complete response and honors prior auto-save without another provider call',async t=>{
  const f=await fixture(t);const chat=(await f.generate({autoSave:true})).body;
  chat.status='complete';chat.messages.push({role:'assistant',content:answer(),at:'2026-01-01T00:00:00Z'});
  await f.app.store.saveConversation(chat);
  const resumed=await f.start(),recovered=(await resumed.state()).conversations.find(item=>item.id===chat.id);
  assert.equal(recovered.reusable.status,'saved');assert.equal(f.calls(),0);await f.unchanged();
});

test('cancellation and restart never send another automatic generation request',async t=>{
  const f=await fixture(t,{direct:true,dispatch:({signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('Synthetic cancellation')),{once:true}))});
  const chat=(await f.generate({autoSave:true})).body;assert.equal((await f.post('/api/cancel',{id:chat.id})).status,200);
  await until(async()=> (await f.state()).conversations.find(c=>c.id===chat.id)?.status==='cancelled');
  assert.equal(f.calls(),1);assert.equal(Object.values(f.app.store.manifest).some(entry=>entry.kind==='reusable-bundle'),false);
  const resumed=await f.start();assert.equal((await resumed.state()).conversations.find(c=>c.id===chat.id).status,'cancelled');assert.equal(f.calls(),1);await f.unchanged();
});
