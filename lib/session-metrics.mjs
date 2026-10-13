import path from 'node:path';

const MAX_BYTES = 2 * 1024 * 1024, MAX_RECORDS = 20000, MAX_TOKENS = 1e9;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
const PATH_CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const CLAUDE_TYPES = new Set(['user', 'assistant', 'system', 'progress', 'summary', 'file-history-snapshot', 'queue-operation', 'custom-title', 'agent-name', 'last-prompt']);
const CODEX_TYPES = new Set(['session_meta', 'turn_context', 'token_usage_record', 'event_msg', 'response_item', 'compacted', 'inter_agent_communication', 'inter_agent_communication_metadata', 'retained_context', 'world_state', 'security_risk_score', 'realtime_item']);
const COMPACTION = new Set(['compacted', 'context_compacted', 'compact_boundary', 'compaction']);
const INTERPRETATION = 'Selected parent-session reported tokens only. Cached input is counted where reported; tokens are not billed cost. Missing requests, subagent activity and unreported usage cannot be verified. Startup context, quality and total harness activity are not measured. Confirm a fresh session for the fixed task before applying.';
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const has = (value, key) => object(value) && Object.hasOwn(value, key);
const integer = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_TOKENS;
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-][A-Za-z0-9_.:-]{0,159}$/.test(value);

function validString(value) {
  if (CONTROL.test(value)) return false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
function parseJSON(text) {
  // Reject ambiguous duplicate keys and excessive nesting before decoding values.
  const stack = [];
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      const start = index++;
      while (index < text.length && text[index] !== '"') { if (text[index] === '\\') index++; index++; }
      const current = stack.at(-1);
      if (current?.keys && current.key) {
        const key = JSON.parse(text.slice(start, index + 1));
        if (current.keys.has(key)) throw new Error('Invalid JSON');
        current.keys.add(key); current.key = false;
      }
    } else if (char === '{' || char === '[') {
      if (stack.length >= 64) throw new Error('Invalid JSON');
      stack.push(char === '{' ? { keys: new Set(), key: true } : {});
    } else if (char === '}' || char === ']') stack.pop();
    else if (char === ',' && stack.at(-1)?.keys) stack.at(-1).key = true;
  }
  return JSON.parse(text);
}
function normalized(value) {
  if (typeof value !== 'string' || value.length > 4096 || PATH_CONTROL.test(value) || !validString(value)) return null;
  if (value === '') return { style: 'global', key: '' };
  const windows = /^[A-Za-z]:[\\/]/.test(value) || /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/.test(value);
  const flavor = windows ? path.win32 : path.posix;
  if (!flavor.isAbsolute(value)) return null;
  const name = flavor.normalize(value), root = flavor.parse(name).root;
  const key = name.length > root.length ? name.replace(windows ? /[\\/]+$/ : /\/+$/, '') : name;
  return { style: windows ? 'windows' : 'posix', key: windows ? key.toLowerCase() : key };
}
function selectedScope(repo, repos) {
  if (typeof repo !== 'string' || !Array.isArray(repos) || repos.length > 2000) throw new Error('Choose a known repository scope');
  const selected = normalized(repo);
  if (!selected) throw new Error('Choose a known repository scope');
  const roots = repos.map(item => normalized(typeof item === 'string' ? item : item?.path));
  if (roots.some(root => !root || root.style === 'global')) throw new Error('Choose known repository scopes');
  if (repo && !roots.some(root => root.style === selected.style && root.key === selected.key)) throw new Error('Choose a known repository scope');
  return { selected, roots };
}
function resolvedScope(value, roots) {
  const cwd = normalized(value);
  if (!cwd) return null;
  if (cwd.style === 'global') return cwd;
  const separator = cwd.style === 'windows' ? '\\' : '/';
  return roots.filter(root => root.style === cwd.style && (cwd.key === root.key || cwd.key.startsWith(root.key + (root.key.endsWith(separator) ? '' : separator)))).sort((a, b) => b.key.length - a.key.length)[0] || null;
}
function codexUsage(value) {
  if (!object(value) || !integer(value.total_tokens)) return null;
  if (!integer(value.input_tokens) || !integer(value.output_tokens)) return null;
  const vector = {};
  for (const key of ['input_tokens', 'output_tokens', 'total_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'reasoning_output_tokens']) {
    if (has(value, key)) { if (!integer(value[key])) return null; vector[key] = value[key]; }
  }
  if (vector.input_tokens + vector.output_tokens !== vector.total_tokens) return null;
  if (has(vector, 'cached_input_tokens') && vector.cached_input_tokens > vector.input_tokens || has(vector, 'reasoning_output_tokens') && vector.reasoning_output_tokens > vector.output_tokens) return null;
  return vector;
}

export function previewSessionMetrics(text, { agent, repo = '', repos = [], format = 'jsonl' } = {}) {
  if (!['claude', 'codex'].includes(agent)) throw new Error('Choose a supported session metrics agent');
  if (!['jsonl', 'json'].includes(format)) throw new Error('Choose JSONL or JSON session records');
  const { selected, roots } = selectedScope(repo, repos), issues = new Set();
  const issue = value => issues.add(value);
  let records = [], recordCount = 0;
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_BYTES) issue('Selected data exceeds the preview limits.');
  else if (!validString(text)) issue('Control or invalid Unicode data is not supported.');
  else if (format === 'json') {
    try {
      const parsed = parseJSON(text);
      if (Array.isArray(parsed)) records = parsed;
      else if (object(parsed) && typeof parsed.type === 'string') records = [parsed];
      else issue('Unsupported session record structure.');
      recordCount = Math.min(records.length, MAX_RECORDS);
      if (records.length > MAX_RECORDS) { issue('Selected data exceeds the preview limits.'); records = records.slice(0, MAX_RECORDS); }
    } catch { issue('Malformed or truncated JSON records.'); }
  } else {
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      if (++recordCount > MAX_RECORDS) { recordCount = MAX_RECORDS; issue('Selected data exceeds the preview limits.'); break; }
      try { records.push(parseJSON(line)); } catch { issue('Malformed or truncated JSON records.'); }
    }
  }
  let session = null, scope = null, metadataSeen = false, childSession = false, total = 0, usageCount = 0, lastSnapshot = null;
  const responses = new Map();
  const modern = agent === 'codex' && records.some(record => object(record) && record.type === 'token_usage_record');
  const method = agent === 'claude' ? 'claude-response-sum' : modern ? 'codex-response-sum' : 'codex-cumulative-snapshot';
  const counter = agent === 'claude' ? 'Claude reported parent-response tokens (cache inclusive)' : modern ? 'Codex reported parent-response tokens' : 'Codex reported parent-session cumulative tokens';
  function identity(value) {
    if (!identifier(value)) { issue('Missing or invalid session identity.'); return false; }
    if (session !== null && session !== value) { issue('Multiple session identities are not applicable.'); return false; }
    session = value; return true;
  }
  function workingScope(value) {
    const resolved = resolvedScope(value, roots);
    if (!resolved || resolved.style !== selected.style || resolved.key !== selected.key) {
      issue('Missing, unknown or mismatched working scope.'); scope = null; return false;
    }
    scope = resolved; return true;
  }
  function addResponse(id, vector) {
    if (!identifier(id) || !vector || !session || !scope) { issue('Missing or invalid response usage.'); return; }
    const fingerprint = JSON.stringify([session, scope.style, scope.key, vector]);
    if (responses.has(id)) {
      if (responses.get(id) !== fingerprint) issue('Conflicting duplicate response usage.');
      return;
    }
    const value = agent === 'claude' ? Object.values(vector).reduce((sum, count) => sum + count, 0) : vector.total_tokens;
    if (!integer(value) || !integer(total + value)) { issue('Token total exceeds the preview limit.'); return; }
    responses.set(id, fingerprint); total += value; usageCount++;
  }
  for (const record of records) {
    if (!object(record)) { issue('Unsupported session record structure.'); continue; }
    const types = agent === 'claude' ? CLAUDE_TYPES : CODEX_TYPES;
    if (!types.has(record.type)) { issue('Unsupported session record structure.'); continue; }
    const payload = object(record.payload) ? record.payload : null, message = object(record.message) ? record.message : null;
    const sources = [record, payload, message].filter(Boolean);
    let validMetadata = true;
    for (const source of sources) if (has(source, 'cwd')) validMetadata = workingScope(source.cwd) && validMetadata;
    const sidechain = sources.some(source => source.isSidechain === true || source.is_sidechain === true || has(source, 'agentId') || source.source === 'subagent' || object(source.source) && has(source.source, 'subagent')) || agent === 'codex' && record.type === 'session_meta' && (has(payload, 'parent_thread_id') && payload.parent_thread_id !== null || has(payload, 'subagent_history_start_ordinal') && payload.subagent_history_start_ordinal !== null);
    if (sources.some(source => has(source, 'isSidechain') && typeof source.isSidechain !== 'boolean' || has(source, 'is_sidechain') && typeof source.is_sidechain !== 'boolean')) { issue('Invalid session metadata.'); validMetadata = false; }
    if (sidechain) {
      issue('Subagent or sidechain records are excluded.');
      if (agent === 'codex' && record.type === 'session_meta') childSession = true;
      continue;
    }
    if (agent === 'claude') {
      const ids = sources.flatMap(source => ['sessionId', 'session_id'].filter(key => has(source, key)).map(key => source[key]));
      for (const id of ids) validMetadata = identity(id) && validMetadata;
      if (record.type !== 'assistant') continue;
      if (!ids.length) { issue('Missing or invalid session identity.'); validMetadata = false; }
      if (!sources.some(source => has(source, 'cwd'))) { issue('Missing, unknown or mismatched working scope.'); validMetadata = false; }
      if (!validMetadata) continue;
      if (!message || has(message, 'role') && message.role !== 'assistant') { issue('Missing or invalid response usage.'); continue; }
      const usage = message.usage, vector = {};
      let valid = object(usage);
      for (const key of ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens']) {
        valid &&= integer(usage?.[key]); vector[key] = usage?.[key];
      }
      addResponse(message.id, valid ? vector : null);
    } else {
      for (const source of [record, payload].filter(Boolean)) if (has(source, 'thread_id')) validMetadata = identity(source.thread_id) && validMetadata;
      if (['session_meta', 'turn_context', 'token_usage_record', 'event_msg', 'response_item'].includes(record.type) && !payload) { issue('Invalid session metadata.'); continue; }
      if (record.type === 'session_meta') {
        validMetadata = identity(payload.id) && validMetadata;
        if (!has(payload, 'cwd')) { scope = null; issue('Missing, unknown or mismatched working scope.'); }
        metadataSeen = validMetadata && has(payload, 'cwd') && scope !== null;
      } else if (record.type === 'turn_context') {
        if (!has(payload, 'cwd')) { scope = null; issue('Missing, unknown or mismatched working scope.'); }
      } else if (record.type === 'token_usage_record') {
        if (!validMetadata || !metadataSeen || !identifier(payload.thread_id) || payload.thread_id !== session || childSession) { issue('Missing or invalid session identity.'); continue; }
        addResponse(payload.response_id, codexUsage(payload.usage));
      } else if (record.type === 'event_msg' && (typeof payload.type !== 'string' || !validString(payload.type))) {
        issue('Invalid session metadata.');
      } else if (!modern && record.type === 'event_msg' && payload.type === 'token_count') {
        const vector = codexUsage(payload.info?.total_token_usage);
        if (!validMetadata || !metadataSeen || !session || !scope || childSession || !vector) { issue('Missing or invalid cumulative token usage.'); continue; }
        if (lastSnapshot && Object.keys(vector).some(key => has(lastSnapshot, key) && vector[key] < lastSnapshot[key])) issue('Cumulative token snapshots decrease.');
        // Omitted optional counters must not erase their last known cumulative values.
        lastSnapshot = { ...lastSnapshot, ...vector }; total = vector.total_tokens; usageCount++;
      }
      if (!modern && (COMPACTION.has(record.type) || COMPACTION.has(payload?.type))) issue('Compacted legacy snapshots are not applicable.');
    }
  }
  if (!session) issue('Missing or invalid session identity.');
  if (!scope) issue('Missing, unknown or mismatched working scope.');
  if (!usageCount) issue('No supported usage records.');
  const partial = issues.size > 0;
  return { agent, repo, totalTokens: partial ? null : total, counter, method, applicable: !partial, coverage: { records: recordCount, responses: responses.size, partial, issues: [...issues] }, interpretation: INTERPRETATION };
}
