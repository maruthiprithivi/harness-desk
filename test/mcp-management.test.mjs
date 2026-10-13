import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {Store} from '../lib/store.mjs';
import {listMcpServers,createMcpManager,transformMcpConfig} from '../lib/mcp-management.mjs';
import {readFile,readFileBackup,saveFile} from '../lib/files.mjs';
import {inspectToolMetadata} from '../lib/tool-metadata.mjs';
import {createApp} from '../server.mjs';

async function fixture(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'harness-mcp-')),home=path.join(dir,'home'),repo=path.join(dir,'project');
  await fs.mkdir(home);await fs.mkdir(repo);t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const store=await new Store(path.join(dir,'data')).init(),inventory={items:[],repos:[repo],warnings:[],coverage:{partial:false},scannedAt:new Date().toISOString()};
  async function add(relative,content,{global=false,agent='codex',type='config'}={}) {
    const file=path.join(global?home:repo,relative);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,content);
    const stat=await fs.stat(file),item={id:'fixture-'+inventory.items.length,path:file,name:path.basename(file),type,agent,repo:global?'':repo,scope:global?'global':'project',bytes:Buffer.byteLength(content),modifiedAt:stat.mtime.toISOString()};inventory.items.push(item);return item;
  }
  return {home,repo,store,inventory,add,options:{home,repo,store,inventory,agent:'codex'}};
}

test('MCP manager lists named sources, static configuration states and unknown runtime/auth without values',async t=>{
  const f=await fixture(t);
  await f.add('.codex/config.toml','[mcp_servers.local]\ncommand="fixture-launcher"\nenabled=false\n',{global:true});
  await f.add('.codex/plugins/cache/sample-vendor/sample-plugin/1.0/.mcp.json',JSON.stringify({mcpServers:{remote:{type:'http',url:'https://example.invalid/private',headers:{Authorization:'synthetic-private'}}}}),{global:true,type:'mcp-server'});
  await f.add('.mcp.json','{"mcpServers":{"missing":{"type":"stdio"},"unsupported":null,"badurl":{"type":"http","url":"not-a-url"}}}',{agent:'shared',type:'mcp-server'});
  const result=await listMcpServers(f.options);assert.equal(result.servers.length,5);
  const local=result.servers.find(item=>item.name==='local');assert.equal(local.configuredEnabled,false);assert.equal(local.configurationStatus,'valid');assert.deepEqual(local.allowedActions,['enable','disable','remove']);
  const plugin=result.servers.find(item=>item.name==='remote');assert.equal(plugin.sourceLabel,'sample-plugin');assert.equal(plugin.sourceKind,'plugin');assert.deepEqual(plugin.allowedActions,[]);
  assert.equal(result.servers.find(item=>item.name==='missing').configurationStatus,'incomplete');assert.equal(result.servers.find(item=>item.name==='unsupported').configurationStatus,'unsupported');assert.equal(result.servers.find(item=>item.name==='badurl').configurationStatus,'incomplete');
  for(const row of result.servers){assert.equal(row.authentication,'unknown');assert.equal(row.runtime,'unknown');}
  for(const hidden of ['synthetic-private','fixture-launcher','example.invalid','Authorization'])assert.equal(JSON.stringify(result).includes(hidden),false);
  const global=await listMcpServers({...f.options,repo:''});assert.equal(global.servers.length,2);
  assert.deepEqual((await listMcpServers({...f.options,agent:'claude',repo:''})).servers,[]);
});

test('MCP action review binds scope, server, action and version, saves a restorable backup and is one use',async t=>{
  const f=await fixture(t),original='model="fixture-model"\n[mcp_servers.first]\ncommand="fixture-one"\n[mcp_servers.second]\ncommand="fixture-two"\n',item=await f.add('.codex/config.toml',original),change=createMcpManager(),options={...f.options,id:item.id,server:'first',action:'disable'};
  const preview=await change({...options,phase:'preview'});assert.equal(preview.after.configuredEnabled,false);assert.equal(JSON.stringify(preview).includes('fixture-one'),false);
  await assert.rejects(()=>change({...options,phase:'apply',reviewToken:preview.reviewToken,action:'remove'}),/review changed/);
  await assert.rejects(()=>change({...options,phase:'apply',reviewToken:preview.reviewToken,repo:''}),/scope/);
  const saved=await change({...options,phase:'apply',reviewToken:preview.reviewToken});assert.equal(saved.saved,true);assert.ok(saved.backup);assert.equal(await fs.readFile(await f.store.location(saved.backup),'utf8'),original);
  const restored=await readFileBackup({...f.options,id:item.id,version:saved.version});assert.equal(restored.content,original);
  const updated=await fs.readFile(item.path,'utf8');assert.match(updated,/\[mcp_servers.first\]\nenabled = false/);assert.match(updated,/\[mcp_servers.second\]\ncommand="fixture-two"/);
  await assert.rejects(()=>change({...options,phase:'apply',reviewToken:preview.reviewToken}),/review changed/);
  const next=await change({...options,phase:'preview'});await fs.appendFile(item.path,'\n# external edit');await assert.rejects(()=>change({...options,phase:'apply',reviewToken:next.reviewToken}),/review changed/);
});

test('protected, combined-account and plugin definitions are inspect-only',async t=>{
  const f=await fixture(t),change=createMcpManager();
  const protectedItem=await f.add('.codex/config.toml','[mcp_servers.fixture]\ncommand="fixture"\n[mcp_servers.fixture.env]\nAPI_KEY="synthetic-private"\n');
  const combined=await f.add('.claude.json','{"mcpServers":{"fixture":{"command":"fixture"}}}',{agent:'claude',global:true,type:'mcp-server'});
  const plugin=await f.add('.codex/plugins/cache/vendor/plugin/1/.mcp.json','{"mcpServers":{"fixture":{"command":"fixture"}}}',{global:true,type:'mcp-server'});
  for(const item of [protectedItem,combined,plugin])await assert.rejects(()=>change({...f.options,id:item.id,agent:item.agent,server:'fixture',action:'remove',phase:'preview'}),/Protected|Combined|Plugin/);
  const view=await readFile({...f.options,id:plugin.id});assert.equal(view.editable,false);assert.match(view.reason,/Plugin-managed/);
  await assert.rejects(()=>saveFile({...f.options,id:plugin.id,version:view.version,content:'{}'}),/cannot be saved/);
  assert.equal(Object.values(f.store.manifest).some(entry=>entry.kind==='file-backup'),false);
});

test('JSON mutations preserve unrelated bytes and remove only the chosen definition',()=>{
  const original='{ "count":9007199254740993,"mcpServers": { "first":{"command":"fixture", "x":9007199254740993}, "second":{"command":"fixture", "disabled":false} },"theme":"dark" }';
  const disable=transformMcpConfig(original,{format:'json',agent:'kiro',server:'first',action:'disable'});assert.match(disable,/9007199254740993/);assert.equal(JSON.parse(disable).mcpServers.first.disabled,true);assert.equal(disable.replace(',"disabled": true',''),original);
  for(const server of ['first','second']){const remove=transformMcpConfig(original,{format:'json',agent:'claude',server,action:'remove'});assert.equal(Object.hasOwn(JSON.parse(remove).mcpServers,server),false);assert.equal(Object.keys(JSON.parse(remove).mcpServers).length,1);assert.match(remove,/"count":9007199254740993/);assert.match(remove,/"theme":"dark"/);}
  const only=transformMcpConfig('{"mcpServers":{"only":{"command":"fixture"}}}',{format:'json',agent:'claude',server:'only',action:'remove'});assert.deepEqual(JSON.parse(only),{mcpServers:{}});
  assert.throws(()=>transformMcpConfig(original,{format:'json',agent:'claude',server:'first',action:'disable'}),/unsupported/);
});

test('JSON ambiguity and unsupported syntax cannot be rewritten',()=>{
  for(const content of ['{"mcpServers":{"first":{"command":"fixture","command":"other"}}}','{"mcpServers":{"first":{"command":"fixture"},"first":{"command":"other"}}}','{"mcpServers":{"first":{"command":"fixture"}},"mcpServers":{"first":{"command":"other"}}}'])assert.throws(()=>transformMcpConfig(content,{format:'json',agent:'kiro',server:'first',action:'remove'}),/Duplicate/);
  assert.throws(()=>transformMcpConfig('[mcp_servers.first]\ncommand="""multi\nline"""',{format:'toml',agent:'codex',server:'first',action:'remove'}),/supported/);
});

test('Codex TOML enable and removal preserve unrelated tables, nested fields and comments',()=>{
  const original='model = "fixture"\r\n[mcp_servers."dot.name"]\r\ncommand="fixture"\r\nenabled = true # keep explanation\r\n[mcp_servers."dot.name".env]\r\nEXAMPLE="fixture"\r\n[mcp_servers.second]\r\ncommand="other"\r\n[features]\r\nexample=true\r\n';
  const disabled=transformMcpConfig(original,{format:'toml',agent:'codex',server:'dot.name',action:'disable'});assert.equal(disabled,original.replace('enabled = true','enabled = false'));
  const removed=transformMcpConfig(original,{format:'toml',agent:'codex',server:'dot.name',action:'remove'});assert.equal(removed,'model = "fixture"\r\n[mcp_servers.second]\r\ncommand="other"\r\n[features]\r\nexample=true\r\n');
  const fields=inspectToolMetadata(disabled,{format:'toml',agent:'codex'});assert.equal(fields.servers[0].configuredEnabled,false);
});

test('manager enablement metadata uses only harness-supported flags',()=>{
  const inspect=(text,format,agent)=>inspectToolMetadata(text,{format,agent,detailed:true}).servers[0];
  const codex=inspect('[mcp_servers.fixture]\ncommand="fixture"\nenabled=false\n','toml','codex');assert.equal(codex.configuredEnabled,false);
  const kiro=inspect('{"mcpServers":{"fixture":{"command":"fixture","disabled":true}}}','json','kiro');assert.equal(kiro.configuredEnabled,false);
  for(const agent of ['claude','codex']){const unsupported=inspect('{"mcpServers":{"fixture":{"command":"fixture","enabled":true}}}','json',agent);assert.equal(unsupported.configuredEnabled,null);assert.equal(unsupported.configurationStatus,'unsupported');}
});

test('MCP APIs enforce CSRF, scope and reviewed application without provider dispatch',async t=>{
  const f=await fixture(t),item=await f.add('.codex/config.toml','[mcp_servers.fixture]\ncommand="fixture"\n');await f.store.saveSettings({...f.store.settings,repos:[f.repo]});await f.store.write('inventory/current.json',f.inventory);
  const app=await createApp({home:f.home,dataDir:f.store.root,probe:async()=>[],dispatch:async()=>{throw new Error('Provider dispatch is forbidden');}});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>new Promise(resolve=>app.server.close(resolve)));
  const root='http://127.0.0.1:'+app.server.address().port,state=await fetch(root+'/api/state').then(response=>response.json());
  const post=async(route,body,csrf=state.csrfToken)=>{const response=await fetch(root+route,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
  assert.equal((await post('/api/mcp-manager',{agent:'codex',repo:f.repo},'')).status,400);
  assert.equal((await post('/api/mcp-manager',{agent:'unknown',repo:f.repo})).status,400);
  assert.equal((await post('/api/mcp-manager',{agent:'codex',repo:'/outside'})).status,400);
  const list=await post('/api/mcp-manager',{agent:'codex',repo:f.repo});assert.equal(list.status,200);assert.equal(list.body.servers[0].name,'fixture');
  const body={agent:'codex',repo:f.repo,id:item.id,server:'fixture',action:'remove'};
  assert.equal((await post('/api/mcp-action',{...body,phase:'apply'})).status,400);
  assert.equal((await post('/api/mcp-action',{...body,phase:'preview',path:item.path})).status,400);
  const preview=await post('/api/mcp-action',{...body,phase:'preview'});assert.equal(preview.status,200);
  const apply=await post('/api/mcp-action',{...body,phase:'apply',reviewToken:preview.body.reviewToken});assert.equal(apply.status,200);assert.equal(apply.body.saved,true);assert.equal(await fs.readFile(item.path,'utf8'),'');
});
