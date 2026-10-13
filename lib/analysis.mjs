import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { groupPromptWording } from './prompt-wording.mjs';

export function redact(value) {
  return String(value)
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
    .replace(/\b(?:sk-[\w-]{12,}|gh[pousr]_[\w]{12,}|github_pat_[\w_]{12,}|AKIA[A-Z0-9]{16}|xox[baprs]-[\w-]+)\b/g, '[REDACTED]')
    .replace(/\b(Bearer\s+)[\w.+/=-]+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|authorization|credential|token)\b["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;}\n]+)/gi, (match,prefix)=>prefix+(match.slice(prefix.length).startsWith('"')?'"[REDACTED]"':match.slice(prefix.length).startsWith("'")?"'[REDACTED]'":'[REDACTED]'))
    .replace(/(https?:\/\/)[^\s/:]+:[^\s/@]+@/g, '$1[REDACTED]@');
}
export function forbidden(file) {
  return /(^|[/\\])(?:secrets?|auth|credentials?|node_modules|\.git|\.ssh)([/\\]|$)|(^|[/\\])(?:(?:auth|authentication)(?:\.(?:jsonl?|toml|ya?ml|ini|env))?|\.env[^/\\]*|\.envrc|\.sops\.yaml|[^/\\]*(?:credential|token|private[-_]?key)[^/\\]*|[^/\\]*\.(?:age|pem|key))$/i.test(file);
}
export async function safeText(file, extensions, limit = 2 * 1024 * 1024, raw = false) {
  const resolved = path.resolve(file);
  if (forbidden(resolved) || !extensions.includes(path.extname(resolved).toLowerCase())) throw new Error('Choose an allowed non-secret file');
  let cursor = path.parse(resolved).root;
  for (const part of resolved.slice(cursor.length).split(path.sep)) {
    cursor = path.join(cursor,part);
    if ((await fs.lstat(cursor)).isSymbolicLink()) throw new Error('Source symlinks are excluded');
  }
  const stat = await fs.stat(resolved);
  if (!stat.isFile() || stat.size > limit) throw new Error('Source file exceeds the import limit');
  if(stat.nlink!==1)throw new Error('Source hard links are excluded');
  const handle=await fs.open(resolved,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  try {
    const current=await handle.stat();
    if(!current.isFile()||current.nlink!==1||current.ino!==stat.ino||current.dev!==stat.dev||current.size!==stat.size)throw new Error('Source changed during import');
    const buffer=Buffer.alloc(current.size+1);const result=await handle.read(buffer,0,buffer.length,0);
    if(result.bytesRead!==current.size)throw new Error('Source changed during import');
    const text=new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,result.bytesRead));return raw?text:redact(text);
  }finally{await handle.close();}
}
export function redactDeep(value) {
  if(typeof value==='string')return redact(value);
  if(Array.isArray(value))return value.map(redactDeep);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[redact(key),/(^|[_-])(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|authorization|credential|token)(?:[_-]|$)/i.test(key)?'[REDACTED]':redactDeep(item)]));
  return value;
}
const id = text => createHash('sha256').update(text).digest('hex').slice(0,16);
export function recommendations(inventory, observations, budgets, repoBudgets = {}) {
  const result = [];
  const items = inventory?.items || [];
  for (const item of items) {
    if (item.duplicateOf) {
      const duplicate=items.find(candidate=>candidate.path===item.duplicateOf);
      const visible=duplicate&&[item.agent,'shared','model-gateway'].includes(duplicate.agent)&&(!duplicate.repo||duplicate.repo===item.repo);
      result.push({id:id(item.id+'duplicate'),itemId:item.id,title:'Review duplicate ' + item.name,scope:item.scope,repo:item.repo,evidence:item.path + ' and ' + (visible?item.duplicateOf:'a source outside this agent or repository scope; its path is withheld from this scoped proposal') + ' had identical complete Markdown at the last scan' + (Number.isFinite(item.residentTokens)?'; discovered estimated metadata cost ' + item.residentTokens + ' tokens (bytes/4; actual loading not observed).':'; discovered metadata cost unknown; actual loading not observed.'),action:'Compare this copy with a known eligible canonical copy and confirm each agent can load it. Propose one reversible change, then benchmark equivalent fixed tasks before and after, comparing tokens and quality. Roll back changes that worsen quality or fail to improve measured tokens. Discovery alone does not prove either copy is unnecessary or that removal saves tokens.',expectedSaving:null,confidence:'exact content match',status:'proposal'});
    }
    if (item.type === 'instruction' && item.bytes > 32768) result.push({id:id(item.id+'oversize'),itemId:item.id,title:'Split large instruction file',scope:item.scope,repo:item.repo,evidence:item.path + ' is ' + item.bytes + ' bytes.',action:'Check this agent’s actual document budget. Move procedures into invoked skills, retain essential constraints and verify in a fresh session.',expectedSaving:null,confidence:'measured bytes; load not observed',status:'proposal'});
  }
  const groups = new Map();
  for (const item of items) {
    const key = [item.agent,item.scope,item.repo || ''].join('|');
    groups.set(key,(groups.get(key)||0)+(Number(item.residentTokens)||0));
  }
  for (const [key,tokens] of groups) {
    const [agent,scope,repo] = key.split('|');
    const cap = scope === 'global' ? budgets.globalTokens : (repoBudgets[repo]?.repoTokens ?? budgets.repoTokens);
    if (tokens > cap) result.push({id:id(key+'budget'),agent,title:agent + ' exceeds the estimated ' + scope + ' budget',scope,repo,evidence:tokens + ' estimated resident tokens, budget ' + cap + ', estimated budget gap ' + (tokens-cap) + ' tokens. Bytes/4 approximates discovered metadata cost; actual loading was not observed. The budget gap is not a proven or achievable saving.',action:'Inspect the discovered contributors for this scope and verify which ones actually load. Propose one reversible change, then benchmark equivalent fixed tasks before and after, comparing tokens and quality. Roll back changes that worsen quality or fail to improve measured tokens.',expectedSaving:null,confidence:'estimate',status:'proposal'});
  }
  const latestObservations = new Map();
  for (const observation of observations) {
    const key=JSON.stringify([observation.agent,observation.repo||'']);
    if(!latestObservations.has(key)||Date.parse(observation.at)>=Date.parse(latestObservations.get(key).at))latestObservations.set(key,observation);
  }
  for (const observation of latestObservations.values()) {
    const contextPercent=repoBudgets[observation.repo]?.contextPercent ?? budgets.contextPercent;
    if (observation.windowTokens > 0 && observation.startupTokens / observation.windowTokens * 100 > contextPercent) result.push({id:id(observation.id+'observed'),agent:observation.agent,title:'Observed startup context exceeds the budget',scope:observation.repo?'repo':'global',repo:observation.repo,evidence:observation.startupTokens + ' startup tokens / ' + observation.windowTokens + ' window tokens, recorded ' + observation.at + ', budget ' + contextPercent + '% (' + (observation.windowTokens*contextPercent/100) + ' tokens), budget gap ' + Math.ceil(observation.startupTokens-observation.windowTokens*contextPercent/100) + ' tokens. The budget gap is calculated from a user supplied reading; it is not a proven or achievable saving.',action:'Compare actual startup contributors with inventory. Propose one reversible change, then benchmark equivalent fixed tasks before and after, comparing tokens and quality. Roll back changes that worsen quality or fail to improve measured tokens.',expectedSaving:null,confidence:'user supplied measurement',status:'proposal'});
  }
  return result;
}
function normalize(text) {
  return text.toLowerCase().replace(/https?:\/\/\S+/g,'<url>').replace(/(?:[a-z]:\\|[~/.])[^\s]+/gi,'<path>').replace(/\b[0-9a-f]{8,}\b/g,'<hash>').replace(/\b\d+\b/g,'<n>').replace(/\s+/g,' ').trim();
}
function messageText(record) {
  const source = record.message || record.payload || record;
  if (typeof source === 'string') return source;
  const content = source.content ?? source.text ?? source.message ?? '';
  if (typeof content === 'string') return content;
  return Array.isArray(content) ? content.filter(c=>c?.type==='text'||c?.type==='input_text').map(c=>typeof c.text==='string'?c.text:'').join('\n') : '';
}
function repeatEvidence() {return {occurrences:0,sessions:new Set(),agents:new Set(),characters:0,examples:[]};}
function addRepeat(map,pattern,repo,session,agent,characters=0,example='') {
  const entry=map.get(pattern)||{pattern,...repeatEvidence(),byRepo:new Map()};
  const local=entry.byRepo.get(repo)||repeatEvidence();
  for(const evidence of [entry,local]) {
    evidence.occurrences++;evidence.sessions.add(session);evidence.agents.add(agent);evidence.characters+=characters;
    if(example&&evidence.examples.length<3)evidence.examples.push(example.slice(0,180));
  }
  entry.byRepo.set(repo,local);map.set(pattern,entry);
}
function summarizeRepeat(entry) {
  const estTokens=Math.ceil(entry.characters/4);
  return {occurrences:entry.occurrences,distinctSessions:entry.sessions.size,sessions:[...entry.sessions],agents:[...entry.agents],estTokens,estSaving:Math.floor(estTokens*(entry.occurrences-1)/entry.occurrences),examples:entry.examples};
}
export function scopeCandidate(candidate,repo,globalOnly=false) {
  if(!repo&&!globalOnly)return candidate;
  const evidence=candidate.evidenceByRepo?.[repo];
  if(!evidence||evidence.occurrences<3||evidence.distinctSessions<2)return null;
  const {evidenceByRepo,...shared}=candidate;
  return {...shared,...evidence,repos:[repo]};
}
function miningValue(value) {
  return typeof value==='string'&&value.length>0&&value.length<=4096&&!/[\u0000-\u001f\u007f-\u009f]/.test(value)&&redact(value)===value&&!/\[REDACTED/i.test(value);
}
function miningField(record,source,keys) {
  for(const object of [record,source])if(object&&typeof object==='object')for(const key of keys)if(Object.hasOwn(object,key))return {value:object[key]};
  return null;
}
// Exact normalized matches remain primary; separate local wording hints are bounded and need review.
export async function mineTranscripts(paths) {
  if (!Array.isArray(paths) || paths.length > 100) throw new Error('Import at most 100 explicitly selected transcript files');
  if(paths.some(file=>typeof file!=='string'||!file.trim()||file.includes('\0')))throw new Error('Choose transcript file paths');
  const patterns = new Map(), corrections = new Map(), sequences = new Map(), commands = new Map(), failures = new Map();
  const files=[...new Set(paths.map(file=>path.resolve(file)))],contents=new Set(),events=new Set(),warnings=[],issues=[];
  const summary={selectedFiles:paths.length,distinctPaths:files.length,readFiles:0,analyzedFiles:0,duplicatePaths:paths.length-files.length,duplicateContents:0,duplicateRecords:0,supportedRecords:0,unsupportedRecords:0,unattributedRecords:0,malformedRecords:0,excludedRecords:0,unreadableFiles:0};
  const issue=message=>{if(!issues.includes(message)&&issues.length<8)issues.push(message);};
  for (const file of files) {
    const warn = message => warnings.push(redact(file).slice(0,500) + ': ' + message);
    let raw;
    try {raw=await safeText(file,['.jsonl','.json'],2*1024*1024,true);summary.readFiles++;}
    catch {summary.unreadableFiles++;warn('could not read an allowed transcript file');issue('Some selected files could not be read.');continue;}
    const contentId=createHash('sha256').update(raw).digest('hex');
    if(contents.has(contentId)){summary.duplicateContents++;continue;}
    contents.add(contentId);summary.analyzedFiles++;
    let records = [], malformed = 0;
    if (path.extname(file).toLowerCase()==='.json') {
      try { records = JSON.parse(raw); }
      catch {summary.malformedRecords++;warn('could not parse JSON');issue('Malformed records were excluded.');continue;}
      if (!Array.isArray(records)) {
        if (Array.isArray(records?.messages)) records = records.messages;
        else if (Array.isArray(records?.turns)) records = records.turns;
        else {summary.unsupportedRecords++;warn('unsupported JSON envelope; expected a records, messages or turns array');issue('Unsupported transcript records or envelopes were excluded.');continue;}
      }
    } else {
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try { records.push(JSON.parse(line)); } catch { malformed++; }
      }
    }
    const valid = records.filter(record => record && typeof record==='object' && !Array.isArray(record));
    const excluded = records.length - valid.length;
    summary.malformedRecords+=malformed;summary.excludedRecords+=excluded;
    if(malformed)issue('Malformed records were excluded.');
    if(excluded)issue('Non-object records were excluded.');
    if (malformed || excluded) warn([malformed ? malformed + ' malformed JSONL record(s)' : '', excluded ? excluded + ' non-object record(s)' : ''].filter(Boolean).join('; ') + ' excluded');
    records = valid;
    for(const record of records) {
      const source=record.message||record.payload||record;
      const calls=(Array.isArray(source.content)?source.content:[]).filter(block=>block?.type==='tool_use');
      if(source.type==='function_call'&&typeof source.arguments==='string'){try{source.arguments=JSON.parse(source.arguments);}catch{}}
      for(const call of calls)if(typeof call.input==='string'){try{call.input=JSON.parse(call.input);}catch{}}
    }
    records=redactDeep(records);
    let repo=null,session='file-'+contentId,recordedSession=null;
    let agent = /claude/i.test(file)?'claude': /codex/i.test(file)?'codex': /kimi/i.test(file)?'kimi':'unknown';
    const tools = [];
    function finishSequence() {
      for(let width=3;width<=8;width++)for(let i=0;i<=tools.length-width;i++)addRepeat(sequences,tools.slice(i,i+width).join(' → '),repo,session,agent);
      tools.length=0;
    }
    for (const record of records) {
      const source = record.message || record.payload || record;
      const nextAgent=record.type==='session_meta'?'codex':agent;
      const cwd=miningField(record,source,['cwd']);
      let nextRepo=cwd?(miningValue(cwd.value)&&path.isAbsolute(cwd.value)?path.resolve(cwd.value):null):repo;
      const identity=miningField(record,source,['sessionId','session_id'])||(record.type==='session_meta'&&source&&Object.hasOwn(source,'id')?{value:source.id}:null);
      const nextIdentity=identity?(miningValue(identity.value)?identity.value:null):recordedSession;
      const nextSession=nextIdentity?'session-'+id(nextAgent+'\0'+nextIdentity):'file-'+contentId;
      // shortcut: overlapping exports without stable session/event IDs may repeat counts; add format-specific IDs if those exports need reliable deduplication.
      const eventId=!['session_meta','turn_context'].includes(record.type)?miningField(record,record,['uuid','id']):null;
      if(nextIdentity&&eventId&&miningValue(eventId.value)) {
        const eventKey=id(JSON.stringify([nextSession,record.type||source.type||source.role||'unknown',eventId.value]));
        if(events.has(eventKey)) {
          finishSequence();
          if(nextSession!==session||nextAgent!==agent)repo=null;
          session=nextSession;recordedSession=nextIdentity;agent=nextAgent;
          summary.duplicateRecords++;issue('Overlapping exports contained duplicate recorded event IDs; only the first selected occurrence was analyzed.');continue;
        }
        events.add(eventKey);
      }
      if(!cwd&&recordedSession!==null&&nextIdentity!==recordedSession)nextRepo=null;
      if(nextRepo!==repo||nextSession!==session||nextAgent!==agent)finishSequence();
      repo=nextRepo;session=nextSession;recordedSession=nextIdentity;agent=nextAgent;
      const text = messageText(record);
      const role = source.role || record.type;
      const blocks = Array.isArray(source.content)?source.content:[];
      if(blocks.some(block=>!block||typeof block!=='object'||Array.isArray(block)||(['text','input_text'].includes(block.type)&&typeof block.text!=='string')))issue('Invalid message content blocks were excluded.');
      const calls = blocks.filter(b=>b?.type==='tool_use');
      if(source.type==='function_call') calls.push({name:source.name,input:source.arguments});
      const hasText=typeof source==='string'||[source.content,source.text,source.message].some(value=>typeof value==='string')||blocks.some(block=>['text','input_text'].includes(block?.type)&&typeof block.text==='string');
      const supported=hasText&&(['user','assistant','tool'].includes(role)||['user_message','assistant_message','agent_message'].includes(source.type))||calls.length>0||blocks.some(block=>block?.type==='tool_result')||['function_call_output','tool_result'].includes(source.type)&&['output','content'].some(key=>Object.hasOwn(source,key));
      if(supported){summary.supportedRecords++;if(repo===null)summary.unattributedRecords++;}
      else if(!['session_meta','turn_context'].includes(record.type)){summary.unsupportedRecords++;issue('Unsupported transcript records or envelopes were excluded.');}
      if(role==='user'||source.type==='user_message')finishSequence();
      if ((role === 'user' || source.type === 'user_message') && text.trim().split(/\s+/).length > 2) {
        addRepeat(patterns,normalize(text),repo,session,agent,text.length,text);
        if (/\b(no|don'?t|stop|wrong|again|i said|revert|undo|not that)\b/i.test(text)) {
          const category = /revert|undo/i.test(text)?'revert requested':'possible correction';
          const key=JSON.stringify([repo,category]);
          const mistake = corrections.get(key)||{category,repo,occurrences:0,examples:[],sessions:new Set()};
          mistake.occurrences++; mistake.sessions.add(session); if(mistake.examples.length<5)mistake.examples.push(text.slice(0,180)); corrections.set(key,mistake);
        }
      }
      for(const call of calls) {
        const name = call.name || 'unknown'; tools.push(name);
        const input=call.input;
        const command = input?.command || input?.cmd;
        if(typeof command==='string')addRepeat(commands,normalize(command),repo,session,agent,command.length,command);
      }
      if(source.is_error || blocks.some(b=>b?.type==='tool_result' && b.is_error)) {
        const example=normalize(text).slice(0,180)||'tool reported an error';const key=JSON.stringify([repo,example]);const entry=failures.get(key)||{category:'repeated tool error',repo,occurrences:0,examples:[example],sessions:new Set()};entry.occurrences++;entry.sessions.add(session);failures.set(key,entry);
      }
    }
    finishSequence();
  }
  const candidates = [];
  for(const [kind,map] of [['prompt',patterns],['command',commands],['tool sequence',sequences]])for(const entry of map.values()) {
    if(entry.occurrences<3||entry.sessions.size<2)continue;
    candidates.push({id:id(kind+entry.pattern),kind,pattern:entry.pattern,...summarizeRepeat(entry),repos:[...entry.byRepo.keys()].filter(repo=>repo!==null),evidenceByRepo:Object.fromEntries([...entry.byRepo].filter(([repo])=>repo!==null).map(([repo,evidence])=>[repo,summarizeRepeat(evidence)])),scope:'needs review',proposal:kind==='command'?'Draft a parameterized script, validate inputs and test in a fixture repo.':'Review whether this belongs in a script, invoked skill or isolated agent. Pick global only if it applies across repositories.',status:'candidate'});
  }
  function* wordingEntries() {
    for(const entry of patterns.values())for(const [repo,evidence] of entry.byRepo)if(repo!==null)yield {repo,pattern:entry.pattern,evidence};
  }
  const wording=groupPromptWording(wordingEntries()),similar=[];
  for(const group of wording.groups) {
    const evidence=repeatEvidence();
    for(const member of group.members) {
      evidence.occurrences+=member.evidence.occurrences;evidence.characters+=member.evidence.characters;
      for(const session of member.evidence.sessions)evidence.sessions.add(session);
      for(const agent of member.evidence.agents)evidence.agents.add(agent);
      evidence.examples.push([...member.evidence.examples].sort()[0]||member.pattern.slice(0,180));
    }
    const variants=group.members.map(({pattern,evidence})=>({pattern,occurrences:evidence.occurrences,distinctSessions:evidence.sessions.size}));
    const local={...summarizeRepeat(evidence),sessions:[...evidence.sessions].sort(),agents:[...evidence.agents].sort(),estSaving:null,variants};
    similar.push({id:id(JSON.stringify(['similar prompts',group.repo,group.members.map(member=>member.pattern)])),kind:'similar prompts',matching:'local-tfidf-v1',pattern:group.members[0].pattern,...local,repos:[group.repo],evidenceByRepo:{[group.repo]:local},scope:'needs review',proposal:'Review these related wordings within this repository. Word overlap does not prove the same intent or a reusable workflow; measure benefit before adoption.',status:'candidate'});
  }
  const exact=candidates.sort((a,b)=>b.occurrences-a.occurrences).slice(0,100);
  similar.sort((a,b)=>b.occurrences-a.occurrences||(a.id<b.id?-1:a.id>b.id?1:0));
  const room=100-exact.length;
  if(similar.length>room)wording.coverage.limited=true;
  if(wording.coverage.limited)issue('Local wording comparison was limited; some wording patterns or groups were not reviewed.');
  const shortlist=[...exact,...similar.slice(0,room)].sort((a,b)=>b.occurrences-a.occurrences);
  if(summary.unattributedRecords)issue('Some supported events have no known working repository; their evidence is excluded from scoped candidates.');
  if(!summary.supportedRecords)issue('No supported transcript events were found.');
  return {at:new Date().toISOString(),files:paths.length,summary,coverage:{...summary,partial:issues.length>0,issues,wording:wording.coverage},candidates:shortlist,mistakes:[...corrections.values(),...[...failures.values()].filter(f=>f.occurrences>=2)].map(m=>({...m,sessions:[...m.sessions],evidence:'heuristic signal, requires review',existingRule:'not assessed'})),warnings};
}
export async function readJournal(directory) {
  const lessons=[],warnings=[];
  let count=0;
  async function walk(dir,depth=0) {
    if(depth>8){warnings.push('Journal depth limit reached');return;}
    const stat=await fs.lstat(dir);if(stat.isSymbolicLink()||forbidden(dir))throw new Error('Choose a non-secret journal directory without symlinks');
    const entries=await fs.readdir(dir,{withFileTypes:true});
    for(const entry of entries) {
      const file=path.join(dir,entry.name);if(entry.isSymbolicLink()||forbidden(file)||entry.name.startsWith('.'))continue;
      if(entry.isDirectory())await walk(file,depth+1);
      else if(entry.isFile()&&/\.md$/i.test(file)) {
        if(++count>400){warnings.push('Journal file limit reached');return;}
        let content;try{content=await safeText(file,['.md'],262144);}catch(error){warnings.push(path.basename(file)+': '+error.message);continue;}
        const lines=content.split('\n').filter(l=>/^(?:#{1,4} |[-*] )/.test(l));
        for(const line of lines.slice(0,40)) lessons.push({id:id(file+line),lesson:line.replace(/^(?:#+ |[-*] )/,'').slice(0,500),source:file,status:'not assessed',type:'journal excerpt',trust:'user intent',reason:'Encoding needs a reviewed comparison with effective agent configuration.'});
      }
    }
  }
  await walk(path.resolve(directory));
  return {at:new Date().toISOString(),files:count,lessons,warnings,coverage:null};
}
export function escapeHtml(text) {return String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
