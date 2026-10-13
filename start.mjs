import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {Store} from './lib/store.mjs';
import {createHash} from 'node:crypto';
import {readFileSync,unlinkSync} from 'node:fs';

const base=path.dirname(fileURLToPath(import.meta.url));

async function canonical(value) {
  let current=path.resolve(value);const missing=[];
  for(;;)try{return path.join(await fs.realpath(current),...missing.reverse());}
  catch(error){if(error.code!=='ENOENT')throw error;missing.push(path.basename(current));const parent=path.dirname(current);if(parent===current)throw error;current=parent;}
}
export async function instanceKey(dataDir) {return createHash('sha256').update(JSON.stringify([await canonical(base),await canonical(dataDir)])).digest('hex');}

export async function lockData(dataDir,port,key) {
  const store=await new Store(dataDir).init();const file=await store.location('runtime/instance.json');
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const guard=await store.location('runtime/startup-lock');
  try{await fs.mkdir(guard,{mode:0o700});}catch(error){if(error.code==='EEXIST')throw new Error('Startup is already in progress, or an interrupted startup left '+guard+'. Retry; inspect this directory if it persists.');throw error;}
  try {
  for(let attempt=0;attempt<3;attempt++) {
    let handle;
    try {handle=await fs.open(file,'wx',0o600);}
    catch(error) {
      if(error.code!=='EEXIST')throw error;
      const owner=await store.read('runtime/instance.json');
      if(!Number.isSafeInteger(owner?.pid)||owner.pid<=0)throw new Error('The runtime instance lock is incomplete. Retry startup.');
      try{process.kill(owner.pid,0);throw new Error('This data directory is already in use by PID '+owner.pid+' on port '+owner.port+'.');}
      catch(error){if(error.code!=='ESRCH')throw error;}
      await fs.unlink(file);continue;
    }
    try{await handle.writeFile(JSON.stringify({pid:process.pid,port,instanceKey:key}));}finally{await handle.close();}
    return ()=>{try{if(JSON.parse(readFileSync(file,'utf8')).pid===process.pid)unlinkSync(file);}catch{}};
  }
  throw new Error('Could not acquire the data directory instance lock. Retry startup.');
  }finally{await fs.rmdir(guard);}
}

export async function health(url,request=fetch) {
  let response;
  for(let attempt=0;attempt<2;attempt++){
    try {response=await request(url+'/api/health',{signal:AbortSignal.timeout(1500),redirect:'error',headers:{Connection:'close'}});break;}
    catch(error){if(error.cause?.code==='ECONNREFUSED')return null;if(attempt===0&&['ECONNRESET','EPIPE','UND_ERR_SOCKET'].includes(error.cause?.code))continue;throw new Error('Could not check the local service: '+error.message);}
  }
  let result;try{result=await response.json();}catch{throw new Error('The port is occupied by an unrecognized service.');}
  if(result?.app!=='harness-observatory'||!['starting','ready'].includes(result.status)||!Number.isSafeInteger(result.pid)||result.pid<=0)throw new Error('The port is occupied by another service.');
  return result;
}

export async function start({port=Number(process.env.PORT||4319),dataDir=process.env.HARNESS_DATA_DIR||path.join(base,'data')}={}) {
  if(Number(process.versions.node.split('.')[0])<22)throw new Error('Node.js 22 or newer is required.');
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid port');
  const url='http://127.0.0.1:'+port;
  const expected=await instanceKey(dataDir);
  let current=await health(url),child;
  function matching(){if(current&&current.instanceKey!==expected)throw new Error('This port serves another checkout or data directory. Stop that instance or choose another port.');}
  matching();
  const log=path.resolve(dataDir,'runtime','server.log');
  if(!current) {
    const store=await new Store(dataDir).init();await store.location('runtime/server.log');
    await fs.mkdir(path.dirname(log),{recursive:true,mode:0o700});
    const handle=await fs.open(log,fs.constants.O_APPEND|fs.constants.O_WRONLY|fs.constants.O_CREAT|(fs.constants.O_NOFOLLOW||0),0o600);
    try {
      child=spawn(process.execPath,[path.join(base,'server.mjs')],{cwd:base,env:{...process.env,PORT:String(port),HARNESS_DATA_DIR:path.resolve(dataDir)},detached:true,windowsHide:true,stdio:['ignore',handle.fd,handle.fd]});
      await once(child,'spawn');child.unref();
    }finally{await handle.close();}
  }
  const deadline=Date.now()+60000;
  while(current?.status!=='ready') {
    if(child&&(child.exitCode!==null||child.signalCode)){current=await health(url);matching();if(!current)throw new Error('Server exited during startup. Check '+log);child=null;}
    if(Date.now()>deadline)throw new Error('Startup timed out. Check '+log);
    await new Promise(resolve=>setTimeout(resolve,250));current=await health(url);matching();
  }
  return {url,pid:current.pid,log};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {const result=await start();console.log('Harness desk: '+result.url+'\nBackground PID: '+result.pid+'\nStartup log: '+result.log);}
  catch(error){console.error(error.message);process.exitCode=1;}
}
