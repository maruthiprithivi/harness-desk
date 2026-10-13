import test from "node:test";
import assert from "node:assert/strict";
import { loadingDirectories, loadingMap } from "../lib/loading.mjs";

const home = "/fixture/home";
const repo = home + "/projects/one";
const otherRepo = home + "/projects/two";
function asset(path, options = {}) {
  return { id: path, name: path.split("/").at(-1), path, agent: "shared", type: "instruction", scope: "repo", repo, bytes: 100, ...options };
}
function map(items, options = {}) { return loadingMap({ inventory: { items, coverage: { partial: false } }, repo, home, ...options }); }
function files(result) { return result.groups.flatMap(group => group.files); }
function find(result, path) { return files(result).find(file => file.path === path); }

test("Codex chooses one nonempty file per level and keeps descendant loading conditional", () => {
  const globalBase = home + "/.codex/AGENTS.md", globalOverride = home + "/.codex/AGENTS.override.md";
  const projectBase = repo + "/AGENTS.md", projectOverride = repo + "/AGENTS.override.md";
  const descendantBase = repo + "/src/AGENTS.md", descendantOverride = repo + "/src/AGENTS.override.md";
  const result = map([
    asset(globalBase, { scope: "global", repo: "", bytes: 100 }), asset(globalOverride, { scope: "global", repo: "", bytes: 80 }),
    asset(projectBase), asset(projectOverride, { bytes: 40000 }), asset(descendantBase, { scope: "path" }), asset(descendantOverride, { scope: "path", bytes: 0 }),
    asset(otherRepo + "/AGENTS.md", { repo: otherRepo }), asset(repo + "/CLAUDE.md", { agent: "claude" }),
    asset(home + "/.claude/AGENTS.md", { scope: "global", repo: "" }), asset(home + "/AGENTS.md", { scope: "global", repo: "" })
  ]);
  assert.equal(result.inferred, true);
  assert.equal(find(result, globalBase).status, "shadowed");
  assert.equal(find(result, globalOverride).status, "applies");
  assert.equal(find(result, projectBase).status, "shadowed");
  assert.equal(find(result, projectOverride).status, "applies");
  assert.equal(find(result, descendantBase).status, "conditional");
  assert.equal(find(result, descendantOverride).status, "shadowed");
  assert.equal(find(result, home + "/AGENTS.md").status, "unknown");
  assert.equal(find(result, otherRepo + "/AGENTS.md"), undefined);
  assert.equal(find(result, repo + "/CLAUDE.md"), undefined);
  assert.equal(find(result, home + "/.claude/AGENTS.md"), undefined);
  assert.equal(result.summary.projectInstructionBytes, 40000);
  assert.equal(result.summary.estimatedInstructionBytes, 40080);
  assert.equal(result.summary.projectDocMaxBytes, 32768);
  assert.equal(result.summary.projectBudgetStatus, "exceeds-default");
  assert.ok(result.notes.some(note => note.includes("Unrelated descendant")));
  assert.match(find(result, projectOverride).impact, /not measured context/);
});

test("an empty Codex override falls back while an override with unknown size leaves selection unknown", () => {
  const base = repo + "/AGENTS.md", override = repo + "/AGENTS.override.md";
  const empty = map([asset(base), asset(override, { bytes: 0 })]);
  assert.equal(find(empty, base).status, "applies");
  assert.equal(find(empty, override).status, "shadowed");
  assert.equal(empty.summary.projectBudgetStatus, "within-default");
  const unknown = map([asset(base), asset(override, { bytes: null })]);
  assert.equal(find(unknown, base).status, "unknown");
  assert.equal(find(unknown, override).status, "unknown");
  assert.equal(unknown.summary.projectBudgetStatus, "unknown");
  assert.equal(unknown.summary.estimatedInstructionBytes, 0);
});

test("Claude combines instruction layers and leaves AGENTS mode and eager imports unresolved", () => {
  const global = home + "/.claude/CLAUDE.md", ancestor = home + "/CLAUDE.md", primary = repo + "/CLAUDE.md", local = repo + "/CLAUDE.local.md";
  const hidden = repo + "/.claude/CLAUDE.md", descendant = repo + "/src/CLAUDE.md", agentsFile = repo + "/AGENTS.md", override = repo + "/AGENTS.override.md";
  const result = map([asset(global, { agent: "claude", scope: "global", repo: "" }), asset(ancestor, { agent: "claude", scope: "global", repo: "" }),
    asset(primary, { agent: "claude" }), asset(local, { agent: "claude" }), asset(hidden, { agent: "claude" }), asset(descendant, { agent: "claude", scope: "path" }), asset(agentsFile), asset(override)
  ], { agent: "claude", agents: [{ id: "claude", version: "fixture-version" }] });
  for (const path of [global, ancestor, primary, local, hidden]) assert.equal(find(result, path).status, "applies");
  assert.equal(find(result, descendant).status, "conditional");
  assert.equal(find(result, agentsFile).status, "unknown");
  assert.match(find(result, agentsFile).reason, /default fallback/);
  assert.equal(find(result, override).status, "shadowed");
  assert.ok(result.notes.some(note => note.includes("@imports expand eagerly")));
  assert.ok(result.notes.some(note => note.includes("active mode")));
  assert.equal(result.summary.projectDocMaxBytes, null);
  assert.equal(result.summary.projectBudgetStatus, "unknown");
});

test("settings, MCP and shared delegation stay separate from instruction context and other repositories are excluded", () => {
  const globalConfig = home + "/.codex/config.toml", projectConfig = repo + "/.codex/config.toml", mcp = repo + "/.mcp.json", delegation = home + "/.model-gateway.json";
  const result = map([asset(globalConfig, { agent: "codex", type: "config", scope: "global", repo: "" }), asset(projectConfig, { agent: "codex", type: "config" }),
    asset(mcp, { type: "mcp-server" }), asset(delegation, { agent: "model-gateway", type: "delegation", scope: "global", repo: "" }),
    asset(otherRepo + "/.mcp.json", { type: "mcp-server", repo: otherRepo }), asset(repo + "/.orca/config.json", { agent: "orca", type: "config" }),
    asset(repo + "/.codex/skills/fixture/SKILL.md", { agent: "codex", type: "skill" }),
    asset(home + "/.codex/cache/fixture/config.toml", { agent: "codex", type: "config", scope: "global", repo: "" })
  ]);
  const settings = result.groups.find(group => group.id === "settings").files;
  assert.equal(settings.length, 4);
  assert.ok(settings.every(file => file.status === "unknown"));
  assert.equal(find(result, globalConfig).role, "global settings");
  assert.equal(find(result, projectConfig).role, "repository settings");
  assert.equal(find(result, mcp).role, "MCP configuration");
  assert.equal(find(result, delegation).role, "delegation configuration");
  assert.equal(result.summary.estimatedInstructionBytes, 0);
  const globalOnly = map([asset(projectConfig, { agent: "codex", type: "config" }), asset(globalConfig, { agent: "codex", type: "config", scope: "global", repo: "" })], { repo: "" });
  assert.equal(files(globalOnly).length, 1);
  assert.equal(globalOnly.summary.projectBudgetStatus, "unknown");
});

test("unknown agent semantics never claim applicability and partial coverage is visible", () => {
  const result = map([asset(repo + "/AGENTS.md"), asset(repo + "/CUSTOM.md", { agent: "custom" })], { agent: "custom", inventory: { items: [asset(repo + "/AGENTS.md"), asset(repo + "/CUSTOM.md", { agent: "custom" })], coverage: { partial: true } } });
  assert.ok(files(result).every(file => file.status === "unknown"));
  assert.equal(result.summary.applies, 0);
  assert.ok(result.notes.some(note => note.includes("have not been verified")));
  assert.ok(result.notes.some(note => note.includes("coverage is partial")));
  const noHome = map([asset(home + "/.codex/AGENTS.md", { scope: "global", repo: "" })], { home: "" });
  assert.equal(files(noHome)[0].status, "unknown");
});

test("context observations are attributed to the exact agent and scope and never become runtime proof", () => {
  const observations = [
    { id: "other-repo", repo: otherRepo, agent: "codex", at: "2024-01-04T00:00:00Z", startupTokens: 999 },
    { id: "other-agent", repo, agent: "claude", at: "2024-01-04T00:00:00Z", startupTokens: 998 },
    { id: "older", repo, agent: "codex", at: "2024-01-01T00:00:00Z", startupTokens: 100 },
    { id: "latest", repo, agent: "codex", at: "2024-01-03T00:00:00Z", startupTokens: 200, windowTokens: 10000, loadedPaths: [repo + "/AGENTS.md"], note: "password=fixture-hidden", extra: "fixture-hidden" }
  ];
  const result = map([asset(repo + "/AGENTS.md")], { observations });
  assert.equal(result.observation.id, "latest");
  assert.equal(result.observation.startupTokens, 200);
  assert.equal(result.inferred, true);
  assert.match(result.observation.evidence, /User-supplied/);
  assert.equal(JSON.stringify(result).includes("fixture-hidden"), false);
  assert.equal("extra" in result.observation, false);
  assert.equal(map([], { observations, repo: "" }).observation, null);
});

test("the pure map excludes body fields without mutating input and handles Windows metadata", () => {
  const item = Object.freeze(asset(repo + "/AGENTS.md", { body: "private body fixture", configValues: {[ ["pass","word"].join("") ]: "fixture-hidden"} }));
  const inventory = Object.freeze({ items: Object.freeze([item]), coverage: Object.freeze({ partial: false }) });
  const result = loadingMap({ inventory, home, repo });
  assert.equal("body" in files(result)[0], false);
  assert.equal("configValues" in files(result)[0], false);
  assert.equal(item.body, "private body fixture");
  const windows = loadingMap({ home: "C:\\Fixture\\Home", repo: "C:\\Fixture\\Home\\Repo", agent: "codex", inventory: { items: [
    asset("C:\\Fixture\\Home\\.codex\\AGENTS.md", { repo: "", scope: "global" }),
    asset("C:\\Fixture\\Home\\Repo\\AGENTS.md", { repo: "c:\\fixture\\home\\repo" }),
    asset("C:\\Fixture\\Home\\Other\\AGENTS.md", { repo: "C:\\Fixture\\Home\\Other" })
  ] } });
  assert.equal(files(windows).length, 2);
  assert.ok(files(windows).every(file => file.status === "applies"));
});

test("nested global Codex instructions are unknown and metadata cannot prove whitespace-only content", () => {
  const nested = home + "/.codex/plugins/fixture/AGENTS.md", nestedOverride = home + "/.codex/plugins/fixture/AGENTS.override.md";
  const root = repo + "/AGENTS.override.md";
  const result = map([asset(nested, { scope: "path", repo: "" }), asset(nestedOverride, { scope: "path", repo: "" }), asset(root, { bytes: 3 })]);
  assert.equal(find(result, nested).status, "unknown");
  assert.equal(find(result, nestedOverride).status, "unknown");
  assert.match(find(result, nested).reason, /outside the selected repository launch chain/);
  assert.match(find(result, nested).reason, /Manual imports/);
  assert.ok(result.groups.find(group=>group.id==="conditional").files.some(file=>file.path===nested));
  assert.equal(result.summary.estimatedInstructionBytes, 3);
  assert.match(find(result, root).reason, /byte-nonempty/);
  assert.ok(result.notes.some(note=>note.includes("whitespace-only")));
  assert.ok(result.notes.some(note=>note.includes("bodies remain excluded")));
  assert.ok(result.notes.some(note=>note.includes("may be stale")));
});

test("the beginner settings map excludes skill references, runtime state and cached configuration", () => {
  const globalConfig = (relative, options = {}) => asset(home + "/" + relative, { agent: "codex", type: "config", scope: "global", repo: "", ...options });
  const expected = [
    home + "/.codex/config.toml", repo + "/.codex/config.toml", repo + "/.mcp.json",
    home + "/.config/model-gateway/routes.json", home + "/.config/model-gateway/policy.toml", home + "/.model-gateway.json"
  ];
  const excluded = [
    globalConfig(".codex/skills/fixture/references/environment.json"),
    globalConfig(".agents/skills/fixture/agents/openai.yaml", { agent: "shared" }),
    globalConfig(".codex/package.json"), globalConfig(".codex/package-lock.json"),
    globalConfig(".codex/global-state.json"), globalConfig(".codex/.global-state.json"), globalConfig(".codex/version.json"),
    globalConfig(".codex/schemas/settings.schema.json"), globalConfig(".codex/runtime/config.toml"), globalConfig(".codex/cache/config.toml"),
    globalConfig(".codex/plugins/fixture/config.toml"), globalConfig(".codex/skills/fixture/.mcp.json", { type: "mcp-server" }),
    asset(repo + "/.codex/skills/fixture/references/config.json", { agent: "codex", type: "config" }),
    asset(repo + "/.mcp.schema.json", { type: "mcp-server" }),
    globalConfig(".config/model-gateway/versions.json", { agent: "model-gateway" })
  ];
  const nestedInstruction = globalConfig(".codex/plugins/fixture/AGENTS.md", { type: "instruction", scope: "path" });
  const inventoryItems = [
    globalConfig(".codex/config.toml"), asset(repo + "/.codex/config.toml", { agent: "codex", type: "config" }),
    asset(repo + "/.mcp.json", { type: "mcp-server" }),
    globalConfig(".config/model-gateway/routes.json", { agent: "model-gateway" }),
    globalConfig(".config/model-gateway/policy.toml", { agent: "model-gateway" }),
    globalConfig(".model-gateway.json", { agent: "model-gateway", type: "delegation" }),
    nestedInstruction, ...excluded
  ];
  const result = map(inventoryItems);
  const settings = result.groups.find(group => group.id === "settings").files;
  assert.deepEqual(settings.map(file => file.path).sort(), expected.sort());
  assert.ok(settings.every(file => file.status === "unknown"));
  for (const item of excluded) assert.equal(find(result, item.path), undefined, item.path);
  for (const path of expected.filter(path => path.includes("model-gateway"))) assert.equal(find(result, path).role, "delegation configuration");
  const conditional = result.groups.find(group => group.id === "conditional").files;
  assert.equal(conditional.length, 1);
  assert.equal(conditional[0].path, nestedInstruction.path);
  assert.equal(conditional[0].status, "unknown");
  assert.match(conditional[0].reason, /outside the selected repository launch chain/);
  assert.doesNotMatch(conditional[0].impact, /settings|preference/i);
  assert.equal(result.summary.estimatedInstructionBytes, 0);
  assert.equal(inventoryItems.length, expected.length + excluded.length + 1);
  assert.ok(inventoryItems.includes(excluded[0]));

  const claudeSettings = [
    globalConfig(".claude/settings.json", { agent: "claude" }),
    asset(repo + "/.claude/settings.local.json", { agent: "claude", type: "config" }),
    globalConfig(".claude/hooks.json", { agent: "claude" })
  ];
  const claudeResult = map([...claudeSettings,
    globalConfig(".claude/cache/settings.json", { agent: "claude" }),
    globalConfig(".claude.json", { agent: "claude" }),
    globalConfig(".claude/skills/fixture/package.json", { agent: "claude" })
  ], { agent: "claude" });
  assert.deepEqual(files(claudeResult).map(file => file.path).sort(), claudeSettings.map(item => item.path).sort());
  assert.equal(find(claudeResult, repo + "/.claude/settings.local.json").role, "project-local settings");
});

test("direct rules and subagents appear as unknown metadata without increasing startup estimates", () => {
  const component = (path, type, options = {}) => asset(path, { agent: "claude", type, bytes: 8000, body: "component body fixture", ...options });
  const rule = component(repo + "/.claude/rules/source.md", "rule");
  const subagent = component(repo + "/.claude/agents/reviewer.md", "subagent");
  const globalRule = component(home + "/.claude/rules/global.md", "rule", { repo: "", scope: "global" });
  const globalAgent = component(home + "/.claude/agents/global.md", "subagent", { repo: "", scope: "global" });
  const sharedRule = component(repo + "/.agents/rules/shared.md", "rule", { agent: "shared" });
  const sharedAgent = component(home + "/.agents/agents/shared.md", "subagent", { agent: "shared", repo: "", scope: "global" });
  const excluded = [
    component(repo + "/.claude/cache/rules/source.md", "rule"),
    component(home + "/.claude/plugins/fixture/agents/reviewer.md", "subagent", { repo: "", scope: "global" }),
    component(repo + "/.claude/rules/generated/source.md", "rule"),
    component(repo + "/.agents/skills/fixture/agents/reviewer.md", "subagent", { agent: "shared" }),
    component(otherRepo + "/.claude/rules/source.md", "rule", { repo: otherRepo }),
    component(repo + "/.codex/agents/reviewer.md", "subagent", { agent: "codex" }),
    component(repo + "/.codex/rules/source.md", "rule", { agent: "shared" }),
    component(repo + "/.claude/agents/wrong-type.md", "rule")
  ];
  const result = map([asset(repo + "/CLAUDE.md", { agent: "claude" }), rule, subagent, globalRule, globalAgent, sharedRule, sharedAgent, ...excluded], { agent: "claude" });
  assert.deepEqual(result.groups.find(group => group.id === "conditional").files.map(file => file.path).sort(), [rule.path, globalRule.path, sharedRule.path].sort());
  assert.deepEqual(result.groups.find(group => group.id === "settings").files.map(file => file.path).sort(), [subagent.path, globalAgent.path, sharedAgent.path].sort());
  for (const item of [rule, subagent, globalRule, globalAgent, sharedRule, sharedAgent]) {
    assert.equal(find(result, item.path).status, "unknown");
    assert.equal("body" in find(result, item.path), false);
  }
  for (const item of excluded) assert.equal(find(result, item.path), undefined, item.path);
  assert.match(find(result, rule.path).reason, /frontmatter, active paths/);
  assert.match(find(result, subagent.path).reason, /registration, invocation/);
  assert.equal(result.summary.applies, 1);
  assert.equal(result.summary.estimatedInstructionBytes, 100);
  assert.equal(result.summary.projectInstructionBytes, 100);
  assert.equal(result.summary.estimatedInstructionTokens, 25);
  assert.equal(JSON.stringify(result).includes("component body fixture"), false);

  for (const [folder, agent] of [[".codex", "codex"], [".kimi", "kimi"], [".kimi-code", "kimi"], [".kiro", "kiro"], [".orca", "orca"]]) {
    const items = [component(home + "/" + folder + "/rules/source.md", "rule", { agent, repo: "", scope: "global" }), component(repo + "/" + folder + "/agents/reviewer.md", "subagent", { agent })];
    const result = map(items, { agent });
    assert.equal(files(result).length, 2, folder);
    assert.ok(files(result).every(file => file.status === "unknown"), folder);
    assert.equal(result.summary.estimatedInstructionBytes, 0, folder);
  }
});

test("nested Codex launches combine the instruction chain and keep siblings and descendants conditional", () => {
  const root = repo + "/AGENTS.md", ancestor = repo + "/src/AGENTS.md", launch = repo + "/src/app/AGENTS.md";
  const override = repo + "/src/app/AGENTS.override.md", sibling = repo + "/src/other/AGENTS.md", descendant = repo + "/src/app/deep/AGENTS.md";
  const global = home + "/.codex/AGENTS.md", settings = repo + "/.codex/config.toml";
  const items = [asset(root, { bytes: 40 }), asset(ancestor, { scope: "path", bytes: 80 }), asset(launch, { scope: "path", bytes: 120 }),
    asset(override, { scope: "path", bytes: 160 }), asset(sibling, { scope: "path", bytes: 800 }), asset(descendant, { scope: "path", bytes: 1600 }),
    asset(global, { scope: "global", repo: "", bytes: 20 }), asset(settings, { agent: "codex", type: "config", bytes: 4000 })];
  const result = map(items, { launchDirectory: repo + "/src/app/" });
  assert.equal(result.launchDirectory, repo + "/src/app");
  assert.deepEqual(result.directories, [repo, repo + "/src", repo + "/src/app", repo + "/src/app/deep", repo + "/src/other"]);
  assert.equal(find(result, root).role, "repository instruction");
  assert.equal(find(result, ancestor).role, "ancestor directory instruction");
  assert.equal(find(result, override).role, "launch directory instruction");
  for (const path of [root, ancestor, override, global]) assert.equal(find(result, path).status, "applies", path);
  assert.equal(find(result, launch).status, "shadowed");
  for (const path of [sibling, descendant]) assert.equal(find(result, path).status, "conditional", path);
  assert.deepEqual(result.groups.find(group => group.id === "repo").files.map(file => file.path), [root, ancestor, launch, override].sort((a, b) => a.localeCompare(b)));
  assert.equal(result.summary.projectInstructionBytes, 280);
  assert.equal(result.summary.estimatedInstructionBytes, 300);
  assert.equal(result.summary.estimatedInstructionTokens, 75);
  assert.equal(find(result, settings).role, "repository settings");
  assert.equal(find(result, settings).status, "unknown");
});

test("Codex override selection is independent at every directory in the chosen chain", () => {
  const root = repo + "/AGENTS.md", rootOverride = repo + "/AGENTS.override.md", nested = repo + "/src/AGENTS.md", nestedOverride = repo + "/src/AGENTS.override.md";
  const items = [asset(root), asset(rootOverride, { bytes: 0 }), asset(nested, { bytes: 80 }), asset(nestedOverride, { bytes: null })];
  const result = map(items, { launchDirectory: repo + "/src" });
  assert.equal(find(result, root).status, "applies");
  assert.equal(find(result, rootOverride).status, "shadowed");
  assert.equal(find(result, nested).status, "unknown");
  assert.equal(find(result, nestedOverride).status, "unknown");
  assert.equal(result.summary.projectInstructionBytes, 100);
  assert.equal(result.summary.projectBudgetStatus, "unknown");
});

test("Claude hidden instruction conventions use their containing project directory", () => {
  const root = repo + "/.claude/CLAUDE.md", ancestor = repo + "/src/.claude/CLAUDE.md", ancestorLocal = repo + "/src/CLAUDE.local.md";
  const launch = repo + "/src/app/CLAUDE.md", local = repo + "/src/app/CLAUDE.local.md", agentsFile = repo + "/src/app/AGENTS.md";
  const sibling = repo + "/src/other/.claude/CLAUDE.md", descendant = repo + "/src/app/deep/CLAUDE.local.md";
  const items = [root, ancestor, ancestorLocal, launch, local, sibling, descendant].map(path => asset(path, { agent: "claude", scope: "path", bytes: 20 }));
  items.push(asset(agentsFile));
  const result = map(items, { agent: "claude", launchDirectory: repo + "/src/app" });
  assert.deepEqual(result.directories, [repo, repo + "/src", repo + "/src/app", repo + "/src/app/deep", repo + "/src/other"]);
  for (const path of [root, ancestor, ancestorLocal, launch, local]) assert.equal(find(result, path).status, "applies", path);
  assert.equal(find(result, root).role, "repository instruction");
  assert.equal(find(result, ancestorLocal).role, "ancestor directory instruction");
  assert.equal(find(result, local).role, "launch directory instruction");
  assert.equal(find(result, agentsFile).status, "unknown");
  assert.match(find(result, agentsFile).reason, /mode and version/);
  for (const path of [sibling, descendant]) assert.equal(find(result, path).status, "conditional", path);
  assert.equal(result.summary.projectInstructionBytes, 100);
  assert.throws(() => map(items, { agent: "claude", launchDirectory: repo + "/src/.claude" }), /Launch directory/);
  assert.ok(result.notes.some(note => note.includes("@imports")));
});

test("undocumented hidden local Claude files are visible but do not enter the startup estimate or folder choices", () => {
  const items = [asset(repo + "/CLAUDE.md", {agent:"claude",bytes:40}),
    asset(repo + "/src/.claude/CLAUDE.local.md", {agent:"claude",bytes:400}),
    asset(home + "/.claude/CLAUDE.local.md", {agent:"claude",repo:"",scope:"global",bytes:800})];
  const result = map(items, {agent:"claude"});
  assert.deepEqual(result.directories,[repo]);
  for (const item of items.slice(1)) {
    assert.equal(find(result,item.path).status,"unknown");
    assert.match(find(result,item.path).reason,/not a documented default/);
  }
  assert.equal(result.summary.estimatedInstructionBytes,40);
});

test("undocumented hidden local Claude files cannot establish a documented AGENTS fallback suppression", () => {
  const instructions = repo + "/AGENTS.md", hiddenLocal = repo + "/.claude/CLAUDE.local.md";
  const result = map([asset(instructions),asset(hiddenLocal,{agent:"claude"})],{agent:"claude"});
  assert.equal(find(result,instructions).status,"unknown");
  assert.doesNotMatch(find(result,instructions).reason,/suppress AGENTS/);
  assert.match(find(result,instructions).reason,/active mode/);
});

test("launch choices exclude other agents, settings, skill bodies, global folders and unseen or traversing paths", () => {
  const items = [asset(repo + "/src/AGENTS.md"), asset(repo + "/src/AGENTS.override.md"),
    asset(repo + "/claude/CLAUDE.md", { agent: "claude" }), asset(repo + "/.claude/wrong/AGENTS.md"),
    asset(otherRepo + "/other/AGENTS.md", { repo: otherRepo }), asset(repo + "/.codex/config.toml", { type: "config", agent: "codex" }),
    asset(repo + "/skills/fixture/SKILL.md", { type: "skill" }), asset(home + "/.codex/plugins/fixture/AGENTS.md", { repo: "", scope: "path" }),
    asset(repo + "/src/../escape/AGENTS.md"), asset(otherRepo + "/outside/AGENTS.md")];
  assert.deepEqual(loadingDirectories({ inventory: { items }, repo, home, agent: "codex" }), [repo, repo + "/src"]);
  for (const launchDirectory of [repo + "/claude", repo + "/.claude/wrong", repo + "/.codex", repo + "/skills/fixture", repo + "/unseen",
    otherRepo + "/other", home + "/.codex/plugins/fixture", repo + "/src/../src", repo + "/./src", repo + "\\src\\..\\src", null]) {
    assert.throws(() => map(items, { launchDirectory }), /Launch directory/, String(launchDirectory));
  }
  assert.deepEqual(loadingDirectories({ inventory: { items }, repo: "", home }), []);
  assert.equal(map(items, { repo: "" }).launchDirectory, "");
  assert.throws(() => map(items, { repo: "", launchDirectory: repo + "/src" }), /Launch directory/);
});

test("root defaults preserve observations while nested launches expose only repository evidence", () => {
  const items = Object.freeze([Object.freeze(asset(repo + "/AGENTS.md")), Object.freeze(asset(repo + "/src/AGENTS.md"))]);
  const observation = Object.freeze({ id: "root-reading", repo, agent: "codex", at: "2024-01-01T00:00:00Z", startupTokens: 80, loadedPaths: Object.freeze([repo + "/AGENTS.md"]) });
  const observations = Object.freeze([observation]);
  const options = Object.freeze({ inventory: Object.freeze({ items }), repo, home, observations });
  const root = loadingMap(options), explicit = loadingMap({ ...options, launchDirectory: repo });
  assert.deepEqual(root, explicit);
  assert.equal(root.launchDirectory, repo);
  assert.equal(root.observation.id, "root-reading");
  assert.equal(root.repositoryObservation, null);
  const nested = loadingMap({ ...options, launchDirectory: repo + "/src" });
  assert.equal(nested.observation, null);
  assert.deepEqual(nested.repositoryObservation, root.observation);
  assert.ok(nested.notes.some(note => note.includes("repository-scoped")));
  assert.deepEqual(observation.loadedPaths, [repo + "/AGENTS.md"]);
  assert.equal(loadingMap(options).summary.projectInstructionBytes, 100);
  const global = loadingMap({ inventory: { items: [] }, observations: [{ ...observation, repo: "" }], home });
  assert.equal(global.observation.id, "root-reading");
  assert.equal(global.repositoryObservation, null);
});

test("Windows launch paths normalize case and separators to the returned folder", () => {
  const windowsRepo = "C:\\Fixture\\Residence\\Repo", windowsHome = "C:\\Fixture\\Residence";
  const items = [asset(windowsRepo + "\\AGENTS.md", { repo: windowsRepo }),
    asset(windowsRepo + "\\Src\\AGENTS.md", { repo: "c:/fixture/residence/repo" }),
    asset(windowsRepo + "\\Src\\App\\AGENTS.md", { repo: windowsRepo }),
    asset(windowsRepo + "\\Sibling\\AGENTS.md", { repo: windowsRepo })];
  const result = loadingMap({ inventory: { items }, repo: windowsRepo, home: windowsHome, launchDirectory: "C:/FIXTURE/Residence/Repo/SRC/App/" });
  assert.equal(result.launchDirectory, "c:/fixture/residence/repo/src/app");
  assert.deepEqual(result.directories, ["c:/fixture/residence/repo", "c:/fixture/residence/repo/sibling", "c:/fixture/residence/repo/src", "c:/fixture/residence/repo/src/app"]);
  assert.equal(result.summary.projectInstructionBytes, 300);
  assert.equal(find(result, windowsRepo + "\\Src\\AGENTS.md").role, "ancestor directory instruction");
  assert.equal(find(result, windowsRepo + "\\Sibling\\AGENTS.md").status, "conditional");
});
