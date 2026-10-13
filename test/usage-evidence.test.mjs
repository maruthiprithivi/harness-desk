import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {importUsage, componentCallEvidence} from '../lib/usage-evidence.mjs';

const repo = '/fixture/project', nested = repo + '/nested';
const at = '2026-10-07T12:00:00.000Z', now = Date.parse('2026-10-08T12:00:00.000Z');
const skill = (id = 'call-one', name = 'review') => ({type: 'tool_use', id, name: 'Skill', input: {skill: name, args: 'private-arguments-marker'}});
const mcp = (id = 'call-two', name = 'mcp__fixture__lookup') => ({type: 'tool_use', id, name, input: {query: 'private-arguments-marker'}});
const claude = (content, extra = {}) => ({type: 'assistant', sessionId: 'private-session-marker', cwd: repo, timestamp: at, message: {content}, ...extra});
const output = (id, is_error = false) => ({type: 'user', sessionId: 'private-session-marker', message: {content: [{type: 'tool_result', tool_use_id: id, is_error, content: 'private-output-marker'}]}});
const file = (records, name = 'session.json') => ({name, content: JSON.stringify(records)});
const run = (files, extra = {}) => importUsage({files, agent: 'claude', repo, repos: [repo], now, ...extra});
function metadataOnly(result) {
  const serialized = JSON.stringify(result);
  for (const value of ['private-session-marker', 'private-call-marker', 'private-arguments-marker', 'private-prompt-marker', 'private-output-marker', 'private-file-marker']) assert.equal(serialized.includes(value), false, value);
  assert.ok(result.items.every(item => Object.keys(item).every(key => ['kind', 'name', 'tool', 'calls', 'resultsSeen', 'failed', 'sessions', 'firstCall', 'lastCall'].includes(key))));
  assert.match(result.source, /tool calls are not proof of benefit/);
}

test('imports retain aggregate call metadata without filenames, identities or conversation bodies', async () => {
  const result = await run([file([
    claude([skill('private-call-marker'), mcp(), {type: 'text', text: 'private-prompt-marker'}]),
    output('private-call-marker'), output('call-two', true)
  ], 'private-file-marker.json')]);
  assert.deepEqual(result.files, {selected: 1, read: 1, skipped: 0});
  assert.deepEqual(result.totals, {calls: 2, resultsSeen: 2, failed: 1});
  assert.deepEqual(result.items.map(item => [item.kind, item.name, item.sessions]), [['mcp', 'fixture', 1], ['skill', 'review', 1]]);
  assert.equal(result.coverage.partial, false);
  assert.equal(result.coverage.records, 3);
  assert.equal(result.window.observedFrom, at);
  assert.equal(result.window.observedTo, at);
  metadataOnly(result);
});

test('Codex result presence and explicit error flags never infer success from output text', async () => {
  const call = id => ({type: 'response_item', timestamp: at, payload: {type: 'function_call', name: 'mcp__fixture__lookup', call_id: id, arguments: 'private-arguments-marker'}});
  const result = await run([file([
    {type: 'session_meta', payload: {id: 'private-session-marker', cwd: repo, instructions: 'private-prompt-marker'}},
    call('private-call-marker'), call('call-two'), call('call-three'),
    {type: 'response_item', payload: {type: 'function_call_output', call_id: 'private-call-marker', output: 'private-output-marker failed with exit code 1'}},
    {type: 'response_item', payload: {type: 'function_call_output', call_id: 'call-two', output: 'private-output-marker succeeded', is_error: true}}
  ])], {agent: 'codex'});
  assert.deepEqual(result.totals, {calls: 3, resultsSeen: 2, failed: 1});
  assert.equal(result.items[0].sessions, 1);
  assert.equal('successes' in result.totals, false);
  assert.equal('successful' in result.items[0], false);
  metadataOnly(result);
});

test('repository scope chooses the nearest scanned root and rejects prefix siblings and unknown directories', async () => {
  const records = [repo, repo + '/src', nested, nested + '/src', repo + '-other', '/fixture/unscanned', 'relative/path'].map((cwd, index) => claude([skill('call-' + index)], {cwd}));
  const parent = await run([file(records)], {repos: [repo, nested]});
  assert.equal(parent.totals.calls, 2);
  assert.equal(parent.coverage.excludedOtherScope, 2);
  assert.equal(parent.coverage.partial, true);
  const child = await run([file(records)], {repo: nested, repos: [repo, nested]});
  assert.equal(child.totals.calls, 2);
  assert.equal(child.coverage.excludedOtherScope, 2);
  assert.ok(!JSON.stringify(parent).includes('/fixture/unscanned'));
});

test('global imports count only explicit empty cwd and never borrow missing or unscanned context', async () => {
  const missing = claude([skill('missing')], {sessionId: 'missing-session'}); delete missing.cwd;
  const result = await run([file([
    claude([skill('global')], {cwd: ''}), missing,
    claude([skill('local')]), claude([skill('unknown')], {cwd: '/fixture/unscanned'})
  ])], {repo: ''});
  assert.equal(result.totals.calls, 1);
  assert.equal(result.coverage.excludedOtherScope, 1);
  assert.equal(result.coverage.partial, true);
  assert.equal(result.items[0].sessions, 1);
});

test('Windows working scopes normalize drive case and separators while respecting nearest roots', async () => {
  const root = 'C:\\fixture\\project', child = root + '\\nested', share = '\\\\fixture-host\\share\\project';
  const records = ['c:/FIXTURE/PROJECT/src', 'C:/fixture/project/nested/src', 'C:\\fixture\\project-other', '\\\\FIXTURE-HOST\\SHARE\\PROJECT\\src', '//fixture-host/share/project/src'].map((cwd, index) => claude([skill('call-' + index)], {cwd}));
  for (const selected of [root, child, share]) {
    const result = await run([file(records)], {repo: selected, repos: [root, child, share]});
    assert.equal(result.totals.calls, selected === share ? 2 : 1);
    assert.equal(result.coverage.excludedOtherScope, selected === share ? 2 : 3);
    assert.equal(result.coverage.partial, true);
  }
});

test('duplicate exports merge result flags once and repeated imports keep the same aggregate counts', async () => {
  const record = claude([skill()]);
  const files = [file([record]), {name: 'second.jsonl', content: [record, output('call-one', true), claude([skill()], {sessionId: 'second-session'})].map(JSON.stringify).join('\n')}];
  const result = await run(files);
  assert.deepEqual(result.totals, {calls: 2, resultsSeen: 1, failed: 1});
  assert.equal(result.items[0].sessions, 2);
  assert.deepEqual(await run(files), result);
  assert.equal((await run([...files, file([record, output('call-one')], 'copy.json')])).totals.calls, 2);
});

test('conflicting names for a duplicate identity are excluded across files and cannot be revived', async () => {
  const first = claude([skill('conflict', 'review'), skill('valid', 'keep')]);
  const result = await run([file([first]), file([claude([skill('conflict', 'different')])], 'different.json'), file([first], 'copy.json')]);
  assert.deepEqual(result.items.map(item => [item.name, item.calls]), [['keep', 1]]);
  assert.equal(result.coverage.partial, true);
  assert.match(result.coverage.issues.join(' '), /Conflicting duplicate/);
  const other = '/fixture/other';
  for (const name of ['review', 'different']) {
    const scopes = await run([file([claude([skill('conflict', 'review')])]), file([claude([skill('conflict', name)], {cwd: other})], 'other.json')], {repos: [repo, other]});
    assert.equal(scopes.totals.calls, 0);
    assert.equal(scopes.coverage.partial, true);
  }
  const timestamps = await run([file([claude([skill('conflict')])]), file([claude([skill('conflict')], {timestamp: '2026-10-06T12:00:00.000Z'})], 'changed-time.json')]);
  assert.equal(timestamps.totals.calls, 0);
  assert.equal(timestamps.coverage.partial, true);
  const conflicted = file([claude([skill('conflict', 'review'), skill('conflict', 'different')])]);
  const copy = file([claude([skill('conflict', 'review')])], 'copy.json');
  for (const files of [[conflicted, copy], [copy, conflicted]]) {
    const excluded = await run(files);
    assert.equal(excluded.totals.calls, 0);
    assert.equal(excluded.coverage.partial, true);
    metadataOnly(excluded);
  }
});

test('window boundaries are inclusive and all-record imports still exclude future calls', async () => {
  const stamps = ['2026-10-07T11:59:59.999Z', at, new Date(now).toISOString(), '2026-10-08T12:00:00.001Z'];
  const records = stamps.map((timestamp, index) => claude([skill('call-' + index)], {timestamp}));
  const day = await run([file(records)], {days: 1});
  assert.deepEqual(day.totals, {calls: 2, resultsSeen: 0, failed: 0});
  assert.equal(day.coverage.excludedOutsideWindow, 2);
  assert.equal(day.window.observedFrom, at);
  assert.equal(day.window.observedTo, new Date(now).toISOString());
  const all = await run([file(records)], {days: 'all'});
  assert.equal(all.window.from, null);
  assert.equal(all.totals.calls, 3);
  assert.equal(all.coverage.excludedOutsideWindow, 1);
});

test('forbidden, oversize and malformed files yield generic partial coverage with bounded reads', async () => {
  const result = await run([
    file([claude([skill()])], 'authentication.json'),
    {name: 'oversize.json', content: ' '.repeat(2 * 1024 * 1024 + 1)},
    {name: 'malformed.jsonl', content: '{private-prompt-marker\n' + JSON.stringify(claude([skill()]))},
    {name: 'unsupported.txt', content: 'private-output-marker'}
  ]);
  assert.deepEqual(result.files, {selected: 4, read: 1, skipped: 3});
  assert.equal(result.totals.calls, 1);
  assert.equal(result.coverage.records, 2);
  assert.equal(result.coverage.partial, true);
  metadataOnly(result);
  const records = JSON.stringify([claude([skill()])]);
  const padded = records + ' '.repeat(2 * 1024 * 1024 - Buffer.byteLength(records));
  const bounded = await run(Array.from({length: 5}, (_, index) => ({name: 'part-' + index + '.json', content: padded})));
  assert.deepEqual(bounded.files, {selected: 5, read: 4, skipped: 1});
  assert.equal(bounded.totals.calls, 1);
  assert.equal(bounded.coverage.partial, true);
});

test('path imports reject links and invalid UTF-8 without echoing source paths or contents', async t => {
  const directory = await fs.realpath(await fs.mkdtemp('/tmp/harness-usage-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const regular = path.join(directory, 'regular.json'), linked = path.join(directory, 'linked.json');
  await fs.writeFile(regular, JSON.stringify([claude([skill()])]));
  await fs.writeFile(linked, JSON.stringify([claude([skill('linked')])]));
  await fs.link(linked, path.join(directory, 'hard.json'));
  await fs.symlink(regular, path.join(directory, 'symbolic.json'));
  await fs.mkdir(path.join(directory, 'source'));
  await fs.writeFile(path.join(directory, 'source', 'session.json'), JSON.stringify([claude([skill('directory')])]));
  await fs.symlink(path.join(directory, 'source'), path.join(directory, 'alias'));
  const invalid = path.join(directory, 'invalid-utf8.json');
  await fs.writeFile(invalid, Buffer.concat([Buffer.from('["private-output-marker'), Buffer.from([0xff]), Buffer.from('"]')]));
  const result = await importUsage({paths: [regular, regular, linked, path.join(directory, 'hard.json'), path.join(directory, 'symbolic.json'), path.join(directory, 'alias', 'session.json'), invalid], agent: 'claude', repo, repos: [repo], now});
  assert.deepEqual(result.files, {selected: 6, read: 1, skipped: 5});
  assert.equal(result.totals.calls, 1);
  assert.equal(result.coverage.partial, true);
  assert.equal(JSON.stringify(result).includes(directory), false);
  assert.equal(JSON.stringify(result).includes('private-output-marker'), false);
});

test('skill evidence distinguishes one discovered file from duplicate names without claiming body verification', () => {
  const item = {type: 'skill', name: 'review', path: '/fixture/skills/review/SKILL.md'};
  const usage = {items: [{kind: 'skill', name: 'review', calls: 2}, {kind: 'skill', name: 'other', calls: 1}, {kind: 'mcp', name: 'review', calls: 3}]};
  const unique = componentCallEvidence(item, [item, {type: 'config', name: 'review'}], usage);
  assert.deepEqual(unique.matches, [usage.items[0]]);
  assert.equal(unique.ambiguous, false);
  assert.match(unique.attribution, /body version unverified/);
  const duplicate = componentCallEvidence(item, [item, {...item, path: '/fixture/other/review/SKILL.md'}], usage);
  assert.deepEqual(duplicate.matches, unique.matches);
  assert.equal(duplicate.ambiguous, true);
  assert.match(duplicate.attribution, /source file unresolved/);
  assert.equal(componentCallEvidence(item, [item], null), null);
});

test('MCP evidence associates snapshot server names only and leaves effective configuration unresolved', () => {
  const usage = {items: [{kind: 'mcp', name: 'fixture', tool: 'lookup', calls: 2}, {kind: 'mcp', name: 'other', tool: 'lookup', calls: 1}, {kind: 'skill', name: 'fixture', calls: 3}]};
  const item = {type: 'config', name: 'settings', toolInspection: {servers: [{name: 'fixture', configuredEnabled: false}]}};
  const evidence = componentCallEvidence(item, [item], usage);
  assert.deepEqual(evidence.matches, [usage.items[0]]);
  assert.equal(evidence.ambiguous, true);
  assert.match(evidence.attribution, /configuration snapshot; effective source file unverified/);
  assert.equal(componentCallEvidence({type: 'config', name: 'fixture'}, [], usage), null);
  assert.deepEqual(componentCallEvidence({...item, toolInspection: {servers: []}}, [], usage).matches, []);
});
