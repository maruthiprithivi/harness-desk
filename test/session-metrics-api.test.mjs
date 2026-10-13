import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server.mjs';
import {Store} from '../lib/store.mjs';

async function fixture(t,agent='claude') {
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'session-metrics-api-')));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const home=path.join(dir,'home'),repo=path.join(dir,'repo'),other=path.join(dir,'other');
  for(const folder of [home,repo,other])await fs.mkdir(folder,{recursive:true});
  const instruction=path.join(repo,'AGENTS.md');await fs.writeFile(instruction,'Synthetic unchanged instructions.');
  const store=await new Store(path.join(dir,'data')).init();await store.saveSettings({...store.settings,repos:[repo,other],repoRoots:[]});
  let calls=0;
  const app=await createApp({home,dataDir:store.root,probe:async()=>[],dispatch:async()=>{calls++;throw new Error('Unexpected provider call');}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>app.server.close(resolve)));
  const url='http://127.0.0.1:'+app.server.address().port,state=()=>fetch(url+'/api/state').then(r=>r.json()),token=(await state()).csrfToken;
  const post=async(route,body)=>{const response=await fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':token},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
  assert.equal((await post('/api/scan',{})).status,200);
  const created=await post('/api/improvement',{action:'create',agent,repo,title:'Synthetic token comparison',change:'Shorter instructions',rollback:'Restore the synthetic backup',tasks:[{label:'Fixed check',prompt:'Check the synthetic fixture'}],assetIds:[]});assert.equal(created.status,200);
  const record=created.body,file=path.join(dir,'selected-session.jsonl');
  const rows=agent==='claude'?[{type:'assistant',sessionId:'synthetic-session-private',cwd:repo,message:{id:'synthetic-response-private',content:'synthetic-body-private',usage:{input_tokens:10,cache_creation_input_tokens:20,cache_read_input_tokens:30,output_tokens:40}}}]:[{type:'session_meta',payload:{id:'synthetic-session-private',cwd:repo}},{type:'token_usage_record',payload:{thread_id:'synthetic-session-private',response_id:'synthetic-response-private',usage:{input_tokens:70,output_tokens:30,total_tokens:100}}}];
  await fs.writeFile(file,rows.map(row=>JSON.stringify(row)).join('\n'));
  const body={id:record.id,taskId:record.tasks[0].id,phase:'before',path:file};
  const preview=(patch={})=>post('/api/improvement-session-preview',{...body,...patch});
  return {app,dir,repo,other,file,rows,record,body,post,preview,state,url,unchanged:async()=>{assert.equal(calls,0);assert.equal(await fs.readFile(instruction,'utf8'),'Synthetic unchanged instructions.');}};
}

test('explicit session token preview returns only bounded metadata and changes no run or source',async t=>{
  for(const agent of ['claude','codex']) {
    const f=await fixture(t,agent),before=await f.state(),manifest=structuredClone(f.app.store.manifest);
    const result=await f.preview();assert.equal(result.status,200);assert.equal(result.body.totalTokens,100);assert.equal(result.body.applicable,true);
    assert.equal(result.body.id,f.record.id);assert.equal(result.body.taskId,f.record.tasks[0].id);assert.equal(result.body.phase,'before');assert.equal(result.body.repo,f.repo);assert.equal(result.body.agent,agent);
    assert.ok(result.body.counter);assert.equal(result.body.coverage.responses,1);
    for(const privateValue of [f.file,'synthetic-session-private','synthetic-response-private','synthetic-body-private'])assert.equal(JSON.stringify(result.body).includes(privateValue),false);
    assert.deepEqual(await f.state(),before);assert.deepEqual(f.app.store.manifest,manifest);assert.equal((await f.app.store.read('improvements.json'))[0].runs.length,0);await f.unchanged();
  }
});

test('preview requires CSRF and binds to an open saved test task and current phase',async t=>{
  const f=await fixture(t),before=await f.state();
  assert.equal((await fetch(f.url+'/api/improvement-session-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(f.body)})).status,400);
  for(const patch of [{id:'missing'},{taskId:'unknown-task'},{phase:'after'},{agent:'codex'},{repo:f.other},{path:'relative.jsonl'},{path:null},{files:[]}])assert.equal((await f.preview(patch)).status,400);
  assert.deepEqual(await f.state(),before);
  for(let index=0;index<3;index++)assert.equal((await f.post('/api/improvement',{action:'run',id:f.record.id,taskId:f.record.tasks[0].id,runId:randomUUID(),passed:true,note:'Synthetic check passed',totalTokens:100,model:'fixture-model',agentVersion:'fixture-version',environment:'fixture-input',counter:'fixture-counter'})).status,200);
  assert.equal((await f.post('/api/improvement',{action:'candidate',id:f.record.id})).status,200);
  assert.equal((await f.preview()).status,400);
  const after=await f.preview({phase:'after'});assert.equal(after.status,200);assert.equal(after.body.phase,'after');
  assert.equal((await f.post('/api/improvement',{action:'decision',id:f.record.id,decision:'restored',note:'Synthetic test closed after restoring the prior setup'})).status,200);
  assert.equal((await f.preview()).status,400);await f.unchanged();
});

test('unavailable or unsafe selected files reject generically without path or body reflection',async t=>{
  const f=await fixture(t),missing=path.join(f.dir,'missing-private.jsonl'),secret=path.join(f.dir,'auth.jsonl'),linked=path.join(f.dir,'linked.jsonl'),hard=path.join(f.dir,'hard.jsonl'),oversized=path.join(f.dir,'large.jsonl'),invalid=path.join(f.dir,'invalid.jsonl');
  await fs.writeFile(secret,'synthetic-private-marker');await fs.symlink(f.file,linked);await fs.writeFile(oversized,'x'.repeat(2*1024*1024+1));await fs.writeFile(invalid,Buffer.from([0xff]));
  for(const file of [missing,secret,linked,oversized,invalid]) {
    const result=await f.preview({path:file});assert.equal(result.status,400);assert.equal(JSON.stringify(result.body).includes(file),false);assert.equal(JSON.stringify(result.body).includes('synthetic-private-marker'),false);
  }
  await fs.link(f.file,hard);for(const file of [f.file,hard])assert.equal((await f.preview({path:file})).status,400);
  assert.equal((await f.state()).improvements[0].runs.length,0);await f.unchanged();
});

test('wrong-scope and malformed usage produce a scoped generic gap without storing raw session evidence',async t=>{
  const f=await fixture(t);
  for(const rows of [[{...f.rows[0],cwd:f.other}],[{...f.rows[0],message:{...f.rows[0].message,usage:{input_tokens:10}}}]]) {
    await fs.writeFile(f.file,rows.map(row=>JSON.stringify(row)).join('\n'));
    const result=await f.preview();assert.equal(result.status,200);assert.equal(result.body.applicable,false);assert.equal(result.body.coverage.partial,true);
  }
  const after=await f.state(),gap=after.gaps.find(item=>item.key==='coverage:session-token-preview');assert.ok(gap);assert.equal(gap.repo,f.repo);assert.equal(gap.agent,'claude');
  const stored=JSON.stringify(await f.app.store.read('gaps/ledger.json'));
  for(const value of [f.file,'synthetic-body-private','synthetic-session-private','synthetic-response-private',f.other])assert.equal(stored.includes(value),false);
  assert.equal(after.improvements[0].runs.length,0);await f.unchanged();
});
