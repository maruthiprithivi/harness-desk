import test from 'node:test';
import assert from 'node:assert/strict';
import { previewContextEvidence, compareContextEvidence } from '../lib/context-evidence.mjs';

const repo = '/fixture/project', at = '2026-10-13T02:00:00.000Z';
const lines = records => records.map(record => JSON.stringify(record)).join('\n');
const preview = (agent, records, options = {}) => previewContextEvidence(lines(records), { agent, repo, repos: [repo], ...options });
function claude() {
  return [
    { type: 'user', sessionId: 'session-one', cwd: repo, uuid: 'user-one', parentUuid: null, version: '2.1.1', timestamp: at, message: { role: 'user', content: 'Check the fixture without changes.' } },
    { type: 'assistant', sessionId: 'session-one', cwd: repo, parentUuid: 'user-one', version: '2.1.1', timestamp: at, message: { id: 'response-one', role: 'assistant', model: 'model-one', content: [{ type: 'text', text: 'PRIVATE RESPONSE' }], usage: { input_tokens: 20, cache_read_input_tokens: 70, cache_creation_input_tokens: 10, output_tokens: 4 } } }
  ];
}
function codex(modern = true) {
  return [
    { type: 'session_meta', timestamp: at, payload: { id: 'session-one', session_id: 'session-one', cwd: repo, cli_version: '0.100.0' } },
    { type: 'turn_context', timestamp: at, payload: { cwd: repo, model: 'model-one', turn_id: 'turn-one' } },
    { type: 'response_item', timestamp: at, payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Check the fixture without changes.' }] } },
    modern ? { type: 'token_usage_record', timestamp: at, payload: { thread_id: 'session-one', session_id: 'session-one', turn_id: 'turn-one', root_turn_id: 'turn-one', response_id: 'response-one', usage: { input_tokens: 100, cached_input_tokens: 90, output_tokens: 4, total_tokens: 104 } } } : { type: 'event_msg', timestamp: at, payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 100, output_tokens: 4, total_tokens: 104 }, total_token_usage: { input_tokens: 900, output_tokens: 40, total_tokens: 940 }, model_context_window: 1000 } } }
  ];
}
function blocked(result, pattern) {
  assert.equal(result.applicable, false); assert.equal(result.measurement, null); assert.ok(result.issues.length);
  if (pattern) assert.match(result.issues.join(' '), pattern);
}

test('Claude measures cache-inclusive first input and retains only whitelisted metadata', () => {
  const records = claude(), before = structuredClone(records), result = preview('claude', records);
  assert.equal(result.applicable, true); assert.deepEqual(result.issues, []);
  assert.equal(result.measurement.inputTokens, 100); assert.equal(result.measurement.outputTokens, 4);
  assert.equal(result.measurement.capacity, null); assert.equal(result.measurement.agentVersion, '2.1.1');
  assert.match(result.measurement.sessionId, /^[a-f0-9]{64}$/); assert.match(result.measurement.promptHash, /^[a-f0-9]{64}$/);
  assert.match(result.measurement.limitations, /Not pure startup context/);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE RESPONSE|Check the fixture|session-one|user-one|response-one/);
  assert.deepEqual(records, before);
  assert.deepEqual(Object.keys(result.measurement).sort(), ['agent', 'repo', 'launchDirectory', 'sessionId', 'model', 'agentVersion', 'promptHash', 'inputTokens', 'outputTokens', 'capacity', 'measuredAt', 'method', 'limitations'].sort());
});

test('Codex uses first response input, never cumulative usage or cached input twice', () => {
  for (const modern of [true, false]) {
    const records = codex(modern), second = structuredClone(records.at(-1));
    if (modern) { second.payload.response_id = 'response-two'; second.payload.usage = { input_tokens: 800, output_tokens: 50, total_tokens: 850 }; }
    else { second.payload.info.last_token_usage = { input_tokens: 800, output_tokens: 50, total_tokens: 850 }; }
    records.push(second);
    const result = preview('codex', records); assert.equal(result.applicable, true);
    assert.equal(result.measurement.inputTokens, 100); assert.equal(result.measurement.outputTokens, 4);
    assert.equal(result.measurement.capacity, modern ? null : 1000);
  }
});

test('text string and block representations have matching prompt hashes without whitespace folding', () => {
  const records = claude(), text = records[0].message.content;
  const a = preview('claude', records).measurement;
  records[0].message.content = [{ type: 'text', text: text.slice(0, 9) }, { type: 'text', text: text.slice(9) }];
  assert.equal(preview('claude', records).measurement.promptHash, a.promptHash);
  records[0].message.content = text + '\n';
  assert.notEqual(preview('claude', records).measurement.promptHash, a.promptHash);
});

test('matching Codex event and response user representations identify the same prompt', () => {
  const records = codex(); records.splice(3, 0, { type: 'event_msg', payload: { type: 'user_message', message: 'Check the fixture without changes.' } });
  assert.equal(preview('codex', records).applicable, true);
  records[2].payload.content = [{ type: 'input_text', text: 'Injected project instruction text' }];
  assert.equal(preview('codex', records).measurement.promptHash, preview('codex', codex()).measurement.promptHash);
  records.splice(4, 0, { type: 'event_msg', payload: { type: 'user_message', message: 'Different prompt' } });
  blocked(preview('codex', records), /Multiple user/);
});

test('identical first usage duplicates do not change measurement; conflicting duplicates fail', () => {
  for (const agent of ['claude', 'codex']) {
    const records = agent === 'claude' ? claude() : codex(), duplicate = structuredClone(records.at(-1));
    records.push(duplicate); assert.equal(preview(agent, records).measurement.inputTokens, 100);
    if (agent === 'claude') duplicate.message.usage.input_tokens++;
    else { duplicate.payload.usage.input_tokens++; duplicate.payload.usage.total_tokens++; }
    blocked(preview(agent, records), /Duplicate/);
  }
});

test('missing first-request proof cannot be repaired by later counters', () => {
  for (const mutate of [records => records.shift(), records => { records[0].parentUuid = 'earlier-user'; }, records => { delete records[0].uuid; }, records => { records[1].parentUuid = 'different-user'; }, records => { records[0].message.content = [{ type: 'tool_result', content: 'prior result' }]; }, records => { delete records[1].message.usage.cache_read_input_tokens; }]) {
    const records = claude(); mutate(records); records.push(claude()[1]); blocked(preview('claude', records));
  }
  for (const mutate of [records => records.shift(), records => records.splice(1, 1), records => records.splice(2, 1), records => { records[0].payload.forked_from_id = 'earlier-session'; }, records => { records[1].payload.model = ''; }, records => { records[2].payload.content = [{ type: 'input_image', image_url: 'private' }]; }, records => { delete records[3].payload.usage; }]) {
    const records = codex(); mutate(records); records.push(codex()[3]); blocked(preview('codex', records));
  }
});

test('subagents, mixed sessions, scope changes, earlier compaction and malformed tails fail closed', () => {
  for (const mutate of [records => { records[0].isSidechain = true; }, records => { records[0].isSidechain = 'false'; }, records => { records[1].sessionId = 'other'; }, records => { records[1].cwd += '/nested'; }, records => records.unshift({ type: 'summary', summary: 'Earlier history' }), records => records.push({ type: 'future-unknown' })]) {
    const records = claude(); mutate(records); blocked(preview('claude', records));
  }
  for (const field of ['parent_thread_id', 'subagent_history_start_ordinal']) { const records = codex(); records[0].payload[field] = 'child'; blocked(preview('codex', records)); }
  const tail = lines(claude()) + '\n{"type":'; blocked(previewContextEvidence(tail, { agent: 'claude', repo, repos: [repo] }), /malformed/);
  const duplicateKey = lines(claude()).replace('"input_tokens":20', '"input_tokens":20,"input_tokens":1');
  blocked(previewContextEvidence(duplicateKey, { agent: 'claude', repo, repos: [repo] }), /duplicate-key/);
});

test('invalid counters, timestamps and capacities never become estimates', () => {
  for (const value of [-1, 0.5, 1e10, '100', null]) { const records = claude(); records[1].message.usage.input_tokens = value; blocked(preview('claude', records)); }
  for (const value of [0, -1, 50, '1000']) { const records = codex(false); records[3].payload.info.model_context_window = value; blocked(preview('codex', records), /capacity/); }
  for (const value of [undefined, '2026-02-30T02:00:00Z', 'yesterday']) { const records = claude(); records[1].timestamp = value; blocked(preview('claude', records), /timestamp/); }
  const cumulative = codex(false); delete cumulative[3].payload.info.last_token_usage; blocked(preview('codex', cumulative), /counters/);
  const cached = codex(); cached[3].payload.usage.cached_input_tokens = 101; blocked(preview('codex', cached));
});

test('nested and Windows launch scope retained, neighboring repositories excluded', () => {
  const records = claude(); for (const record of records) record.cwd = repo + '/src';
  assert.equal(preview('claude', records).measurement.launchDirectory, repo + '/src');
  blocked(preview('claude', records, { repos: [repo, repo + '/src'] }), /scope/);
  for (const record of records) record.cwd = '/fixture/project-other'; blocked(preview('claude', records), /scope/);
  for (const record of records) record.cwd = 'C:\\Fixture\\Project\\src';
  assert.equal(preview('claude', records, { repo: 'c:\\fixture\\project', repos: ['C:\\Fixture\\Project'] }).measurement.launchDirectory, 'C:\\Fixture\\Project\\src');
  blocked(preview('claude', claude(), { repo: '' }), /scope/);
  for (const record of records) record.cwd = '/fixture/new-folder';
  assert.equal(preview('claude', records, { repo: '' }).applicable, true);
});

test('bounds and unsupported agent are explicit', () => {
  blocked(previewContextEvidence('x'.repeat(2 * 1024 * 1024 + 1), { agent: 'codex' }), /2 MiB/);
  blocked(previewContextEvidence('{}\n'.repeat(20001), { agent: 'claude' }), /20000/);
  blocked(preview('other', []), /Select Claude/);
  blocked(preview('claude', []), /No verifiable/);
});

test('comparison gives input reduction and capacity percentage points only with matched conditions', () => {
  const before = preview('codex', codex(false)).measurement;
  const after = { ...before, sessionId: 'b'.repeat(64), inputTokens: 80 };
  const comparison = compareContextEvidence(before, after);
  assert.deepEqual(comparison, { comparable: true, issues: [], reductionTokens: 20, reductionPercentagePoints: 2, limitations: comparison.limitations });
  assert.match(comparison.limitations, /does not establish causality/);
  assert.equal(compareContextEvidence(after, before).reductionTokens, -20);
  assert.deepEqual(compareContextEvidence({ ...before, capacity: null }, { ...after, capacity: null }), { comparable: true, issues: [], reductionTokens: 20, reductionPercentagePoints: null, limitations: comparison.limitations });
  for (const [key, value] of Object.entries({ sessionId: before.sessionId, agent: 'claude', repo: '/other', launchDirectory: '/other', method: 'cumulative', model: 'other', agentVersion: null, promptHash: 'c'.repeat(64), capacity: 2000, inputTokens: -1 })) {
    const result = compareContextEvidence(before, { ...after, [key]: value }); assert.equal(result.comparable, false, key); assert.equal(result.reductionTokens, null, key);
  }
  assert.equal(compareContextEvidence({ ...before, agentVersion: null }, { ...after, agentVersion: null }).comparable, false);
  assert.equal(compareContextEvidence(null, after).comparable, false);
});

test('missing agent version permits observation but prevents comparison', () => {
  const records = claude(); for (const record of records) delete record.version;
  const result = preview('claude', records); assert.equal(result.applicable, true); assert.equal(result.measurement.agentVersion, null);
  assert.match(compareContextEvidence(result.measurement, { ...result.measurement, sessionId: 'b'.repeat(64) }).issues.join(' '), /agentVersion/);
});

test('Codex first-response tool calls are allowed, but prior tool results and duplicate turns are not', () => {
  const records = codex(); records.splice(3, 0, { type: 'response_item', payload: { type: 'function_call', name: 'fixture_tool', arguments: 'PRIVATE TOOL ARGUMENT' } });
  const result = preview('codex', records); assert.equal(result.applicable, true); assert.doesNotMatch(JSON.stringify(result), /PRIVATE TOOL ARGUMENT/);
  records[3].payload.type = 'function_call_output'; blocked(preview('codex', records), /Tool results/);
  const duplicate = codex(); duplicate.splice(3, 0, structuredClone(duplicate[2])); blocked(preview('codex', duplicate), /Multiple user/);
  const outOfOrder = codex(); outOfOrder.unshift(outOfOrder.splice(2, 1)[0]); blocked(preview('codex', outOfOrder), /precedes session/);
});

test('first input is never substituted with a later valid model, prompt or counter', () => {
  const records = codex(); delete records[1].payload.model;
  records.push({ type: 'turn_context', payload: { cwd: repo, model: 'model-one' } }, codex()[3]);
  blocked(preview('codex', records), /first request lacks/);
  const changed = codex(); changed.push({ type: 'turn_context', payload: { cwd: repo, model: 'model-two' } });
  blocked(preview('codex', changed), /model changed/);
});

test('Codex events with modality fields never compare as text-only prompts', () => {
  for (const field of ['images', 'image_details', 'file_ids', 'file_id_details', 'image_order', 'local_images', 'local_image_details', 'audio', 'local_audio']) {
    const records = codex(); records.splice(3, 0, { type: 'event_msg', payload: { type: 'user_message', message: 'Check the fixture without changes.', [field]: ['PRIVATE-MODALITY'] } });
    const result = preview('codex', records); blocked(result, /Multimodal/); assert.doesNotMatch(JSON.stringify(result), /PRIVATE-MODALITY/);
    records[3].payload[field] = []; assert.equal(preview('codex', records).applicable, true, field);
    records[3].payload[field] = 'invalid'; blocked(preview('codex', records), /Multimodal/);
  }
});

test('inherited history and explicit fork boundaries do not establish fresh context', () => {
  for (const [field, value] of [['history_base', {}], ['forked_from_ordinal_exclusive', 0]]) {
    const records = codex(); records[0].payload[field] = value; blocked(preview('codex', records), /inherited or forked/);
    records[0].payload[field] = null; assert.equal(preview('codex', records).applicable, true);
  }
});

test('modern usage is bound to initial parent session and turn identities', () => {
  for (const field of ['session_id', 'turn_id', 'root_turn_id']) {
    const records = codex(); records[3].payload[field] = 'another'; blocked(preview('codex', records), /identit/);
    delete records[3].payload[field]; blocked(preview('codex', records), /identit/);
  }
  for (const [index, field] of [[0, 'session_id'], [1, 'turn_id']]) {
    const records = codex(); delete records[index].payload[field]; blocked(preview('codex', records), /identity|identities/);
  }
  const root = codex(); root[1].payload.root_turn_id = 'root-turn'; blocked(preview('codex', root), /identities/);
  root[3].payload.root_turn_id = 'root-turn'; assert.equal(preview('codex', root).applicable, true);
  const turns = codex(); turns.splice(2, 0, { type: 'turn_context', payload: { cwd: repo, model: 'model-one', turn_id: 'earlier-turn' } });
  blocked(preview('codex', turns), /Multiple turns/);
  const distinct = codex(); distinct[0].payload.session_id = 'root-session'; distinct[3].payload.session_id = 'root-session';
  blocked(preview('codex', distinct), /parent session identity/);
});

test('Claude attachment chains before and after the root user preserve first-request identity', () => {
  const records = claude();
  records[0].parentUuid = 'attachment-before'; records[1].parentUuid = 'attachment-after';
  records.unshift({ type: 'attachment', uuid: 'attachment-before', parentUuid: null, sessionId: 'session-one', cwd: repo, attachment: { content: 'PRIVATE ATTACHMENT BEFORE' } });
  records.splice(2, 0, { type: 'attachment', uuid: 'attachment-after', parentUuid: 'user-one', sessionId: 'session-one', cwd: repo, attachment: { content: 'PRIVATE ATTACHMENT AFTER' } });
  const result = preview('claude', records); assert.equal(result.applicable, true);
  assert.equal(result.measurement.inputTokens, 100); assert.equal(result.measurement.promptHash, preview('claude', claude()).measurement.promptHash);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE ATTACHMENT/);
  for (const type of ['mode', 'permission-mode', 'atis-latch', 'ai-title', 'pr-link', 'cost-state']) {
    assert.equal(preview('claude', [{ type }, ...records, { type }]).applicable, true, type);
  }
});

test('Claude chain gaps, cycles, conflicting UUIDs and earlier user history fail closed', () => {
  for (const parent of [undefined, 'missing', 'attachment-after']) {
    const records = claude(); records[1].parentUuid = 'attachment-after'; records.splice(1, 0, { type: 'attachment', uuid: 'attachment-after', parentUuid: parent });
    blocked(preview('claude', records), /chain/);
  }
  const conflict = claude(); conflict.splice(1, 0, { type: 'attachment', uuid: 'user-one', parentUuid: null });
  blocked(preview('claude', conflict), /UUID/);
  const earlier = claude(), preceding = { ...structuredClone(earlier[0]), uuid: 'earlier-user' };
  earlier[0].parentUuid = 'earlier-user'; earlier.unshift(preceding); blocked(preview('claude', earlier), /chain|Multiple user/);
  const unrelated = claude(); unrelated.splice(1, 0, { type: 'attachment', uuid: 'unrelated', parentUuid: null }); unrelated[2].parentUuid = 'unrelated';
  blocked(preview('claude', unrelated), /chain/);
});

test('managed measurements compare only within the same valid launch profile', () => {
  const before = preview('codex', codex()).measurement, after = { ...before, sessionId: 'b'.repeat(64), inputTokens: 80 };
  for (const fingerprint of ['a'.repeat(64), 'bad-profile', null]) {
    assert.equal(compareContextEvidence({ ...before, launchFingerprint: fingerprint }, after).comparable, false);
    assert.equal(compareContextEvidence(before, { ...after, launchFingerprint: fingerprint }).comparable, false);
  }
  assert.equal(compareContextEvidence({ ...before, launchFingerprint: 'a'.repeat(64) }, { ...after, launchFingerprint: 'b'.repeat(64) }).comparable, false);
  assert.equal(compareContextEvidence({ ...before, launchFingerprint: 'a'.repeat(64) }, { ...after, launchFingerprint: 'a'.repeat(64) }).comparable, true);
});

test('paginated Codex user provenance separates injected guidance from the actual prompt', () => {
  const records = codex(), expected = preview('codex', records).measurement.promptHash;
  records[2].metadata = { user_input_order: 0, client_authored: true, retained_source: { id: { message_id: 'message-one', turn_id: 'turn-one', role: 'user' }, complete: true, revision: 'revision-one' } };
  records.splice(2, 0, { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'PRIVATE INJECTED INSTRUCTIONS' }, { type: 'input_text', text: 'PRIVATE ENVIRONMENT' }] } });
  const result = preview('codex', records); assert.equal(result.applicable, true); assert.equal(result.measurement.promptHash, expected);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE INJECTED|PRIVATE ENVIRONMENT/);
  for (const value of [-1, '0', null, 0.5]) { records[3].metadata.user_input_order = value; blocked(preview('codex', records), /provenance/); }
  records[3].metadata.user_input_order = 0; records[3].metadata.retained_source.id.turn_id = 'other-turn'; blocked(preview('codex', records), /provenance/);
});
