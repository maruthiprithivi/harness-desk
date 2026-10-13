import {sameLocalPath} from './path-identity.mjs';
import { createHash } from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 1e9;
const label = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/+-]{0,159}$/.test(value);

// Only accepts stdout from our own fresh, UUID-pinned child; never an imported stream.
export function captureClaudeVerification(stdout, { session, cwd, repo, input, started, finished }) {
  let init, result, first, responseId, inputTokens, outputTokens = 0, toolActivity = false;
  const text = [];
  for (const line of stdout.split('\n').filter(line => line.trim())) {
    let event;
    try { event = JSON.parse(line); } catch { throw new Error('Claude returned malformed verification events.'); }
    if (!event || typeof event.type !== 'string') throw new Error('Claude returned unsupported verification events.');
    if (event.session_id !== undefined && event.session_id !== session) throw new Error('Claude returned a different verification session.');
    if (event.parent_tool_use_id != null) throw new Error('Subagent output cannot establish this parent verification measurement.');
    if (event.type === 'system' && event.subtype === 'init') {
      if (init || result || first || event.session_id !== session || !sameLocalPath(event.cwd,cwd) || !label(event.claude_code_version) || !label(event.model)) throw new Error('Claude did not identify one fresh verification launch.');
      init = event;
    }
    if (event.type === 'system' && ['compact_boundary', 'context_compacted'].includes(event.subtype)) throw new Error('Compacted context cannot establish a fresh baseline.');
    if (event.type === 'assistant') {
      const message = event.message, usage = message?.usage;
      if (!init || result || event.session_id !== session || message?.role !== 'assistant' || !label(message.id) || !label(message.model) || !Array.isArray(message.content) || !usage || !['input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens', 'output_tokens'].every(key => count(usage[key]))) throw new Error('Claude first-response identity or token counters are incomplete.');
      if (responseId && responseId !== message.id) throw new Error('This bounded check produced more than one model request; no fresh single-request measurement was saved.');
      const total = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens;
      if (!count(total) || total === 0 || first && (inputTokens !== total || first.model !== message.model)) throw new Error('Claude returned conflicting first-request counters.');
      responseId = message.id; first ||= message; inputTokens = total; outputTokens = Math.max(outputTokens, usage.output_tokens);
      for (const block of message.content) {
        if (block.type === 'tool_use' || block.type === 'server_tool_use') toolActivity = true;
        if (block.type === 'text' && typeof block.text === 'string') text.push(block.text);
      }
    }
    if (event.type === 'result') {
      if (result || !init || !first || event.session_id !== session || event.is_error !== false || event.subtype !== 'success' || event.num_turns !== 1 || typeof event.result !== 'string' || !event.result.trim()) throw new Error('Claude did not complete one successful verification turn.');
      result = event;
      if (Array.isArray(event.permission_denials) && event.permission_denials.length) toolActivity = true;
    }
  }
  if (!init || !first || !result || !text.length) throw new Error('Claude verification is missing its initial response or completion.');
  // Result usage is cumulative and must never substitute for first-response usage.
  return {
    measurement: { agent: 'claude', repo, launchDirectory: cwd, sessionId: hash('claude:' + session), model: first.model, agentVersion: init.claude_code_version, promptHash: hash(input), inputTokens, outputTokens, capacity: null, measuredAt: new Date(finished).toISOString(), method: 'claude-first-request-input', limitations: 'First provider response input, including cache input and the verification prompt. Captured directly from the fresh child stream. Not pure startup context, category attribution or proof of individual file loads.' },
    answer: result.result, toolActivity,
    launch: { profile: 'claude-no-permission-prompts-verification-v1', agent: 'claude', launchDirectory: cwd, model: first.model, agentVersion: init.claude_code_version, sandbox: 'none', approvalPolicy: 'dontAsk', configuration: 'normal global and project configuration; permission prompts denied', startedAt: new Date(started).toISOString() }
  };
}
