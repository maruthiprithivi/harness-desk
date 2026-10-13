import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store } from "../lib/store.mjs";
import { GapLedger } from "../lib/gaps.mjs";

class MemoryStore {
  constructor() { this.files = new Map(); this.options = new Map(); }
  async read(file, fallback) { return structuredClone(this.files.get(file) ?? fallback); }
  async write(file, content, options) { this.files.set(file, structuredClone(content)); this.options.set(file, options); return file; }
}
function observation(overrides = {}) {
  return { key: "fixture-gap", title: "Fixture gap", kind: "reported", severity: "warning", evidence: "Synthetic observation", nextStep: "Verify a fixture", source: "synthetic fixture", eventKey: "evt-1", ...overrides };
}
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "harness-gaps-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = await new Store(path.join(directory, "generated")).init();
  return { directory, store, ledger: await new GapLedger(store).init() };
}

test("stable scoped identity deduplicates observations without merging repositories or agents", async () => {
  const ledger = await new GapLedger(new MemoryStore()).init();
  const first = await ledger.record(observation({ repo: "fixture-repo-a", agent: "codex" }), "2020-01-01T00:00:00Z");
  assert.match(first.id, /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
  const replay = await ledger.record(observation({ repo: "fixture-repo-a", agent: "codex" }), "2020-01-02T00:00:00Z");
  assert.equal(replay.id, first.id);
  assert.equal(replay.occurrences, 1);
  assert.equal(replay.lastSeen, "2020-01-01T00:00:00.000Z");
  const otherRepo = await ledger.record(observation({ repo: "fixture-repo-b", agent: "codex" }));
  const otherAgent = await ledger.record(observation({ repo: "fixture-repo-a", agent: "claude" }));
  assert.notEqual(otherRepo.id, first.id);
  assert.notEqual(otherAgent.id, first.id);
  await ledger.record(observation({ repo: "fixture-repo-a", agent: "codex", eventKey: "evt-2" }), "2020-01-03T00:00:00Z");
  assert.equal(first.occurrences, 2);
  assert.equal(first.firstSeen, "2020-01-01T00:00:00.000Z");
  assert.equal(first.lastSeen, "2020-01-03T00:00:00.000Z");
  assert.equal(ledger.records.length, 3);
});

test("failed ledger saves leave observations, status and links retryable", async () => {
  for (const failedFile of ["gaps/ledger.md", "gaps/ledger.json"]) {
    const store = new MemoryStore();
    const write = store.write.bind(store), writes = [];
    let failNext = "";
    store.write = async (file, content, options) => {
      writes.push(file);
      if (file === failNext) { failNext = ""; throw new Error("Synthetic ledger write failure"); }
      return write(file, content, options);
    };
    const ledger = await new GapLedger(store).init();
    assert.deepEqual(writes.slice(-2), ["gaps/ledger.md", "gaps/ledger.json"]);
    failNext = failedFile;
    await assert.rejects(() => ledger.record(observation()), /write failure/);
    assert.deepEqual(ledger.records, []);
    assert.deepEqual(store.files.get("gaps/ledger.json"), []);
    const gap = await ledger.record(observation());
    assert.equal(gap.occurrences, 1);
    assert.deepEqual(store.files.get("gaps/ledger.json"), ledger.records);

    const beforeObservation = structuredClone(gap);
    failNext = failedFile;
    await assert.rejects(() => ledger.record(observation({ eventKey: "evt-2" })), /write failure/);
    assert.deepEqual(gap, beforeObservation);
    assert.deepEqual(store.files.get("gaps/ledger.json"), ledger.records);
    await ledger.record(observation({ eventKey: "evt-2" }));
    assert.equal(gap.occurrences, 2);
    assert.deepEqual(gap.eventKeys, ["evt-1", "evt-2"]);

    const beforeUpdate = structuredClone(gap);
    failNext = failedFile;
    await assert.rejects(() => ledger.update(gap.id, { status: "resolved", verificationNote: "Fixture check passed" }), /write failure/);
    assert.deepEqual(gap, beforeUpdate);
    assert.deepEqual(store.files.get("gaps/ledger.json"), ledger.records);
    await ledger.update(gap.id, { status: "resolved", verificationNote: "Fixture check passed" });
    assert.equal(gap.status, "resolved");

    const beforeLink = structuredClone(gap);
    failNext = failedFile;
    await assert.rejects(() => ledger.link(gap.id, "conversation-fixture"), /write failure/);
    assert.deepEqual(gap, beforeLink);
    assert.deepEqual(store.files.get("gaps/ledger.json"), ledger.records);
    await ledger.link(gap.id, "conversation-fixture");
    assert.equal(gap.status, "in-progress");
    assert.equal(gap.verificationNote, "");
    assert.deepEqual(gap.conversationIds, ["conversation-fixture"]);
    assert.deepEqual(store.files.get("gaps/ledger.json"), ledger.records);
    assert.deepEqual(writes.slice(-2), ["gaps/ledger.md", "gaps/ledger.json"]);
    assert.equal(store.options.get("gaps/ledger.json").pinned, true);
    assert.equal(store.options.get("gaps/ledger.md").pinned, true);
    const restarted = await new GapLedger(store).init();
    assert.deepEqual(restarted.records, ledger.records);
    assert.equal((await restarted.record(observation({ eventKey: "evt-2" }))).occurrences, 2);
  }
});

test("all persisted strings are redacted and Markdown evidence remains literal text", async () => {
  const store = new MemoryStore();
  const ledger = await new GapLedger(store).init();
  const gap = await ledger.record(observation({ key: "password=fixture-hidden", title: "<script>fixture</script> token=fixture-hidden", repo: "password=fixture-hidden", agent: "token=fixture-hidden", evidence: "[run](javascript:fixture) password=fixture-hidden", nextStep: "Bearer fixture-hidden", source: "token=fixture-hidden", eventKey: "password=fixture-hidden" }));
  await ledger.update(gap.id, { status: "resolved", verificationNote: "password=fixture-hidden", note: "token=fixture-hidden" });
  await ledger.link(gap.id, "token=fixture-hidden");
  const json = JSON.stringify(store.files.get("gaps/ledger.json"));
  const markdown = store.files.get("gaps/ledger.md");
  assert.equal(json.includes("fixture-hidden"), false);
  assert.equal(markdown.includes("fixture-hidden"), false);
  assert.equal(markdown.includes("<script>"), false);
  assert.equal(markdown.includes("[run](javascript:"), false);
  assert.match(markdown, /\\<script\\>/);
  assert.equal(store.options.get("gaps/ledger.json").pinned, true);
  assert.equal(store.options.get("gaps/ledger.md").pinned, true);
});

test("resolution needs verification, replay stays resolved, recurrence reopens and dismissal persists", async () => {
  const ledger = await new GapLedger(new MemoryStore()).init();
  const gap = await ledger.record(observation());
  await assert.rejects(() => ledger.update(gap.id, { status: "resolved", verificationNote: "  " }), /verification/);
  assert.equal(gap.status, "open");
  await ledger.update(gap.id, { status: "in-progress", note: "Checking the fixture" });
  await ledger.update(gap.id, { status: "resolved", verificationNote: "Fixture check passed" });
  await assert.rejects(() => ledger.update(gap.id, { verificationNote: "" }), /verification/);
  assert.equal(gap.verificationNote, "Fixture check passed");
  await ledger.record(observation());
  assert.equal(gap.status, "resolved");
  assert.equal(gap.occurrences, 1);
  await ledger.record(observation({ eventKey: "evt-2" }));
  assert.equal(gap.status, "open");
  assert.equal(gap.events.at(-1).type, "reopened");
  assert.equal(gap.verificationNote, "");
  await assert.rejects(() => ledger.update(gap.id, { status: "resolved" }), /verification/);
  await ledger.update(gap.id, { status: "dismissed", note: "Accepted limitation" });
  await ledger.record(observation({ eventKey: "evt-3" }));
  assert.equal(gap.status, "dismissed");
  assert.equal(gap.occurrences, 3);
  await assert.rejects(() => ledger.update(gap.id, { status: "unsupported" }), /status/);
  assert.equal(ledger.get("missing"), null);
  await assert.rejects(() => ledger.update("missing", { status: "open" }), /not found/);
});

test("conversation links are deduplicated, bounded and never resolve a gap", async () => {
  const ledger = await new GapLedger(new MemoryStore()).init();
  const gap = await ledger.record(observation());
  await ledger.link(gap.id, "conversation-1");
  const count = gap.events.length;
  await ledger.link(gap.id, "conversation-1");
  assert.equal(gap.events.length, count);
  assert.equal(gap.status, "in-progress");
  assert.deepEqual(gap.conversationIds, ["conversation-1"]);
  await ledger.update(gap.id, { status: "resolved", verificationNote: "Prior fixture verification" });
  await ledger.link(gap.id, "conversation-2");
  assert.equal(gap.status, "in-progress");
  assert.equal(gap.verificationNote, "");
  for (let index = 2; index <= 60; index++) await ledger.link(gap.id, "conversation-" + index);
  assert.equal(gap.conversationIds.length, 50);
  assert.equal(gap.conversationIds[0], "conversation-11");
  assert.equal(gap.events.length, 20);
  assert.equal(gap.occurrences, 1);
  assert.equal(gap.status, "in-progress");
  await assert.rejects(() => ledger.link("missing", "conversation"), /not found/);
});

test("event and replay caches roll while the record limit fails explicitly", async () => {
  const ledger = await new GapLedger(new MemoryStore()).init();
  const gap = await ledger.record(observation());
  for (let index = 2; index <= 1005; index++) await ledger.record(observation({ eventKey: "evt-" + index }));
  assert.equal(gap.occurrences, 1005);
  assert.equal(gap.events.length, 20);
  assert.equal(gap.eventKeys.length, 1000);
  await ledger.record(observation({ eventKey: "evt-1000" }));
  assert.equal(gap.occurrences, 1005);
  await ledger.record(observation({ eventKey: "evt-1" }));
  assert.equal(gap.occurrences, 1006);
  ledger.records = Array.from({ length: 1000 }, (_, index) => ({ ...structuredClone(gap), id: "fixture-" + index, key: "gap-" + index, eventKeys: [], events: [], conversationIds: [] }));
  await assert.rejects(() => ledger.record(observation({ key: "new-gap" })), /record limit/);
  await ledger.record(observation({ key: "gap-0", eventKey: "new-event" }));
  assert.equal(ledger.records.length, 1000);
  const oversized = new MemoryStore();
  oversized.files.set("gaps/ledger.json", Array(1001).fill({}));
  await assert.rejects(() => new GapLedger(oversized).init(), /record limit/);
});

test("pinned JSON and Markdown survive retention and restart preserves IDs, replay keys and conversation links", async t => {
  const { store, ledger } = await fixture(t);
  const gap = await ledger.record(observation());
  await ledger.link(gap.id, "conversation-fixture");
  await store.write("old-report.md", "Synthetic old report");
  for (const entry of Object.values(store.manifest)) entry.updatedAt = "2000-01-01T00:00:00Z";
  const preview = await store.prune(30, true);
  assert.deepEqual(preview.files.map(file => file.path), ["old-report.md"]);
  await store.prune(30, false);
  const restartedStore = await new Store(store.root).init();
  const restarted = await new GapLedger(restartedStore).init();
  const replay = await restarted.record(observation());
  assert.equal(replay.id, gap.id);
  assert.equal(replay.occurrences, 1);
  assert.equal(replay.status, "in-progress");
  assert.deepEqual(replay.conversationIds, ["conversation-fixture"]);
  assert.ok((await fs.readFile(await restartedStore.location("gaps/ledger.md"), "utf8")).includes("Fixture gap"));
  assert.equal(restartedStore.manifest["gaps/ledger.json"].pinned, true);
  assert.equal(restartedStore.manifest["gaps/ledger.md"].pinned, true);
});

test("detector distinguishes static capabilities, scoped agent gaps and bounded partial scan evidence", async () => {
  const ledger = await new GapLedger(new MemoryStore()).init();
  const state = { inventory: { scannedAt: "scan-1", coverage: { partial: false }, warnings: [] }, journal: { coverage: null }, agents: [
    { id: "codex", installed: true, auth: "signed-in", dispatch: "direct", version: "fixture-1" },
    { id: "claude", installed: true, auth: "signed-in", dispatch: "handoff", version: "fixture-1", authEvidence: "Supported probe at 2020-01-01T00:00:00.000Z" },
    { id: "kimi", installed: true, auth: "unknown", dispatch: "handoff", authEvidence: "password=fixture-hidden" },
    { id: "kiro", installed: false, auth: "unknown", dispatch: "handoff" }
  ] };
  await ledger.detect(state, "call-1");
  assert.equal(ledger.records.length, 7);
  assert.equal(ledger.records.some(gap => gap.agent === "codex" || gap.agent === "kiro"), false);
  assert.equal(ledger.records.filter(gap => gap.agent === "kimi").length, 2);
  assert.ok(ledger.records.filter(gap => gap.kind === "capability").every(gap => gap.repo === ""));
  const staticGap = ledger.records.find(gap => gap.key === "capability.exact-mining");
  await ledger.update(staticGap.id, { status: "resolved", verificationNote: "Fixture verification" });
  state.agents[1].authEvidence = "Supported probe at 2020-01-02T00:00:00.000Z";
  await ledger.detect(state, "call-2");
  assert.ok(ledger.records.every(gap => gap.occurrences === 1));
  assert.equal(staticGap.status, "resolved");
  state.inventory.coverage = { partial: true, limitsReached: ["Fixture depth limit"], warnings: Array.from({ length: 40 }, () => "password=fixture-hidden " + "x".repeat(1000)) };
  await ledger.detect(state, "call-3");
  const coverage = ledger.records.find(gap => gap.kind === "coverage");
  assert.equal(coverage.repo, "");
  assert.equal(coverage.agent, "");
  assert.match(coverage.evidence, /Fixture depth limit/);
  assert.ok(coverage.evidence.length < 4200);
  assert.equal(JSON.stringify(ledger.records).includes("fixture-hidden"), false);
  await ledger.detect(state, "call-4");
  assert.equal(coverage.occurrences, 1);
  state.inventory.scannedAt = "scan-2";
  await ledger.detect(state, "call-5");
  assert.equal(coverage.occurrences, 2);
  const agentGap = ledger.records.find(gap => gap.agent === "claude");
  await ledger.update(agentGap.id, { status: "resolved", verificationNote: "Fixture verification" });
  state.agents[1].version = "fixture-2";
  await ledger.detect(state, "call-6");
  assert.equal(agentGap.status, "open");
  assert.equal(agentGap.occurrences, 2);
  const assessed = await new GapLedger(new MemoryStore()).init();
  await assessed.detect({ inventory: { coverage: { partial: false } }, journal: { coverage: 100 }, agents: [] });
  assert.equal(assessed.records.length, 3);
  assert.equal(assessed.records.some(gap => gap.key === "capability.journal-encoding"), false);
});
