import { redact } from './analysis.mjs';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const CLAUDE_RESERVED = new Set(['synced', 'anthropic-skills']);
const GENERATED_LIMIT = 64000;
const ARCHIVE_LIMIT = 100 * 1024;
const UTF8_FLAG = 0x0800;
const DOS_DATE = 0x0021; // 1980-01-01, with a zero time in both ZIP headers.
const REGULAR_0600 = 0o100600 * 65536;

function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Supply a reusable bundle and request');
}
function slug(value) {
  if (typeof value !== 'string' || value.length > 63 || !SLUG.test(value) || DEVICE.test(value)) throw new Error('Choose a portable lowercase slug of at most 63 characters');
  return value;
}
function content(value) {
  if (typeof value !== 'string' || value.length > GENERATED_LIMIT || value.includes('\0')) throw new Error('Generated content must be bounded text without NUL');
  if (redact(value) !== value || /\[REDACTED[^\]\r\n]*\]/i.test(value)) throw new Error('Generated content contains sensitive material or redacted placeholders');
  const data = Buffer.from(value, 'utf8');
  if (data.toString('utf8') !== value) throw new Error('Generated content must contain valid Unicode text');
  return data;
}
function validate(bundle, request) {
  object(bundle); object(request);
  if (!['codex', 'claude'].includes(request.targetAgent) || !['explicit', 'automatic'].includes(request.invocation) || !['repo', 'global'].includes(request.placement)) throw new Error('Choose a valid target agent, invocation and placement');
  if (request.placement === 'repo' && (typeof request.repo !== 'string' || !request.repo.trim())) throw new Error('Repository placement requires a captured repository');
  const name = slug(bundle.name);
  if (request.targetAgent === 'claude' && CLAUDE_RESERVED.has(name)) throw new Error('Choose a name outside reserved Claude skill directories');
  if (!Array.isArray(bundle.files) || bundle.files.length < 2 || bundle.files.length > 7) throw new Error('Supply the required skill and workflow with at most four scripts');
  const skill = 'skills/' + name + '/SKILL.md', workflow = 'workflows/' + name + '.md';
  const policy = 'skills/' + name + '/agents/openai.yaml', scriptPrefix = 'scripts/' + name + '/';
  const seen = new Set();
  let scripts = 0, total = 0;
  const entries = bundle.files.map(file => {
    object(file);
    if (Object.keys(file).length !== 2 || !Object.hasOwn(file, 'path') || !Object.hasOwn(file, 'content') || typeof file.path !== 'string') throw new Error('Supply generated files with only path and content');
    const path = file.path;
    if (!/^[\x20-\x7e]+$/.test(path) || path.includes('\\') || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Generated paths must be safe relative ASCII paths');
    const folded = path.toLowerCase();
    if (seen.has(folded)) throw new Error('Generated paths must be unique without case collisions');
    seen.add(folded);
    if (path === policy) {
      if (request.targetAgent !== 'codex' || request.invocation !== 'explicit') throw new Error('Codex policy metadata is allowed only for explicit Codex invocation');
    } else if (path !== skill && path !== workflow) {
      if (!path.startsWith(scriptPrefix) || !path.endsWith('.mjs')) throw new Error('Unexpected generated bundle path');
      slug(path.slice(scriptPrefix.length, -4));
      if (++scripts > 4) throw new Error('Supply at most four scripts');
    }
    const data = content(file.content);
    total += data.length;
    if (total > GENERATED_LIMIT) throw new Error('Generated bundle exceeds 64000 UTF-8 bytes');
    return { path, data };
  });
  if (!seen.has(skill.toLowerCase()) || !seen.has(workflow.toLowerCase())) throw new Error('The generated skill and workflow are required');
  return { name, entries };
}

function adoptionGuide(name, request) {
  const root = (request.placement === 'global' ? '~/' : '') + (request.targetAgent === 'claude' ? '.claude' : '.agents');
  const destination = request.placement === 'repo'
    ? 'Use the repository captured when this draft was created. Verify the repository manually before adoption.'
    : 'Use your user home for global placement. Verify the intended home manually before adoption.';
  const invocation = request.invocation === 'explicit'
    ? 'Invoke this draft explicitly with ' + (request.targetAgent === 'claude' ? '/' : '$') + name + '.'
    : 'Test the workflow with one matching trigger and one non-trigger. Confirm that automatic selection happens only when intended before keeping it.';
  return [
    '# Adopt this generated bundle', '',
    'Every file is generated and untested. Downloading does not install the bundle or execute any script.', '',
    '1. Extract into a NEW review folder first. Review every file, including every script, before adopting or executing anything.',
    '2. Keep skills/, workflows/ and scripts/ as sibling directories. The skill entry links to the deferred workflow and scripts. Do not copy only SKILL.md.',
    '3. ' + destination,
    '4. For the selected ' + request.targetAgent + ' target, preserve those siblings under ' + root + '/. The entry belongs at ' + root + '/skills/' + name + '/SKILL.md. Claude defaults to .claude/skills and Codex defaults to .agents/skills under the selected repository or user home. Alternate homes, managed setups and other discovery locations require manual verification.',
    '5. An existing destination must not be overwritten. Use a new name or make a new draft, updating its linked paths consistently.',
    '6. ' + invocation + ' Explicit skill invocation uses /name in Claude and $name in Codex.',
    '7. Start a fresh agent session. Verify skill discovery and expected outcomes before keeping the bundle. Perform the listed checks yourself; the utility has not run them.',
    '8. Do not add eager @imports to always-loaded instructions. Keep workflow and script bodies deferred until needed.', '',
    'The archive includes generated assets and this guide only. Adoption remains a separate manual action.', '',
    'Sources: [Claude skills](https://code.claude.com/docs/en/skills) and [Codex skills](https://learn.chatgpt.com/docs/build-skills).', ''
  ].join('\n');
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(entries) {
  const localParts = [], centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8'), checksum = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(entry.data.length, 18); local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, entry.data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8_FLAG, 8); central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(entry.data.length, 20); central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(REGULAR_0600, 38); central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + entry.data.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  const archive = Buffer.concat([...localParts, ...centralParts, end]);
  if (archive.length > ARCHIVE_LIMIT) throw new Error('Portable archive exceeds 100 KiB');
  return archive;
}

export function exportReusableBundle(bundle, request) {
  const { name, entries } = validate(bundle, request);
  entries.push({ path: 'INSTALL.md', data: Buffer.from(adoptionGuide(name, request), 'utf8') });
  return {
    filename: name + '.zip', contentType: 'application/zip', encoding: 'base64',
    data: zip(entries).toString('base64'), files: entries.map(entry => entry.path)
  };
}
