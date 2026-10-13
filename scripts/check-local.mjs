import fs from 'node:fs';
import {spawnSync,execFileSync} from 'node:child_process';
const execute=args=>{const r=spawnSync(process.execPath,args,{stdio:'inherit',shell:false});if(r.status!==0)process.exit(r.status||1);};
for(const directory of ['data','sources','.verification','.break-free','.local-archive']) {
  const r=spawnSync('git',['check-ignore','--no-index','-q',directory+'/harness-private-probe'],{stdio:'ignore',shell:false});
  if(r.status!==0)throw new Error('Required private-directory exclusion is missing: '+directory);
}
execute(['scripts/check-public.mjs','--source']);
const source=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
for(const file of new Set(source.filter(file=>/\.(?:mjs|js)$/.test(file)&&fs.existsSync(file))))execute(['--check',file]);
execute(['scripts/test.mjs']);
console.log('Local gate passed: private exclusions, public source, JavaScript syntax and all discovered tests.');
