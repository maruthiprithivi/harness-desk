import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../lib/store.mjs';
import {createApp} from '../server.mjs';

const answer=JSON.stringify({name:'count-fixture',description:'Count a selected fixture.',instructions:'Run [the counter](../scripts/count-fixture/run.mjs) with a fixture input.',scripts:[{name:'run.mjs',content:'console.log("Synthetic fixture only");'}],verification:'Check the synthetic count and non-trigger manually.',trigger:'Count the selected fixture.',nonTrigger:'Explain unrelated code.'});
async function fixture(t,options={}) {
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'adoption-api-'))),home=path.join(root,'fixture-home'),repo=path.join(root,'repo-fixture');
  for(const folder of [home,repo])await fs.mkdir(folder);
  await fs.writeFile(path.join(repo,'AGENTS.md'),'Synthetic instructions remain unchanged.');
  const store=await new Store(path.join(root,'data')).init();await store.write('inventory/current.json',{scannedAt:'2026-01-01T00:00:00Z',items:[],repos:[repo],warnings:[]});
  let calls=0;
  const app=await createApp({home,dataDir:store.root,probe:async()=>[],dispatch:async()=>{calls++;throw new Error('Unexpected synthetic provider request');}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>app.server.close(resolve));await fs.rm(root,{recursive:true,force:true});});
  const url='http://127.0.0.1:'+app.server.address().port,state=()=>fetch(url+'/api/state').then(r=>r.json()),token=(await state()).csrfToken;
  const post=async(body,route='/api/reusable-adoption')=>{const r=await fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':token},body:JSON.stringify(body)});return{status:r.status,body:await r.json()};};
  let chat=(await post({action:'generate',repo,task:'Count this synthetic fixture',targetAgent:'codex',placement:'repo',invocation:'explicit',autoSave:false,agent:'codex',...options},'/api/reusable')).body;
  const reply=async()=>{chat=(await post({id:chat.id,content:answer},'/api/reply')).body;return chat;};
  const save=async()=>{chat=(await post({action:'save',id:chat.id},'/api/reusable')).body;return chat;};
  const preview=()=>post({action:'preview',id:chat.id});
  const apply=(previewHash,patch={})=>post({action:'apply',id:chat.id,previewHash,reviewed:true,...patch});
  const restore=(adoptionId,patch={})=>post({action:'restore',adoptionId,reviewed:true,...patch});
  const unchanged=async()=>{assert.equal(await fs.readFile(path.join(repo,'AGENTS.md'),'utf8'),'Synthetic instructions remain unchanged.');assert.equal(calls,0);};
  return{root,home,repo,app,store:app.store,url,state,post,reply,save,preview,apply,restore,unchanged,chat:()=>chat};
}

test('saved workflow preview is read-only; reviewed adoption and recovery preserve instructions and provenance',async t=>{
  const f=await fixture(t);assert.equal((await f.preview()).status,400);await f.reply();assert.equal((await f.preview()).status,400);await f.save();
  const before=await f.state(),manifest=structuredClone(f.store.manifest),preview=await f.preview();
  assert.equal(preview.status,200);assert.equal(preview.body.root,path.join(f.repo,'.agents'));assert.equal(preview.body.conversationId,f.chat().id);assert.equal(preview.body.canApply,true);assert.deepEqual(await f.state(),before);assert.deepEqual(f.store.manifest,manifest);assert.deepEqual(await fs.readdir(f.repo),['AGENTS.md']);
  const applied=await f.apply(preview.body.previewHash);assert.equal(applied.status,200);assert.equal(applied.body.status,'installed');
  for(const file of f.chat().reusable.bundle.files)assert.equal(await fs.readFile(path.join(preview.body.root,file.path),'utf8'),file.content);
  assert.equal((await f.state()).adoptions.length,1);assert.equal(f.store.manifest['adoptions/'+applied.body.id+'.json'].pinned,true);
  assert.equal((await f.apply(preview.body.previewHash)).status,400);
  const restored=await f.restore(applied.body.id);assert.equal(restored.status,200);assert.equal(restored.body.status,'restored');
  const repeated=await f.restore(applied.body.id);assert.equal(repeated.status,200);assert.deepEqual(repeated.body,restored.body);
  for(const file of f.chat().reusable.bundle.files){await assert.rejects(fs.stat(path.join(preview.body.root,file.path)),{code:'ENOENT'});assert.equal(await fs.readFile(path.join(f.store.root,'_archive','adoptions',applied.body.id,file.path),'utf8'),file.content);}
  assert.equal((await f.state()).adoptions[0].status,'restored');await f.unchanged();
});

test('API binds original scope, requires explicit review and CSRF, and rejects client destinations or contents',async t=>{
  const f=await fixture(t);await f.reply();await f.save();const preview=(await f.preview()).body;
  const noToken=await fetch(f.url+'/api/reusable-adoption',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'apply',id:f.chat().id,previewHash:preview.previewHash,reviewed:true})});assert.equal(noToken.status,400);
  for(const patch of [{reviewed:false},{reviewed:'true'},{previewHash:'0'.repeat(64)},{repo:''},{root:f.home},{targetAgent:'claude'},{placement:'global'},{bundle:{}},{files:[]},{id:'../outside'}])assert.equal((await f.apply(preview.previewHash,patch)).status,400);
  assert.deepEqual(await fs.readdir(f.repo),['AGENTS.md']);assert.deepEqual(await fs.readdir(f.home),[]);
  const installed=(await f.apply(preview.previewHash)).body;
  for(const patch of [{reviewed:false},{reviewed:undefined},{repo:''},{root:f.home},{files:[]},{adoptionId:'../outside'}])assert.equal((await f.restore(installed.id,patch)).status,400);
  assert.equal((await f.restore(installed.id)).body.status,'restored');await f.unchanged();
});

test('a destination conflict invalidates a stale preview without replacing external files',async t=>{
  const f=await fixture(t);await f.reply();await f.save();const preview=(await f.preview()).body;
  const leaf=path.join(preview.root,'skills','count-fixture');await fs.mkdir(leaf,{recursive:true});await fs.writeFile(path.join(leaf,'SKILL.md'),'External synthetic skill');
  assert.equal((await f.apply(preview.previewHash)).status,400);const fresh=(await f.preview()).body;assert.equal(fresh.canApply,false);assert.ok(fresh.conflicts.length);
  assert.equal(await fs.readFile(path.join(leaf,'SKILL.md'),'utf8'),'External synthetic skill');assert.deepEqual((await f.state()).adoptions,[]);await f.unchanged();
});

test('edited installed files stay in place and a fresh server can recover the remaining owned files',async t=>{
  const f=await fixture(t);await f.reply();await f.save();const preview=(await f.preview()).body,installed=(await f.apply(preview.previewHash)).body;
  const edited=path.join(preview.root,'workflows','count-fixture.md');await fs.writeFile(edited,'External edited procedure');
  const other=await createApp({home:f.home,dataDir:f.store.root,probe:async()=>[]});await new Promise(resolve=>other.server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>other.server.close(resolve)));
  const url='http://127.0.0.1:'+other.server.address().port,state=await fetch(url+'/api/state').then(r=>r.json());assert.equal(state.adoptions[0].id,installed.id);
  const result=await fetch(url+'/api/reusable-adoption',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':state.csrfToken},body:JSON.stringify({action:'restore',adoptionId:installed.id,reviewed:true})});assert.equal(result.status,200);assert.equal((await result.json()).status,'restore-incomplete');
  assert.equal(await fs.readFile(edited,'utf8'),'External edited procedure');await assert.rejects(fs.stat(path.join(preview.root,'skills','count-fixture','SKILL.md')),{code:'ENOENT'});await f.unchanged();
  const after=await fetch(url+'/api/state').then(r=>r.json());assert.ok(after.gaps.some(gap=>gap.title==='Activity failed: workflow restoration'));
});

test('canonical bundles and recovery metadata cannot be changed to move unrelated files',async t=>{
  const f=await fixture(t);await f.reply();await f.save();const preview=(await f.preview()).body,installed=(await f.apply(preview.previewHash)).body;
  const receipt='adoptions/'+installed.id+'.json',record=await f.store.read(receipt);const original=JSON.stringify(record);
  record.root=f.home;await f.store.write(receipt,record,{kind:'workflow-adoption',pinned:true});assert.equal((await f.restore(installed.id)).status,400);
  await f.store.write(receipt,JSON.parse(original),{kind:'workflow-adoption',pinned:true});
  const source=path.join(f.store.root,'reusable',f.chat().id,'workflows','count-fixture.md');await fs.writeFile(source,'Changed canonical procedure');assert.equal((await f.restore(installed.id)).status,400);assert.equal((await f.preview()).status,400);
  for(const file of f.chat().reusable.bundle.files)assert.equal(await fs.readFile(path.join(preview.root,file.path),'utf8'),file.content);await f.unchanged();
});

test('global Claude adoption uses the home destination while preserving the original conversation repository',async t=>{
  const f=await fixture(t,{targetAgent:'claude',placement:'global',notes:'Shared fixture format across repositories.'});await f.reply();await f.save();const preview=(await f.preview()).body;
  assert.equal(preview.root,path.join(f.home,'.claude'));assert.equal(preview.repo,f.repo);assert.equal(preview.targetAgent,'claude');
  assert.equal((await f.apply(preview.previewHash)).body.status,'installed');assert.deepEqual(await fs.readdir(f.repo),['AGENTS.md']);assert.equal((await f.state()).adoptions[0].conversationId,f.chat().id);await f.unchanged();
});
