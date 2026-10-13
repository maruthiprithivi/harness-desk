import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../lib/store.mjs';
import {createApp} from '../server.mjs';

async function fixture(t) {
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'configuration-api-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const home=path.join(root,'home'),repo=path.join(root,'repo');await fs.mkdir(home);await fs.mkdir(repo);
  const store=await new Store(path.join(root,'data')).init();await store.saveSettings({...store.settings,repos:[repo]});
  let dispatches=0;
  const app=await createApp({home,dataDir:store.root,probe:async()=>[],dispatch:async()=>{dispatches++;throw new Error('No provider expected');}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>app.server.close(resolve)));
  const url='http://127.0.0.1:'+app.server.address().port,state=()=>fetch(url+'/api/state').then(response=>response.json()),token=(await state()).csrfToken;
  const post=async(body,route='/api/configuration')=>{const response=await fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':token},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
  await post({},'/api/scan');return {home,repo,url,state,post,app,dispatches:()=>dispatches};
}

test('configuration API lists starters, creates one selected file, refreshes inventory and opens it in the protected editor',async t=>{
  const f=await fixture(t),before=await f.state(),targets=await f.post({action:'targets',agent:'claude',repo:f.repo});assert.equal(targets.status,200);
  assert.deepEqual((await f.state()).inventory,before.inventory);assert.deepEqual(await fs.readdir(f.repo),[]);
  const created=await f.post({action:'create',agent:'claude',repo:f.repo,target:'skill',name:'sample-task'});assert.equal(created.status,200);assert.equal(created.body.created,true);assert.ok(created.body.id);
  assert.ok(created.body.inventory.items.some(item=>item.id===created.body.id));
  const opened=await f.post({action:'read',id:created.body.id},'/api/file');assert.equal(opened.status,200);assert.equal(opened.body.language,'markdown');assert.equal(opened.body.editable,true);
  assert.equal((await f.state()).conversations.length,0);assert.equal(f.dispatches(),0);
});

test('configuration requests enforce CSRF, fixed targets and exact scanned scope',async t=>{
  const f=await fixture(t),valid={action:'create',agent:'codex',repo:f.repo,target:'instruction'};
  const missing=await fetch(f.url+'/api/configuration',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(valid)});assert.equal(missing.status,400);
  for(const patch of [{path:path.join(f.repo,'other.md')},{content:'custom bytes'},{target:'../../README.md'},{repo:f.home},{agent:'unknown'},{name:'unused'},{action:'targets',target:'instruction'}])assert.equal((await f.post({...valid,...patch})).status,400);
  assert.deepEqual(await fs.readdir(f.repo),[]);assert.equal(f.dispatches(),0);
});

test('repeat creation refuses overwrite while existing target opens by discovered identity',async t=>{
  const f=await fixture(t),body={action:'create',agent:'codex',repo:'',target:'config'};
  const first=await f.post(body);assert.equal(first.status,200);const original=await fs.readFile(first.body.path,'utf8');
  assert.equal((await f.post(body)).status,400);assert.equal(await fs.readFile(first.body.path,'utf8'),original);
  const targets=(await f.post({action:'targets',agent:'codex',repo:''})).body;const config=targets.targets.find(item=>item.key==='config');assert.equal(config.creatable,false);assert.equal(config.existingId,first.body.id);
  assert.equal((await f.post({action:'read',id:config.existingId},'/api/file')).body.language,'toml');assert.equal(f.dispatches(),0);
});
