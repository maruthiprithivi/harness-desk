import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readFile,saveFile,inspectTools} from './files.mjs';
import {supportedToolConfig,pluginToolConfig,inspectToolMetadata,tomlLine,tomlKeys} from './tool-metadata.mjs';
import {redact} from './analysis.mjs';

const check=(condition,message)=>{if(!condition)throw new Error(message);};
const safeLabel=value=>redact(value).replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,160);
function source(item) {
  const parts=item.path.replace(/\\/g,'/').split('/'),index=parts.findIndex(part=>part==='plugins'||part==='plugin');
  const plugin=!!pluginToolConfig(item);
  let label=parts.at(-1);
  if(plugin){const after=parts.slice(index+1).filter(part=>!['cache','marketplaces'].includes(part));label=after.findLast(part=>!/^\d/.test(part)&&!part.endsWith('.json'))||'Plugin';}
  return {sourceKind:plugin?'plugin':'configuration',sourceLabel:safeLabel(label),scope:item.repo?'repository':'global'};
}
function candidates({inventory,agent,repo=''}) {
  check(typeof agent==='string'&&typeof repo==='string','Select an agent and repository');
  check(!repo||inventory.repos.some(item=>(typeof item==='string'?item:item.path)===repo),'Select a scanned repository');
  const seen=new Set();
  return inventory.items.filter(item=>{
    if((item.repo&&item.repo!==repo)||![agent,'shared'].includes(item.agent)||(!supportedToolConfig(item)&&!pluginToolConfig(item))||seen.has(item.path))return false;
    seen.add(item.path);return true;
  });
}
function actions(item,metadata,agent) {
  if(pluginToolConfig(item))return {allowedActions:[],readOnlyReason:'Plugin-managed configuration. Change it through the owning plugin.'};
  if(path.basename(item.path)==='.claude.json')return {allowedActions:[],readOnlyReason:'Combined account configuration is read-only here.'};
  if(!metadata.editable)return {allowedActions:[],readOnlyReason:'Protected configuration. Hidden values cannot be safely edited here.'};
  if(metadata.coverage.partial)return {allowedActions:[],readOnlyReason:'Unsupported or incomplete syntax. Review the configuration file first.'};
  const flags=supportedToolConfig(item)?.format==='toml'&&agent==='codex'||agent==='kiro';
  return {allowedActions:flags?['enable','disable','remove']:['remove'],readOnlyReason:flags?'':'This harness does not support a verified per-server enable flag in this file. Edit its configuration or remove the entry.'};
}
export async function listMcpServers(options) {
  const items=candidates(options),servers=[],sources=[],issues=[];
  for(const item of items.slice(0,300)){
    try{
      const metadata=await inspectTools({...options,id:item.id,manager:true}),origin=source(item),capability=actions(item,metadata,options.agent);
      sources.push({fileId:item.id,...origin,serverCount:metadata.servers.length,partial:metadata.coverage.partial});
      for(const [index,server]of metadata.servers.entries()){
        if(servers.length>=2000)break;
        servers.push({...server,id:item.id+':'+index,fileId:item.id,...origin,...capability,version:metadata.version,...(server.localScope?{scope:'repository',allowedActions:[],readOnlyReason:'Project entry in combined account configuration is read-only here.'}:{})});
      }
      if(metadata.coverage.partial)issues.push(origin.sourceLabel+': '+metadata.coverage.issues.join(' '));
      if(servers.length>=2000){issues.push('Server result limit reached. Narrow the repository or agent selection.');break;}
    }catch{sources.push({fileId:item.id,...source(item),serverCount:null,partial:true});issues.push(source(item).sourceLabel+': Could not inspect this source safely.');}
  }
  if(items.length>300)issues.push('Configuration source limit reached. Narrow the repository or agent selection.');
  return {servers,sources,coverage:{partial:issues.length>0,issues:issues.slice(0,30)},at:new Date().toISOString()};
}

// Work on byte ranges so unrelated numbers, spacing and configuration values stay unchanged.
function jsonProperties(text,start=0) {
  let position=start;const space=()=>{while(/\s/.test(text[position]||'')&&position<text.length)position++;};
  const valueEnd=()=>{let depth=0,quoted=false,escaped=false;for(;position<text.length;position++){const char=text[position];if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;continue;}if(char==='"')quoted=true;else if(char==='{'||char==='[')depth++;else if(char==='}'||char===']'){if(!depth)break;depth--;}else if(char===','&&!depth)break;}let end=position;while(/\s/.test(text[end-1]||'')&&end>0)end--;return end;};
  space();check(text[position++]==='{','Server configuration must be an object');const properties=[];
  while(true){space();if(text[position]==='}')break;const begin=position;position++;let escaped=false;while(position<text.length){const char=text[position++];if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')break;}const key=JSON.parse(text.slice(begin,position));space();check(text[position++]===':','Invalid JSON property');space();const valueStart=position,valueEndPosition=valueEnd();properties.push({key,start:begin,valueStart,valueEnd:valueEndPosition});space();if(text[position]===','){position++;continue;}check(text[position]==='}','Invalid JSON object');break;}
  check(new Set(properties.map(item=>item.key)).size===properties.length,'Duplicate configuration keys must be resolved before changing a server');
  return {properties,end:position};
}
function removeProperty(text,parsed,index) {
  const property=parsed.properties[index],next=parsed.properties[index+1],previous=parsed.properties[index-1];
  const start=next?property.start:previous?previous.valueEnd:property.start,end=next?next.start:property.valueEnd;
  return text.slice(0,start)+text.slice(end);
}
export function transformMcpConfig(content,{format,agent,server,action}) {
  check(['enable','disable','remove'].includes(action),'Choose enable, disable or remove');
  const metadata=inspectToolMetadata(content,{format,agent});
  check(!metadata.coverage.partial&&metadata.servers.some(item=>item.name===server&&!item.localScope),'Choose a supported, unambiguous server definition');
  if(format==='json'){
    JSON.parse(content.replace(/^\uFEFF/,''));const offset=content.charCodeAt(0)===0xfeff?1:0,root=jsonProperties(content,offset),map=root.properties.find(item=>item.key==='mcpServers');
    check(map,'Server configuration was not found');const entries=jsonProperties(content,map.valueStart),index=entries.properties.findIndex(item=>item.key===server);check(index>=0,'Server definition was not found');
    const entry=entries.properties[index],fields=jsonProperties(content,entry.valueStart);
    if(action==='remove')return removeProperty(content,entries,index);
    check(agent==='kiro','Enable and disable are unsupported for this harness configuration');
    const updates=fields.properties.filter(item=>['enabled','disabled'].includes(item.key));
    if(updates.length){let result=content;for(const field of [...updates].reverse()){const value=field.key==='disabled'?action==='disable':action==='enable';result=result.slice(0,field.valueStart)+String(value)+result.slice(field.valueEnd);}return result;}
    return content.slice(0,fields.end)+(fields.properties.length?',':'')+'"disabled": '+String(action==='disable')+content.slice(fields.end);
  }
  check(format==='toml'&&agent==='codex','Unsupported configuration format');
  const lines=content.match(/[^\n]*(?:\n|$)/g).filter(Boolean),tables=[];let offset=0;
  for(const raw of lines){const line=tomlLine(raw.replace(/\r?\n$/,''));check(line!==null,'Unsupported TOML syntax');if(line.trim().startsWith('[')){const parts=tomlKeys(line.trim().slice(1,-1));check(parts,'Unsupported TOML table');tables.push({parts,start:offset,body:offset+raw.length,end:content.length});}offset+=raw.length;}
  for(let index=0;index<tables.length-1;index++)tables[index].end=tables[index+1].start;
  const selected=tables.filter(table=>table.parts[0]==='mcp_servers'&&table.parts[1]===server),direct=selected.find(table=>table.parts.length===2);check(direct,'Server definition was not found');
  if(action==='remove'){let result=content;for(const table of [...selected].reverse())result=result.slice(0,table.start)+result.slice(table.end);return result;}
  const body=content.slice(direct.body,direct.end),eol=content.includes('\r\n')?'\r\n':'\n';
  const flags=/^(\s*(?:enabled|"enabled"|'enabled'|disabled|"disabled"|'disabled')\s*=\s*)(true|false)(\s*(?:#.*)?)(\r?\n|$)/gm;
  let replaced=false;const changed=body.replace(flags,(match,prefix,value,suffix,newline)=>{replaced=true;const disabled=/^\s*["']?disabled/.test(prefix);return prefix+String(disabled?action==='disable':action==='enable')+suffix+newline;});
  return content.slice(0,direct.body)+(replaced?changed:'enabled = '+String(action==='enable')+eol+body)+content.slice(direct.end);
}

export function createMcpManager() {
  const reviews=new Map();
  return async function change(options) {
    const {phase,id,server,action,reviewToken,agent,repo=''}=options;
    check(['preview','apply'].includes(phase),'Choose preview or apply');
    check(typeof server==='string'&&server.length>0&&server.length<=160,'Choose a server name');
    const item=candidates(options).find(item=>item.id===id);check(item,'Choose a discovered configuration in this scope');
    const metadata=await inspectTools({...options,manager:true}),capability=actions(item,metadata,agent);
    check(capability.allowedActions.includes(action),capability.readOnlyReason||'This action is unavailable');
    check(metadata.servers.some(entry=>entry.name===server&&!entry.localScope),'Choose a server from this configuration');
    const original=await readFile(options);check(original.editable,'Protected configuration is read-only');
    const content=transformMcpConfig(original.content,{...supportedToolConfig(item),agent,server,action});
    const binding=JSON.stringify([id,server,action,agent,repo,original.version]);
    if(phase==='preview'){
      for(const [token,review]of reviews)if(Date.now()-review.at>600000)reviews.delete(token);
      if(reviews.size>=100)reviews.delete(reviews.keys().next().value);
      const token=randomUUID();reviews.set(token,{binding,at:Date.now()});
      return {reviewToken:token,version:original.version,summary:(action==='remove'?'Remove the configuration entry for ':action==='enable'?'Enable ':'Disable ')+server+'. '+(item.repo?'This repository':'Global setup')+' will change after you apply. A backup will be kept; restart the agent to check the result.',before:{configuredEnabled:metadata.servers.find(entry=>entry.name===server).configuredEnabled},after:action==='remove'?{removed:true}:{configuredEnabled:action==='enable'}};
    }
    const review=reviews.get(reviewToken);check(review&&review.binding===binding&&Date.now()-review.at<=600000,'The configuration or review changed. Preview this action again before applying.');
    reviews.delete(reviewToken);
    const result=await saveFile({...options,version:original.version,content});
    return {saved:result.saved,version:result.version,backup:result.backup};
  };
}
