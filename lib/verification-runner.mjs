import fs from 'node:fs/promises';
import {sameLocalPath} from './path-identity.mjs';
import path from 'node:path';
import os from 'node:os';
import { captureKiroVerification } from './kiro-verification.mjs';
import { captureKimiVerification, kimiSession } from './kimi-verification.mjs';
import { sessionZipEntries } from './session-zip.mjs';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { findExecutable } from './agents.mjs';
import { redact, safeText } from './analysis.mjs';
import { previewContextEvidence } from './context-evidence.mjs';
import { captureClaudeVerification } from './claude-verification.mjs';
import { capturePiVerification } from './pi-verification.mjs';
import { captureOpenCodeVerification, openCodeSession } from './opencode-verification.mjs';
import { supportsVerification } from './agent-support.mjs';

const LIMIT = 2 * 1024 * 1024, TIMEOUT = 180000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROFILE = 'codex-read-only-verification-v1';
const hash = value => createHash('sha256').update(value).digest('hex');
const absolute = value => typeof value === 'string' && value.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(value) && path.isAbsolute(value);
const cancelled = signal => { if (signal?.aborted) throw new Error('Verification cancelled.'); };
function runFailure(stdout) {
  // Classify known failures without returning model output, hook logs or credential material.
  const messages = stdout.split('\n').flatMap(line => { try { const e=JSON.parse(line);return e.type==='result'&&e.is_error===true&&typeof e.result==='string'?[e.result]:[]; } catch { return []; } });
  if(messages.some(message=>/hit your (?:weekly|daily|usage)|usage limit|rate limit/i.test(message)))return 'The agent account has reached its usage limit. Wait for the limit to reset, then start the check again. No retry or billing fallback was attempted.';
  if(messages.some(message=>/not logged in|authentication required|please run \/login/i.test(message)))return 'The verification process could not use the agent login. Sign in from the agent CLI and check that this app can access it, then retry.';
  return 'Agent verification did not complete successfully. Check the agent sign-in and configuration; no automatic retry was sent.';
}

function execute(executable, args, input, { cwd, signal, environment, platform, spawnProcess, kill, timeout }) {
  cancelled(signal);
  return new Promise((resolve, reject) => {
    let child, timer, reason = null, termination = Promise.resolve(), bytes = 0, stdout = '', settled = false;
    const finish = async code => {
      if (settled) return; settled = true;
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      await termination;
      if (reason) reject(new Error(reason));
      else if (code !== 0) reject(new Error(runFailure(stdout)));
      else resolve(stdout);
    };
    const stop = message => {
      if (reason || settled) return;
      reason = message;
      if (platform === 'win32' && Number.isSafeInteger(child.pid)) {
        termination = new Promise(done => {
          let killer;
          const failed = () => { reason = 'Verification stopped, but Windows process-tree termination could not be confirmed.'; child.kill(); done(); };
          const fallback = setTimeout(failed, 2000);
          try {
            const systemRoot = environment.SystemRoot || environment.SYSTEMROOT || 'C:\\Windows';
            killer = spawnProcess(path.win32.join(systemRoot, 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
            killer.once('error', () => { clearTimeout(fallback); failed(); });
            killer.once('close', code => { clearTimeout(fallback); if (code !== 0) failed(); else done(); });
          } catch { clearTimeout(fallback); failed(); }
        });
      } else {
        try { if (Number.isSafeInteger(child.pid)) kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); }
        catch (error) {
          if (error.code !== 'ESRCH') reason = 'Verification stopped, but process-group termination could not be confirmed.';
          child.kill('SIGKILL');
        }
      }
      // A child may retain inherited streams after its parent exits; stop waiting after tree termination.
      termination.then(() => finish(null));
    };
    const abort = () => stop('Verification cancelled.');
    try {
      child = spawnProcess(executable.command, [...(executable.prefix || []), ...args], { cwd, env: environment, shell: false, windowsHide: true, detached: platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch { reject(new Error('Agent verification could not start.')); return; }
    const receive = (chunk, keep) => {
      if (reason || settled) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > LIMIT) { stop('Verification exceeded the 2 MiB output limit.'); return; }
      if (keep) stdout += chunk;
    };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => receive(chunk, true)); child.stderr.on('data', chunk => receive(chunk, false));
    child.stdin.on('error', () => {});
    child.once('error', () => { reason ||= 'Agent verification could not start.'; finish(null); });
    child.once('close', finish);
    timer = setTimeout(() => stop('Verification timed out after its bounded run. No automatic retry was sent.'), timeout);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    else child.stdin.end(input);
  });
}

function resultEvents(stdout) {
  let thread = null, answer = null, completed = false, toolActivity = false;
  for (const line of stdout.split('\n').filter(line => line.trim())) {
    let event; try { event = JSON.parse(line); } catch { throw new Error('Codex returned malformed verification events.'); }
    if (!event || typeof event.type !== 'string') throw new Error('Codex returned unsupported verification events.');
    if (event.type === 'error' || event.type === 'turn.failed') throw new Error('Codex reported a failed verification request.');
    if (event.type.startsWith('item.') && event.item?.type && !['agent_message', 'reasoning'].includes(event.item.type)) toolActivity = true;
    if (event.type === 'thread.started') {
      if (thread || !UUID.test(event.thread_id || '')) throw new Error('Codex did not identify one fresh verification session.');
      thread = event.thread_id.toLowerCase();
    }
    if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
      if (typeof event.item.text !== 'string' || !event.item.text.trim()) throw new Error('Codex returned no supported verification answer.');
      answer = event.item.text;
    }
    if (event.type === 'turn.completed') {
      if (completed) throw new Error('Codex returned multiple verification turns.');
      completed = true;
    }
  }
  if (!thread || !completed || answer === null) throw new Error('Codex verification is missing its session, answer or completed turn.');
  return { thread, answer, toolActivity };
}

async function realDirectory(directory, filesystem) {
  let current = path.parse(directory).root;
  for (const part of directory.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await filesystem.lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Verification directories must be real local directories.');
  }
}

async function findOwnSession(codexHome, thread, started, filesystem, signal) {
  const root = path.join(codexHome, 'sessions');
  try { await realDirectory(root, filesystem); } catch { throw new Error('The fresh verification session directory is unavailable.'); }
  const names = new Set([-86400000, 0, 86400000].map(offset => new Date(started + offset).toISOString().slice(0, 10).replaceAll('-', path.sep)));
  let found = null, visited = 0;
  const suffix = new RegExp('^rollout-[0-9T_.:-]+-' + thread + '\\.jsonl$', 'i');
  for (const name of names) {
    cancelled(signal);
    const directory = path.join(root, name);
    try { await realDirectory(directory, filesystem); } catch (error) { if (error.code === 'ENOENT') continue; throw new Error('The fresh verification session location is unsafe or unavailable.'); }
    const entries = await filesystem.opendir(directory);
    try {
      for await (const entry of entries) {
        cancelled(signal);
        if (++visited > 2000) throw new Error('The fresh session lookup exceeded its bounded search.');
        if (!suffix.test(entry.name)) continue;
        if (found) throw new Error('Multiple logs claim the verification session identity.');
        const candidate = path.join(directory, entry.name), stat = await filesystem.lstat(candidate);
        if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1 || stat.size > LIMIT || stat.mtimeMs < started - 2000) throw new Error('The verification log is unsafe, stale or exceeds the capture limit.');
        found = candidate;
      }
    } finally { await entries.close().catch(() => {}); }
  }
  if (!found) throw new Error('Codex finished, but its fresh session log could not be located automatically.');
  return found;
}

export async function runVerification({ agent, repo = '', launchDirectory = repo, prompt, expectedText = '', model = '', signal, home, onProgress } = {}, deps = {}) {
  if (!supportsVerification(agent)) throw new Error('Automatic measurement is not yet supported for this agent. Inspect its configuration or use a manual handoff.');
  if (!absolute(home) || !absolute(launchDirectory) || typeof repo !== 'string' || repo && !absolute(repo)) throw new Error('Choose an absolute local project and launch directory.');
  const cwd = path.normalize(launchDirectory), root = repo ? path.normalize(repo) : '';
  if (root) { const relative = path.relative(root, cwd); if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) throw new Error('The launch directory must belong to the selected repository.'); }
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 4000 || /\u0000/.test(prompt)) throw new Error('Describe a verification task in 1 to 4000 characters.');
  if (typeof expectedText !== 'string' || expectedText.length > 500 || /\u0000/.test(expectedText) || expectedText && !expectedText.trim()) throw new Error('Expected text must be empty or contain 1 to 500 characters.');
  if (typeof model !== 'string' || model.length > 160 || model && !/^[a-zA-Z0-9][a-zA-Z0-9._:/+-]*$/.test(model)) throw new Error('Choose a valid model name.');
  cancelled(signal);
  const filesystem = deps.fs || fs, environment = { ...(deps.environment || process.env) }, platform = deps.platform || process.platform;
  delete environment.CODEX_SESSION_ID; delete environment.CODEX_THREAD_ID;
  delete environment.CLAUDECODE; delete environment.CLAUDE_CODE_SESSION_ID;
  const codexHome = environment.CODEX_HOME || path.join(home, '.codex');
  if (agent === 'codex' && !absolute(codexHome)) throw new Error('CODEX_HOME must be an absolute local directory.');
  try { await realDirectory(cwd, filesystem); } catch { throw new Error('The launch directory is unavailable or contains a symbolic link.'); }
  const executable = await (deps.findExecutable || findExecutable)((agent === 'kiro' ? ['kiro-cli','kiro'] : agent === 'kimi' ? ['kimi','kimi-cli'] : [agent]), environment, platform);
  if (!executable || executable.shim) throw new Error('A directly executable agent CLI is required for managed verification.');
  const input = 'Run this bounded Harness Desk verification task using the instructions already present in your context. Do not use tools, execute commands, edit files or contact external services. Give a concise final answer.\n\nVerification task:\n' + prompt;
  const session = (deps.randomUUID || randomUUID)();
  const piFamily = ['omp','pi'].includes(agent);
  if(agent==='opencode'){
    let overlay={};try{if(environment.OPENCODE_CONFIG_CONTENT)overlay=JSON.parse(environment.OPENCODE_CONFIG_CONTENT);}catch{throw new Error('The existing OpenCode environment configuration cannot be safely merged.');}
    if(!overlay||typeof overlay!=='object'||Array.isArray(overlay))throw new Error('OpenCode environment configuration must be an object.');
    environment.OPENCODE_CONFIG_CONTENT=JSON.stringify({...overlay,share:'disabled'});
    delete environment.OPENCODE_AUTO_SHARE;
  }
  const processOptions = { cwd, signal, environment, platform, spawnProcess: deps.spawn || spawn, kill: deps.kill || process.kill.bind(process), timeout: deps.timeout ?? TIMEOUT };
  let version;
  if(piFamily||['opencode','kiro','kimi'].includes(agent)){
    const reported=await execute(executable,['--version'],'',{...processOptions,timeout:15000});
    version=/^(?:(?:omp|pi|kiro-cli)(?:\/| v?| ))?(\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?)\s*$/.exec(reported.trim())?.[1];
    if(!version)throw new Error('The installed agent version could not be verified.');
    if(agent==='kimi'&&!version.startsWith('2.'))throw new Error('Automatic verification currently supports native Kimi 2.x with wire protocol 1.5.');
    if(agent==='opencode'&&!version.startsWith('1.'))throw new Error('Automatic verification currently supports the OpenCode 1.x session export format.');
  }
  const args = agent==='kiro'?['chat','--no-interactive','--trust-tools=','--output-format','stream-json']:agent==='kimi'?['-p',input,'--output-format','stream-json']:agent==='opencode'?['run','--format','json','--dir',cwd,'--title','Harness Desk verification']:piFamily ? ['--print','--mode','json','--no-session',...(agent==='omp'?['--no-title','--approval-mode','always-ask']:[])] : agent === 'claude'
    ? ['--print', '--verbose', '--output-format', 'stream-json', '--session-id', session, '--permission-mode', 'dontAsk', '--permission-prompts', 'none', '--max-turns', '1']
    : ['exec', '--json', '--sandbox', 'read-only', '-c', 'approval_policy="never"', '-C', cwd, '--skip-git-repo-check', '--color', 'never'];
  if (model) args.push('--model', model);
  if (agent === 'codex') args.push('-');
  if (agent === 'kiro') args.push(input);
  const now = deps.now || Date.now, started = now();
  const progress = message => { if (typeof onProgress === 'function') onProgress(message); };
  progress('Starting a fresh agent session with your normal configuration.');
  let stdout = await execute(executable, args, ['kiro','kimi'].includes(agent)?'':input, processOptions);
  cancelled(signal);
  if (agent === 'claude' || piFamily || ['opencode','kiro','kimi'].includes(agent)) {
    progress('Capturing the first response directly from this fresh session.');
    if(piFamily){
      // Some CLIs report the OS alias (/tmp on macOS) rather than the canonical cwd.
      const rows=stdout.split('\n').filter(line=>line.trim()),normalized=[];
      for(const line of rows){
        let event;try{event=JSON.parse(line);}catch{throw new Error('The agent returned malformed JSON events.');}
        if(event?.type==='session'){
          if(!absolute(event.cwd)||!sameLocalPath(await filesystem.realpath(event.cwd),cwd))throw new Error('The agent reported a different launch folder.');
          event.cwd=cwd;
        }
        normalized.push(JSON.stringify(event));
      }
      stdout=normalized.join('\n');
    }
    const options = { agent, session, cwd, repo, input, started, finished: now(), version, model };
    let result;
    if(agent==='kiro')result=captureKiroVerification(stdout,options);
    else if(agent==='kimi'){
      const identity=kimiSession(stdout);
      if(identity.version!==version)throw new Error('Kimi changed versions during verification.');
      const temporary=await filesystem.mkdtemp(path.join(os.tmpdir(),'harness-session-'));
      try {
        const archive=path.join(temporary,'session.zip');
        await execute(executable,['export',identity.session,'--output',archive,'--yes','--no-include-global-log'],'',{...processOptions,timeout:15000});
        cancelled(signal);
        const stat=await filesystem.lstat(archive);
        if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>16*1024*1024)throw new Error('Kimi session export is unsafe or exceeds its capture limit.');
        const entries=sessionZipEntries(await filesystem.readFile(archive),['manifest.json','agents/main/wire.jsonl']);
        let manifest;try{manifest=JSON.parse(entries['manifest.json']);}catch{throw new Error('Kimi returned an invalid export manifest.');}
        if(!absolute(manifest.workspaceDir)||!sameLocalPath(await filesystem.realpath(manifest.workspaceDir),cwd))throw new Error('Kimi reported a different launch folder.');
        manifest.workspaceDir=cwd;
        result=captureKimiVerification(manifest,entries['agents/main/wire.jsonl'],{...options,...identity,finished:now()});
      }finally{await filesystem.rm(temporary,{recursive:true,force:true});}
    }else if(agent==='opencode'){
      const session=openCodeSession(stdout);
      const exported=await execute(executable,['export',session],'', {...processOptions,timeout:15000});
      let data;try{data=JSON.parse(exported);}catch{throw new Error('OpenCode returned an invalid session export.');}
      if(!absolute(data?.info?.directory)||!sameLocalPath(await filesystem.realpath(data.info.directory),cwd))throw new Error('OpenCode reported a different launch folder.');
      data.info.directory=cwd;
      result=captureOpenCodeVerification(JSON.stringify(data),{...options,session,finished:now()});
    }else result = piFamily ? capturePiVerification(stdout, options) : captureClaudeVerification(stdout, options);
    cancelled(signal);
    result.measurement.launchFingerprint = hash(JSON.stringify([result.launch.profile, agent, cwd, result.measurement.model, result.measurement.agentVersion]));
    const check = result.toolActivity ? { status: 'failed', description: 'Tool activity or a denied tool request was observed; this bounded no-tools check did not pass.' } : expectedText ? { status: result.answer.includes(expectedText) ? 'passed' : 'failed', description: 'Literal expected text check only; does not establish general instruction following or individual file loading.' } : { status: 'not-configured', description: 'No expected text was supplied. Task correctness has not been verified.' };
    return { measurement: result.measurement, launch: result.launch, answer: redact(result.answer).slice(0, 2000), check };
  }
  const { thread, answer, toolActivity } = resultEvents(stdout);
  progress('Capturing the first request from the session created by this run.');
  const sessionFile = await findOwnSession(path.normalize(codexHome), thread, started, filesystem, signal);
  let text;
  try { text = await (deps.safeText || safeText)(sessionFile, ['.jsonl'], LIMIT, true); }
  catch { throw new Error('The verification log could not be safely captured.'); }
  cancelled(signal);
  const preview = previewContextEvidence(text, { agent, repo, repos: repo ? [repo] : [] });
  if (!preview.applicable) throw new Error('Fresh-session context could not be verified: ' + preview.issues.join(' '));
  const measurement = preview.measurement;
  if (measurement.sessionId !== hash('codex:' + thread) || measurement.promptHash !== hash(input) || path.normalize(measurement.launchDirectory) !== cwd || Date.parse(measurement.measuredAt) < started - 2000 || Date.parse(measurement.measuredAt) > now() + 2000) throw new Error('Captured evidence does not match this fresh verification launch.');
  const launch = { profile: PROFILE, agent, launchDirectory: cwd, model: measurement.model, agentVersion: measurement.agentVersion, sandbox: 'read-only', approvalPolicy: 'never', configuration: 'normal global and project configuration', startedAt: new Date(started).toISOString() };
  measurement.launchFingerprint = hash(JSON.stringify([PROFILE, agent, cwd, measurement.model, measurement.agentVersion, 'read-only', 'never']));
  const check = toolActivity ? { status: 'failed', description: 'Tool or command activity was observed despite this probe’s no-tools instruction. The literal answer does not pass this bounded check.' } : expectedText ? { status: answer.includes(expectedText) ? 'passed' : 'failed', description: 'Literal expected text check of the final answer only; does not establish general instruction following or tool behavior.' } : { status: 'not-configured', description: 'No expected text was supplied. Task correctness has not been verified.' };
  return { measurement, check, answer: redact(answer).slice(0, 2000), launch };
}
