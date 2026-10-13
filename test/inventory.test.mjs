import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scan } from '../lib/inventory.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-inventory-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  await fs.mkdir(home);
  return {
    root, home,
    async write(relative, content = '') {
      const file = path.join(root, relative);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, content);
      return file;
    },
    async repo(relative) {
      const dir = path.join(root, relative);
      await fs.mkdir(path.join(dir, '.git'), { recursive: true });
      return dir;
    },
  };
}
const byPath = (result, file) => result.items.find(item => item.path === file);

test('discovers global homes, nested plugin skills, scoped repo files and nested or explicit repositories', async t => {
  const f = await fixture(t);
  const body = '# Procedures\n' + 'Long procedure. '.repeat(80);
  const skill = '---\nname: lean\ndescription: >-\n  Audit repeated work\n  with narrow context.\n---\n' + body;
  const skillFile = await f.write('home/.claude/skills/lean/SKILL.md', skill);
  const pluginSkill = await f.write('home/.codex/plugins/cache/vendor/tool/1.0/skills/lean/SKILL.md', skill);
  const sharedSkill = await f.write('home/.agents/skills/shared/SKILL.md', '---\nname: shared\ndescription: Run shared checks.\n---\n# Check\n');
  const homeInstructions = [];
  for (const name of ["AGENTS.md", "AGENTS.override.md", "CLAUDE.md", "CLAUDE.local.md"]) homeInstructions.push(await f.write("home/" + name, "# Home " + name + "\n"));
  const homeClaudeConfig = await f.write("home/.claude.json", "DO_NOT_RETURN_HOME_CONFIG");
  const homeMcpConfig = await f.write("home/.mcp.json", "DO_NOT_RETURN_HOME_MCP");
  const homeDelegation = await f.write("home/.model-gateway.json", "DO_NOT_RETURN_HOME_DELEGATION");
  const globalClaude = await f.write('home/.claude/CLAUDE.md', '# Global constraints\n');
  for (const dir of ['.kimi-code', '.kimi', '.orca', '.kiro']) await f.write('home/' + dir + '/config.toml', 'DO_NOT_RETURN_THIS_CONFIGURATION');
  const gateway = await f.write('home/.config/model-gateway/providers/settings.json', 'DO_NOT_RETURN_THIS_CONFIGURATION');
  const repo = await f.repo('repos/a');
  const nestedRepo = await f.repo('repos/a/packages/b');
  const explicitRepo = await f.repo('outside/c');
  const rootInstruction = await f.write('repos/a/AGENTS.md', '# Project constraints\n');
  const localInstruction = await f.write('repos/a/src/AGENTS.override.md', '# Source constraints\n');
  const scopedRule = await f.write('repos/a/.claude/rules/ui.md', '---\npaths:\n  - src/**/*.jsx\n---\nKeep keyboard focus visible.\n');
  const command = await f.write('repos/a/.claude/commands/check.md', '# Run verification\n');
  const subagent = await f.write('repos/a/.claude/agents/reviewer.md', '---\nname: reviewer\ndescription: Review a narrow patch.\n---\nReturn findings only.\n');
  const config = await f.write('repos/a/.mcp.json', '{"apiKey":"DO_NOT_RETURN_THIS_CONFIGURATION"}');
  const repoDelegation = await f.write("repos/a/.model-gateway.json", "DO_NOT_RETURN_REPO_DELEGATION");
  const repoScript = await f.write("repos/a/scripts/audit.sh", "DO_NOT_RETURN_REPO_SCRIPT");
  const hook = await f.write('repos/a/.claude/hooks/check.ps1', 'Write-Output DO_NOT_RETURN_THIS_SCRIPT');
  await f.write('repos/a/packages/b/AGENTS.md', '# Nested repo\n');
  await f.write('outside/c/CLAUDE.md', '# Explicit repo\n');
  const result = await scan({ home: f.home, repoRoots: [path.join(f.root, 'repos')], repos: [explicitRepo] });
  assert.deepEqual(result.repos, [explicitRepo, repo, nestedRepo].sort());
  for (const file of homeInstructions) {
    assert.equal(byPath(result, file).scope, "global");
    assert.equal(byPath(result, file).repo, "");
    assert.equal(byPath(result, file).type, "instruction");
  }
  assert.equal(byPath(result, globalClaude).scope, 'global');
  assert.equal(byPath(result, globalClaude).loadMode, 'eager');
  assert.equal(byPath(result, rootInstruction).scope, 'repo');
  assert.equal(byPath(result, localInstruction).scope, 'path');
  assert.equal(byPath(result, localInstruction).repo, repo);
  assert.equal(byPath(result, scopedRule).scope, 'path');
  assert.equal(byPath(result, scopedRule).loadMode, 'lazy');
  assert.equal(byPath(result, command).type, 'command');
  assert.equal(byPath(result, command).loadMode, 'on-invoke');
  assert.equal(byPath(result, subagent).type, 'subagent');
  assert.ok(byPath(result, subagent).residentTokens > 0);
  assert.equal(byPath(result, skillFile).residentTokens, Math.ceil(Buffer.byteLength('lean\nAudit repeated work with narrow context.') / 4));
  assert.equal(byPath(result, skillFile).bodyTokens, Math.ceil(Buffer.byteLength(body) / 4));
  assert.equal(byPath(result, skillFile).estTokens, Math.ceil(Buffer.byteLength(skill) / 4));
  assert.ok(byPath(result, skillFile).residentTokens < byPath(result, skillFile).estTokens);
  assert.equal(byPath(result, pluginSkill).agent, 'codex');
  assert.equal(byPath(result, sharedSkill).agent, 'shared');
  assert.ok([skillFile, pluginSkill].includes(byPath(result, skillFile).duplicateOf || byPath(result, pluginSkill).duplicateOf));
  assert.equal(result.items.filter(item => item.duplicateOf).length, 1);
  assert.equal(byPath(result, gateway).agent, 'model-gateway');
  for (const file of [gateway, config, hook, homeClaudeConfig, homeMcpConfig, homeDelegation, repoDelegation, repoScript]) {
    const item = byPath(result, file);
    assert.equal(item.estTokens, null);
    assert.equal(item.residentTokens, null);
    assert.equal(item.loadMode, 'unknown');
    assert.equal(item.duplicateOf, null);
  }
  assert.equal(byPath(result, config).transport, 'unknown');
  assert.equal(byPath(result, config).toolCount, null);
  assert.equal(byPath(result, hook).type, "hook");
  assert.equal(byPath(result, homeClaudeConfig).type, "config");
  assert.equal(byPath(result, homeClaudeConfig).scope, "global");
  assert.equal(byPath(result, homeMcpConfig).type, "mcp-server");
  assert.equal(byPath(result, homeDelegation).type, "delegation");
  assert.equal(byPath(result, homeDelegation).scope, "global");
  assert.equal(byPath(result, repoDelegation).type, "delegation");
  assert.equal(byPath(result, repoDelegation).repo, repo);
  assert.equal(byPath(result, repoScript).type, "script");
  assert.ok(result.items.every(item => item.usage === 'unknown' && !('content' in item)));
  assert.ok(result.items.every(item => /has not been observed/.test(item.loadEvidence)));
  assert.ok(!JSON.stringify(result).includes('DO_NOT_RETURN'));
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.coverage, { partial: false, limitsReached: [] });
});

test('skips sensitive names, transcripts, arbitrary Markdown, hidden builds and symlinks', async t => {
  const f = await fixture(t);
  const repo = await f.repo('repos/a');
  const allowed = await f.write('repos/a/AGENTS.md', '# Allowed\n');
  for (const relative of [
    'home/.codex/auth.json', 'home/.claude/credentials.json', 'home/.claude/.env',
    'home/.claude/secrets/AGENTS.md', 'home/.claude/skills/unsafe/secret.sops.md',
    'home/.claude/projects/session/AGENTS.md', 'home/.claude/sessions/AGENTS.md',
    'home/.claude/transcripts/AGENTS.md', 'home/.claude/logs/AGENTS.md',
    'repos/a/secrets/AGENTS.md', 'repos/a/.envrc', 'repos/a/private-key.md',
    'repos/a/.sops.yaml', 'repos/a/auth/AGENTS.md', 'repos/a/node_modules/AGENTS.md',
    'repos/a/.hidden/AGENTS.md', 'repos/a/dist/AGENTS.md', 'repos/a/build/AGENTS.md',
    "repos/a/README.md", "repos/a/src/agents/notes.md", "repos/a/config.json",
    "repos/a/src/scripts/check.sh", "repos/a/src/.model-gateway.json", "home/random.json",
  ]) await f.write(relative, 'DO_NOT_RETURN_SECRET_OR_TRANSCRIPT');
  const target = await f.write('outside/AGENTS.md', 'DO_NOT_READ_LINK_TARGET');
  await fs.symlink(target, path.join(repo, 'CLAUDE.md'));
  await fs.symlink(path.dirname(target), path.join(repo, 'linked'));
  const linkedRoot = path.join(f.root, 'linked-root');
  await fs.symlink(path.dirname(target), linkedRoot);
  const result = await scan({ home: f.home, repoRoots: [path.join(f.root, 'repos')], repos: [linkedRoot] });
  assert.deepEqual(result.items.map(item => item.path), [allowed]);
  assert.ok(result.warnings.some(warning => /Symlink source excluded/.test(warning)));
  assert.ok(result.warnings.some(warning => warning.includes(path.join(repo, "CLAUDE.md"))));
  assert.ok(result.warnings.some(warning => warning.includes(path.join(repo, "linked"))));
  assert.ok(!JSON.stringify(result).includes('DO_NOT_RETURN'));
  assert.ok(!JSON.stringify(result).includes('DO_NOT_READ'));
  const ancestorLink = path.join(f.root, 'linked-parent');
  await fs.symlink(path.join(f.root, 'repos'), ancestorLink);
  const throughAncestor = await scan({ home: f.home, repos: [path.join(ancestorLink, 'a')] });
  assert.equal(throughAncestor.items.length, 0);
  assert.ok(throughAncestor.warnings.some(warning => /Symlink source excluded/.test(warning)));
});

test('keeps oversized Markdown metadata, stable IDs and explicit non-Git directories', async t => {
  const f = await fixture(t);
  const big = await f.write('home/.claude/skills/large/SKILL.md', '---\nname: large\ndescription: Do not load me.\n---\n' + 'x'.repeat(256 * 1024));
  const plain = path.join(f.root, 'plain');
  const instruction = await f.write('plain/AGENTS.md', '# Standalone directory\n');
  const options = { home: f.home, repos: [plain, plain] };
  const first = await scan(options);
  const second = await scan(options);
  assert.deepEqual(first.repos, [plain]);
  assert.equal(first.items.length, 2);
  assert.deepEqual(first.items.map(item => item.id), second.items.map(item => item.id));
  assert.equal(byPath(first, instruction).repo, plain);
  assert.equal(byPath(first, big).bodyTokens, null);
  assert.equal(byPath(first, big).residentTokens, null);
  assert.equal(byPath(first, big).duplicateOf, null);
  assert.ok(byPath(first, big).estTokens > 65536);
  assert.ok(first.warnings.some(warning => /256 KiB/.test(warning)));
  assert.ok(first.warnings.some(warning => /no Git marker/.test(warning)));
});

test('bounds traversal and validates input paths without traversing missing roots', async t => {
  const f = await fixture(t);
  let deep = 'repos';
  for (let i = 0; i < 15; i++) deep += '/level' + i;
  const deepRepo = await f.repo(deep);
  await f.write(deep + '/AGENTS.md', '# Too deep\n');
  const result = await scan({ home: f.home, repoRoots: [path.join(f.root, 'repos'), path.join(f.root, 'missing')] });
  assert.ok(!result.repos.includes(deepRepo));
  assert.equal(result.items.length, 0);
  assert.ok(result.warnings.some(warning => /depth limit/.test(warning)));
  assert.ok(result.warnings.some(warning => /ENOENT/.test(warning)));
  await assert.rejects(scan({ home: f.home, repos: [''] }), /directory paths/);
  await assert.rejects(scan({ home: f.home, repoRoots: 'bad' }), /directory paths/);
  await assert.rejects(scan({ home: f.home, repos: Array(101).fill(f.root) }), /100/);
});

test('discovers every selected repository before scanning and gives large roots independent entry budgets', async t => {
  const f = await fixture(t);
  const largeExplicit = await f.repo('home/.claude');
  const bulk = path.join(largeExplicit, 'skills');
  await fs.mkdir(bulk);
  for (let start = 0; start < 20005; start += 500) {
    const end = Math.min(start + 500, 20005);
    await Promise.all(Array.from({ length: end - start }, (_, offset) => fs.writeFile(path.join(bulk, 'source-' + (start + offset) + '.txt'), '')));
  }
  const expected = [largeExplicit];
  const instructions = [];
  for (let i = 0; i < 40; i++) {
    const relative = 'repos/repo-' + String(i).padStart(2, '0');
    expected.push(await f.repo(relative));
    instructions.push(await f.write(relative + '/AGENTS.md', '# Repo ' + i + '\n'));
  }
  const codexGlobal = await f.write('home/.codex/AGENTS.md', '# Global Codex instruction\n');
  const result = await scan({ home: f.home, repoRoots: [path.join(f.root, 'repos')], repos: [largeExplicit] });
  assert.deepEqual(result.repos, expected.sort());
  for (const file of [...instructions, codexGlobal]) assert.ok(byPath(result, file), 'independent root omitted: ' + file);
  assert.ok(result.warnings.some(warning => /entry limit.*partial/.test(warning) && warning.includes(largeExplicit)));
  assert.ok(result.warnings.length <= 100);
  assert.equal(result.coverage.partial, true);
  assert.ok(result.coverage.limitsReached.includes("Asset traversal entry limit"));
});

test('retains coverage limits before bounded symlink exclusions', async t => {
  const f = await fixture(t);
  const target = await f.write('elsewhere/AGENTS.md', '# Do not traverse this source\n');
  const links = path.join(f.home, '.claude', 'skills');
  await fs.mkdir(links, { recursive: true });
  for (let i = 0; i < 150; i++) await fs.symlink(path.dirname(target), path.join(links, 'linked-' + i));
  await f.write('home/.codex/skills/oversized/SKILL.md', 'x'.repeat(256 * 1024 + 1));
  const result = await scan({ home: f.home });
  assert.equal(result.coverage.partial, true);
  assert.ok(result.coverage.limitsReached.includes('Markdown file read limit'));
  assert.match(result.warnings[0], /256 KiB read limit/);
  assert.ok(result.warnings.some(warning => /Symlink source excluded/.test(warning)));
  assert.ok(result.warnings.length <= 100);
  assert.equal(result.items.length, 1);
});

test('charges root instructions but keeps global plugin and repo subdirectory instructions conditional', async t => {
  const f = await fixture(t);
  const repo = await f.repo('repos/a');
  const globalRoot = await f.write('home/.codex/AGENTS.md', '# Global root\n');
  const pluginInstruction = await f.write('home/.codex/plugins/cache/pack/1.0/rules/AGENTS.md', '# Plugin directory constraints\n');
  const repoRoot = await f.write('repos/a/AGENTS.md', '# Repository root\n');
  const repoSubdir = await f.write('repos/a/src/AGENTS.md', '# Source directory constraints\n');
  const result = await scan({ home: f.home, repos: [repo] });
  for (const file of [globalRoot, repoRoot]) {
    const item = byPath(result, file);
    assert.equal(item.loadMode, 'eager');
    assert.equal(item.residentTokens, item.estTokens);
  }
  for (const file of [pluginInstruction, repoSubdir]) {
    const item = byPath(result, file);
    assert.equal(item.scope, 'path');
    assert.equal(item.loadMode, 'lazy');
    assert.equal(item.residentTokens, null);
    assert.ok(item.estTokens > 0);
    assert.ok(item.bodyTokens > 0);
    assert.match(item.loadEvidence, /conditional/);
  }
  assert.equal(byPath(result, pluginInstruction).repo, '');
  assert.equal(byPath(result, repoSubdir).repo, repo);
});
