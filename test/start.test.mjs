import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {health,start,instanceKey,lockData} from '../start.mjs';
import {Store} from '../lib/store.mjs';

const base=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'harness-start-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
async function listener(t,body,status=200){const server=http.createServer((req,res)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));return server.address().port;}
async function command(script,env){const child=spawn(process.execPath,[path.join(base,script)],{env,stdio:['ignore','pipe','pipe']});let output='',error='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>error+=chunk);const [code]=await once(child,'close');return {code,output,error};}

test('launcher reuses a ready instance without creating another data directory',async t=>{
 const dir=await fixture(t),dataDir=path.join(dir,'unused');const port=await listener(t,{app:'harness-observatory',status:'ready',pid:123,instanceKey:await instanceKey(dataDir)});
 const result=await start({port,dataDir});assert.equal(result.pid,123);await assert.rejects(()=>fs.stat(dataDir),{code:'ENOENT'});
});

test('launcher rejects a foreign service without writing data or spawning',async t=>{
 const dir=await fixture(t),dataDir=path.join(dir,'unused');const port=await listener(t,{app:'another-app',status:'ready',pid:123});
 await assert.rejects(()=>start({port,dataDir}),/another service/);await assert.rejects(()=>fs.stat(dataDir),{code:'ENOENT'});
});

test('health distinguishes a starting instance from readiness',async t=>{
 const port=await listener(t,{app:'harness-observatory',status:'starting',pid:123},503);assert.equal((await health('http://127.0.0.1:'+port)).status,'starting');
});

test('launcher rejects another data directory on the same port',async t=>{
 const dir=await fixture(t),dataDir=path.join(dir,'unused');const port=await listener(t,{app:'harness-observatory',status:'ready',pid:123,instanceKey:'different'});await assert.rejects(()=>start({port,dataDir}),/another checkout or data directory/);
});

test('concurrent stale-lock recovery admits only one owner',async t=>{
 const dir=await fixture(t),store=await new Store(path.join(dir,'data')).init();const dead=spawn(process.execPath,['-e',''],{stdio:'ignore'});await once(dead,'close');
 await store.write('runtime/instance.json',{pid:dead.pid,port:1,instanceKey:'stale'});
 const results=await Promise.allSettled([lockData(store.root,1234,'one'),lockData(store.root,1235,'two')]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await store.read('runtime/instance.json')).pid,process.pid);
 results.find(r=>r.status==='fulfilled').value();
});

test('server survives launcher exit; repeated start reuses it; occupied port cannot rewrite chats',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'harness-start-')),home=path.join(dir,'home'),dataDir=path.join(dir,'data');await fs.mkdir(home);
 const reservation=http.createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 const env={...process.env,HOME:home,USERPROFILE:home,PATH:home,PORT:String(port),HARNESS_DATA_DIR:dataDir};let pid;
 t.after(async()=>{if(pid){try{process.kill(pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}for(let i=0;i<40;i++){try{if(!await health('http://127.0.0.1:'+port))return;}catch{}await new Promise(resolve=>setTimeout(resolve,50));}throw new Error('fixture server did not stop');}});
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const first=await command('start.mjs',env);assert.equal(first.code,0,first.error);
 const ready=await health('http://127.0.0.1:'+port);pid=ready.pid;assert.equal(ready.status,'ready');assert.notEqual(pid,process.pid);assert.match(first.output,new RegExp('Background PID: '+pid));
 const again=await command('start.mjs',env);assert.equal(again.code,0,again.error);assert.equal((await health('http://127.0.0.1:'+port)).pid,pid);
 const untouched=await new Store(path.join(dir,'other-data')).init();const id='11111111-1111-4111-8111-111111111111';await untouched.saveConversation({id,status:'running',messages:[],pinned:false,updatedAt:new Date().toISOString()});
 const duplicate=await command('server.mjs',{...env,HARNESS_DATA_DIR:untouched.root});assert.equal(duplicate.code,1);assert.match(duplicate.error,/EADDRINUSE/);assert.equal((await untouched.read('conversations/'+id+'.json')).status,'running');
 const other=http.createServer();other.listen(0,'127.0.0.1');await once(other,'listening');const otherPort=other.address().port;await new Promise(resolve=>other.close(resolve));
 const competing=await command('server.mjs',{...env,PORT:String(otherPort)});assert.equal(competing.code,1);assert.match(competing.error,/already in use/);
 assert.equal((await fetch('http://127.0.0.1:'+port+'/')).status,200);
});
