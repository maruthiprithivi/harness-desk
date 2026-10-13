import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../lib/store.mjs';

async function fixture(t) {
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'store-write-fixture-')));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const store=await new Store(root).init();
  await store.write('ledger.json',{decision:'prior'},{kind:'decision',pinned:true});
  const ledger=await fs.readFile(path.join(root,'ledger.json'),'utf8'),manifest=await fs.readFile(path.join(root,'manifest.json'),'utf8');
  const unchanged=async()=>{
    assert.equal(await fs.readFile(path.join(root,'ledger.json'),'utf8'),ledger);
    assert.equal(await fs.readFile(path.join(root,'manifest.json'),'utf8'),manifest);
    assert.deepEqual(store.manifest,JSON.parse(manifest));
    assert.deepEqual((await new Store(root).init()).manifest,JSON.parse(manifest));
    assert.equal((await fs.readdir(root)).some(file=>file.endsWith('.tmp')),false);
  };
  return {store,root,unchanged};
}

test('manifest write failure preserves the old artifact across restart and permits retry',async t=>{
  const {store,root,unchanged}=await fixture(t),write=store.write;
  let reject=true;
  store.write=async function(relative,...args){if(relative==='manifest.json'&&reject){reject=false;throw new Error('Synthetic manifest fault');}return write.call(this,relative,...args);};
  await assert.rejects(store.write('ledger.json',{decision:'new'},{kind:'decision',pinned:true}),/Synthetic manifest fault/);
  await unchanged();
  await store.write('ledger.json',{decision:'new'},{kind:'decision',pinned:true});
  assert.deepEqual(await (await new Store(root).init()).read('ledger.json'),{decision:'new'});
});

test('artifact replacement failure restores the prior manifest without replacing the artifact',async t=>{
  const {store,unchanged}=await fixture(t),rename=fs.rename;
  fs.rename=async(source,target)=>{if(target===path.join(store.root,'ledger.json'))throw new Error('Synthetic replacement fault');return rename(source,target);};
  try{await assert.rejects(store.write('ledger.json',{decision:'new'},{kind:'decision',pinned:true}),/Synthetic replacement fault/);}finally{fs.rename=rename;}
  await unchanged();
});

test('a failed first save creates neither an artifact nor a manifest entry',async t=>{
  const {store,unchanged}=await fixture(t),write=store.write;
  store.write=async function(relative,...args){if(relative==='manifest.json')throw new Error('Synthetic first-save fault');return write.call(this,relative,...args);};
  await assert.rejects(store.write('new.json',{decision:'new'},{pinned:true}),/Synthetic first-save fault/);
  assert.equal(await store.read('new.json'),null);
  await unchanged();
});

test('tracked writes serialize across a paused manifest commit and retain every artifact',async t=>{
  const {store,root}=await fixture(t),write=store.write;
  let release,paused;
  const gate=new Promise(resolve=>{release=resolve;}),arrived=new Promise(resolve=>{paused=resolve;});
  let block=true;
  store.write=async function(relative,...args){if(relative==='manifest.json'&&block){block=false;paused();await gate;}return write.call(this,relative,...args);};
  const first=store.write('first.json',{result:'one'},{pinned:true});
  await arrived;
  const second=store.write('second.json',{result:'two'},{pinned:true});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(await store.read('second.json'),null);
  release();await Promise.all([first,second]);
  const reopened=await new Store(root).init();
  assert.deepEqual(await reopened.read('first.json'),{result:'one'});
  assert.deepEqual(await reopened.read('second.json'),{result:'two'});
  assert.equal(reopened.manifest['first.json'].pinned,true);
  assert.equal(reopened.manifest['second.json'].pinned,true);
});

test('failed manifest recovery keeps prior artifact bytes and reports the unresolved reservation',async t=>{
  const {store,root}=await fixture(t),rename=fs.rename;
  let manifests=0;
  fs.rename=async(source,target)=>{
    if(target===path.join(root,'ledger.json'))throw new Error('Synthetic artifact fault');
    if(target===path.join(root,'manifest.json')&&++manifests===2)throw new Error('Synthetic recovery fault');
    return rename(source,target);
  };
  try{await assert.rejects(store.write('ledger.json',{decision:'new'},{kind:'decision',pinned:true}),/manifest reservation could not be restored/);}finally{fs.rename=rename;}
  const reopened=await new Store(root).init();
  assert.deepEqual(await reopened.read('ledger.json'),{decision:'prior'});
  assert.deepEqual(store.manifest,reopened.manifest);
  assert.equal((await fs.readdir(root)).some(file=>file.endsWith('.tmp')),false);
});
