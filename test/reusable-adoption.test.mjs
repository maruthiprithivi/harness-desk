import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { Store } from '../lib/store.mjs';
import { previewAdoption, adoptReusable, restoreAdoption } from '../lib/reusable-adoption.mjs';

function bundle(name = 'check-fixture') {
  return { name, files: [
    { path: 'skills/' + name + '/SKILL.md', content: '---\nname: ' + name + '\ndescription: Check a supplied fixture.\n---\nRead the deferred workflow and scripts.\n' },
    { path: 'workflows/' + name + '.md', content: '# Workflow\nReview café and 界 input.\n' },
    { path: 'scripts/' + name + '/run.mjs', content: 'throw new Error("Generated fixture must never execute");\n' }
  ] };
}
async function fixture(t) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'reusable-adoption-')));
  const home = path.join(dir, 'fixture-home'), repo = path.join(dir, 'fixture-repo'), other = path.join(dir, 'other-repo');
  for (const root of [home, repo, other]) await fs.mkdir(root);
  const store = await new Store(path.join(dir, 'generated')).init();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const options = (patch = {}) => ({
    bundle: bundle(), request: { targetAgent: 'codex', invocation: 'explicit', placement: 'global', repo, notes: 'SOURCE-NOTES-MARKER', task: 'SOURCE-TASK-MARKER' },
    home, inventory: { repos: [repo, other] }, ...patch
  });
  const adopt = async (input = options(), patch = {}) => {
    const preview = await previewAdoption(input);
    return adoptReusable({ ...input, store, conversationId: randomUUID(), previewHash: preview.previewHash, reviewed: true, ...patch });
  };
  const restore = (record, input = options(), currentStore = store) => restoreAdoption({ ...input, record, store: currentStore });
  const reload = id => store.read('adoptions/' + id + '.json');
  return { dir, home, repo, other, store, options, adopt, restore, reload };
}
const exists = file => fs.lstat(file).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
function entry(record) { return record.files.find(file => file.path.endsWith('/SKILL.md')); }
async function unchangedDependencies(record, original) {
  for (const file of record.files.filter(file => !file.path.endsWith('/SKILL.md'))) assert.equal(await fs.readFile(file.destination, 'utf8'), original.files.find(source => source.path === file.path).content);
}

test('both target agents and placements install without execution and restore exact generated assets', async t => {
  const f = await fixture(t);
  for (const targetAgent of ['codex', 'claude']) for (const placement of ['global', 'repo']) {
    const input = f.options({ bundle: bundle('fixture-' + targetAgent + '-' + placement), request: { targetAgent, placement, invocation: 'explicit', repo: f.repo, notes: 'SOURCE-NOTES-MARKER', task: 'SOURCE-TASK-MARKER' } });
    if (targetAgent === 'codex') input.bundle.files.push({ path: 'skills/' + input.bundle.name + '/agents/openai.yaml', content: 'policy:\n  allow_implicit_invocation: false\n' });
    const preview = await previewAdoption(input);
    assert.equal(preview.root, path.join(placement === 'global' ? f.home : f.repo, targetAgent === 'claude' ? '.claude' : '.agents'));
    assert.equal(preview.repo, f.repo); assert.equal(preview.canApply, true); assert.deepEqual(preview.conflicts, []);
    assert.equal(preview.bundleHash, createHash('sha256').update(JSON.stringify(input.bundle)).digest('hex'));
    assert.deepEqual(await fs.readdir(f.home), []); assert.deepEqual(await fs.readdir(f.repo), []);
    const link = fs.link, publications = [];
    fs.link = async (stage, destination) => {
      const records = Object.keys(f.store.manifest).filter(name => name.startsWith('adoptions/'));
      const record = await f.store.read(records.at(-1)), file = record.files.find(file => file.destination === destination);
      assert.ok(file?.identity); assert.equal((await fs.lstat(stage)).ino, file.identity.ino);
      assert.equal(file.hash, createHash('sha256').update(await fs.readFile(stage)).digest('hex'));
      publications.push(destination); return link(stage, destination);
    };
    let record;
    try { record = await f.adopt(input); } finally { fs.link = link; }
    assert.equal(record.status, 'installed', JSON.stringify(record));
    assert.equal(publications.at(-1), entry(record).destination);
    assert.equal(f.store.manifest['adoptions/' + record.id + '.json'].pinned, true);
    assert.equal(f.store.manifest['adoptions/' + record.id + '.json'].kind, 'workflow-adoption');
    for (const file of record.files) {
      assert.equal(await fs.readFile(file.destination, 'utf8'), input.bundle.files.find(source => source.path === file.path).content);
      assert.equal((await fs.stat(file.destination)).mode & 0o777, 0o600); assert.equal((await fs.stat(file.destination)).nlink, 1);
      assert.equal(await exists(file.stagePath), false);
    }
    const persisted = JSON.stringify(await f.reload(record.id));
    for (const marker of ['SOURCE-NOTES-MARKER', 'SOURCE-TASK-MARKER', 'Generated fixture must never execute', '# Workflow', 'description: Check a supplied fixture.']) assert.equal(persisted.includes(marker), false, marker);
    const restored = await f.restore(record, input);
    assert.equal(restored.status, 'restored', JSON.stringify(restored));
    for (const file of restored.files) {
      assert.equal(await exists(file.destination), false);
      assert.equal(await fs.readFile(await f.store.location('_archive/adoptions/' + record.id + '/' + file.path), 'utf8'), input.bundle.files.find(source => source.path === file.path).content);
    }
    const completed = await f.reload(record.id);
    assert.deepEqual(await f.restore(completed, input), completed);
    assert.deepEqual(await f.reload(record.id), completed, 'Repeated restore must not rewrite a historical completed receipt');
  }
});

test('preview and explicit review reject existing names, stale destinations and unreviewed installation', async t => {
  const f = await fixture(t), input = f.options(), preview = await previewAdoption(input);
  await assert.rejects(f.adopt(input, { reviewed: false }), /Review/);
  await assert.rejects(f.adopt(input, { previewHash: 'f'.repeat(64) }), /preview changed/);
  assert.equal(Object.keys(f.store.manifest).some(file => file.startsWith('adoptions/')), false);
  const emptySkill = path.join(preview.root, 'skills', input.bundle.name);
  await fs.mkdir(emptySkill, { recursive: true });
  const conflict = await previewAdoption(input);
  assert.equal(conflict.canApply, false); assert.ok(conflict.conflicts.includes(emptySkill));
  await assert.rejects(adoptReusable({ ...input, store: f.store, conversationId: randomUUID(), previewHash: preview.previewHash, reviewed: true }), /preview changed|destinations changed/);
  await fs.rmdir(emptySkill);
  const emptyScripts = path.join(preview.root, 'scripts', input.bundle.name); await fs.mkdir(emptyScripts, { recursive: true });
  assert.equal((await previewAdoption(input)).canApply, false);
  await fs.rmdir(emptyScripts);
  const destination = preview.files.find(file => file.path.startsWith('workflows/')).destination;
  await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.writeFile(destination, 'Existing unrelated workflow');
  const leafConflict = await previewAdoption(input);
  assert.equal(leafConflict.canApply, false); assert.ok(leafConflict.files.find(file => file.destination === destination).exists);
  await assert.rejects(f.adopt(input), /already exist|destinations changed/);
  assert.equal(await fs.readFile(destination, 'utf8'), 'Existing unrelated workflow');
});

test('export grammar, canonical roots, case collisions, symlinks and existing hardlinks cannot escape fixed destinations', async t => {
  const f = await fixture(t), input = f.options(), outside = path.join(f.dir, 'outside'); await fs.mkdir(outside);
  for (const pathValue of ['../outside.md', '/outside.md', 'skills/check-fixture/../SKILL.md', 'scripts/check-fixture/Run.mjs']) {
    const invalid = structuredClone(input); invalid.bundle.files[1].path = pathValue;
    await assert.rejects(previewAdoption(invalid));
  }
  for (const patch of [{ request: { ...input.request, targetAgent: 'unknown' } }, { request: { ...input.request, placement: 'repo', repo: outside } }, { home: f.home + '/' }]) await assert.rejects(previewAdoption({ ...input, ...patch }));
  const fixed = await previewAdoption({ ...input, root: outside });
  assert.equal(fixed.root, path.join(f.home, '.agents'));
  await fs.symlink(outside, fixed.root); await assert.rejects(previewAdoption(input), /symlink/); await fs.unlink(fixed.root);
  await fs.mkdir(path.join(f.home, '.Agents')); await assert.rejects(previewAdoption(input), /case-colliding/); await fs.rmdir(path.join(f.home, '.Agents'));
  const destination = fixed.files.find(file => file.path.startsWith('workflows/')).destination;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const external = path.join(outside, 'existing.md'); await fs.writeFile(external, 'Unrelated hardlinked fixture');
  await fs.link(external, destination);
  assert.equal((await previewAdoption(input)).canApply, false); await assert.rejects(f.adopt(input));
  assert.equal(await fs.readFile(external, 'utf8'), 'Unrelated hardlinked fixture'); assert.deepEqual(await fs.readdir(outside), ['existing.md']);
});

test('exclusive publication preserves a raced target and never publishes the entry with missing dependencies', async t => {
  const f = await fixture(t), input = f.options(), write = f.store.write;
  let raced = false;
  f.store.write = async function (relative, record, ...args) {
    const result = await write.call(this, relative, record, ...args);
    if (!raced && relative.startsWith('adoptions/') && record.events.at(-1)?.type === 'staged') {
      raced = true; const file = record.files.find(file => file.identity && !file.published);
      await fs.writeFile(file.destination, 'Raced unrelated content');
    }
    return result;
  };
  let record;
  try { record = await f.adopt(input); } finally { f.store.write = write; }
  assert.equal(record.status, 'partial'); assert.equal(await exists(entry(record).destination), false);
  const conflicting = record.files.find(file => file.identity);
  assert.equal(await fs.readFile(conflicting.destination, 'utf8'), 'Raced unrelated content');
  assert.equal((await f.restore(record, input)).status, 'restore-incomplete');
  assert.equal(await fs.readFile(conflicting.destination, 'utf8'), 'Raced unrelated content');
  const second = await fixture(t), secondInput = second.options(), secondWrite = second.store.write;
  let removed = false;
  second.store.write = async function (relative, value, ...args) {
    const result = await secondWrite.call(this, relative, value, ...args);
    if (!removed && relative.startsWith('adoptions/') && value.events.at(-1)?.type === 'stage-cleaned') {
      const file = value.files.find(file => file.path.startsWith('workflows/') && file.published && file.stageCleaned);
      if (file) { removed = true; await fs.unlink(file.destination); }
    }
    return result;
  };
  try { record = await second.adopt(secondInput); } finally { second.store.write = secondWrite; }
  assert.equal(record.status, 'partial'); assert.equal(await exists(entry(record).destination), false); assert.match(record.error, /dependency/);
});

test('restart recovers a published target with its recorded stage after persistence failure', async t => {
  const f = await fixture(t), input = f.options(), write = f.store.write;
  let failing = false;
  f.store.write = async function (relative, record, ...args) {
    if (relative.startsWith('adoptions/') && (failing || record.events.at(-1)?.type === 'published')) { failing = true; throw new Error('Synthetic publication checkpoint failure'); }
    return write.call(this, relative, record, ...args);
  };
  let response;
  try { response = await f.adopt(input); } finally { f.store.write = write; }
  assert.equal(response.status, 'partial'); assert.ok(response.persistenceError);
  const store = await new Store(f.store.root).init(), saved = await store.read('adoptions/' + response.id + '.json');
  assert.equal(saved.status, 'installing');
  const published = saved.files.find(file => file.identity); assert.ok(published);
  assert.equal((await fs.lstat(published.destination)).ino, published.identity.ino);
  assert.equal((await fs.lstat(published.stagePath)).ino, published.identity.ino);
  assert.equal((await fs.lstat(published.destination)).nlink, 2);
  const restored = await f.restore(saved, input, store);
  assert.equal(restored.status, 'restored', JSON.stringify(restored));
  assert.equal(await exists(published.destination), false); assert.equal(await exists(published.stagePath), false);
  assert.equal(await fs.readFile(await store.location('_archive/adoptions/' + saved.id + '/' + published.path), 'utf8'), input.bundle.files.find(file => file.path === published.path).content);
});

test('changed, replaced, symlinked or externally hardlinked entries preserve all dependencies', async t => {
  for (const mutation of ['edited', 'replaced', 'symlink', 'hardlink']) {
    const f = await fixture(t), input = f.options(), record = await f.adopt(input), skill = entry(record), external = path.join(f.dir, 'external-entry.md');
    assert.equal(record.status, 'installed');
    if (mutation === 'edited') await fs.writeFile(skill.destination, 'External edit');
    if (mutation === 'replaced') {
      await fs.writeFile(external, input.bundle.files[0].content);
      assert.notEqual((await fs.stat(external)).ino, skill.identity.ino);
      await fs.rename(external, skill.destination);
    }
    if (mutation === 'symlink') { await fs.writeFile(external, 'External linked entry'); await fs.unlink(skill.destination); await fs.symlink(external, skill.destination); }
    if (mutation === 'hardlink') await fs.link(skill.destination, external);
    const restored = await f.restore(record, input);
    assert.equal(restored.status, 'restore-incomplete', mutation);
    assert.equal(await exists(skill.destination), true); await unchangedDependencies(record, input.bundle);
    assert.equal(await exists(await f.store.location('_archive/adoptions/' + record.id + '/' + skill.path)), false);
    if (mutation === 'symlink') assert.equal(await fs.readFile(external, 'utf8'), 'External linked entry');
    if (mutation === 'hardlink') assert.equal((await fs.lstat(external)).ino, skill.identity.ino);
  }
});

test('archive conflicts and cross-device failure preserve the discoverable entry and its dependencies', async t => {
  for (const failure of ['conflict', 'cross-device']) {
    const f = await fixture(t), input = f.options(), record = await f.adopt(input), link = fs.link;
    fs.link = async (source, destination) => {
      if (destination.includes(path.join('_archive', 'adoptions'))) {
        if (failure === 'cross-device') throw Object.assign(new Error('Synthetic cross-device archive move'), { code: 'EXDEV' });
        await fs.writeFile(destination, 'Raced archive content');
      }
      return link(source, destination);
    };
    let restored;
    try { restored = await f.restore(record, input); } finally { fs.link = link; }
    assert.equal(restored.status, 'restore-incomplete'); assert.equal(await exists(entry(record).destination), true);
    await unchangedDependencies(record, input.bundle);
    if (failure === 'conflict') assert.equal(await fs.readFile(await f.store.location('_archive/adoptions/' + record.id + '/' + entry(record).path), 'utf8'), 'Raced archive content');
  }
});

test('interrupted exclusive source/archive pair resumes without overwriting and shared folders remain usable', async t => {
  const f = await fixture(t), input = f.options(), record = await f.adopt(input), write = f.store.write;
  let interrupted = false;
  f.store.write = async function (relative, value, ...args) {
    const result = await write.call(this, relative, value, ...args);
    if (!interrupted && relative.startsWith('adoptions/') && value.events.at(-1)?.type === 'archive-linked') { interrupted = true; throw new Error('Synthetic archive interruption'); }
    return result;
  };
  let incomplete;
  try { incomplete = await f.restore(record, input); } finally { f.store.write = write; }
  assert.equal(incomplete.status, 'restore-incomplete');
  const store = await new Store(f.store.root).init(), saved = await store.read('adoptions/' + record.id + '.json'), skill = entry(saved);
  const archive = await store.location('_archive/adoptions/' + record.id + '/' + skill.path);
  assert.equal((await fs.lstat(skill.destination)).ino, (await fs.lstat(archive)).ino); assert.equal((await fs.lstat(archive)).nlink, 2);
  const resumed = await f.restore(saved, input, store);
  assert.equal(resumed.status, 'restored', JSON.stringify(resumed)); assert.equal(await exists(skill.destination), false); assert.equal((await fs.lstat(archive)).nlink, 1);
  const shared = await fixture(t), firstInput = shared.options({ bundle: bundle('first-fixture') }), secondInput = shared.options({ bundle: bundle('second-fixture') });
  const first = await shared.adopt(firstInput), second = await shared.adopt(secondInput);
  assert.equal(first.status, 'installed'); assert.equal(second.status, 'installed');
  const withdrawn = await shared.restore(first, firstInput);
  assert.equal(withdrawn.status, 'restored'); assert.ok(withdrawn.events.some(event => event.type === 'directory-retained'));
  for (const file of second.files) assert.equal(await fs.readFile(file.destination, 'utf8'), secondInput.bundle.files.find(source => source.path === file.path).content);
  assert.equal((await shared.restore(second, secondInput)).status, 'restored');
});

test('restore rejects forged manifests and preserves source when an archive parent is replaced', async t => {
  const f = await fixture(t), input = f.options(), record = await f.adopt(input);
  const forged = structuredClone(record); forged.files[0].destination = path.join(f.other, 'unrelated.md');
  await assert.rejects(f.restore(forged, input), /pinned adoption record/);
  const changed = f.options({ bundle: bundle('different-name') }); await assert.rejects(f.restore(record, changed), /changed/);
  const write = f.store.write; let swapped = false;
  f.store.write = async function (relative, value, ...args) {
    const result = await write.call(this, relative, value, ...args);
    const skill = relative.startsWith('adoptions/') ? entry(value) : null;
    if (!swapped && relative.startsWith('adoptions/') && value.status === 'restoring' && skill?.archive) {
      const location = await this.location(skill.archive), parent = path.dirname(location);
      if (value.archiveDirectories.some(directory => directory.path === parent)) { swapped = true; await fs.rename(parent, parent + '-original'); await fs.mkdir(parent); }
    }
    return result;
  };
  let restored;
  try { restored = await f.restore(record, input); } finally { f.store.write = write; }
  assert.equal(swapped, true); assert.equal(restored.status, 'restore-incomplete'); assert.match(restored.error, /Archive directory identity changed/);
  assert.equal(await exists(entry(record).destination), true); await unchangedDependencies(record, input.bundle);
});



test('atomic editor replacements are preserved in private capture and rollback never overwrites a newer public file', async t => {
  for (const newerReplacement of [false, true]) {
    const f = await fixture(t), input = f.options(), record = await f.adopt(input), skill = entry(record);
    const capturePath = await f.store.location('_archive/adoptions/' + record.id + '/_capture-0/file');
    const rename = fs.rename, link = fs.link, unlink = fs.unlink;
    const firstEdit = 'FIRST-EDITOR-CONTENT', secondEdit = 'NEWER-EDITOR-CONTENT';
    let captured = false, rollbackAttempted = false;
    fs.rename = async (source, destination) => {
      if (source === skill.destination && destination === capturePath && !captured) {
        captured = true;
        const editor = path.join(f.dir, 'editor-save.md'); await fs.writeFile(editor, firstEdit);
        assert.notEqual((await fs.stat(editor)).ino, skill.identity.ino);
        await rename(editor, skill.destination);
      }
      return rename(source, destination);
    };
    fs.link = async (source, destination) => {
      if (source === capturePath && destination === skill.destination) {
        rollbackAttempted = true;
        if (newerReplacement) {
          const editor = path.join(f.dir, 'newer-editor-save.md'); await fs.writeFile(editor, secondEdit);
          await rename(editor, skill.destination);
        }
      }
      return link(source, destination);
    };
    fs.unlink = async location => {
      assert.equal(record.files.some(file => file.destination === location), false, 'Never unlink a public destination during restore');
      return unlink(location);
    };
    let restored;
    try { restored = await f.restore(record, input); } finally { fs.rename = rename; fs.link = link; fs.unlink = unlink; }
    assert.equal(captured, true); assert.equal(rollbackAttempted, true);
    assert.equal(restored.status, 'restore-incomplete', JSON.stringify(restored));
    assert.equal(await fs.readFile(skill.destination, 'utf8'), newerReplacement ? secondEdit : firstEdit);
    assert.equal(await fs.readFile(capturePath, 'utf8'), firstEdit);
    assert.equal(await fs.readFile(await f.store.location('_archive/adoptions/' + record.id + '/' + skill.path), 'utf8'), input.bundle.files[0].content);
    assert.equal(path.basename(capturePath), 'file'); assert.deepEqual(await fs.readdir(path.dirname(capturePath)), ['file']);
    await unchangedDependencies(record, input.bundle);
    const saved = await f.reload(record.id);
    assert.equal(entry(saved).capture.path, '_archive/adoptions/' + record.id + '/_capture-0/file');
    assert.equal(entry(saved).capturePath, capturePath); assert.equal(entry(saved).captureRetained, true);
    assert.ok(saved.recovery.some(note => note.includes(capturePath)));
    assert.equal(JSON.stringify(saved).includes(firstEdit), false); assert.equal(JSON.stringify(saved).includes(secondEdit), false);
    if (!newerReplacement) {
      const forged = structuredClone(saved); entry(forged).capturePath = path.join(f.other, 'unrelated.md');
      await f.store.write('adoptions/' + record.id + '.json', forged, { kind: 'workflow-adoption', pinned: true });
      await assert.rejects(f.restore(forged, input), /capture recovery path changed/);
      assert.equal(await exists(entry(forged).capturePath), false); assert.equal(await fs.readFile(capturePath, 'utf8'), firstEdit);
      await f.store.write('adoptions/' + record.id + '.json', saved, { kind: 'workflow-adoption', pinned: true });
    }
    const store = await new Store(f.store.root).init();
    const retried = await f.restore(await store.read('adoptions/' + record.id + '.json'), input, store);
    assert.equal(retried.status, 'restore-incomplete');
    assert.equal(await fs.readFile(skill.destination, 'utf8'), newerReplacement ? secondEdit : firstEdit);
    assert.equal(await fs.readFile(capturePath, 'utf8'), firstEdit); await unchangedDependencies(record, input.bundle);
  }
});

test('restart inspects pinned private captures after rename completes before the progress checkpoint', async t => {
  for (const replacement of [false, true]) {
    const f = await fixture(t), input = f.options(), record = await f.adopt(input), skill = entry(record);
    const capturePath = await f.store.location('_archive/adoptions/' + record.id + '/_capture-0/file'), rename = fs.rename;
    const editedContent = 'CAPTURE-BEFORE-CHECKPOINT-EDITOR'; let interrupted = false;
    fs.rename = async (source, destination) => {
      if (!interrupted && source === skill.destination && destination === capturePath) {
        if (replacement) {
          const editor = path.join(f.dir, 'checkpoint-editor.md'); await fs.writeFile(editor, editedContent);
          assert.notEqual((await fs.stat(editor)).ino, skill.identity.ino); await rename(editor, skill.destination);
        }
        await rename(source, destination); interrupted = true;
        throw new Error('Synthetic interruption after atomic capture before checkpoint');
      }
      return rename(source, destination);
    };
    let response;
    try { response = await f.restore(record, input); } finally { fs.rename = rename; }
    assert.equal(interrupted, true); assert.equal(response.status, 'restore-incomplete');
    assert.equal(await exists(skill.destination), false);
    const store = await new Store(f.store.root).init(), saved = await store.read('adoptions/' + record.id + '.json');
    assert.ok(entry(saved).capture.directoryIdentity); assert.equal(entry(saved).capture.state, 'planned');
    assert.equal(await fs.readFile(capturePath, 'utf8'), replacement ? editedContent : input.bundle.files[0].content);
    const resumed = await f.restore(saved, input, store);
    assert.equal(resumed.status, replacement ? 'restore-incomplete' : 'restored', JSON.stringify(resumed));
    if (replacement) {
      assert.equal(await fs.readFile(skill.destination, 'utf8'), editedContent);
      assert.equal(await fs.readFile(capturePath, 'utf8'), editedContent); await unchangedDependencies(record, input.bundle);
    } else {
      assert.equal(await exists(skill.destination), false); assert.equal(await exists(capturePath), false);
      for (const file of record.files) assert.equal(await fs.readFile(await store.location('_archive/adoptions/' + record.id + '/' + file.path), 'utf8'), input.bundle.files.find(source => source.path === file.path).content);
    }
  }
});


test('restart recovers the owned empty capture directory checkpoint before atomic source rename', async t => {
  for (const missingDuplicateIdentity of [false, true]) {
    const f = await fixture(t), input = f.options(), record = await f.adopt(input), write = f.store.write;
    let interrupted = false;
    f.store.write = async function (relative, value, ...args) {
      const result = await write.call(this, relative, value, ...args);
      const skill = relative.startsWith('adoptions/') ? entry(value) : null;
      if (!interrupted && skill?.capture?.directoryIdentity && skill.capture.state === 'planned') {
        interrupted = true; throw new Error('Synthetic interruption after capture directory checkpoint');
      }
      return result;
    };
    let response;
    try { response = await f.restore(record, input); } finally { f.store.write = write; }
    assert.equal(interrupted, true); assert.equal(response.status, 'restore-incomplete');
    const store = await new Store(f.store.root).init(), saved = await store.read('adoptions/' + record.id + '.json'), skill = entry(saved);
    assert.ok(skill.capture.directoryIdentity); assert.equal(skill.capture.state, 'planned');
    assert.equal(await exists(await store.location(skill.capture.path)), false);
    assert.equal((await fs.stat(skill.destination)).nlink, 2);
    if (missingDuplicateIdentity) {
      // Older receipt checkpoints pinned the same identity in archiveDirectories.
      skill.capture.directoryIdentity = null;
      await store.write('adoptions/' + saved.id + '.json', saved, { kind: 'workflow-adoption', pinned: true });
    }
    const resumed = await f.restore(await store.read('adoptions/' + record.id + '.json'), input, store);
    assert.equal(resumed.status, 'restored', JSON.stringify(resumed));
    assert.equal(await exists(skill.destination), false);
    assert.equal(await fs.readFile(await store.location('_archive/adoptions/' + record.id + '/' + skill.path), 'utf8'), input.bundle.files[0].content);
  }
});


test('unexpected captured symlinks are retained without following their target and retries remain reviewable', async t => {
  const f = await fixture(t), input = f.options(), record = await f.adopt(input), skill = entry(record), rename = fs.rename;
  const external = path.join(f.dir, 'external-symlink-target.md'); await fs.writeFile(external, 'EXTERNAL-SYMLINK-CONTENT');
  const capturePath = await f.store.location('_archive/adoptions/' + record.id + '/_capture-0/file'); let replaced = false;
  fs.rename = async (source, destination) => {
    if (!replaced && source === skill.destination && destination === capturePath) {
      replaced = true;
      const editor = path.join(f.dir, 'symlink-editor-save'); await fs.symlink(external, editor); await rename(editor, skill.destination);
    }
    return rename(source, destination);
  };
  let response;
  try { response = await f.restore(record, input); } finally { fs.rename = rename; }
  assert.equal(replaced, true); assert.equal(response.status, 'restore-incomplete');
  assert.equal(await exists(skill.destination), false); assert.equal((await fs.lstat(capturePath)).isSymbolicLink(), true);
  assert.equal(await fs.readlink(capturePath), external); assert.equal(await fs.readFile(external, 'utf8'), 'EXTERNAL-SYMLINK-CONTENT');
  await unchangedDependencies(record, input.bundle);
  const saved = await f.reload(record.id); assert.equal(entry(saved).captureRetained, true); assert.equal(entry(saved).capturePath, capturePath);
  assert.equal(entry(saved).capture.capturedType, 'symlink'); assert.equal(JSON.stringify(saved).includes('EXTERNAL-SYMLINK-CONTENT'), false);
  const retried = await f.restore(saved, input);
  assert.equal(retried.status, 'restore-incomplete'); assert.match(retried.error, /Unexpected captured file/);
  assert.equal(await fs.readlink(capturePath), external); assert.equal(await fs.readFile(external, 'utf8'), 'EXTERNAL-SYMLINK-CONTENT');
  await unchangedDependencies(record, input.bundle);
});
