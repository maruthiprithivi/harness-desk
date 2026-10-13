import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createApp} from '../server.mjs';
import {Store} from '../lib/store.mjs';

async function fixture(t) {
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'observation-api-')));
  const home=path.join(dir,'home-fixture'),repo=path.join(dir,'repos','a'),other=path.join(dir,'repos','b');
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  for(const root of [home,repo,other])await fs.mkdir(root,{recursive:true});
  const config=path.join(repo,'.mcp.json');
  await fs.writeFile(config,JSON.stringify({mcpServers:{fixture_server:{command:'fixture-launcher'}}}));
  const store=await new Store(path.join(dir,'data')).init();
  await store.saveSettings({...store.settings,repos:[repo,other],repoRoots:[]});
  const originalConfig=await fs.readFile(config),originalSettings=await fs.readFile(path.join(store.root,'settings.json'));
  let dispatched=0,probed=0;
  const options={home,dataDir:store.root,probe:async()=>{probed++;return [];},dispatch:async()=>{dispatched++;throw new Error('Unexpected synthetic dispatch');}};
  async function start() {
    const app=await createApp(options);
    await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});
    t.after(()=>new Promise(resolve=>app.server.close(resolve)));
    const root='http://127.0.0.1:'+app.server.address().port;
    const state=()=>fetch(root+'/api/state').then(response=>response.json()),token=(await state()).csrfToken;
    const post=async(route,body)=>{
      const response=await fetch(root+route,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':token},body:JSON.stringify(body)});
      return {status:response.status,body:await response.json()};
    };
    return {app,root,state,post};
  }
  const current=await start();assert.equal((await current.post('/api/scan',{})).status,200);
  const unchanged=async(expectedProbes=1)=>{
    assert.equal(dispatched,0);assert.equal(probed,expectedProbes);
    assert.deepEqual(await fs.readFile(config),originalConfig);
    assert.deepEqual(await fs.readFile(path.join(store.root,'settings.json')),originalSettings);
  };
  return {...current,repo,other,start,unchanged};
}
const observation=(repo,patch={})=>({repo,agent:'codex',startupTokens:100,windowTokens:1000,loadedPaths:[],note:'Synthetic fresh-session measurement',...patch});

test('observations require CSRF, scanned scope and integer measurements; invalid requests preserve evidence',async t=>{
  const f=await fixture(t),body=observation(f.repo);
  assert.equal((await fetch(f.root+'/api/observation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).status,400);
  assert.deepEqual((await f.state()).observations,[]);
  const valid=await f.post('/api/observation',body);assert.equal(valid.status,200);
  const saved=await f.app.store.read('observations.json');
  const invalid=[{repo:f.other+'/unscanned'},{agent:'unknown-agent'},{repo:42},{startupTokens:undefined},{windowTokens:undefined},{startupTokens:0.5},{windowTokens:1000.5},{startupTokens:'100'},{windowTokens:'1000'},{startupTokens:null},{windowTokens:null},{startupTokens:-1},{windowTokens:-1},{windowTokens:0},{startupTokens:1001},{startupTokens:10000001,windowTokens:10000000},{startupTokens:1,windowTokens:10000001},{loadedPaths:[42]},{loadedPaths:'fixture-path'},{note:42}];
  for(const patch of invalid){
    const result=await f.post('/api/observation',{...body,...patch});assert.equal(result.status,400,JSON.stringify(patch));
    assert.deepEqual(await f.app.store.read('observations.json'),saved);
    assert.deepEqual((await f.state()).observations,saved);
  }
  const zero=await f.post('/api/observation',observation(f.repo,{startupTokens:0,windowTokens:1}));assert.equal(zero.status,200);assert.equal(zero.body.startupTokens,0);assert.equal(zero.body.windowTokens,1);
  const maximum=await f.post('/api/observation',observation('',{startupTokens:10000000,windowTokens:10000000}));assert.equal(maximum.status,200);assert.equal(maximum.body.repo,'');
  assert.equal((await f.state()).observations.length,3);
  await f.unchanged();
});

test('loading maps use the latest observation for the exact repository and agent',async t=>{
  const f=await fixture(t),loading=async(repo,agent='codex')=>{
    const result=await f.post('/api/loading',{repo,agent});assert.equal(result.status,200);return result.body.observation;
  };
  assert.equal(await loading(f.repo),null);assert.equal(await loading(''),null);
  const first=await f.post('/api/observation',observation(f.repo));assert.equal(first.status,200);
  await delay(5);
  const global=await f.post('/api/observation',observation('',{startupTokens:200}));assert.equal(global.status,200);
  const otherRepo=await f.post('/api/observation',observation(f.other,{startupTokens:300}));assert.equal(otherRepo.status,200);
  const otherAgent=await f.post('/api/observation',observation(f.repo,{agent:'claude',startupTokens:400}));assert.equal(otherAgent.status,200);
  await delay(5);
  const latest=await f.post('/api/observation',observation(f.repo,{startupTokens:500}));assert.equal(latest.status,200);
  assert.equal((await loading(f.repo)).id,latest.body.id);assert.equal((await loading(f.repo)).startupTokens,500);
  assert.equal((await loading('')).id,global.body.id);assert.equal((await loading(f.other)).id,otherRepo.body.id);assert.equal((await loading(f.repo,'claude')).id,otherAgent.body.id);
  assert.equal(await loading('','claude'),null);assert.equal(await loading(f.other,'claude'),null);assert.equal(await loading(f.repo,'kimi'),null);
  assert.match((await loading(f.repo)).evidence,/User-supplied.*does not verify/);
  const scope={repo:f.repo,reviewAgent:'codex',sections:['context'],selectionMode:'explicit',selectedIds:[]};
  const preview=await f.post('/api/context',scope);assert.equal(preview.status,200);
  const scoped=JSON.parse(preview.body.text).context.observations;
  assert.ok(scoped.some(item=>item.id===latest.body.id));assert.ok(scoped.every(item=>item.agent==='codex'));
  assert.equal(scoped.some(item=>item.id===otherAgent.body.id||item.id===otherRepo.body.id),false);
  const advanced=await f.post('/api/context',{...scope,reviewAgent:''});assert.equal(advanced.status,200);
  const observations=JSON.parse(advanced.body.text).context.observations;
  assert.ok(observations.some(item=>item.id===latest.body.id));assert.ok(observations.some(item=>item.id===otherAgent.body.id));
  assert.equal(observations.some(item=>item.id===otherRepo.body.id),false);
  assert.equal((await f.state()).observations.length,5);
  await f.unchanged();
});

test('observation notes and paths are redacted, persist across restart and retain manual source attribution',async t=>{
  const f=await fixture(t),sensitive=['sk','-','syntheticcredential12345'].join('');
  const result=await f.post('/api/observation',observation(f.repo,{loadedPaths:['fixture-path/'+sensitive],note:'Synthetic measurement '+sensitive}));assert.equal(result.status,200);
  assert.match(result.body.id,/^[a-f0-9-]{36}$/);assert.ok(Number.isFinite(Date.parse(result.body.at)));
  assert.equal(result.body.evidence,'user supplied fresh-session context');
  assert.equal(result.body.note,'Synthetic measurement [REDACTED]');assert.deepEqual(result.body.loadedPaths,['fixture-path/[REDACTED]']);
  const file=await f.app.store.location('observations.json'),stored=await fs.readFile(file,'utf8');assert.equal(stored.includes(sensitive),false);assert.deepEqual(JSON.parse(stored),[result.body]);
  if(process.platform!=='win32')assert.equal((await fs.stat(file)).mode&0o777,0o600);
  const resumed=await f.start();assert.deepEqual((await resumed.state()).observations,[result.body]);
  const loading=await resumed.post('/api/loading',{repo:f.repo,agent:'codex'});assert.equal(loading.status,200);assert.equal(loading.body.observation.id,result.body.id);assert.equal(loading.body.observation.repo,f.repo);assert.equal(loading.body.observation.agent,'codex');assert.equal(loading.body.observation.startupTokens,100);
  assert.equal(JSON.stringify(loading.body.observation).includes(sensitive),false);assert.match(loading.body.observation.evidence,/User-supplied/);
  assert.equal((await resumed.post('/api/loading',{repo:f.other,agent:'codex'})).body.observation,null);
  await f.unchanged(2);
});
