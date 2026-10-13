import path from 'node:path';
import { createHash } from 'node:crypto';

const MAX_BYTES = 2 * 1024 * 1024, MAX_RECORDS = 20000;
const hash = value => createHash('sha256').update(value).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 1e9;
const label = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/+-]{0,159}$/.test(value) ? value : null;
const LIMITATIONS = 'Observed input for the first recorded parent request, including its prompt and reported cache input. Not pure startup context, billed usage, category attribution or proof that individual files loaded. Completeness is checked from available session records, not independently attested.';
const COMPARISON_LIMITATIONS = 'Observed first-request input difference only. Matching recorded conditions does not establish causality, equivalent hidden settings, task correctness or billed savings.';
const TYPES = {
  claude: new Set(['user', 'assistant', 'system', 'progress', 'summary', 'file-history-snapshot', 'queue-operation', 'custom-title', 'agent-name', 'last-prompt', 'attachment', 'mode', 'permission-mode', 'atis-latch', 'ai-title', 'pr-link', 'cost-state']),
  codex: new Set(['session_meta', 'turn_context', 'token_usage_record', 'event_msg', 'response_item', 'compacted', 'inter_agent_communication', 'inter_agent_communication_metadata', 'retained_context', 'world_state', 'security_risk_score', 'realtime_item'])
};

function parseRecord(text) {
  const stack = [];
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      const start = index++;
      while (index < text.length && text[index] !== '"') { if (text[index] === '\\') index++; index++; }
      const current = stack.at(-1);
      if (current?.keys && current.key) {
        const key = JSON.parse(text.slice(start, index + 1));
        if (current.keys.has(key)) throw new Error();
        current.keys.add(key); current.key = false;
      }
    } else if (char === '{' || char === '[') {
      if (stack.length >= 64) throw new Error();
      stack.push(char === '{' ? { keys: new Set(), key: true } : {});
    } else if (char === '}' || char === ']') stack.pop();
    else if (char === ',' && stack.at(-1)?.keys) stack.at(-1).key = true;
  }
  return JSON.parse(text);
}

function directory(value) {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\u0000-\u001f\u007f-\u009f]/.test(value)) return null;
  const windows = /^[a-z]:[\\/]/i.test(value) || /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/.test(value);
  const flavor = windows ? path.win32 : path.posix;
  if (!flavor.isAbsolute(value)) return null;
  const normalized = flavor.normalize(value), root = flavor.parse(normalized).root;
  const name = normalized.length > root.length ? normalized.replace(/[\\/]+$/, '') : normalized;
  return { name, key: windows ? name.toLowerCase() : name, windows, separator: windows ? '\\' : '/' };
}
function within(child, root) {
  return child.windows === root.windows && (child.key === root.key || child.key.startsWith(root.key + (root.key.endsWith(root.separator) ? '' : root.separator)));
}
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) return null;
  const result = new Date(value).toISOString();
  return result.slice(0, 19) === value.slice(0, 19) ? result : null;
}
function promptText(content) {
  if (typeof content === 'string') return content.trim() ? content : null;
  if (!Array.isArray(content) || !content.length || content.some(part => !object(part) || !['text', 'input_text'].includes(part.type) || typeof part.text !== 'string')) return null;
  const text = content.map(part => part.text).join('');
  return text.trim() ? text : null;
}
function usage(value, agent) {
  if (!object(value) || !count(value.input_tokens) || !count(value.output_tokens)) return null;
  if (agent === 'claude') {
    if (!count(value.cache_read_input_tokens) || !count(value.cache_creation_input_tokens)) return null;
    const inputTokens = value.input_tokens + value.cache_read_input_tokens + value.cache_creation_input_tokens;
    return count(inputTokens) ? { inputTokens, outputTokens: value.output_tokens } : null;
  }
  if (!count(value.total_tokens) || value.input_tokens + value.output_tokens !== value.total_tokens) return null;
  if ('cached_input_tokens' in value && (!count(value.cached_input_tokens) || value.cached_input_tokens > value.input_tokens)) return null;
  if ('cache_write_input_tokens' in value && (!count(value.cache_write_input_tokens) || value.cache_write_input_tokens > value.input_tokens)) return null;
  if ('reasoning_output_tokens' in value && (!count(value.reasoning_output_tokens) || value.reasoning_output_tokens > value.output_tokens)) return null;
  return { inputTokens: value.input_tokens, outputTokens: value.output_tokens };
}

export function previewContextEvidence(text, { agent, repo = '', repos = [] } = {}) {
  const issues = new Set(), issue = value => issues.add(value);
  const result = measurement => ({ applicable: issues.size === 0 && !!measurement, measurement: issues.size ? null : measurement, issues: [...issues] });
  if (!Object.hasOwn(TYPES, agent)) { issue('Select Claude Code or Codex.'); return result(null); }
  const selected = repo === '' ? null : directory(repo), roots = Array.isArray(repos) ? repos.map(value => directory(typeof value === 'string' ? value : value?.path)) : [];
  if (typeof repo !== 'string' || !Array.isArray(repos) || repos.length > 2000 || roots.some(root => !root) || repo && (!selected || !roots.some(root => root.windows === selected.windows && root.key === selected.key))) { issue('Select a known repository or global scope.'); return result(null); }
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BYTES) { issue('Session evidence exceeds the 2 MiB limit.'); return result(null); }
  const rows = text.split('\n').filter(line => line.trim());
  if (rows.length > MAX_RECORDS) { issue('Session evidence exceeds the 20000-record limit.'); return result(null); }
  let records;
  try { records = rows.map(parseRecord); } catch { issue('Session evidence contains malformed, duplicate-key or truncated JSON records.'); return result(null); }
  let session = null, launch = null, model = null, version = null, prompt = null, userId = null, first = null, hasContext = false, hasMeta = false, codexUsers = 0;
  let rootSession = null, currentTurn = null, rootTurn = null;
  const claudeChain = new Map();
  const responseUsages = new Map();
  const modern = agent === 'codex' && records.some(record => record?.type === 'token_usage_record');
  const userEvents = agent === 'codex' && records.some(record => record?.type === 'event_msg' && record.payload?.type === 'user_message');
  const authoredUserItems = agent === 'codex' && records.some(record => record?.type === 'response_item' && record.payload?.type === 'message' && record.payload?.role === 'user' && object(record.metadata) && 'user_input_order' in record.metadata);
  function identity(value) {
    if (!label(value)) issue('Session identity is missing or invalid.');
    else if (session && value !== session) issue('Multiple parent sessions cannot supply one measurement.');
    else session = value;
  }
  function scope(value) {
    const current = directory(value);
    if (!current) { issue('Session launch directory is missing or invalid.'); return; }
    const matched = roots.filter(root => within(current, root)).sort((a, b) => b.key.length - a.key.length)[0];
    if (selected ? !matched || matched.key !== selected.key || matched.windows !== selected.windows : !!matched) issue('The session does not belong to the selected repository scope.');
    if (launch && (launch.key !== current.key || launch.windows !== current.windows)) issue('The launch directory changed within these records.');
    else launch = current;
  }
  function metadata(value, type) {
    if (value === undefined) return;
    const clean = label(value);
    if (!clean) { issue('Agent model or version metadata is invalid.'); return; }
    if (type === 'model') { if (model && model !== clean) issue('The model changed within these records.'); else model = clean; }
    else { if (version && version !== clean) issue('The agent version changed within these records.'); else version = clean; }
  }
  function user(content, id) {
    if (first) return;
    const value = promptText(content);
    if (!value) { issue('The first user request must contain identifiable text only.'); return; }
    const digest = hash(value);
    if (prompt && prompt !== digest) issue('Multiple user requests precede the first measured request.');
    if (userId && id && userId !== id) issue('Multiple user requests precede the first measured request.');
    prompt = digest; if (id) userId = id;
  }
  function freshClaudeChain(head, requiredUser) {
    const visited = new Set(); let found = false;
    while (head !== null) {
      if (!label(head) || visited.has(head)) return false;
      visited.add(head);
      const entry = claudeChain.get(head);
      if (!entry || !['user', 'attachment'].includes(entry.type)) return false;
      if (entry.type === 'user') {
        if (head !== requiredUser || found) return false;
        found = true;
      }
      head = entry.parent;
    }
    return found;
  }
  function response(raw, id, record, capacity = null) {
    const values = usage(raw, agent);
    if (!values || !label(id)) { issue('Request token counters or response identity are invalid.'); return; }
    const signature = JSON.stringify(values);
    if (responseUsages.has(id)) { if (responseUsages.get(id) !== signature) issue('Duplicate request counters conflict.'); return; }
    responseUsages.set(id, signature);
    if (first) return;
    if (!session || !launch || !prompt || !model || agent === 'codex' && (!hasMeta || !hasContext)) { issue('The first request lacks preceding session, prompt, model or launch evidence.'); return; }
    if (capacity !== null && (!count(capacity) || capacity === 0 || values.inputTokens > capacity)) { issue('Reported context capacity is invalid.'); return; }
    const measuredAt = timestamp(record.timestamp);
    if (!measuredAt) { issue('The first request has no valid observation timestamp.'); return; }
    first = { agent, repo, launchDirectory: launch.name, sessionId: hash(agent + ':' + session), model, agentVersion: version, promptHash: prompt, ...values, capacity, measuredAt, method: agent + '-first-request-input', limitations: LIMITATIONS };
  }
  for (const record of records) {
    if (!object(record) || !TYPES[agent].has(record.type)) { issue('Unsupported session record structure.'); continue; }
    const payload = object(record.payload) ? record.payload : {}, message = object(record.message) ? record.message : {};
    const sources = [record, payload, message];
    if (sources.some(source => source.isSidechain === true || source.is_sidechain === true || 'agentId' in source || source.source === 'subagent' || object(source.source) && 'subagent' in source.source || source.parent_thread_id != null || source.subagent_history_start_ordinal != null)) issue('Subagent or sidechain records cannot establish a parent startup measurement.');
    if (sources.some(source => 'isSidechain' in source && typeof source.isSidechain !== 'boolean' || 'is_sidechain' in source && typeof source.is_sidechain !== 'boolean')) issue('Sidechain metadata is invalid.');
    if (!first && (['summary', 'compacted', 'retained_context'].includes(record.type) || ['compact_boundary', 'context_compacted', 'compaction'].includes(payload.type) || record.subtype === 'compact_boundary')) issue('Earlier retained or compacted history prevents identifying a fresh first request.');
    for (const source of sources) {
      if ('cwd' in source) scope(source.cwd);
      for (const key of agent === 'claude' ? ['sessionId', 'session_id'] : ['thread_id']) if (key in source) identity(source[key]);
    }
    if (agent === 'claude') {
      metadata(record.version, 'version');
      if (!first && label(record.uuid)) {
        const entry = { parent: record.parentUuid, type: record.type }, previous = claudeChain.get(record.uuid);
        if (previous && (previous.parent !== entry.parent || previous.type !== entry.type)) issue('Conflicting UUID links prevent identifying the initial request.');
        else claudeChain.set(record.uuid, entry);
      }
      if (record.type === 'user' && !first) {
        if (!label(record.uuid) || !freshClaudeChain(record.uuid, record.uuid) || !label(record.sessionId) || !directory(record.cwd)) issue('The first user record has no complete fresh parent-session chain.');
        user(message.content, record.uuid);
      }
      if (record.type === 'assistant') {
        metadata(message.model, 'model');
        if (!first && (!userId || !freshClaudeChain(record.parentUuid, userId))) issue('The first response is not linked to the initial user request through a complete attachment chain.');
        if (!label(record.sessionId) || !directory(record.cwd) || message.role !== 'assistant') issue('Assistant request metadata is incomplete.');
        response(message.usage, message.id, record);
      }
    } else {
      if (record.type === 'session_meta') {
        if (hasMeta) issue('Repeated session headers cannot establish a fresh session.');
        identity(payload.id); scope(payload.cwd); metadata(payload.cli_version, 'version'); hasMeta = true;
        if (modern) {
          rootSession = label(payload.session_id);
          if (!rootSession || rootSession !== session) issue('Modern parent session identity is missing or inconsistent.');
        }
        if (payload.forked_from_id != null || payload.resumed_from != null || payload.parent_session_id != null || payload.history_base != null || payload.forked_from_ordinal_exclusive != null) issue('Resumed, inherited or forked sessions do not establish a fresh baseline.');
      }
      if (record.type === 'turn_context') {
        if (!hasMeta) issue('Turn context precedes session metadata.');
        scope(payload.cwd); metadata(payload.model, 'model'); hasContext = true;
        if (modern) {
          const turn = label(payload.turn_id), root = payload.root_turn_id == null ? turn : label(payload.root_turn_id);
          if (!turn || !root) issue('Modern request turn identity is missing or invalid.');
          if (!first && currentTurn && turn !== currentTurn) issue('Multiple turns precede the first measured request.');
          currentTurn = turn; rootTurn = root;
        }
      }
      if (!userEvents && record.type === 'response_item' && payload.type === 'message' && payload.role === 'user') {
        // Paginated rollouts mark user input explicitly; unmarked user messages can be injected instructions.
        const authored = object(record.metadata) && 'user_input_order' in record.metadata;
        if (!authoredUserItems || authored) {
          if (!hasMeta) issue('The user request precedes session metadata.');
          if (!first && ++codexUsers > 1) issue('Multiple user requests precede the first measured request.');
          if (authored) {
            if (!Number.isSafeInteger(record.metadata.user_input_order) || record.metadata.user_input_order < 0) issue('User-input provenance is invalid.');
            const retained = record.metadata.retained_source?.id;
            if (retained && (retained.role !== 'user' || currentTurn && retained.turn_id !== currentTurn)) issue('User-input provenance does not match the initial turn.');
          }
          user(payload.content);
        }
      }
      if (record.type === 'event_msg' && payload.type === 'user_message') {
        if (!hasMeta) issue('The user request precedes session metadata.');
        if (!first && ++codexUsers > 1) issue('Multiple user requests precede the first measured request.');
        if (!first && ['images', 'image_details', 'file_ids', 'file_id_details', 'image_order', 'local_images', 'local_image_details', 'audio', 'local_audio'].some(key => payload[key] != null && (!Array.isArray(payload[key]) || payload[key].length))) issue('Multimodal user requests cannot supply text-only prompt comparison.');
        user(payload.message);
      }
      if (!first && record.type === 'response_item' && ['function_call_output', 'custom_tool_call_output'].includes(payload.type)) issue('Tool results precede the first request counter; startup coverage is incomplete.');
      if (record.type === 'token_usage_record') {
        if (payload.thread_id !== session) issue('Request usage does not match the parent session.');
        if (!rootSession || payload.session_id !== rootSession || !currentTurn || payload.turn_id !== currentTurn || !rootTurn || payload.root_turn_id !== rootTurn) issue('Request usage does not match the recorded session and turn identities.');
        response(payload.usage, payload.response_id, record, payload.model_context_window ?? null);
      }
      if (!modern && record.type === 'event_msg' && payload.type === 'token_count' && payload.info !== null) {
        const info = payload.info;
        response(info?.last_token_usage, 'legacy-' + responseUsages.size, record, info?.model_context_window ?? null);
      }
    }
  }
  if (!first) issue('No verifiable first parent request was found.');
  return result(first);
}

export function compareContextEvidence(before, after) {
  const issues = [];
  if (before?.method === 'kiro-reported-context-percentage' || after?.method === 'kiro-reported-context-percentage') return { comparable: false, issues: ['Kiro reports context percentage after the response without observed model identity or capacity. These readings cannot verify a startup token saving.'], reductionTokens: null, reductionPercentagePoints: null, limitations: COMPARISON_LIMITATIONS };
  if (!object(before) || !object(after)) return { comparable: false, issues: ['Choose two observed first-request measurements.'], reductionTokens: null, reductionPercentagePoints: null, limitations: COMPARISON_LIMITATIONS };
  if (!/^[a-f0-9]{64}$/.test(before.sessionId || '') || !/^[a-f0-9]{64}$/.test(after.sessionId || '') || before.sessionId === after.sessionId) issues.push('Use two distinct measured sessions.');
  for (const key of ['agent', 'repo', 'launchDirectory', 'method', 'model', 'agentVersion', 'promptHash']) {
    if (before[key] !== after[key] || (key !== 'repo' && (typeof before[key] !== 'string' || !before[key]))) issues.push('Matching ' + key + ' is required for comparison.');
  }
  if (!['claude-first-request-input', 'codex-first-request-input', 'omp-first-request-input', 'pi-first-request-input', 'opencode-first-request-input', 'kimi-first-request-input'].includes(before.method) || before.method !== before.agent + '-first-request-input') issues.push('Use a supported first-request measurement method.');
  if (!/^[a-f0-9]{64}$/.test(before.promptHash || '')) issues.push('An identifiable matching request is required.');
  if (before.launchFingerprint !== undefined || after.launchFingerprint !== undefined) {
    if (!/^[a-f0-9]{64}$/.test(before.launchFingerprint || '') || before.launchFingerprint !== after.launchFingerprint) issues.push('Matching managed launch profiles are required for comparison.');
  }
  if (!count(before.inputTokens) || !count(after.inputTokens)) issues.push('Both input measurements must be valid token counts.');
  if (before.capacity !== after.capacity || before.capacity !== null && (!count(before.capacity) || before.capacity === 0 || before.inputTokens > before.capacity || after.inputTokens > before.capacity)) issues.push('Reported capacities must match or both be unknown.');
  const comparable = issues.length === 0;
  return { comparable, issues, reductionTokens: comparable ? before.inputTokens - after.inputTokens : null, reductionPercentagePoints: comparable && before.capacity !== null ? (before.inputTokens - after.inputTokens) / before.capacity * 100 : null, limitations: COMPARISON_LIMITATIONS };
}
