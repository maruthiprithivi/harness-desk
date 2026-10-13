import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {checkPackage} from './check-package.mjs';

const npm=process.env.npm_execpath;
if(!npm||!path.isAbsolute(npm))throw new Error('Run through npm run smoke:package.');
const args=process.argv.slice(2);
if(args.length&&!(args.length===2&&args[0]==='--archive-dir'&&args[1].trim()))throw new Error('Usage: npm run smoke:package -- [--archive-dir PATH]');
const archiveDirectory=args.length?path.resolve(args[1]):null;
const fixture=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'Harness Desk λ ')));
const output=path.join(fixture,'archive'),prefix=path.join(fixture,'install'),home=path.join(fixture,'home');
await Promise.all([output,prefix,home].map(dir=>fs.mkdir(dir)));
let pid,port;
const run=(file,args,env=process.env)=>{
  const result=spawnSync(file,args,{env,cwd:fixture,encoding:'utf8',shell:false,timeout:240000,maxBuffer:4*1024*1024});
  if(result.error||result.status!==0)throw new Error('Package smoke command failed: '+path.basename(file)+' '+args[0]+'. '+(result.stderr||result.error?.message||'').slice(0,400));
  return result.stdout;
};
try{
  const packed=spawnSync(process.execPath,[npm,'pack','--json','--pack-destination',output],{cwd:process.cwd(),env:process.env,encoding:'utf8',shell:false,timeout:600000,maxBuffer:8*1024*1024});
  if(packed.error||packed.status!==0)throw new Error('Package creation failed its prepack gate. '+(packed.stderr||packed.error?.message||'').slice(0,400));
  const text=packed.stdout.trim(),manifest=JSON.parse(text.slice(text.lastIndexOf('\n[')+1));
  if(manifest.length!==1||!/^harness-desk-[a-z0-9.-]+\.tgz$/.test(manifest[0].filename))throw new Error('Unexpected npm archive identity.');
  const archive=path.join(output,manifest[0].filename),review=checkPackage(archive);
  run(process.execPath,[npm,'install','--global','--prefix',prefix,'--offline','--no-audit','--no-fund',archive]);
  const root=process.platform==='win32'?path.join(prefix,'node_modules','harness-desk'):path.join(prefix,'lib','node_modules','harness-desk');
  const cli=path.join(root,'harness-desk.mjs'),shim=process.platform==='win32'?path.join(prefix,'harness-desk.cmd'):path.join(prefix,'bin','harness-desk');
  await fs.access(shim);
  const env={...process.env,HOME:home,USERPROFILE:home,XDG_CONFIG_HOME:path.join(home,'.config'),HARNESS_DATA_DIR:'',PORT:'',PATH:home};
  const help=run(process.execPath,[cli,'--help'],env),version=run(process.execPath,[cli,'--version'],env).trim();
  if(!help.includes('start|status|stop')||version!==JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version)throw new Error('Installed CLI identity failed.');
  if(process.platform==='win32'){
    const shell=path.join(process.env.SystemRoot||process.env.WINDIR||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    const output=run(shell,['-NoLogo','-NoProfile','-NonInteractive','-Command','& $env:HARNESS_SMOKE_CLI --help; exit $LASTEXITCODE'],{...process.env,HARNESS_SMOKE_CLI:shim});
    if(!output.includes('start|status|stop'))throw new Error('Windows npm shim failed.');
  }else if(!run(shim,['--help'],{...env,PATH:process.env.PATH}).includes('start|status|stop'))throw new Error('Installed npm shim failed.');
  const reserve=http.createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
  const before=await fs.readdir(root),started=run(process.execPath,[cli,'start','--port',String(port)],env);
  const match=started.match(/Background PID: (\d+)/);if(!match)throw new Error('Installed launcher did not report its process.');pid=Number(match[1]);
  const address='http://127.0.0.1:'+port;
  const health=await fetch(address+'/api/health').then(response=>response.json());if(health.pid!==pid||health.status!=='ready')throw new Error('Installed server is not ready.');
  const again=run(process.execPath,[cli,'start','--port',String(port)],env);if(!again.includes('Background PID: '+pid))throw new Error('Repeated launch created another instance.');
  if(!run(process.execPath,[cli,'status','--port',String(port)],env).includes('PID: '+pid))throw new Error('Installed status failed.');
  if((await fetch(address+'/')).status!==200)throw new Error('Installed UI is unavailable.');
  run(process.execPath,[cli,'stop','--port',String(port)],env);pid=null;
  if(!run(process.execPath,[cli,'status','--port',String(port)],env).includes('stopped'))throw new Error('Shutdown was not confirmed.');
  await fs.access(path.join(home,'.harness-desk','manifest.json'));
  if(JSON.stringify(await fs.readdir(root))!==JSON.stringify(before))throw new Error('Runtime wrote into its installation directory.');
  if(archiveDirectory){await fs.mkdir(archiveDirectory,{recursive:true,mode:0o700});const retained=path.join(archiveDirectory,manifest[0].filename);await fs.copyFile(archive,retained,constants.COPYFILE_EXCL);checkPackage(retained);}
  console.log('Package smoke passed: '+JSON.stringify({platform:process.platform,version,...review}));
}finally{
  if(pid){try{process.kill(pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}await new Promise(resolve=>setTimeout(resolve,500));}
  await fs.rm(fixture,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
