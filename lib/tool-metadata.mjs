import { redact } from "./analysis.mjs";

const MAX_BYTES = 256 * 1024, MAX_SERVERS = 200, MAX_NAME = 160;
const own = (object, key) => Object.hasOwn(object, key);
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const transports = new Map([["stdio", "stdio"], ["http", "http"], ["streamable-http", "http"], ["sse", "sse"], ["ws", "ws"]]);

export function supportedToolConfig(item) {
  if (!item || typeof item.path !== "string" || !["config", "mcp-server"].includes(item.type)) return null;
  const file = item.path.replace(/\\/g, "/");
  const name = file.split("/").at(-1), parent = file.slice(0, -(name.length + 1));
  const repo = typeof item.repo === "string" ? item.repo.replace(/\\/g, "/").replace(/\/+$/, "") : "";
  const harness = /\/\.(?:codex|claude|kimi|kimi-code|kiro|orca|agents)\//.exec(file);
  const relative = repo && file.startsWith(repo + "/") ? file.slice(repo.length + 1) : harness ? file.slice(harness.index + 1) : name;
  if (relative.split("/").some(part => /^(?:plugins?|cache|runtime|skills|logs|sessions|node_modules)$/i.test(part))) return null;
  const direct = repo ? parent === repo : relative === name;
  if (name === "config.toml" && parent.endsWith("/.codex") && (repo ? parent === repo + "/.codex" : relative === ".codex/config.toml") && item.agent === "codex") return { format: "toml", agent: item.agent };
  if ([".mcp.json", "mcp.json", ".claude.json"].includes(name) && direct) return { format: "json", agent: item.agent };
  const component = /\/\.(claude|kimi|kimi-code|kiro|orca|agents)$/.exec(parent);
  if (!component || (repo ? parent !== repo + "/." + component[1] : relative.split("/").length !== 2)) return null;
  if (["mcp.json", ".mcp.json", "settings.json", "settings.local.json"].includes(name)) return { format: "json", agent: item.agent };
  return null;
}

export function pluginToolConfig(item) {
  const file = item?.path?.replace(/\\/g, "/") || "";
  if (!["mcp-server", "config"].includes(item?.type) || !/\/(?:plugins?|cache)\//.test(file) || !/\/(?:\.mcp|mcp)\.json$/.test(file)) return null;
  return {format:"json",agent:item.agent};
}

export function inspectToolMetadata(text, { format, agent, repo = "", detailed = false } = {}) {
  const result = { servers: [], coverage: { partial: false, issues: [] }, source: "configuration metadata; runtime unverified" };
  function issue(message) {
    result.coverage.partial = true;
    if (!result.coverage.issues.includes(message)) result.coverage.issues.push(message);
  }
  function add(name, entry, localScope = false, codexToml = false) {
    if (result.servers.length >= MAX_SERVERS) { issue("Server count limit reached."); return; }
    if (!object(entry)) { issue("Some server entries have an unsupported shape."); if(!detailed)return;entry={}; }
    let safeName = redact(name).replace(/(?:https?|wss?):\/\/\S+/gi, "[REDACTED]");
    if (/[/\\]/.test(safeName)) safeName = "[REDACTED]";
    safeName = safeName.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, MAX_NAME);
    if (safeName !== name) issue("Some server names were redacted or truncated.");
    if (!safeName.trim()) { issue("Some server names are invalid."); return; }
    let configurationStatus = "valid";
    let transport = "unknown";
    if (own(entry, "type")) {
      transport = transports.get(entry.type) || "unknown";
      if (transport === "unknown") issue("Some transport types are unsupported.");
      else if (transport === "stdio" ? typeof entry.command !== "string" || !entry.command.trim() : typeof entry.url !== "string" || !entry.url.trim()) issue("Some declared transports lack a valid required field.");
    } else if (typeof entry.command === "string" && entry.command.trim()) transport = "stdio";
    else if (typeof entry.url === "string" && entry.url.trim() && codexToml) transport = "http";
    else if (typeof entry.url === "string") issue("URL-only entries do not establish a transport type.");
    else issue("Some server entries do not establish a transport type.");
    let configuredEnabled = null;
    const enabled = own(entry, "enabled"), disabled = own(entry, "disabled");
    if ((enabled && typeof entry.enabled !== "boolean") || (disabled && typeof entry.disabled !== "boolean")) issue("Some enablement flags are not booleans.");
    else if (enabled && disabled && entry.enabled === entry.disabled) issue("Some enablement flags conflict.");
    else if (enabled) configuredEnabled = entry.enabled;
    else if (disabled) configuredEnabled = !entry.disabled;
    if (transport === "unknown" || safeName !== name) configurationStatus = "unsupported";
    else if ((transport === "stdio" ? typeof entry.command !== "string" || !entry.command.trim() : typeof entry.url !== "string" || !entry.url.trim()) || (enabled && typeof entry.enabled !== "boolean") || (disabled && typeof entry.disabled !== "boolean") || (enabled && disabled && entry.enabled === entry.disabled)) configurationStatus = "incomplete";
    if(detailed&&transport!=="stdio"&&transport!=="unknown"&&typeof entry.url==='string')try{const url=new URL(entry.url);if(!(transport==='ws'?['ws:','wss:']:['http:','https:']).includes(url.protocol))configurationStatus='incomplete';}catch{configurationStatus='incomplete';}
    if(detailed){
      const supportedFlag=agent==='codex'&&codexToml?'enabled':agent==='kiro'&&!codexToml?'disabled':null;
      if((enabled&&supportedFlag!=='enabled')||(disabled&&supportedFlag!=='disabled')){configuredEnabled=null;configurationStatus='unsupported';issue('Enablement flags in some entries are unsupported for this harness and format.');}
    }
    result.servers.push({ name: safeName, transport, configuredEnabled, ...(localScope ? { localScope: true } : {}), ...(detailed ? {configurationStatus,authentication:"unknown",runtime:"unknown"} : {}) });
  }
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_BYTES) { issue("Configuration input is invalid or exceeds the read limit."); return result; }
  if (format === "json") {
    let document;
    try { document = JSON.parse(text.replace(/^\uFEFF/, "")); } catch { issue("Configuration JSON could not be parsed."); return result; }
    if (!object(document) || own(document, "sops")) { issue("Configuration document has an unsupported shape."); return result; }
    function servers(value, local = false) {
      if (!object(value)) { issue("Server configuration has an unsupported shape."); return; }
      for (const [name, entry] of Object.entries(value)) add(name, entry, local);
    }
    if (own(document, "mcpServers")) servers(document.mcpServers);
    if (own(document, "projects") && agent === "claude" && repo) {
      if (!object(document.projects)) issue("Project configuration has an unsupported shape.");
      else if (own(document.projects, repo)) {
        const local = document.projects[repo];
        if (!object(local)) issue("Project configuration has an unsupported shape.");
        else if (own(local, "mcpServers")) servers(local.mcpServers, true);
      }
    }
    // Other project entries are deliberately never traversed.
    const pending = Object.entries(document).filter(([key]) => !["mcpServers", "projects"].includes(key));
    let visited = 0;
    while (pending.length) {
      if (++visited > 10000) { issue("Configuration structure limit reached."); break; }
      const [key, value] = pending.pop();
      if (["mcpServers", "mcp_servers"].includes(key)) { issue("Nested or alternate server configuration is unsupported."); continue; }
      if (object(value)) pending.push(...Object.entries(value));
      else if (Array.isArray(value)) for (const entry of value) if (object(entry)) pending.push(...Object.entries(entry));
    }
    return result;
  }
  if (format !== "toml" || agent !== "codex") { issue("Configuration format is unsupported."); return result; }

  const tables = new Map();
  let current = null;
  // shortcut: single-line TOML statements only; use a vetted TOML parser if broader syntax is needed.
  for (const raw of text.split(/\r?\n/)) {
    const line = tomlLine(raw);
    if (line === null) { issue("Unsupported or malformed TOML syntax."); result.servers = []; return result; }
    if (!line.trim()) continue;
    if (line.trim().startsWith("[")) {
      const trimmed = line.trim();
      const parts = trimmed.startsWith("[[") || !trimmed.endsWith("]") ? null : tomlKeys(trimmed.slice(1, -1));
      if (!parts) { issue("Unsupported or malformed TOML table syntax."); return result; }
      if (parts[0] === "sops") { issue("Configuration document has an unsupported shape."); return result; }
      current = null;
      if (parts[0] === "mcp_servers" && parts.length === 2) {
        const name = parts[1];
        if (tables.has(name)) { tables.get(name).invalid = true; issue("Duplicate server tables are unsupported."); }
        else if (tables.size >= MAX_SERVERS) issue("Server count limit reached.");
        else { const table = { entry: {}, fields: new Set(), invalid: false }; tables.set(name, table); current = table; }
      } else if (parts.includes("mcp_servers") && !(parts[0] === "mcp_servers" && parts.length === 3 && parts[2] === "env")) issue("Nested or alternate server configuration is unsupported.");
      continue;
    }
    const match = /^\s*((?:[A-Za-z0-9_-]+)|(?:"(?:[^"\\]|\\.)*")|(?:'[^']*'))\s*=\s*(.+?)\s*$/.exec(line);
    if (!match) { issue("Unsupported or malformed TOML syntax."); return result; }
    const key = tomlKeys(match[1])?.[0];
    if (!key) { issue("Unsupported or malformed TOML syntax."); return result; }
    if (key === "sops" && !current) { issue("Configuration document has an unsupported shape."); return result; }
    if (key === "mcp_servers" && !current) issue("Inline server configuration is unsupported.");
    if (!current) continue;
    if (current.fields.has(key)) { current.invalid = true; issue("Duplicate server fields are unsupported."); }
    current.fields.add(key);
    if (!["command", "url", "enabled", "disabled", "type"].includes(key)) continue;
    const value = match[2];
    if (["enabled", "disabled"].includes(key)) {
      if (!["true", "false"].includes(value)) { current.invalid = true; issue("Some enablement flags are not booleans."); }
      else current.entry[key] = value === "true";
    } else {
      const string = tomlString(value);
      if (string === null) { current.invalid = true; issue("Some server fields have an unsupported shape."); }
      else current.entry[key] = string;
    }
  }
  for (const [name, table] of tables) if (!table.invalid) add(name, table.entry, false, true);
  return result;
}

function tomlString(value) {
  if (/^'[^']*'$/.test(value)) return value.slice(1, -1);
  if (!/^"(?:[^"\\]|\\.)*"$/.test(value)) return null;
  try { return JSON.parse(value); } catch { return null; }
}
export function tomlKeys(value) {
  const parts = [];
  let remaining = value.trim();
  while (remaining) {
    const match = /^(?:[A-Za-z0-9_-]+|"(?:[^"\\]|\\.)*"|'[^']*')/.exec(remaining);
    if (!match) return null;
    const token = match[0], name = /^["']/.test(token) ? tomlString(token) : token;
    if (name === null || !name) return null;
    parts.push(name); remaining = remaining.slice(token.length).trim();
    if (!remaining) return parts;
    if (!remaining.startsWith(".")) return null;
    remaining = remaining.slice(1).trim();
    if (!remaining) return null;
  }
  return null;
}
export function tomlLine(raw) {
  let quote = "", escaped = false, brackets = [];
  for (let index = 0; index < raw.length; index++) {
    const character = raw[index];
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (quote === '"' && character === "\\") { escaped = true; continue; }
      if (character === quote) quote = "";
      continue;
    }
    if (character === "#") return brackets.length ? null : raw.slice(0, index);
    if (["'", '"'].includes(character)) {
      if (raw.slice(index, index + 3) === character.repeat(3)) return null;
      quote = character;
    } else if (character === "[" || character === "{") brackets.push(character);
    else if (character === "]" || character === "}") {
      if (brackets.pop() !== (character === "]" ? "[" : "{")) return null;
    }
  }
  return quote || brackets.length ? null : raw;
}
