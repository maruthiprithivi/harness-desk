import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

// Exact reviewed synthetic captures. Replacements require a new visual privacy review.
const publicScreenshots={
  'docs/assets/user-guide/01-start.png':'9d523883def5ae1b8618c4db103bdc25ce92843164e2ffd6491d34d62db662c5',
  'docs/assets/user-guide/02-canvas.png':'8c84d6f606bd6751490fbcb90e07611113dd834ed852bb7efff32b9de920d8d3',
  'docs/assets/user-guide/03-editor.png':'1af5f0d50aacbf25394f1ca9d758ad970cd37be3d9704e73d61e0415ca58e681',
  'docs/assets/user-guide/04-compare.png':'88aee01eddedb90c1ffbd6ca4fcc3a01def64c688fd696203b44e30e804c1370'
};
// This finished synthetic video and poster were reviewed independently of private media.
const publicExplainer={
  'docs/assets/explainer/harness-desk.mp4':'0f5baa00c0f52e0bbae9a9c24db526aa40882f662aa12427e8335deed4fc4e91',
  'docs/assets/explainer/poster.png':'2c64ea1e0b050df9279390b23a30ab8f5bb3c384813848e6c7173441b3ace77b'
};
const publicMedia=new Set(['docs/user-guide.md','docs/assets/explainer/README.md','docs/assets/explainer/captions.vtt','media/explainer/README.md','media/explainer/package.json','media/explainer/package-lock.json','media/explainer/Dockerfile','media/explainer/render.mjs','media/explainer/prepare.mjs','media/explainer/finalize.mjs','media/explainer/src/index.tsx','media/explainer/src/chapters.mjs']);
const sizeLimit=file=>Object.hasOwn(publicExplainer,file)?32*1024*1024:1024*1024;

const rootFiles=new Set(['.gitignore','.gitattributes','.cbmignore','AGENTS.md','README.md','PRODUCT.md','CONTRACT.md','CONTRIBUTING.md','SECURITY.md','CHANGELOG.md','LICENSE','package.json','package-lock.json','harness-desk.mjs','server.mjs','start.mjs','start.cmd','start.command']);
const publicDocumentation=new Set(['docs/runtime.md','docs/configuration.md','docs/workflows.md','docs/privacy.md','docs/releasing.md']);
export function publicPath(file) {
  if(Object.hasOwn(publicScreenshots,file)||Object.hasOwn(publicExplainer,file)||publicMedia.has(file)||publicDocumentation.has(file)||file==='.github/workflows/ci.yml')return true;
  return rootFiles.has(file)||['public/vendor/editor.js','public/vendor/license/provenance.md','docs/context-measurement-capabilities.md','docs/designs/harness-desk-product-brief.md'].includes(file)||/^(?:lib\/[a-z0-9_][a-z0-9._-]*\.mjs|public\/[a-z0-9_][a-z0-9._-]*\.(?:html|css|js)|test\/[a-z0-9_][a-z0-9._-]*\.test\.mjs|scripts\/[a-z0-9_][a-z0-9._-]*\.mjs|\.githooks\/pre-(?:commit|push))$/i.test(file);
}
const rules=[
  ['private key',/-----BEGIN (?:[A-Z ]*PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----/g],
  ['provider credential',/\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{15,})\b/g],
  ['bearer credential',/\bBearer\s+[A-Za-z0-9._~+\/-]{16,}={0,2}/gi],
  ['URL credential',/https?:\/\/[^\s/:'"]+:[^\s/@'"]+@/g],
  ['personal home path',/(?:\/Users\/|\/home\/|[A-Za-z]:[\\/]Users[\\/])[A-Za-z0-9_.-]+(?:[\\/]|(?=[\s"'<>]|$))/g],
  ['email address',/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g],
  ['credential assignment',/["']?\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|credential|token)["']?\s*[:=]\s*["']([^"'\r\n]{4,})["']/gi]
];
const syntheticFixtures={
  'test/agents.test.mjs':new Set(['do-not-copy']),
  'test/core.test.mjs':new Set(['sk-abcdefghijklmno','hidden','hidden2']),
  'test/inventory.test.mjs':new Set(['DO_NOT_RETURN_THIS_CONFIGURATION'])
};
export function inspect(text,file='') {
  const findings=[];
  for(const [rule,pattern]of rules)for(const match of text.matchAll(pattern)) {
    const value=match[1]||match[0];
    if(syntheticFixtures[file]?.has(value)&&['credential assignment','URL credential'].includes(rule))continue;
    if(rule==='email address'&&/@(?:users\.noreply\.github\.com|example\.(?:com|org|net|test|invalid)|[^@]+\.(?:test|invalid))$/i.test(value))continue;
    // Public upstream copyright contacts are preserved only in these notices and this allowlist.
    if(rule==='email address'&&['public/vendor/editor.js','public/vendor/license/provenance.md','scripts/check-public.mjs'].includes(file)&&['marijn@haverbeke.berlin','rulfzid@gmail.com'].includes(value))continue;
    findings.push({rule,line:text.slice(0,match.index).split('\n').length});
  }
  return findings;
}
export function inspectEntry({file,mode='100644',content}) {
  if(!publicPath(file))return [{file:'[excluded path]',rule:'private or unsupported path'}];
  if(!['100644','100755'].includes(mode))return [{file,rule:'symlink, submodule or unsupported mode'}];
  if(Object.hasOwn(publicExplainer,file))return content.length<=sizeLimit(file)&&createHash('sha256').update(content).digest('hex')===publicExplainer[file]?[]:[{file,rule:'explainer differs from reviewed synthetic asset'}];
  if(Object.hasOwn(publicScreenshots,file))return createHash('sha256').update(content).digest('hex')===publicScreenshots[file]?[]:[{file,rule:'screenshot differs from reviewed synthetic capture'}];
  if(content.length>1024*1024||content.includes(0))return [{file,rule:'oversized or binary file'}];
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(content);}catch{return [{file,rule:'invalid UTF-8'}];}
  return inspect(text,file).map(finding=>({file,...finding}));
}
const git=args=>execFileSync('git',args,{encoding:'utf8',maxBuffer:20*1024*1024});
const nul=text=>text.split('\0').filter(Boolean);
export function pushTargets(input) {
  if(input.length>1024*1024)throw new Error('Push input is too large');
  const targets=new Set();
  for(const line of input.split('\n').filter(line=>line.trim())){
    const fields=line.trim().split(/\s+/);if(fields.length!==4||!fields.every(Boolean)||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(fields[1]))throw new Error('Invalid push input');
    if(!/^0+$/.test(fields[1]))targets.add(fields[1]);
  }
  return [...targets];
}
export async function check(mode,targets=[]) {
  const findings=[],seen=new Set();let files=0;
  function entry(file,permissions,object) {
    if(!publicPath(file)){findings.push(...inspectEntry({file,mode:permissions,content:Buffer.alloc(0)}));return;}
    if(!['100644','100755'].includes(permissions)){findings.push({file,rule:'unsupported Git mode'});return;}
    const identity=file+'\0'+object;if(seen.has(identity))return;seen.add(identity);files++;
    const size=Number(git(['cat-file','-s',object]).trim());
    if(!Number.isSafeInteger(size)||size>sizeLimit(file)){findings.push({file,rule:'oversized file'});return;}
    findings.push(...inspectEntry({file,mode:permissions,content:execFileSync('git',['cat-file','blob',object],{maxBuffer:sizeLimit(file)+1})}));
  }
  if(mode==='--source') {
    for(const file of nul(git(['ls-files','--cached','--others','--exclude-standard','-z']))) {
      if(!publicPath(file)){findings.push({file:'[excluded path]',rule:'private or unsupported path'});continue;}
      let cursor=process.cwd(),stat,linked=false;for(const part of file.split('/')){cursor=path.join(cursor,part);stat=await fs.lstat(cursor);if(stat.isSymbolicLink()){linked=true;break;}}
      if(linked||!stat.isFile()||stat.size>sizeLimit(file)){findings.push({file,rule:'unsupported source file'});continue;}
      files++;findings.push(...inspectEntry({file,content:await fs.readFile(file)}));
    }
  }else if(mode==='--staged') {
    for(const record of nul(git(['ls-files','--stage','-z']))) {
      const tab=record.indexOf('\t'),[permissions,object,stage]=record.slice(0,tab).split(' '),file=record.slice(tab+1);
      if(stage!=='0'){findings.push({file:'[unmerged path]',rule:'unmerged index'});continue;}entry(file,permissions,object);
    }
  }else if(mode==='--history'||mode==='--push') {
    const validTargets=[],tags=new Set();
    for(const target of targets){if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(target))throw new Error('Invalid outgoing object');const type=git(['cat-file','-t',target]).trim();if(!['commit','tag'].includes(type)){findings.push({file:'[outgoing object]',rule:'unsupported push target'});continue;}validTargets.push(target);if(type==='tag')tags.add(target);}
    for(const commit of git(['rev-list','--all',...validTargets]).trim().split('\n').filter(Boolean)) {
      const metadata=git(['cat-file','commit',commit]);
      findings.push(...inspect(metadata).map(finding=>({file:'commit '+commit.slice(0,12),...finding})));
      for(const record of nul(git(['ls-tree','-r','-z',commit]))) {const tab=record.indexOf('\t'),[permissions,,object]=record.slice(0,tab).split(' ');entry(record.slice(tab+1),permissions,object);}
    }
    for(const record of git(['for-each-ref','--format=%(objecttype) %(objectname)','refs/tags']).trim().split('\n').filter(Boolean)){const [type,object]=record.split(' ');if(type==='tag')tags.add(object);else if(type!=='commit')findings.push({file:'[tag]',rule:'unsupported tag target'});}
    for(let object of tags) {
      let type='tag',depth=0;
      while(type==='tag'&&depth++<20){const metadata=git(['cat-file','tag',object]);findings.push(...inspect(metadata).map(finding=>({file:'tag '+object.slice(0,12),...finding})));type=metadata.match(/^type (\w+)$/m)?.[1];object=metadata.match(/^object ([a-f0-9]+)$/m)?.[1];}
      if(type!=='commit')findings.push({file:'[tag]',rule:'unsupported tag target'});
    }
  }else throw new Error('Choose --source, --staged, --history or --push');
  return {files,findings};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {const mode=process.argv[2]||'--staged';let input='';if(mode==='--push')for await(const chunk of process.stdin){input+=chunk;if(input.length>1024*1024)throw new Error('Push input too large');}const result=await check(mode,mode==='--push'?pushTargets(input):[]);if(result.findings.length){for(const finding of result.findings)console.error(finding.file+(finding.line?':'+finding.line:'')+' '+finding.rule);process.exitCode=1;}else console.log('Public publishing check passed: '+result.files+' source objects inspected.');}
  catch{console.error('Publishing check could not complete. Publication is blocked.');process.exitCode=1;}
}
