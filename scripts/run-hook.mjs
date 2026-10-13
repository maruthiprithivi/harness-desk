import fs from 'node:fs';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
const [name,...args]=process.argv.slice(2);
if(!/^[a-z][a-z-]+$/.test(name||''))throw new Error('Invalid hook name.');
const root=execFileSync('git',['rev-parse','--show-toplevel'],{encoding:'utf8'}).trim();process.chdir(root);
const stateFile=path.resolve(root,execFileSync('git',['rev-parse','--git-path','harness-hooks/state.json'],{encoding:'utf8'}).trim());
const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));
let input;
if(['pre-push','post-rewrite','reference-transaction','pre-receive','post-receive','proc-receive'].includes(name)) {
  const chunks=[];let size=0;for await(const chunk of process.stdin){size+=chunk.length;if(size>1024*1024)throw new Error('Hook input exceeded its limit.');chunks.push(chunk);}input=Buffer.concat(chunks);
}
function execute(command,arguments_,stdin=input){const r=spawnSync(command,arguments_,{cwd:root,stdio:[stdin===undefined?'inherit':'pipe','inherit','inherit'],input:stdin,shell:false});if(r.status!==0)throw Object.assign(new Error('A Git hook or local check failed.'),{status:r.status||1});}
try {
const previousHook=path.join(state.previousPath,name);
if(fs.existsSync(previousHook)){
  const stat=fs.statSync(previousHook);
  if(stat.isFile()&&(process.platform==='win32'||stat.mode&0o111)){
    // Git for Windows supplies sh; exec preserves shebangs and keeps arguments out of shell source.
    const target=process.platform==='win32'?previousHook.replaceAll('\\','/'):previousHook;
    execute('sh',['-c','exec "$@"','harness-hook',target,...args]);
  }
}
if(name==='pre-commit') {
  execute(process.execPath,['scripts/check-public.mjs','--source']);
  execute(process.execPath,['scripts/check-public.mjs','--staged']);
}
if(name==='pre-push') {
  execute(process.execPath,['scripts/check-public.mjs','--push']);
  execute(process.execPath,['scripts/check-local.mjs']);
}

}catch(error){console.error(error.message);process.exitCode=error.status||1;}
