#!/usr/bin/env node
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {start,health,instanceKey} from './start.mjs';

const help=`Harness Desk — understand and improve your coding-agent setup.

Usage: harness-desk [start|status|stop] [--port NUMBER] [--data-dir PATH]
       harness-desk --help
       harness-desk --version

The default command is start. Open the printed local URL in your browser.
Data stays in ~/.harness-desk unless --data-dir or HARNESS_DATA_DIR is set.
PORT selects the port when --port is absent. Default: 4319.
Stopping the app preserves your data and configuration backups.`;

export function parseArguments(args,environment=process.env,home=os.homedir()) {
  if(args.length===1&&['--help','-h','--version','-v'].includes(args[0]))return {command:args[0].includes('version')||args[0]==='-v'?'version':'help'};
  let command='start',port=environment.PORT||'4319',dataDir=environment.HARNESS_DATA_DIR||path.join(home,'.harness-desk');
  const seen=new Set();
  if(args[0]&&!args[0].startsWith('-')){command=args[0];args=args.slice(1);}
  if(!['start','status','stop'].includes(command))throw new Error('Choose start, status or stop. Use --help for usage.');
  for(let i=0;i<args.length;i++){
    const flag=args[i];
    if(!['--port','--data-dir'].includes(flag)||seen.has(flag))throw new Error('Unknown or repeated option. Use --help for usage.');
    seen.add(flag);const value=args[++i];
    if(!value||value.startsWith('--'))throw new Error('Each option needs a value.');
    if(flag==='--port')port=value;else dataDir=value;
  }
  if(!/^\d+$/.test(String(port))||Number(port)<1||Number(port)>65535)throw new Error('Port must be a whole number between 1 and 65535.');
  if(typeof dataDir!=='string'||!dataDir.trim())throw new Error('Choose a data directory.');
  return {command,port:Number(port),dataDir:path.resolve(dataDir)};
}

export async function manageInstance({command,port,dataDir},dependencies={}) {
  const inspect=dependencies.health||health,key=dependencies.instanceKey||instanceKey;
  const url='http://127.0.0.1:'+port,current=await inspect(url);
  if(!current)return {status:'stopped',url};
  if(current.instanceKey!==await key(dataDir))throw new Error('This port belongs to another installation or data directory. Choose its original CLI and data directory.');
  if(command==='status')return {status:current.status,url,pid:current.pid};
  const owner=JSON.parse(await (dependencies.readFile||fs.readFile)(path.join(dataDir,'runtime','instance.json'),'utf8'));
  if(owner.pid!==current.pid||owner.port!==port||owner.instanceKey!==current.instanceKey||owner.pid===process.pid)throw new Error('The service and local instance record do not agree. No process was stopped.');
  (dependencies.kill||process.kill)(current.pid,'SIGTERM');
  const now=dependencies.now||Date.now,sleep=dependencies.sleep||(ms=>new Promise(resolve=>setTimeout(resolve,ms)));
  const deadline=now()+10000;
  do {
    const next=await inspect(url);
    if(!next)return {status:'stopped',url};
    if(next.pid!==current.pid||next.instanceKey!==current.instanceKey)throw new Error('The port changed owners during shutdown. No further signal was sent.');
    await sleep(100);
  }while(now()<deadline);
  throw new Error('Shutdown was not confirmed. Check the local process before retrying.');
}

export async function main(args=process.argv.slice(2)) {
  const options=parseArguments(args);
  if(options.command==='help'){console.log(help);return;}
  if(options.command==='version'){console.log(JSON.parse(await fs.readFile(new URL('./package.json',import.meta.url),'utf8')).version);return;}
  if(options.command==='start'){
    const result=await start(options);
    console.log('Harness Desk: '+result.url+'\nBackground PID: '+result.pid+'\nData: '+options.dataDir+'\nStartup log: '+result.log+'\nStop with harness-desk stop using the same port and data directory.');
  }else{
    const result=await manageInstance(options);console.log('Harness Desk: '+result.status+'\n'+result.url+(result.pid?'\nPID: '+result.pid:''));
  }
}

if(process.argv[1]&&await fs.realpath(process.argv[1]).catch(()=>path.resolve(process.argv[1]))===fileURLToPath(import.meta.url)){
  try{await main();}catch(error){console.error(error.message);process.exitCode=1;}
}
