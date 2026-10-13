import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {forbidden,redact,redactDeep} from './analysis.mjs';
import {inspectToolMetadata,supportedToolConfig,pluginToolConfig} from './tool-metadata.mjs';

const LIMIT=256*1024;
const TYPES=new Set(['instruction','rule','skill','subagent','command','config','mcp-server','delegation','script','hook','plugin']);
const LANGUAGES={'.md':'markdown','.json':'json','.jsonc':'json','.toml':'toml','.yaml':'yaml','.yml':'yaml','.js':'javascript','.mjs':'javascript','.cjs':'javascript','.ts':'javascript','.tsx':'javascript','.py':'python','.sh':'shell','.bash':'shell','.zsh':'shell','.ps1':'text','.cmd':'text','.bat':'text','.rb':'text','.css':'css'};
const digest=buffer=>createHash('sha256').update(buffer).digest('hex');
const inside=(root,file)=>{const relative=path.relative(root,file);return relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);};
function reject(condition,message){if(!condition)throw new Error(message);}
async function noLinks(file){let current=path.parse(file).root;for(const part of file.slice(current.length).split(path.sep).filter(Boolean)){current=path.join(current,part);reject(!(await fs.lstat(current)).isSymbolicLink(),'Source symlinks are excluded');}}
function view(item,text,version) {
  const pluginManaged=!!pluginToolConfig(item);
  const name=path.basename(item.path),pathScoped=item.scope==='path'||item.scope==='path-rule'||item.scope==='subdir',mixedScope=name==='.claude.json';
  const purpose=name==='.skill-lock.json'?'Installation record for skills: their sources, versions and hashes. This is not an instruction file. Use the skill installer to add or update skills.':{
    instruction:'Instructions that guide the agent when this file is loaded.',
    rule:'Guidance for the agent. Its matching rules determine when it applies.',
    skill:'Instructions for a reusable task. Its description and full procedure may load at different times.',
    subagent:'Defines a helper agent and how it should work.',
    command:'Defines a reusable command that you can invoke.',
    config:'Settings that control how the coding agent operates.',
    'mcp-server':'Connection settings for tools provided by MCP servers. A configured server is not necessarily active or authenticated.',
    delegation:'Rules for routing work to agents or models.',
    script:'Executable steps for a reusable task.',
    hook:'An action associated with an agent event.',
    plugin:'Metadata describing a plugin and its components.'
  }[item.type];
  const scopeLabel=mixedScope?'Global and project settings':pathScoped?(item.repo?'Project subfolder':'Parent-folder instructions'):item.repo?'Project repository':'Global setup';
  const scopeDescription=mixedScope?'This file can contain both user-wide settings and settings for individual projects.':pathScoped?'Applies within its folder or matching paths, depending on the agent’s loading rules.':item.repo?'Stored in this repository; available to sessions that use this project.':'Stored in your user-level setup; may be used across multiple repositories.';
  const impact=mixedScope?'Saving updates this shared settings file. The affected projects depend on which entries you change.':pathScoped?'Saving updates this file for sessions that load it within this folder or its matching paths.':item.repo?'Saving updates this repository’s '+(item.type==='instruction'?'agent instructions':'agent configuration')+'. Global files stay unchanged.':'Saving updates this user-level file. It may affect multiple repositories when their agents or tooling use it.';
  let protectedContent=redact(text)!==text,sops=/^\s*["']?sops["']?\s*:/m.test(text);
  protectedContent ||= [...text.matchAll(/\b([A-Za-z_][\w.-]*)["']?\s*[:=]/g)].some(([,key])=>Object.values(redactDeep({[key]:'probe'}))[0]!=='probe');
  if(path.extname(item.path).toLowerCase()==='.json')try{const value=JSON.parse(text.replace(/^\uFEFF/,''));sops=Object.hasOwn(value||{},'sops');protectedContent ||= JSON.stringify(value)!==JSON.stringify(redactDeep(value));}catch{}
  // Withhold the whole protected document: line redaction cannot safely cover multiline values.
  const content=protectedContent||sops?'[Protected file contents withheld]\n':text;
  return {id:item.id,name:item.name,path:item.path,type:item.type,repo:item.repo||'',scope:item.scope,agent:item.agent||'',purpose,scopeLabel,scopeDescription,language:LANGUAGES[path.extname(item.path).toLowerCase()],content,version,editable:!(protectedContent||sops||pluginManaged),reason:sops?'SOPS-encrypted documents are excluded from this editor.':protectedContent?'Sensitive-looking content was redacted. Editing is disabled to protect hidden values.':pluginManaged?'Plugin-managed configuration is read-only. Change it through the owning plugin.':'',impact,bytes:Buffer.byteLength(text)};
}
function locate(inventory,id,home) {
  reject(typeof id==='string'&&id.length<=100,'Select a discovered file');
  const item=inventory.items.find(item=>item.id===id);
  reject(item&&TYPES.has(item.type)&&typeof item.path==='string','File is not in the editable inventory');
  const file=path.resolve(item.path);
  reject(file===item.path&&!forbidden(file)&&LANGUAGES[path.extname(file).toLowerCase()],'Choose a supported non-secret file');
  if(item.repo){const known=inventory.repos.some(repo=>(typeof repo==='string'?repo:repo.path)===item.repo);reject(known&&inside(path.resolve(item.repo),file),'File is outside its scanned repository');}
  else{const roots=['.claude','.codex','.kimi-code','.kimi','.orca','.kiro','.agents',path.join('.omp','agent'),path.join('.pi','agent'),path.join('.config','opencode'),path.join('.config','model-gateway')].map(folder=>path.join(home,folder));const ancestor=item.type==='instruction'&&/^(AGENTS(?:\.override)?|CLAUDE(?:\.local)?)\.md$/.test(path.basename(file))&&inside(home,file)&&inventory.repos.some(repo=>inside(path.dirname(file),typeof repo==='string'?repo:repo.path));reject(ancestor||['.claude.json','.mcp.json'].some(name=>file===path.join(home,name))||roots.some(root=>inside(root,file)),'File is outside known agent configuration homes');}
  return item;
}
async function snapshot(item) {
  await noLinks(item.path);
  const stat=await fs.lstat(item.path);
  reject(stat.isFile()&&stat.nlink===1&&stat.size<=LIMIT,'Choose a regular file under 256 KiB without hard links');
  const handle=await fs.open(item.path,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  try{
    const current=await handle.stat();reject(current.isFile()&&current.ino===stat.ino&&current.dev===stat.dev&&current.size===stat.size,'File changed while opening; reload it');
    const buffer=Buffer.alloc(current.size+1),{bytesRead}=await handle.read(buffer,0,buffer.length,0);
    reject(bytesRead===current.size,'File changed while reading; reload it');
    const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(buffer.subarray(0,bytesRead));
    return {text,stat:current,version:digest(buffer.subarray(0,bytesRead))};
  }finally{await handle.close();}
}
export async function readFile({inventory,id,home}) {
  const item=locate(inventory,id,home),original=await snapshot(item);
  return view(item,original.text,original.version);
}
export async function readFileBackup({inventory,id,home,store,version}) {
  const item=locate(inventory,id,home);
  reject(typeof version==='string'&&/^[a-f0-9]{64}$/.test(version),'Reload the file before comparing its backup');
  const original=await snapshot(item);
  reject(original.version===version,'File changed outside the editor. Reload before comparing its backup.');
  reject(view(item,original.text,version).editable,'Sensitive-looking content cannot be compared through this editor');
  const validDate=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
  const invalid='Saved backup could not be safely verified. Review local backup storage before retrying.';
  const candidates=Object.entries(store.manifest).reverse().filter(([file,entry])=>{
    const parts=file.split('/');
    return entry?.kind==='file-backup'&&entry.pinned===true&&parts.length===4&&parts[0]==='backups'&&parts[1]==='files'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(parts[2])&&parts[3]===path.basename(item.path)+'.metadata.json';
  });
  reject(candidates.every(([,entry])=>validDate(entry.updatedAt)),invalid);
  candidates.sort(([,left],[,right])=>Date.parse(right.updatedAt)-Date.parse(left.updatedAt));
  for(const [file]of candidates) {
    let metadata;
    try{metadata=JSON.parse((await snapshot({path:await store.location(file)})).text);}catch{throw new Error(invalid);}
    // Malformed metadata cannot prove source isolation, so stop instead of falling back to an older backup.
    reject(metadata&&typeof metadata.originalPath==='string'&&typeof metadata.repo==='string',invalid);
    if(metadata.originalPath!==item.path||metadata.repo!==(item.repo||''))continue;
    reject(validDate(metadata.at)&&typeof metadata.version==='string'&&/^[a-f0-9]{64}$/.test(metadata.version),invalid);
    const partner=file.slice(0,-'.metadata.json'.length),entry=store.manifest[partner];
    reject(entry?.kind==='file-backup'&&entry.pinned===true,invalid);
    let backup;
    try{backup=await snapshot({path:await store.location(partner)});}catch{throw new Error(invalid);}
    reject(backup.version===metadata.version,invalid);
    reject(view(item,backup.text,backup.version).editable,'Sensitive-looking backup contents cannot be compared through this editor');
    return {id:item.id,version,content:backup.text,backupAt:metadata.at};
  }
  throw new Error('No saved backup was found for this file. Backups are created when you save changes in this utility.');
}
export async function inspectTools({inventory,id,home,agent,repo='',manager=false}) {
  const item=locate(inventory,id,home),supported=supportedToolConfig(item)||(manager&&pluginToolConfig(item));
  reject(supported,'Tool metadata inspection is not supported for this file');
  const original=await snapshot(item);
  reject(!/^\s*["']?sops["']?\s*[:=]/m.test(original.text),'SOPS-encrypted documents are excluded from tool inspection');
  return {...inspectToolMetadata(original.text,{format:supported.format,agent,repo,detailed:manager}),...(manager?{version:original.version,editable:view(item,original.text,original.version).editable}:{}),at:new Date().toISOString(),bytes:original.stat.size,modifiedAt:original.stat.mtime.toISOString()};
}
export async function saveFile({inventory,id,home,store,version,content}) {
  const item=locate(inventory,id,home);
  reject(typeof content==='string'&&Buffer.byteLength(content)<=LIMIT,'File content must be under 256 KiB');
  reject(typeof version==='string'&&/^[a-f0-9]{64}$/.test(version),'Reload the file before saving');
  const original=await snapshot(item),before=view(item,original.text,original.version);
  reject(original.version===version,'File changed outside the editor. Reload and review your changes before saving.');
  reject(before.editable&&view(item,content,version).editable,'Sensitive-looking content cannot be saved through this editor');
  if(path.extname(item.path).toLowerCase()==='.json')try{JSON.parse(content.replace(/^\uFEFF/,''));}catch{throw new Error('JSON must be valid before saving');}
  if(content===original.text)return {...before,saved:false,backup:null};
  const backup='backups/files/'+randomUUID()+'/'+path.basename(item.path);
  await store.write(backup,original.text,{kind:'file-backup',pinned:true});
  await store.write(backup+'.metadata.json',{originalPath:item.path,version,at:new Date().toISOString(),repo:item.repo||''},{kind:'file-backup',pinned:true});
  const temporary=path.join(path.dirname(item.path),'.'+path.basename(item.path)+'.harness-'+randomUUID()+'.tmp');
  let handle;
  try{
    await noLinks(path.dirname(item.path));
    handle=await fs.open(temporary,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL,original.stat.mode&0o777);
    await handle.writeFile(content,'utf8');await handle.chmod(original.stat.mode&0o777);await handle.sync();await handle.close();handle=null;
    const latest=await snapshot(item);
    reject(latest.version===version&&latest.stat.ino===original.stat.ino&&latest.stat.dev===original.stat.dev,'File changed during save. Your draft and the backup were kept; reload before retrying.');
    // shortcut: Node cannot atomically compare and replace; concurrent external editors require an OS locking adapter.
    await noLinks(path.dirname(item.path));await fs.rename(temporary,item.path);
  }finally{if(handle)await handle.close();await fs.rm(temporary,{force:true});}
  return {...view(item,content,digest(Buffer.from(content))),saved:true,backup};
}
