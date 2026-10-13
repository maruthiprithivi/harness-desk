import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../lib/store.mjs';
import {createApp} from '../server.mjs';

async function fixture(t) {
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'context-evidence-api-')));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const home=path.join(dir,'home'),repo=path.join(dir,'project');
  await fs.mkdir(home);await fs.mkdir(repo);await fs.writeFile(path.join(repo,'AGENTS.md'),'Synthetic project guidance.');
  const store=await new Store(path.join(dir,'data')).init();await store.saveSettings({...store.settings,repos:[repo],repoRoots:[]});
  let calls=0;
  const app=await createApp({home,dataDir:store.root,probe:async()=>[],dispatch:async()=>{calls++;throw new Error('Unexpected dispatch');}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>app.server.close(resolve)));
  const url='http://127.0.0.1:'+app.server.address().port;
  const state=()=>fetch(url+'/api/state').then(r=>r.json()),token=(await state()).csrfToken;
  const post=async body=>{const r=await fetch(url+'/api/context-evidence',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':token},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  await app.scanNow();
  async function session(id,input=120,model='fixture-model') {
    const file=path.join(dir,id+'.jsonl');
    const rows=[
      {type:'session_meta',timestamp:'2026-10-13T00:00:00Z',payload:{id,cwd:repo,cli_version:'0.162.1'}},
      {type:'turn_context',payload:{cwd:repo,model}},
      {type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'Synthetic private task text'}]}},
      {type:'event_msg',timestamp:'2026-10-13T00:00:01Z',payload:{type:'token_count',info:{model_context_window:1000,last_token_usage:{input_tokens:input,output_tokens:10,total_tokens:input+10},total_token_usage:{input_tokens:input,output_tokens:10,total_tokens:input+10}}}}
    ];
    await fs.writeFile(file,rows.map(row=>JSON.stringify(row)).join('\n'));return file;
  }
  const scope={agent:'codex',repo};
  return {app,url,post,state,repo,dir,session,scope,calls:()=>calls};
}

test('preview is read-only; capture stores derived counters, rejects stale evidence and deduplicates sessions',async t=>{
  const f=await fixture(t),file=await f.session('before'),body={...f.scope,path:file};
  const before=await f.state(),preview=await f.post({action:'preview',...body});
  assert.equal(preview.status,200);assert.equal(preview.body.applicable,true);assert.equal(preview.body.measurement.inputTokens,120);
  assert.equal(JSON.stringify(preview.body).includes('Synthetic private task text'),false);
  assert.deepEqual((await f.state()).contextEvidence,before.contextEvidence);
  assert.equal((await f.post({action:'capture',...body})).status,400);
  await fs.appendFile(file,'\n');
  assert.equal((await f.post({action:'capture',...body,sourceDigest:preview.body.sourceDigest})).status,400);
  const current=await f.post({action:'preview',...body});
  const saved=await f.post({action:'capture',...body,sourceDigest:current.body.sourceDigest});assert.equal(saved.status,200);assert.equal(saved.body.inputTokens,120);
  const duplicate=await f.post({action:'capture',...body,sourceDigest:current.body.sourceDigest});assert.equal(duplicate.body.id,saved.body.id);
  assert.equal((await f.state()).contextEvidence.length,1);
  const persisted=JSON.stringify(await f.app.store.read('context-evidence.json'));
  assert.equal(persisted.includes('Synthetic private task text'),false);assert.equal(persisted.includes(file),false);
  assert.equal(f.calls(),0);assert.equal(await fs.readFile(path.join(f.repo,'AGENTS.md'),'utf8'),'Synthetic project guidance.');
});

test('comparison uses saved readings and refuses changed conditions',async t=>{
  const f=await fixture(t),ids=[];
  for(const [id,tokens,model]of [['before',120,'fixture-model'],['after',90,'fixture-model'],['other',80,'other-model']]){
    const body={...f.scope,path:await f.session(id,tokens,model)},preview=await f.post({action:'preview',...body});
    const saved=await f.post({action:'capture',...body,sourceDigest:preview.body.sourceDigest});assert.equal(saved.status,200);ids.push(saved.body.id);
  }
  const compared=await f.post({action:'compare',beforeId:ids[0],afterId:ids[1]});assert.equal(compared.status,200);assert.equal(compared.body.comparable,true);assert.equal(compared.body.reductionTokens,30);
  const changed=await f.post({action:'compare',beforeId:ids[0],afterId:ids[2]});assert.equal(changed.body.comparable,false);
  assert.equal((await f.post({action:'compare',beforeId:'missing',afterId:ids[1]})).status,400);
  assert.equal((await f.post({action:'capture',...f.scope,path:await f.session('fake'),inputTokens:1,sourceDigest:'fake'})).status,400);
  assert.equal(f.calls(),0);
});

test('protected files, missing files, malformed records and CSRF cannot create readings',async t=>{
  const f=await fixture(t),secret=path.join(f.dir,'auth.jsonl');await fs.writeFile(secret,'private-marker');
  for(const file of [secret,path.join(f.dir,'missing.jsonl')]){
    const result=await f.post({action:'preview',...f.scope,path:file});assert.equal(result.status,400);assert.equal(JSON.stringify(result.body).includes(file),false);
  }
  const file=path.join(f.dir,'broken.jsonl');await fs.writeFile(file,'not-json');
  const preview=await f.post({action:'preview',...f.scope,path:file});assert.equal(preview.body.applicable,false);
  assert.equal((await f.post({action:'capture',...f.scope,path:file,sourceDigest:preview.body.sourceDigest})).status,400);
  const response=await fetch(f.url+'/api/context-evidence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'preview',...f.scope,path:file})});assert.equal(response.status,400);
  assert.equal((await f.state()).contextEvidence.length,0);
});
