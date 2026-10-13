import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {Store} from '../lib/store.mjs';
import {readFile,readFileBackup,saveFile} from '../lib/files.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex');
async function fixture(t,{name='AGENTS.md',content='# First fixture\n'}={}) {
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'harness-backup-'))),home=path.join(dir,'home'),repo=path.join(dir,'repo');
  await fs.mkdir(home);await fs.mkdir(repo);
  const file=path.join(repo,name);await fs.writeFile(file,content);
  const item={id:'fixture-file',name,type:'instruction',scope:'repo',repo,path:file},inventory={items:[item],repos:[repo]};
  const store=await new Store(path.join(dir,'generated')).init(),options={inventory,id:item.id,home,store};
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  return {dir,file,item,repo,store,options};
}
async function backup(f,{content='# Older fixture\n',originalPath=f.file,repo=f.repo,at='2026-01-01T00:00:00.000Z',updatedAt=at}={}) {
  const relative='backups/files/'+randomUUID()+'/'+path.basename(f.file),metadata=relative+'.metadata.json';
  await f.store.write(relative,content,{kind:'file-backup',pinned:true});
  await f.store.write(metadata,{originalPath,repo,version:digest(content),at},{kind:'file-backup',pinned:true});
  f.store.manifest[metadata].updatedAt=updatedAt;
  return {relative,metadata,content};
}
const preview=async f=>readFileBackup({...f.options,version:(await readFile(f.options)).version});
const invalid=/could not be safely verified/;

test('a save preserves exact original text and preview binds it to the current file version without writes',async t=>{
  const first='\uFEFF# First fixture\r\n',f=await fixture(t,{content:first}),initial=await readFile(f.options);
  const saved=await saveFile({...f.options,version:initial.version,content:'# Second fixture\n'});
  const manifest=JSON.stringify(f.store.manifest),before=await fs.readdir(path.dirname(f.file));
  f.store.write=()=>{throw new Error('Preview attempted a write');};
  const result=await readFileBackup({...f.options,version:saved.version});
  assert.equal(result.id,f.item.id);assert.equal(result.version,saved.version);assert.equal(result.content,first);
  assert.match(result.backupAt,/^\d{4}-\d{2}-\d{2}T/);
  assert.equal(await fs.readFile(f.file,'utf8'),saved.content);assert.equal(JSON.stringify(f.store.manifest),manifest);
  assert.deepEqual(await fs.readdir(path.dirname(f.file)),before);
});
test('repeat saves select the latest manifest entry for the exact file and repository',async t=>{
  const f=await fixture(t),first=await readFile(f.options);
  const second=await saveFile({...f.options,version:first.version,content:'# Second fixture\n'});
  f.store.manifest[second.backup+'.metadata.json'].updatedAt='2026-01-01T00:00:00.000Z';
  const third=await saveFile({...f.options,version:second.version,content:'# Third fixture\n'});
  f.store.manifest[third.backup+'.metadata.json'].updatedAt='2026-01-01T00:00:00.000Z';
  await backup(f,{originalPath:path.join(f.dir,'another-repo','AGENTS.md'),repo:path.join(f.dir,'another-repo'),at:'2026-01-03T00:00:00.000Z'});
  await backup(f,{repo:path.join(f.dir,'another-repo'),at:'2026-01-04T00:00:00.000Z'});
  assert.equal((await preview(f)).content,second.content);
  const older=await backup(f,{content:'# Higher metadata date\n',at:'2026-01-10T00:00:00.000Z',updatedAt:'2025-12-31T00:00:00.000Z'});
  assert.notEqual((await preview(f)).content,older.content);
});
test('manifest timestamp ties select the most recently inserted matching backup across JSON reloads',async t=>{
  const f=await fixture(t),left=await backup(f,{content:'# Left fixture\n'}),right=await backup(f,{content:'# Right fixture\n'});
  assert.equal(f.store.manifest[left.metadata].updatedAt,f.store.manifest[right.metadata].updatedAt);
  assert.equal((await preview(f)).content,right.content);
  f.store.manifest=JSON.parse(JSON.stringify(f.store.manifest));
  assert.equal((await preview(f)).content,right.content);
});
test('missing backups and stale or malformed current versions cannot produce a comparison',async t=>{
  const f=await fixture(t),initial=await readFile(f.options);
  await assert.rejects(()=>preview(f),/Backups are created when you save changes in this utility/);
  await backup(f);await fs.writeFile(f.file,'# External fixture edit\n');
  await assert.rejects(()=>readFileBackup({...f.options,version:initial.version}),/changed outside/);
  for(const version of [undefined,'',f.file,'a'.repeat(63)])await assert.rejects(()=>readFileBackup({...f.options,version}),/Reload/);
  await assert.rejects(()=>readFileBackup({...f.options,id:f.file,version:initial.version}),/inventory/);
});
test('global file backups match the empty repository scope exactly',async t=>{
  const f=await fixture(t),folder=path.join(f.options.home,'.codex');await fs.mkdir(folder);
  const file=path.join(folder,'AGENTS.md');await fs.rename(f.file,file);
  f.file=file;f.repo='';Object.assign(f.item,{path:file,repo:'',scope:'global'});
  const expected=await backup(f);
  await backup(f,{repo:f.options.inventory.repos[0],at:'2026-01-02T00:00:00.000Z'});
  assert.equal((await preview(f)).content,expected.content);
});
test('unsafe current sources are rejected before any backup artifact is opened',async t=>{
  for(const mode of ['hardlink','directory','utf8','oversized']) {
    const f=await fixture(t),initial=await readFile(f.options);await backup(f);
    const outside=path.join(f.dir,'outside-fixture');await fs.writeFile(outside,initial.content);await fs.rm(f.file);
    if(mode==='hardlink')await fs.link(outside,f.file);
    if(mode==='directory')await fs.mkdir(f.file);
    if(mode==='utf8')await fs.writeFile(f.file,Buffer.from([0xff]));
    if(mode==='oversized')await fs.writeFile(f.file,'x'.repeat(256*1024+1));
    let opened=false;f.store.location=()=>{opened=true;throw new Error('A backup artifact was opened');};
    await assert.rejects(()=>readFileBackup({...f.options,version:initial.version}));assert.equal(opened,false);
  }
});
test('identical backup content and a backup created by a failed save remain valid previews',async t=>{
  const f=await fixture(t),initial=await readFile(f.options),write=f.store.write.bind(f.store);
  f.store.write=async(...args)=>{const result=await write(...args);if(args[0].endsWith('.metadata.json'))await fs.writeFile(f.file,'# Concurrent fixture edit\n');return result;};
  await assert.rejects(()=>saveFile({...f.options,version:initial.version,content:'# Draft fixture\n'}),/changed during save/);
  assert.equal((await preview(f)).content,initial.content);
  await fs.writeFile(f.file,initial.content);
  assert.equal((await preview(f)).content,(await readFile(f.options)).content);
});
test('current and backup sensitive content are withheld, including JSON and YAML SOPS documents',async t=>{
  const hidden='synthetic-protected-fixture',key=['FIXTURE','SECRET','KEY'].join('_');
  for(const [name,content]of [['AGENTS.md',key+' = '+hidden],['settings.yaml','sops:\n  version: synthetic\n'],['settings.json',JSON.stringify({sops:{version:'synthetic'}})]]) {
    const f=await fixture(t,{name});await backup(f,{content});
    await assert.rejects(()=>preview(f),error=>/Sensitive-looking backup/.test(error.message)&&!error.message.includes(hidden));
    await fs.writeFile(f.file,content);
    await assert.rejects(()=>preview(f),error=>/Sensitive-looking content/.test(error.message)&&!error.message.includes(hidden));
  }
});
test('tampered latest backup content does not silently fall back to an older backup',async t=>{
  const f=await fixture(t);await backup(f);
  const latest=await backup(f,{at:'2026-01-02T00:00:00.000Z'}),hidden='synthetic-tampered-body';
  await fs.writeFile(await f.store.location(latest.relative),hidden);
  await assert.rejects(()=>preview(f),error=>invalid.test(error.message)&&!error.message.includes(hidden));
});
test('malformed latest matching metadata fails closed without exposing metadata or older content',async t=>{
  for(const patch of [null,{version:'invalid'},{at:'not-an-iso-date'},{at:'2026-02-31T00:00:00.000Z'},{originalPath:null},{repo:null}]) {
    const f=await fixture(t);await backup(f);
    const latest=await backup(f,{at:'2026-01-02T00:00:00.000Z'}),file=await f.store.location(latest.metadata);
    const metadata=JSON.parse(await fs.readFile(file,'utf8'));
    await fs.writeFile(file,patch===null?'synthetic-malformed-metadata':JSON.stringify({...metadata,...patch}));
    await assert.rejects(()=>preview(f),error=>invalid.test(error.message)&&!error.message.includes('synthetic-malformed-metadata'));
  }
  const f=await fixture(t),latest=await backup(f);f.store.manifest[latest.metadata].updatedAt='invalid';
  await assert.rejects(()=>preview(f),invalid);
});
test('only pinned backup entries in the supported generated namespace are considered',async t=>{
  const f=await fixture(t),saved=await backup(f),metadataEntry=f.store.manifest[saved.metadata];
  const paths=['../AGENTS.md.metadata.json','backups/files/not-a-uuid/AGENTS.md.metadata.json','backups/files/'+randomUUID()+'/other.md.metadata.json','_archive/'+saved.metadata,saved.metadata.replaceAll('/','\\')];
  f.store.manifest=Object.fromEntries(paths.map(file=>[file,metadataEntry]));
  f.store.manifest[saved.metadata]={...metadataEntry,pinned:false};
  f.store.location=()=>{throw new Error('An unsupported artifact was opened');};
  await assert.rejects(()=>preview(f),/No saved backup/);
  f.store.manifest[saved.metadata]={...metadataEntry,kind:'report'};
  await assert.rejects(()=>preview(f),/No saved backup/);
});
test('matching metadata cannot reference an unpinned, wrong-kind or absent content partner',async t=>{
  for(const patch of [null,{pinned:false},{kind:'report'}]) {
    const f=await fixture(t);await backup(f);
    const latest=await backup(f,{at:'2026-01-02T00:00:00.000Z'});
    if(patch===null)delete f.store.manifest[latest.relative];else Object.assign(f.store.manifest[latest.relative],patch);
    await assert.rejects(()=>preview(f),invalid);
  }
});
test('unrelated exact-basename metadata is skipped while other source content is never opened',async t=>{
  const f=await fixture(t),expected=await backup(f),other=await backup(f,{originalPath:path.join(f.dir,'another-repo','AGENTS.md'),repo:path.join(f.dir,'another-repo'),at:'2026-01-02T00:00:00.000Z'});
  await fs.writeFile(await f.store.location(other.relative),Buffer.from([0xff]));
  assert.equal((await preview(f)).content,expected.content);
});
test('unsafe, non-UTF8 and oversized metadata or content fails closed',async t=>{
  for(const target of ['metadata','relative'])for(const mode of ['symlink','hardlink','directory','utf8','oversized']) {
    const f=await fixture(t),saved=await backup(f),file=await f.store.location(saved[target]),outside=path.join(f.dir,'outside-fixture');
    await fs.writeFile(outside,await fs.readFile(file));await fs.rm(file);
    if(mode==='symlink')await fs.symlink(outside,file);
    if(mode==='hardlink')await fs.link(outside,file);
    if(mode==='directory')await fs.mkdir(file);
    if(mode==='utf8')await fs.writeFile(file,Buffer.from([0xff]));
    if(mode==='oversized')await fs.writeFile(file,'x'.repeat(256*1024+1));
    await assert.rejects(()=>preview(f),invalid);
  }
});
test('symlink ancestors in generated storage or current sources are rejected',async t=>{
  const f=await fixture(t),saved=await backup(f),folder=path.dirname(await f.store.location(saved.relative)),outside=path.join(f.dir,'moved-fixtures');
  await fs.rename(folder,outside);await fs.symlink(outside,folder);
  await assert.rejects(()=>preview(f),invalid);
  await fs.rm(folder);await fs.rename(outside,folder);
  const original=await readFile(f.options),source=path.join(f.dir,'source-fixture.md');
  await fs.rename(f.file,source);await fs.symlink(source,f.file);
  await assert.rejects(()=>readFileBackup({...f.options,version:original.version}),/symlinks/);
});
