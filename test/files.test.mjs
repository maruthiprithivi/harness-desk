import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {Store} from '../lib/store.mjs';
import {readFile,saveFile,inspectTools} from '../lib/files.mjs';
import {createApp} from '../server.mjs';

async function fixture(t,{name='AGENTS.md',content='# Fixture\n',type='instruction',global=false}={}) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'harness-files-')),home=path.join(dir,'home'),repo=path.join(dir,'repo');
  await fs.mkdir(path.join(home,'.claude'),{recursive:true});await fs.mkdir(repo);
  const file=path.join(global?path.join(home,'.claude'):repo,name);await fs.writeFile(file,content);
  const item={id:'fixture-file',name,type,scope:global?'global':'repo',repo:global?'':repo,path:file,agent:'shared',bytes:Buffer.byteLength(content)};
  const inventory={items:[item],repos:[repo],warnings:[],coverage:{partial:false},scannedAt:'2026-01-01T00:00:00Z'};
  const store=await new Store(path.join(dir,'data')).init();await store.saveSettings({...store.settings,repos:[repo]});await store.write('inventory/current.json',inventory);
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const options={inventory,id:item.id,home,store};return {dir,home,repo,file,item,inventory,store,options};
}
test('explicit tool inspection retains only metadata while protected contents stay withheld',async t=>{
  const key=['API','KEY'].join('_'),content=JSON.stringify({mcpServers:{fixture:{command:'private-launcher',args:['private-argument'],env:{[key]:'synthetic-private-value'}},remote:{type:'http',url:'https://example.invalid/private-endpoint',headers:{Authorization:'private-header'},disabled:true}}});
  const {options,file}=await fixture(t,{name:'.mcp.json',type:'mcp-server',content});
  assert.equal((await readFile(options)).editable,false);
  const metadata=await inspectTools({...options,agent:'claude',repo:options.inventory.repos[0]});assert.equal(metadata.servers.length,2);assert.equal(metadata.servers.find(server=>server.name==='remote').configuredEnabled,false);assert.equal(metadata.coverage.partial,false);
  const result=JSON.stringify(metadata);for(const hidden of ['synthetic-private-value','private-launcher','private-argument','private-endpoint','private-header','mcpServers','Authorization'])assert.equal(result.includes(hidden),false);
  assert.equal(await fs.readFile(file,'utf8'),content);assert.equal(metadata.bytes,Buffer.byteLength(content));
  const unsupported=await fixture(t,{name:'random.json',type:'config',content:'{}'});await assert.rejects(()=>inspectTools({...unsupported.options,agent:'codex'}),/not supported/);
});
test('tool inspection shares source isolation and bounded reads with the protected editor',async t=>{
  const {options,file,dir}=await fixture(t,{name:'.mcp.json',type:'mcp-server',content:'{"mcpServers":{}}'}),outside=path.join(dir,'outside.json');await fs.writeFile(outside,'{}');
  await fs.rm(file);await fs.symlink(outside,file);await assert.rejects(()=>inspectTools({...options,agent:'claude'}),/symlinks/);
  await fs.rm(file);await fs.link(outside,file);await assert.rejects(()=>inspectTools({...options,agent:'claude'}),/hard links/);
  await fs.rm(file);await fs.writeFile(file,'x'.repeat(256*1024+1));await assert.rejects(()=>inspectTools({...options,agent:'claude'}),/256 KiB/);
});
test('tool inspection API is explicit, scoped, private, retained and marks metadata drift',async t=>{
  const {home,store,repo,file}=await fixture(t,{name:'.mcp.json',type:'mcp-server',content:'{"mcpServers":{"fixture":{"command":"fixture-launcher"}}}'});
  const other=path.join(home,'other-repo');await fs.mkdir(other);await store.saveSettings({...store.settings,repos:[repo,other]});
  const app=await createApp({home,dataDir:store.root,probe:async()=>[],dispatch:async()=>{throw new Error('No provider should be used');}});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>new Promise(resolve=>app.server.close(resolve)));
  const root='http://127.0.0.1:'+app.server.address().port,state=await fetch(root+'/api/state').then(r=>r.json());
  const post=async(route,body)=>{const response=await fetch(root+route,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':state.csrfToken},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
  await post('/api/scan',{});const map=async(scope=repo,agent='codex')=>(await post('/api/loading',{repo:scope,agent})).body.components.items;
  const initial=(await map()).find(item=>item.path===file);assert.equal(initial.toolInspection,null);assert.equal(store.manifest['tool-inspections.json'],undefined);
  const body={id:initial.id,repo,agent:'codex'};
  assert.equal((await fetch(root+'/api/tool-inspection',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).status,400);
  for(const patch of [{repo:other},{repo:''},{agent:'unknown'},{id:file}])assert.equal((await post('/api/tool-inspection',{...body,...patch})).status,400);
  assert.equal((await post('/api/tool-inspection',body)).status,200);let inspected=(await map()).find(item=>item.id===initial.id);assert.equal(inspected.toolInspection.servers[0].name,'fixture');assert.equal(inspected.toolInspection.fileChanged,false);
  assert.equal((await map(repo,'claude')).find(item=>item.id===initial.id).toolInspection,null);
  const context={repo,reviewAgent:'codex',selectionMode:'explicit',selectedIds:[initial.id],sections:['inventory']};assert.equal(JSON.parse(app.context(context).text).inventory[0].toolInspection.servers[0].name,'fixture');assert.equal(JSON.parse(app.context({...context,reviewAgent:'claude'}).text).inventory[0].toolInspection,null);
  const stored=await app.store.read('tool-inspections.json');assert.equal(JSON.stringify(stored).includes('fixture-launcher'),false);assert.equal(app.store.manifest['tool-inspections.json'].pinned,true);
  app.store.manifest['tool-inspections.json'].updatedAt='2000-01-01T00:00:00Z';await app.store.prune(1,false);assert.ok(await app.store.read('tool-inspections.json'));
  await fs.appendFile(file,'\n');await post('/api/scan',{});inspected=(await map()).find(item=>item.id===initial.id);assert.equal(inspected.toolInspection.fileChanged,true);
  const resumed=await createApp({home,dataDir:store.root,probe:async()=>[]});assert.equal(JSON.parse(resumed.context(context).text).inventory[0].toolInspection.fileChanged,true);
  await fs.writeFile(file,'{broken');const partial=await post('/api/tool-inspection',body);assert.equal(partial.status,200);assert.equal(partial.body.coverage.partial,true);assert.deepEqual(partial.body.servers,[]);const final=await fetch(root+'/api/state').then(r=>r.json());assert.ok(final.gaps.some(gap=>gap.repo===repo&&gap.agent==='codex'&&gap.title==='Tool configuration inspection is incomplete'));
});
test('editing a discovered file preserves its original bytes and permissions in private pinned backups',async t=>{
  const original='\uFEFF# Fixture\r\n';const {file,store,options}=await fixture(t,{content:original});await fs.chmod(file,0o640);
  const read=await readFile(options);assert.equal(read.content,original);assert.equal(read.language,'markdown');assert.equal(read.editable,true);assert.match(read.impact,/repository/);
  const result=await saveFile({...options,version:read.version,content:'# Updated fixture\n'});
  assert.equal(result.saved,true);assert.notEqual(result.version,read.version);assert.equal(await fs.readFile(file,'utf8'),'# Updated fixture\n');
  assert.equal(await fs.readFile(await store.location(result.backup),'utf8'),original);assert.equal(store.manifest[result.backup].pinned,true);
  assert.equal((await fs.stat(file)).mode&0o777,0o640);assert.equal((await store.prune(1,true)).files.some(f=>f.path.startsWith('backups/')),false);
  const noop=await saveFile({...options,version:result.version,content:result.content});assert.equal(noop.saved,false);assert.equal(noop.backup,null);
});
test('editor explains file purpose and distinguishes opening from saving at global and project scope',async t=>{
  for(const global of [false,true]){
    const {options,file}=await fixture(t,{global});const read=await readFile(options);
    assert.equal(read.scopeLabel,global?'Global setup':'Project repository');
    assert.match(read.purpose,/Instructions that guide the agent/);assert.equal(read.agent,'shared');
    assert.match(read.scopeDescription,global?/multiple repositories/:/this repository/);
    assert.match(read.impact,/^Saving updates/);assert.equal(await fs.readFile(file,'utf8'),'# Fixture\n');
    const saved=await saveFile({...options,version:read.version,content:'# Changed fixture\n'});
    for(const field of ['purpose','scopeLabel','scopeDescription','agent','impact'])assert.equal(saved[field],read[field]);
  }
});
test('editor identifies skill installation records without changing their protection or contents',async t=>{
  const content='{"version":3,"skills":{"fixture":{"source":"example/fixture","skillFolderHash":"synthetic-hash"}}}';
  const {options,file}=await fixture(t,{name:'.skill-lock.json',type:'config',global:true,content});
  const read=await readFile(options);assert.match(read.purpose,/Installation record/);assert.match(read.purpose,/not an instruction file/);assert.match(read.purpose,/sources, versions and hashes/);
  assert.equal(read.scopeLabel,'Global setup');assert.equal(read.editable,true);assert.equal(read.content,content);assert.equal(await fs.readFile(file,'utf8'),content);
});
test('editor explains mixed project settings and ancestor instructions without machine-wide scope claims',async t=>{
  const {options,home,inventory,item}=await fixture(t,{name:'.claude.json',type:'config',global:true,content:'{"projects":{}}'});
  const mixed=await readFile(options);assert.equal(mixed.scopeLabel,'Global and project settings');assert.match(mixed.scopeDescription,/individual projects/);assert.match(mixed.impact,/which entries you change/);
  const file=path.join(home,'AGENTS.md');await fs.writeFile(file,'# Parent instructions');
  const read=await readFile({...options,inventory:{...inventory,repos:[path.join(home,'projects','fixture')],items:[{...item,type:'instruction',path:file,scope:'path'}]}});
  assert.equal(read.scopeLabel,'Parent-folder instructions');assert.match(read.scopeDescription,/within its folder/);assert.match(read.impact,/within this folder/);assert.doesNotMatch(read.impact,/user-level|global/);
});
test('file access uses canonical inventory IDs and rejects arbitrary paths, unsupported types and scopes',async t=>{
  const {options,inventory,item,dir}=await fixture(t);
  await assert.rejects(()=>readFile({...options,id:item.path}),/inventory/);
  await assert.rejects(()=>readFile({...options,inventory:{...inventory,items:[{...item,path:path.join(dir,'outside.md')}]}}),/outside/);
  await assert.rejects(()=>readFile({...options,inventory:{...inventory,items:[{...item,type:'unknown'}]}}),/inventory/);
  await assert.rejects(()=>readFile({...options,inventory:{...inventory,items:[{...item,path:path.join(options.home,'.claude','auth.json'),repo:'',scope:'global'}]}}),/non-secret/);
  const global=await fixture(t,{global:true,name:'CLAUDE.md'});assert.match((await readFile(global.options)).impact,/multiple repositories/);
  const ancestor=path.join(options.home,'AGENTS.md'),childRepo=path.join(options.home,'projects','fixture');await fs.writeFile(ancestor,'Ancestor fixture');
  const ancestorItem={...item,path:ancestor,repo:'',scope:'path'};
  assert.equal((await readFile({...options,inventory:{...inventory,repos:[childRepo],items:[ancestorItem]}})).content,'Ancestor fixture');
  await assert.rejects(()=>readFile({...options,inventory:{...inventory,items:[ancestorItem]}}),/outside/);
});
test('structured and textual sensitive content is redacted and cannot be edited or backed up',async t=>{
  const hidden='synthetic-private-value';const key=['OPENAI','API','KEY'].join('_');
  const {file,options,store}=await fixture(t,{name:'settings.json',type:'config',content:JSON.stringify({env:{[key]:hidden},model:'fixture-model'})});
  const read=await readFile(options);assert.equal(read.editable,false);assert.equal(read.content.includes(hidden),false);assert.match(read.reason,/redacted/);
  await assert.rejects(()=>saveFile({...options,version:read.version,content:'{}'}),/Sensitive/);assert.equal(Object.values(store.manifest).some(e=>e.kind==='file-backup'),false);
  assert.equal((await fs.readFile(file,'utf8')).includes(hidden),true);
  const clean=await fixture(t);const initial=await readFile(clean.options);
  await assert.rejects(()=>saveFile({...clean.options,version:initial.version,content:['password',hidden].join('=')}),/Sensitive/);
  await fs.writeFile(clean.file,['password',hidden].join('='));const redacted=await readFile(clean.options);assert.equal(redacted.editable,false);assert.equal(redacted.content.includes(hidden),false);
});
test('external changes and invalid JSON cannot overwrite a file',async t=>{
  const {options,file,store}=await fixture(t,{name:'settings.json',type:'config',content:'{"model":"initial"}'});
  const read=await readFile(options);await assert.rejects(()=>saveFile({...options,version:read.version,content:'{broken'}),/JSON must/);
  await fs.writeFile(file,'{"model":"external"}');await assert.rejects(()=>saveFile({...options,version:read.version,content:'{"model":"draft"}'}),/changed outside/);
  assert.equal(await fs.readFile(file,'utf8'),'{"model":"external"}');assert.equal(Object.values(store.manifest).some(e=>e.kind==='file-backup'),false);
});
test('multiline protected values and SOPS documents are withheld before editing or backup',async t=>{
  const key=['api','key'].join('_'),hidden='synthetic-multiline-value';
  for(const content of [key+': |\n  '+hidden+'\n',key+': >-\n  '+hidden+'\n']) {
    const {options,store}=await fixture(t,{name:'settings.yaml',type:'config',content});
    const read=await readFile(options);assert.equal(read.editable,false);assert.equal(read.content.includes(hidden),false);
    await assert.rejects(()=>saveFile({...options,version:read.version,content:'model: fixture\n'}),/Sensitive/);
    assert.equal(Object.values(store.manifest).some(e=>e.kind==='file-backup'),false);
  }
  for(const [name,content]of [['settings.json',JSON.stringify({model:'fixture',sops:{version:'synthetic'}})],['settings.yaml','model: fixture\nsops:\n  version: synthetic\n'],['settings.yaml','"sops":\n  version: synthetic\n']]) {
    const {options}=await fixture(t,{name,type:'config',content});const read=await readFile(options);
    assert.equal(read.editable,false);assert.match(read.reason,/SOPS/);assert.equal(read.content.includes('synthetic'),false);
    await assert.rejects(()=>saveFile({...options,version:read.version,content:'{}'}),/Sensitive/);
  }
});
test('qualified sensitive keys protect TOML, YAML and code without exposing their values',async t=>{
  const key=['FIXTURE','SECRET','KEY'].join('_'),hidden='synthetic-qualified-value';
  for(const [name,content]of [['settings.toml',key+' = "'+hidden+'"'],['settings.yaml',key+': '+hidden],['hook.js','const '+key+' = "'+hidden+'";']]) {
    const {options}=await fixture(t,{name,type:'config',content});const read=await readFile(options);
    assert.equal(read.editable,false);assert.equal(read.content.includes(hidden),false);
    await assert.rejects(()=>saveFile({...options,version:read.version,content:'// Clean fixture'}),/Sensitive/);
  }
});
test('symlinks, hard links and oversized sources stay outside the editor',async t=>{
  const {options,file,dir,inventory,item}=await fixture(t);const outside=path.join(dir,'outside.md');await fs.writeFile(outside,'Fixture');
  await fs.rm(file);await fs.symlink(outside,file);await assert.rejects(()=>readFile(options),/symlinks/);
  await fs.rm(file);await fs.link(outside,file);await assert.rejects(()=>readFile(options),/hard links/);
  await fs.rm(file);await fs.writeFile(file,'x'.repeat(256*1024+1));await assert.rejects(()=>readFile(options),/256 KiB/);
  const linked=path.join(options.home,'.claude','linked');await fs.symlink(path.dirname(outside),linked);
  await assert.rejects(()=>readFile({...options,inventory:{...inventory,items:[{...item,repo:'',scope:'global',path:path.join(linked,'outside.md')}]}}),/symlinks/);
});
test('backup failure or a change during backup leaves source content intact',async t=>{
  const {options,file,store}=await fixture(t);const initial=await readFile(options);
  await assert.rejects(()=>saveFile({...options,version:initial.version,content:'Draft',store:{write:async()=>{throw new Error('Synthetic backup failure');}}}),/backup failure/);
  assert.equal(await fs.readFile(file,'utf8'),initial.content);
  const write=store.write.bind(store);store.write=async(...args)=>{const result=await write(...args);if(args[0].endsWith('.metadata.json'))await fs.writeFile(file,'External edit during backup');return result;};
  await assert.rejects(()=>saveFile({...options,version:initial.version,content:'Draft'}),/changed during save/);
  assert.equal(await fs.readFile(file,'utf8'),'External edit during backup');assert.equal((await fs.readdir(path.dirname(file))).some(n=>n.includes('.harness-')),false);
});
test('HTTP editor requires CSRF and serves nonce-bearing editor UI while loading scopes remain validated',async t=>{
  const {home,store,file}=await fixture(t);const app=await createApp({home,dataDir:store.root,probe:async()=>[],dispatch:async()=>{throw new Error('No provider should be used');}});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>new Promise(resolve=>app.server.close(resolve)));
  const root='http://127.0.0.1:'+app.server.address().port,state=await fetch(root+'/api/state').then(r=>r.json());
  const post=async(route,body)=>{const r=await fetch(root+route,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':state.csrfToken},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  assert.equal((await fetch(root+'/api/file',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'fixture-file',action:'read'})})).status,400);
  assert.equal((await post('/api/loading',{repo:'/not-a-scanned-repo'})).status,400);assert.equal((await post('/api/loading',{agent:'unknown'})).status,400);
  assert.equal((await post('/api/loading',{agent:'codex',repo:store.settings.repos[0]})).status,200);
  const read=await post('/api/file',{id:'fixture-file',action:'read'});assert.equal(read.status,200);
  assert.equal((await post('/api/file',{id:'fixture-file',action:'save',content:'Updated fixture',version:read.body.version})).status,200);assert.equal(await fs.readFile(file,'utf8'),'Updated fixture');
  const response=await fetch(root+'/'),html=await response.text(),nonce=html.match(/name="editor-style-nonce" content="([a-f0-9]+)"/)?.[1];
  assert.ok(nonce);assert.ok(response.headers.get('Content-Security-Policy').includes("'nonce-"+nonce+"'"));assert.equal(html.includes('__EDITOR_NONCE__'),false);
  const latest=await fetch(root+'/api/state').then(r=>r.json()),id=latest.inventory.items.find(item=>item.path===file).id;await fs.rm(file);
  assert.equal((await post('/api/file',{id,action:'read'})).status,400);
  const failed=await fetch(root+'/api/state').then(r=>r.json());assert.ok(failed.gaps.some(gap=>gap.title==='Activity failed: file editor read'));
});
