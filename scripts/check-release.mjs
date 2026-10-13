import fs from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {packagePatterns} from './check-package.mjs';
export function releaseFindings(pkg,license,git={}) {
  const findings=[];
  if(!license?.trim())findings.push('Add an approved project LICENSE.');
  if(typeof pkg.license!=='string'||!pkg.license.trim()||pkg.license==='UNLICENSED')findings.push('Declare the approved package license.');
  if(pkg.private!==false)findings.push('Package publication is disabled; keep it disabled until release review is complete.');
  if(pkg.name!=='harness-desk'&&!/^@[^/]+\/harness-desk$/.test(pkg.name||''))findings.push('Choose the public Harness Desk package name and verify registry availability.');
  if(pkg.bin?.['harness-desk']!=='harness-desk.mjs')findings.push('Provide and test the installable Harness Desk CLI entry point.');
  if(!Array.isArray(pkg.files)||!pkg.files.length)findings.push('Define an explicit package files allowlist and inspect the built archive.');
  else if(pkg.files.length!==packagePatterns.length||new Set(pkg.files).size!==packagePatterns.length||packagePatterns.some(file=>!pkg.files.includes(file)))findings.push('Package files must match the reviewed runtime-only allowlist.');
  if(pkg.scripts?.preinstall||pkg.scripts?.install||pkg.scripts?.postinstall||pkg.dependencies&&Object.keys(pkg.dependencies).length)findings.push('The runtime must remain dependency-free without installation hooks.');
  if(!git.committed)findings.push('Prepare a reviewed source commit before release.');
  if(!git.clean)findings.push('The release checkout must have no staged, unstaged or untracked public changes.');
  return findings;
}
if(process.argv[1]?.endsWith('check-release.mjs')) {
  const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
  const committed=spawnSync('git',['rev-parse','--verify','HEAD'],{stdio:'ignore'}).status===0;
  const clean=!execFileSync('git',['status','--porcelain','--untracked-files=all'],{encoding:'utf8'}).trim();
  const findings=releaseFindings(pkg,fs.existsSync('LICENSE')?fs.readFileSync('LICENSE','utf8'):'',{committed,clean});
  for(const file of ['SECURITY.md','CHANGELOG.md','.github/workflows/ci.yml','harness-desk.mjs'])if(!fs.existsSync(file))findings.push('Required release source is missing: '+file);
  if(findings.length){for(const finding of findings)console.error('Release blocked: '+finding);process.exitCode=1;}
  else {
    for(const script of [['scripts/check-local.mjs'],['scripts/check-public.mjs','--staged'],['scripts/check-public.mjs','--history']]) {
      const result=spawnSync(process.execPath,script,{stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);
    }
    console.log('Automated release prerequisites passed. Review the actual package contents and platform acceptance evidence before publishing.');
  }
}
