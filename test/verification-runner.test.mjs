import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { runVerification } from '../lib/verification-runner.mjs';

const thread = '12345678-1234-4234-8234-123456789012';
const emitJSON = (child, value) => child.stdout.emit('data', JSON.stringify(value) + '\n');
function processDouble() {
  const child = new EventEmitter(); child.pid = 4321;
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
  child.stdout.setEncoding = child.stderr.setEncoding = () => {};
  child.kill = () => { queueMicrotask(() => child.emit('close', null)); return true; };
  return child;
}
async function fixture(t, options = {}) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-runner-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const repo = path.join(home, 'project'); await fs.mkdir(repo);
  const started = Date.now(), at = new Date(started).toISOString();
  const codexHome = path.join(home, options.customHome ? 'custom-codex' : '.codex');
  const logDirectory = path.join(codexHome, 'sessions', at.slice(0, 10).replaceAll('-', path.sep));
  await fs.mkdir(logDirectory, { recursive: true });
  const calls = [], kills = [], progress = [], environment = options.customHome ? { CODEX_HOME: codexHome } : {};
  let child, capturedInput;
  async function writeLog(input, customize = options.customizeLog) {
    const records = [
      { type: 'session_meta', timestamp: at, payload: { id: thread, session_id: thread, cwd: repo, cli_version: '0.162.1' } },
      { type: 'turn_context', timestamp: at, payload: { turn_id: 'turn-one', cwd: repo, model: 'model-one' } },
      { type: 'event_msg', timestamp: at, payload: { type: 'user_message', message: input } },
      { type: 'token_usage_record', timestamp: at, payload: { thread_id: thread, session_id: thread, turn_id: 'turn-one', root_turn_id: 'turn-one', response_id: 'response-one', usage: { input_tokens: 100, output_tokens: 12, total_tokens: 112 } } }
    ];
    if (customize) customize(records);
    const file = path.join(logDirectory, 'rollout-' + at.slice(0, 19).replaceAll(':', '-') + '-' + thread + '.jsonl');
    await fs.writeFile(file, records.map(record => JSON.stringify(record)).join('\n'));
    return file;
  }
  const deps = {
    environment, platform: options.platform || 'linux', now: () => started,
    findExecutable: async () => ({ command: '/fixture/codex', prefix: [] }),
    spawn(command, args, config) {
      calls.push({ command, args, config });
      const current = processDouble();
      if (/taskkill\.exe$/.test(command)) { queueMicrotask(() => { child.emit('close', null); current.emit('close', 0); }); return current; }
      child = current;
      current.stdin.end = input => {
        capturedInput = input;
        queueMicrotask(async () => {
          try {
            if (options.behavior) { await options.behavior(current, input, writeLog); return; }
            await writeLog(input);
            emitJSON(current, { type: 'thread.started', thread_id: thread });
            emitJSON(current, { type: 'item.completed', item: { type: 'agent_message', text: options.answer || 'Fixture check passed' } });
            emitJSON(current, { type: 'turn.completed', usage: { input_tokens: 999999 } });
            current.emit('close', 0);
          } catch (error) { current.emit('error', error); }
        });
      };
      return current;
    },
    kill(pid, signal) { kills.push({ pid, signal }); child.emit('close', null); },
    ...(options.timeout ? { timeout: options.timeout } : {})
  };
  const request = { agent: 'codex', repo, launchDirectory: repo, home, prompt: 'Report the fixture check.', expectedText: 'Fixture check passed', onProgress: text => progress.push(text) };
  return { home, repo, deps, request, calls, kills, progress, logDirectory, writeLog, get input() { return capturedInput; }, get child() { return child; } };
}

test('fresh Codex verification retains normal configuration and captures only its exact session automatically', async t => {
  const f = await fixture(t), result = await runVerification(f.request, f.deps);
  assert.equal(result.measurement.inputTokens, 100); assert.equal(result.measurement.capacity, null);
  assert.equal(result.check.status, 'passed'); assert.match(result.check.description, /Literal expected text/);
  assert.equal(result.answer, 'Fixture check passed'); assert.match(result.measurement.launchFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(result.launch.configuration, 'normal global and project configuration');
  const call = f.calls[0]; assert.equal(call.config.shell, false); assert.equal(call.config.detached, true); assert.equal(call.config.cwd, f.repo);
  assert.deepEqual(call.args, ['exec', '--json', '--sandbox', 'read-only', '-c', 'approval_policy="never"', '-C', f.repo, '--skip-git-repo-check', '--color', 'never', '-']);
  assert.doesNotMatch(JSON.stringify(call.args), /ignore-user-config|ignore-rules|ephemeral|project_doc_max_bytes/);
  assert.match(f.input, /Do not use tools/); assert.ok(f.input.endsWith(f.request.prompt)); assert.equal(f.progress.length, 2);
  assert.doesNotMatch(JSON.stringify(result), /rollout-|response-one|999999|Report the fixture/);
});

test('CODEX_HOME, explicit model and deterministic managed profile are retained', async t => {
  const f = await fixture(t, { customHome: true });
  f.deps.environment.CODEX_SESSION_ID = 'inherited-session'; f.deps.environment.CODEX_THREAD_ID = 'inherited-thread';
  const first = await runVerification({ ...f.request, model: 'model-one' }, f.deps);
  const second = await runVerification({ ...f.request, model: 'model-one' }, f.deps);
  assert.equal(first.measurement.launchFingerprint, second.measurement.launchFingerprint);
  assert.ok(f.calls[0].args.includes('--model')); assert.equal(f.calls[0].config.env.CODEX_HOME, path.join(f.home, 'custom-codex'));
  assert.equal(f.calls[0].config.env.CODEX_SESSION_ID, undefined); assert.equal(f.calls[0].config.env.CODEX_THREAD_ID, undefined);
  assert.equal(f.deps.environment.CODEX_SESSION_ID, 'inherited-session');
});

test('literal check can fail or remain unconfigured and answer is redacted and bounded', async t => {
  const f = await fixture(t, { answer: 'password=private-value\n' + 'x'.repeat(3000) });
  const failed = await runVerification(f.request, f.deps); assert.equal(failed.check.status, 'failed');
  assert.ok(failed.answer.length <= 2000); assert.doesNotMatch(failed.answer, /private-value/); assert.match(failed.answer, /REDACTED/);
  const unset = await runVerification({ ...f.request, expectedText: '' }, f.deps); assert.equal(unset.check.status, 'not-configured');
});

test('invalid scope, prompt, model and unsupported agents do not launch processes', async t => {
  const f = await fixture(t);
  for (const fields of [{ agent: 'unsupported' }, { launchDirectory: path.join(f.home, 'outside') }, { prompt: '' }, { prompt: 'x'.repeat(4001) }, { expectedText: '  ' }, { model: 'model; bad' }, { home: 'relative' }]) {
    await assert.rejects(runVerification({ ...f.request, ...fields }, f.deps));
  }
  assert.equal(f.calls.length, 0);
  await assert.rejects(runVerification(f.request, { ...f.deps, findExecutable: async () => ({ command: 'codex.cmd', shim: true }) }), /directly executable/);
  assert.equal(f.calls.length, 0);
});

test('Claude starts a UUID-pinned fresh session and captures its stream without reading logs',async t=>{
  const f=await fixture(t,{behavior:child=>{
    emitJSON(child,{type:'system',subtype:'init',session_id:thread,cwd:f.repo,claude_code_version:'2.1.296',model:'fixture-model'});
    emitJSON(child,{type:'assistant',session_id:thread,message:{id:'msg_one',role:'assistant',model:'fixture-model',content:[{type:'text',text:'Fixture check passed'}],usage:{input_tokens:10,cache_read_input_tokens:20,cache_creation_input_tokens:30,output_tokens:4}}});
    emitJSON(child,{type:'result',session_id:thread,subtype:'success',is_error:false,num_turns:1,result:'Fixture check passed',usage:{input_tokens:99999}});child.emit('close',0);
  }});
  f.deps.environment.CLAUDECODE='1';f.deps.environment.CLAUDE_CODE_SESSION_ID='inherited';
  const result=await runVerification({...f.request,agent:'claude'}, {...f.deps,randomUUID:()=>thread,safeText:()=>{assert.fail('Claude must not read session files');}});
  assert.equal(result.measurement.inputTokens,60);assert.equal(result.check.status,'passed');assert.equal(result.launch.sandbox,'none');
  assert.deepEqual(f.calls[0].args,['--print','--verbose','--output-format','stream-json','--session-id',thread,'--permission-mode','dontAsk','--permission-prompts','none','--max-turns','1']);
  assert.equal(f.calls[0].config.env.CLAUDECODE,undefined);assert.equal(f.calls[0].config.env.CLAUDE_CODE_SESSION_ID,undefined);
  assert.doesNotMatch(JSON.stringify(f.calls[0].args),/--bare|--safe-mode|--resume|--continue|--tools/);
});

test('Claude usage-limit failures are actionable and do not leak raw output or retry',async t=>{
  const f=await fixture(t,{behavior:child=>{emitJSON(child,{type:'result',is_error:true,result:"You've hit your weekly limit PRIVATE"});child.emit('close',1);}});
  await assert.rejects(runVerification({...f.request,agent:'claude'},f.deps),error=>/usage limit/.test(error.message)&&!/PRIVATE/.test(error.message));assert.equal(f.calls.length,1);
});

test('provider failures and malformed or incomplete events expose no raw provider output', async t => {
  for (const behavior of [
    child => { child.stderr.emit('data', 'PRIVATE STDERR'); child.emit('close', 1); },
    child => { child.stdout.emit('data', 'PRIVATE INVALID JSON'); child.emit('close', 0); },
    child => { emitJSON(child, { type: 'error', message: 'PRIVATE FAILURE' }); child.emit('close', 0); },
    child => { emitJSON(child, { type: 'thread.started', thread_id: thread }); child.emit('close', 0); },
    child => { emitJSON(child, { type: 'thread.started', thread_id: thread }); emitJSON(child, { type: 'thread.started', thread_id: thread }); child.emit('close', 0); }
  ]) {
    const f = await fixture(t, { behavior });
    await assert.rejects(runVerification(f.request, f.deps), error => !/PRIVATE/.test(error.message));
  }
});

test('timeout and cancellation kill the POSIX process group without retrying', async t => {
  const timed = await fixture(t, { timeout: 10, behavior: () => {} });
  await assert.rejects(runVerification(timed.request, timed.deps), /timed out/);
  assert.deepEqual(timed.kills, [{ pid: -4321, signal: 'SIGKILL' }]); assert.equal(timed.calls.length, 1);
  const controller = new AbortController(), aborted = await fixture(t, { behavior: () => controller.abort() });
  await assert.rejects(runVerification({ ...aborted.request, signal: controller.signal }, aborted.deps), /cancelled/);
  assert.deepEqual(aborted.kills, [{ pid: -4321, signal: 'SIGKILL' }]);
  await assert.rejects(runVerification({ ...aborted.request, signal: controller.signal }, aborted.deps), /cancelled/);
  assert.equal(aborted.calls.length, 1);
});

test('output cap counts stdout and stderr bytes and terminates children', async t => {
  const f = await fixture(t, { behavior: child => { child.stdout.emit('data', 'x'.repeat(1024 * 1024)); child.stderr.emit('data', 'x'.repeat(1024 * 1024 + 1)); } });
  await assert.rejects(runVerification(f.request, f.deps), /output limit/); assert.equal(f.kills.length, 1);
});

test('Windows cancellation uses taskkill tree termination without a command shell', async t => {
  const controller = new AbortController(), f = await fixture(t, { platform: 'win32', behavior: () => controller.abort() });
  await assert.rejects(runVerification({ ...f.request, signal: controller.signal }, f.deps), /cancelled/);
  assert.equal(f.calls[0].config.detached, false); assert.equal(f.calls[1].config.shell, false);
  assert.deepEqual(f.calls[1].args, ['/PID', '4321', '/T', '/F']); assert.match(f.calls[1].command, /System32\\taskkill\.exe$/);
});

test('unrelated logs are never read and missing own log is an explicit capture failure', async t => {
  const f = await fixture(t, { behavior: child => {
    emitJSON(child, { type: 'thread.started', thread_id: thread }); emitJSON(child, { type: 'item.completed', item: { type: 'agent_message', text: 'Done' } }); emitJSON(child, { type: 'turn.completed' }); child.emit('close', 0);
  } });
  await fs.writeFile(path.join(f.logDirectory, 'rollout-2026-10-13T00-00-00-00000000-0000-4000-8000-000000000000.jsonl'), 'PRIVATE OTHER LOG');
  let reads = 0;
  await assert.rejects(runVerification(f.request, { ...f.deps, safeText: async () => { reads++; return ''; } }), /could not be located/);
  assert.equal(reads, 0);
});

test('captured prompt, session, directory and timestamps must belong to the launched request', async t => {
  for (const customizeLog of [
    records => { records[2].payload.message = 'Another prompt'; },
    records => { records[0].payload.id = 'another-session'; records[0].payload.session_id = 'another-session'; records[3].payload.thread_id = 'another-session'; records[3].payload.session_id = 'another-session'; },
    records => { records[0].payload.cwd += '/nested'; records[1].payload.cwd += '/nested'; },
    records => { records[3].timestamp = '2001-01-01T00:00:00.000Z'; }
  ]) {
    const f = await fixture(t, { customizeLog }); await assert.rejects(runVerification(f.request, f.deps), /does not match/);
  }
});

test('symlinked or duplicate own logs fail without reading targets', async t => {
  const f = await fixture(t, { behavior: async (child, input, writeLog) => {
    const file = await writeLog(input); await fs.rename(file, file + '.private'); await fs.symlink(file + '.private', file);
    emitJSON(child, { type: 'thread.started', thread_id: thread }); emitJSON(child, { type: 'item.completed', item: { type: 'agent_message', text: 'Done' } }); emitJSON(child, { type: 'turn.completed' }); child.emit('close', 0);
  } });
  await assert.rejects(runVerification(f.request, f.deps), /unsafe/);
  const duplicate = await fixture(t, { behavior: async (child, input, writeLog) => {
    const file = await writeLog(input); await fs.copyFile(file, path.join(path.dirname(file), 'rollout-2000-01-01T00-00-00-' + thread + '.jsonl'));
    emitJSON(child, { type: 'thread.started', thread_id: thread }); emitJSON(child, { type: 'item.completed', item: { type: 'agent_message', text: 'Done' } }); emitJSON(child, { type: 'turn.completed' }); child.emit('close', 0);
  } });
  await assert.rejects(runVerification(duplicate.request, duplicate.deps), /Multiple logs/);
});

test('observed tool or command activity fails the bounded check even with the expected answer', async t => {
  for (const type of ['command_execution', 'mcp_tool_call', 'web_search', 'file_change']) {
    const f = await fixture(t, { behavior: async (child, input, writeLog) => {
      await writeLog(input); emitJSON(child, { type: 'thread.started', thread_id: thread });
      emitJSON(child, { type: 'item.started', item: { type, command: 'PRIVATE COMMAND' } });
      emitJSON(child, { type: 'item.completed', item: { type: 'agent_message', text: 'Fixture check passed' } });
      emitJSON(child, { type: 'turn.completed' }); child.emit('close', 0);
    } });
    const result = await runVerification(f.request, f.deps); assert.equal(result.check.status, 'failed'); assert.match(result.check.description, /Tool or command/);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE COMMAND/);
  }
});

test('failed process-group termination is reported rather than claiming confirmed cancellation', async t => {
  const controller = new AbortController(), f = await fixture(t, { behavior: () => controller.abort() });
  await assert.rejects(runVerification({ ...f.request, signal: controller.signal }, { ...f.deps, kill: () => { const error = new Error('PRIVATE KILL ERROR'); error.code = 'EPERM'; throw error; } }), /termination could not be confirmed/);
});

test('Pi-family runs preflight and capture ephemeral JSON with no provider retry',async t=>{
 for(const agent of ['pi','omp']){
  const f=await fixture(t,{behavior:(child,input)=>{
   if(f.calls.at(-1).args.includes('--version')){child.stdout.emit('data',agent==='omp'?'omp/18.6.0\n':'0.60.0\n');child.emit('close',0);return;}
   emitJSON(child,{type:'session',version:3,id:'fresh-fixture',cwd:f.repo,timestamp:new Date().toISOString()});emitJSON(child,{type:'message_end',message:{role:'user',content:input}});emitJSON(child,{type:'message_end',message:{role:'assistant',provider:'fixture',model:'model',stopReason:'stop',content:[{type:'text',text:'Fixture check passed'}],usage:{input:10,cacheRead:20,cacheWrite:30,output:4}}});emitJSON(child,{type:'agent_end',messages:[],isTerminal:true});child.emit('close',0);
  }});
  const r=await runVerification({...f.request,agent},f.deps);assert.equal(r.measurement.inputTokens,60);assert.equal(r.check.status,'passed');assert.equal(f.calls.length,2);assert.ok(f.calls[1].args.includes('--no-session'));if(agent==='omp')assert.ok(f.calls[1].args.includes('always-ask'));
 }
});
test('OpenCode exports only the freshly emitted session and merges a no-sharing overlay',async t=>{
 let captured;const session='ses_fixture';
 const f=await fixture(t,{behavior:(child,input)=>{
  const args=f.calls.at(-1).args;
  if(args.includes('--version'))child.stdout.emit('data','1.18.35\n');
  else if(args[0]==='export'){
   assert.deepEqual(args,['export',session]);child.stdout.emit('data',JSON.stringify({info:{id:session,directory:f.repo,time:{created:Date.now()}},messages:[{info:{id:'user',sessionID:session,role:'user',time:{created:Date.now()}},parts:[{type:'text',text:captured}]},{info:{id:'assistant',sessionID:session,parentID:'user',role:'assistant',modelID:'model',providerID:'fixture',time:{completed:Date.now()},finish:'stop'},parts:[{type:'step-start'},{type:'text',text:'Fixture check passed'},{type:'step-finish',reason:'stop',tokens:{input:10,output:4,reasoning:0,cache:{read:20,write:30}}}]}]}));
  }else{captured=input;emitJSON(child,{type:'step_start',sessionID:session});emitJSON(child,{type:'step_finish',sessionID:session,part:{reason:'stop'}});}
  child.emit('close',0);
 }});
 f.deps.environment.OPENCODE_CONFIG_CONTENT=JSON.stringify({model:'fixture/model',share:'auto'});f.deps.environment.OPENCODE_AUTO_SHARE='true';
 const r=await runVerification({...f.request,agent:'opencode'},f.deps);assert.equal(r.measurement.inputTokens,60);assert.equal(f.calls.length,3);assert.deepEqual(JSON.parse(f.calls[1].config.env.OPENCODE_CONFIG_CONTENT),{model:'fixture/model',share:'disabled'});assert.equal(f.calls[1].config.env.OPENCODE_AUTO_SHARE,undefined);assert.equal(JSON.parse(f.deps.environment.OPENCODE_CONFIG_CONTENT).share,'auto');
});
test('Kiro automatically captures a percentage without treating credits as tokens',async t=>{
 const f=await fixture(t,{behavior:child=>{if(f.calls.at(-1).args.includes('--version'))child.stdout.emit('data','kiro-cli 2.24.1\n');else{emitJSON(child,{type:'runStarted',data:{payloadSchema:'acp',acpProtocolVersion:1,engine:'v2'}});emitJSON(child,{type:'metadata',data:{sessionId:'fresh',contextUsagePercentage:2,meteringUsage:[{value:10,unit:'credit'}]}});emitJSON(child,{type:'runFinished',data:{sessionId:'fresh',status:'success',stopReason:'end_turn',finalText:'Fixture check passed',finalTextTruncated:false}});}child.emit('close',0);}});
 const r=await runVerification({...f.request,agent:'kiro'},f.deps);assert.equal(r.measurement.inputTokens,null);assert.equal(r.measurement.contextPercentage,2);assert.equal(r.check.status,'passed');assert.ok(f.calls[1].args.includes('--trust-tools='));assert.ok(f.calls[1].args.at(-1).includes(f.request.prompt));
});
test('unrecognized export versions and malformed config fail before a billable OpenCode request',async t=>{
 const f=await fixture(t,{behavior:child=>{child.stdout.emit('data','2.0.0\n');child.emit('close',0);}});await assert.rejects(runVerification({...f.request,agent:'opencode'},f.deps),/1.x/);assert.equal(f.calls.length,1);
 f.deps.environment.OPENCODE_CONFIG_CONTENT='malformed';await assert.rejects(runVerification({...f.request,agent:'opencode'},f.deps),/safely merged/);assert.equal(f.calls.length,1);
});
