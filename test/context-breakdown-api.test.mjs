import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server.mjs';
import {Store} from '../lib/store.mjs';

async function fixture(t) {
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'context-breakdown-api-')));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const home=path.join(dir,'home-fixture'),repo=path.join(dir,'repos','a'),other=path.join(dir,'repos','b');
  for(const folder of [home,repo,other])await fs.mkdir(folder,{recursive:true});
  const store=await new Store(path.join(dir,'data')).init();
  await store.saveSettings({...store.settings,repos:[repo,other]});
  let calls=0;
  async function start() {
    const app=await createApp({home,dataDir:store.root,probe:async()=>[],dispatch:async()=>{calls++;throw new Error('Unexpected synthetic dispatch');}});
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
    t.after(()=>new Promise(resolve=>app.server.close(resolve)));
    const url='http://127.0.0.1:'+app.server.address().port;
    const state=()=>fetch(url+'/api/state').then(r=>r.json());
    const token=(await state()).csrfToken;
    const post=async(route,body)=>{const r=await fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':token},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
    return {app,url,state,post};
  }
  const f=await start();assert.equal((await f.post('/api/scan',{})).status,200);
  return {...f,repo,other,start,unchanged:()=>assert.equal(calls,0)};
}
const snapshot=(repo,patch={})=>({repo,agent:'claude',stage:'conversation',percentages:{systemPrompt:2,tools:8,mcp:10,skills:1,messages:30,free:40,reserved:9},...patch});

test('context breakdown validation and CSRF preserve existing snapshots',async t=>{
  const f=await fixture(t),body=snapshot(f.repo);
  assert.equal((await fetch(f.url+'/api/context-breakdown',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).status,400);
  const valid=await f.post('/api/context-breakdown',body);assert.equal(valid.status,200);
  const before=(await f.state()).contextBreakdowns;
  for(const patch of [{repo:f.repo+'/unscanned'},{repo:42},{agent:'unknown'},{stage:'unknown'},{action:'delete'},{percentages:{}},{percentages:null},{percentages:[]},{percentages:{skills:'1'}},{percentages:{skills:null}},{percentages:{skills:-1}},{percentages:{skills:101}},{percentages:{skills:60,mcp:41}},{percentages:{unknown:1}}]) {
    assert.equal((await f.post('/api/context-breakdown',{...body,...patch})).status,400,JSON.stringify(patch));
    assert.deepEqual((await f.state()).contextBreakdowns,before);
    assert.deepEqual(await f.app.store.read('context-breakdowns.json'),before);
  }
  const zero=await f.post('/api/context-breakdown',snapshot('',{stage:'startup',percentages:{skills:0}}));assert.equal(zero.status,200);
  assert.deepEqual(zero.body.percentages,{skills:0});assert.equal('free' in zero.body.percentages,false);
  assert.equal((await f.state()).contextCategories.length,9);
  assert.deepEqual((await f.state()).observations,[]);f.unchanged();
});

test('report parsing is transient and exposes only category percentages',async t=>{
  const f=await fixture(t),privateText=['private','synthetic','prompt'].join('-');
  const report=`Context usage\nfixture-model · 40k/200k tokens (20%)\nSystem prompt: 4k tokens (2%)\nSystem tools: 16k tokens (8%)\nSkills: 0 tokens (0%)\nMessages: 20k tokens (10%)\n${privateText}`;
  const parsed=await f.post('/api/context-breakdown',{action:'parse',report});assert.equal(parsed.status,200);
  assert.deepEqual(parsed.body,{percentages:{systemPrompt:2,tools:8,skills:0,messages:10}});
  assert.deepEqual((await f.state()).contextBreakdowns,[]);
  assert.equal(await f.app.store.read('context-breakdowns.json'),null);
  const invalid=await f.post('/api/context-breakdown',{action:'parse',report:privateText});assert.equal(invalid.status,400);assert.equal(JSON.stringify(invalid.body).includes(privateText),false);
  const saved=await f.post('/api/context-breakdown',snapshot(f.repo,{percentages:parsed.body.percentages,report,notes:privateText}));assert.equal(saved.status,200);
  const text=await fs.readFile(await f.app.store.location('context-breakdowns.json'),'utf8');assert.equal(text.includes(privateText),false);assert.equal(text.includes('fixture-model'),false);
  if(process.platform!=='win32')assert.equal((await fs.stat(await f.app.store.location('context-breakdowns.json'))).mode&0o777,0o600);
  assert.equal(saved.body.basis,'percentage of whole context window');assert.equal(saved.body.source,'user supplied harness report percentages');
  assert.ok(Number.isFinite(Date.parse(saved.body.at)));assert.match(saved.body.id,/^[a-f0-9-]{36}$/);
  const resumed=await f.start();assert.deepEqual((await resumed.state()).contextBreakdowns,[saved.body]);f.unchanged();
});

test('agent request previews select scoped breakdowns without raw report contents',async t=>{
  const f=await fixture(t);
  const exact=(await f.post('/api/context-breakdown',snapshot(f.repo))).body;
  const other=(await f.post('/api/context-breakdown',snapshot(f.other))).body;
  const global=(await f.post('/api/context-breakdown',snapshot(''))).body;
  const codex=(await f.post('/api/context-breakdown',snapshot(f.repo,{agent:'codex'}))).body;
  const preview=await f.post('/api/context',{repo:f.repo,reviewAgent:'claude',sections:['context']});assert.equal(preview.status,200);
  const data=JSON.parse(preview.body.text).context;
  assert.deepEqual(data.breakdowns.map(x=>x.id),[exact.id]);assert.equal(data.breakdowns.some(x=>x.id===global.id||x.id===other.id||x.id===codex.id),false);
  assert.match(data.interpretation,/Missing categories remain unknown/);
  const globalPreview=await f.post('/api/context',{repo:'',globalOnly:true,reviewAgent:'claude',sections:['context']});
  assert.deepEqual(JSON.parse(globalPreview.body.text).context.breakdowns.map(x=>x.id),[global.id]);
  f.unchanged();
});

test('failed private writes leave context evidence unchanged; retention clears archived snapshots',async t=>{
  const f=await fixture(t);const first=await f.post('/api/context-breakdown',snapshot(f.repo));assert.equal(first.status,200);
  const write=f.app.store.write.bind(f.app.store);
  f.app.store.write=async(relative,...args)=>{if(relative==='context-breakdowns.json')throw new Error('Synthetic storage failure');return write(relative,...args);};
  const failed=await f.post('/api/context-breakdown',snapshot(f.repo,{percentages:{messages:5}}));assert.equal(failed.status,400);
  assert.deepEqual((await f.state()).contextBreakdowns,[first.body]);assert.deepEqual(await f.app.store.read('context-breakdowns.json'),[first.body]);
  f.app.store.write=write;
  f.app.store.manifest['context-breakdowns.json'].updatedAt=new Date(Date.now()-2*86400000).toISOString();
  const preview=await f.post('/api/prune',{days:1,preview:true});assert.equal(preview.status,200);assert.ok(preview.body.files.some(x=>x.path==='context-breakdowns.json'));
  const archive=await f.post('/api/prune',{days:1,preview:false});assert.equal(archive.status,200);
  assert.deepEqual((await f.state()).contextBreakdowns,[]);f.unchanged();
});
