import test from "node:test";
import assert from "node:assert/strict";
import { inspectToolMetadata, supportedToolConfig } from "../lib/tool-metadata.mjs";

const repo = "/fixture/project-one", otherRepo = "/fixture/project-two";
const json = (value, options = {}) => inspectToolMetadata(JSON.stringify(value), { format: "json", agent: "claude", repo, ...options });
const toml = value => inspectToolMetadata(value, { format: "toml", agent: "codex" });
const server = (name, transport, configuredEnabled = null, localScope = false) => ({ name, transport, configuredEnabled, ...(localScope ? { localScope: true } : {}) });
function noValues(result) {
  const output = JSON.stringify(result);
  for (const value of ["hidden", "fixture.invalid", otherRepo, "unrecognized-value"]) assert.equal(output.includes(value), false);
  assert.equal(result.source, "configuration metadata; runtime unverified");
  assert.ok(result.servers.every(entry => Object.keys(entry).every(key => ["name", "transport", "configuredEnabled", "localScope"].includes(key))));
}

test("JSON retains server names, explicit transport and boolean flags only", () => {
  const result = json({ mcpServers: {
    local: { command: "hidden", args: ["hidden"], env: { ["api" + "Key"]: "hidden" }, enabled: false },
    web: { type: "streamable-http", url: "https://fixture.invalid/hidden", headers: { Authorization: "hidden" }, disabled: false },
    events: { type: "sse", enabled: true }, socket: { type: "ws" }, process: { type: "stdio" },
    remote: { url: "https://fixture.invalid/hidden" }, other: { type: "unrecognized-value" }
  }, unknown: "unrecognized-value" });
  assert.deepEqual(result.servers, [server("local", "stdio", false), server("web", "http", true), server("events", "sse", true), server("socket", "ws"), server("process", "stdio"), server("remote", "unknown"), server("other", "unknown")]);
  assert.equal(result.coverage.partial, true);
  noValues(result);
});

test("Claude project metadata selects exactly the requested repository and preserves distinct scopes", () => {
  const result = json({ mcpServers: { shared: { type: "http", url: "https://fixture.invalid/hidden" } }, projects: {
    [repo]: { mcpServers: { shared: { command: "hidden" } } },
    [otherRepo]: { mcpServers: { hidden: { type: "sse" } }, sops: "hidden" }
  } });
  assert.deepEqual(result.servers, [server("shared", "http"), server("shared", "stdio", null, true)]);
  assert.equal(result.coverage.partial, false);
  assert.deepEqual(json({ projects: { [repo]: { mcpServers: { local: { command: "hidden" } } } } }, { agent: "codex" }).servers, []);
  noValues(result);
});

test("malformed JSON, SOPS envelopes and unsupported roots never return configuration content", () => {
  for (const input of ["{hidden", "null", "[]", "123", JSON.stringify({ sops: {}, mcpServers: { hidden: { command: "hidden" } } })]) {
    const result = inspectToolMetadata(input, { format: "json", agent: "claude" });
    assert.deepEqual(result.servers, []);
    assert.equal(result.coverage.partial, true);
    noValues(result);
  }
});

test("malformed entries and alternate nesting remain partial without treating unknown values as names", () => {
  const result = json({ mcpServers: { malformed: [], nil: null, empty: {}, valid: { command: "hidden" } }, settings: { mcpServers: { hidden: { command: "hidden" } } } });
  assert.deepEqual(result.servers, [server("empty", "unknown"), server("valid", "stdio")]);
  assert.equal(result.coverage.partial, true);
  assert.equal(json({ mcp_servers: { hidden: {} } }).coverage.partial, true);
  assert.equal(json({ mcpServers: [] }).coverage.partial, true);
  assert.equal(json({ projects: { [repo]: null } }).coverage.partial, true);
  noValues(result);
});

test("enablement never defaults to true and rejects nonboolean or conflicting flags", () => {
  const result = json({ mcpServers: {
    default: { command: "hidden" }, conflict: { type: "http", enabled: true, disabled: true },
    string: { type: "http", enabled: "hidden" }, coherent: { type: "http", enabled: false, disabled: true }
  } });
  assert.deepEqual(result.servers, [server("default", "stdio"), server("conflict", "http"), server("string", "http"), server("coherent", "http", false)]);
  noValues(result);
});

test("explicit transports retain declared metadata while malformed required fields are partial", () => {
  for (const entry of [{ type: "stdio" }, { type: "stdio", command: 1 }, { type: "http" }, { type: "sse", url: false }, { type: "ws", url: "" }]) {
    const result = json({ mcpServers: { declared: entry } });
    assert.deepEqual(result.servers, [server("declared", entry.type)]);
    assert.equal(result.coverage.partial, true);
    noValues(result);
  }
  const bom = inspectToolMetadata('\uFEFF' + JSON.stringify({ mcpServers: { local: { command: "hidden" } } }), { format: "json", agent: "claude" });
  assert.deepEqual(bom.servers, [server("local", "stdio")]);
  assert.equal(bom.coverage.partial, false);
});

test("server names are redacted and length, count and document input are bounded", () => {
  const credential = "sk-" + "a".repeat(30);
  const result = json({ mcpServers: { [credential]: { type: "stdio" }, ["https://fixture.invalid/hidden"]: { type: "http" }, ["a".repeat(300)]: { type: "ws" }, [otherRepo]: { type: "sse" } } });
  assert.equal(JSON.stringify(result).includes(credential), false);
  assert.ok(result.servers.every(entry => entry.name.length <= 160));
  assert.equal(result.coverage.partial, true);
  noValues(result);
  const bounded = json({ mcpServers: Object.fromEntries(Array.from({ length: 201 }, (_, index) => ["server-" + index, { type: "stdio" }])) });
  assert.equal(bounded.servers.length, 200);
  assert.equal(bounded.coverage.partial, true);
  const large = inspectToolMetadata(" ".repeat(256 * 1024 + 1), { format: "json" });
  assert.deepEqual(large.servers, []);
  assert.equal(large.coverage.partial, true);
});

test("Codex TOML handles direct bare and quoted names including dots and ignores environment values", () => {
  const result = toml(`[mcp_servers.local]\ncommand = "hidden" # ignored comment\nenabled = false\nargs = ["hidden", "[mcp_servers.fabricated]"]\n[mcp_servers.local.env]\nAPI_KEY = "hidden"\n[mcp_servers.'dot.name']\nurl = 'https://fixture.invalid/hidden'\n[mcp_servers."quoted.name"]\ncommand = "hidden # not a comment"\n`);
  assert.deepEqual(result.servers, [server("local", "stdio", false), server("dot.name", "http"), server("quoted.name", "stdio")]);
  assert.equal(result.coverage.partial, false);
  noValues(result);
});

test("TOML strings, comments and env subtables never fabricate servers", () => {
  const result = toml(`notes = "[mcp_servers.fabricated]"\n# [mcp_servers.fabricated]\n[mcp_servers.real]\ncommand = 'hidden'\n[mcp_servers.real.env]\nEXAMPLE = '[mcp_servers.fabricated]'\n`);
  assert.deepEqual(result.servers, [server("real", "stdio")]);
  assert.equal(result.coverage.partial, false);
  noValues(result);
});

test("unsupported multiline TOML strings and arrays fail conservatively", () => {
  for (const quote of ['"""', "'''"]) {
    const result = toml(`[mcp_servers.real]\ncommand = "hidden"\nnotes = ${quote}\n[mcp_servers.fabricated]\ncommand = "hidden"\n${quote}`);
    assert.deepEqual(result.servers, []);
    assert.equal(result.coverage.partial, true);
    noValues(result);
  }
  for (const input of ['args = [\n"hidden",\n]\n[mcp_servers.fabricated]\ncommand="hidden"', '[mcp_servers.real]\ncommand = "hidden', '[[mcp_servers.fabricated]]\ncommand="hidden"']) {
    const result = toml(input);
    assert.deepEqual(result.servers, []);
    assert.equal(result.coverage.partial, true);
    noValues(result);
  }
});

test("duplicate TOML tables and fields exclude ambiguous server entries", () => {
  for (const duplicate of ['command = "hidden"\ncommand = "hidden"', 'enabled = true\nenabled = false', 'command = "hidden"\n[mcp_servers.real]\ncommand = "hidden"']) {
    const result = toml('[mcp_servers.real]\n' + duplicate + '\n[mcp_servers.other]\ncommand = "hidden"');
    assert.deepEqual(result.servers, [server("other", "stdio")]);
    assert.equal(result.coverage.partial, true);
    noValues(result);
  }
});

test("nested TOML profiles and inline server maps are explicitly unsupported", () => {
  for (const input of ['[profiles.test.mcp_servers.hidden]\ncommand="hidden"', '[mcp_servers]\nhidden = { command = "hidden" }', 'mcp_servers = { hidden = { command = "hidden" } }']) {
    const result = toml(input);
    assert.deepEqual(result.servers, []);
    assert.equal(result.coverage.partial, true);
    noValues(result);
  }
});

test("SOPS TOML envelopes return no server metadata", () => {
  for (const input of ['[mcp_servers.real]\ncommand="hidden"\n[sops]\nvalue="hidden"', 'sops={value="hidden"}\n[mcp_servers.real]\ncommand="hidden"']) {
    const result = toml(input);
    assert.deepEqual(result.servers, []);
    assert.equal(result.coverage.partial, true);
    noValues(result);
  }
});

test("configuration eligibility accepts only recognized direct file locations", () => {
  const asset = (path, agent = "claude", options = {}) => ({ path, agent, repo, type: "config", ...options });
  for (const path of [repo + '/.mcp.json', repo + '/mcp.json', repo + '/.claude.json', repo + '/.claude/settings.json', repo + '/.claude/settings.local.json']) assert.equal(supportedToolConfig(asset(path))?.format, "json");
  assert.deepEqual(supportedToolConfig(asset(repo + '/.codex/config.toml', "codex")), { format: "toml", agent: "codex" });
  assert.equal(supportedToolConfig(asset('/fixture/user-root/.codex/config.toml', "codex", { repo: "" }))?.format, "toml");
  assert.equal(supportedToolConfig(asset('/fixture/user-root/projects/one/.mcp.json', "shared", { repo: '/fixture/user-root/projects/one', type: "mcp-server" }))?.format, "json");
  assert.equal(supportedToolConfig(asset('/fixture/cache/sample/.mcp.json', "shared", { repo: '/fixture/cache/sample', type: "mcp-server" }))?.format, "json");
  for(const file of ['/fixture/user-root/.claude/reference/.mcp.json','/fixture/user-root/.codex/reference/.codex/config.toml'])assert.equal(supportedToolConfig(asset(file,'codex',{repo:'',type:'mcp-server'})),null);
  for (const path of [repo + '/settings.json', repo + '/src/.mcp.json', repo + '/.codex/cache/config.toml', repo + '/.claude/plugins/one/settings.json', repo + '/.codex/runtime/config.toml', repo + '/.claude/auth.json']) assert.equal(supportedToolConfig(asset(path, "codex")), null);
  assert.equal(supportedToolConfig(asset(repo + '/.mcp.json', "shared", { type: "instruction" })), null);
});
