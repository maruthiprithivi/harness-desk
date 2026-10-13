import fs from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
export function releaseFindings(pkg,license,git={}) {
  const findings=[];
  if(!license?.trim())findings.push('Add an approved project LICENSE.');
  if(typeof pkg.license!=='string'||!pkg.license.trim()||pkg.license==='UNLICENSED')findings.push('Declare the approved package license.');
  if(pkg.private!==false)findings.push('Package publication is disabled; keep it disabled until release review is complete.');
  if(pkg.name!=='harness-desk'&&!/^@[^/]+\/harness-desk$/.test(pkg.name||''))findings.push('Choose the public Harness Desk package name and verify registry availability.');
  if(!pkg.bin||typeof pkg.bin!=='object'||!Object.keys(pkg.bin).length)findings.push('Provide and test an installable CLI entry point.');
  if(!Array.isArray(pkg.files)||!pkg.files.length)findings.push('Define an explicit package files allowlist and inspect the built archive.');
  if(!git.committed)findings.push('Prepare a reviewed source commit before release.');
  if(!git.clean)findings.push('The release checkout must have no staged, unstaged or untracked public changes.');
  return findings;
}
if(process.argv[1]?.endsWith('check-release.mjs')) {
  const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
  const committed=spawnSync('git',['rev-parse','--verify','HEAD'],{stdio:'ignore'}).status===0;
  const clean=!execFileSync('git',['status','--porcelain','--untracked-files=all'],{encoding:'utf8'}).trim();
  const findings=releaseFindings(pkg,fs.existsSync('LICENSE')?fs.readFileSync('LICENSE','utf8'):'',{committed,clean});
  if(findings.length){for(const finding of findings)console.error('Release blocked: '+finding);process.exitCode=1;}
  else {
    for(const script of [['scripts/check-local.mjs'],['scripts/check-public.mjs','--staged'],['scripts/check-public.mjs','--history']]) {
      const result=spawnSync(process.execPath,script,{stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);
    }
    console.log('Automated release prerequisites passed. Review the actual package contents and platform acceptance evidence before publishing.');
  }
}
