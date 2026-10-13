import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../lib/store.mjs';
import {createApp} from '../server.mjs';

const answer=JSON.stringify({name:'count-fixture',description:'Count a selected fixture.',instructions:'Run [the counter](../scripts/count-fixture/run.mjs) with a fixture input.',scripts:[{name:'run.mjs',content:'console.log("Synthetic fixture: café");'}],verification:'Check the synthetic count and a non-trigger manually.',trigger:'Count the selected fixture.',nonTrigger:'Explain unrelated code.'});
async function fixture(t,options={}) {
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'reusable-export-api-'))),home=path.join(root,'fixture-home'),repo=path.join(root,'repo-fixture');
  for(const folder of [home,repo])await fs.mkdir(folder);
  await fs.writeFile(path.join(repo,'AGENTS.md'),'Synthetic instructions remain unchanged.');
  const store=await new Store(path.join(root,'data')).init();await store.write('inventory/current.json',{scannedAt:'2026-01-01T00:00:00Z',items:[],repos:[repo],warnings:[]});
  let calls=0;
  const app=await createApp({home,dataDir:store.root,probe:async()=>[],dispatch:async()=>{calls++;throw new Error('Unexpected synthetic provider request');}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>app.server.close(resolve));await fs.rm(root,{recursive:true,force:true});});
  const url='http://127.0.0.1:'+app.server.address().port,state=()=>fetch(url+'/api/state').then(r=>r.json()),token=(await state()).csrfToken;
  const post=async(body,route='/api/reusable')=>{const r=await fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':token},body:JSON.stringify(body)});return{status:r.status,body:await r.json()};};
  let chat=(await post({action:'generate',repo,task:'Count this synthetic fixture',notes:'PRIVATE-SYNTHETIC-NOTES',targetAgent:'codex',placement:'repo',invocation:'explicit',autoSave:false,agent:'codex',...options})).body;
  assert.equal(chat.status,'handoff');
  const reply=async(content=answer)=>{chat=(await post({id:chat.id,content},'/api/reply')).body;return chat;};
  const save=async()=>{chat=(await post({action:'save',id:chat.id})).body;return chat;};
  const exported=patch=>post({action:'export',id:chat.id,...patch});
  const unchanged=async()=>{assert.deepEqual(await fs.readdir(repo),['AGENTS.md']);assert.deepEqual(await fs.readdir(home),[]);assert.equal(await fs.readFile(path.join(repo,'AGENTS.md'),'utf8'),'Synthetic instructions remain unchanged.');assert.equal(calls,0);};
  return{app,store:app.store,root,home,repo,url,state,post,reply,save,exported,unchanged,chat:()=>chat};
}

test('canonical ready and saved exports are bounded ZIP files with no persistence, execution or private request data',async t=>{
  const f=await fixture(t);await f.reply();assert.equal(f.chat().reusable.status,'ready');
  for(const saved of [false,true]) {
    if(saved)await f.save();
    const before=await f.state(),manifest=structuredClone(f.store.manifest),result=await f.exported();
    assert.equal(result.status,200);assert.equal(result.body.filename,'count-fixture.zip');assert.equal(result.body.contentType,'application/zip');assert.equal(result.body.encoding,'base64');
    const zip=Buffer.from(result.body.data,'base64');assert.equal(zip.readUInt32LE(0),0x04034b50);assert.ok(zip.length<100*1024);
    assert.deepEqual(result.body.files,['skills/count-fixture/SKILL.md','workflows/count-fixture.md','scripts/count-fixture/run.mjs','skills/count-fixture/agents/openai.yaml','INSTALL.md']);
    const text=zip.toString('utf8');for(const marker of [f.repo,f.home,f.root,'PRIVATE-SYNTHETIC-NOTES',f.chat().id,'Handoff prepared'])assert.equal(text.includes(marker),false,marker);
    assert.ok(text.includes('Synthetic fixture: café'));assert.ok(text.includes('../scripts/count-fixture/run.mjs'));assert.ok(text.includes('INSTALL.md'));
    assert.deepEqual(await f.state(),before);assert.deepEqual(f.store.manifest,manifest);await f.unchanged();
  }
});

test('exports require valid current output, CSRF and immutable identity rather than caller files or targets',async t=>{
  const f=await fixture(t);assert.equal((await f.exported()).status,400);
  await f.reply('{"needsDetails":"Which fixture format?"}');assert.equal((await f.exported()).status,400);
  await f.post({id:f.chat().id,prompt:'Use the bounded fixture schema'},'/api/chat');await f.reply('Invalid prose');assert.equal((await f.exported()).status,400);
  await f.post({id:f.chat().id,prompt:'Return strict JSON'},'/api/chat');await f.reply();
  const noToken=await fetch(f.url+'/api/reusable',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'export',id:f.chat().id})});assert.equal(noToken.status,400);
  for(const patch of [{id:'../outside'},{repo:f.repo+'/'},{repo:''},{repo:null},{targetAgent:'claude'},{placement:'global'},{bundle:{files:[]}},{path:'/synthetic/outside'},{request:{repo:''}}])assert.equal((await f.exported(patch)).status,400);
  const changed=structuredClone(f.chat());changed.reusable.bundle.files[0].content+='Changed';await f.store.saveConversation(changed);assert.equal((await f.exported()).status,400);
  await f.unchanged();
});

test('saved exports reject changed, missing or linked files and metadata without silently repairing anything',async t=>{
  const f=await fixture(t);await f.reply();await f.save();
  const chat=f.chat(),directory=path.join(f.store.root,'reusable',chat.id),script=chat.reusable.bundle.files.find(file=>file.path.endsWith('/run.mjs')),location=path.join(directory,script.path);
  await fs.writeFile(location,'Changed synthetic source');assert.equal((await f.exported()).status,400);assert.equal(await fs.readFile(location,'utf8'),'Changed synthetic source');
  await fs.rm(location);assert.equal((await f.exported()).status,400);
  const outside=path.join(f.root,'external-fixture.mjs');await fs.writeFile(outside,script.content);await fs.symlink(outside,location);assert.equal((await f.exported()).status,400);
  await fs.rm(location);await fs.link(outside,location);assert.equal((await f.exported()).status,400);
  await fs.rm(location);await fs.writeFile(location,script.content);
  const metadata=path.join(directory,'bundle.json'),original=await fs.readFile(metadata,'utf8'),record=JSON.parse(original);record.request.placement='global';await fs.writeFile(metadata,JSON.stringify(record));assert.equal((await f.exported()).status,400);
  await fs.writeFile(metadata,original);const metadataCopy=path.join(f.root,'metadata-fixture.json');await fs.link(metadata,metadataCopy);assert.equal((await f.exported()).status,400);
  await fs.rm(metadataCopy);assert.equal((await f.exported()).status,200);await f.unchanged();
});

test('global Claude export keeps fixed placement and explicit invocation despite originating repository',async t=>{
  const f=await fixture(t,{targetAgent:'claude',placement:'global',notes:'Shared fixture format. PRIVATE-SYNTHETIC-NOTES'});await f.reply();
  const result=await f.exported({repo:f.repo});assert.equal(result.status,200);
  const zip=Buffer.from(result.body.data,'base64').toString('utf8');assert.ok(zip.includes('disable-model-invocation: true'));assert.ok(zip.includes('~/.claude/'));assert.ok(zip.includes('/count-fixture'));assert.equal(zip.includes('openai.yaml'),false);assert.equal(zip.includes(f.repo),false);await f.unchanged();
});
