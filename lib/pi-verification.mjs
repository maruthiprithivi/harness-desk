import path from 'node:path';
import { createHash } from 'node:crypto';

const hash=value=>createHash('sha256').update(value).digest('hex');
const count=value=>Number.isSafeInteger(value)&&value>=0&&value<=1e9;
const label=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._:/+-]{0,159}$/.test(value);
const text=content=>typeof content==='string'?content:Array.isArray(content)&&content.every(part=>part.type==='text'&&typeof part.text==='string')?content.map(part=>part.text).join(''):null;

// Pi and OMP share message_end usage fields, but retain distinct launch profiles.
export function capturePiVerification(stdout,{agent,cwd,repo,input,started,finished,version}) {
  let header,user,assistant,ended=false,toolActivity=false;
  for(const line of stdout.split('\n').filter(line=>line.trim())){
    let event;try{event=JSON.parse(line);}catch{throw new Error('The agent returned malformed JSON events.');}
    if(!event||typeof event.type!=='string')throw new Error('Unsupported agent event.');
    if(event.type==='session'){
      const at=Date.parse(event.timestamp);
      if(header||user||assistant||event.version!==3||!label(event.id)||event.parentSession!=null||typeof event.cwd!=='string'||path.normalize(event.cwd)!==cwd||!Number.isFinite(at)||at<started-2000||at>finished+2000)throw new Error('The agent did not report one fresh session for this folder.');
      header=event;
    }
    if(/compaction|retry|branch_summary/.test(event.type))throw new Error('Retried or compacted requests cannot supply this first-request check.');
    if(event.type.startsWith('tool_execution_'))toolActivity=true;
    if(event.type==='message_end'){
      if(!header||ended)throw new Error('Messages do not belong to one fresh agent run.');
      const message=event.message;
      if(message?.role==='user'){
        if(user||assistant||text(message.content)!==input)throw new Error('The agent request does not match this verification task.');user=message;
      }else if(message?.role==='assistant'){
        const usage=message.usage;
        if(!user||assistant||!label(message.model)||!label(message.provider)||message.stopReason!=='stop'||!Array.isArray(message.content)||!usage||!['input','cacheRead','cacheWrite','output'].every(key=>count(usage[key])))throw new Error('A single completed first response with valid usage is required.');
        assistant=message;if(message.content.some(part=>part.type==='toolCall'))toolActivity=true;
      }else if(message?.role==='toolResult')toolActivity=true;
      else if(message?.role!=='system')throw new Error('An extension changed the verification conversation; no comparable reading was saved.');
    }
    if(event.type==='agent_end'){
      if(!assistant||ended||event.willRetry===true)throw new Error('The verification run did not finish normally.');ended=true;
    }
    if(event.type==='agent_settled'&&event.aborted!==false)throw new Error('The agent run was interrupted.');
  }
  if(!header||!user||!assistant||!ended||!label(version))throw new Error('Fresh session identity, first-response usage or completion is missing.');
  const inputTokens=assistant.usage.input+assistant.usage.cacheRead+assistant.usage.cacheWrite;
  const answer=assistant.content.filter(part=>part.type==='text'&&typeof part.text==='string').map(part=>part.text).join('');
  if(!count(inputTokens)||inputTokens===0||!answer.trim())throw new Error('The agent did not report usable input tokens and an answer.');
  const model=assistant.provider+'/'+assistant.model;
  return {measurement:{agent,repo,launchDirectory:cwd,sessionId:hash(agent+':'+header.id),promptHash:hash(input),model,agentVersion:version,inputTokens,outputTokens:assistant.usage.output,capacity:null,measuredAt:new Date(finished).toISOString(),method:agent+'-first-request-input',limitations:'First completed response input, including cache input and the task prompt. Not pure startup context or exact file attribution. Extensions and startup behavior are not independently audited.'},answer,toolActivity,
    launch:{profile:agent+'-fresh-json-verification-v1',agent,launchDirectory:cwd,model,agentVersion:version,sandbox:'none',approvalPolicy:agent==='omp'?'always-ask':'agent-default',configuration:'normal configuration; ephemeral session',startedAt:new Date(started).toISOString()}};
}
