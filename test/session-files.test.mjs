import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {findSessionFiles} from '../lib/session-files.mjs';

async function fixture(t) {
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'session-files-')));
  const home=path.join(dir,'fixture-home');await fs.mkdir(home);
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const root=agent=>path.join(home,agent==='claude'?'.claude':'.codex',agent==='claude'?'projects':'sessions');
  async function file(agent,label,body='Synthetic session body must remain unread.') {
    const target=path.join(root(agent),label);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,body);return target;
  }
  return {dir,home,root,file};
}

function metadataOnly(result) {
  const text=JSON.stringify(result);
  assert.equal(text.includes('Synthetic session body'),false);
  assert.ok(result.files.every(file=>Object.keys(file).every(key=>['path','label','bytes','modifiedAt','importable'].includes(key))));
  assert.match(result.interpretation,/File metadata only.*Working repository unknown until import.*Default location only/);
  for(const file of result.files) {assert.ok(path.isAbsolute(file.path));assert.ok(Number.isFinite(Date.parse(file.modifiedAt)));}
}

test('Claude and Codex use only their nested default roots and return metadata',async t=>{
  const f=await fixture(t);
  const claude=await f.file('claude','project-one/session.jsonl');
  const codex=await f.file('codex','2026/10/07/session.json');
  await fs.mkdir(path.join(f.home,'unrelated'),{recursive:true});await fs.writeFile(path.join(f.home,'unrelated','session.json'),'Synthetic session body');
  for(const [agent,expected,label] of [['claude',claude,'project-one/session.jsonl'],['codex',codex,'2026/10/07/session.json']]) {
    const result=await findSessionFiles({home:f.home,agent,root:path.join(f.home,'unrelated')});
    assert.equal(result.rootStatus,'available');assert.equal(result.coverage.partial,false);assert.equal(result.coverage.filesFound,1);
    assert.deepEqual(result.files.map(file=>file.path),[expected]);assert.equal(result.files[0].label,label);assert.equal(result.files[0].importable,true);metadataOnly(result);
  }
});

test('invalid UTF-8 and oversized files remain visible without opening or parsing their bodies',async t=>{
  const f=await fixture(t),invalid=await f.file('claude','invalid.jsonl',Buffer.from([0xff,0xfe,0x00])),large=await f.file('claude','large.json');
  await fs.truncate(large,2*1024*1024+1);
  const result=await findSessionFiles({home:f.home,agent:'claude'});
  assert.equal(result.coverage.partial,false);assert.equal(result.coverage.filesFound,2);
  assert.equal(result.files.find(file=>file.path===invalid).bytes,3);assert.equal(result.files.find(file=>file.path===invalid).importable,true);
  assert.equal(result.files.find(file=>file.path===large).importable,false);
  assert.equal(result.files.find(file=>file.path===large).bytes,2*1024*1024+1);metadataOnly(result);
});

test('session lookup never calls content-reading APIs',async t=>{
  const f=await fixture(t);await f.file('claude','one.jsonl');
  const methods=['readFile','open'],originals=methods.map(method=>fs[method]);
  try {
    for(const method of methods)fs[method]=async()=>{throw new Error('Unexpected content read');};
    const result=await findSessionFiles({home:f.home,agent:'claude'});assert.equal(result.files.length,1);assert.equal(result.coverage.partial,false);
  }finally {methods.forEach((method,index)=>{fs[method]=originals[index];});}
});

test('newest-first order uses a stable relative-label tie and retains only newest found files',async t=>{
  const f=await fixture(t),older=await f.file('claude','old.json'),first=await f.file('claude','a.json'),second=await f.file('claude','b.json');
  await fs.utimes(older,100,100);for(const file of [first,second])await fs.utimes(file,200,200);
  assert.deepEqual((await findSessionFiles({home:f.home,agent:'claude'})).files.map(file=>file.label),['a.json','b.json','old.json']);
  for(let index=0;index<35;index++) {const file=await f.file('claude','new-'+String(index).padStart(2,'0')+'.jsonl');await fs.utimes(file,1000+index,1000+index);}
  const result=await findSessionFiles({home:f.home,agent:'claude'});
  assert.equal(result.files.length,30);assert.equal(result.coverage.filesFound,38);assert.equal(result.files[0].label,'new-34.jsonl');assert.equal(result.files.at(-1).label,'new-05.jsonl');assert.equal(result.coverage.partial,true);assert.match(result.coverage.issues.join(' '),/newest files found/);metadataOnly(result);
});

test('entry and depth limits are explicit and bounded',async t=>{
  const f=await fixture(t);
  await f.file('codex','one/two/three/four/within.jsonl');await f.file('codex','one/two/three/four/five/beyond.jsonl');
  const depth=await findSessionFiles({home:f.home,agent:'codex'});
  assert.deepEqual(depth.files.map(file=>file.label),['one/two/three/four/within.jsonl']);assert.equal(depth.coverage.partial,true);assert.match(depth.coverage.issues.join(' '),/depth limit/);
  await fs.mkdir(f.root('claude'),{recursive:true});
  for(let index=0;index<1501;index++)await fs.writeFile(path.join(f.root('claude'),'entry-'+index+'.txt'),'');
  const bounded=await findSessionFiles({home:f.home,agent:'claude'});
  assert.equal(bounded.coverage.visited,1500);assert.deepEqual(bounded.files,[]);assert.equal(bounded.coverage.partial,true);assert.match(bounded.coverage.issues.join(' '),/entry limit.*newest files found/);
});

test('missing roots and unsupported agents return generic outcomes without guessed files',async t=>{
  const f=await fixture(t);
  for(const agent of ['claude','codex']) {
    const result=await findSessionFiles({home:f.home,agent});assert.equal(result.rootStatus,'missing');assert.deepEqual(result.files,[]);assert.equal(result.coverage.visited,0);assert.equal(result.coverage.partial,true);assert.equal(JSON.stringify(result.coverage).includes(f.home),false);
  }
  for(const agent of ['',null,'synthetic-private-agent'])await assert.rejects(findSessionFiles({home:f.home,agent}),error=>error.message==='Choose a supported session agent.');
  const invalid=await findSessionFiles({home:'relative-home',agent:'claude'});assert.equal(invalid.rootStatus,'excluded');assert.deepEqual(invalid.files,[]);
});

test('symlinked ancestors, roots, directories and files are never followed',async t=>{
  const f=await fixture(t),target=await f.file('claude','safe.jsonl');
  const alias=path.join(f.dir,'home-alias');await fs.symlink(f.home,alias);
  const ancestor=await findSessionFiles({home:alias,agent:'claude'});assert.equal(ancestor.rootStatus,'excluded');assert.deepEqual(ancestor.files,[]);
  const external=path.join(f.dir,'external');await fs.mkdir(external);await fs.writeFile(path.join(external,'external.json'),'Synthetic session body');
  await fs.symlink(external,path.join(f.root('claude'),'linked-directory'));await fs.symlink(target,path.join(f.root('claude'),'linked.jsonl'));
  const nested=await findSessionFiles({home:f.home,agent:'claude'});assert.deepEqual(nested.files.map(file=>file.path),[target]);assert.equal(nested.coverage.partial,true);assert.equal(JSON.stringify(nested).includes('external.json'),false);
  await fs.mkdir(path.join(f.home,'.codex'));await fs.symlink(external,f.root('codex'));
  const root=await findSessionFiles({home:f.home,agent:'codex'});assert.equal(root.rootStatus,'excluded');assert.deepEqual(root.files,[]);
});

test('hardlinks and unsafe names are excluded with generic coverage only',async t=>{
  const f=await fixture(t),hard=await f.file('claude','hard.jsonl');await fs.link(hard,path.join(f.root('claude'),'hard-copy.jsonl'));
  const sensitive='sk-'+'x'.repeat(24);
  for(const label of ['secrets/one.jsonl','credentials.json','authentication.json','[REDACTED].jsonl',sensitive+'.jsonl','control\u0007.jsonl'])await f.file('claude',label);
  const safe=await f.file('claude','safe.jsonl'),result=await findSessionFiles({home:f.home,agent:'claude'});
  assert.deepEqual(result.files.map(file=>file.path),[safe]);assert.equal(result.coverage.filesFound,1);assert.equal(result.coverage.partial,true);
  for(const value of ['secrets','credentials.json','authentication.json',sensitive,'control\u0007','hard.jsonl'])assert.equal(JSON.stringify(result).includes(value),false);
  const secretHome=path.join(f.dir,'secrets');await fs.mkdir(secretHome);
  const excluded=await findSessionFiles({home:secretHome,agent:'claude'});assert.equal(excluded.rootStatus,'excluded');assert.equal(JSON.stringify(excluded).includes(secretHome),false);metadataOnly(result);
});

test('unreadable default and descendant directories produce generic bounded coverage',async t=>{
  const f=await fixture(t);await f.file('claude','nested/one.jsonl');
  const original=fs.opendir;
  try {
    fs.opendir=async(directory,...args)=>{if(directory===f.root('claude'))throw Object.assign(new Error('synthetic-private-error'),{code:'EACCES'});return original(directory,...args);};
    const root=await findSessionFiles({home:f.home,agent:'claude'});assert.equal(root.rootStatus,'excluded');assert.deepEqual(root.files,[]);assert.equal(root.coverage.partial,true);assert.equal(JSON.stringify(root).includes('synthetic-private-error'),false);
    fs.opendir=async(directory,...args)=>{if(directory.endsWith(path.sep+'nested'))throw Object.assign(new Error('synthetic-private-error'),{code:'EACCES'});return original(directory,...args);};
    const child=await findSessionFiles({home:f.home,agent:'claude'});assert.equal(child.rootStatus,'available');assert.deepEqual(child.files,[]);assert.equal(child.coverage.partial,true);assert.equal(JSON.stringify(child).includes('synthetic-private-error'),false);
  }finally {fs.opendir=original;}
});

test('unreadable session files are omitted without opening their bodies',async t=>{
  const f=await fixture(t),file=await f.file('claude','unreadable.jsonl'),original=fs.access;
  try {
    fs.access=async(target,...args)=>{if(target===file)throw Object.assign(new Error('synthetic-private-error'),{code:'EACCES'});return original(target,...args);};
    const result=await findSessionFiles({home:f.home,agent:'claude'});assert.equal(result.rootStatus,'available');assert.deepEqual(result.files,[]);assert.equal(result.coverage.partial,true);assert.equal(JSON.stringify(result).includes('synthetic-private-error'),false);
  }finally {fs.access=original;}
});
