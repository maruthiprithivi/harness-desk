import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { claudeArguments, claudeAuthentication, claudeResponse, dispatchClaude, findExecutable, probeAgents, runProcess, supportsClaudeAdvisory } from '../lib/agents.mjs';

async function fixture(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'harness-agent-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  return dir;
}

test('Claude advisory arguments disable inherited customizations and tools while preserving subscription auth',()=>{
  const args=claudeArguments('selected-model');
  const value=flag=>args[args.indexOf(flag)+1];
  assert.ok(args.includes('--safe-mode'));
  assert.ok(args.includes('--no-session-persistence'));
  assert.ok(args.includes('--strict-mcp-config'));
  assert.equal(value('--setting-sources'),'');
  assert.equal(value('--settings'),'{}');
  assert.equal(value('--mcp-config'),'{}');
  assert.equal(value('--tools'),'');
  assert.equal(value('--permission-prompts'),'none');
  assert.equal(value('--permission-mode'),'dontAsk');
  assert.equal(value('--output-format'),'json');
  assert.equal(value('--model'),'selected-model');
  assert.equal(args.includes('--bare'),false);
  assert.equal(args.includes('--dangerously-skip-permissions'),false);
  assert.equal(claudeArguments('').includes('--model'),false);
  assert.equal(claudeArguments().includes('--model'),false);
  assert.equal(supportsClaudeAdvisory(args.join(' ')),true);
  assert.equal(supportsClaudeAdvisory(args.filter(arg=>arg!=='--safe-mode').join(' ')),false);
});

test('Claude auth evidence only exposes approved status fields and preserves unknown on access failure',()=>{
  const raw=JSON.stringify({loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',subscriptionType:'max',email:'private@example.invalid',accessToken:'do-not-copy',unexpected:'do-not-copy'});
  const result=claudeAuthentication(raw,0);
  assert.equal(result.auth,'signed-in');
  assert.match(result.authEvidence,/authMethod=claude.ai/);
  assert.match(result.authEvidence,/subscription=max/);
  assert.equal(JSON.stringify(result).includes('private@'),false);
  assert.equal(JSON.stringify(result).includes('do-not-copy'),false);
  assert.equal(claudeAuthentication('{"loggedIn":false,"authMethod":"none"}',1).auth,'signed-out');
  assert.equal(claudeAuthentication(raw,0,'EPERM reading keychain').auth,'unknown');
  assert.equal(claudeAuthentication('invalid output with password=hidden',1).auth,'unknown');
  assert.equal(claudeAuthentication(raw,1).auth,'unknown');
});

test('Claude JSON result parsing rejects incomplete or failed requests and redacts response secrets',()=>{
  const result=claudeResponse(JSON.stringify({type:'result',subtype:'success',is_error:false,result:'Review this setting. password=hidden'}));
  assert.equal(result.includes('hidden'),false);
  assert.throws(()=>claudeResponse('not JSON'),/unsupported JSON/);
  assert.throws(()=>claudeResponse('{"type":"assistant","result":"not final"}'),/No supported/);
  assert.throws(()=>claudeResponse('{"type":"result","subtype":"error_max_turns","is_error":true,"result":"incomplete"}'),/request failed/);
  assert.throws(()=>claudeResponse('{"type":"result","subtype":"success","result":""}'),/empty/);
});

test('Windows Claude npm shim resolves a Node entry without executing cmd.exe',async t=>{
  const dir=await fixture(t);
  await fs.writeFile(path.join(dir,'claude.cmd'),'untrusted shim body is not executed');
  const script=path.join(dir,'node_modules','@anthropic-ai','claude-code','cli.js');
  await fs.mkdir(path.dirname(script),{recursive:true});await fs.writeFile(script,'');
  const executable=await findExecutable(['claude'],{PATH:dir},'win32');
  assert.equal(executable.command,process.execPath);
  assert.deepEqual(executable.prefix,[script]);
});

test('Claude dispatch uses the generated cwd and supplied prompt through a synthetic CLI',async t=>{
  const dir=await fixture(t);
  const cwd=path.join(dir,'isolated-job');await fs.mkdir(cwd);
  const script='let input="";process.stdin.setEncoding("utf8");process.stdin.on("data",chunk=>input+=chunk);process.stdin.on("end",()=>console.log(JSON.stringify({type:"result",subtype:"success",is_error:false,result:JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2),input})})));';
  if(process.platform==='win32') {
    await fs.writeFile(path.join(dir,'claude.cmd'),'ignored');
    const entry=path.join(dir,'node_modules','@anthropic-ai','claude-code','cli.js');
    await fs.mkdir(path.dirname(entry),{recursive:true});await fs.writeFile(entry,script);
  } else await fs.writeFile(path.join(dir,'claude'),'#!'+process.execPath+'\n'+script,{mode:0o700});
  const previousPath=process.env.PATH;
  process.env.PATH=dir+path.delimiter+previousPath;
  try {
    const result=JSON.parse(await dispatchClaude({prompt:'Only supplied inventory',model:'chosen-model',cwd}));
    assert.equal(result.cwd,cwd);
    assert.equal(result.input,'Only supplied inventory');
    assert.equal(result.args[result.args.indexOf('--model')+1],'chosen-model');
    assert.equal(result.args[result.args.indexOf('--tools')+1],'');
  } finally {process.env.PATH=previousPath;}
});

test('the bounded process runner supports cwd and cancellation',async t=>{
  const cwd=await fixture(t);
  const executable={command:process.execPath,prefix:[]};
  const result=await runProcess(executable,['-e','console.log(process.cwd())'],'',{cwd});
  assert.equal(result.stdout.trim(),cwd);
  const controller=new AbortController();
  const pending=runProcess(executable,['-e','setInterval(()=>{},1000)'],'',{cwd,signal:controller.signal,timeout:5000});
  controller.abort();
  await assert.rejects(pending,/cancelled/);
});

test('Claude probe uses synthetic status output and keeps unsupported CLI versions in handoff mode',async t=>{
  const dir=await fixture(t);
  const help=JSON.stringify(claudeArguments('supported-model').join(' '));
  const script='const args=process.argv.slice(2);if(args.includes("--help"))console.log('+help+');else if(args.includes("status"))console.log(JSON.stringify({loggedIn:true,authMethod:"claude.ai",subscriptionType:"max",email:"private@example.invalid",token:"do-not-copy"}));else if(args.includes("--version"))console.log("synthetic-claude");else process.exit(2);';
  let entry;
  if(process.platform==='win32') {
    await fs.writeFile(path.join(dir,'claude.cmd'),'ignored');
    entry=path.join(dir,'node_modules','@anthropic-ai','claude-code','cli.js');
    await fs.mkdir(path.dirname(entry),{recursive:true});await fs.writeFile(entry,script);
  } else {entry=path.join(dir,'claude');await fs.writeFile(entry,'#!'+process.execPath+'\n'+script,{mode:0o700});}
  const previousPath=process.env.PATH;
  process.env.PATH=dir;
  try {
    const result=(await probeAgents()).find(agent=>agent.id==='claude');
    assert.equal(result.installed,true);
    assert.equal(result.auth,'signed-in');
    assert.equal(result.dispatch,'handoff');
    assert.match(result.authEvidence,/Direct dispatch awaits explicit provider consent/);
    assert.equal(result.version,'synthetic-claude');
    assert.match(result.authEvidence,/admin-managed policy/);
    assert.equal(JSON.stringify(result).includes('private@'),false);
    assert.equal(JSON.stringify(result).includes('do-not-copy'),false);
    await fs.writeFile(entry,(process.platform==='win32'?'':'#!'+process.execPath+'\n')+'console.log("unsupported old CLI")');
    const unsupported=(await probeAgents()).find(agent=>agent.id==='claude');
    assert.equal(unsupported.auth,'unknown');
    assert.equal(unsupported.dispatch,'handoff');
  } finally {if(previousPath===undefined)delete process.env.PATH;else process.env.PATH=previousPath;}
});
