import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../lib/store.mjs';
import { createApp } from '../server.mjs';

async function fixture(t) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'mining-picker-api-')));
  const home = path.join(dir, 'fixture-home'), repo = path.join(dir, 'repos', 'one'), other = path.join(dir, 'repos', 'two');
  const claudeRoot = path.join(home, '.claude', 'projects', 'synthetic-project');
  const codexRoot = path.join(home, '.codex', 'sessions', '2020', '01', '02');
  for (const folder of [claudeRoot, codexRoot, repo, other]) await fs.mkdir(folder, { recursive: true });
  const configurations = [
    [path.join(repo, 'AGENTS.md'), 'Synthetic repository instructions unchanged.\n'],
    [path.join(repo, 'CLAUDE.md'), 'Synthetic Claude instructions unchanged.\n'],
    [path.join(other, 'AGENTS.md'), 'Synthetic other repository instructions unchanged.\n'],
    [path.join(home, '.claude', 'settings.json'), '{"fixture":"unchanged"}\n'],
    [path.join(home, '.codex', 'config.toml'), 'fixture = "unchanged"\n']
  ];
  for (const [file, content] of configurations) await fs.writeFile(file, content);
  const sensitive = ['sk', '-', 'syntheticcredential12345'].join('');
  const prompt = 'Count supplied fixture records using ' + sensitive;
  const unrelated = 'Summarize unrelated fixture colors with bounded output';
  const rawMarker = 'synthetic-full-record-private-marker';
  const claudeUser = (sessionId, uuid, text) => ({
    type: 'user', cwd: repo, sessionId, uuid, timestamp: '2020-01-01T00:00:00Z',
    rawRecordMarker: rawMarker, message: { role: 'user', content: text }
  });
  const files = {
    first: path.join(claudeRoot, 'selected-claude-first.jsonl'),
    second: path.join(claudeRoot, 'selected-claude-second.jsonl'),
    unselected: path.join(claudeRoot, 'unselected-claude.jsonl'),
    other: path.join(codexRoot, 'selected-codex-other.jsonl')
  };
  const records = {
    first: [
      claudeUser('synthetic-claude-session-one', 'turn-one-a', prompt),
      { type: 'assistant', cwd: repo, sessionId: 'synthetic-claude-session-one', uuid: 'assistant-one', rawRecordMarker: rawMarker, message: { role: 'assistant', content: rawMarker } },
      claudeUser('synthetic-claude-session-one', 'turn-one-b', prompt),
      claudeUser('synthetic-claude-session-one', 'turn-one-c', unrelated)
    ],
    second: [claudeUser('synthetic-claude-session-two', 'turn-two-a', prompt)],
    unselected: [
      claudeUser('synthetic-unselected-session', 'unselected-a', unrelated),
      claudeUser('synthetic-unselected-session', 'unselected-b', unrelated)
    ],
    other: [
      { type: 'session_meta', timestamp: '2020-01-02T00:00:00Z', payload: { id: 'synthetic-codex-session', cwd: other }, rawRecordMarker: rawMarker },
      { type: 'response_item', cwd: other, timestamp: '2020-01-02T00:00:01Z', uuid: 'codex-user-one', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }] }, rawRecordMarker: rawMarker }
    ]
  };
  for (const key of Object.keys(files)) await fs.writeFile(files[key], records[key].map(row => JSON.stringify(row)).join('\n'));
  const old = new Date('2020-01-02T00:00:00Z');
  await fs.utimes(files.other, old, old);
  const store = await new Store(path.join(dir, 'generated')).init();
  await store.saveSettings({ ...store.settings, repos: [repo, other], repoRoots: [] });
  let dispatches = 0;
  const app = await createApp({
    home, dataDir: store.root,
    probe: async () => ['claude', 'codex'].map(id => ({ id, installed: true, auth: 'unknown', dispatch: 'handoff', version: 'synthetic-version' })),
    dispatch: async () => { dispatches++; throw new Error('Unexpected synthetic agent dispatch'); }
  });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => app.server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const root = 'http://127.0.0.1:' + app.server.address().port;
  const state = () => fetch(root + '/api/state').then(response => response.json());
  const token = (await state()).csrfToken;
  const post = async (route, body, suppliedToken = token) => {
    const headers = { 'Content-Type': 'application/json' };
    if (suppliedToken !== null) headers['X-CSRF-Token'] = suppliedToken;
    const response = await fetch(root + route, { method: 'POST', headers, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await post('/api/scan', {})).status, 200);
  const settings = structuredClone(app.store.settings);
  const discover = async agent => {
    const result = await post('/api/session-files', { agent, repo });
    assert.equal(result.status, 200); assert.equal(result.body.rootStatus, 'available');
    return result.body;
  };
  const selected = async () => {
    const listings = [await discover('claude'), await discover('codex')];
    const found = new Map(listings.flatMap(listing => listing.files).map(file => [file.path, file]));
    return [files.first, files.second, files.other].map(file => {
      assert.equal(found.get(file)?.importable, true, 'Selected fixture should be discoverable');
      return found.get(file).path;
    });
  };
  const mine = async () => {
    const result = await post('/api/mine', { paths: await selected() });
    assert.equal(result.status, 200);
    return result.body;
  };
  const unchanged = async () => {
    assert.equal(dispatches, 0);
    for (const [file, content] of configurations) assert.equal(await fs.readFile(file, 'utf8'), content);
    assert.deepEqual(app.store.settings, settings);
    assert.equal(await app.store.read('usage-evidence.json'), null);
    assert.equal(Object.hasOwn(app.store.manifest, 'usage-evidence.json'), false);
    assert.deepEqual((await state()).conversations, []);
  };
  const patterns = () => app.store.read('patterns.json');
  return { app, dir, home, repo, other, claudeRoot, codexRoot, files, records, sensitive, unrelated, rawMarker, root, state, post, discover, selected, mine, patterns, unchanged };
}

function miningSummary(result) {
  return { at: result.at, files: result.files, coverage: result.coverage, warnings: result.warnings };
}
async function retained(f, before) {
  assert.deepEqual(await f.patterns(), before);
  const current = await f.state();
  assert.deepEqual(current.candidates, before.candidates);
  assert.deepEqual(current.mistakes, before.mistakes);
  assert.deepEqual(current.mining, miningSummary(before));
}

test('explicit metadata selection mines only selected files with scoped, redacted findings and no usage import', async t => {
  const f = await fixture(t), before = await f.state(), manifest = structuredClone(f.app.store.manifest);
  const claude = await f.discover('claude'), codex = await f.discover('codex');
  assert.deepEqual(claude.files.map(file => file.path).sort(), [f.files.first, f.files.second, f.files.unselected].sort());
  assert.deepEqual(codex.files.map(file => file.path), [f.files.other]);
  assert.equal(codex.files[0].modifiedAt, '2020-01-02T00:00:00.000Z');
  for (const file of [...claude.files, ...codex.files]) {
    assert.deepEqual(Object.keys(file).sort(), ['path', 'label', 'bytes', 'modifiedAt', 'importable'].sort());
    assert.equal(file.bytes, (await fs.stat(file.path)).size);
  }
  assert.equal(JSON.stringify([claude, codex]).includes(f.sensitive), false);
  assert.equal(JSON.stringify([claude, codex]).includes(f.rawMarker), false);
  assert.deepEqual(await f.state(), before);
  assert.deepEqual(f.app.store.manifest, manifest);
  const returned = new Map([...claude.files, ...codex.files].map(file => [file.path, file]));
  const selected = [f.files.first, f.files.second, f.files.other].map(file => returned.get(file).path);
  const response = await f.post('/api/mine', { paths: selected });
  assert.equal(response.status, 200);
  const result = response.body;
  assert.equal(result.files, 3);
  assert.ok(result.coverage.supportedRecords > 0);
  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0];
  assert.equal(candidate.kind, 'prompt');
  assert.equal(candidate.occurrences, 4);
  assert.equal(candidate.distinctSessions, 3);
  assert.equal(candidate.evidenceByRepo[f.repo].occurrences, 3);
  assert.equal(candidate.evidenceByRepo[f.repo].distinctSessions, 2);
  assert.deepEqual(candidate.evidenceByRepo[f.repo].agents, ['claude']);
  assert.equal(candidate.evidenceByRepo[f.other].occurrences, 1);
  assert.equal(candidate.evidenceByRepo[f.other].distinctSessions, 1);
  assert.deepEqual(candidate.evidenceByRepo[f.other].agents, ['codex']);
  assert.equal(JSON.stringify(result).includes(f.unrelated), false);
  const stored = await f.patterns();
  assert.deepEqual(stored, result);
  const output = JSON.stringify(stored);
  assert.equal(output.includes(f.sensitive), false);
  assert.match(output, /REDACTED/);
  assert.equal(output.includes(f.rawMarker), false);
  assert.equal(output.includes('rawRecordMarker'), false);
  assert.equal(Object.hasOwn(stored, 'records'), false);
  for (const rows of Object.values(f.records)) for (const row of rows) assert.equal(output.includes(JSON.stringify(row)), false);
  const current = await f.state();
  assert.deepEqual(current.mining, miningSummary(result));
  assert.equal(JSON.stringify(current).includes(f.sensitive), false);
  const scoped = await f.post('/api/context', { repo: f.repo, reviewAgent: 'claude', sections: ['patterns'] });
  assert.equal(scoped.status, 200);
  const local = JSON.parse(scoped.body.text).patterns.candidates;
  assert.equal(local.length, 1);
  assert.equal(local[0].occurrences, 3); assert.equal(local[0].distinctSessions, 2);
  assert.deepEqual(local[0].repos, [f.repo]);
  assert.equal(scoped.body.text.includes(f.other), false);
  const other = await f.post('/api/context', { repo: f.other, reviewAgent: 'codex', sections: ['patterns'] });
  assert.equal(other.status, 200); assert.deepEqual(JSON.parse(other.body.text).patterns.candidates, []);
  await f.unchanged();
});

test('CSRF rejection and a selected source disappearing after discovery preserve prior mining findings', async t => {
  const f = await fixture(t), before = await f.mine();
  const selected = await f.selected();
  for (const token of [null, 'incorrect-synthetic-token']) {
    assert.equal((await f.post('/api/mine', { paths: selected }, token)).status, 400);
    await retained(f, before);
  }
  await fs.unlink(f.files.other);
  const stale = await f.post('/api/mine', { paths: [selected[2]] });
  assert.equal(stale.status, 400);
  await retained(f, before);
  assert.ok((await f.state()).gaps.some(gap => gap.source === 'transcript mining' && gap.kind === 'failure'));
  await f.unchanged();
});

test('linked and oversized discovered sources remain unusable and cannot erase existing patterns', async t => {
  const f = await fixture(t), before = await f.mine();
  const hardlink = path.join(f.claudeRoot, 'hardlink-session.jsonl');
  const symlink = path.join(f.claudeRoot, 'symlink-session.jsonl');
  const oversized = path.join(f.claudeRoot, 'oversized-session.jsonl');
  await fs.link(f.files.first, hardlink);
  await fs.symlink(f.files.second, symlink);
  await fs.writeFile(oversized, 'x'.repeat(2 * 1024 * 1024 + 1));
  const listing = await f.discover('claude');
  assert.equal(listing.coverage.partial, true);
  for (const file of [f.files.first, hardlink, symlink]) assert.equal(listing.files.some(item => item.path === file), false);
  assert.equal(listing.files.find(item => item.path === oversized)?.importable, false);
  for (const file of [f.files.first, hardlink, symlink, oversized]) {
    assert.equal((await f.post('/api/mine', { paths: [file] })).status, 400);
    await retained(f, before);
  }
  await f.unchanged();
});

test('empty and unsupported selections retain findings while a valid zero-repeat selection replaces them', async t => {
  const f = await fixture(t), before = await f.mine();
  assert.equal((await f.post('/api/mine', { paths: [] })).status, 400);
  await retained(f, before);
  const unsupported = path.join(f.claudeRoot, 'unsupported-session.json');
  const malformed = path.join(f.claudeRoot, 'malformed-session.jsonl');
  const rejectedMarker = 'synthetic-rejected-record-private-marker';
  await fs.writeFile(unsupported, JSON.stringify({ unsupported: rejectedMarker }));
  await fs.writeFile(malformed, '{' + rejectedMarker);
  for (const file of [unsupported, malformed]) {
    const response = await f.post('/api/mine', { paths: [file] });
    assert.equal(response.status, 400);
    assert.equal(JSON.stringify(response.body).includes(rejectedMarker), false);
    await retained(f, before);
  }
  const failedState = await f.state();
  assert.ok(failedState.gaps.some(gap => gap.key === 'coverage:transcript mining' && gap.kind === 'coverage'));
  assert.equal(JSON.stringify(failedState).includes(rejectedMarker), false);
  const zero = path.join(f.claudeRoot, 'zero-repeat-session.jsonl');
  await fs.writeFile(zero, JSON.stringify({
    type: 'user', cwd: f.repo, sessionId: 'synthetic-zero-repeat-session', uuid: 'zero-user-turn',
    message: { role: 'user', content: 'Explain the unique synthetic fixture once' }
  }));
  const selected = (await f.discover('claude')).files.find(file => file.path === zero);
  assert.equal(selected?.importable, true);
  const response = await f.post('/api/mine', { paths: [selected.path] });
  assert.equal(response.status, 200);
  assert.equal(response.body.files, 1);
  assert.ok(response.body.coverage.supportedRecords > 0);
  assert.deepEqual(response.body.candidates, []);
  assert.deepEqual(response.body.mistakes, []);
  assert.deepEqual(await f.patterns(), response.body);
  const current = await f.state();
  assert.deepEqual(current.candidates, []);
  assert.deepEqual(current.mining, miningSummary(response.body));
  await f.unchanged();
});
