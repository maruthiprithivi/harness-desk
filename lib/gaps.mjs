import { randomUUID, createHash } from "node:crypto";
import { redact } from "./analysis.mjs";
import { agentSupport } from './agent-support.mjs';

const KINDS = ["capability", "coverage", "failure", "reported"];
const SEVERITIES = ["info", "warning", "error"];
const STATUSES = ["open", "in-progress", "resolved", "dismissed"];
const MAX_RECORDS = 1000;
function text(value, maximum, required = false) {
  if (typeof value !== "string" || value.length > maximum || (required && !value.trim())) throw new Error("Invalid gap text");
  return redact(value);
}
function clean(value) {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)]));
  return value;
}
function timestamp(at) {
  const value = at === undefined ? new Date() : new Date(at);
  if (!Number.isFinite(value.getTime())) throw new Error("Invalid gap observation time");
  return value.toISOString();
}
function event(record, at, type, note) {
  record.events = [...record.events, { at, type, note: redact(note) }].slice(-20);
}
function markdown(value) {
  return String(value).replace(/[\r\n]+/g, " ").replace(/([\\`*_{}\[\]()#+.!|<>])/g, "\\$1");
}
function report(records) {
  const lines = ["# Capability and coverage gaps", "", "Resolution requires recorded verification. Conversation links do not verify a fix.", ""];
  for (const record of records) {
    lines.push("## " + markdown(record.title), "", "- ID: " + markdown(record.id), "- Status: " + markdown(record.status),
      "- Kind: " + markdown(record.kind) + " / " + markdown(record.severity),
      "- Scope: " + markdown(record.repo || "global") + (record.agent ? "; agent: " + markdown(record.agent) : ""),
      "- Observations: " + markdown(record.occurrences) + "; first: " + markdown(record.firstSeen) + "; last: " + markdown(record.lastSeen),
      "- Evidence: " + markdown(record.evidence), "- Next step: " + markdown(record.nextStep),
      "- Source: " + markdown(record.source), "- Verification: " + markdown(record.verificationNote || "Not recorded"),
      "- Conversations: " + record.conversationIds.map(markdown).join(", "), "");
    for (const entry of record.events) lines.push("- " + markdown(entry.at) + " / " + markdown(entry.type) + ": " + markdown(entry.note));
    lines.push("");
  }
  return lines.join("\n");
}
function fingerprint(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

export class GapLedger {
  constructor(store) { this.store = store; this.records = []; }
  async init() {
    const saved = await this.store.read("gaps/ledger.json", []);
    if (!Array.isArray(saved) || saved.length > MAX_RECORDS) throw new Error("Invalid gap ledger or record limit exceeded (1000)");
    this.records = clean(saved).map(record => ({ ...record, events: (record.events || []).slice(-20), conversationIds: (record.conversationIds || []).slice(-50), eventKeys: (record.eventKeys || []).slice(-1000) }));
    await this.save();
    return this;
  }
  get(id) { return this.records.find(record => record.id === id) || null; }
  async save(snapshot = this.records) {
    const records = clean(snapshot);
    await this.store.write("gaps/ledger.md", report(records), { kind: "gap-ledger", pinned: true });
    await this.store.write("gaps/ledger.json", records, { kind: "gap-ledger", pinned: true });
  }
  async record(input, at) {
    const fields = {
      key: text(input.key, 300, true), title: text(input.title, 300, true), kind: input.kind,
      repo: text(input.repo || "", 4096), agent: text(input.agent || "", 100), severity: input.severity || "warning",
      evidence: text(input.evidence || "", 8000), nextStep: text(input.nextStep || "", 4000), source: text(input.source || "", 300)
    };
    if (!KINDS.includes(fields.kind) || !SEVERITIES.includes(fields.severity)) throw new Error("Invalid gap kind or severity");
    const eventKey = text(input.eventKey || "", 500);
    const current = this.records.find(item => item.key === fields.key && item.repo === fields.repo && item.agent === fields.agent);
    if (current && eventKey && current.eventKeys.includes(eventKey)) return current;
    if (!current && this.records.length >= MAX_RECORDS) throw new Error("Gap ledger record limit reached (1000)");
    const observedAt = timestamp(at);
    const record = current ? structuredClone(current) : { ...fields, id: randomUUID(), status: "open", occurrences: 0, firstSeen: observedAt, lastSeen: observedAt, verificationNote: "", events: [], conversationIds: [], eventKeys: [] };
    Object.assign(record, fields);
    const reopened = record.status === "resolved";
    if (reopened) { record.status = "open"; record.verificationNote = ""; }
    record.occurrences++;
    record.lastSeen = observedAt;
    // Older replay IDs outside this rolling cache can be counted again; normal polling never records observations.
    if (eventKey) record.eventKeys = [...record.eventKeys, eventKey].slice(-1000);
    event(record, observedAt, reopened ? "reopened" : "observed", fields.evidence);
    await this.save(current ? this.records.map(item => item === current ? record : item) : [...this.records, record]);
    if (current) Object.assign(current, record); else this.records.push(record);
    return current || record;
  }
  async update(id, patch) {
    const current = this.get(id);
    if (!current) throw new Error("Gap not found");
    const record = structuredClone(current);
    const status = patch.status ?? record.status;
    if (!STATUSES.includes(status)) throw new Error("Invalid gap status");
    const verification = patch.verificationNote === undefined ? record.verificationNote : text(patch.verificationNote, 4000);
    const note = text(patch.note || "", 4000);
    if (status === "resolved" && !verification.trim()) throw new Error("Record verification before resolving a gap");
    record.status = status;
    record.verificationNote = verification;
    event(record, timestamp(), patch.status || "note", status === "resolved" ? verification + (note ? "\n" + note : "") : note || "Status: " + status);
    await this.save(this.records.map(item => item === current ? record : item));
    Object.assign(current, record);
    return current;
  }
  async link(id, chatId) {
    const current = this.get(id);
    if (!current) throw new Error("Gap not found");
    const conversation = text(chatId, 100, true);
    if (current.conversationIds.includes(conversation)) return current;
    const record = structuredClone(current);
    record.conversationIds = [...record.conversationIds, conversation].slice(-50);
    if (record.status === "resolved") record.verificationNote = "";
    record.status = "in-progress";
    event(record, timestamp(), "linked", "Advisory conversation: " + conversation + "; verification remains required.");
    await this.save(this.records.map(item => item === current ? record : item));
    Object.assign(current, record);
    return current;
  }
  async detect({ inventory, agents = [], journal } = {}, eventKey = "") {
    const capabilities = [
      ["exact-loading-usage", "Exact loading and usage telemetry is unavailable", "Inventory load modes and token costs are estimates. Loaded paths require user-supplied observations; component usage is unknown.", "Record fresh-session context observations and add verified usage telemetry before pruning by usage."],
      ["exact-mining", "Repeated-work mining uses exact normalized matches", "Mining groups normalized prompts, commands and recurring tool sequences. Semantic clustering is unavailable.", "Review exact-match candidates and benchmark local semantic clustering before adopting it."],
      ["archive-retention", "Archiving generated data does not reclaim disk space", "Retention moves old unpinned generated files into an archive. Archived bytes remain on disk.", "Review archive storage and design a separate deletion feature with a preview and explicit approval."]
    ];
    if (journal?.coverage == null) capabilities.push(["journal-encoding", "Journal encoding coverage is unassessed", "Journal extraction does not establish whether lessons are encoded or enforced in agent configuration.", "Compare lessons with scoped configuration and record verification before reporting encoding coverage."]);
    for (const [key, title, evidence, nextStep] of capabilities) await this.record({ key: "capability." + key, title, kind: "capability", severity: "info", evidence, nextStep, source: "capability detector", eventKey: "capability-v1" });
    if (inventory?.coverage?.partial) {
      const warnings = [...(inventory.coverage.limitsReached || []), ...(inventory.coverage.warnings || inventory.warnings || [])]
        .filter(value => typeof value === "string").slice(0, 8).map(value => redact(value.slice(0, 500)));
      await this.record({ key: "coverage.partial-inventory", title: "Inventory coverage is partial", kind: "coverage", severity: "warning", evidence: "The scanner reported partial coverage." + (warnings.length ? " " + warnings.join("; ") : ""), nextStep: "Review scanner limits and exclusions, adjust the selected roots, then run another scan.", source: "inventory detector", eventKey: inventory.scannedAt || eventKey || fingerprint(warnings) });
    }
    for (const agent of agents) {
      if (!agent?.installed || typeof agent.id !== "string" || !agent.id) continue;
      const support=agentSupport[agent.id];
      if(support?.verification==='unavailable')await this.record({key:'capability.agent-measurement',agent:agent.id,title:'Automatic context measurement is not available for this agent',kind:'capability',severity:'info',evidence:support.detail,nextStep:'Ask an agent to build and test a scoped first-request adapter using this harness’s documented session format. Keep discovery separate from measured loading.',source:'agent support registry',eventKey:'measurement-support-v1'});
      const evidence = typeof agent.authEvidence === "string" ? redact(agent.authEvidence.slice(0, 1000)).replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, "<time>") : "No supported authentication evidence was supplied.";
      const probeKey = fingerprint([agent.auth, agent.dispatch, agent.version || "", evidence]);
      if (agent.dispatch !== "direct") await this.record({ key: "capability.agent-dispatch", agent: agent.id, title: "Automatic advisory dispatch is unavailable", kind: "capability", severity: "warning", evidence: "Installed agent requires a handoff. " + evidence, nextStep: "Use a handoff until isolation, authentication and provider consent are verified for this agent.", source: "agent detector", eventKey: probeKey });
      if (agent.auth === "unknown") await this.record({ key: "capability.agent-auth", agent: agent.id, title: "Agent authentication is unverified", kind: "capability", severity: "warning", evidence, nextStep: "Run a supported status probe and verify sidecar access. Do not inspect credential file contents.", source: "agent detector", eventKey: probeKey });
    }
    return this.records;
  }
}
