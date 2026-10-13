import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseArguments,manageInstance} from '../harness-desk.mjs';

test('CLI data defaults outside its installation and flags override environment',()=>{
  const home=path.resolve('fixture-home');
  assert.deepEqual(parseArguments([],{},home),{command:'start',port:4319,dataDir:path.join(home,'.harness-desk')});
  const options=parseArguments(['status','--port','4320','--data-dir','fixture data'],{PORT:'1111',HARNESS_DATA_DIR:'other'},home);
  assert.equal(options.command,'status');assert.equal(options.port,4320);assert.equal(options.dataDir,path.resolve('fixture data'));
  for(const args of [['unknown'],['start','--port','0'],['--port','1.5'],['--port','-1'],['--port','65536'],['--data-dir'],['--port','1','--port','2'],['--unknown'],['--help','--port','1']])assert.throws(()=>parseArguments(args,{},home));
  assert.equal(parseArguments(['--help'],{},home).command,'help');assert.equal(parseArguments(['--version'],{},home).command,'version');
});

test('CLI status creates no state and stop refuses mismatched service or local ownership',async()=>{
  const options={command:'stop',port:4319,dataDir:'fixture-data'},current={pid:4321,status:'ready',instanceKey:'fixture'};let signals=0;
  assert.equal((await manageInstance(options,{health:async()=>null})).status,'stopped');
  await assert.rejects(()=>manageInstance(options,{health:async()=>current,instanceKey:async()=> 'other',kill:()=>signals++}),/another installation/);
  await assert.rejects(()=>manageInstance(options,{health:async()=>current,instanceKey:async()=> 'fixture',readFile:async()=>JSON.stringify({...current,port:4320}),kill:()=>signals++}),/do not agree/);
  assert.equal(signals,0);
  assert.equal((await manageInstance({...options,command:'status'},{health:async()=>current,instanceKey:async()=> 'fixture'})).pid,4321);
});

test('CLI stop sends one signal and confirms disappearance; changed owners and timeout remain failures',async()=>{
  const options={command:'stop',port:4319,dataDir:'fixture-data'},current={pid:4321,status:'ready',instanceKey:'fixture'};let signals=0,checks=0,time=0;
  const deps={health:async()=>checks++?null:current,instanceKey:async()=> 'fixture',readFile:async()=>JSON.stringify({...current,port:4319}),kill:()=>signals++,now:()=>time,sleep:async()=>{time+=10000;}};
  assert.equal((await manageInstance(options,deps)).status,'stopped');assert.equal(signals,1);
  checks=0;await assert.rejects(()=>manageInstance(options,{...deps,health:async()=>checks++?{...current,pid:5432}:current}),/changed owners/);
  await assert.rejects(()=>manageInstance(options,{...deps,health:async()=>current}),/not confirmed/);
});

test('CLI help and version work from another folder without creating user data',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cli-help-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const cli=fileURLToPath(new URL('../harness-desk.mjs',import.meta.url)),env={...process.env,HOME:dir,USERPROFILE:dir};
  assert.match(execFileSync(process.execPath,[cli,'--help'],{cwd:dir,env,encoding:'utf8'}),/start\|status\|stop/);
  const pkg=JSON.parse(await fs.readFile(new URL('../package.json',import.meta.url),'utf8'));
  assert.equal(execFileSync(process.execPath,[cli,'--version'],{cwd:dir,env,encoding:'utf8'}).trim(),pkg.version);
  assert.deepEqual(await fs.readdir(dir),[]);
});
