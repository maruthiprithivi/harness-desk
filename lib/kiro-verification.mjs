import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
export function captureKiroVerification(stdout,{cwd,repo,input,started,finished,version,model=''}){
  let header,session,percentage=null,result,activity=false;
  for(const line of stdout.split('\n').filter(line=>line.trim())){
    let e;try{e=JSON.parse(line);}catch{throw new Error('Kiro returned malformed stream events.');}
    const d=e?.data;
    if(!d||typeof d!=='object')throw new Error('Kiro returned an unsupported stream format.');
    if(e.type==='runStarted'){
      if(header||d.payloadSchema!=='acp'||d.acpProtocolVersion!==1||!['v2','v3'].includes(d.engine))throw new Error('Kiro did not identify a supported fresh run.');header=d;
    }else{
      if(!header||result||typeof d.sessionId!=='string'||!/^[a-zA-Z0-9_-]{1,160}$/.test(d.sessionId)||session&&session!==d.sessionId)throw new Error('Kiro stream does not belong to one run.');session=d.sessionId;
      if(e.type==='metadata'&&Object.hasOwn(d,'contextUsagePercentage')){
        if(typeof d.contextUsagePercentage!=='number'||!Number.isFinite(d.contextUsagePercentage)||d.contextUsagePercentage<0||d.contextUsagePercentage>100)throw new Error('Kiro reported an invalid context percentage.');percentage=d.contextUsagePercentage;
      }else if(e.type==='sessionUpdate'){
        const kind=d.update?.sessionUpdate;
        if(!['agent_message_chunk','agent_thought_chunk','user_message_chunk','available_commands_update','current_mode_update','config_option_update','usage_update'].includes(kind))activity=true;
      }else if(e.type==='runFinished'){
        if(d.status!=='success'||d.stopReason!=='end_turn'||d.finalTextTruncated!==false||typeof d.finalText!=='string'||!d.finalText.trim())throw new Error('Kiro did not complete the bounded response check.');result=d;
      }else if(e.type!=='metadata')activity=true;
    }
  }
  if(!header||!session||!result||percentage===null)throw new Error('Kiro did not report a completed response and context percentage.');
  return {measurement:{agent:'kiro',repo,launchDirectory:cwd,sessionId:hash('kiro:'+session),promptHash:hash(input),model:model||null,agentVersion:version,inputTokens:null,outputTokens:null,contextPercentage:percentage,capacity:null,measuredAt:new Date(finished).toISOString(),method:'kiro-reported-context-percentage',limitations:'Harness-reported context percentage after the response, not first-request input or startup occupancy. Token counts and category costs are unavailable. Model is the explicit launch selection when supplied, not observed model attribution.'},answer:result.finalText,toolActivity:activity,
    launch:{profile:'kiro-untrusted-tools-percentage-v1-'+header.engine,agent:'kiro',launchDirectory:cwd,model:model||null,agentVersion:version,sandbox:'none',approvalPolicy:'trust-no-tools',configuration:'normal configuration; no tools trusted by the launch flag',startedAt:new Date(started).toISOString()}};
}
