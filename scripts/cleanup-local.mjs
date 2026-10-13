import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {sameLocalPath} from '../lib/path-identity.mjs';
const candidates=['.verification','data/qa'];
function directory(root,relative,optional=false) {
  let cursor=root;
  for(const part of relative.split('/')) {
    cursor=path.join(cursor,part);
    let stat;try{stat=fs.lstatSync(cursor);}catch(e){if(e.code==='ENOENT'&&optional)return false;throw e;}
    if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('Cleanup requires real directories: '+relative);
  }
  return true;
}
export function cleanupLocal(root,{apply=false}={}) {
  root=path.resolve(root);
  const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'});
  if(!sameLocalPath(path.resolve(git(['rev-parse','--show-toplevel']).trim()),root))throw new Error('Run cleanup from the repository root.');
  const found=[];
  for(const candidate of candidates) {
    if(!directory(root,candidate,true))continue;
    if(git(['ls-files','--',candidate]).trim())throw new Error('Cleanup refuses tracked content: '+candidate);
    if(spawnSync('git',['check-ignore','--no-index','-q',candidate+'/probe'],{cwd:root}).status!==0)throw new Error('Cleanup requires ignored artifacts: '+candidate);
    found.push(candidate);
  }
  if(!apply||!found.length)return {dryRun:!apply,candidates:found,archive:null};
  if(spawnSync('git',['check-ignore','--no-index','-q','.local-archive/probe'],{cwd:root}).status!==0)throw new Error('Recovery archive must be Git-ignored.');
  if(!directory(root,'.local-archive',true))fs.mkdirSync(path.join(root,'.local-archive'),{mode:0o700});
  const archive='.local-archive/'+new Date().toISOString().replaceAll(':','-')+'-'+randomUUID();
  fs.mkdirSync(path.join(root,archive),{mode:0o700});
  const manifest={createdAt:new Date().toISOString(),entries:found.map(source=>({source,destination:source.replaceAll('/','-'),status:'planned'}))};
  const save=()=>fs.writeFileSync(path.join(root,archive,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});save();
  for(const entry of manifest.entries) {
    directory(root,entry.source);
    fs.renameSync(path.join(root,entry.source),path.join(root,archive,entry.destination));
    entry.status='archived';save();
  }
  return {dryRun:false,candidates:found,archive};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);if(args.some(arg=>arg!=='--apply'))throw new Error('Use --apply to archive, or no arguments for a preview.');
  const result=cleanupLocal(process.cwd(),{apply:args.includes('--apply')});
  console.log(JSON.stringify(result,null,2));
  console.log('Only disposable verification workspaces and QA artifacts are eligible. No deletion or disk-space reclamation. App data, source, journals and agent homes are excluded.');
}
