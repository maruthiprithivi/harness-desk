import test from 'node:test';
import assert from 'node:assert/strict';
import { exportReusableBundle } from '../lib/reusable-export.mjs';

const request = extra => ({ targetAgent: 'codex', invocation: 'explicit', placement: 'global', repo: '', ...extra });
function fixture(name = 'count-records') {
  return { name, files: [
    { path: 'skills/' + name + '/SKILL.md', content: '---\nname: ' + name + '\ndescription: Count supplied records.\n---\n\nRead the deferred workflow.\n' },
    { path: 'workflows/' + name + '.md', content: '# Workflow\n\nReview café and 界 input before adoption.\n' },
    { path: 'scripts/' + name + '/run.mjs', content: 'throw new Error("Generated fixture must never execute");\n' }
  ] };
}

// Deliberately use a bit-at-a-time CRC implementation instead of the exporter table.
function checksum(data) {
  let value = 0xffffffff;
  for (const byte of data) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  }
  return (value ^ 0xffffffff) >>> 0;
}
function readArchive(output) {
  assert.equal(output.contentType, 'application/zip');
  assert.equal(output.encoding, 'base64');
  const data = Buffer.from(output.data, 'base64');
  assert.equal(data.toString('base64'), output.data);
  assert.ok(data.length <= 100 * 1024);
  const end = data.length - 22;
  assert.equal(data.readUInt32LE(end), 0x06054b50);
  assert.equal(data.readUInt16LE(end + 4), 0);
  assert.equal(data.readUInt16LE(end + 6), 0);
  assert.equal(data.readUInt16LE(end + 20), 0);
  const count = data.readUInt16LE(end + 10), directorySize = data.readUInt32LE(end + 12), directoryOffset = data.readUInt32LE(end + 16);
  assert.equal(data.readUInt16LE(end + 8), count);
  assert.equal(directoryOffset + directorySize, end);
  const entries = [];
  let offset = 0;
  while (offset < directoryOffset) {
    const localOffset = offset;
    assert.equal(data.readUInt32LE(offset), 0x04034b50);
    assert.equal(data.readUInt16LE(offset + 4), 20);
    assert.equal(data.readUInt16LE(offset + 6), 0x0800);
    assert.equal(data.readUInt16LE(offset + 8), 0);
    assert.equal(data.readUInt16LE(offset + 10), 0);
    assert.equal(data.readUInt16LE(offset + 12), 0x0021);
    const crc = data.readUInt32LE(offset + 14), size = data.readUInt32LE(offset + 22), nameLength = data.readUInt16LE(offset + 26);
    assert.equal(data.readUInt32LE(offset + 18), size);
    assert.equal(data.readUInt16LE(offset + 28), 0);
    const path = data.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    offset += 30 + nameLength;
    assert.ok(offset + size <= directoryOffset);
    const bytes = data.subarray(offset, offset + size);
    assert.equal(checksum(bytes), crc);
    entries.push({ path, content: bytes.toString('utf8'), crc, size, localOffset });
    offset += size;
  }
  assert.equal(offset, directoryOffset);
  assert.equal(entries.length, count);
  for (const entry of entries) {
    assert.equal(data.readUInt32LE(offset), 0x02014b50);
    assert.equal(data.readUInt16LE(offset + 4), 0x0314);
    assert.equal(data.readUInt16LE(offset + 6), 20);
    assert.equal(data.readUInt16LE(offset + 8), 0x0800);
    assert.equal(data.readUInt16LE(offset + 10), 0);
    assert.equal(data.readUInt16LE(offset + 12), 0);
    assert.equal(data.readUInt16LE(offset + 14), 0x0021);
    assert.equal(data.readUInt32LE(offset + 16), entry.crc);
    assert.equal(data.readUInt32LE(offset + 20), entry.size);
    assert.equal(data.readUInt32LE(offset + 24), entry.size);
    const nameLength = data.readUInt16LE(offset + 28);
    assert.equal(data.readUInt16LE(offset + 30), 0);
    assert.equal(data.readUInt16LE(offset + 32), 0);
    assert.equal(data.readUInt16LE(offset + 34), 0);
    assert.equal(data.readUInt16LE(offset + 36), 0);
    assert.equal(data.readUInt32LE(offset + 38) >>> 16, 0o100600);
    assert.equal(data.readUInt32LE(offset + 38) & 0xffff, 0);
    assert.equal(data.readUInt32LE(offset + 42), entry.localOffset);
    assert.equal(data.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'), entry.path);
    offset += 46 + nameLength;
  }
  assert.equal(offset, end);
  assert.deepEqual(output.files, entries.map(entry => entry.path));
  return entries;
}

test('stored ZIP headers, CRCs, permissions and UTF-8 contents round-trip independently', () => {
  assert.equal(checksum(Buffer.from('123456789')), 0xcbf43926);
  const bundle = fixture();
  bundle.files.push({ path: 'skills/count-records/agents/openai.yaml', content: 'policy:\n  allow_implicit_invocation: false\n' });
  bundle.files[2].content = '123456789';
  const before = structuredClone(bundle);
  const output = exportReusableBundle(bundle, request());
  const entries = readArchive(output);
  assert.equal(output.filename, 'count-records.zip');
  assert.deepEqual(entries.slice(0, bundle.files.length).map(({ path, content }) => ({ path, content })), bundle.files);
  assert.equal(entries[2].crc, 0xcbf43926);
  assert.equal(entries.at(-1).path, 'INSTALL.md');
  assert.deepEqual(bundle, before);
  assert.equal(exportReusableBundle(bundle, request()).data, output.data);
});

test('export omits request fields and bundle provenance while preserving only generated assets', () => {
  const hidden = ['private-task-marker', 'private-notes-marker', 'private-candidate-marker', 'private-repository-marker', 'private-path-marker', 'private-provenance-marker', 'private-description-marker'];
  const bundle = { ...fixture(), description: hidden[6], provenance: { marker: hidden[5] } };
  const sourceRequest = request({ placement: 'repo', repo: hidden[3], task: hidden[0], notes: hidden[1], candidate: { pattern: hidden[2] }, paths: [hidden[4]], provenance: hidden[5] });
  const output = exportReusableBundle(bundle, sourceRequest);
  const entries = readArchive(output), allText = entries.map(entry => entry.content).join('\n');
  for (const marker of hidden) assert.equal(allText.includes(marker), false, marker);
  assert.deepEqual(output.files, [...bundle.files.map(file => file.path), 'INSTALL.md']);
  const changedRequest = { ...sourceRequest, repo: 'different-private-repository', notes: 'different-private-notes', candidate: null };
  assert.equal(exportReusableBundle(bundle, changedRequest).data, output.data);
  assert.equal(Object.hasOwn(output, 'request'), false);
});

test('the guide captures only target, placement and invocation choices with manual adoption checks', () => {
  for (const targetAgent of ['codex', 'claude']) for (const placement of ['global', 'repo']) for (const invocation of ['explicit', 'automatic']) {
    const choice = request({ targetAgent, placement, invocation, repo: placement === 'repo' ? '/fixture/captured-repo' : '' });
    const guide = readArchive(exportReusableBundle(fixture(), choice)).at(-1).content;
    for (const phrase of ['generated and untested', 'NEW review folder', 'every script', 'does not install', 'execute any script', 'sibling directories', 'existing destination must not be overwritten', 'new name', 'new draft', 'fresh agent session', 'expected outcomes', 'eager @imports', '.claude/skills', '.agents/skills', 'https://code.claude.com/docs/en/skills', 'https://learn.chatgpt.com/docs/build-skills']) assert.ok(guide.includes(phrase), phrase);
    assert.ok(guide.includes(placement === 'repo' ? 'repository captured' : 'your user home'));
    const root = (placement === 'global' ? '~/' : '') + (targetAgent === 'claude' ? '.claude' : '.agents');
    assert.ok(guide.includes(root + '/skills/count-records/SKILL.md'));
    if (invocation === 'explicit') assert.ok(guide.includes('explicitly with ' + (targetAgent === 'claude' ? '/' : '$') + 'count-records'));
    else for (const phrase of ['one matching trigger', 'one non-trigger', 'automatic selection']) assert.ok(guide.includes(phrase));
    assert.equal(guide.includes('/fixture/captured-repo'), false);
  }
});

test('invalid target, invocation and placement are rejected independently', () => {
  for (const choice of [null, [], {}, request({ targetAgent: 'other' }), request({ targetAgent: 'Codex' }), request({ invocation: 'sometimes' }), request({ placement: 'local' }), request({ placement: 'repo' }), request({ placement: 'repo', repo: ' ' }), request({ placement: 'repo', repo: 1 })]) assert.throws(() => exportReusableBundle(fixture(), choice));
  for (const bundle of [null, [], {}, { name: 'count-records', files: null }]) assert.throws(() => exportReusableBundle(bundle, request()));
});

test('slug and script names reject device names and Claude reserved directories', () => {
  for (const name of ['../escape', 'Count', 'a/b', 'a_b', '', 'a'.repeat(64), 'con', 'prn', 'aux', 'nul', 'com1', 'com9', 'lpt1', 'lpt9']) assert.throws(() => exportReusableBundle(fixture(name), request()));
  for (const name of ['synced', 'anthropic-skills']) {
    assert.throws(() => exportReusableBundle(fixture(name), request({ targetAgent: 'claude' })), /reserved Claude/);
    readArchive(exportReusableBundle(fixture(name), request()));
  }
  readArchive(exportReusableBundle(fixture('a'.repeat(63)), request()));
  for (const name of ['con.mjs', 'lpt1.mjs', 'Run.mjs', 'run.MJS', 'a'.repeat(64) + '.mjs']) {
    const bundle = fixture();
    bundle.files[2].path = 'scripts/count-records/' + name;
    assert.throws(() => exportReusableBundle(bundle, request()));
  }
});

test('unsafe, mismatched, unknown, duplicate and case-colliding paths are rejected', () => {
  for (const path of ['/absolute.md', 'C:/absolute.md', '../escape.md', 'skills/count-records/../escape.md', 'skills//count-records/SKILL.md', 'skills/count-records/./SKILL.md', 'skills\\count-records\\SKILL.md', 'skills/count-records/SKILL.md\0', 'workflows/count-records.md\n', 'skills/other/SKILL.md', 'scripts/count-records/nested/run.mjs', 'scripts/count-records/run.js', 'skills/count-records/agents/unknown.yaml', 'INSTALL.md', 'manifest.json', 'workflows/café.md']) {
    const bundle = fixture();
    bundle.files.push({ path, content: 'Draft only.\n' });
    assert.throws(() => exportReusableBundle(bundle, request()));
  }
  for (const path of ['skills/count-records/SKILL.md', 'skills/count-records/skill.md']) {
    const bundle = fixture();
    bundle.files.push({ path, content: 'Duplicate draft.\n' });
    assert.throws(() => exportReusableBundle(bundle, request()), /case collisions/);
  }
  assert.throws(() => exportReusableBundle({ ...fixture(), name: 'different-name' }, request()));
  for (const missing of [0, 1]) {
    const bundle = fixture();
    bundle.files.splice(missing, 1);
    assert.throws(() => exportReusableBundle(bundle, request()), /required/);
  }
  const extraField = fixture();
  extraField.files[0].mode = 'symlink';
  assert.throws(() => exportReusableBundle(extraField, request()), /only path and content/);
});

test('four scripts are allowed and optional Codex policy requires explicit Codex target', () => {
  const bundle = fixture();
  for (let index = 1; index <= 3; index++) bundle.files.push({ path: 'scripts/count-records/helper-' + index + '.mjs', content: 'export const value = 1;\n' });
  readArchive(exportReusableBundle(bundle, request()));
  bundle.files.push({ path: 'scripts/count-records/fifth.mjs', content: 'export const value = 1;\n' });
  assert.throws(() => exportReusableBundle(bundle, request()), /four scripts/);
  const policy = fixture();
  policy.files.push({ path: 'skills/count-records/agents/openai.yaml', content: 'policy:\n  allow_implicit_invocation: false\n' });
  readArchive(exportReusableBundle(policy, request()));
  for (const choice of [request({ invocation: 'automatic' }), request({ targetAgent: 'claude' }), request({ targetAgent: 'claude', invocation: 'automatic' })]) assert.throws(() => exportReusableBundle(policy, choice), /explicit Codex/);
});

test('content validation rejects sensitive text, placeholders, invalid Unicode and oversized UTF-8', () => {
  const sensitive = [['pass', 'word'].join('') + '=fixture-hidden', ['Bear', 'er fixture-hidden'].join(''), '[REDACTED]', '[REDACTED PRIVATE KEY]'];
  for (const value of [...sensitive, 'bad\0text', '\ud800', 42]) {
    const bundle = fixture();
    bundle.files[2].content = value;
    assert.throws(() => exportReusableBundle(bundle, request()));
  }
  const oversized = fixture();
  oversized.files[1].content = '界'.repeat(22000);
  assert.throws(() => exportReusableBundle(oversized, request()), /64000 UTF-8 bytes/);
  oversized.files[1].content = 'x'.repeat(64001);
  assert.throws(() => exportReusableBundle(oversized, request()), /bounded text/);
  const boundary = fixture();
  const otherBytes = boundary.files.filter((_, index) => index !== 1).reduce((sum, file) => sum + Buffer.byteLength(file.content), 0);
  boundary.files[1].content = 'x'.repeat(64000 - otherBytes);
  const output = exportReusableBundle(boundary, request());
  const entries = readArchive(output);
  assert.equal(entries.slice(0, -1).reduce((sum, entry) => sum + entry.size, 0), 64000);
  assert.ok(Buffer.from(output.data, 'base64').length < 100 * 1024);
});
