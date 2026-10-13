import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../lib/store.mjs';
import {createApp} from '../server.mjs';

async function fixture(t) {
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'file-backup-api-')));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const home=path.join(root,'home'),repo=path.join(root,'repo'),other=path.join(root,'other');
  for(const folder of [home,repo,other])await fs.mkdir(folder);
  const file=path.join(repo,'AGENTS.md'),otherFile=path.join(other,'AGENTS.md');
  const original='# Original synthetic instructions\n';
  await fs.writeFile(file,original);await fs.writeFile(otherFile,'# Other repository\n');
  const store=await new Store(path.join(root,'data')).init();
  await store.saveSettings({...store.settings,repos:[repo,other]});
  let dispatches=0;
  const app=await createApp({home,dataDir:store.root,probe:async()=>[],dispatch:async()=>{dispatches++;throw new Error('No provider dispatch expected');}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>app.server.close(resolve)));
  const url='http://127.0.0.1:'+app.server.address().port;
  const state=()=>fetch(url+'/api/state').then(r=>r.json());
  const token=(await state()).csrfToken;
  const post=async(body,route='/api/file')=>{
    const response=await fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':token},body:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  };
  assert.equal((await post({},'/api/scan')).status,200);
  const inventory=(await state()).inventory,id=inventory.items.find(item=>item.path===file).id,otherId=inventory.items.find(item=>item.path===otherFile).id;
  return {app,url,post,state,id,otherId,file,otherFile,original,dispatches:()=>dispatches};
}

test('backup preview is read-only and the normal reviewed save can restore and back up the current version',async t=>{
  const f=await fixture(t),initial=await f.post({action:'read',id:f.id});
  assert.equal(initial.status,200);
  const changed='# Changed synthetic instructions\n',saved=await f.post({action:'save',id:f.id,version:initial.body.version,content:changed});
  assert.equal(saved.status,200);
  const beforeState=await f.state(),beforeManifest=JSON.stringify(f.app.store.manifest);
  const preview=await f.post({action:'backup',id:f.id,version:saved.body.version});
  assert.equal(preview.status,200);assert.equal(preview.body.id,f.id);assert.equal(preview.body.version,saved.body.version);assert.equal(preview.body.content,f.original);
  assert.ok(Number.isFinite(Date.parse(preview.body.backupAt)));
  assert.equal(await fs.readFile(f.file,'utf8'),changed);assert.equal(JSON.stringify(f.app.store.manifest),beforeManifest);
  assert.deepEqual((await f.state()).inventory,beforeState.inventory);assert.deepEqual((await f.state()).conversations,beforeState.conversations);
  const restored=await f.post({action:'save',id:f.id,version:preview.body.version,content:preview.body.content});
  assert.equal(restored.status,200);assert.equal(restored.body.saved,true);assert.equal(await fs.readFile(f.file,'utf8'),f.original);
  assert.equal((await f.post({action:'backup',id:f.id,version:restored.body.version})).body.content,changed);
  assert.equal(f.dispatches(),0);
});

test('backup HTTP requests enforce CSRF, current version, exact discovered source and no caller-chosen backup',async t=>{
  const f=await fixture(t),initial=(await f.post({action:'read',id:f.id})).body;
  const saved=(await f.post({action:'save',id:f.id,version:initial.version,content:'# Candidate\n'})).body;
  const body={action:'backup',id:f.id,version:saved.version};
  const noToken=await fetch(f.url+'/api/file',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal(noToken.status,400);
  for(const patch of [{version:initial.version},{version:''},{id:f.file},{id:f.otherId},{path:saved.backup},{content:f.original},{repo:'somewhere'}])assert.equal((await f.post({...body,...patch})).status,400);
  await fs.writeFile(f.file,'# External edit\n');
  assert.equal((await f.post(body)).status,400);assert.equal(await fs.readFile(f.file,'utf8'),'# External edit\n');
  assert.equal(await fs.readFile(f.otherFile,'utf8'),'# Other repository\n');assert.equal(f.dispatches(),0);
});

test('protected or tampered backup bytes never leave the API and a missing backup preserves current source',async t=>{
  const f=await fixture(t),initial=(await f.post({action:'read',id:f.id})).body;
  assert.equal((await f.post({action:'backup',id:f.id,version:initial.version})).status,400);
  assert.equal((await f.state()).gaps.some(gap=>gap.title==='Activity failed: file editor backup'),false);
  const saved=(await f.post({action:'save',id:f.id,version:initial.version,content:'# Candidate\n'})).body;
  const secret=['synthetic','private','backup','value'].join('-'),backupPath=await f.app.store.location(saved.backup);
  const key=['pass','word'].join('');await fs.writeFile(backupPath,key+' = '+secret+'\n');
  const result=await f.post({action:'backup',id:f.id,version:saved.version});
  assert.equal(result.status,400);assert.equal(JSON.stringify(result.body).includes(secret),false);
  const gaps=(await f.state()).gaps,record=gaps.find(gap=>gap.title==='Activity failed: file editor backup');
  assert.ok(record);assert.equal(JSON.stringify(gaps).includes(secret),false);assert.equal(record.repo,path.dirname(f.file));
  assert.equal(await fs.readFile(f.file,'utf8'),'# Candidate\n');assert.equal(f.dispatches(),0);
});
