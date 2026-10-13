import { createHash } from 'node:crypto';
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = () => { throw new Error('Kimi did not provide one matching fresh request with supported token usage.'); };
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 1e9;
export function kimiSession(stdout) {
  let session, answer, version;
  for (const line of stdout.split('\n').filter(line => line.trim())) {
    let e; try { e = JSON.parse(line); } catch { fail(); }
    if (e.role === 'meta' && e.type === 'session.resume_hint') {
      if (session || !/^session_[a-f0-9-]{36}$/.test(e.session_id || '')) fail(); session = e.session_id;
    } else if (e.role === 'meta' && e.type === 'system.version') version = e.version;
    else if (e.role === 'assistant' && typeof e.content === 'string') { if (answer) fail(); answer = e.content; }
    else fail();
  }
  if (!session || !answer?.trim() || typeof version !== 'string') fail();
  return { session, answer, version };
}
export function captureKimiVerification(manifest, wire, { session, answer, version, cwd, repo, input, started, finished }) {
  const fresh = time => Number.isFinite(time) && time >= started - 2000 && time <= finished + 2000;
  if (manifest.sessionId !== session || manifest.workspaceDir !== cwd || manifest.kimiCodeVersion !== version || manifest.wireProtocolVersion !== '1.5' || !fresh(Date.parse(manifest.sessionFirstActivity))) fail();
  let header, prompt, request, usage, step, ended, completed, binding, permissions;
  for (const line of wire.split('\n').filter(line => line.trim())) {
    let e; try { e = JSON.parse(line); } catch { fail(); }
    if (e.agentId && e.agentId !== 'main') fail();
    if (e.type === 'metadata') { if (header || e.protocol_version !== '1.5') fail(); header = e; }
    if (e.type === 'profile.bind') { if (binding || e.environmentDisclosure?.cwd !== cwd) fail(); binding = e; }
    if (e.type === 'permission.set_mode') { if (permissions) fail(); permissions = e.mode; }
    if (e.type === 'turn.prompt') {
      if (prompt || !Array.isArray(e.input) || e.input.length !== 1 || e.input[0].type !== 'text' || e.input[0].text !== input) fail(); prompt = e;
    }
    if (e.type === 'llm.request') { if (request || e.kind !== 'loop' || !fresh(e.time)) fail(); request = e; }
    if (e.type === 'usage.record') { if (usage || e.usageScope !== 'turn') fail(); usage = e; }
    if (e.type === 'context.append_loop_event') {
      if (e.event?.type === 'step.end') { if (step || e.event.finishReason !== 'end_turn') fail(); step = e.event; }
      if (!['step.begin', 'step.end', 'content.part'].includes(e.event?.type) || e.event?.part && !['text', 'think'].includes(e.event.part.type)) fail();
    }
    if (/compact|retry|tool\.(?:call|start|result)/i.test(e.type)) fail();
    if (e.type === 'turn.ended') { if (ended || e.reason !== 'completed') fail(); ended = e; }
    if (e.type === 'prompt.completed') { if (completed || e.reason !== 'completed' || !fresh(e.time)) fail(); completed = e; }
  }
  if (!header || !binding || !permissions || !prompt || !request || !usage || !step || !ended || !completed || completed.promptId !== prompt.promptId || ended.turnId !== prompt.turnId || request.modelAlias !== usage.model || binding.modelAlias !== usage.model) fail();
  const u = usage.usage;
  if (!u || !['inputOther', 'inputCacheRead', 'inputCacheCreation', 'output'].every(key => count(u[key]) && u[key] === step.usage?.[key])) fail();
  const inputTokens = u.inputOther + u.inputCacheRead + u.inputCacheCreation;
  if (!count(inputTokens) || inputTokens === 0) fail();
  return { measurement: { agent: 'kimi', repo, launchDirectory: cwd, sessionId: hash('kimi:' + session), promptHash: hash(input), model: usage.model, agentVersion: version, inputTokens, outputTokens: u.output, capacity: null, measuredAt: new Date(usage.time).toISOString(), method: 'kimi-first-request-input', limitations: 'First-request input including cache reads and writes. Category costs and individual file loading are unverified.' },
    answer, toolActivity: false, launch: { profile: 'kimi-native-wire-1.5-verification-v1-' + permissions, agent: 'kimi', launchDirectory: cwd, model: usage.model, agentVersion: version, sandbox: 'none', approvalPolicy: permissions, configuration: 'normal global and project configuration', startedAt: new Date(started).toISOString() } };
}
