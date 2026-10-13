import path from 'node:path';
import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
const count=value=>Number.isSafeInteger(value)&&value>=0&&value<=1e9;
const label=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._:/+-]{0,159}$/.test(value);
export function openCodeSession(stdout){
  let session,finished=false,stepCount=0;
  for(const line of stdout.split('\n').filter(line=>line.trim())){
    let event;try{event=JSON.parse(line);}catch{throw new Error('OpenCode returned malformed run events.');}
    if(event.type==='error')throw new Error('OpenCode reported an unsuccessful run. Check its configured provider and account.');
    if(!/^ses_[A-Za-z0-9]+$/.test(event.sessionID||'')||session&&session!==event.sessionID)throw new Error('OpenCode did not identify one verification session.');
    session=event.sessionID;
    if(event.type==='step_start')stepCount++;
    if(event.type==='step_finish'){if(finished||event.part?.reason!=='stop')throw new Error('OpenCode did not complete one bounded response.');finished=true;}
    if(event.type==='tool_use')throw new Error('OpenCode attempted a tool call; this no-tools verification did not pass.');
  }
  if(!session||!finished||stepCount!==1)throw new Error('OpenCode did not emit a complete first-request event sequence.');
  return session;
}
export function captureOpenCodeVerification(source,{session,cwd,repo,input,started,finished,version}){
  let data;try{data=JSON.parse(source);}catch{throw new Error('OpenCode returned an invalid session export.');}
  const info=data?.info,rows=data?.messages;
  const fresh=value=>Number.isSafeInteger(value)&&value>=started-2000&&value<=finished+2000;
  if(info?.id!==session||info.parentID!=null||info.revert!=null||typeof info.directory!=='string'||path.normalize(info.directory)!==cwd||!fresh(info.time?.created)||!Array.isArray(rows)||rows.length!==2)throw new Error('OpenCode export is not the fresh verification session.');
  const [user,assistant]=rows;
  if(user.info?.role!=='user'||assistant.info?.role!=='assistant'||!label(user.info.id)||assistant.info.parentID!==user.info.id||user.info.sessionID!==session||assistant.info.sessionID!==session||!fresh(user.info.time?.created)||!Array.isArray(user.parts)||user.parts.length!==1||user.parts[0].type!=='text'||user.parts[0].text!==input)throw new Error('OpenCode export does not match the submitted verification task.');
  const meta=assistant.info,parts=assistant.parts;
  if(meta.error||meta.finish!=='stop'||!label(meta.modelID)||!label(meta.providerID)||!fresh(meta.time?.completed)||!Array.isArray(parts)||parts.some(part=>!['text','reasoning','step-start','step-finish'].includes(part.type)))throw new Error('OpenCode response is incomplete or includes unsupported activity.');
  const steps=parts.filter(part=>part.type==='step-finish'),usage=steps[0]?.tokens;
  if(steps.length!==1||parts.filter(part=>part.type==='step-start').length!==1||steps[0].reason!=='stop'||!usage||![usage.input,usage.output,usage.reasoning,usage.cache?.read,usage.cache?.write].every(count))throw new Error('OpenCode first-step token counters are missing or invalid.');
  const inputTokens=usage.input+usage.cache.read+usage.cache.write,outputTokens=usage.output+usage.reasoning;
  const answer=parts.filter(part=>part.type==='text').map(part=>typeof part.text==='string'?part.text:'').join('');
  if(!count(inputTokens)||inputTokens===0||!count(outputTokens)||!answer.trim())throw new Error('OpenCode returned no usable first-response reading.');
  const model=meta.providerID+'/'+meta.modelID;
  return {measurement:{agent:'opencode',repo,launchDirectory:cwd,sessionId:hash('opencode:'+session),promptHash:hash(input),model,agentVersion:version,inputTokens,outputTokens,capacity:null,measuredAt:new Date(meta.time.completed).toISOString(),method:'opencode-first-request-input',limitations:'First completed step input including cache and the verification task. Captured from this run’s exact session export; no category or individual-file attribution.'},answer,toolActivity:false,
    launch:{profile:'opencode-private-verification-v1',agent:'opencode',launchDirectory:cwd,model,agentVersion:version,sandbox:'none',approvalPolicy:'agent-default',configuration:'normal configuration; session sharing disabled',startedAt:new Date(started).toISOString()}};
}
