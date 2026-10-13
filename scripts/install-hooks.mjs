import fs from 'node:fs';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
export function installHooks(root,{uninstall=false}={}) {
  root=path.resolve(root);
  const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
  const config=(args)=>{const r=spawnSync('git',args,{cwd:root,encoding:'utf8'});if(r.status===1)return null;if(r.status!==0)throw new Error('Cannot read hook configuration.');return r.stdout.trim();};
  const target=path.resolve(root,git(['rev-parse','--git-path','harness-hooks']));
  const stateFile=path.join(target,'state.json'),previous=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile,'utf8')):null;
  const effective=config(['config','--path','--get','core.hooksPath']);
  const active=effective!==null&&path.resolve(root,effective)===target;
  if(uninstall) {
    if(!previous||!active)throw new Error('Managed hooks are not active; no configuration was changed.');
    if(previous.localValue===null)git(['config','--local','--unset','core.hooksPath']);else git(['config','--local','core.hooksPath',previous.localValue]);
    return {installed:false,preserved:true};
  }
  if(previous&&!active&&path.resolve(root,effective||git(['rev-parse','--git-path','hooks']))!==previous.previousPath)throw new Error('Hook configuration changed since installation. Review it before reinstalling.');
  if(!previous&&fs.existsSync(target))throw new Error('Hook destination already exists; refusing to replace it.');
  const state=previous||{localValue:config(['config','--local','--get','core.hooksPath']),previousPath:path.resolve(root,effective||git(['rev-parse','--git-path','hooks']))};
  if(state.previousPath===target)throw new Error('Refusing a recursive hook chain.');
  const names=new Set(['pre-commit','pre-push']);
  if(fs.existsSync(state.previousPath))for(const name of fs.readdirSync(state.previousPath))if(/^[a-z][a-z-]+$/.test(name)&&fs.statSync(path.join(state.previousPath,name)).isFile())names.add(name);
  fs.mkdirSync(target,{recursive:true,mode:0o700});
  fs.writeFileSync(stateFile,JSON.stringify(state,null,2)+'\n',{mode:0o600});
  for(const name of names){
    const file=path.join(target,name),body='#!/bin/sh\n# Harness Desk managed hook\nexec node "$(git rev-parse --show-toplevel)/scripts/run-hook.mjs" '+quote(name)+' "$@"\n';
    if(fs.existsSync(file)&&fs.readFileSync(file,'utf8')!==body)throw new Error('A managed hook has been replaced; refusing to overwrite it.');
    fs.writeFileSync(file,body,{mode:0o700});fs.chmodSync(file,0o700);
  }
  git(['config','--local','core.hooksPath',target]);
  return {installed:true,preserved:true,hooks:[...names]};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);if(args.some(arg=>arg!=='--uninstall'))throw new Error('Unsupported option.');
  console.log(JSON.stringify(installHooks(process.cwd(),{uninstall:args.includes('--uninstall')}),null,2));
}
