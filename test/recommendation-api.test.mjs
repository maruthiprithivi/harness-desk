import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../lib/store.mjs';
import { createApp } from '../server.mjs';

const NOTE_MARKER = 'SYNTHETIC-DECISION-NOTE';
const FORGED_MARKER = 'SYNTHETIC-FORGED-PROPOSAL';

async function fixture(t) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'recommendation-api-')));
  const home = path.join(dir, 'fixture-home'), repo = path.join(dir, 'repos', 'one'), other = path.join(dir, 'repos', 'two');
  const files = new Map([
    [path.join(home, 'AGENTS.md'), 'global-fixture-a '.repeat(2300)],
    [path.join(home, '.codex', 'skills', 'budget', 'SKILL.md'), '---\nname: budget\ndescription: ' + 'codex-fixture-a '.repeat(1400) + '\n---\nReview the synthetic fixture.\n'],
    [path.join(home, '.agents', 'skills', 'one', 'SKILL.md'), '---\nname: fixture\ndescription: Check a supplied fixture\n---\nRead the synthetic fixture.\n'],
    [path.join(home, '.agents', 'skills', 'two', 'SKILL.md'), '---\nname: fixture\ndescription: Check a supplied fixture\n---\nRead the synthetic fixture.\n'],
    [path.join(repo, 'CLAUDE.md'), 'claude-repo-a '.repeat(2700)],
    [path.join(repo, '.mcp.json'), JSON.stringify({ mcpServers: { fixture_server: { command: 'fixture-runner' } } })],
    [path.join(other, 'AGENTS.md'), 'Other scoped fixture a.\n']
  ]);
  for (const folder of [home, repo, other]) await fs.mkdir(folder, { recursive: true });
  for (const [file, content] of files) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content); }
  const store = await new Store(path.join(dir, 'generated')).init();
  await store.saveSettings({ ...store.settings, repos: [repo, other], repoRoots: [], scanIntervalMinutes: 0 });
  const settings = await fs.readFile(path.join(store.root, 'settings.json'));
  let dispatched = 0;
  const options = {
    home, dataDir: store.root,
    probe: async () => ['codex', 'claude'].map(id => ({ id, installed: false, auth: 'unknown', dispatch: 'handoff', version: '' })),
    dispatch: async () => { dispatched++; throw new Error('Unexpected synthetic provider request'); }
  };
  const servers = [];
  async function start() {
    const app = await createApp(options);
    await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(0, '127.0.0.1', resolve); });
    servers.push(app.server);
    const root = 'http://127.0.0.1:' + app.server.address().port;
    const state = () => fetch(root + '/api/state').then(response => response.json());
    const csrfToken = (await state()).csrfToken;
    const post = async (route, body) => {
      const response = await fetch(root + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };
    return { app, root, state, post };
  }
  t.after(async () => {
    for (const server of servers) if (server.listening) await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const current = await start();
  const scan = async () => {
    const response = await current.post('/api/scan', {});
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return response.body;
  };
  await scan();
  const globalFile = path.join(home, 'AGENTS.md'), codexFile = path.join(home, '.codex', 'skills', 'budget', 'SKILL.md');
  const localFile = path.join(repo, 'CLAUDE.md'), otherFile = path.join(other, 'AGENTS.md');
  const proposal = async file => {
    const state = await current.state(), item = state.inventory.items.find(item => item.path === file);
    assert.ok(item, file);
    const result = state.recommendations.find(record => record.itemId === item.id && record.title === 'Split large instruction file');
    assert.ok(result, file);
    return result;
  };
  const budget = async () => {
    const state = await current.state(), item = state.inventory.items.find(item => item.path === codexFile);
    assert.equal(item?.agent, 'codex'); assert.equal(item?.type, 'skill');
    assert.ok(item.residentTokens > state.settings.budgets.globalTokens);
    const result = state.recommendations.find(record => record.agent === 'codex' && record.scope === 'global' && record.confidence === 'estimate');
    assert.ok(result);
    return result;
  };
  const decide = (recommendation, patch = {}) => current.post('/api/recommendation', {
    id: recommendation.id, fingerprint: recommendation.fingerprint, agent: 'codex', repo,
    status: 'accepted', note: 'Manually reviewed synthetic proposal. ' + NOTE_MARKER, ...patch
  });
  const mutate = async (file, content) => {
    const stat = await fs.stat(file);
    await fs.writeFile(file, content);
    await fs.utimes(file, stat.atime, stat.mtime);
    files.set(file, content);
  };
  const relocate = async file => {
    const target = path.join(dir, 'retired-fixture.md');
    await fs.rename(file, target);
    const content = files.get(file); files.delete(file); files.set(target, content);
    return target;
  };
  const unchanged = async () => {
    assert.equal(dispatched, 0);
    for (const [file, content] of files) assert.equal(await fs.readFile(file, 'utf8'), content, file);
    assert.deepEqual(await fs.readFile(path.join(store.root, 'settings.json')), settings);
    assert.deepEqual((await fs.readdir(home)).sort(), ['.agents', '.codex', 'AGENTS.md'].sort());
    assert.deepEqual((await fs.readdir(repo)).sort(), ['.mcp.json', 'CLAUDE.md'].sort());
    assert.deepEqual(await fs.readdir(other), ['AGENTS.md']);
  };
  return { ...current, dir, home, repo, other, globalFile, codexFile, localFile, otherFile, proposal, budget, decide, scan, mutate, relocate, start, unchanged };
}
async function ledger(f) {
  return { stored: await f.app.store.read('recommendation-records.json', {}), displayed: (await f.state()).recommendationRecords };
}
async function assertLedger(f, before) { assert.deepEqual(await ledger(f), before); }
function scopedRecord(state, id, agent, repo) {
  const records = Object.values(state.recommendationRecords).filter(record => record.recommendation.id === id && record.agent === agent && record.repo === repo);
  assert.equal(records.length, 1);
  return records[0];
}
function assertFresh(record, proposal) {
  assert.equal(record.current, true); assert.equal(record.changed, false);
  assert.equal(record.fingerprint, proposal.fingerprint);
  assert.deepEqual(record.recommendation, proposal);
}

test('shared global proposals retain separate decisions per agent and repository with canonical snapshots', async t => {
  const f = await fixture(t), proposal = await f.proposal(f.globalFile);
  for (const item of (await f.state()).recommendations) assert.match(item.fingerprint, /^[a-f0-9]{64}$/);
  const sensitive = ['sk', '-', 'syntheticcredential12345'].join('');
  const scopes = [['codex', f.repo, 'accepted'], ['codex', f.other, 'dismissed'], ['claude', f.repo, 'verified'], ['claude', f.other, 'review']];
  for (const [agent, repo, status] of scopes) {
    const result = await f.decide(proposal, { agent, repo, status, note: NOTE_MARKER + ' ' + agent + ' ' + status + ' ' + sensitive, recommendation: { title: FORGED_MARKER, action: FORGED_MARKER }, current: false, changed: true });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assertFresh(result.body, proposal); assert.equal(result.body.agent, agent); assert.equal(result.body.repo, repo);
    assert.equal(result.body.status, status); assert.equal(result.body.note.includes(sensitive), false);
    assert.match(result.body.note, /\[REDACTED\]/); assert.equal(JSON.stringify(result.body).includes(FORGED_MARKER), false);
  }
  let state = await f.state();
  assert.equal(Object.keys(state.recommendationRecords).length, 4);
  for (const [agent, repo, status] of scopes) { const record = scopedRecord(state, proposal.id, agent, repo); assertFresh(record, proposal); assert.equal(record.status, status); }
  const before = state.recommendationRecords;
  const reopened = await f.decide(proposal, { status: 'review', note: 'Review this same current proposal again' });
  assert.equal(reopened.status, 200); assert.equal(reopened.body.status, 'review'); assertFresh(reopened.body, proposal);
  state = await f.state(); assert.equal(Object.keys(state.recommendationRecords).length, 4);
  for (const [agent, repo] of scopes.slice(1)) assert.deepEqual(scopedRecord(state, proposal.id, agent, repo), Object.values(before).find(record => record.agent === agent && record.repo === repo));
  const preview = await f.post('/api/context', { repo: f.repo, reviewAgent: 'codex', sections: ['dashboard'], selectionMode: 'explicit', selectedIds: [proposal.itemId] });
  assert.equal(preview.status, 200);
  for (const marker of [NOTE_MARKER, sensitive, FORGED_MARKER, 'Review this same current proposal again']) assert.equal(preview.body.text.includes(marker), false, marker);
  assert.equal(JSON.stringify(await f.app.store.read('recommendation-records.json')).includes(sensitive), false);
  await f.unchanged();
});

test('recommendation decisions require CSRF, complete valid scope, current fingerprints and reasons for every status', async t => {
  const f = await fixture(t), global = await f.proposal(f.globalFile), local = await f.proposal(f.localFile), budget = await f.budget();
  assert.equal((await f.decide(global)).status, 200);
  assert.equal((await f.decide(local, { agent: 'claude' })).status, 200);
  assert.equal((await f.decide(budget)).status, 200);
  const before = await ledger(f);
  const body = { id: global.id, agent: 'codex', repo: f.repo, fingerprint: global.fingerprint, status: 'accepted', note: 'Synthetic checked proposal' };
  assert.equal((await fetch(f.root + '/api/recommendation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status, 400);
  const invalid = [
    { id: 'missing-proposal' }, { id: 42 }, { agent: 'unknown-agent' }, { agent: null }, { agent: 42 },
    { repo: f.other + '/unscanned' }, { repo: f.repo + '/' }, { repo: null }, { repo: 42 },
    { agent: undefined }, { repo: undefined }, { fingerprint: undefined }, { fingerprint: '' }, { fingerprint: 'f'.repeat(64) }, { fingerprint: 42 },
    { status: 'automatic' }, { note: 42 }, { note: null }, { note: undefined }
  ];
  for (const status of ['accepted', 'dismissed', 'verified', 'review']) invalid.push({ status, note: '   ' });
  for (const patch of invalid) { assert.equal((await f.post('/api/recommendation', { ...body, ...patch })).status, 400, JSON.stringify(patch)); await assertLedger(f, before); }
  for (const patch of [{ agent: 'codex' }, { agent: 'claude', repo: f.other }, { agent: 'claude', repo: '' }]) {
    assert.equal((await f.decide(local, patch)).status, 400); await assertLedger(f, before);
  }
  assert.equal((await f.decide(budget, { agent: 'claude' })).status, 400); await assertLedger(f, before);
  await f.unchanged();
});

test('same-byte content changes stale only affected item or budget proposals and fresh review resets the flag', async t => {
  const f = await fixture(t), proposal = await f.proposal(f.globalFile), budget = await f.budget();
  assert.equal((await f.decide(proposal)).status, 200);
  assert.equal((await f.decide(budget, { status: 'verified' })).status, 200);
  const initial = await f.state(), originalAsset = initial.inventory.items.find(item => item.id === proposal.itemId);
  await f.mutate(f.otherFile, 'Other scoped fixture b.\n'); await f.scan();
  assert.equal((await f.proposal(f.globalFile)).fingerprint, proposal.fingerprint);
  assert.equal((await f.budget()).fingerprint, budget.fingerprint);
  let state = await f.state(); assertFresh(scopedRecord(state, proposal.id, 'codex', f.repo), proposal); assertFresh(scopedRecord(state, budget.id, 'codex', f.repo), budget);
  await f.mutate(f.globalFile, (await fs.readFile(f.globalFile, 'utf8')).replaceAll('fixture-a', 'fixture-b'));
  const unscanned = await f.state();
  assert.equal(unscanned.inventory.items.find(item => item.id === proposal.itemId).contentHash, originalAsset.contentHash);
  assert.equal((await f.proposal(f.globalFile)).fingerprint, proposal.fingerprint);
  assertFresh(scopedRecord(unscanned, proposal.id, 'codex', f.repo), proposal);
  const lastScanReceipt = await f.decide(proposal, { note: 'Decision about the last scanned fixture evidence' });
  assert.equal(lastScanReceipt.status, 200); assertFresh(lastScanReceipt.body, proposal);
  await f.scan();
  const changed = await f.proposal(f.globalFile), changedAsset = (await f.state()).inventory.items.find(item => item.id === proposal.itemId);
  assert.equal(changed.id, proposal.id); assert.equal(changed.evidence, proposal.evidence);
  assert.equal(changedAsset.bytes, originalAsset.bytes); assert.equal(changedAsset.modifiedAt, originalAsset.modifiedAt); assert.notEqual(changedAsset.contentHash, originalAsset.contentHash);
  assert.notEqual(changed.fingerprint, proposal.fingerprint);
  state = await f.state();
  let saved = scopedRecord(state, proposal.id, 'codex', f.repo);
  assert.equal(saved.current, true); assert.equal(saved.changed, true); assert.equal(saved.fingerprint, proposal.fingerprint); assert.deepEqual(saved.recommendation, proposal);
  assertFresh(scopedRecord(state, budget.id, 'codex', f.repo), budget);
  let before = await ledger(f);
  assert.equal((await f.decide(proposal, { status: 'review' })).status, 400); await assertLedger(f, before);
  const reopened = await f.decide(changed, { status: 'review', note: 'Reviewed the changed fixture content' });
  assert.equal(reopened.status, 200); assertFresh(reopened.body, changed);
  const priorCodexAsset = (await f.state()).inventory.items.find(item => item.path === f.codexFile);
  await f.mutate(f.codexFile, (await fs.readFile(f.codexFile, 'utf8')).replaceAll('fixture-a', 'fixture-b')); await f.scan();
  const changedBudget = await f.budget(), currentCodexAsset = (await f.state()).inventory.items.find(item => item.path === f.codexFile);
  assert.equal(changedBudget.id, budget.id); assert.equal(changedBudget.evidence, budget.evidence); assert.notEqual(changedBudget.fingerprint, budget.fingerprint);
  assert.equal(currentCodexAsset.bytes, priorCodexAsset.bytes); assert.equal(currentCodexAsset.modifiedAt, priorCodexAsset.modifiedAt); assert.notEqual(currentCodexAsset.contentHash, priorCodexAsset.contentHash);
  state = await f.state(); saved = scopedRecord(state, budget.id, 'codex', f.repo);
  assert.equal(saved.current, true); assert.equal(saved.changed, true); assert.deepEqual(saved.recommendation, budget);
  assertFresh(scopedRecord(state, proposal.id, 'codex', f.repo), changed);
  before = await ledger(f); assert.equal((await f.decide(budget, { status: 'review' })).status, 400); await assertLedger(f, before);
  const reviewedBudget = await f.decide(changedBudget, { status: 'review', note: 'Reviewed the changed Codex fixture content' });
  assert.equal(reviewedBudget.status, 200); assertFresh(reviewedBudget.body, changedBudget);
  assertFresh(scopedRecord(await f.state(), budget.id, 'codex', f.repo), changedBudget);
  const persistedBudget = Object.values(await f.app.store.read('recommendation-records.json')).find(record => record.recommendation.id === budget.id && record.agent === 'codex' && record.repo === f.repo);
  assert.equal(persistedBudget.fingerprint, changedBudget.fingerprint); assert.deepEqual(persistedBudget.recommendation, changedBudget);
  await f.unchanged();
});

test('decisions retain disappeared duplicate evidence while marking it non-current through restart', async t => {
  const f = await fixture(t), initial = await f.state();
  const proposal = initial.recommendations.find(record => record.confidence === 'exact content match' && !record.repo && initial.inventory.items.find(item => item.id === record.itemId)?.agent === 'shared');
  assert.ok(proposal);
  const result = await f.decide(proposal, { status: 'dismissed', note: 'Retain the synthetic duplicate pending review' });
  assert.equal(result.status, 200); assertFresh(result.body, proposal);
  const source = initial.inventory.items.find(item => item.id === proposal.itemId); await f.relocate(source.path); await f.scan();
  const state = await f.state(); assert.equal(state.recommendations.some(record => record.id === proposal.id), false);
  const record = scopedRecord(state, proposal.id, 'codex', f.repo);
  assert.equal(record.current, false); assert.equal(record.changed, false); assert.equal(record.status, 'dismissed');
  assert.equal(record.fingerprint, proposal.fingerprint); assert.deepEqual(record.recommendation, proposal);
  const before = await ledger(f); assert.equal((await f.decide(proposal, { status: 'review' })).status, 400); await assertLedger(f, before);
  const resumed = await f.start();
  assert.deepEqual((await resumed.state()).recommendationRecords, state.recommendationRecords);
  assert.deepEqual(await resumed.app.store.read('recommendation-records.json'), before.stored);
  await f.unchanged();
});

test('legacy unscoped decisions remain distinct and visibly non-current without automatic migration', async t => {
  const f = await fixture(t), proposal = await f.proposal(f.globalFile);
  assert.equal((await f.decide(proposal)).status, 200);
  for (const status of ['accepted', 'dismissed', 'verified']) {
    const result = await f.post('/api/recommendation', { id: proposal.id, status, note: status === 'verified' ? 'Legacy manual verification fixture' : '' });
    assert.equal(result.status, 200); assert.equal(result.body.current, false); assert.equal(result.body.changed, false);
    assert.equal(Object.hasOwn(result.body, 'agent'), false); assert.equal(Object.hasOwn(result.body, 'repo'), false);
    assert.deepEqual(result.body.recommendation, proposal);
  }
  const state = await f.state(), legacy = state.recommendationRecords[proposal.id];
  assert.equal(legacy.status, 'verified'); assert.equal(legacy.current, false); assert.equal(legacy.changed, false);
  assertFresh(scopedRecord(state, proposal.id, 'codex', f.repo), proposal); assert.equal(Object.keys(state.recommendationRecords).length, 2);
  const before = await ledger(f);
  for (const body of [{ id: proposal.id, status: 'review', note: 'Legacy reopen without a scope' }, { id: proposal.id, status: 'verified', note: '' }]) {
    assert.equal((await f.post('/api/recommendation', body)).status, 400); await assertLedger(f, before);
  }
  const stored = await f.app.store.read('recommendation-records.json');
  assert.equal(Object.hasOwn(stored[proposal.id], 'agent'), false); assert.equal(Object.hasOwn(stored[proposal.id], 'repo'), false);
  const resumed = await f.start();
  assert.deepEqual((await resumed.state()).recommendationRecords, state.recommendationRecords);
  assert.deepEqual(await resumed.app.store.read('recommendation-records.json'), stored);
  await f.unchanged();
});

test('failed scoped decision writes preserve disk and in-memory records before retry and restart', async t => {
  const f = await fixture(t), proposal = await f.proposal(f.globalFile);
  assert.equal((await f.decide(proposal)).status, 200);
  const before = await ledger(f), write = f.app.store.write;
  f.app.store.write = async function (relative, ...args) {
    if (relative === 'recommendation-records.json') throw new Error('Synthetic decision write failure');
    return write.call(this, relative, ...args);
  };
  try {
    for (const patch of [{ repo: f.other }, { status: 'review', note: 'Review the existing decision again' }]) {
      assert.equal((await f.decide(proposal, patch)).status, 400); await assertLedger(f, before);
    }
  } finally { f.app.store.write = write; }
  let failManifest = true;
  f.app.store.write = async function (relative, ...args) {
    if (relative === 'manifest.json' && failManifest) { failManifest = false; throw new Error('Synthetic manifest write failure'); }
    return write.call(this, relative, ...args);
  };
  try {
    assert.equal((await f.decide(proposal, { repo: f.other, status: 'verified', note: 'Synthetic second-scope verification' })).status, 400);
    assert.equal(failManifest, false); await assertLedger(f, before);
  } finally { f.app.store.write = write; }
  const interrupted = await f.start();
  assert.deepEqual((await interrupted.state()).recommendationRecords, before.displayed);
  assert.deepEqual(await interrupted.app.store.read('recommendation-records.json'), before.stored);
  const manifestRetry = await f.decide(proposal, { repo: f.other, status: 'verified', note: 'Synthetic second-scope verification' });
  assert.equal(manifestRetry.status, 200); assertFresh(manifestRetry.body, proposal);
  const retried = await f.decide(proposal, { status: 'review', note: 'Review the existing decision again' });
  assert.equal(retried.status, 200); assertFresh(retried.body, proposal); assert.equal(retried.body.status, 'review');
  const state = await f.state(); assert.equal(Object.keys(state.recommendationRecords).length, 2);
  assert.equal(f.app.store.manifest['recommendation-records.json'].pinned, true);
  const file = await f.app.store.location('recommendation-records.json');
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  const resumed = await f.start(); assert.deepEqual((await resumed.state()).recommendationRecords, state.recommendationRecords);
  assert.deepEqual(await resumed.app.store.read('recommendation-records.json'), await f.app.store.read('recommendation-records.json'));
  await f.unchanged();
});

