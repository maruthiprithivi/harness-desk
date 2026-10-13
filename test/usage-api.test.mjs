import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createApp} from '../server.mjs';
import {Store} from '../lib/store.mjs';

async function fixture(t){
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'usage-api-'))),home=path.join(dir,'home-fixture'),repo=path.join(dir,'repos','a'),other=path.join(dir,'repos','b');
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  for(const root of [repo,other,path.join(home,'.claude','skills','fixture-skill')])await fs.mkdir(root,{recursive:true});
  await fs.writeFile(path.join(home,'.claude','skills','fixture-skill','SKILL.md'),'---\nname: fixture-skill\ndescription: Synthetic example\n---\nExample');
  await fs.writeFile(path.join(repo,'AGENTS.md'),'Synthetic instruction');
  await fs.writeFile(path.join(repo,'.mcp.json'),JSON.stringify({mcpServers:{fixture_server:{command:'synthetic-launcher'}}}));
  const store=await new Store(path.join(dir,'data')).init();await store.saveSettings({...store.settings,repos:[repo,other],repoRoots:[]});
  const app=await createApp({home,dataDir:store.root,probe:async()=>[],dispatch:async()=>{throw new Error('Unexpected dispatch');}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>app.server.close(resolve)));
  const root='http://127.0.0.1:'+app.server.address().port,state=await fetch(root+'/api/state').then(response=>response.json());
  const post=async(route,body)=>{const response=await fetch(root+route,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':state.csrfToken},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
  await post('/api/scan',{});return {app,home,repo,other,root,post,token:state.csrfToken};
}
function records(repo,{name='fixture-skill',id='call-private-identity',kind='skill',at=new Date().toISOString()}={}){
  return [
    {type:'assistant',sessionId:'private-session-identity',cwd:repo,timestamp:at,message:{content:[{type:'tool_use',id,name:kind==='skill'?'Skill':'mcp__fixture_server__query',input:kind==='skill'?{skill:name,args:'private argument'}:{query:'private argument'}}]}},
    {type:'user',sessionId:'private-session-identity',cwd:repo,timestamp:at,message:{content:[{type:'tool_result',tool_use_id:id,content:'private result',is_error:true}]}},
    {type:'user',sessionId:'private-session-identity',cwd:repo,timestamp:at,message:{content:[{type:'text',text:'private prompt'}]}}
  ];
}
const file=rows=>({name:'session-export.jsonl',content:rows.map(row=>JSON.stringify(row)).join('\n')});

test('session evidence is scoped, metadata-only, replaces counts, persists and stays pinned',async t=>{
  const {app,home,repo,other,post}=await fixture(t),map=async(scope=repo,agent='claude')=>(await post('/api/loading',{repo:scope,agent})).body.components;
  const item=(await map()).items.find(item=>item.name==='fixture-skill');assert.ok(item);assert.equal((await map()).usageEvidence,null);
  const body={agent:'claude',repo,days:7,files:[file([...records(repo),...records(other,{id:'other-id',name:'other-repo-skill'}),...records('',{id:'global-id',name:'global-skill'})])]};
  assert.equal((await post('/api/usage-import',body)).status,200);
  let components=await map();assert.equal(components.usageEvidence.totals.calls,1);assert.equal(components.usageEvidence.totals.failed,1);assert.equal(components.usageEvidence.coverage.excludedOtherScope,2);
  assert.equal(components.items.find(entry=>entry.id===item.id).callEvidence.matches[0].calls,1);
  assert.equal(components.summary.used,0);assert.equal((await map(other)).usageEvidence,null);assert.equal((await map('')).usageEvidence,null);assert.equal((await map(repo,'codex')).usageEvidence,null);
  await post('/api/usage-import',body);assert.equal((await map()).usageEvidence.totals.calls,1);
  const stored=JSON.stringify(await app.store.read('usage-evidence.json'));
  for(const value of ['private-session-identity','call-private-identity','private argument','private result','private prompt','other-repo-skill','global-skill','session-export'])assert.equal(stored.includes(value),false,value);
  assert.equal(app.store.manifest['usage-evidence.json'].pinned,true);app.store.manifest['usage-evidence.json'].updatedAt='2000-01-01T00:00:00Z';await app.store.prune(1,false);assert.ok(await app.store.read('usage-evidence.json'));
  const context={repo,reviewAgent:'claude',selectionMode:'explicit',selectedIds:[item.id],sections:['inventory']};
  let preview=JSON.parse(app.context(context).text);assert.equal(preview.inventory[0].callEvidence.matches[0].calls,1);assert.equal(preview.sessionCoverage.agent,'claude');
  assert.equal(JSON.parse(app.context({...context,reviewAgent:'codex'}).text).sessionCoverage,undefined);
  assert.equal(JSON.parse(app.context({...context,repo:'',globalOnly:false}).text).sessionCoverage,undefined);
  const resumed=await createApp({home,dataDir:app.store.root,probe:async()=>[]});preview=JSON.parse(resumed.context(context).text);assert.equal(preview.inventory[0].callEvidence.matches[0].calls,1);
  await post('/api/usage-import',{...body,files:[file(records(repo,{name:'another-skill',id:'new-id'}))]});components=await map();assert.equal(components.usageEvidence.items.length,1);assert.equal(components.items.find(entry=>entry.id===item.id).callEvidence.matches.length,0);
});

test('imports require CSRF and supported scope; unreadable imports keep existing evidence',async t=>{
  const {repo,root,post}=await fixture(t),body={agent:'claude',repo,files:[file(records(repo))]};
  assert.equal((await fetch(root+'/api/usage-import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).status,400);
  for(const patch of [{agent:'kiro'},{repo:'/fixture/not-scanned'},{days:2},{files:[],paths:[]}])assert.equal((await post('/api/usage-import',{...body,...patch})).status,400);
  await post('/api/usage-import',body);
  for(const files of [[{name:'auth.json',content:'{}'}],[{path:'/fixture/session.jsonl'}],[{name:'session.jsonl',content:'x'.repeat(2*1024*1024+1)}]])assert.equal((await post('/api/usage-import',{...body,files})).status,400);
  assert.equal((await post('/api/loading',{repo,agent:'claude'})).body.components.usageEvidence.totals.calls,1);
});

test('MCP call names are associated only with explicitly inspected scoped configurations',async t=>{
  const {repo,post,app}=await fixture(t),map=async()=>(await post('/api/loading',{repo,agent:'claude'})).body.components;
  const config=(await map()).items.find(item=>item.name==='.mcp.json');assert.ok(config);
  await post('/api/usage-import',{repo,agent:'claude',files:[file(records(repo,{kind:'mcp'}))]});assert.equal((await map()).items.find(item=>item.id===config.id).callEvidence,null);
  assert.equal((await post('/api/tool-inspection',{id:config.id,repo,agent:'claude'})).status,200);
  const evidence=(await map()).items.find(item=>item.id===config.id).callEvidence;assert.equal(evidence.matches[0].tool,'query');assert.equal(evidence.ambiguous,true);assert.match(evidence.attribution,/unverified/);
  const preview=JSON.parse(app.context({repo,reviewAgent:'claude',selectionMode:'explicit',selectedIds:[config.id],sections:['inventory']}).text);
  assert.equal(preview.inventory[0].callEvidence.matches[0].calls,1);assert.equal(JSON.stringify(preview).includes('synthetic-launcher'),false);
  await post('/api/usage-import',{repo,agent:'claude',files:[{name:'partial.jsonl',content:'{broken\n'+file(records(repo)).content}]});
  const gaps=(await fetch('http://127.0.0.1:'+app.server.address().port+'/api/state').then(response=>response.json())).gaps;
  assert.ok(gaps.some(gap=>gap.repo===repo&&gap.agent==='claude'&&gap.title==='Session call evidence is incomplete'));
});

test('JSON decoding is bounded, preserves Unicode, and never reflects malformed request contents',async t=>{
  const {repo,root,post,token}=await fixture(t),rows=records(repo);rows.push({type:'user',sessionId:'ignored',cwd:repo,message:{content:[{type:'text',text:'中'.repeat(190000)}]}});
  assert.equal((await post('/api/usage-import',{repo,agent:'claude',files:[file(rows)]})).status,200);
  const response=await fetch(root+'/api/usage-import',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':token},body:'{"private-body-value"'});
  assert.equal(response.status,400);assert.deepEqual(await response.json(),{error:'Request JSON could not be parsed'});
  const oversized=await fetch(root+'/api/context',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':token},body:JSON.stringify({value:'中'.repeat(180000)})});assert.equal(oversized.status,400);assert.equal((await oversized.json()).error,'Request is too large');
});

test('an oversized streaming request receives a JSON error before its upload ends',async t=>{
  const {root,token}=await fixture(t);
  const result=await new Promise((resolve,reject)=>{
    const request=http.request(root+'/api/context',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':token}},response=>{
      let body='';response.setEncoding('utf8');response.on('data',chunk=>{body+=chunk;});
      response.on('error',reject);response.on('end',()=>{request.destroy();resolve({status:response.statusCode,body});});
    });
    request.on('error',reject);request.setTimeout(2000,()=>request.destroy(new Error('Oversized upload did not receive its bounded JSON response')));
    // Leave the chunked request open so the size limit is reached before EOF.
    request.write('{"value":"'+'x'.repeat(600000));
  });
  assert.equal(result.status,400);assert.deepEqual(JSON.parse(result.body),{error:'Request is too large'});
});
