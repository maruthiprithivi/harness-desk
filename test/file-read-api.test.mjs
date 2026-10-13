import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server.mjs';
import {Store} from '../lib/store.mjs';

async function fixture(t) {
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'file-read-api-')));
  const home=path.join(dir,'home-fixture'),repo=path.join(dir,'repos','one'),other=path.join(dir,'repos','two');
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const paths={globalSkill:path.join(home,'.claude','skills','same-skill','SKILL.md'),repoSkill:path.join(repo,'.claude','skills','same-skill','SKILL.md'),instruction:path.join(repo,'CLAUDE.md'),otherInstruction:path.join(other,'CLAUDE.md'),codex:path.join(repo,'.codex','config.toml')};
  for(const file of Object.values(paths)) {
    await fs.mkdir(path.dirname(file),{recursive:true});
    await fs.writeFile(file,file.endsWith('SKILL.md')?'---\nname: same-skill\ndescription: Synthetic fixture\n---\nSynthetic skill':'Synthetic instructions');
  }
  const store=await new Store(path.join(dir,'generated')).init();
  await store.saveSettings({...store.settings,repos:[repo,other],repoRoots:[]});
  let providerCalls=0;
  const options={home,dataDir:store.root,probe:async()=>[],dispatch:async()=>{providerCalls++;throw new Error('Unexpected synthetic provider call');}};
  const app=await createApp(options);
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>app.server.close(resolve)));
  const url='http://127.0.0.1:'+app.server.address().port;
  const state=()=>fetch(url+'/api/state').then(response=>response.json());
  const token=(await state()).csrfToken;
  const post=async(route,body)=>{const response=await fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':token},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
  assert.equal((await post('/api/scan',{})).status,200);
  const inventory=(await state()).inventory;
  const assets=Object.fromEntries(Object.entries(paths).map(([key,file])=>[key,inventory.items.find(item=>item.path===file)]));
  for(const asset of Object.values(assets))assert.ok(asset,'Synthetic asset must be discovered');
  const loading=async(scope=repo,agent='claude')=>{const result=await post('/api/loading',{repo:scope,agent});assert.equal(result.status,200);return result.body;};
  return {app,options,paths,assets,home,repo,other,post,state,loading,unchanged:()=>assert.equal(providerCalls,0)};
}

function readRows(repo,file,{id='read-request-private',session='read-session-private',result=true,failed=false}={}) {
  const timestamp=new Date(Date.now()-60000).toISOString();
  const rows=[{type:'assistant',cwd:repo,sessionId:session,timestamp,message:{content:[{type:'tool_use',id,name:'Read',input:{file_path:file,offset:17,limit:3,privateExtra:'read-input-private-marker'}}]}}];
  if(result)rows.push({type:'user',cwd:repo,sessionId:session,timestamp,message:{content:[{type:'tool_result',tool_use_id:id,is_error:failed,content:'read-body-private-marker'}]}});
  return rows;
}
const exportFile=rows=>({name:'synthetic-read-export.jsonl',content:rows.map(row=>JSON.stringify(row)).join('\n')});
const mapFiles=map=>map.groups.flatMap(group=>group.files);
function evidenceFor(evidence,asset) {
  const values=Array.isArray(evidence)?evidence:evidence?.reads||[];
  return values.find(value=>value?.assetId===asset.id);
}

test('Read imports retain scoped asset aggregates separately from Skill and MCP calls',async t=>{
  const f=await fixture(t),{paths,assets,repo,other}=f;
  const first=readRows(repo,paths.repoSkill,{id:'skill-read-one'});
  const unknown=path.join(repo,'unscanned','private-read-target.txt'),secret=path.join(repo,'secrets','private-read-target.md');
  const rows=[...first,...first,...readRows(repo,paths.repoSkill,{id:'skill-read-two',session:'second-read-session-private',failed:true}),...readRows(repo,paths.instruction,{id:'instruction-read',result:false}),
    ...readRows(repo,paths.globalSkill,{id:'global-copy-read'}),...readRows(other,paths.repoSkill,{id:'wrong-session-scope'}),...readRows(repo,paths.otherInstruction,{id:'other-repo-target'}),
    ...readRows(repo,paths.codex,{id:'other-agent-target'}),...readRows(repo,unknown,{id:'unknown-target'}),...readRows(repo,secret,{id:'secret-target'})];
  const body={repo,agent:'claude',days:7,files:[exportFile(rows),exportFile(first)]};
  const imported=await f.post('/api/usage-import',body);assert.equal(imported.status,200);
  const usage=imported.body;
  assert.equal(usage.fileReadCoverage.supported,true);
  assert.deepEqual(usage.items,[]);assert.deepEqual(usage.totals,{calls:0,resultsSeen:0,failed:0});
  assert.deepEqual(usage.fileReadTotals,{requests:4,resultsSeen:3,failed:1});
  assert.deepEqual(usage.fileReads.map(read=>read.assetId).sort(),[assets.repoSkill.id,assets.globalSkill.id,assets.instruction.id].sort());
  const skillRead=usage.fileReads.find(read=>read.assetId===assets.repoSkill.id);
  assert.equal(skillRead.requests,2);assert.equal(skillRead.resultsSeen,2);assert.equal(skillRead.failed,1);assert.equal(skillRead.sessions,2);
  assert.ok(Number.isFinite(Date.parse(skillRead.firstRequest)));assert.ok(Number.isFinite(Date.parse(skillRead.lastRequest)));
  const map=await f.loading();
  const instruction=mapFiles(map).find(file=>file.id===assets.instruction.id);
  assert.equal(evidenceFor(instruction.readEvidence,assets.instruction).requests,1);
  assert.equal(evidenceFor(instruction.readEvidence,assets.instruction).resultsSeen,0);
  const repoSkill=map.components.items.find(item=>item.id===assets.repoSkill.id);
  const globalSkill=map.components.items.find(item=>item.id===assets.globalSkill.id);
  assert.equal(evidenceFor(repoSkill.callEvidence.reads,assets.repoSkill).requests,2);
  assert.equal(evidenceFor(globalSkill.callEvidence.reads,assets.globalSkill).requests,1);
  assert.deepEqual(repoSkill.callEvidence.matches,[]);assert.equal(map.components.summary.used,0);
  const stored=JSON.stringify(await f.app.store.read('usage-evidence.json'));
  for(const value of [...Object.values(paths),unknown,secret,'read-input-private-marker','read-body-private-marker','read-session-private','second-read-session-private','skill-read-one','synthetic-read-export'])assert.equal(stored.includes(value),false,value);
  assert.equal((await f.post('/api/usage-import',body)).status,200);
  assert.equal((await f.loading()).components.usageEvidence.fileReadTotals.requests,4);
  f.unchanged();
});

test('Read evidence follows exact agent and working scope and selected previews reveal only selected aggregates',async t=>{
  const f=await fixture(t),{repo,assets,paths}=f;
  assert.equal((await f.post('/api/usage-import',{repo,agent:'claude',files:[exportFile([...readRows(repo,paths.repoSkill,{id:'repo-target'}),...readRows(repo,paths.instruction,{id:'instruction-target'}),...readRows(repo,paths.globalSkill,{id:'global-target'})])]})).status,200);
  for(const [scope,agent] of [[f.other,'claude'],['','claude'],[repo,'codex']]) {
    const map=await f.loading(scope,agent);
    assert.equal(map.components.usageEvidence,null);
    assert.ok(mapFiles(map).every(file=>!file.readEvidence));
    assert.ok(map.components.items.every(item=>!item.callEvidence?.reads));
  }
  const context={repo,reviewAgent:'claude',selectionMode:'explicit',selectedIds:[assets.repoSkill.id],sections:['inventory','context'],launchDirectory:repo};
  const result=await f.post('/api/context',context);assert.equal(result.status,200);
  const preview=JSON.parse(result.body.text);
  assert.deepEqual(preview.inventory.map(item=>item.path),[paths.repoSkill]);
  assert.equal(evidenceFor(preview.inventory[0].callEvidence.reads,assets.repoSkill).requests,1);
  for(const id of [assets.globalSkill.id,assets.instruction.id,assets.otherInstruction.id,assets.codex.id])assert.equal(result.body.text.includes(id),false,id);
  assert.equal(result.body.text.includes('fileReadTotals'),false);
  const instruction=await f.post('/api/context',{...context,selectedIds:[assets.instruction.id]});assert.equal(instruction.status,200);
  const instructionPreview=JSON.parse(instruction.body.text);
  assert.deepEqual(instructionPreview.inventory.map(item=>item.path),[paths.instruction]);
  assert.equal(evidenceFor(instructionPreview.inventory[0].callEvidence.reads,assets.instruction).requests,1);
  for(const id of [assets.repoSkill.id,assets.globalSkill.id,assets.otherInstruction.id,assets.codex.id])assert.equal(instruction.body.text.includes(id),false,id);
  assert.equal(instruction.body.text.includes('fileReadTotals'),false);
  const empty=await f.post('/api/context',{...context,selectedIds:[]});assert.equal(empty.status,200);
  assert.deepEqual(JSON.parse(empty.body.text).inventory,[]);
  for(const asset of Object.values(assets))assert.equal(empty.body.text.includes(asset.id),false,asset.id);
  assert.equal(empty.body.text.includes('fileReadTotals'),false);
  assert.equal((await f.post('/api/usage-import',{repo:'',agent:'claude',files:[exportFile([...readRows('',paths.globalSkill,{id:'global-session'}),...readRows('',paths.repoSkill,{id:'repo-in-global-session'})])]})).status,200);
  const global=await f.loading('');assert.deepEqual(global.components.usageEvidence.fileReads.map(read=>read.assetId),[assets.globalSkill.id]);
  assert.equal(evidenceFor(global.components.items.find(item=>item.id===assets.globalSkill.id).callEvidence.reads,assets.globalSkill).requests,1);
  assert.equal((await f.loading()).components.usageEvidence.fileReadTotals.requests,3);
  const resumed=await createApp(f.options);
  const resumedPreview=JSON.parse(resumed.context(context).text);
  assert.equal(evidenceFor(resumedPreview.inventory[0].callEvidence.reads,assets.repoSkill).requests,1);
  f.unchanged();
});

test('Codex imports keep Read coverage explicitly unsupported',async t=>{
  const f=await fixture(t);
  const imported=await f.post('/api/usage-import',{repo:f.repo,agent:'codex',files:[{name:'synthetic-codex.jsonl',content:JSON.stringify({type:'session_meta',payload:{id:'synthetic-codex-session',cwd:f.repo},timestamp:new Date().toISOString()})}]});
  assert.equal(imported.status,200);
  assert.equal(imported.body.fileReadCoverage.supported,false);
  assert.deepEqual(imported.body.fileReads,[]);
  assert.deepEqual(imported.body.fileReadTotals,{requests:0,resultsSeen:0,failed:0});
  f.unchanged();
});
