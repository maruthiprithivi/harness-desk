import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {configurationTargets,createConfiguration} from '../lib/configuration.mjs';
import {scan} from '../lib/inventory.mjs';
import {readFile,saveFile} from '../lib/files.mjs';
import {Store} from '../lib/store.mjs';

async function fixture(t) {
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'configuration-test-')));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const home=path.join(root,'home'),repo=path.join(root,'repo');
  await fs.mkdir(home);await fs.mkdir(repo);
  const inventory=await scan({home,repos:[repo]});
  return {root,home,repo,inventory,agent:'claude'};
}

test('targets use fixed documented global and project homes without writing',async t=>{
  const f=await fixture(t),global=await configurationTargets({...f,repo:''}),project=await configurationTargets({...f,repo:f.repo});
  assert.equal(global.targets.find(item=>item.key==='instruction').path,path.join(f.home,'.claude','CLAUDE.md'));
  const mcp=global.targets.find(item=>item.key==='mcp');assert.equal(mcp.path,path.join(f.home,'.claude.json'));assert.equal(mcp.creatable,false);
  assert.equal(project.targets.find(item=>item.key==='mcp').path,path.join(f.repo,'.mcp.json'));
  assert.equal(project.targets.find(item=>item.key==='config-local').scope,'local');
  assert.equal(project.targets.find(item=>item.key==='instruction-local').path,path.join(f.repo,'CLAUDE.local.md'));
  const codex=await configurationTargets({...f,agent:'codex',repo:''});
  assert.equal(codex.targets.find(item=>item.key==='skill').path,path.join(f.home,'.agents','skills','<name>','SKILL.md'));
  assert.equal(codex.targets.find(item=>item.key==='subagent').creatable,false);
  assert.deepEqual(await fs.readdir(f.home),[]);assert.deepEqual(await fs.readdir(f.repo),[]);
});

for(const agent of ['claude','codex'])for(const placement of ['global','repo'])test(agent+' '+placement+' starters are discovered and editable through the existing backed-up editor',async t=>{
  const f=await fixture(t),repo=placement==='repo'?f.repo:'',options={...f,agent,repo};
  for(const target of ['instruction','config','skill',...(agent==='claude'?['subagent',...(repo?['mcp','config-local','instruction-local']:[])]:['instruction-override'])]) {
    const created=await createConfiguration({...options,target,...(['skill','subagent'].includes(target)?{name:'sample-task'}:{})});
    assert.equal(created.created,true);assert.equal((await fs.stat(created.path)).nlink,1);
    const inventory=await scan({home:f.home,repos:[f.repo]}),item=inventory.items.find(item=>item.path===created.path);
    assert.ok(item,'created target is discovered');
    const opened=await readFile({inventory,id:item.id,home:f.home});assert.equal(opened.editable,true);assert.equal(opened.language,created.language);
    const body=created.language==='json'?'{}\n':opened.content+'\n';
    const store=await new Store(path.join(f.root,'data')).init();
    const saved=await saveFile({inventory,id:item.id,home:f.home,store,content:body,version:opened.version});
    assert.equal(saved.saved,body!==opened.content);if(saved.saved)assert.ok(saved.backup);
    const listed=await configurationTargets({...options,inventory});
    if(!['skill','subagent'].includes(target))assert.equal(listed.targets.find(entry=>entry.key===target).existingId,item.id);
  }
});

test('creation never overwrites an existing file or reads its contents',async t=>{
  const f=await fixture(t),options={...f,repo:f.repo,target:'instruction'},file=path.join(f.repo,'CLAUDE.md');
  const original='# External user file\n';await fs.writeFile(file,original);
  await assert.rejects(createConfiguration(options),/already exists/);assert.equal(await fs.readFile(file,'utf8'),original);
  const listed=await configurationTargets({...f,repo:f.repo});assert.equal(listed.targets.find(item=>item.key==='instruction').creatable,false);
});

test('unknown agents, unscanned repositories and arbitrary targets are rejected before directories are created',async t=>{
  const f=await fixture(t);
  for(const patch of [{agent:'other'},{repo:path.join(f.root,'other')},{target:'../../elsewhere'},{target:'mcp'},{target:'instruction',name:'extra'},{agent:'codex',target:'subagent'}])await assert.rejects(createConfiguration({...f,repo:'',target:'instruction',...patch}));
  assert.deepEqual(await fs.readdir(f.home),[]);
});

test('component names cannot escape, hide sources, use Windows device names or introduce sensitive paths',async t=>{
  const f=await fixture(t);
  for(const name of ['',null,'../escape','a/b','a\\b','.hidden','UPPER','two--hyphens','con','nul','com1','lpt9','secret-task','my-token','oauth','password-check','sops-file','synced','anthropic-skills','x'.repeat(65)])await assert.rejects(createConfiguration({...f,repo:f.repo,target:'skill',name}));
  assert.deepEqual(await fs.readdir(f.repo),[]);
});

test('Claude reserved skill names remain available to Codex',async t=>{
  const f=await fixture(t);
  const result=await createConfiguration({...f,agent:'codex',repo:f.repo,target:'skill',name:'synced'});
  assert.equal(result.path,path.join(f.repo,'.agents','skills','synced','SKILL.md'));
  assert.match(await fs.readFile(result.path,'utf8'),/name: synced/);
});

test('symlink ancestors, symlink targets and hardlinked existing files cannot be managed',async t=>{
  const f=await fixture(t),outside=path.join(f.root,'outside');await fs.mkdir(outside);
  await fs.symlink(outside,path.join(f.repo,'.claude'));
  await assert.rejects(createConfiguration({...f,repo:f.repo,target:'config'}),/symlink/);
  assert.equal((await configurationTargets({...f,repo:f.repo})).targets.find(item=>item.key==='config').creatable,false);
  await fs.symlink(path.join(outside,'file'),path.join(f.repo,'CLAUDE.md'));
  await assert.rejects(createConfiguration({...f,repo:f.repo,target:'instruction'}),/symlink/);
  await fs.writeFile(path.join(outside,'original'),'unchanged');await fs.link(path.join(outside,'original'),path.join(f.repo,'CLAUDE.local.md'));
  const local=(await configurationTargets({...f,repo:f.repo})).targets.find(item=>item.key==='instruction-local');assert.equal(local.creatable,false);assert.match(local.reason,/hard links/);
  assert.deepEqual(await fs.readdir(outside),['original']);
});

test('concurrent create requests publish one complete file and preserve the winner',async t=>{
  const f=await fixture(t);await fs.mkdir(path.join(f.home,'.claude'));
  const options={...f,repo:'',target:'instruction'},results=await Promise.allSettled([createConfiguration(options),createConfiguration(options)]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  const file=path.join(f.home,'.claude','CLAUDE.md');assert.match(await fs.readFile(file,'utf8'),/^# Agent instructions\n/);
  assert.equal((await fs.stat(file)).nlink,1);assert.deepEqual(await fs.readdir(path.dirname(file)),['CLAUDE.md']);
});

test('staging failure removes only newly owned empty directories and leaves existing files alone',async t=>{
  const f=await fixture(t),originalOpen=fs.open;
  const unrelated=path.join(f.repo,'README.md');await fs.writeFile(unrelated,'preserve');
  fs.open=async(file,...args)=>{if(path.basename(file).startsWith('.harness-starter-'))throw Object.assign(new Error('Synthetic disk failure'),{code:'ENOSPC'});return originalOpen(file,...args);};
  try{await assert.rejects(createConfiguration({...f,repo:f.repo,target:'skill',name:'sample-task'}),/Synthetic disk failure/);}finally{fs.open=originalOpen;}
  assert.deepEqual(await fs.readdir(f.repo),['README.md']);assert.equal(await fs.readFile(unrelated,'utf8'),'preserve');
});

test('publication failure leaves no partial destination or unowned files removed',async t=>{
  const f=await fixture(t),originalLink=fs.link;
  await fs.mkdir(path.join(f.repo,'.claude'));await fs.writeFile(path.join(f.repo,'.claude','settings.json'),'{}\n');
  fs.link=async(source,destination)=>{if(path.basename(source).startsWith('.harness-starter-'))throw Object.assign(new Error('Synthetic publish failure'),{code:'EIO'});return originalLink(source,destination);};
  try{await assert.rejects(createConfiguration({...f,repo:f.repo,target:'skill',name:'sample-task'}),/Synthetic publish failure/);}finally{fs.link=originalLink;}
  assert.deepEqual(await fs.readdir(path.join(f.repo,'.claude')),['settings.json']);assert.equal(await fs.readFile(path.join(f.repo,'.claude','settings.json'),'utf8'),'{}\n');
});
