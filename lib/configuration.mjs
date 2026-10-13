import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {forbidden} from './analysis.mjs';

const check=(condition,message)=>{if(!condition)throw new Error(message);};
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
const notes=[
  'Starters contain no active MCP connections, hooks or executable scripts. Review the file before adding behavior.',
  'Creation does not verify registration or effective loading. Trust, managed policies, profiles and command-line flags can change what the agent uses.',
  'Existing files open through the protected editor; saving edits uses its conflict checks and private backups.',
  'Custom agent home overrides are not resolved; these targets use the standard home locations.'
];

function catalog({inventory,home,agent,repo=''}) {
  check(['claude','codex'].includes(agent),'Configuration starters support Claude Code and Codex');
  check(typeof repo==='string'&&(!repo||inventory.repos.some(value=>(typeof value==='string'?value:value.path)===repo)),'Select a scanned repository');
  check(typeof home==='string'&&path.isAbsolute(home)&&path.resolve(home)===home&&!forbidden(home),'Choose a safe absolute home directory');
  check(!repo||(path.isAbsolute(repo)&&path.resolve(repo)===repo&&!forbidden(repo)),'Choose a safe scanned repository');
  const root=repo||home,scope=repo?'repo':'global',targets=[];
  const add=(key,label,type,parts,language,options={})=>targets.push({key,label,type,path:path.join(root,...parts),scope,language,named:false,...options});
  if(agent==='claude') {
    add('instruction','Claude instructions','instruction',repo?['CLAUDE.md']:['.claude','CLAUDE.md'],'markdown');
    if(repo)add('instruction-local','Personal repository instructions','instruction',['CLAUDE.local.md'],'markdown',{scope:'local',note:'Keep personal repository instructions out of version control.'});
    add('config','Agent settings','config',['.claude','settings.json'],'json');
    if(repo)add('config-local','Personal repository settings','config',['.claude','settings.local.json'],'json',{scope:'local',note:'This utility does not change Git ignore rules. Add this personal file to your repository ignore rules.'});
    add('mcp','MCP servers','mcp-server',repo?['.mcp.json']:['.claude.json'],'json',repo?{}:{disabled:true,reason:'Claude stores user MCPs with sign-in and per-project state in ~/.claude.json. Use claude mcp add --scope user; direct creation is unavailable to protect that combined file.'});
    add('skill','Named skill','skill',['.claude','skills','<name>','SKILL.md'],'markdown',{named:true});
    add('subagent','Named subagent','subagent',['.claude','agents','<name>.md'],'markdown',{named:true});
  } else {
    add('instruction','Agent instructions','instruction',repo?['AGENTS.md']:['.codex','AGENTS.md'],'markdown');
    add('instruction-override','Instruction override','instruction',repo?['AGENTS.override.md']:['.codex','AGENTS.override.md'],'markdown',{note:'At the same directory, AGENTS.override.md takes precedence over AGENTS.md.'});
    add('config','Agent settings and MCP servers','config',['.codex','config.toml'],'toml',{note:repo?'Codex uses project configuration only when the project is trusted.':''});
    add('skill','Named skill','skill',['.agents','skills','<name>','SKILL.md'],'markdown',{named:true});
    add('subagent','Subagent configuration','config',['.codex','config.toml'],'toml',{disabled:true,reason:'Codex subagents need role registration in configuration plus role-specific files. This starter cannot verify that registration; edit existing configuration or ask an agent to draft it.'});
  }
  return {agent,repo,targets};
}

// Pin every existing ancestor so an external directory replacement is rejected.
async function inspect(file) {
  const anchors=[];
  let current=path.parse(file).root;
  const parts=file.slice(current.length).split(path.sep).filter(Boolean);
  for(let index=-1;index<parts.length;index++) {
    if(index>=0)current=path.join(current,parts[index]);
    let stat;
    try{stat=await fs.lstat(current);}catch(error){if(error.code==='ENOENT')return {exists:false,anchors};throw error;}
    check(!stat.isSymbolicLink(),'Source symlinks are excluded');
    if(index===parts.length-1)return {exists:true,stat,anchors};
    check(stat.isDirectory(),'Source ancestor must be a directory');
    anchors.push({path:current,dev:stat.dev,ino:stat.ino});
  }
  return {exists:true,stat:await fs.lstat(current),anchors};
}
async function guard(anchors) {
  for(const anchor of anchors){const stat=await fs.lstat(anchor.path);check(stat.isDirectory()&&!stat.isSymbolicLink()&&same(stat,anchor),'Source directory changed; refresh before creating a file');}
}
function componentName(name) {
  check(typeof name==='string'&&name.length<=64&&/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name)&&!forbidden(name)&&!/(?:^|-)(?:secrets?|auth(?:entication)?|oauth|accounts?|tokens?)(?:-|$)|sops|credential|password|passwd|private-?key/i.test(name)&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(name),'Use a non-secret lowercase name with letters, numbers and single hyphens');
  return name;
}
function template(target,name) {
  if(target.type==='skill')return '---\nname: '+name+'\ndescription: Use only when explicitly asked to review this unfinished starter.\n'+(target.path.includes(path.sep+'.claude'+path.sep)?'disable-model-invocation: true\n':'')+'---\n\n# '+name+'\n\nReplace this starter with a concise procedure for one repeatable task. Link detailed references only when needed.\n';
  if(target.type==='subagent')return '---\nname: '+name+'\ndescription: Starter subagent; define its specific task before use.\ntools: Read, Grep, Glob\n---\n\nReview the requested task using read-only tools. Return concise findings and do not change files.\n';
  if(target.type==='instruction')return '# Agent instructions\n\nAdd concise instructions that apply to this scope. Keep task-specific procedures in skills or referenced files.\n';
  if(target.type==='mcp-server')return '{\n  "mcpServers": {}\n}\n';
  return target.language==='toml'?'# Agent configuration\n# Add reviewed settings here. MCP servers are configured in mcp_servers tables.\n':'{}\n';
}

export async function configurationTargets(options) {
  const result=catalog(options);
  for(const target of result.targets) {
    target.exists=false;target.creatable=!target.disabled;
    if(target.named)continue;
    try {
      const found=await inspect(target.path);
      target.exists=found.exists;
      if(found.exists) {
        target.creatable=false;
        check(found.stat.isFile()&&found.stat.nlink===1,'Choose a regular file without hard links');
        const item=options.inventory.items.find(item=>item.path===target.path&&(item.repo||'')===result.repo);
        if(item)target.existingId=item.id;
        else target.reason=target.reason||'This file exists but is not in the current inventory. Scan before editing it.';
      }
    } catch(error) {target.creatable=false;target.reason='This location cannot be safely managed: '+(error.code||error.message);}
  }
  return {...result,notes};
}

export async function createConfiguration(options) {
  const {target:key,name}=options,result=catalog(options),target=result.targets.find(target=>target.key===key);
  check(target&&!target.disabled,'Select a supported configuration starter');
  check(result.agent!=='claude'||target.type!=='skill'||!['synced','anthropic-skills'].includes(name),'This skill name is reserved by Claude Code');
  check(target.named||name===undefined,'This starter does not accept a component name');
  const file=target.named?target.path.replace('<name>',componentName(name)):target.path;
  check(!forbidden(file),'Choose a non-secret configuration location');
  const content=template(target,name),original=await inspect(file);
  check(!original.exists,'File already exists. Open it in the editor instead.');
  const anchors=[...original.anchors],directories=[],temporary=path.join(path.dirname(file),'.harness-starter-'+randomUUID()+'.tmp');
  let stage,handle,published=false,warning='';
  try {
    let directory=path.parse(file).root;
    for(const part of path.dirname(file).slice(directory.length).split(path.sep).filter(Boolean)) {
      directory=path.join(directory,part);
      if(anchors.some(anchor=>anchor.path===directory))continue;
      await guard(anchors);
      await fs.mkdir(directory,{mode:0o700});
      const stat=await fs.lstat(directory);
      check(stat.isDirectory()&&!stat.isSymbolicLink(),'Created directory changed');
      const anchor={path:directory,dev:stat.dev,ino:stat.ino};anchors.push(anchor);directories.push(anchor);
    }
    await guard(anchors);
    handle=await fs.open(temporary,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|(fs.constants.O_NOFOLLOW||0),0o600);
    stage=await handle.stat();await handle.writeFile(content,'utf8');await handle.sync();await handle.close();handle=null;
    await guard(anchors);
    const staged=await fs.lstat(temporary);
    check(staged.isFile()&&staged.nlink===1&&same(staged,stage),'Starter staging file changed');
    // Exclusive link publishes complete bytes without replacing a concurrent file.
    // shortcut: Node has no cross-platform directory-handle writes; hostile concurrent ancestor swaps need an OS adapter.
    await fs.link(temporary,file);published=true;
  } finally {
    if(handle)await handle.close();
    if(stage) {
      try{await guard(anchors);const current=await fs.lstat(temporary);check(current.isFile()&&same(current,stage),'Starter staging file changed');await fs.unlink(temporary);}catch(error){if(error.code!=='ENOENT'){if(!published)throw error;warning='The file was created, but staging cleanup could not be verified. Review the local starter location before editing.';}}
    }
    if(!published)for(const directory of directories.reverse()) {
      try{await guard(anchors);const current=await fs.lstat(directory.path);if(same(current,directory))await fs.rmdir(directory.path);anchors.splice(anchors.findIndex(anchor=>anchor.path===directory.path),1);}catch(error){if(error.code!=='ENOENT')throw error;}
    }
  }
  return {created:true,path:file,agent:result.agent,repo:result.repo,scope:target.scope,language:target.language,...(warning?{warning}:{}),notes:[...notes,...(target.note?[target.note]:[])]};
}
