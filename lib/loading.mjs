import { redact } from "./analysis.mjs";

const TYPES = new Set(["instruction", "config", "delegation", "mcp-server", "rule", "subagent"]);
const OWNERS = new Map([[".codex", "codex"], [".claude", "claude"], [".kimi", "kimi"], [".kimi-code", "kimi"], [".kiro", "kiro"], [".orca", "orca"], [".opencode", "opencode"], [".omp", "omp"], [".pi", "pi"]]);
const text = value => redact(typeof value === "string" ? value : "");
function normalized(value) {
  const portable = String(value || "").replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-z]:\//i.test(portable) ? portable.toLowerCase() : portable;
}
function directory(value) { const path = normalized(value); return path.slice(0, path.lastIndexOf("/")) || "/"; }
function basename(value) { return normalized(value).split("/").at(-1).toLowerCase(); }
function inside(value, root) { return !!root && (normalized(value) === normalized(root) || normalized(value).startsWith(normalized(root) + "/")); }
function bytes(item) { return Number.isFinite(item.bytes) && item.bytes >= 0 ? item.bytes : null; }
function owner(item) { return normalized(item.path).split("/").map(part => OWNERS.get(part)).find(Boolean); }
function hasDotSegment(value) { return String(value).replace(/\\/g, "/").split("/").some(part => part === "." || part === ".."); }
function instructionDirectory(item, agent) {
  const parent = directory(item.path);
  return agent === "claude" && basename(parent) === ".claude" && basename(item.path) === "claude.md" ? directory(parent) : parent;
}
function metadata(item) {
  return { id: text(item.id), name: text(item.name || basename(item.path)), path: text(item.path), type: text(item.type), scope: text(item.scope), repo: text(item.repo) };
}
function recognizableConfiguration(item, home) {
  const root = normalized(item.repo || home), file = normalized(item.path);
  if (!root || !inside(file, root)) return false;
  const relative = file.slice(root.length + 1).toLowerCase();
  if (item.type === "rule" || item.type === "subagent") {
    const component = /^\.(?:codex|claude|kimi|kimi-code|kiro|orca|agents)\/(rules|agents)\/[^/]+\.md$/.exec(relative);
    return component?.[1] === (item.type === "rule" ? "rules" : "agents");
  }
  if (relative === ".mcp.json" || relative === ".model-gateway.json") return true;
  if (/^(?:(?:\.config\/opencode\/|\.opencode\/)?opencode\.jsonc?|\.(?:omp|pi)\/(?:agent\/)?(?:config|settings|models|mcp)\.(?:jsonc?|ya?ml))$/.test(relative)) return true;
  if (/^(?:\.config\/model-gateway|\.model-gateway)\/(?:routes|policy|config)\.(?:json|toml|ya?ml)$/.test(relative)) return true;
  return /^(?:\.codex\/config\.toml|\.claude\/(?:settings(?:\.local)?|hooks|\.?mcp)\.json|\.(?:kimi|kimi-code|orca)\/(?:config|settings|mcp)\.(?:json|toml|ya?ml)|\.kiro\/(?:settings\/)?(?:cli|settings|mcp|config)\.(?:json|toml|ya?ml)|\.agents\/mcp\.json)$/.test(relative);
}
function settingsRole(item) {
  if (item.type === "delegation" || item.agent === "model-gateway") return "delegation configuration";
  if (item.type === "mcp-server") return "MCP configuration";
  if (item.repo && basename(item.path) === "settings.local.json") return "project-local settings";
  return item.repo ? "repository settings" : "global settings";
}
function selectedItems(inventory, repo, agent, home) {
  return (inventory?.items || []).filter(item => {
    if (!item || !TYPES.has(item.type) || typeof item.path !== "string") return false;
    if (item.repo && normalized(item.repo) !== normalized(repo)) return false;
    if (item.type !== "instruction" && !recognizableConfiguration(item, home)) return false;
    const shared = item.agent === "shared" || (item.agent === "model-gateway" && recognizableConfiguration(item, home));
    if (item.agent !== agent && !shared) return false;
    return !owner(item) || owner(item) === agent;
  });
}
export function loadingDirectories({ inventory, repo = "", agent = "codex", home = "" } = {}) {
  const root = normalized(repo);
  if (!root || hasDotSegment(repo)) return [];
  const folders = selectedItems(inventory, repo, agent, home).filter(item => item.type === "instruction" && item.repo && !hasDotSegment(item.path))
    .filter(item => !(agent === "claude" && basename(directory(item.path)) === ".claude" && basename(item.path) === "claude.local.md"))
    .map(item => instructionDirectory(item, agent)).filter(folder => inside(folder, root));
  return [root, ...[...new Set(folders)].filter(folder => folder !== root).sort((a, b) => a.localeCompare(b))];
}
function instructionLocation(item, repo, agent, home, launchDirectory) {
  const parent = directory(item.path);
  const globalHome = home ? normalized(home) + (agent === "codex" ? "/.codex" : "/.claude") : "";
  if (item.scope === "global" && parent === globalHome && ["codex", "claude"].includes(agent)) return { group: "global", role: "global instruction", conditional: false };
  const folder = instructionDirectory(item, agent);
  if (item.repo && !hasDotSegment(item.path) && inside(folder, repo) && inside(launchDirectory, folder)) return {
    group: "repo", role: folder === normalized(repo) ? "repository instruction" : folder === launchDirectory ? "launch directory instruction" : "ancestor directory instruction", conditional: false
  };
  if (!item.repo && home && parent === normalized(home) && agent === "claude" && repo && inside(repo, home)) return { group: "global", role: "ancestor instruction", conditional: false };
  if (item.scope === "path" || item.repo || (globalHome && inside(parent, globalHome))) return { group: "conditional", role: "directory instruction", conditional: true };
  return { group: "global", role: "other discovered instruction", conditional: false };
}
function attributedObservation(observations, repo, agent) {
  const selected = observations.filter(item => item && item.agent === agent && normalized(item.repo) === normalized(repo))
    .sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0))[0];
  if (!selected) return null;
  const number = value => Number.isFinite(value) && value >= 0 ? value : null;
  return { id: text(selected.id), repo: text(selected.repo), agent: text(selected.agent), at: text(selected.at),
    startupTokens: number(selected.startupTokens), windowTokens: number(selected.windowTokens),
    loadedPaths: Array.isArray(selected.loadedPaths) ? selected.loadedPaths.filter(value => typeof value === "string").slice(0, 500).map(text) : [],
    note: text(selected.note).slice(0, 2000), evidence: "User-supplied context observation; attribution does not verify this loading prediction." };
}

export function configurationFiles({ inventory, repo = "", agent = "codex", home = "", groups = [] } = {}) {
  const predicted = new Map(groups.flatMap(group => group.files || []).map(file => [normalized(file.path), file]));
  const types = new Set(["instruction", "rule", "skill", "subagent", "config", "delegation", "mcp-server", "hook", "command", "plugin", "script"]);
  const files = new Map();
  for (const item of inventory?.items || []) {
    if (!item || !types.has(item.type) || typeof item.path !== "string" || hasDotSegment(item.path)) continue;
    if (item.repo && normalized(item.repo) !== normalized(repo)) continue;
    if (![agent, "shared", "model-gateway"].includes(item.agent)) continue;
    const root = normalized(item.repo || home), filePath = normalized(item.path);
    if (!root || !inside(filePath, root)) continue;
    const relative = filePath.slice(root.length + 1), parts = relative.split("/");
    const sourceOwner = parts.map(part => OWNERS.get(part)).find(Boolean);
    if (sourceOwner && sourceOwner !== agent) continue;
    if (parts[0] === ".claude.json" && agent !== "claude") continue;
    if (!item.repo && !predicted.has(filePath) && !OWNERS.has(parts[0]) && parts[0] !== ".agents" &&
        ![".claude.json", ".mcp.json", ".model-gateway.json"].includes(relative) && !relative.startsWith(".config/model-gateway/") && !(item.agent === 'opencode' && relative.startsWith('.config/opencode/'))) continue;
    const known = predicted.get(filePath);
    const file = known ? { ...known } : { ...metadata(item), status: "unknown", role: text(item.type),
      reason: "Discovered source. Registration, enablement and effective loading have not been verified.",
      impact: "Excluded from the startup instruction estimate." };
    file.agent = text(item.agent);
    file.loadMode = text(item.loadMode || "unknown");
    for (const key of ["residentTokens", "bodyTokens"]) file[key] = Number.isFinite(item[key]) && item[key] >= 0 ? item[key] : null;
    if (item.type === "skill" && ["codex", "claude"].includes(agent)) {
      file.status = "on-invoke";
      file.reason = "For a registered skill, the name and description may be available before invocation; its instruction body is read when selected. Discovery does not verify registration or enablement.";
      file.impact = "Skill metadata and full body have separate context costs. This body is not counted in the startup instruction estimate.";
    }
    if (relative === ".claude.json") {
      file.role = "user and project-local MCP source";
      file.reason = "Claude stores user MCP definitions and project-local definitions in this home file. Physical global placement does not mean every entry applies to every repository. Sensitive contents may be protected by the editor.";
    }
    if (agent === "codex" && /(?:^|\/)\.codex\/config\.toml$/.test(filePath)) file.role = "agent settings, subagent registration and MCP source";
    const key = normalized(file.path);
    if (!files.has(key)) files.set(key, file);
  }
  const result = [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
  const starting = result.filter(file => file.type === "instruction" && file.status === "applies");
  starting.sort((a, b) => Number(Boolean(a.repo)) - Number(Boolean(b.repo)) ||
    Number(a.role !== "global instruction") - Number(b.role !== "global instruction") ||
    instructionDirectory(a, agent).split("/").length - instructionDirectory(b, agent).split("/").length ||
    Number(basename(a.path) === "claude.local.md") - Number(basename(b.path) === "claude.local.md") || a.path.localeCompare(b.path));
  const layers = new Map();
  for (const file of starting) {
    const key = JSON.stringify([Boolean(file.repo),file.role === "global instruction",instructionDirectory(file, agent),basename(file.path) === "claude.local.md"]);
    if (!layers.has(key)) layers.set(key, []);
    layers.get(key).push(file);
  }
  [...layers.values()].forEach((layer, index) => {
    for (const file of layer) { file.readOrder = index + 1; if (layer.length > 1) file.readOrderTied = true; }
  });
  return result;
}

export function loadingMap({ inventory, repo = "", agent = "codex", home = "", launchDirectory = repo, observations = [], agents = [] } = {}) {
  const directories = loadingDirectories({ inventory, repo, agent, home });
  if (typeof launchDirectory !== "string" || hasDotSegment(launchDirectory)) throw new Error("Launch directory must be a discovered instruction folder in the selected repository.");
  launchDirectory = repo ? directories.find(folder => folder === normalized(launchDirectory)) : launchDirectory === "" ? "" : undefined;
  if (launchDirectory === undefined) throw new Error("Launch directory must be a discovered instruction folder in the selected repository.");
  const groups = [
    { id: "global", title: "Global instructions", description: "Documented default global locations and discovered ancestors. Active agent homes and launch modes remain uninspected.", files: [] },
    { id: "repo", title: "Repository instructions", description: "Predicted instructions on the selected repository root-to-launch-directory chain.", files: [] },
    { id: "conditional", title: "Directory-dependent instructions", description: "Nested instructions depend on working directory or file access. They are excluded from the startup estimate.", files: [] },
    { id: "settings", title: "Settings and delegation metadata", description: "Configuration bodies are excluded. Discovery does not establish enabled tools, effective settings or active model routes.", files: [] }
  ];
  const notes = ["This map predicts documented loading from filenames and metadata. It does not observe a running agent.",
    "Managed configuration, command-line flags, alternate agent homes, excluded files and ancestors outside the scan remain unknown.",
    "File bytes come from inventory metadata; token estimates use bytes/4 and do not measure runtime context.",
    "Settings filenames do not establish active values or tool registration. Their bodies remain excluded from this map.",
    "A recorded context observation is dated session evidence; it may be stale and does not describe a live session."];
  if (inventory?.coverage?.partial) notes.push("Inventory coverage is partial. Missing scanned inputs can change this prediction.");
  if (agent === "codex") notes.push("Codex chooses one nonempty instruction file per directory: AGENTS.override.md, then AGENTS.md, then configured fallback names. Custom fallback names are unknown. Bytes alone cannot distinguish whitespace-only files, so nonempty selection is an estimate.",
    "Project instructions follow the root-to-launch-directory chain. Unrelated descendant files are not injected automatically.",
    "The default project document limit is 32 KiB. The active limit, trust, profile and CLI settings are unknown.",
    "Codex settings have separate per-key precedence: CLI, trusted project configs, selected profile, user, cloud, system and built-in defaults. Config bodies are uninspected.",
    "Codex import behavior is unresolved; Claude import semantics are not assumed.");
  else if (agent === "claude") notes.push("Claude instruction text combines; CLAUDE.local.md does not establish an override of CLAUDE.md.",
    "Claude @imports expand eagerly with the parent. Import targets and their context cost cannot be discovered from metadata alone.",
    "Claude AGENTS.md support and mode are version-dependent. Recent versions support it, but active mode and exclusions are uninspected.",
    "Claude settings precedence is separate: managed, --settings, project-local, project and user. Array merging and active values remain unknown.");
  else notes.push("Loading semantics for this selected agent have not been verified. Relevant discovered files remain unknown.");
  const selected = selectedItems(inventory, repo, agent, home);
  const instructionItems = selected.filter(item => item.type === "instruction");
  for (const item of selected) {
    const file = metadata(item);
    if (item.type === "rule" || item.type === "subagent") {
      file.role = item.type === "rule" ? "directory rule" : "task delegation"; file.status = "unknown";
      file.reason = item.type === "rule" ? "Rule frontmatter, active paths and agent support are uninspected; applicability cannot be inferred." : "Subagent registration, invocation and agent support are uninspected; active task routing cannot be inferred.";
      file.impact = "Metadata only; excluded from the startup instruction estimate.";
      groups[item.type === "rule" ? 2 : 3].files.push(file); continue;
    }
    if (item.type !== "instruction") {
      file.role = settingsRole(item); file.status = "unknown";
      file.reason = item.type === "delegation" || item.agent === "model-gateway" ? "Routing values, hooks and selected models are uninspected; active delegation cannot be inferred." : item.type === "mcp-server" ? "Transport, registered tools, enablement and agent support cannot be inferred from file metadata." : "Settings values and effective per-key precedence require trusted project, profile and launch information that has not been inspected.";
      file.impact = "Metadata only; runtime context and behavior impact are unknown.";
      groups[3].files.push(file); continue;
    }
    const location = instructionLocation(item, repo, agent, home, launchDirectory);
    const name = basename(item.path), size = bytes(item);
    file.role = location.role;
    file.status = location.conditional ? "conditional" : "unknown";
    file.reason = location.conditional ? "Applies only under a matching directory or file-access condition; this is not startup loading at the selected launch directory." : "This file is outside a verified default instruction location; its loading is unknown.";
    if (!["codex", "claude"].includes(agent)) {
      file.status = "unknown"; file.reason = "Loading semantics for this agent have not been verified.";
    } else if (agent === "codex" && ["agents.md", "agents.override.md"].includes(name)) {
      const siblings = instructionItems.filter(candidate => directory(candidate.path) === directory(item.path) && ["agents.md", "agents.override.md"].includes(basename(candidate.path)));
      const override = siblings.find(candidate => basename(candidate.path) === "agents.override.md");
      const nestedGlobal = !item.repo && location.conditional;
      const recognizedLocation = location.role !== "other discovered instruction" && !nestedGlobal;
      if (nestedGlobal) { file.status = "unknown"; file.reason = "This nested global instruction is outside the selected repository launch chain. Manual imports, alternate working directories and customized discovery are unknown."; }
      else if (!recognizedLocation) { file.status = "unknown"; file.reason = "This instruction is outside the documented default global location and selected repository launch chain. Alternate homes and explicit imports are unknown."; }
      else if (size === null) { file.status = "unknown"; file.reason = "File size and nonempty state are unknown; Codex selection cannot be predicted."; }
      else if (size === 0) { file.status = "shadowed"; file.reason = "Empty instruction files are skipped by documented Codex discovery."; }
      else if (name === "agents.md" && override && bytes(override) !== 0) {
        file.status = bytes(override) === null ? "unknown" : "shadowed";
        file.reason = bytes(override) === null ? "An override file exists, but its nonempty state is unknown." : "A byte-nonempty AGENTS.override.md suggests precedence under documented Codex discovery; whitespace-only content is not established by metadata.";
      } else if (recognizedLocation && size !== null) {
        file.status = location.conditional ? "conditional" : "applies";
        file.reason = location.conditional ? "Predicted Codex instruction when launching within this directory; descendants outside the launch chain are not injected." : "Predicted byte-nonempty Codex candidate at this directory level; whitespace-only content is uninspected and higher-level instructions remain in the chain.";
      }
    } else if (agent === "claude") {
      if (name === "claude.local.md" && basename(directory(item.path)) === ".claude") {
        file.status = "unknown"; file.reason = "CLAUDE.local.md inside .claude is not a documented default instruction location. Explicit imports and custom loading remain unresolved.";
      } else if (["claude.md", "claude.local.md"].includes(name) && location.role !== "other discovered instruction") {
        file.status = location.conditional ? "conditional" : "applies";
        file.reason = location.conditional ? "Predicted to load on a matching descendant directory or file-access condition." : "Predicted Claude instruction text combines with other discovered instruction layers; no text override is inferred.";
      } else if (name === "agents.md") {
        file.status = "unknown";
        const alternative = instructionItems.some(candidate => ["claude.md", "claude.local.md"].includes(basename(candidate.path)) &&
          !(basename(candidate.path) === "claude.local.md" && basename(directory(candidate.path)) === ".claude") &&
          (instructionLocation(candidate, repo, agent, home, launchDirectory).group === "repo" || directory(candidate.path) === normalized(home)));
        file.reason = "Claude AGENTS.md mode and version support are uninspected." + (alternative ? " Under documented default fallback, project or ancestor CLAUDE.md variants suppress AGENTS.md; active mode may differ." : " Recent versions can read it, but this scan cannot establish the active mode.");
      } else if (name === "agents.override.md") {
        file.status = "shadowed";
        file.reason = "Not a documented Claude automatic instruction filename. Explicit imports remain unresolved.";
      }
    }
    file.impact = size === null ? "File size and context cost are unknown." : size + " discovered bytes; approximately " + Math.ceil(size / 4) + " tokens (bytes/4), not measured context.";
    groups.find(group => group.id === location.group).files.push(file);
  }
  for (const group of groups) group.files.sort((a, b) => a.path.localeCompare(b.path));
  const files = groups.flatMap(group => group.files);
  const applicablePaths = new Set(files.filter(file => file.status === "applies").map(file => file.path));
  const counted = instructionItems.filter(item => applicablePaths.has(text(item.path)));
  const estimatedInstructionBytes = counted.reduce((sum, item) => sum + (bytes(item) || 0), 0);
  const projectInstructionBytes = counted.filter(item => item.repo).reduce((sum, item) => sum + (bytes(item) || 0), 0);
  const summary = { applies: files.filter(file => file.status === "applies").length, conditional: files.filter(file => file.status === "conditional").length,
    shadowed: files.filter(file => file.status === "shadowed").length, unknown: files.filter(file => file.status === "unknown").length,
    estimatedInstructionBytes, estimatedInstructionTokens: Math.ceil(estimatedInstructionBytes / 4), projectInstructionBytes,
    projectDocMaxBytes: agent === "codex" ? 32768 : null,
    projectBudgetStatus: agent === "codex" && repo ? projectInstructionBytes > 32768 ? "exceeds-default" : groups[1].files.some(file => file.status === "unknown") ? "unknown" : "within-default" : "unknown" };
  summary.text = summary.applies + " predicted applicable files; " + summary.conditional + " conditional; " + summary.shadowed + " shadowed; " + summary.unknown + " unknown. Context has not been measured.";
  const installed = agents.find(value => value?.id === agent);
  if (installed?.version) notes.push("Reported CLI version: " + text(installed.version).slice(0, 120) + ". Version metadata does not reveal active settings.");
  const repositoryObservation = attributedObservation(observations, repo, agent);
  const nestedLaunch = !!repo && launchDirectory !== normalized(repo);
  if (nestedLaunch) notes.push("Recorded context observations are repository-scoped. The repository reading is not evidence for this launch directory; no folder observation is attached.");
  const configuration = { inferred: true, files: configurationFiles({ inventory, repo, agent, home, groups }), notes: [
    "This tree includes discovered sources for the selected agent and scope. It does not establish a complete live runtime configuration.",
    "Managed sources, CLI flags, alternate homes, import targets, excluded sensitive files and symlinks remain unresolved. Scan limits may omit other sources.",
    "Instruction read order, settings precedence and skill selection are separate mechanisms. A later file does not automatically disable every earlier file.",
    "Claude same-name skills prefer enterprise, then personal, then project. Codex can expose multiple same-name skills without merging them. Active registration and skill frontmatter names are unverified."
  ] };
  return { repo: text(repo), agent: text(agent), launchDirectory: text(launchDirectory), directories: directories.map(text), inferred: true, summary, groups, notes, configuration,
    observation: nestedLaunch ? null : repositoryObservation, repositoryObservation: nestedLaunch ? repositoryObservation : null };
}
