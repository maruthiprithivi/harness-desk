import fs from 'node:fs';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {inspectEntry} from './check-public.mjs';

const runtimeRoots=new Set(['package.json','harness-desk.mjs','start.mjs','server.mjs','README.md','LICENSE','SECURITY.md','CHANGELOG.md']);
const runtimePublic=new Set(['public/app.js','public/first-use.js','public/first-use.css','public/index.html','public/style.css','public/favicon.svg','public/vendor/editor.js','public/vendor/license/provenance.md']);
export const packagePath=file=>runtimeRoots.has(file)||runtimePublic.has(file)||/^lib\/[a-z0-9_][a-z0-9._-]*\.mjs$/i.test(file);
export const packagePatterns=[...[...runtimeRoots].filter(file=>file!=='package.json'),'lib/*.mjs',...runtimePublic];
const digest=buffer=>createHash('sha256').update(buffer).digest('hex');

export function archiveEntries(compressed) {
  if(compressed.length>8*1024*1024)throw new Error('Package archive is oversized.');
  const data=gunzipSync(compressed,{maxOutputLength:16*1024*1024});
  const entries=[],seen=new Set();let offset=0,ended=false;
  const decode=buffer=>new TextDecoder('utf-8',{fatal:true}).decode(buffer).split('\0')[0];
  const octal=buffer=>{const value=decode(buffer).trim();if(!/^[0-7]+$/.test(value))throw new Error('Invalid tar numeric field.');const result=parseInt(value,8);if(!Number.isSafeInteger(result))throw new Error('Invalid tar size.');return result;};
  while(offset+512<=data.length){
    const header=data.subarray(offset,offset+512);
    if(header.every(byte=>byte===0)){
      if(offset+1024>data.length||data.subarray(offset).some(byte=>byte!==0))throw new Error('Invalid tar terminator.');
      ended=true;break;
    }
    const expected=octal(header.subarray(148,156));let sum=0;
    for(let i=0;i<512;i++)sum+=i>=148&&i<156?32:header[i];
    if(sum!==expected)throw new Error('Invalid tar checksum.');
    const prefix=decode(header.subarray(345,500)),name=(prefix?prefix+'/':'')+decode(header.subarray(0,100));
    const type=String.fromCharCode(header[156]||48),size=octal(header.subarray(124,136)),mode=octal(header.subarray(100,108));
    if(!['0','5'].includes(type))throw new Error('Package contains a link or unsupported tar entry.');
    if(!name.startsWith('package/')||name.includes('\\')||name.split('/').some(part=>part==='.'||part==='..')||seen.has(name))throw new Error('Package contains an unsafe or duplicate path.');
    seen.add(name);
    const bodyStart=offset+512,bodyEnd=bodyStart+size;
    if(bodyEnd>data.length||size>1024*1024)throw new Error('Package entry is oversized or incomplete.');
    if(type==='5'&&size!==0)throw new Error('Package directory has content.');
    entries.push({file:name.slice(8),type,mode,content:Buffer.from(data.subarray(bodyStart,bodyEnd))});
    offset=bodyStart+Math.ceil(size/512)*512;
  }
  if(!ended||!entries.length)throw new Error('Package archive is incomplete or empty.');
  return entries;
}

export function inspectPackage(entries,expected) {
  const findings=[],seen=new Set();
  for(const entry of entries){
    if(entry.type==='5'){
      if(!entry.file.endsWith('/')||![...expected.keys()].some(file=>file.startsWith(entry.file)))findings.push('Unexpected package directory.');
      continue;
    }
    seen.add(entry.file);
    if(!packagePath(entry.file)||!expected.has(entry.file)){findings.push('Unexpected package file.');continue;}
    if(![0o644,0o755].includes(entry.mode)){findings.push('Unexpected package permissions.');continue;}
    if(digest(entry.content)!==expected.get(entry.file)){findings.push('Package file differs from reviewed source.');continue;}
    if(inspectEntry({file:entry.file,mode:entry.mode===0o755?'100755':'100644',content:entry.content}).length)findings.push('Package file failed privacy inspection.');
  }
  for(const file of expected.keys())if(!seen.has(file))findings.push('Required runtime file is missing.');
  return findings;
}

export function checkPackage(archive,root=process.cwd()) {
  const tracked=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(file=>file&&packagePath(file));
  const expected=new Map();
  for(const file of tracked){
    const location=path.join(root,file),stat=fs.lstatSync(location);
    if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Reviewed runtime source is not a regular file.');
    const reviewed=execFileSync('git',['show','HEAD:'+file],{cwd:root,maxBuffer:1024*1024+1});
    if(digest(fs.readFileSync(location))!==digest(reviewed))throw new Error('Runtime source differs from the reviewed commit.');
    expected.set(file,digest(reviewed));
  }
  for(const file of [...runtimeRoots,...runtimePublic])if(!expected.has(file))throw new Error('Required runtime source is not tracked.');
  const entries=archiveEntries(fs.readFileSync(archive)),findings=inspectPackage(entries,expected);
  if(findings.length)throw new Error([...new Set(findings)].join(' '));
  return {files:expected.size,bytes:entries.reduce((n,entry)=>n+entry.content.length,0),sha256:digest(fs.readFileSync(archive))};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==3)throw new Error('Usage: npm run check:package -- PATH_TO_TGZ');
    console.log('Reviewed package archive: '+JSON.stringify(checkPackage(process.argv[2])));
  }catch(error){console.error('Package blocked: '+error.message);process.exitCode=1;}
}
