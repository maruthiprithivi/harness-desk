import test from 'node:test';
import assert from 'node:assert/strict';
import { previewSessionMetrics } from '../lib/session-metrics.mjs';

const repo = '/fixture/repo', repos = [repo, '/fixture/other', repo + '/nested'];
const options = agent => ({ agent, repo, repos });
const lines = records => records.map(record => JSON.stringify(record)).join('\n');
const inspect = (agent, records, overrides = {}) => previewSessionMetrics(lines(records), { ...options(agent), ...overrides });
const claude = (id = 'response-one', usage = {}) => ({
  type: 'assistant', sessionId: 'fixture-session', cwd: repo,
  message: { id, role: 'assistant', usage: { input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 30, output_tokens: 4, ...usage } }
});
const meta = (cwd = repo, id = 'fixture-thread') => ({ type: 'session_meta', payload: { id, cwd } });
const context = cwd => ({ type: 'turn_context', payload: { cwd } });
const response = (id = 'response-one', usage = {}) => ({
  type: 'token_usage_record', payload: { thread_id: 'fixture-thread', response_id: id, usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14, ...usage } }
});
const snapshot = (input = 10, output = 4) => ({
  type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: input, output_tokens: output, total_tokens: input + output } } }
});
const blocked = value => {
  assert.equal(value.applicable, false);
  assert.equal(value.totalTokens, null);
  assert.equal(value.coverage.partial, true);
  assert.ok(value.coverage.issues.length > 0);
};

test('Claude counts cache-inclusive parent usage once per response and emits only the whitelist', () => {
  const first = claude();
  first.message.content = 'PRIVATE-PROMPT-MARKER\n\tterminal:' + String.fromCharCode(27) + '[31m';
  first.message.model = 'PRIVATE-MODEL-MARKER';
  first.message.usage.cache_creation = { ephemeral_5m_input_tokens: 999, ephemeral_1h_input_tokens: 999 };
  first.message.usage.iterations = [{ input_tokens: 999, output_tokens: 999 }];
  const zero = claude('response-zero', { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 });
  const records = [first, structuredClone(first), zero], before = JSON.stringify(records);
  const result = inspect('claude', records);
  assert.equal(result.totalTokens, 64);
  assert.equal(result.method, 'claude-response-sum');
  assert.equal(result.applicable, true);
  assert.deepEqual(result.coverage, { records: 3, responses: 2, partial: false, issues: [] });
  assert.deepEqual(Object.keys(result).sort(), ['agent', 'applicable', 'counter', 'coverage', 'interpretation', 'method', 'repo', 'totalTokens'].sort());
  assert.match(result.interpretation, /Cached input is counted where reported; tokens are not billed cost/);
  for (const marker of ['PRIVATE-PROMPT-MARKER', 'PRIVATE-MODEL-MARKER', 'fixture-session', 'response-one', 'ephemeral_5m']) assert.ok(!JSON.stringify(result).includes(marker));
  assert.equal(JSON.stringify(records), before);
});

test('Claude conflicting duplicates and incomplete response metadata cannot supply an applicable counter', () => {
  const conflict = claude(); conflict.message.usage.output_tokens++;
  const result = inspect('claude', [claude(), conflict]); blocked(result); assert.equal(result.coverage.responses, 1);
  for (const change of [
    record => delete record.sessionId,
    record => delete record.cwd,
    record => delete record.message.id,
    record => delete record.message.usage.cache_read_input_tokens,
    record => { record.message.role = 'user'; },
    record => { record.isSidechain = 'false'; }
  ]) {
    const invalid = claude('response-invalid'); change(invalid);
    const partial = inspect('claude', [claude(), invalid]); blocked(partial); assert.equal(partial.coverage.responses, 1);
  }
});

test('Claude excludes child records and rejects mixed session or declared scope even outside usage', () => {
  for (const change of [
    record => { record.sessionId = 'another-session'; },
    record => { record.cwd = '/fixture/other'; },
    record => { record.message.cwd = '/fixture/other'; },
    record => { record.isSidechain = true; },
    record => { record.agentId = 'child-agent'; }
  ]) {
    const invalid = claude('response-invalid'); change(invalid);
    const result = inspect('claude', [claude(), invalid]); blocked(result); assert.equal(result.coverage.responses, 1);
  }
  blocked(inspect('claude', [claude(), { type: 'user', sessionId: 'another-session', cwd: repo, message: { content: 'PRIVATE-USER-MARKER' } }]));
});

test('Codex modern responses ignore snapshots and aggregates, accept same-scope turns, and count unique responses', () => {
  const first = response();
  first.payload.session_id = 'execution-session-distinct-from-thread';
  first.payload.usage.cached_input_tokens = 7;
  first.payload.usage.cache_write_input_tokens = 3;
  first.payload.usage.reasoning_output_tokens = 2;
  first.payload.turn_token_usage = { input_tokens: 900, output_tokens: 900, total_tokens: 1800 };
  first.payload.thread_token_usage = { input_tokens: 9000, output_tokens: 9000, total_tokens: 18000 };
  const ignored = snapshot(); ignored.payload.info = { total_token_usage: 'unsupported-snapshot', last_token_usage: { total_tokens: -1 } };
  const records = [meta(), ignored, context(repo + '/folder'), first, structuredClone(first), context(repo), response('response-two'), { type: 'compacted', payload: {} }];
  const result = inspect('codex', records);
  assert.equal(result.totalTokens, 28);
  assert.equal(result.applicable, true);
  assert.equal(result.method, 'codex-response-sum');
  assert.equal(result.coverage.responses, 2);
  for (const type of ['inter_agent_communication', 'inter_agent_communication_metadata', 'retained_context', 'world_state', 'security_risk_score', 'realtime_item']) {
    assert.equal(inspect('codex', [meta(), { type, payload: { content: 'PRIVATE-IGNORED-MARKER' } }, response()]).applicable, true);
  }
});

test('Codex modern usage must match parent thread and valid component bounds without legacy fallback', () => {
  const conflict = response(); conflict.payload.usage = { input_tokens: 11, output_tokens: 4, total_tokens: 15 };
  blocked(inspect('codex', [meta(), response(), conflict]));
  for (const change of [
    record => { record.payload.thread_id = 'different-thread'; },
    record => delete record.payload.thread_id,
    record => delete record.payload.response_id,
    record => delete record.payload.usage.input_tokens,
    record => { record.payload.usage.total_tokens = 15; },
    record => { record.payload.usage.cached_input_tokens = 11; },
    record => { record.payload.usage.reasoning_output_tokens = 5; },
    record => { record.payload.cwd = '/fixture/other'; }
  ]) {
    const invalid = response('response-invalid'); change(invalid);
    const result = inspect('codex', [meta(), response(), snapshot(500, 200), invalid]);
    blocked(result); assert.equal(result.method, 'codex-response-sum'); assert.equal(result.coverage.responses, 1);
  }
  const malformed = response(); delete malformed.payload.usage;
  const result = inspect('codex', [meta(), snapshot(500, 200), malformed]);
  blocked(result); assert.equal(result.method, 'codex-response-sum'); assert.equal(result.coverage.responses, 0);
});

test('Codex response coverage requires validated primary session metadata', () => {
  const incomplete = meta(); incomplete.payload.thread_id = 'fixture-thread'; delete incomplete.payload.id;
  const result = inspect('codex', [incomplete, response()]);
  blocked(result); assert.equal(result.coverage.responses, 0);
  const unknown = meta('/fixture/unknown'); unknown.payload.thread_id = 'fixture-thread';
  const withDeclaredScope = response(); withDeclaredScope.payload.cwd = repo;
  const invalidScope = inspect('codex', [unknown, withDeclaredScope]);
  blocked(invalidScope); assert.equal(invalidScope.coverage.responses, 0);
});

test('Codex child metadata cannot qualify as a parent counter', () => {
  for (const fields of [
    { source: { subagent: { kind: 'fixture-child' } } },
    { parent_thread_id: 'parent-thread' },
    { subagent_history_start_ordinal: 0 }
  ]) {
    const child = meta(); Object.assign(child.payload, fields);
    const result = inspect('codex', [child, response()]); blocked(result); assert.equal(result.coverage.responses, 0);
  }
  assert.equal(inspect('codex', [meta(), response()]).applicable, true);
});

test('Codex legacy cumulative snapshots use the last monotonic total, including known zero, rather than summing', () => {
  const first = snapshot(10, 4); first.payload.info.last_token_usage = { total_tokens: 99999 };
  const result = inspect('codex', [meta(), first, context(repo + '/folder'), snapshot(20, 8), snapshot(20, 8), context(repo)]);
  assert.equal(result.totalTokens, 28);
  assert.equal(result.applicable, true);
  assert.equal(result.method, 'codex-cumulative-snapshot');
  assert.equal(result.coverage.responses, 0);
  assert.equal(inspect('codex', [meta(), snapshot(0, 0)]).totalTokens, 0);
  const incomplete = snapshot(); incomplete.payload.info.total_token_usage = { total_tokens: 14 };
  blocked(inspect('codex', [meta(), incomplete]));
});

test('Codex legacy rejects decreasing, compacted, malformed or unknown-context snapshots', () => {
  for (const records of [
    [meta(), snapshot(20, 8), snapshot(10, 4)],
    [meta(), snapshot(), { type: 'compacted', payload: {} }],
    [meta(), snapshot(), { type: 'event_msg', payload: { type: 'context_compacted' } }],
    [snapshot()],
    [meta(), snapshot(), context('/fixture/other')],
    [meta(), snapshot(), { type: 'event_msg', payload: null }]
  ]) blocked(inspect('codex', records));
  const invalid = snapshot(); invalid.payload.info.total_token_usage.output_tokens = -1;
  blocked(inspect('codex', [meta(), invalid]));
});

test('Codex legacy preserves known cumulative components across omitted optional fields', () => {
  for (const [key, firstValue, lowerValue] of [['cached_input_tokens', 10, 5], ['reasoning_output_tokens', 4, 3]]) {
    const first = snapshot(20, 5), omitted = snapshot(30, 7), last = snapshot(35, 7);
    first.payload.info.total_token_usage[key] = firstValue;
    last.payload.info.total_token_usage[key] = lowerValue;
    const decreasing = inspect('codex', [meta(), first, omitted, last]);
    blocked(decreasing);
    assert.ok(decreasing.coverage.issues.includes('Cumulative token snapshots decrease.'));
    last.payload.info.total_token_usage[key] = firstValue + 1;
    const monotonic = inspect('codex', [meta(), first, omitted, last]);
    assert.equal(monotonic.applicable, true);
    assert.equal(monotonic.totalTokens, 42);
  }
});

test('scope attribution uses nearest scanned repository boundaries and explicit global metadata', () => {
  for (const cwd of ['/fixture/repo/nested/subdir', '/fixture/repository', '/fixture/unknown', 'relative/folder', undefined, '/Fixture/repo']) {
    const record = claude(); if (cwd === undefined) delete record.cwd; else record.cwd = cwd;
    blocked(inspect('claude', [record]));
  }
  const nested = claude(); nested.cwd = repo + '/nested/subdir';
  assert.equal(inspect('claude', [nested], { repo: repo + '/nested' }).applicable, true);
  const global = claude(); global.cwd = '';
  assert.equal(inspect('claude', [global], { repo: '', repos: [] }).applicable, true);
  const unknown = claude(); unknown.cwd = '/fixture/unknown';
  blocked(inspect('claude', [unknown], { repo: '', repos: [] }));
  assert.equal(inspect('codex', [meta(), context(repo + '/folder'), response()]).applicable, true);
});

test('Windows drive and UNC scope attribution normalizes separators and case without filesystem reads', () => {
  const windowsRepo = 'C:\\Fixture\\Repo';
  const windows = claude(); windows.cwd = 'c:/fixture/REPO/folder';
  assert.equal(inspect('claude', [windows], { repo: windowsRepo, repos: [windowsRepo] }).applicable, true);
  windows.cwd = 'C:\\Fixture\\Repository';
  blocked(inspect('claude', [windows], { repo: windowsRepo, repos: [windowsRepo] }));
  const uncRepo = '\\\\fixture-server\\share\\repo';
  windows.cwd = '//FIXTURE-SERVER/share/REPO/folder';
  assert.equal(inspect('claude', [windows], { repo: uncRepo, repos: [uncRepo] }).applicable, true);
});

test('JSON and JSONL reject ambiguous, malformed or unsupported structures without echoing their contents', () => {
  assert.equal(previewSessionMetrics(JSON.stringify(claude()), { ...options('claude'), format: 'json' }).applicable, true);
  assert.equal(previewSessionMetrics(JSON.stringify([claude()]), { ...options('claude'), format: 'json' }).applicable, true);
  for (const text of [
    '{"type":"assistant","type":"user","PRIVATE-MALFORMED-MARKER":1}',
    '{"type":"assistant","t\\u0079pe":"user"}',
    '[null]',
    '{"messages":[]}',
    '{"type":"assistant",',
    '"PRIVATE-MALFORMED-MARKER"',
    '['.repeat(65) + '0' + ']'.repeat(65)
  ]) {
    const result = previewSessionMetrics(text, { ...options('claude'), format: 'json' }); blocked(result);
    assert.ok(!JSON.stringify(result).includes('PRIVATE-MALFORMED-MARKER'));
  }
  const result = previewSessionMetrics(lines([claude()]) + '\n{PRIVATE-MALFORMED-MARKER', options('claude'));
  blocked(result); assert.equal(result.coverage.records, 2); assert.equal(result.coverage.responses, 1);
  assert.ok(!JSON.stringify(result).includes('PRIVATE-MALFORMED-MARKER'));
  for (const value of [String.fromCharCode(0), String.fromCharCode(27), String.fromCharCode(0xd800)]) {
    const invalid = claude(); invalid.cwd += value;
    blocked(inspect('claude', [invalid]));
    invalid.cwd = repo; invalid.sessionId += value;
    blocked(inspect('claude', [invalid]));
  }
  blocked(previewSessionMetrics(lines([claude()]) + String.fromCharCode(0), options('claude')));
});

test('numeric and selection bounds reject unsafe totals while accepting the exact maximum', () => {
  for (const value of [-1, 0.5, '4', null, 1000000001, Number.MAX_SAFE_INTEGER]) {
    const invalid = claude(); invalid.message.usage.output_tokens = value;
    blocked(inspect('claude', [invalid]));
  }
  const max = claude('response-max', { input_tokens: 1000000000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 });
  assert.equal(inspect('claude', [max]).totalTokens, 1000000000);
  blocked(inspect('claude', [max, claude()]));
  const infinity = JSON.stringify(claude()).replace('"output_tokens":4', '"output_tokens":1e999');
  blocked(previewSessionMetrics(infinity, options('claude')));
  const oversized = previewSessionMetrics('x'.repeat(2 * 1024 * 1024 + 1), options('claude'));
  blocked(oversized); assert.ok(oversized.coverage.issues.includes('Selected data exceeds the preview limits.'));
  const excessive = previewSessionMetrics('{"type":"system"}\n'.repeat(20001), options('claude'));
  blocked(excessive); assert.equal(excessive.coverage.records, 20000); assert.ok(excessive.coverage.issues.includes('Selected data exceeds the preview limits.'));
});

test('invalid parser options throw generic errors and absent supported usage remains unknown', () => {
  for (const overrides of [
    { agent: 'PRIVATE-AGENT-MARKER' },
    { format: 'PRIVATE-FORMAT-MARKER' },
    { repo: '/fixture/PRIVATE-PATH-MARKER' },
    { repos: ['relative/PRIVATE-PATH-MARKER'] }
  ]) assert.throws(() => previewSessionMetrics('', { ...options('claude'), ...overrides }), error => !error.message.includes('PRIVATE-'));
  blocked(inspect('codex', [meta()]));
  blocked(inspect('claude', []));
});
