import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server.mjs';
import {Store} from '../lib/store.mjs';

async function fixture(t) {
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'session-files-api-')));
  const home=path.join(dir,'home-fixture'),repo=path.join(dir,'repos','one'),other=path.join(dir,'repos','two');
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const sessions=path.join(home,'.claude','projects','synthetic-project');
  for(const folder of [sessions,repo,other,path.join(home,'.claude','skills','fixture-skill')])await fs.mkdir(folder,{recursive:true});
  await fs.writeFile(path.join(repo,'CLAUDE.md'),'Synthetic instruction');
  await fs.writeFile(path.join(home,'.claude','skills','fixture-skill','SKILL.md'),'---\nname: fixture-skill\ndescription: Synthetic fixture\n---\nSynthetic skill');
  const files={valid:path.join(sessions,'valid-session.jsonl'),other:path.join(sessions,'other-session.jsonl'),malformed:path.join(sessions,'malformed-session.jsonl')};
  const timestamp=new Date(Date.now()-60000).toISOString();
  const skill=(cwd,id)=>({type:'assistant',cwd,sessionId:'synthetic-session-private',timestamp,message:{content:[{type:'tool_use',id,name:'Skill',input:{skill:'fixture-skill',args:'synthetic-input-private'}}]}});
  const read=(file,id)=>({type:'assistant',cwd:repo,sessionId:'synthetic-session-private',timestamp,message:{content:[{type:'tool_use',id,name:'Read',input:{file_path:file}}]}});
  const secret=path.join(repo,'secrets','synthetic-private-target.md'),unknown=path.join(repo,'unscanned','synthetic-private-target.txt');
  const rows=[skill(repo,'selected-call-private'),read(path.join(repo,'CLAUDE.md'),'instruction-read-private'),read(secret,'secret-read-private'),read(unknown,'unknown-read-private'),
    skill(other,'other-call-private'),skill(path.join(dir,'unscanned-repo'),'unscanned-call-private'),{type:'user',cwd:repo,sessionId:'synthetic-session-private',timestamp,message:{content:[{type:'text',text:'synthetic-body-private-marker'}]}}];
  await fs.writeFile(files.valid,rows.map(row=>JSON.stringify(row)).join('\n'));
  await fs.writeFile(files.other,JSON.stringify(skill(other,'separate-other-call-private')));
  await fs.writeFile(files.malformed,'{malformed synthetic-body-private-marker');
  const overrideHome=path.join(dir,'override-home');
  await fs.mkdir(path.join(overrideHome,'.claude','projects'),{recursive:true});
  const overrideFile=path.join(overrideHome,'.claude','projects','override-only.jsonl');
  await fs.writeFile(overrideFile,'synthetic-override-private-marker');
  const store=await new Store(path.join(dir,'generated')).init();await store.saveSettings({...store.settings,repos:[repo,other],repoRoots:[]});
  let providerCalls=0;
  const app=await createApp({home,dataDir:store.root,probe:async()=>[],dispatch:async()=>{providerCalls++;throw new Error('Unexpected synthetic provider call');}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>app.server.close(resolve)));
  const url='http://127.0.0.1:'+app.server.address().port,state=()=>fetch(url+'/api/state').then(response=>response.json()),token=(await state()).csrfToken;
  const post=async(route,body)=>{const response=await fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':token},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
  assert.equal((await post('/api/scan',{})).status,200);
  return {app,dir,home,repo,other,sessions,files,secret,unknown,overrideHome,overrideFile,url,state,post,unchanged:()=>assert.equal(providerCalls,0)};
}

test('session finder lists only metadata without reading bodies, persisting discovery or trusting caller roots',async t=>{
  const f=await fixture(t),before=await f.state(),manifest=structuredClone(f.app.store.manifest);
  const listing=await f.post('/api/session-files',{agent:'claude',repo:f.repo,home:f.overrideHome,path:f.overrideFile,paths:[f.overrideFile]});
  assert.equal(listing.status,200);assert.equal(listing.body.rootStatus,'available');assert.equal(listing.body.agent,'claude');assert.equal(listing.body.repo,f.repo);
  assert.deepEqual(listing.body.files.map(file=>file.path).sort(),Object.values(f.files).sort());
  for(const file of listing.body.files) {
    assert.ok(path.isAbsolute(file.path));assert.equal(typeof file.label,'string');assert.equal(file.bytes,(await fs.stat(file.path)).size);
    assert.ok(Number.isFinite(Date.parse(file.modifiedAt)));assert.equal(file.importable,true);
    assert.deepEqual(Object.keys(file).sort(),['path','label','bytes','modifiedAt','importable'].sort());
  }
  assert.equal(listing.body.coverage.partial,false);assert.ok(listing.body.coverage.visited>0);assert.equal(listing.body.coverage.filesFound,3);
  assert.equal(JSON.stringify(listing.body).includes('synthetic-body-private-marker'),false);
  assert.equal(JSON.stringify(listing.body).includes('synthetic-override-private-marker'),false);
  assert.equal(JSON.stringify(listing.body).includes(f.overrideFile),false);
  assert.deepEqual(await f.state(),before);assert.deepEqual(f.app.store.manifest,manifest);assert.equal(await f.app.store.read('usage-evidence.json'),null);
  const preview=await f.post('/api/context',{repo:f.repo,reviewAgent:'claude',sections:['inventory','context','patterns'],selectionMode:'explicit',selectedIds:[]});assert.equal(preview.status,200);
  for(const file of Object.values(f.files))assert.equal(preview.body.text.includes(file),false,file);
  assert.equal(preview.body.text.includes('synthetic-body-private-marker'),false);f.unchanged();
});

test('session listing requires CSRF, supported agents and exact scanned scope without reflecting invalid bodies',async t=>{
  const f=await fixture(t),body={agent:'claude',repo:f.repo},before=await f.state();
  assert.equal((await fetch(f.url+'/api/session-files',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).status,400);
  for(const patch of [{agent:'synthetic-invalid-private-agent'},{agent:'kiro'},{agent:42},{agent:null},{repo:'synthetic-invalid-private-scope'},{repo:f.repo+'/'},{repo:42},{repo:null}]) {
    const result=await f.post('/api/session-files',{...body,...patch});assert.equal(result.status,400,JSON.stringify(patch));
    assert.equal(JSON.stringify(result.body).includes('synthetic-invalid-private'),false);
  }
  const global=await f.post('/api/session-files',{agent:'claude',repo:''});assert.equal(global.status,200);assert.equal(global.body.repo,'');
  assert.deepEqual(global.body.files.map(file=>file.path).sort(),Object.values(f.files).sort());
  assert.deepEqual(await f.state(),before);f.unchanged();
});

test('missing and symlinked default roots return bounded metadata status without following caller paths',async t=>{
  const f=await fixture(t);
  const missing=await f.post('/api/session-files',{agent:'codex',repo:f.repo,path:f.files.valid});assert.equal(missing.status,200);assert.equal(missing.body.rootStatus,'missing');assert.deepEqual(missing.body.files,[]);
  await fs.mkdir(path.join(f.home,'.codex'),{recursive:true});await fs.symlink(f.sessions,path.join(f.home,'.codex','sessions'));
  const excluded=await f.post('/api/session-files',{agent:'codex',repo:f.repo});assert.equal(excluded.status,200);assert.equal(excluded.body.rootStatus,'excluded');assert.deepEqual(excluded.body.files,[]);
  assert.equal(JSON.stringify(excluded.body).includes('synthetic-body-private-marker'),false);f.unchanged();
});

test('only explicitly selected discovered paths import scoped call metadata and never raw session targets or bodies',async t=>{
  const f=await fixture(t),listing=await f.post('/api/session-files',{agent:'claude',repo:f.repo});assert.equal(listing.status,200);
  const selected=listing.body.files.find(file=>file.path===f.files.valid);assert.ok(selected);
  const imported=await f.post('/api/usage-import',{agent:'claude',repo:f.repo,paths:[selected.path]});assert.equal(imported.status,200);
  assert.deepEqual(imported.body.totals,{calls:1,resultsSeen:0,failed:0});assert.equal(imported.body.coverage.excludedOtherScope,1);
  const instruction=(await f.state()).inventory.items.find(item=>item.path===path.join(f.repo,'CLAUDE.md'));assert.ok(instruction);
  assert.deepEqual(imported.body.fileReads.map(read=>read.assetId),[instruction.id]);assert.equal(imported.body.fileReadTotals.requests,1);
  const stored=JSON.stringify(await f.app.store.read('usage-evidence.json'));
  for(const value of [...Object.values(f.files),f.secret,f.unknown,'synthetic-session-private','synthetic-input-private','synthetic-body-private-marker','selected-call-private','secret-read-private'])assert.equal(stored.includes(value),false,value);
  const afterImport=await f.state();
  assert.equal((await f.post('/api/session-files',{agent:'claude',repo:f.other})).status,200);assert.deepEqual(await f.state(),afterImport);
  const map=await f.post('/api/loading',{agent:'claude',repo:f.repo});assert.equal(map.body.components.usageEvidence.totals.calls,1);
  for(const [repo,agent] of [[f.other,'claude'],['','claude'],[f.repo,'codex']]) {
    const map=await f.post('/api/loading',{repo,agent});assert.equal(map.status,200);assert.equal(map.body.components.usageEvidence,null);
  }
  const noToken=path.join(f.sessions,'auth.jsonl');await fs.writeFile(noToken,await fs.readFile(selected.path,'utf8'));
  const rejected=await f.post('/api/usage-import',{agent:'claude',repo:f.repo,paths:[noToken]});assert.equal(rejected.status,400);
  const hardlink=path.join(f.sessions,'hardlink-session.jsonl'),symlink=path.join(f.sessions,'symlink-session.jsonl');
  await fs.link(selected.path,hardlink);await fs.symlink(f.files.other,symlink);
  const unsafeListing=await f.post('/api/session-files',{agent:'claude',repo:f.repo});assert.equal(unsafeListing.status,200);
  for(const unsafe of [selected.path,noToken,hardlink,symlink])assert.equal(unsafeListing.body.files.some(file=>file.path===unsafe),false,unsafe);
  assert.equal(unsafeListing.body.coverage.partial,true);
  for(const unsafe of [hardlink,symlink])assert.equal((await f.post('/api/usage-import',{agent:'claude',repo:f.repo,paths:[unsafe]})).status,400,unsafe);
  assert.equal((await f.post('/api/loading',{agent:'claude',repo:f.repo})).body.components.usageEvidence.totals.calls,1);f.unchanged();
});
