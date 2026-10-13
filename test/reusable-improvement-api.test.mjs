import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Store } from '../lib/store.mjs';
import { createApp } from '../server.mjs';

const SOURCE_TASK = 'SYNTHETIC-SOURCE-TASK';
const SOURCE_NOTES = 'Shared fixture procedure. SYNTHETIC-SOURCE-NOTES';
const CODE_MARKER = 'SYNTHETIC-GENERATED-CODE';
function answer(name = 'check-fixture') {
  return JSON.stringify({
    name, description: 'Check a supplied synthetic fixture.',
    instructions: 'Review the selected fixture and run run.mjs only after manual adoption.',
    scripts: [{ name: 'run.mjs', content: 'console.log("' + CODE_MARKER + '");' }],
    verification: 'Check a fixed synthetic result and an unrelated non-trigger manually.',
    trigger: 'Check the supplied fixture.', nonTrigger: 'Explain unrelated code.'
  });
}
async function fixture(t) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'reusable-improvement-api-')));
  const home = path.join(dir, 'fixture-home'), repo = path.join(dir, 'repos', 'one'), other = path.join(dir, 'repos', 'two');
  for (const folder of [home, repo, other]) await fs.mkdir(folder, { recursive: true });
  const instruction = path.join(repo, 'AGENTS.md'), otherInstruction = path.join(other, 'AGENTS.md');
  const original = 'Synthetic instructions remain unchanged.\n';
  await fs.writeFile(instruction, original); await fs.writeFile(otherInstruction, original);
  const store = await new Store(path.join(dir, 'generated')).init();
  await store.saveSettings({ ...store.settings, repos: [repo, other], repoRoots: [], scanIntervalMinutes: 0 });
  await store.write('inventory/current.json', { scannedAt: '2026-01-01T00:00:00Z', items: [], repos: [repo, other], warnings: [], coverage: { partial: false } });
  const originalSettings = await fs.readFile(path.join(store.root, 'settings.json'));
  let dispatches = 0;
  const options = {
    home, dataDir: store.root,
    probe: async () => ['codex', 'claude'].map(id => ({ id, installed: false, auth: 'unknown', dispatch: 'handoff' })),
    dispatch: async () => { dispatches++; throw new Error('Unexpected synthetic provider request'); }
  };
  const servers = [];
  async function start() {
    const app = await createApp(options);
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    servers.push(app.server);
    const root = 'http://127.0.0.1:' + app.server.address().port;
    const state = () => fetch(root + '/api/state').then(response => response.json());
    const token = (await state()).csrfToken;
    const post = async (route, body) => {
      const response = await fetch(root + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };
    return { app, root, state, post };
  }
  t.after(async () => {
    for (const server of servers) if (server.listening) await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const current = await start();
  const pending = async (patch = {}) => {
    const result = await current.post('/api/reusable', {
      action: 'generate', repo, task: SOURCE_TASK, notes: SOURCE_NOTES, placement: 'repo',
      targetAgent: 'codex', invocation: 'explicit', autoSave: false, agent: 'codex', model: '', ...patch
    });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.status, 'handoff');
    return result.body;
  };
  const save = async chat => {
    const result = await current.post('/api/reusable', { action: 'save', id: chat.id });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.reusable.status, 'saved');
    return result.body;
  };
  const workflow = async ({ response = answer(), saved = false, ...patch } = {}) => {
    const chat = await pending(patch);
    const result = await current.post('/api/reply', { id: chat.id, content: response });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return saved ? save(result.body) : result.body;
  };
  const create = (patch = {}) => current.post('/api/improvement', {
    action: 'create', agent: 'codex', repo, title: 'Manual workflow comparison',
    change: 'Try the reviewed generated workflow', expectedBenefit: 'Reduce repeated manual work with correct fixed outcomes',
    rollback: 'Stop using the candidate and restore the previous procedure', variable: 'workflow',
    tasks: [{ label: 'Fixed fixture task', prompt: 'Compare the supplied synthetic fixture result' }], assetIds: [], ...patch
  });
  const unchanged = async () => {
    assert.equal(dispatches, 0);
    assert.equal(await fs.readFile(instruction, 'utf8'), original);
    assert.equal(await fs.readFile(otherInstruction, 'utf8'), original);
    assert.deepEqual(await fs.readdir(repo), ['AGENTS.md']);
    assert.deepEqual(await fs.readdir(other), ['AGENTS.md']);
    assert.deepEqual(await fs.readdir(home), []);
    assert.deepEqual(await fs.readFile(path.join(store.root, 'settings.json')), originalSettings);
  };
  return { ...current, dir, home, repo, other, pending, workflow, save, create, start, unchanged };
}
function expectedSource(chat) {
  return {
    conversationId: chat.id, name: chat.reusable.bundle.name,
    placement: chat.reusableRequest.placement, targetAgent: chat.reusableRequest.targetAgent,
    bundleHash: createHash('sha256').update(JSON.stringify(chat.reusable.bundle)).digest('hex')
  };
}
function assertSource(record, chat, f) {
  assert.deepEqual(record.workflowSource, expectedSource(chat));
  assert.deepEqual(Object.keys(record.workflowSource).sort(), ['conversationId', 'name', 'placement', 'targetAgent', 'bundleHash'].sort());
  const text = JSON.stringify(record.workflowSource);
  for (const marker of [SOURCE_TASK, SOURCE_NOTES, CODE_MARKER, f.repo, f.other, f.home, f.dir, 'forged-private-workflow']) assert.equal(text.includes(marker), false, marker);
}
function run(record, patch = {}) {
  return {
    action: 'run', id: record.id, taskId: record.tasks[0].id, runId: randomUUID(), passed: true,
    note: 'Synthetic verification outcome supplied manually', model: 'fixture-model', agentVersion: 'fixture-version',
    environment: 'fixture-environment', counter: 'fixture-counter', totalTokens: 500, seconds: 10, corrections: 0, compactions: 0, ...patch
  };
}
async function ledger(f) {
  return { stored: await f.app.store.read('improvements.json'), displayed: (await f.state()).improvements };
}
async function assertLedger(f, before) {
  assert.deepEqual(await ledger(f), before);
}

test('ready and saved workflows derive exact hashes and minimal source snapshots while ignoring forged metadata', async t => {
  const f = await fixture(t), ready = await f.workflow();
  assert.equal(ready.reusable.status, 'ready');
  const forged = { conversationId: randomUUID(), name: 'forged-private-workflow', placement: 'global', targetAgent: 'claude', bundleHash: 'x'.repeat(64), notes: SOURCE_NOTES, repo: f.other };
  const first = await f.create({ workflowId: ready.id, workflowSource: forged });
  assert.equal(first.status, 200); assertSource(first.body, ready, f);
  const saved = await f.save(ready);
  const second = await f.create({ workflowId: saved.id, title: 'Saved workflow comparison', workflowSource: forged });
  assert.equal(second.status, 200); assertSource(second.body, saved, f);
  assert.deepEqual(second.body.workflowSource, first.body.workflowSource);
  const unlinked = await f.create({ title: 'Unlinked manual workflow', workflowSource: forged });
  assert.equal(unlinked.status, 200);
  assert.equal(Boolean(unlinked.body.workflowSource), false);
  assert.equal(JSON.stringify(unlinked.body).includes('forged-private-workflow'), false);
  const stored = await f.app.store.read('improvements.json');
  assert.deepEqual(stored.slice(0, 2).map(record => record.workflowSource), [expectedSource(ready), expectedSource(saved)]);
  await f.unchanged();
});

test('incomplete, invalid, non-workflow and missing conversation IDs cannot create linked comparisons', async t => {
  const f = await fixture(t), ready = await f.workflow();
  assert.equal((await f.create({ workflowId: ready.id })).status, 200);
  const before = await ledger(f);
  const pending = await f.pending();
  const invalid = await f.workflow({ response: 'Invalid synthetic prose' });
  const details = await f.workflow({ response: JSON.stringify({ needsDetails: 'Which fixture format should this use?' }) });
  assert.equal(invalid.reusable.status, 'invalid'); assert.equal(details.reusable.status, 'needs-details');
  const running = await f.workflow();
  const syntheticRunning = structuredClone(running); syntheticRunning.status = 'running';
  await f.app.store.saveConversation(syntheticRunning);
  const general = await f.post('/api/chat', { repo: f.repo, agent: 'codex', prompt: 'Explain the synthetic fixture', sections: ['dashboard'] });
  assert.equal(general.status, 200); assert.equal(general.body.status, 'handoff');
  assert.equal((await f.post('/api/reply', { id: general.body.id, content: 'A synthetic explanation' })).status, 200);
  for (const workflowId of [pending.id, invalid.id, details.id, running.id, general.body.id, randomUUID(), '../outside', '', null, 42]) {
    assert.equal((await f.create({ workflowId })).status, 400);
    await assertLedger(f, before);
  }
  await f.unchanged();
});

test('linked comparisons enforce workflow variable, target agent and exact repository placement', async t => {
  const f = await fixture(t), ready = await f.workflow();
  assert.equal((await f.create({ workflowId: ready.id })).status, 200);
  const before = await ledger(f);
  for (const patch of [
    { variable: 'configuration' }, { variable: 'model' }, { variable: undefined }, { agent: 'claude' },
    { repo: f.other }, { repo: '' }, { repo: f.repo + '/' }, { repo: f.other + '/unscanned' }
  ]) {
    assert.equal((await f.create({ workflowId: ready.id, ...patch })).status, 400);
    await assertLedger(f, before);
  }
  await f.unchanged();
});

test('global workflows may be tested in another known repository or globally without exposing origin evidence in context', async t => {
  const f = await fixture(t), source = await f.workflow({ targetAgent: 'claude', placement: 'global', saved: true });
  const local = await f.create({ workflowId: source.id, agent: 'claude', repo: f.other });
  assert.equal(local.status, 200); assertSource(local.body, source, f);
  const global = await f.create({ workflowId: source.id, agent: 'claude', repo: '', title: 'Global workflow comparison' });
  assert.equal(global.status, 200); assertSource(global.body, source, f);
  for (const record of [local.body, global.body]) {
    const preview = await f.post('/api/context', {
      repo: record.repo, globalOnly: !record.repo, reviewAgent: 'claude', sections: ['improvements'],
      improvementIds: [record.id], selectedIds: [], selectionMode: 'explicit'
    });
    assert.equal(preview.status, 200);
    const included = JSON.parse(preview.body.text).improvements;
    assert.equal(included.length, 1);
    assert.equal(included[0].workflowSource.name, source.reusable.bundle.name);
    assert.equal(included[0].workflowSource.bundleHash, expectedSource(source).bundleHash);
    for (const marker of [f.repo, SOURCE_TASK, SOURCE_NOTES, CODE_MARKER, 'console.log']) assert.equal(preview.body.text.includes(marker), false, marker);
  }
  const before = await ledger(f);
  assert.equal((await f.create({ workflowId: source.id, agent: 'claude', repo: f.other + '/unknown' })).status, 400);
  await assertLedger(f, before);
  await f.unchanged();
});

test('changed canonical answers, bundles and saved artifacts reject linking without persistence or silent repairs', async t => {
  const f = await fixture(t), source = await f.workflow();
  assert.equal((await f.create()).status, 200);
  const before = await ledger(f), original = structuredClone(source);
  const conversation = path.join(f.app.store.root, "conversations", source.id + ".json");
  const rejectSource = async (files, stateBlocked = false) => {
    const snapshots = await Promise.all(files.map(file => fs.readFile(file)));
    assert.equal((await f.create({ workflowId: source.id })).status, 400);
    assert.deepEqual(await f.app.store.read("improvements.json"), before.stored);
    for (let index = 0; index < files.length; index++) assert.deepEqual(await fs.readFile(files[index]), snapshots[index]);
    if (stateBlocked) {
      const response = await fetch(f.root + "/api/state");
      assert.equal(response.status, 400);
      const body = await response.json();
      assert.match(body.error, /Symlinks are not permitted/);
      assert.equal(Object.hasOwn(body, "improvements"), false);
    } else assert.deepEqual((await f.state()).improvements, before.displayed);
  };
  for (const requestPatch of [{ placement: 'bogus' }, { repo: f.other }]) {
    const changedRequest = structuredClone(original);
    Object.assign(changedRequest.reusableRequest, requestPatch);
    await f.app.store.saveConversation(changedRequest);
    await rejectSource([conversation]);
  }
  await f.app.store.saveConversation(original);
  const changedBundle = structuredClone(original);
  changedBundle.reusable.bundle.files[0].content += 'Changed synthetic entry';
  await f.app.store.saveConversation(changedBundle);
  await rejectSource([conversation]);
  const changedAnswer = structuredClone(original);
  changedAnswer.messages.push({ role: 'assistant', content: answer('changed-fixture'), at: '2026-01-02T00:00:00Z' });
  await f.app.store.saveConversation(changedAnswer);
  await rejectSource([conversation]);
  await f.app.store.saveConversation(original);
  const saved = await f.save(original), directory = path.join(f.app.store.root, 'reusable', saved.id);
  const script = saved.reusable.bundle.files.find(file => file.path.endsWith('/run.mjs')), location = path.join(directory, script.path), metadata = path.join(directory, "bundle.json");
  await fs.writeFile(location, 'Changed synthetic script');
  await rejectSource([conversation, metadata, location]);
  assert.equal(await fs.readFile(location, 'utf8'), 'Changed synthetic script');
  await fs.writeFile(location, script.content);
  const raw = await fs.readFile(metadata, 'utf8'), parsed = JSON.parse(raw);
  parsed.request.placement = 'global'; await fs.writeFile(metadata, JSON.stringify(parsed));
  await rejectSource([conversation, metadata, location]);
  await fs.writeFile(metadata, raw);
  const external = path.join(f.dir, 'external-fixture.mjs'); await fs.writeFile(external, script.content);
  await fs.unlink(location); await fs.symlink(external, location);
  await rejectSource([conversation, metadata, location], true);
  assert.equal((await fs.lstat(location)).isSymbolicLink(), true);
  assert.equal(await fs.readlink(location), external);
  await fs.unlink(location); await fs.link(external, location);
  await rejectSource([conversation, metadata, location]);
  assert.equal((await fs.lstat(location)).nlink, 2);
  assert.equal((await fs.lstat(location)).ino, (await fs.lstat(external)).ino);
  await fs.unlink(location); await fs.writeFile(location, script.content);
  await assertLedger(f, before);
  const restored = await f.create({ workflowId: saved.id });
  assert.equal(restored.status, 200); assertSource(restored.body, saved, f);
  await f.unchanged();
});

test('failed comparison writes retain the previous ledger and linked identity before a safe retry', async t => {
  const f = await fixture(t), source = await f.workflow(), created = await f.create({ workflowId: source.id });
  assert.equal(created.status, 200);
  const record = created.body, before = await ledger(f), write = f.app.store.write, outcome = run(record);
  f.app.store.write = async function (relative, ...args) {
    if (relative === 'improvements.json') throw new Error('Synthetic improvement write failure');
    return write.call(this, relative, ...args);
  };
  try {
    assert.equal((await f.create({ workflowId: source.id, title: 'Failed linked creation' })).status, 400);
    await assertLedger(f, before);
    assert.equal((await f.post('/api/improvement', outcome)).status, 400);
    await assertLedger(f, before);
  } finally { f.app.store.write = write; }
  const retried = await f.post('/api/improvement', outcome);
  assert.equal(retried.status, 200); assert.equal(retried.body.runs.length, 1);
  assertSource(retried.body, source, f);
  await f.unchanged();
});

test('workflow identity cannot be rebound and survives runs, candidate, decision and restart', async t => {
  const f = await fixture(t), source = await f.workflow(), alternate = await f.workflow({ response: answer('alternate-fixture'), saved: true });
  const created = await f.create({ workflowId: source.id }); assert.equal(created.status, 200);
  let record = created.body; assertSource(record, source, f);
  const ordinary = await f.create({ title: 'Unlinked comparison' }); assert.equal(ordinary.status, 200);
  const forgedRun = await f.post("/api/improvement", run(ordinary.body, { workflowSource: expectedSource(alternate) }));
  assert.equal(forgedRun.status, 200); assert.equal(Boolean(forgedRun.body.workflowSource), false);
  let before = await ledger(f);
  assert.equal((await f.post('/api/improvement', run(ordinary.body, { workflowId: source.id }))).status, 400);
  await assertLedger(f, before);
  assert.equal((await f.post('/api/improvement', run(record, { workflowId: alternate.id }))).status, 400);
  await assertLedger(f, before);
  for (let index = 0; index < 3; index++) {
    const result = await f.post('/api/improvement', run(record, index === 0 ? { workflowId: source.id, workflowSource: expectedSource(alternate) } : index === 1 ? { workflowSource: expectedSource(alternate) } : {}));
    assert.equal(result.status, 200); record = result.body; assertSource(record, source, f);
  }
  assert.equal(record.assessment.baselineEligible, true);
  before = await ledger(f);
  assert.equal((await f.post('/api/improvement', { action: 'candidate', id: record.id, workflowId: alternate.id })).status, 400);
  await assertLedger(f, before);
  let result = await f.post('/api/improvement', { action: 'candidate', id: record.id, workflowSource: expectedSource(alternate) });
  assert.equal(result.status, 200); record = result.body; assertSource(record, source, f);
  for (let index = 0; index < 3; index++) {
    result = await f.post('/api/improvement', run(record, { totalTokens: 300, seconds: 8 }));
    assert.equal(result.status, 200); record = result.body; assertSource(record, source, f);
  }
  assert.equal(record.assessment.ready, true);
  before = await ledger(f);
  const decision = { action: 'decision', id: record.id, decision: 'keep', note: 'Synthetic fixed outcomes verified manually' };
  assert.equal((await f.post('/api/improvement', { ...decision, workflowId: alternate.id })).status, 400);
  await assertLedger(f, before);
  result = await f.post('/api/improvement', { ...decision, workflowSource: expectedSource(alternate) });
  assert.equal(result.status, 200); record = result.body; assert.equal(record.status, 'closed'); assertSource(record, source, f);
  const resumed = await f.start();
  assert.deepEqual((await resumed.state()).improvements.find(item => item.id === record.id), record);
  assertSource((await resumed.app.store.read('improvements.json')).find(item => item.id === record.id), source, f);
  await f.unchanged();
});
