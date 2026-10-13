import path from 'node:path';
import {createHash} from 'node:crypto';
import {forbidden,safeText} from './analysis.mjs';
import {parseSessionUsage} from './session-usage.mjs';

const FILE_LIMIT=2*1024*1024,TOTAL_LIMIT=8*1024*1024;
const digest=value=>createHash('sha256').update(value).digest('hex');
function reject(condition,message){if(!condition)throw new Error(message);}
function normalized(value){return /^[a-z]:[\\/]|^[\\/]{2}/i.test(value)?path.win32.normalize(value).toLowerCase():path.posix.normalize(value);}
function workingScope(cwd,repos){
  if(cwd==='')return '';
  if(typeof cwd!=='string'||!path.posix.isAbsolute(cwd)&&!path.win32.isAbsolute(cwd))return null;
  const source=normalized(cwd);
  return [...repos].sort((a,b)=>b.length-a.length).find(repo=>{const root=normalized(repo),separator=root.includes('\\')?'\\':'/';return source===root||source.startsWith(root.replace(/[\\/]$/,'')+separator);})??null;
}
export async function importUsage({files=[],paths=[],agent,repo='',repos=[],assets=[],days=7,now=Date.now()}){
  reject(['claude','codex'].includes(agent),'Session import supports Claude and Codex');
  reject([1,7,30,'all'].includes(days),'Choose 24 hours, 7 days, 30 days or all supplied records');
  reject(Array.isArray(files)&&Array.isArray(paths)&&files.length+paths.length>0&&files.length+paths.length<=20&&!(files.length&&paths.length),'Choose at most 20 session files using one input method');
  const source=files.length?files.map(file=>({name:file?.name,content:file?.content})): [...new Set(paths)].map(file=>({path:file}));
  const result={at:new Date(now).toISOString(),agent,repo,window:{from:days==='all'?null:new Date(now-days*86400000).toISOString(),to:new Date(now).toISOString(),observedFrom:null,observedTo:null},files:{selected:source.length,read:0,skipped:0},coverage:{partial:false,issues:[],records:0,excludedOtherScope:0,excludedOutsideWindow:0,limit:'Only explicitly selected files and supported call formats are sampled. Missing calls do not establish unused assets.'},items:[],source:'explicit local session import; tool calls are not proof of benefit'};
  result.fileReadCoverage={supported:agent==='claude',interpretation:agent==='claude'?'Explicit Claude Read requests for supplied inventory targets only. Returned bytes, ranges, body version and eager loading are unknown. Requests and results are not proof of usefulness or success.':'Explicit file read attribution is unsupported for this session agent. Returned bytes, ranges, body version and eager loading are unknown.'};
  const issue=message=>{result.coverage.partial=true;if(result.coverage.issues.length<12&&!result.coverage.issues.includes(message))result.coverage.issues.push(message);};
  const events=new Map(),conflicts=new Set();let bytes=0;
  for(const file of source){
    let text,format;
    try{
      const name=file.path||file.name;
      reject(typeof name==='string'&&name.length<=4096&&!forbidden(name)&&['.json','.jsonl'].includes(path.extname(name).toLowerCase()),'Session file type or name is excluded');
      if(file.path){reject(path.isAbsolute(file.path),'Choose absolute session file paths');text=await safeText(file.path,['.json','.jsonl'],FILE_LIMIT,true);}
      else{reject(typeof file.content==='string'&&typeof file.name==='string'&&!/[\\/]/.test(file.name),'Choose a session export file');text=file.content;}
      reject(Buffer.byteLength(text)<=FILE_LIMIT,'Session file exceeds the per-file limit');
      reject(bytes+Buffer.byteLength(text)<=TOTAL_LIMIT,'Session import exceeds its total read limit');bytes+=Buffer.byteLength(text);
      format=path.extname(name).toLowerCase()==='.jsonl'?'jsonl':'json';
    }catch{result.files.skipped++;issue('Some selected files were excluded, unreadable or exceeded the import limits.');continue;}
    result.files.read++;
    const parsed=parseSessionUsage(text,{agent,format,assets});result.coverage.records+=parsed.coverage.records;
    if(parsed.coverage.partial)for(const message of parsed.coverage.issues)issue(message);
    for(const excluded of parsed.excludedCalls||[]){const key=digest(JSON.stringify([agent,excluded.sessionId,excluded.callId]));if(events.has(key))issue('Conflicting duplicate call identifiers were excluded.');events.delete(key);conflicts.add(key);}
    for(const event of parsed.events){
      const key=digest(JSON.stringify([agent,event.sessionId,event.callId]));if(conflicts.has(key)){issue('Conflicting duplicate call identifiers were excluded.');continue;}
      const prior=events.get(key);
      if(prior){
        if(prior.kind!==event.kind||prior.name!==event.name||prior.tool!==event.tool||prior.repo!==event.repo||prior.at!==event.at){events.delete(key);conflicts.add(key);issue('Conflicting duplicate call identifiers were excluded.');continue;}
        prior.resultSeen||=event.resultSeen;prior.failed||=event.failed;
      }else if(events.size+conflicts.size<5000)events.set(key,{kind:event.kind,name:event.name,tool:event.tool,repo:event.repo,at:event.at,session:digest(event.sessionId),resultSeen:event.resultSeen,failed:event.failed});
      else issue('The import call limit was reached.');
    }
  }
  const grouped=new Map(),reads=new Map();
  for(const event of events.values()){
    const scope=workingScope(event.repo,repos);
    if(scope===null){issue('Some calls could not be attributed to a scanned working scope.');continue;}
    if(scope!==repo){result.coverage.excludedOtherScope++;continue;}
    if(event.at>result.window.to||result.window.from&&event.at<result.window.from){result.coverage.excludedOutsideWindow++;continue;}
    if(event.kind==='file-read'){
      const item=reads.get(event.name)||{assetId:event.name,requests:0,resultsSeen:0,failed:0,sessions:new Set(),firstRequest:event.at,lastRequest:event.at};
      item.requests++;item.resultsSeen+=Number(event.resultSeen);item.failed+=Number(event.failed);item.sessions.add(event.session);if(event.at<item.firstRequest)item.firstRequest=event.at;if(event.at>item.lastRequest)item.lastRequest=event.at;reads.set(event.name,item);
    }else{
    const key=JSON.stringify([event.kind,event.name,event.tool||'']);
    const item=grouped.get(key)||{kind:event.kind,name:event.name,...(event.tool?{tool:event.tool}:{}),calls:0,resultsSeen:0,failed:0,sessions:new Set(),firstCall:event.at,lastCall:event.at};
    item.calls++;item.resultsSeen+=Number(event.resultSeen);item.failed+=Number(event.failed);item.sessions.add(event.session);if(event.at<item.firstCall)item.firstCall=event.at;if(event.at>item.lastCall)item.lastCall=event.at;grouped.set(key,item);
    }
    if(!result.window.observedFrom||event.at<result.window.observedFrom)result.window.observedFrom=event.at;if(!result.window.observedTo||event.at>result.window.observedTo)result.window.observedTo=event.at;
  }
  result.items=[...grouped.values()].map(item=>({...item,sessions:item.sessions.size})).sort((a,b)=>b.calls-a.calls||a.name.localeCompare(b.name));
  result.totals={calls:result.items.reduce((total,item)=>total+item.calls,0),resultsSeen:result.items.reduce((total,item)=>total+item.resultsSeen,0),failed:result.items.reduce((total,item)=>total+item.failed,0)};
  result.fileReads=[...reads.values()].map(item=>({...item,sessions:item.sessions.size})).sort((a,b)=>b.requests-a.requests||a.assetId.localeCompare(b.assetId));
  result.fileReadTotals={requests:result.fileReads.reduce((total,item)=>total+item.requests,0),resultsSeen:result.fileReads.reduce((total,item)=>total+item.resultsSeen,0),failed:result.fileReads.reduce((total,item)=>total+item.failed,0)};
  return result;
}
export function componentCallEvidence(item,items,usage){
  if(!usage)return null;
  const reads=Array.isArray(usage.fileReads)?usage.fileReads.filter(read=>read.assetId===item.id):null;
  const readEvidence=reads?{reads,readAttribution:usage.fileReadCoverage?.interpretation||'Explicit target requests only; returned bytes, ranges, body version, eager loading and usefulness remain unknown.'}:{};
  if(item.type==='skill'){
    const match=usage.items.filter(call=>call.kind==='skill'&&call.name===item.name),copies=items.filter(candidate=>candidate.type==='skill'&&candidate.name===item.name).length;
    return {matches:match,attribution:copies===1?'skill name matches one discovered file; body version unverified':'multiple files match this skill name; source file unresolved',ambiguous:copies!==1,...readEvidence};
  }
  if(item.toolInspection){const names=new Set(item.toolInspection.servers.map(server=>server.name));return {matches:usage.items.filter(call=>call.kind==='mcp'&&names.has(call.name)),attribution:'server name matches a configuration snapshot; effective source file unverified',ambiguous:true,...readEvidence};}
  if(reads?.some(read=>read.requests>0))return {matches:[],attribution:'No skill or MCP name attribution for this item.',ambiguous:false,...readEvidence};
  return null;
}
