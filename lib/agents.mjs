import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { redact } from './analysis.mjs';

export const agentDefinitions = [
  {id:'codex',name:'Codex',commands:['codex']},
  {id:'claude',name:'Claude Code',commands:['claude']},
  {id:'kimi',name:'Kimi Code',commands:['kimi','kimi-cli']},
  {id:'kiro',name:'Kiro',commands:['kiro-cli','kiro']},
  {id:'opencode',name:'OpenCode',commands:['opencode']},
  {id:'omp',name:'Oh My Pi',commands:['omp']},
  {id:'pi',name:'Pi',commands:['pi']},
  {id:'orca',name:'Orca',commands:['orca']}
];
export async function findExecutable(names, environment = process.env, platform = process.platform) {
  for (const name of names) for (const dir of (environment.PATH || environment.Path || '').split(platform === 'win32'?';':path.delimiter)) {
    for (const ext of platform === 'win32'?['.exe','.cmd','']:['']) {
      const file=path.resolve(dir,name+ext);
      try {
        const stat=await fs.stat(file);
        if(!stat.isFile())continue;
        await fs.access(file,platform==='win32'?fs.constants.F_OK:fs.constants.X_OK);
        if(platform==='win32'&&ext==='.cmd'&&['codex','claude'].includes(name)) {
          const script=name==='codex'?path.join(dir,'node_modules','@openai','codex','bin','codex.js'):path.join(dir,'node_modules','@anthropic-ai','claude-code','cli.js');
          try { if((await fs.stat(script)).isFile())return {command:process.execPath,prefix:[script]}; }catch{}
          return {command:file,prefix:[],shim:true};
        }
        return {command:file,prefix:[],shim:ext==='.cmd'};
      }catch{}
    }
  }
  return null;
}
export function runProcess(executable,args,input='',{timeout=15000,signal,cwd}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(executable.command,[...executable.prefix,...args],{shell:false,windowsHide:true,stdio:['pipe','pipe','pipe'],signal,cwd});
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    let stdout='',stderr='',overflow=false,timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;child.kill();hardStop();},timeout);
    let hardTimer;
    const hardStop=()=>{clearTimeout(hardTimer);hardTimer=setTimeout(()=>child.kill('SIGKILL'),2000);hardTimer.unref();};
    function cleanup(){clearTimeout(timer);clearTimeout(hardTimer);signal?.removeEventListener('abort',hardStop);}
    child.on('error',error=>{
      if(signal?.aborted){clearTimeout(timer);hardStop();reject(new Error('Agent request cancelled.'));}
      else {cleanup();reject(error);}
    });
    child.stdout.on('data',chunk=>{if(overflow)return;stdout+=chunk;if(stdout.length>2000000){overflow=true;child.kill();hardStop();}});
    child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-8000);});
    child.stdin.on('error',()=>{});
    child.on('close',code=>{
      cleanup();
      if(signal?.aborted)reject(new Error('Agent request cancelled.'));
      else if(timedOut)reject(new Error('Agent timed out. No automatic retry was sent.'));
      else if(overflow)reject(new Error('Agent response exceeded the output limit'));
      else resolve({code,stdout,stderr:redact(stderr)});
    });
    signal?.addEventListener('abort',hardStop,{once:true});
    child.stdin.end(input);
  });
}
const CLAUDE_ISOLATION_FLAGS = ['--print','--safe-mode','--setting-sources','--settings','--strict-mcp-config','--mcp-config','--tools','--permission-mode','--permission-prompts','--no-session-persistence','--no-chrome','--output-format','--model'];
export function supportsClaudeAdvisory(help) {return CLAUDE_ISOLATION_FLAGS.every(flag=>help.includes(flag));}
export function claudeAuthentication(stdout,code,stderr='') {
  let status;try{status=JSON.parse(stdout);}catch{return {auth:'unknown',authEvidence:'Claude auth status returned unsupported output, exit '+code+'.'};}
  const blocked=/keychain|EPERM|EACCES|access denied|permission denied/i.test(stderr);
  const auth=!blocked&&status?.loggedIn===true&&code===0?'signed-in':!blocked&&status?.loggedIn===false?'signed-out':'unknown';
  const evidence=['claude auth status, exit '+code,'reported loggedIn='+String(typeof status?.loggedIn==='boolean'?status.loggedIn:'unknown')];
  if(['claude.ai','api_key','apiKey','none'].includes(status?.authMethod))evidence.push('authMethod='+status.authMethod);
  if(['firstParty','bedrock','vertex','foundry'].includes(status?.apiProvider))evidence.push('provider='+status.apiProvider);
  if(['free','pro','max','team','enterprise'].includes(status?.subscriptionType))evidence.push('subscription='+status.subscriptionType);
  if(blocked)evidence.push('auth access was blocked; check sidecar keychain access');
  return {auth,authEvidence:evidence.join('; ')};
}
export async function probeAgents() {
  return Promise.all(agentDefinitions.map(async agent=>{
    const executable=await findExecutable(agent.commands);
    const result={id:agent.id,name:agent.name,installed:!!executable,auth:'unknown',authEvidence:'No supported authentication probe. Credential files are not inspected.',dispatch:agent.id==='codex'&&executable?'direct':'handoff',version:''};
    if(!executable){result.authEvidence="CLI not found on the sidecar PATH";return result;}
    if(executable.shim){result.dispatch="handoff";result.authEvidence="Windows CLI shim has no verified Node entry; use a handoff.";return result;}
    if(agent.id==='codex')try {
      const login=await runProcess(executable,['login','status']);
      const output=login.stdout+'\n'+login.stderr;
      result.auth=login.code===0&&/logged in|authenticated/i.test(output)?'signed-in':/not logged|logged out|sign in|login required/i.test(output)?'signed-out':'unknown';
      result.authEvidence='codex login status, exit '+login.code+' at '+new Date().toISOString();
      const version=await runProcess(executable,['--version']);result.version=redact(version.stdout.trim()).slice(0,100);
    }catch(error){result.authEvidence=redact(error.message);}
    if(agent.id==='claude')try {
      const help=await runProcess(executable,['--help']);
      if(help.code!==0||!supportsClaudeAdvisory(help.stdout)) {
        result.authEvidence='Installed Claude CLI does not advertise the required advisory isolation flags. Direct dispatch awaits explicit provider consent. Use a handoff.';
        return result;
      }
      const login=await runProcess(executable,['--safe-mode','--setting-sources','','--settings','{}','auth','status','--json']);
      Object.assign(result,claudeAuthentication(login.stdout,login.code,login.stderr));
      result.authEvidence+="; Direct dispatch awaits explicit provider consent; advisory safe mode retains admin-managed policy settings at "+new Date().toISOString();
      const version=await runProcess(executable,['--version']);result.version=redact(version.stdout.trim()).slice(0,100);
    }catch(error){result.auth='unknown';result.authEvidence='Claude probe failed: '+redact(error.message)+'; Direct dispatch awaits explicit provider consent.';}
    return result;
  }));
}
export function codexArguments(model,cwd) {
  const args=['exec','--ignore-user-config','--ignore-rules','--ephemeral','--skip-git-repo-check','--sandbox','read-only','--json','--color','never','-C',cwd,'-c','project_doc_max_bytes=0','-c','web_search="disabled"'];
  for(const flag of ['shell_tool','unified_exec','hooks','plugins','apps','browser_use','browser_use_external','computer_use','skill_search','skill_mcp_dependency_install','multi_agent_v2'])args.push('--disable',flag);
  if(model)args.push('--model',model);
  args.push('-');return args;
}
export async function dispatchCodex({prompt,model,cwd,signal}) {
  const executable=await findExecutable(['codex']);
  if(!executable||executable.shim)throw new Error('Codex is not available. Probe agents or use a handoff.');
  const result=await runProcess(executable,codexArguments(model,cwd),prompt,{timeout:180000,signal});
  if(result.code!==0)throw new Error('Codex exited '+result.code+'. '+result.stderr.slice(-600));
  let answer='';
  for(const line of result.stdout.split('\n')) {
    let event;try{event=JSON.parse(line);}catch{continue;}
    if(event.type==='item.completed'&&event.item?.type==='agent_message')answer=event.item.text;
    if(event.type==='turn.failed'||event.type==='error')throw new Error(redact(event.error?.message||event.message||'Agent request failed'));
  }
  if(!answer)throw new Error('No supported agent response found. CLI versions may differ; use a handoff.');
  return redact(answer);
}
export function claudeArguments(model) {
  const args=['--print','--safe-mode','--setting-sources','','--settings','{}','--strict-mcp-config','--mcp-config','{}','--tools','','--permission-mode','dontAsk','--permission-prompts','none','--no-session-persistence','--no-chrome','--output-format','json'];
  if(model)args.push('--model',model);
  return args;
}
export function claudeResponse(stdout) {
  let event;try{event=JSON.parse(stdout);}catch{throw new Error('Claude returned unsupported JSON. Use a handoff.');}
  if(event?.type!=='result')throw new Error('No supported Claude advisory result found. Use a handoff.');
  if(event.is_error||event.subtype!=='success')throw new Error('Claude advisory request failed. '+redact(String(event.result||'No successful result returned.')).slice(0,600));
  if(typeof event.result!=='string'||!event.result.trim())throw new Error('Claude returned an empty advisory result.');
  return redact(event.result);
}
export async function dispatchClaude({prompt,model,cwd,signal}) {
  if(typeof cwd!=='string'||!path.isAbsolute(cwd))throw new Error('An isolated advisory working directory is required.');
  const executable=await findExecutable(['claude']);
  if(!executable||executable.shim)throw new Error('Claude Code is not available. Probe agents or use a handoff.');
  const result=await runProcess(executable,claudeArguments(model),prompt,{timeout:180000,signal,cwd});
  if(result.code!==0)throw new Error('Claude exited '+result.code+'. '+result.stderr.slice(-600));
  return claudeResponse(result.stdout);
}
export function dispatchAgent(request) {
  if(request.agent==='codex')return dispatchCodex(request);
  if(request.agent==='claude')return dispatchClaude(request);
  throw new Error('This agent requires a handoff.');
}
