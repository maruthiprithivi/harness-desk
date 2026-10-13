import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { exportReusableBundle } from './reusable-export.mjs';
import { forbidden, redact } from './analysis.mjs';

const locks = new Map();
const digest = value => createHash('sha256').update(value).digest('hex');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const identity = stat => ({ dev: stat.dev, ino: stat.ino });
const sameIdentity = (stat, expected) => !!expected && stat.dev === expected.dev && stat.ino === expected.ino;
const check = (condition, message) => { if (!condition) throw new Error(message); };
const now = () => new Date().toISOString();
function absolute(value) {
  check(typeof value === 'string' && path.isAbsolute(value) && path.resolve(value) === value && !/[\0-\x1f\x7f]/.test(value) && !forbidden(value) && redact(value) === value, 'Choose a canonical absolute non-secret directory');
  return value;
}
async function inspect(target, leafAllowed = false) {
  absolute(target);
  const parts = target.slice(path.parse(target).root.length).split(path.sep).filter(Boolean), anchors = [];
  let cursor = path.parse(target).root;
  const rootStat = await fs.lstat(cursor); anchors.push({ path: cursor, ...identity(rootStat) });
  for (let index = 0; index < parts.length; index++) {
    const names = await fs.readdir(cursor);
    check(names.length <= 10000, 'Destination directory exceeds the safe inspection limit');
    check(!names.some(name => name !== parts[index] && name.toLowerCase() === parts[index].toLowerCase()), 'Destination contains a case-colliding path');
    cursor = path.join(cursor, parts[index]);
    let stat;
    try { stat = await fs.lstat(cursor); } catch (error) { if (error.code === 'ENOENT') return { exists: false, stat: null, anchors }; throw error; }
    const leaf = index === parts.length - 1;
    check(!stat.isSymbolicLink() || (leaf && leafAllowed), 'Destination symlinks are excluded');
    check((leaf && leafAllowed) || stat.isDirectory(), 'Destination ancestors must be directories');
    if (stat.isDirectory()) anchors.push({ path: cursor, ...identity(stat) });
    if (leaf) return { exists: true, stat, anchors };
  }
  return { exists: true, stat: rootStat, anchors };
}
async function canonical(options) {
  exportReusableBundle(options.bundle, options.request);
  const { bundle, request, home, inventory } = options;
  const repo = request.repo ?? '';
  check(typeof repo === 'string', 'Captured repository must be text');
  const base = absolute(request.placement === 'global' ? home : repo);
  if (request.placement === 'repo') check((inventory?.repos || []).some(item => (typeof item === 'string' ? item : item.path) === repo), 'Choose the captured scanned repository');
  const baseInfo = await inspect(base);
  check(baseInfo.exists && baseInfo.stat.isDirectory() && await fs.realpath(base) === base, 'Installation base must be an existing canonical directory');
  const root = path.join(base, request.targetAgent === 'claude' ? '.claude' : '.agents');
  const files = bundle.files.map(file => ({ path: file.path, destination: path.join(root, ...file.path.split('/')), hash: digest(Buffer.from(file.content, 'utf8')), bytes: Buffer.byteLength(file.content) }));
  return { bundleHash: digest(JSON.stringify(bundle)), targetAgent: request.targetAgent, placement: request.placement, invocation: request.invocation, repo, root, files };
}
async function plan(options) {
  const result = await canonical(options), anchors = new Map(), conflicts = new Set();
  const remember = info => info.anchors.forEach(item => anchors.set(item.path, item));
  const rootInfo = await inspect(result.root); remember(rootInfo);
  for (const directory of ['skills', 'scripts'].map(name => path.join(result.root, name, options.bundle.name))) {
    const info = await inspect(directory, true); remember(info);
    check(!info.stat?.isSymbolicLink(), 'Destination symlinks are excluded');
    if (info.exists) conflicts.add(directory);
  }
  const files = [];
  for (const file of result.files) {
    const info = await inspect(file.destination, true); remember(info);
    check(!info.stat?.isSymbolicLink(), 'Destination symlinks are excluded');
    files.push({ ...file, exists: info.exists });
    if (info.exists) conflicts.add(file.destination);
  }
  const preview = { ...result, files, conflicts: [...conflicts].sort(), canApply: conflicts.size === 0 };
  delete preview.invocation;
  preview.previewHash = digest(JSON.stringify([preview, [...anchors.values()].sort((a, b) => a.path.localeCompare(b.path))]));
  return { preview, anchors: [...anchors.values()] };
}
export async function previewAdoption(options) { return (await plan(options)).preview; }

async function serialized(root, action) {
  const previous = locks.get(root) || Promise.resolve();
  const pending = previous.catch(() => {}).then(action); locks.set(root, pending);
  try { return await pending; } finally { if (locks.get(root) === pending) locks.delete(root); }
}
function event(record, type, note) {
  record.updatedAt = now();
  record.events = [...record.events, { at: record.updatedAt, type, note: redact(note).slice(0, 500) }].slice(-40);
}
async function syncFile(file) {
  const access = process.platform === 'win32' ? constants.O_RDWR : constants.O_RDONLY;
  const handle = await fs.open(file, access | (constants.O_NOFOLLOW || 0));
  try { check((await handle.stat()).isFile(), 'Durable metadata must be a regular file'); await handle.sync(); } finally { await handle.close(); }
}
async function syncDirectory(directory) {
  let handle;
  try { handle = await fs.open(directory, 'r'); await handle.sync(); }
  catch (error) { if (!(process.platform === 'win32' && ['EINVAL', 'EPERM', 'EISDIR', 'ENOTSUP'].includes(error.code))) throw error; }
  finally { await handle?.close(); }
}
async function persist(store, record) {
  await inspect(absolute(store.root));
  const relative = 'adoptions/' + record.id + '.json';
  await store.write(relative, record, { kind: 'workflow-adoption', pinned: true });
  await syncFile(await store.location(relative));
  await syncFile(await store.location('manifest.json'));
  await syncDirectory(path.join(store.root, 'adoptions')); await syncDirectory(store.root);
}
function parents(root, files) {
  const result = new Set([root]);
  for (const file of files) {
    let directory = path.dirname(file.destination);
    while (directory !== root) { result.add(directory); directory = path.dirname(directory); }
  }
  return result;
}
async function guard(record, target) {
  const info = await inspect(path.dirname(target));
  for (const anchor of info.anchors) {
    const known = [...record.ancestors, ...record.directories].find(item => item.path === anchor.path && !item.removed);
    check(known && sameIdentity(anchor, known), 'Destination directory identity changed');
  }
  check(info.exists, 'Destination parent is unavailable');
}
async function ensureDirectories(record, store, target, allowed) {
  const needed = [];
  let directory = path.dirname(target);
  while (allowed.has(directory)) { needed.unshift(directory); directory = path.dirname(directory); }
  for (const location of needed) {
    const info = await inspect(location);
    const known = [...record.ancestors, ...record.directories].find(item => item.path === location && !item.removed);
    if (info.exists) { check(known && sameIdentity(info.stat, known), 'Destination directories changed after review'); continue; }
    await guard(record, location);
    await fs.mkdir(location, { mode: 0o700 });
    const created = await inspect(location);
    record.directories.push({ path: location, ...identity(created.stat), removed: false });
    event(record, 'directory-created', 'Created an exclusively owned destination directory.');
    await persist(store, record);
  }
}
async function fileState(record, location) {
  const info = await inspect(location, true);
  for (const anchor of info.anchors) {
    const known = [...record.ancestors, ...record.directories].find(item => item.path === anchor.path && !item.removed);
    check(known && sameIdentity(anchor, known), 'Destination directory identity changed');
  }
  return info;
}
async function owned(record, location, entry, allowedLinks = 1) {
  const info = await fileState(record, location);
  if (!info.exists) return null;
  check(info.stat.isFile() && !info.stat.isSymbolicLink() && sameIdentity(info.stat, entry.identity) && info.stat.size === entry.bytes && info.stat.nlink === allowedLinks, 'File identity, type or link count changed');
  const handle = await fs.open(location, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const stat = await handle.stat();
    check(sameIdentity(stat, entry.identity) && stat.size === entry.bytes && stat.nlink === allowedLinks, 'File changed while checking ownership');
    const data = await handle.readFile();
    check(digest(data) === entry.hash, 'File content changed');
  } finally { await handle.close(); }
  await guard(record, location);
  check(sameIdentity((await fs.lstat(location)), entry.identity), 'File identity changed after reading');
  return info.stat;
}
async function clearStage(record, entry, store) {
  if (!entry.identity) return;
  const stage = await fileState(record, entry.stagePath);
  if (!stage.exists) { entry.stageCleaned = true; return; }
  const target = await fileState(record, entry.destination);
  const paired = target.exists && target.stat.isFile() && sameIdentity(target.stat, entry.identity);
  await owned(record, entry.stagePath, entry, paired ? 2 : 1);
  if (paired) await owned(record, entry.destination, entry, 2);
  await fs.unlink(entry.stagePath);
  await syncDirectory(path.dirname(entry.stagePath));
  entry.stageCleaned = true; event(record, 'stage-cleaned', 'Removed an owned internal temporary stage.');
  await persist(store, record);
}
async function failed(store, record, error, restoring = false) {
  record.status = restoring ? 'restore-incomplete' : record.directories.length || record.files.some(file => file.identity) ? 'partial' : 'failed';
  record.error = redact(error.message || 'Filesystem operation failed').slice(0, 500);
  record.recovery = [...record.recovery, record.error].slice(-20);
  event(record, record.status, 'Review the pinned ownership record before recovery. No unrelated file is removed automatically.');
  try { await persist(store, record); } catch { record.persistenceError = 'Latest progress could not be saved. Reload the existing pinned record before recovery.'; }
  return record;
}
export async function adoptReusable(options) {
  const { preview } = await plan(options);
  return serialized(preview.root, async () => {
    check(options.reviewed === true, 'Review every generated file before adoption');
    check(typeof options.previewHash === 'string' && options.previewHash === preview.previewHash, 'Adoption preview changed. Review a fresh preview');
    const fresh = await plan(options);
    check(fresh.preview.previewHash === options.previewHash && fresh.preview.canApply, 'Adoption destinations changed or already exist');
    check(UUID.test(options.conversationId || ''), 'Adoption requires the saved conversation identity');
    const record = {
      id: randomUUID(), conversationId: options.conversationId, bundleHash: fresh.preview.bundleHash,
      targetAgent: fresh.preview.targetAgent, placement: fresh.preview.placement, invocation: options.request.invocation,
      repo: fresh.preview.repo, root: fresh.preview.root, previewHash: options.previewHash,
      status: 'installing', reviewed: true, createdAt: now(), updatedAt: now(), events: [], recovery: [],
      ancestors: fresh.anchors, directories: [], archiveDirectories: [], archiveAncestors: [],
      files: fresh.preview.files.map((file, index) => ({ ...file, stagePath: path.join(path.dirname(file.destination), '.adoption-' + 'ID' + '-' + index + '.tmp'), identity: null, published: false, stageCleaned: false, restored: false, archive: null, captureRetained: false }))
    };
    record.files.forEach(file => { file.stagePath = file.stagePath.replace('.adoption-ID-', '.adoption-' + record.id + '-'); });
    event(record, 'installing', 'Pinned installation intent. Generated files remain untested; no script is executed.');
    await persist(options.store, record);
    const allowed = parents(record.root, record.files);
    try {
      const ordered = [...record.files].sort((a, b) => Number(a.path.endsWith('/SKILL.md')) - Number(b.path.endsWith('/SKILL.md')));
      for (const entry of ordered) {
        await ensureDirectories(record, options.store, entry.destination, allowed);
        await guard(record, entry.destination);
        const content = options.bundle.files.find(file => file.path === entry.path).content;
        const handle = await fs.open(entry.stagePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
        try { entry.identity = identity(await handle.stat()); await handle.writeFile(content, 'utf8'); await handle.sync(); } finally { await handle.close(); }
        check(await owned(record, entry.stagePath, entry), 'Owned stage is unavailable');
        event(record, 'staged', 'Recorded temporary file identity and expected hash before publication.'); await persist(options.store, record);
        if (entry.path.endsWith('/SKILL.md')) for (const dependency of record.files.filter(file => file !== entry)) check(await owned(record, dependency.destination, dependency), 'Published dependency is unavailable');
        await guard(record, entry.destination); check(await owned(record, entry.stagePath, entry), 'Owned stage is unavailable');
        await fs.link(entry.stagePath, entry.destination);
        await syncDirectory(path.dirname(entry.destination));
        check(await owned(record, entry.destination, entry, 2), 'Published destination is unavailable');
        entry.published = true; event(record, 'published', 'Published a generated file without replacing an existing destination.'); await persist(options.store, record);
        await clearStage(record, entry, options.store);
      }
      for (const entry of record.files) check(await owned(record, entry.destination, entry), 'Published destination is unavailable');
      record.status = 'installed'; event(record, 'installed', 'Bundle installed without execution. Verify discovery and outcomes in a fresh agent session.'); await persist(options.store, record);
      return record;
    } catch (error) { return failed(options.store, record, error); }
  });
}

async function validateRecord(record, options, expected) {
  check(record && UUID.test(record.id || '') && UUID.test(record.conversationId || ''), 'Choose a valid pinned adoption record');
  const stored = await options.store.read('adoptions/' + record.id + '.json');
  check(JSON.stringify(stored) === JSON.stringify(record), 'Reload the current pinned adoption record');
  for (const key of ['bundleHash', 'targetAgent', 'placement', 'invocation', 'repo', 'root']) check(record[key] === expected[key], 'Adoption source or canonical destination changed');
  check(Array.isArray(record.files) && record.files.length === expected.files.length, 'Adoption file manifest changed');
  const allowed = parents(expected.root, expected.files);
  for (let index = 0; index < expected.files.length; index++) {
    const actual = record.files[index], file = expected.files[index];
    for (const key of ['path', 'destination', 'hash', 'bytes']) check(actual[key] === file[key], 'Adoption file metadata changed');
    check(actual.stagePath === path.join(path.dirname(file.destination), '.adoption-' + record.id + '-' + index + '.tmp'), 'Adoption stage path changed');
    if (actual.identity) check(Number.isSafeInteger(actual.identity.dev) && Number.isSafeInteger(actual.identity.ino), 'Adoption file identity is invalid');
    if (actual.archive) check(actual.archive === '_archive/adoptions/' + record.id + '/' + file.path, 'Adoption archive path changed');
    if (actual.capture) {
      const directory = '_archive/adoptions/' + record.id + '/_capture-' + index;
      check(actual.archive && actual.capture.directory === directory && actual.capture.path === directory + '/file', 'Adoption capture path changed');
      if (actual.capture.directoryIdentity) check(Number.isSafeInteger(actual.capture.directoryIdentity.dev) && Number.isSafeInteger(actual.capture.directoryIdentity.ino), 'Adoption capture directory identity is invalid');
    }
    if (actual.capturePath !== undefined) check(actual.capture && actual.capturePath === await captureLocation(options.store, actual), 'Adoption capture recovery path changed');
  }
  check(Array.isArray(record.directories) && record.directories.every(directory => allowed.has(directory.path)), 'Adoption directory manifest changed');
  check(Array.isArray(record.ancestors) && record.ancestors.every(directory => expected.files.some(file => file.destination.startsWith(directory.path === path.parse(directory.path).root ? directory.path : directory.path + path.sep))), 'Adoption ancestor manifest changed');
  const archiveRoot = await options.store.location('_archive/adoptions/' + record.id), allowedArchive = new Set([archiveRoot]);
  for (const file of expected.files) {
    let directory = path.dirname(path.join(archiveRoot, ...file.path.split('/')));
    while (directory !== archiveRoot) { allowedArchive.add(directory); directory = path.dirname(directory); }
  }
  record.files.forEach((file, index) => { if (file.capture) allowedArchive.add(path.join(archiveRoot, '_capture-' + index)); });
  check(Array.isArray(record.archiveDirectories) && record.archiveDirectories.every(directory => allowedArchive.has(directory.path)), 'Adoption archive directory manifest changed');
  const allowedArchiveAncestors = new Set([path.join(options.store.root, '_archive'), path.join(options.store.root, '_archive', 'adoptions')]);
  let ancestor = options.store.root;
  while (true) { allowedArchiveAncestors.add(ancestor); const parent = path.dirname(ancestor); if (parent === ancestor) break; ancestor = parent; }
  check((record.archiveAncestors || []).every(directory => allowedArchiveAncestors.has(directory.path)), 'Adoption archive ancestor manifest changed');
}
async function guardArchive(store, record, target) {
  const info = await inspect(path.dirname(target));
  for (const anchor of info.anchors) {
    const known = [...(record.archiveAncestors || []), ...record.archiveDirectories].find(item => item.path === anchor.path);
    check(known && sameIdentity(anchor, known), 'Archive directory identity changed');
  }
  check(info.exists, 'Archive parent is unavailable');
}
async function archiveParents(store, record, relative) {
  const rootInfo = await inspect(absolute(store.root));
  record.archiveAncestors ||= [];
  for (const anchor of rootInfo.anchors) {
    const known = record.archiveAncestors.find(item => item.path === anchor.path);
    check(!known || sameIdentity(anchor, known), 'Archive ancestor identity changed');
    if (!known) record.archiveAncestors.push(anchor);
  }
  await persist(store, record);
  const archiveRoot = await store.location('_archive/adoptions/' + record.id);
  const destination = await store.location(relative), needed = [];
  let directory = path.dirname(destination);
  while (directory.startsWith(archiveRoot + path.sep) || directory === archiveRoot) { needed.unshift(directory); directory = path.dirname(directory); }
  for (const generic of [path.join(store.root, '_archive'), path.join(store.root, '_archive', 'adoptions')]) {
    const info = await inspect(generic), known = record.archiveAncestors.find(item => item.path === generic);
    if (info.exists) check(!known || sameIdentity(info.stat, known), 'Archive ancestor identity changed');
    else { check(!known, 'Archive ancestor is unavailable'); await guardArchive(store, record, generic); await fs.mkdir(generic, { mode: 0o700 }); }
    await guardArchive(store, record, generic);
    const actual = (await inspect(generic)).stat;
    if (!known) { record.archiveAncestors.push({ path: generic, ...identity(actual) }); await persist(store, record); }
  }
  for (const location of needed) {
    const info = await inspect(location), known = record.archiveDirectories.find(item => item.path === location);
    if (info.exists) check(known && sameIdentity(info.stat, known), 'Archive directory already exists or changed');
    else {
      await guardArchive(store, record, location); await fs.mkdir(location, { mode: 0o700 });
      await guardArchive(store, record, location);
      const stat = (await inspect(location)).stat;
      record.archiveDirectories.push({ path: location, ...identity(stat) });
      const capture = record.files.find(file => file.capture && path.join(store.root, ...file.capture.directory.split('/')) === location)?.capture;
      if (capture) capture.directoryIdentity = identity(stat);
      await persist(store, record);
    }
  }
  return destination;
}
async function archivedFile(store, record, entry, links = 1, relative = entry.archive) {
  const location = await store.location(relative);
  await guardArchive(store, record, location);
  const info = await inspect(location, true);
  if (!info.exists) return false;
  const archiveRoot = path.join(store.root, '_archive', 'adoptions', record.id);
  for (const anchor of info.anchors.filter(item => item.path === archiveRoot || item.path.startsWith(archiveRoot + path.sep))) {
    const known = record.archiveDirectories.find(directory => directory.path === anchor.path);
    check(known && sameIdentity(anchor, known), 'Archive directory identity changed');
  }
  check(info.stat.isFile() && !info.stat.isSymbolicLink() && sameIdentity(info.stat, entry.identity) && info.stat.nlink === links && info.stat.size === entry.bytes, 'Archived file identity changed; retain it for manual recovery');
  const handle = await fs.open(location, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const stat = await handle.stat();
    check(sameIdentity(stat, entry.identity) && stat.nlink === links && stat.size === entry.bytes && digest(await handle.readFile()) === entry.hash, 'Archived file content changed; retain it for manual recovery');
  } finally { await handle.close(); }
  await guardArchive(store, record, location);
  const after = await fs.lstat(location);
  check(sameIdentity(after, entry.identity) && after.nlink === links, 'Archived file changed after verification');
  return true;
}
async function captureLocation(store, entry) {
  // Resolve the owned parent only: a captured symlink is retained as a leaf,
  // never followed or rejected before its metadata can be recorded.
  return path.join(await store.location(entry.capture.directory), 'file');
}
async function captureState(store, record, entry) {
  const location = await captureLocation(store, entry), info = await inspect(location, true);
  for (const anchor of info.anchors.filter(item => item.path !== location)) {
    const known = [...(record.archiveAncestors || []), ...record.archiveDirectories].find(item => item.path === anchor.path);
    check(known && sameIdentity(anchor, known), 'Capture directory identity changed');
  }
  const captureDirectory = await store.location(entry.capture.directory);
  const directory = await inspect(captureDirectory);
  if (directory.exists) {
    const pinned = record.archiveDirectories.find(item => item.path === captureDirectory);
    check(pinned && sameIdentity(directory.stat, pinned), 'Capture directory identity changed');
    // An empty directory can be recovered from its already pinned ownership entry
    // if a previous version stopped before saving the duplicate capture identity.
    if (!entry.capture.directoryIdentity && !info.exists) entry.capture.directoryIdentity = identity(directory.stat);
    check(sameIdentity(directory.stat, entry.capture.directoryIdentity), 'Capture directory identity changed');
  }
  check(!info.exists || directory.exists, 'Capture parent is unavailable');
  return info;
}
async function retainCapture(store, record, entry, info) {
  const capture = entry.capture, location = await captureLocation(store, entry);
  capture.state = 'rollback-planned'; entry.capturePath = location; entry.captureRetained = true;
  capture.capturedIdentity = identity(info.stat);
  capture.capturedType = info.stat.isFile() ? 'file' : info.stat.isSymbolicLink() ? 'symlink' : 'other';
  record.recovery.push('Unexpected content is preserved at ' + location + '. Review this private capture before recovery.');
  event(record, 'capture-preserved', 'Preserved unexpected captured content; dependencies remain installed.');
  await persist(store, record);
  // Keep this recovery copy even after rollback: a subsequent editor save must not
  // erase the only preserved copy. Never replace a newer public destination.
  if (info.stat.isFile() && !info.stat.isSymbolicLink()) {
    await guardArchive(store, record, location); await guard(record, entry.destination);
    const current = await captureState(store, record, entry);
    check(current.exists && sameIdentity(current.stat, capture.capturedIdentity), 'Preserved capture identity changed');
    try {
      await fs.link(location, entry.destination);
      await syncDirectory(path.dirname(entry.destination));
      capture.state = 'rolled-back-preserved';
      event(record, 'capture-rolled-back', 'Restored unexpected captured content without overwriting; retained its private recovery copy.');
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      capture.state = 'preserved';
      event(record, 'capture-preserved', 'A newer public destination exists; both it and the private capture are preserved.');
    }
    await persist(store, record);
  }
  throw new Error('Unexpected captured file is preserved for manual recovery at ' + location);
}
async function finishCapture(store, record, entry) {
  const capture = entry.capture, info = await captureState(store, record, entry);
  if (!info.exists) {
    check(capture.verified && ['cleanup-planned', 'cleaned'].includes(capture.state), 'Recorded capture is unavailable; review manually');
    check(await archivedFile(store, record, entry), 'Owned archive is unavailable');
  } else {
    let expected = info.stat.isFile() && !info.stat.isSymbolicLink() && sameIdentity(info.stat, entry.identity) && info.stat.size === entry.bytes && info.stat.nlink === 2;
    if (expected) {
      try {
        check(await archivedFile(store, record, entry, 2, capture.path), 'Owned capture is unavailable');
        check(await archivedFile(store, record, entry, 2), 'Owned archive is unavailable');
      } catch { expected = false; }
    }
    if (!expected) return retainCapture(store, record, entry, info);
    capture.verified = true; capture.state = 'cleanup-planned';
    event(record, 'capture-verified', 'Verified the privately captured inode and archive pair before internal cleanup.'); await persist(store, record);
    check(await archivedFile(store, record, entry, 2, capture.path), 'Owned capture is unavailable');
    check(await archivedFile(store, record, entry, 2), 'Owned archive is unavailable');
    const location = await captureLocation(store, entry);
    await guardArchive(store, record, location);
    await fs.unlink(location); // Only the verified private capture, never the public source.
    await syncDirectory(path.dirname(location));
    check(await archivedFile(store, record, entry), 'Archive verification failed; preserve quarantined content');
  }
  capture.state = 'cleaned'; entry.captureRetained = false;
  const directory = await inspect(await store.location(capture.directory));
  if (directory.exists) {
    check(sameIdentity(directory.stat, capture.directoryIdentity), 'Capture directory identity changed');
    check((await fs.readdir(await store.location(capture.directory))).length === 0, 'Capture directory has unrecognized recovery content');
    await guardArchive(store, record, await store.location(capture.directory));
    await fs.rmdir(await store.location(capture.directory));
  }
  capture.directoryRemoved = true;
  // An editor may create a newer public file after capture. Preserve it and stop
  // before withdrawing dependencies of a still-discoverable entry.
  check(!(await fileState(record, entry.destination)).exists, 'A newer public destination is preserved; dependencies remain installed');
  entry.restored = true; event(record, 'archived', 'Archived an owned unchanged file using a verified private capture.'); await persist(store, record);
}
async function finishArchive(store, record, entry) {
  if (entry.capture) {
    const info = await captureState(store, record, entry);
    if (info.exists || entry.capture.verified) return finishCapture(store, record, entry);
  }
  check(await owned(record, entry.destination, entry, 2), 'Owned source is unavailable');
  check(await archivedFile(store, record, entry, 2), 'Owned archive is unavailable');
  entry.archiveLinked = true;
  event(record, 'archive-linked', 'Pinned the exclusive source/archive link pair before completing the move.'); await persist(store, record);
  if (!entry.capture) {
    const index = record.files.indexOf(entry), directory = '_archive/adoptions/' + record.id + '/_capture-' + index;
    entry.capture = { directory, path: directory + '/file', directoryIdentity: null, state: 'planned', verified: false };
    entry.capturePath = await captureLocation(store, entry);
    event(record, 'capture-planned', 'Pinned the neutral private capture path before source withdrawal.'); await persist(store, record);
  }
  const location = await archiveParents(store, record, entry.capture.path);
  const directory = await inspect(await store.location(entry.capture.directory));
  entry.capture.directoryIdentity = identity(directory.stat);
  event(record, 'capture-ready', 'Pinned the exclusive private capture directory identity before atomic source capture.'); await persist(store, record);
  check(!(await captureState(store, record, entry)).exists, 'Private capture destination already exists');
  await guard(record, entry.destination); await guardArchive(store, record, location);
  check(await owned(record, entry.destination, entry, 2), 'Owned source is unavailable');
  check(await archivedFile(store, record, entry, 2), 'Owned archive is unavailable');
  // The archive hardlink already proved that both locations share a filesystem.
  // Rename captures whichever public inode is present atomically; ordinary editor
  // replacements are checked privately rather than unlinked at the public path.
  await fs.rename(entry.destination, location);
  await syncDirectory(path.dirname(entry.destination)); await syncDirectory(path.dirname(location));
  const captured = await captureState(store, record, entry);
  check(captured.exists, 'Atomic source capture is unavailable');
  entry.capture.state = 'captured'; entry.capture.capturedIdentity = identity(captured.stat);
  event(record, 'captured', 'Captured the public inode privately; verify ownership before cleanup.'); await persist(store, record);
  await finishCapture(store, record, entry);
}
async function withdraw(store, record, entry) {
  // A rename may have completed before its progress checkpoint. Inspect the pinned
  // private capture before treating an absent public source as already restored.
  if (entry.capture) {
    const capture = await captureState(store, record, entry);
    if (capture.exists || entry.capture.verified) { await finishCapture(store, record, entry); return; }
  }
  const target = await fileState(record, entry.destination);
  if (!target.exists) {
    if (entry.archive) check(await archivedFile(store, record, entry), 'Archived file is unavailable; review manually');
    else if (entry.identity) await clearStage(record, entry, store);
    entry.restored = true; return;
  }
  check(entry.identity, 'Destination was not recorded as an owned file');
  if (entry.archive) {
    const archive = await inspect(await store.location(entry.archive), true);
    if (archive.exists) { await finishArchive(store, record, entry); return; }
  }
  await clearStage(record, entry, store);
  check(await owned(record, entry.destination, entry), 'Owned source is unavailable');
  entry.archive = '_archive/adoptions/' + record.id + '/' + entry.path;
  event(record, 'archive-planned', 'Recorded the archive destination before withdrawing the owned file.'); await persist(store, record);
  const destination = await archiveParents(store, record, entry.archive);
  await guard(record, entry.destination);
  check(await owned(record, entry.destination, entry), 'Owned source is unavailable');
  await guardArchive(store, record, destination);
  // link is exclusive on every supported platform and fails with EXDEV across volumes.
  await fs.link(entry.destination, destination);
  await guardArchive(store, record, destination); await guard(record, entry.destination);
  await syncDirectory(path.dirname(destination));
  await finishArchive(store, record, entry);
}
export async function restoreAdoption(options) {
  const expected = await canonical(options);
  return serialized(expected.root, async () => {
    await validateRecord(options.record, options, expected);
    if (options.record.status === 'restored') return structuredClone(options.record);
    const record = structuredClone(options.record);
    record.status = 'restoring'; record.error = ''; record.recovery = [];
    event(record, 'restoring', 'Withdraw the skill entry first; preserve dependencies if withdrawal cannot be verified.');
    try {
      await persist(options.store, record);
      const ordered = [...record.files].sort((a, b) => Number(b.path.endsWith('/SKILL.md')) - Number(a.path.endsWith('/SKILL.md')));
      const skill = ordered.find(entry => entry.path.endsWith('/SKILL.md'));
      for (const entry of ordered) {
        if (entry !== skill) check(!(await fileState(record, skill.destination)).exists, 'A public skill entry exists; preserve its dependencies');
        await withdraw(options.store, record, entry);
      }
      for (const directory of [...record.directories].sort((a, b) => b.path.length - a.path.length)) {
        if (directory.removed) continue;
        const info = await inspect(directory.path);
        if (!info.exists) { directory.removed = true; continue; }
        check(sameIdentity(info.stat, directory), 'Owned directory identity changed');
        if ((await fs.readdir(directory.path)).length) {
          directory.retained = true; event(record, 'directory-retained', 'Retained a nonempty directory shared with other files.');
          await persist(options.store, record); continue;
        }
        await guard(record, directory.path); await fs.rmdir(directory.path); directory.removed = true;
        event(record, 'directory-removed', 'Removed an owned empty directory.'); await persist(options.store, record);
      }
      record.status = 'restored'; event(record, 'restored', 'Owned unchanged files were archived. No generated script was executed.'); await persist(options.store, record);
      return record;
    } catch (error) { return failed(options.store, record, error, true); }
  });
}

