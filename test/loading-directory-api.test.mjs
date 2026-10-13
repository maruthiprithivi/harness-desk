import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Store} from '../lib/store.mjs';
import {createApp} from '../server.mjs';

const privateBody='Synthetic instruction body excluded from metadata previews.';
const mapFiles=map=>map.groups.flatMap(group=>group.files);
const findFile=(map,file)=>mapFiles(map).find(item=>item.path===file);

async function snapshot(root) {
  const entries=[];
  async function visit(directory) {
    for(const entry of await fs.readdir(directory,{withFileTypes:true})) {
      const file=path.join(directory,entry.name);
      if(entry.isDirectory())await visit(file);
      else entries.push([path.relative(root,file),createHash('sha256').update(await fs.readFile(file)).digest('hex')]);
    }
  }
  await visit(root);
  return entries.sort(([a],[b])=>a.localeCompare(b));
}

async function fixture(t) {
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'loading-directory-api-')));
  const home=path.join(dir,'fixture-home'),repo=path.join(dir,'repos','one'),other=path.join(dir,'repos','two');
  const launch=path.join(repo,'src','app'),sibling=path.join(repo,'src','other');
  const paths={global:path.join(home,'.codex','AGENTS.md'),root:path.join(repo,'AGENTS.md'),ancestor:path.join(repo,'src','AGENTS.md'),base:path.join(launch,'AGENTS.md'),override:path.join(launch,'AGENTS.override.md'),sibling:path.join(sibling,'AGENTS.md'),other:path.join(other,'AGENTS.md'),claudeGlobal:path.join(home,'.claude','CLAUDE.md'),claudeRoot:path.join(repo,'CLAUDE.md'),claudeAncestor:path.join(repo,'src','CLAUDE.md'),claudeLaunch:path.join(launch,'.claude','CLAUDE.md'),claudeLocal:path.join(launch,'CLAUDE.local.md')};
  const items=[];
  for(const [id,file] of Object.entries(paths)) {
    const body=privateBody+' '+id;
    await fs.mkdir(path.dirname(file),{recursive:true});
    await fs.writeFile(file,body);
    const global=id==='global'||id==='claudeGlobal',fileRepo=global?'':id==='other'?other:repo;
    const bytes=Buffer.byteLength(body);
    items.push({id,name:path.basename(file),path:file,repo:fileRepo,agent:id.startsWith('claude')?'claude':id==='global'?'codex':'shared',type:'instruction',scope:global?'global':path.dirname(file)===fileRepo?'repo':'path',bytes,residentTokens:Math.ceil(bytes/4),estTokens:Math.ceil(bytes/4),body});
  }
  const store=await new Store(path.join(dir,'synthetic-store')).init();
  await store.saveSettings({...store.settings,repos:[repo,other],repoRoots:[]});
  await store.write('inventory/current.json',{scannedAt:'2026-01-01T00:00:00Z',repos:[repo,other],items,warnings:[],coverage:{partial:false}});
  const observations=[{id:'root-reading',repo,agent:'codex',at:'2026-01-01T00:00:00Z',startupTokens:100,windowTokens:1000,loadedPaths:[paths.root],note:'Synthetic root measurement'}, {id:'other-reading',repo:other,agent:'codex',at:'2026-01-01T00:00:00Z',startupTokens:200,windowTokens:1000,loadedPaths:[paths.other],note:'Other synthetic repository measurement'}];
  const breakdowns=[{id:'root-breakdown',repo,agent:'codex',at:'2026-01-01T00:00:00Z',stage:'startup',percentages:{messages:10,free:90},source:'user supplied harness report percentages',basis:'percentage of whole context window'}];
  await store.write('observations.json',observations);
  await store.write('context-breakdowns.json',breakdowns);
  const originalInstructions=await snapshot(path.join(dir,'repos')),originalHome=await snapshot(home);
  let dispatches=0;
  const servers=[];
  const options={home,dataDir:store.root,probe:async()=>[{id:'codex',auth:'unknown',dispatch:'handoff'},{id:'claude',auth:'unknown',dispatch:'handoff'}],dispatch:async()=>{dispatches++;throw new Error('Unexpected synthetic dispatch');}};
  async function start() {
    const app=await createApp(options);
    await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});
    servers.push(app.server);
    const root='http://127.0.0.1:'+app.server.address().port;
    const state=()=>fetch(root+'/api/state').then(response=>response.json());
    const csrfToken=(await state()).csrfToken;
    async function post(route,body) {
      const response=await fetch(root+route,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:JSON.stringify(body)});
      return {status:response.status,body:await response.json()};
    }
    return {app,root,state,post};
  }
  t.after(async()=>{for(const server of servers)if(server.listening)await new Promise(resolve=>server.close(resolve));await fs.rm(dir,{recursive:true,force:true});});
  const current=await start();
  const unchanged=async()=>{
    assert.equal(dispatches,0);
    assert.deepEqual(await snapshot(path.join(dir,'repos')),originalInstructions);
    assert.deepEqual(await snapshot(home),originalHome);
  };
  const scope={repo,reviewAgent:'codex',launchDirectory:launch,sections:['context'],selectionMode:'all',selectedIds:[]};
  return {...current,home,repo,other,launch,sibling,paths,items,scope,start,unchanged};
}

async function preview(f,patch={}) {
  const result=await f.post('/api/context',{...f.scope,...patch});
  assert.equal(result.status,200,JSON.stringify(result.body));
  assert.equal(result.body.truncated,false);
  return JSON.parse(result.body.text);
}

test('loading API forwards the discovered launch folder and predicts independent Codex levels',async t=>{
  const f=await fixture(t);
  const root=await f.post('/api/loading',{repo:f.repo,agent:'codex'});
  assert.equal(root.status,200);
  assert.equal(root.body.launchDirectory,f.repo);
  assert.deepEqual(root.body.directories,[f.repo,path.join(f.repo,'src'),f.launch,f.sibling]);
  assert.equal(findFile(root.body,f.paths.ancestor).status,'conditional');
  assert.equal(root.body.observation.id,'root-reading');
  const nested=await f.post('/api/loading',{repo:f.repo,agent:'codex',launchDirectory:f.launch});
  assert.equal(nested.status,200);
  assert.equal(nested.body.launchDirectory,f.launch);
  for(const file of [f.paths.global,f.paths.root,f.paths.ancestor,f.paths.override])assert.equal(findFile(nested.body,file).status,'applies');
  assert.equal(findFile(nested.body,f.paths.base).status,'shadowed');
  assert.equal(findFile(nested.body,f.paths.sibling).status,'conditional');
  assert.equal(findFile(nested.body,f.paths.other),undefined);
  const expected=f.items.filter(item=>['root','ancestor','override'].includes(item.id)).reduce((sum,item)=>sum+item.bytes,0);
  assert.equal(nested.body.summary.projectInstructionBytes,expected);
  assert.equal(nested.body.summary.estimatedInstructionBytes,expected+f.items.find(item=>item.id==='global').bytes);
  assert.equal(nested.body.observation,null);
  assert.equal(nested.body.repositoryObservation.id,'root-reading');
  assert.equal(JSON.stringify(nested.body).includes(privateBody),false);
  const explicitRoot=await f.post('/api/loading',{repo:f.repo,agent:'codex',launchDirectory:f.repo});
  assert.deepEqual(explicitRoot.body,root.body);
  await f.unchanged();
});

test('Claude nested predictions combine CLAUDE variants while retaining agent-specific uncertainty',async t=>{
  const f=await fixture(t),result=await f.post('/api/loading',{repo:f.repo,agent:'claude',launchDirectory:f.launch});
  assert.equal(result.status,200);
  assert.equal(result.body.launchDirectory,f.launch);
  for(const file of [f.paths.claudeGlobal,f.paths.claudeRoot,f.paths.claudeAncestor,f.paths.claudeLaunch,f.paths.claudeLocal])assert.equal(findFile(result.body,file).status,'applies');
  assert.equal(findFile(result.body,f.paths.root).status,'unknown');
  assert.equal(findFile(result.body,f.paths.override).status,'shadowed');
  assert.equal(findFile(result.body,f.paths.global),undefined);
  const expected=f.items.filter(item=>item.repo===f.repo&&item.id.startsWith('claude')).reduce((sum,item)=>sum+item.bytes,0);
  assert.equal(result.body.summary.projectInstructionBytes,expected);
  assert.equal(JSON.stringify(result.body).includes(privateBody),false);
  await f.unchanged();
});

test('invalid launch folders and scope types reject without writing state or history',async t=>{
  const f=await fixture(t),before=await snapshot(f.app.store.root),history=(await f.state()).history;
  const invalid=[path.join(f.repo,'unknown'),f.other,f.repo+'-outside',f.repo+'/src/../src/app',f.repo+'/src/./app',f.repo+'\\src\\..\\src\\app','',null,42,false,{},[]];
  for(const launchDirectory of invalid) {
    assert.equal((await f.post('/api/loading',{repo:f.repo,agent:'codex',launchDirectory})).status,400);
    for(const sections of [['context'],['dashboard'],[]])assert.equal((await f.post('/api/context',{...f.scope,launchDirectory,sections})).status,400);
    assert.equal((await f.post('/api/chat',{...f.scope,launchDirectory,prompt:'Review synthetic loading',agent:'claude'})).status,400);
  }
  for(const patch of [{reviewAgent:undefined},{reviewAgent:''},{reviewAgent:'unknown-agent'},{reviewAgent:null},{reviewAgent:42},{repo:f.other+'/unscanned'},{repo:f.repo+'/'},{repo:42},{globalOnly:true,repo:f.repo},{repo:'',globalOnly:true,launchDirectory:f.launch}]) {
    assert.equal((await f.post('/api/context',{...f.scope,...patch,sections:[]})).status,400);
    assert.equal((await f.post('/api/chat',{...f.scope,...patch,prompt:'Review synthetic loading',agent:'claude'})).status,400);
  }
  const global=await f.post('/api/loading',{repo:'',agent:'codex',launchDirectory:''});
  assert.equal(global.status,200);assert.equal(global.body.launchDirectory,'');
  assert.deepEqual(global.body.directories,[]);
  assert.equal((await f.post('/api/loading',{repo:'',agent:'codex',launchDirectory:f.launch})).status,400);
  assert.deepEqual(await snapshot(f.app.store.root),before);
  assert.deepEqual((await f.state()).history,history);
  assert.deepEqual((await f.state()).conversations,[]);
  await f.unchanged();
});

test('context predictions expose only selected file metadata and distinguish whole-scope estimates',async t=>{
  const f=await fixture(t),full=await preview(f);
  const prediction=full.context.loadingPrediction;
  assert.equal(prediction.repo,f.repo);assert.equal(prediction.agent,'codex');assert.equal(prediction.launchDirectory,f.launch);assert.equal(prediction.inferred,true);
  assert.ok(Array.isArray(prediction.groups));assert.ok(Array.isArray(prediction.notes));
  assert.match(prediction.interpretation,/metadata|predict|inferred/i);
  assert.equal(findFile(prediction,f.paths.override).status,'applies');
  assert.equal(findFile(prediction,f.paths.other),undefined);
  assert.equal(JSON.stringify(full).includes(privateBody),false);
  assert.equal(JSON.stringify(full).includes(f.other),false);
  assert.equal(Object.hasOwn(prediction,'observation'),false);
  assert.equal(Object.hasOwn(prediction,'repositoryObservation'),false);
  const selected=await preview(f,{selectionMode:'explicit',selectedIds:['root']});
  assert.deepEqual(mapFiles(selected.context.loadingPrediction).map(file=>file.id),['root']);
  assert.deepEqual(selected.context.loadingPrediction.summary,prediction.summary);
  assert.match(selected.context.loadingPrediction.interpretation,/whole|full|complete/i);
  assert.match(selected.context.loadingPrediction.interpretation,/selection|selected/i);
  for(const file of [f.paths.global,f.paths.ancestor,f.paths.base,f.paths.override,f.paths.sibling])assert.equal(JSON.stringify(selected).includes(file),false);
  const empty=await preview(f,{selectionMode:'explicit',selectedIds:[]});
  assert.deepEqual(mapFiles(empty.context.loadingPrediction),[]);
  assert.deepEqual(empty.context.loadingPrediction.summary,prediction.summary);
  for(const file of Object.values(f.paths))assert.equal(JSON.stringify(empty).includes(file),false);
  assert.equal((await preview(f,{sections:['dashboard']})).context,undefined);
  await f.unchanged();
});

test('folder context excludes repository readings while root previews retain existing evidence',async t=>{
  const f=await fixture(t),nested=await preview(f,{selectionMode:'explicit',selectedIds:[]});
  assert.deepEqual(nested.context.observations,[]);assert.deepEqual(nested.context.breakdowns,[]);
  assert.match(nested.context.folderEvidence,/unavailable|not available/i);
  assert.match(nested.context.folderEvidence,/repository|repo/i);
  assert.match(nested.context.folderEvidence,/launch|folder|directory/i);
  for(const value of ['root-reading','root-breakdown','other-reading','Synthetic root measurement'])assert.equal(JSON.stringify(nested).includes(value),false);
  const root=await preview(f,{launchDirectory:f.repo,selectionMode:'explicit',selectedIds:[]});
  assert.ok(root.context.observations.some(item=>item.id==='root-reading'));
  assert.ok(root.context.breakdowns.some(item=>item.id==='root-breakdown'));
  assert.equal(root.context.observations.some(item=>item.id==='other-reading'),false);
  const legacyScope={...f.scope,selectionMode:'explicit',selectedIds:[]};delete legacyScope.launchDirectory;
  const legacy=await f.post('/api/context',legacyScope);assert.equal(legacy.status,200);
  const legacyContext=JSON.parse(legacy.body.text).context;
  assert.equal(Object.hasOwn(legacyContext,'loadingPrediction'),false);
  const rootContext={...root.context};delete rootContext.loadingPrediction;
  assert.deepEqual(rootContext,legacyContext);
  const global=await preview(f,{repo:'',globalOnly:true,launchDirectory:'',selectionMode:'explicit',selectedIds:[]});
  assert.equal(global.context.loadingPrediction.launchDirectory,'');
  assert.deepEqual(mapFiles(global.context.loadingPrediction),[]);
  await f.unchanged();
});

test('chat retains launch folder and evidence agent across follow-ups and restart',async t=>{
  const f=await fixture(t),response=await f.post('/api/chat',{...f.scope,agent:'claude',prompt:'Review the synthetic instruction chain'});
  assert.equal(response.status,200);
  let chat=response.body;
  assert.equal(chat.status,'handoff');assert.equal(chat.agent,'claude');assert.equal(chat.reviewAgent,'codex');assert.equal(chat.launchDirectory,f.launch);
  const prediction=JSON.parse(chat.context.text).context.loadingPrediction;
  assert.equal(prediction.agent,'codex');assert.equal(prediction.launchDirectory,f.launch);
  assert.equal(findFile(prediction,f.paths.override).status,'applies');
  assert.equal(chat.handoffText.includes(privateBody),false);assert.equal(chat.handoffText.includes(f.other),false);
  assert.equal((await f.post('/api/reply',{id:chat.id,content:'Synthetic review complete.'})).status,200);
  const before=await snapshot(f.app.store.root),original=(await f.state()).conversations.find(item=>item.id===chat.id),history=(await f.state()).history;
  for(const launchDirectory of [f.repo,f.sibling,'',null,42])assert.equal((await f.post('/api/chat',{id:chat.id,prompt:'Continue the synthetic review',launchDirectory})).status,400);
  assert.deepEqual(await snapshot(f.app.store.root),before);
  assert.deepEqual((await f.state()).conversations.find(item=>item.id===chat.id),original);
  assert.deepEqual((await f.state()).history,history);
  const resumed=await f.start();
  assert.deepEqual((await resumed.state()).conversations.find(item=>item.id===chat.id),original);
  const followup=await resumed.post('/api/chat',{id:chat.id,prompt:'Continue the same synthetic review',repo:f.other,reviewAgent:'claude',agent:'codex'});
  assert.equal(followup.status,200);chat=followup.body;
  assert.equal(chat.repo,f.repo);assert.equal(chat.reviewAgent,'codex');assert.equal(chat.agent,'claude');assert.equal(chat.launchDirectory,f.launch);
  assert.deepEqual(JSON.parse(chat.context.text).context.loadingPrediction,prediction);
  assert.deepEqual(JSON.parse(chat.context.text).context.observations,[]);
  assert.deepEqual(JSON.parse(chat.context.text).context.breakdowns,[]);
  assert.equal(chat.handoffText.includes(privateBody),false);
  await f.unchanged();
});
