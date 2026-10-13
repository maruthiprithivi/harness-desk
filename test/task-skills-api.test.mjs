import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../lib/store.mjs';
import { createApp } from '../server.mjs';

test('task skill API validates requests and returns existing metadata without writes, body reads or dispatch',async t=>{
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'task-skills-api-'))),repo=path.join(dir,'synthetic-repo'),other=path.join(dir,'synthetic-other'),home=path.join(dir,'synthetic-home');
  const store=await new Store(path.join(dir,'data')).init();
  const rows=Array.from({length:150},(_,i)=>({id:'distractor-'+i,name:'Database migration',description:'Code projects and skills',type:'skill',agent:'codex',scope:'repo',repo,path:path.join(repo,'missing-'+i),residentTokens:10000-i}));
  const target={id:'target',name:'Migrations',description:'Database migrations',type:'skill',agent:'codex',scope:'repo',repo,path:path.join(repo,'nonexistent-skill','SKILL.md'),residentTokens:0};
  const saved={items:[...rows,target,{...target,id:'foreign',repo:other}],repos:[repo,{path:other}],scannedAt:'2020-01-01T00:00:00Z',coverage:{partial:false}};
  await store.write('inventory/current.json',saved);
  let dispatches=0,probes=0;
  const app=await createApp({home,dataDir:store.root,probe:async()=>{probes++;return [{id:'codex',installed:true,auth:'unknown',dispatch:'handoff'}];},dispatch:async()=>{dispatches++;throw new Error('Unexpected dispatch');}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>app.server.close(resolve));await fs.rm(dir,{recursive:true,force:true});});
  const url='http://127.0.0.1:'+app.server.address().port,state=()=>fetch(url+'/api/state').then(response=>response.json()),before=await state(),csrf=before.csrfToken;
  const savedBefore=await fs.readFile(path.join(store.root,'inventory/current.json'),'utf8');
  let writes=0;app.store.write=async()=>{writes++;throw new Error('Task lookup must not write');};
  const post=async(body,token=csrf)=>{const response=await fetch(url+'/api/task-skills',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':token},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
  const body={repo,agent:'codex',task:'Database migrations password=synthetic-private-value'},result=await post(body);
  assert.equal(result.status,200);assert.equal(result.body.coverage.eligible,151);assert.equal(result.body.coverage.matched,1);assert.deepEqual(result.body.candidates.map(row=>row.id),['target']);
  assert.equal(result.body.task,'Database migrations password=[REDACTED]');assert.equal(JSON.stringify(result.body).includes(other),false);
  assert.equal((await post({...body,repo:''})).body.coverage.eligible,0);
  for(const invalid of [{...body,repo:'/unscanned'},{...body,repo:repo+'/child'},{...body,agent:'model-gateway'},{...body,task:''},{...body,task:' '},{...body,task:'x'.repeat(2001)},{...body,task:null},{...body,repo:null},{agent:'codex',task:'Migration'},{repo,task:'Migration'},{...body,ids:['target']},{...body,globalOnly:true},{...body,action:'run'},{...body,provider:'codex'}]){
    const response=await post(invalid);assert.equal(response.status,400,JSON.stringify(invalid));assert.equal(typeof response.body.error,'string');
  }
  assert.equal((await post(body,'invalid')).status,400);
  const after=await state();assert.deepEqual(after.conversations,before.conversations);assert.deepEqual(after.history,before.history);assert.deepEqual(after.gaps,before.gaps);
  assert.equal(await fs.readFile(path.join(store.root,'inventory/current.json'),'utf8'),savedBefore);
  assert.equal(writes,0);assert.equal(dispatches,0);assert.equal(probes,1);
  await assert.rejects(fs.stat(target.path),{code:'ENOENT'});await assert.rejects(fs.stat(repo),{code:'ENOENT'});await assert.rejects(fs.stat(home),{code:'ENOENT'});
});
