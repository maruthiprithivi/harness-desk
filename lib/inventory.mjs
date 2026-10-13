import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { redact } from './analysis.mjs';

const MAX_DEPTH = 12;
const MAX_ENTRIES = 20000;
const MAX_DISCOVERY_DIRECTORIES = 5000;
const MAX_DISCOVERY_ENTRIES = 100000;
const MAX_ITEMS = 20000;
const MAX_MARKDOWN_BYTES = 256 * 1024;
const MAX_READ_BYTES = 32 * 1024 * 1024;
const HARNESS_DIRS = new Map([
  ['.claude', 'claude'], ['.codex', 'codex'], ['.kimi-code', 'kimi'],
  ['.kimi', 'kimi'], ['.orca', 'orca'], ['.kiro', 'kiro'], ['.agents', 'shared'],
  ['.opencode', 'opencode'], ['.omp', 'omp'], ['.pi', 'pi'],
]);
const GLOBAL_DIRS = [...HARNESS_DIRS].filter(([name]) => !['.omp', '.pi', '.opencode'].includes(name)).map(([name, agent]) => ({ parts: [name], agent }));
GLOBAL_DIRS.push({ parts: ['.omp', 'agent'], agent: 'omp' }, { parts: ['.pi', 'agent'], agent: 'pi' }, { parts: ['.config', 'opencode'], agent: 'opencode' });
GLOBAL_DIRS.push({ parts: ['.config', 'model-gateway'], agent: 'model-gateway' });
const INSTRUCTIONS = new Map([
  ['agents.md', 'shared'], ['agents.override.md', 'shared'],
  ['claude.md', 'claude'], ['claude.local.md', 'claude'],
  ['kimi.md', 'kimi'], ['kiro.md', 'kiro'], ['orca.md', 'orca'],
]);
const CATEGORIES = new Set(['skills', 'agents', 'rules', 'commands', 'hooks', 'scripts', 'steering', 'prompts', 'extensions']);
const GLOBAL_TOP_DIRS = new Set([...CATEGORIES, 'plugins', 'cache', 'settings', '.system', '.claude-plugin', 'extensions', 'prompts', 'steering']);
const SKIP_DIRS = new Set(['node_modules', 'vendor', 'dist', 'build', 'coverage', 'target', '.git', '.venv', 'venv', '__pycache__', 'projects', 'sessions', 'transcripts', 'logs', 'history', 'workspaces', 'sources']);
const SCRIPT_EXTENSIONS = new Set(['.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.rb']);
const CONFIG_EXTENSIONS = new Set(['.json', '.jsonc', '.toml', '.yaml', '.yml']);
const hash = value => createHash('sha256').update(value).digest('hex');
const tokens = value => Math.ceil(Buffer.byteLength(value) / 4);

function excluded(name) {
  return /(?:^|[._-])(?:secrets?|auth(?:entication)?|oauth|credentials?|accounts?|\.ssh)(?:[._-]|$)/i.test(name)
    || /^\.env/i.test(name)
    || /(?:sops|credential|password|passwd|(?:^|[._-])tokens?(?:[._-]|$)|private[._-]?key)/i.test(name)
    || /\.(?:age|pem|key|enc|jsonl)$/i.test(name);
}

async function noSymlink(file) {
  let cursor = path.parse(file).root;
  for (const part of file.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    if ((await fs.lstat(cursor)).isSymbolicLink()) return false;
  }
  return true;
}

function frontmatter(text) {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) return { name: '', description: '', scoped: false, bytes: 0 };
  const lines = match[1].split(/\r?\n/);
  const field = key => {
    const index = lines.findIndex(line => new RegExp('^' + key + '\\s*:').test(line));
    if (index < 0) return '';
    let value = lines[index].replace(/^[^:]+:\s*/, '').trim();
    if (/^[>|][+-]?$/.test(value)) {
      value = lines.slice(index + 1).findIndex(line => line && !/^\s/.test(line));
      const end = value < 0 ? lines.length : index + 1 + value;
      return lines.slice(index + 1, end).map(line => line.trim()).join(' ');
    }
    return value.replace(/^(['"])(.*)\1$/, '$2');
  };
  return { name: field('name'), description: field('description'), scoped: lines.some(line => /^(?:paths|globs)\s*:/.test(line)), bytes: Buffer.byteLength(match[0]) };
}

function classify(relative, agent, repo, inHarness) {
  const parts = relative.split(path.sep);
  const lower = parts.map(part => part.toLowerCase());
  const base = lower.at(-1);
  const ext = path.extname(base);
  const category = lower.find(part => CATEGORIES.has(part));
  let type;
  if (INSTRUCTIONS.has(base)) type = 'instruction';
  else if (inHarness && base === 'skill.md' && category === 'skills') type = 'skill';
  else if (inHarness && ext === '.md' && ['rules', 'steering'].includes(category)) type = 'rule';
  else if (inHarness && ext === '.md' && category === 'agents') type = 'subagent';
  else if (inHarness && ext === '.md' && ['commands', 'prompts'].includes(category)) type = 'command';
  else if (inHarness && category === 'extensions' && SCRIPT_EXTENSIONS.has(ext)) type = 'plugin';
  else if ((inHarness || (repo && lower[0] === "scripts")) && SCRIPT_EXTENSIONS.has(ext) && ['hooks', 'scripts', 'commands'].includes(category)) type = category === 'hooks' ? 'hook' : category === 'commands' ? 'command' : 'script';
  else if (base === ".model-gateway.json" && parts.length === 1) type = "delegation";
  else if (CONFIG_EXTENSIONS.has(ext) && (inHarness || (!repo && parts.length === 1 && base === ".claude.json") || ['.mcp.json', 'mcp.json', 'opencode.json', 'opencode.jsonc'].includes(base))) {
    type = /(?:^|[._-])mcp(?:[._-]|$)/.test(base) ? 'mcp-server' : category === 'hooks' ? 'hook' : lower.includes('plugins') || lower.includes('.claude-plugin') ? 'plugin' : 'config';
  }
  if (!type) return null;
  const instructionRootDepth = HARNESS_DIRS.has(parts[0]) ? 2 : 1;
  const nestedInstruction = type === "instruction" && parts.length > instructionRootDepth;
  return {
    type,
    agent: type === "instruction" ? INSTRUCTIONS.get(base) : type === "delegation" ? "model-gateway" : base === ".claude.json" ? "claude" : ['opencode.json', 'opencode.jsonc'].includes(base) ? 'opencode' : agent,
    scope: nestedInstruction ? "path" : repo ? "repo" : "global",
    markdown: ext === '.md',
    name: type === 'skill' ? parts.at(-2) : path.basename(relative),
  };
}

// shortcut: known filenames infer loading; verify effective precedence and session context through observations.
export async function scan({ home = os.homedir(), repoRoots = [], repos = [] } = {}) {
  if (typeof home !== 'string' || !home.trim()) throw new Error('Choose a home directory');
  for (const list of [repoRoots, repos]) {
    if (!Array.isArray(list) || list.length > 100 || list.some(value => typeof value !== 'string' || !value.trim())) throw new Error('Choose at most 100 directory paths per list');
  }
  const explicitRepos = new Set(repos.map(value => path.resolve(value)));
  const items = [], warnings = [], foundRepos = new Set(), visited = new Set(), seenFiles = new Set();
  const warningKeys = new Set();
  const priorityWarnings = [], coverageWarnings = new Map(), limitsReached = new Set();
  let bytesRead = 0, partial = false;
  const warn = (key, text) => {
    if (warningKeys.has(key)) return;
    warningKeys.add(key);
    const limit = key === "read-budget" ? "Markdown read budget"
      : key.split(":")[0] === "items" ? "Inventory item limit"
      : key.split(":")[0] === "entries" ? "Asset traversal entry limit"
      : key.split(":")[0] === "depth" ? "Asset traversal depth limit"
      : /^discovery-depth:/.test(key) ? "Repository discovery depth limit"
      : /^discovery-entries:/.test(key) ? "Repository discovery entry limit"
      : /^discovery-directories:/.test(key) ? "Repository discovery directory limit"
      : text.includes("256 KiB read limit") ? "Markdown file read limit" : null;
    const failure = /Could not|File changed/.test(text);
    if (limit || failure || /Symlink source excluded|Excluded sensitive source path/.test(text)) partial = true;
    if (limit) limitsReached.add(limit);
    if (limit || failure || /is partial/.test(text)) {
      const category = limit || "Source inspection failure";
      if (!coverageWarnings.has(category)) coverageWarnings.set(category, text);
      if (priorityWarnings.length < 100) priorityWarnings.push(text);
    } else if (warnings.length < 100) warnings.push(text);
  };
  const normalize = value => path.resolve(value);
  const rootAllowed = async (file, required) => {
    try {
      if (file.split(path.sep).some(excluded)) { warn(file, 'Excluded sensitive source path: ' + file); return false; }
      if (!await noSymlink(file)) { warn(file, 'Symlink source excluded: ' + file); return false; }
      const stat = await fs.lstat(file);
      if (!stat.isDirectory()) { warn(file, 'Source is not a directory: ' + file); return false; }
      return true;
    } catch (error) {
      if (required || error.code !== 'ENOENT') warn(file, 'Could not inspect source (' + (error.code || 'error') + '): ' + file);
      return false;
    }
  };
  const addFile = async (file, relative, agent, repo, inHarness) => {
    if (seenFiles.has(file)) return;
    const info = classify(relative, agent, repo, inHarness);
    if (!info) return;
    if (items.length >= MAX_ITEMS) { warn('items', 'Inventory item limit reached; some files were omitted.'); return; }
    seenFiles.add(file);
    let stat;
    try { stat = await fs.lstat(file); }
    catch (error) { warn(file, 'Could not inspect file (' + (error.code || 'error') + '): ' + file); return; }
    if (stat.isSymbolicLink()) { warn(file, "Symlink source excluded: " + file); return; }
    if (!stat.isFile()) return;
    const estTokens = info.markdown ? Math.ceil(stat.size / 4) : null;
    let residentTokens = null, loadMode = 'unknown', loadEvidence = 'Metadata only; effective loading has not been observed.', contentHash = null, bodyTokens = null, description = '';
    if (info.markdown) {
      loadEvidence = 'Inferred from known filename and location; effective loading has not been observed.';
      if (info.type === "instruction") {
        loadMode = info.scope === "path" ? "lazy" : "eager";
        residentTokens = info.scope === "path" ? null : estTokens;
        if (info.scope === "path") loadEvidence = "Inferred conditional on the working directory; effective loading has not been observed.";
      }
      if (info.type === 'skill') loadMode = 'lazy';
      if (['command', 'subagent'].includes(info.type)) { loadMode = 'on-invoke'; residentTokens = null; }
      if (stat.size > MAX_MARKDOWN_BYTES) warn(file, 'Markdown body exceeds the 256 KiB read limit; metadata retained: ' + file);
      else if (bytesRead + stat.size > MAX_READ_BYTES) warn('read-budget', 'Markdown read budget reached; remaining files have metadata only.');
      else {
        let handle;
        try {
          if (!await noSymlink(file)) { warn(file, 'Symlink source excluded: ' + file); return; }
          handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
          const current = await handle.stat();
          if (!current.isFile() || current.size !== stat.size || current.size > MAX_MARKDOWN_BYTES || current.ino !== stat.ino || current.dev !== stat.dev) { warn(file, 'File changed during scan; body excluded: ' + file); return; }
          const buffer = Buffer.alloc(current.size + 1);
          const { bytesRead: count } = await handle.read(buffer, 0, buffer.length, 0);
          if (count !== current.size) { warn(file, 'File changed during scan; body excluded: ' + file); return; }
          bytesRead += count;
          const content = buffer.subarray(0, count);
          contentHash = hash(content);
          const fm = frontmatter(content.toString('utf8'));
          if (['skill','subagent'].includes(info.type)) description = redact(fm.description).slice(0,500);
          bodyTokens = Math.ceil(Math.max(0, count - fm.bytes) / 4);
          if (info.type === 'skill' && fm.description) residentTokens = tokens((fm.name || info.name) + '\n' + fm.description);
          if (info.type === 'subagent' && fm.description) residentTokens = tokens((fm.name || info.name) + '\n' + fm.description);
          if (info.type === 'rule' && fm.scoped) { info.scope = 'path'; loadMode = 'lazy'; residentTokens = null; }
        } catch (error) { warn(file, 'Could not read Markdown (' + (error.code || 'error') + '): ' + file); }
        finally { await handle?.close(); }
      }
    }
    const item = {
      id: hash(file).slice(0, 16), agent: info.agent, scope: info.scope, repo: repo || '',
      type: info.type, path: file, name: info.name, description, bytes: stat.size, estTokens,
      residentTokens, bodyTokens, contentHash, loadMode, loadEvidence, modifiedAt: stat.mtime.toISOString(),
      duplicateOf: null, usage: 'unknown',
    };
    if (info.type === 'mcp-server') Object.assign(item, { transport: 'unknown', toolCount: null });
    items.push({ item, contentHash });
  };
  const walk = async (dir, context, depth = 0, budget = { entries: 0 }) => {
    const key = context.mode + ":" + context.root + ":" + dir;
    if (visited.has(key)) return;
    if (budget.entries >= MAX_ENTRIES) { warn("entries:" + context.root, "Directory entry limit reached; asset inventory is partial beneath: " + context.root); return; }
    if (items.length >= MAX_ITEMS) { warn("items:" + context.root, "Inventory item limit reached; asset inventory is partial beneath: " + context.root); return; }
    if (depth > MAX_DEPTH) { warn("depth:" + context.root, "Directory depth limit reached; asset inventory is partial beneath: " + context.root); return; }
    visited.add(key);
    let repo = explicitRepos.has(dir) ? dir : context.repo || "";
    if (context.mode === "repo") {
      try {
        const git = await fs.lstat(path.join(dir, ".git"));
        if (git.isSymbolicLink()) warn(path.join(dir, ".git"), "Symlink source excluded: " + path.join(dir, ".git"));
        else if (git.isDirectory() || git.isFile()) {
          repo = dir;
          foundRepos.add(dir);
          if (dir !== context.root) return;
        }
      } catch (error) { if (error.code !== "ENOENT") warn(dir + "/.git", "Could not inspect Git marker (" + (error.code || "error") + "): " + dir); }
    }
    try {
      if (!await noSymlink(dir)) { warn(dir, "Symlink source excluded: " + dir); return; }
      const directory = await fs.opendir(dir);
      for await (const entry of directory) {
        if (++budget.entries > MAX_ENTRIES) { warn("entries:" + context.root, "Directory entry limit reached; asset inventory is partial beneath: " + context.root); break; }
        const file = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) { warn(file, "Symlink source excluded: " + file); continue; }
        if (excluded(entry.name)) continue;
        const relative = path.relative(repo || context.root, file);
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name.toLowerCase()) && !(entry.name === "vendor" && context.inHarness)) continue;
          const harnessAgent = HARNESS_DIRS.get(entry.name);
          const knownHidden = harnessAgent || entry.name === ".system" || entry.name === ".claude-plugin";
          if (entry.name.startsWith(".") && !knownHidden) continue;
          if (context.mode === "global" && context.agent !== "model-gateway" && depth === 0 && !GLOBAL_TOP_DIRS.has(entry.name)) continue;
          await walk(file, { ...context, repo, agent: harnessAgent || context.agent, inHarness: context.inHarness || Boolean(harnessAgent) }, depth + 1, budget);
        } else if (entry.isFile() && (context.mode === "global" || repo)) await addFile(file, relative, context.agent, repo, context.inHarness);
        if (items.length >= MAX_ITEMS) { warn("items:" + context.root, "Inventory item limit reached; asset inventory is partial beneath: " + context.root); break; }
      }
      if (budget.entries >= MAX_ENTRIES) warn("entries:" + context.root, "Directory entry limit reached; asset inventory is partial beneath: " + context.root);
    } catch (error) { warn(dir, "Could not scan directory (" + (error.code || "error") + "): " + dir); }
  };
  const discoveryVisited = new Set();
  const discover = async root => {
    const queue = [{ dir: root, depth: 0 }];
    let examined = 0;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const { dir, depth } = queue[cursor];
      const key = root + ":" + dir;
      if (discoveryVisited.has(key)) continue;
      discoveryVisited.add(key);
      if (depth > MAX_DEPTH) { warn("discovery-depth:" + root, "Repository discovery depth limit reached; coverage is partial beneath: " + root); continue; }
      try {
        if (!await noSymlink(dir)) { warn(dir, "Symlink source excluded: " + dir); continue; }
        try {
          const git = await fs.lstat(path.join(dir, ".git"));
          if (git.isSymbolicLink()) warn(path.join(dir, ".git"), "Symlink source excluded: " + path.join(dir, ".git"));
          else if (git.isDirectory() || git.isFile()) { foundRepos.add(dir); continue; }
        } catch (error) { if (error.code !== "ENOENT") warn(dir + "/.git", "Could not inspect Git marker (" + (error.code || "error") + "): " + dir); }
        const directory = await fs.opendir(dir);
        let directoryEntries = 0;
        for await (const entry of directory) {
          if (++directoryEntries > MAX_ENTRIES || ++examined > MAX_DISCOVERY_ENTRIES) {
            warn("discovery-entries:" + root, "Repository discovery entry limit reached; coverage is partial beneath: " + root);
            break;
          }
          const file = path.join(dir, entry.name);
          if (entry.isSymbolicLink()) { warn(file, "Symlink source excluded: " + file); continue; }
          if (!entry.isDirectory() || excluded(entry.name) || SKIP_DIRS.has(entry.name.toLowerCase())) continue;
          if (entry.name.startsWith(".") && !HARNESS_DIRS.has(entry.name)) continue;
          if (queue.length >= MAX_DISCOVERY_DIRECTORIES) {
            warn("discovery-directories:" + root, "Repository discovery directory limit reached; coverage is partial beneath: " + root);
            continue;
          }
          queue.push({ dir: file, depth: depth + 1 });
        }
        if (examined >= MAX_DISCOVERY_ENTRIES) {
          warn("discovery-entries:" + root, "Repository discovery entry limit reached; coverage is partial beneath: " + root);
          break;
        }
      } catch (error) { warn(dir, "Could not discover repositories (" + (error.code || "error") + "): " + dir); }
    }
  };
  for (const value of repos) {
    const root = normalize(value);
    if (!await rootAllowed(root, true)) continue;
    foundRepos.add(root);
    try { const git = await fs.lstat(path.join(root, ".git")); if (git.isSymbolicLink() || (!git.isDirectory() && !git.isFile())) warn(root + ":git", "Explicit repository has no regular Git marker; known files will still be scanned: " + root); }
    catch { warn(root + ":git", "Explicit repository has no Git marker; known files will still be scanned: " + root); }
  }
  for (const value of repoRoots) {
    const root = normalize(value);
    if (await rootAllowed(root, true)) await discover(root);
  }
  for (const root of foundRepos) {
    if (await rootAllowed(root, true)) await walk(root, { mode: "repo", root, repo: root, agent: "shared", inHarness: false });
  }
  const absoluteHome = normalize(home);
  if (await rootAllowed(absoluteHome, false)) {
    for (const name of ["AGENTS.md", "AGENTS.override.md", "CLAUDE.md", "CLAUDE.local.md", ".claude.json", ".mcp.json", ".model-gateway.json"]) {
      const file = path.join(absoluteHome, name);
      try {
        await fs.lstat(file);
        await addFile(file, name, "shared", "", false);
      } catch (error) {
        if (error.code !== "ENOENT") warn(file, "Could not inspect home source (" + (error.code || "error") + "): " + file);
      }
    }
  }
  for (const source of GLOBAL_DIRS) {
    const root = path.join(absoluteHome, ...source.parts);
    if (await rootAllowed(root, false)) await walk(root, { mode: "global", root, agent: source.agent, inHarness: true });
  }
  const firstByHash = new Map();
  items.sort((a, b) => a.item.path.localeCompare(b.item.path));
  for (const { item, contentHash } of items) {
    if (!contentHash) continue;
    if (firstByHash.has(contentHash)) item.duplicateOf = firstByHash.get(contentHash);
    else firstByHash.set(contentHash, item.path);
  }
  const orderedWarnings = [...new Set([...coverageWarnings.values(), ...priorityWarnings, ...warnings])];
  const displayedWarnings = orderedWarnings.slice(0, 100);
  if (orderedWarnings.length > 100) displayedWarnings[99] = "Further inventory warnings were omitted; check coverage and narrow the selected roots.";
  return {
    scannedAt: new Date().toISOString(), items: items.map(entry => entry.item),
    repos: [...foundRepos].sort(), warnings: displayedWarnings,
    coverage: { partial, limitsReached: [...limitsReached] },
  };
}
