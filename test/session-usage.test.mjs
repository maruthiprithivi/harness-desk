import test from "node:test";
import assert from "node:assert/strict";
import { parseSessionUsage } from "../lib/session-usage.mjs";

const repo = "/fixture/project-one", otherRepo = "/fixture/project-two", at = "2026-10-01T12:30:45.000Z";
const parse = (records, options = {}) => parseSessionUsage(JSON.stringify(records), { agent: "claude", format: "json", ...options });
const claude = (content, extra = {}) => ({ type: "assistant", sessionId: "session-one", cwd: repo, timestamp: at, message: { role: "assistant", content }, ...extra });
const skill = (id = "call-one", name = "review") => ({ type: "tool_use", id, name: "Skill", input: { skill: name, args: "hidden" } });
const mcp = (id = "call-two", name = "mcp__fixture__lookup") => ({ type: "tool_use", id, name, input: { ["api" + "Key"]: "hidden" } });
const output = (id, is_error = false, extra = {}) => ({ type: "user", sessionId: "session-one", message: { content: [{ type: "tool_result", tool_use_id: id, is_error, content: "hidden" }] }, ...extra });
const meta = (id = "session-one", cwd = repo) => ({ type: "session_meta", payload: { id, cwd, instructions: "hidden" } });
const codexCall = (id = "call-one", name = "mcp__fixture__lookup", extra = {}) => ({ type: "response_item", timestamp: at, payload: { type: "function_call", name, call_id: id, arguments: '{"command":"hidden"}' }, ...extra });
const codexOutput = (id = "call-one", extra = {}) => ({ type: "response_item", payload: { type: "function_call_output", call_id: id, output: "hidden", ...extra } });
const event = (kind, name, callId, extra = {}) => ({ kind, name, ...(kind === "mcp" ? { tool: "lookup" } : {}), repo, at, callId, sessionId: "session-one", resultSeen: false, failed: false, ...extra });
function onlyMetadata(result) {
  assert.equal(JSON.stringify(result).includes("hidden"), false);
  assert.equal(result.source, "explicit local session import; tool calls are not proof of benefit");
  assert.match(result.coverage.limit, /supported Claude and Codex JSON\/JSONL/);
  for (const entry of result.events) assert.ok(Object.keys(entry).every(key => ["kind", "name", "tool", "repo", "at", "callId", "sessionId", "resultSeen", "failed"].includes(key)));
}

test("Claude records retain only explicit Skill and MCP call metadata and link later results", () => {
  const result = parse({ messages: [claude([skill(), mcp(), { type: "text", text: "hidden" }]), output("call-one"), output("call-two", true)] });
  assert.deepEqual(result.events, [event("skill", "review", "call-one", { resultSeen: true }), event("mcp", "fixture", "call-two", { resultSeen: true, failed: true })]);
  assert.deepEqual(result.coverage.issues, []);
  assert.equal(result.coverage.partial, false);
  assert.equal(result.coverage.records, 3);
  assert.equal(result.coverage.supportedCalls, 2);
  onlyMetadata(result);
});

test("Codex metadata supplies session and repo, and result bodies establish no success or failure", () => {
  const result = parse([meta(), codexCall(), codexOutput()], { agent: "codex" });
  assert.deepEqual(result.events, [event("mcp", "fixture", "call-one", { resultSeen: true })]);
  assert.equal(result.coverage.records, 3);
  assert.equal(result.coverage.ignoredRecords, 1);
  assert.equal(result.coverage.partial, false);
  const failure = parse([meta(), codexCall(), codexOutput("call-one", { is_error: true })], { agent: "codex" });
  assert.equal(failure.events[0].failed, true);
  onlyMetadata(result); onlyMetadata(failure);
});

test("repository changes apply only to subsequent records and remain separate by session", () => {
  const result = parse([
    meta(), codexCall("one"), { type: "turn_context", payload: { cwd: otherRepo } }, codexCall("two"),
    codexCall("three", "mcp__fixture__lookup", { sessionId: "session-two", cwd: "" }),
    codexCall("four", "mcp__fixture__lookup", { sessionId: "session-one" }), codexOutput("one")
  ], { agent: "codex" });
  assert.deepEqual(result.events.map(entry => [entry.callId, entry.repo]), [["one", repo], ["two", otherRepo], ["three", ""], ["four", otherRepo]]);
  assert.equal(result.events[0].resultSeen, true);
  const early = parse([codexCall(), meta(), codexCall("later")], { agent: "codex" });
  assert.deepEqual(early.events.map(entry => entry.callId), ["later"]);
  assert.equal(early.coverage.partial, true);
});

test("missing attribution never becomes global or receives a later timestamp or directory", () => {
  for (const field of ["cwd", "sessionId", "timestamp"]) {
    const record = claude([skill()]); delete record[field];
    const result = parse([record, claude([skill("later")])]);
    assert.deepEqual(result.events.map(entry => entry.callId), ["later"]);
    assert.equal(result.coverage.partial, true);
  }
  const global = parse([claude([skill()], { cwd: "" })]);
  assert.equal(global.events[0].repo, "");
  for (const invalid of [null, 0, "hidden\npath"]) assert.equal(parse([claude([skill()], { cwd: invalid })]).events.length, 0);
});

test("timestamps require a real ISO calendar date and timezone", () => {
  for (const invalid of ["October 1 2026", "2026-10-01", "2026-10-01T12:30:45", "2026-02-30T12:30:45Z", "2026-13-01T12:30:45Z", "2026-10-01T24:30:45Z", "2026-10-01T12:30:60Z", "2026-10-01T12:30:45+00:60"]) {
    const result = parse([claude([skill()], { timestamp: invalid })]);
    assert.equal(result.events.length, 0); assert.equal(result.coverage.partial, true);
  }
  assert.equal(parse([claude([skill()], { timestamp: "2026-10-01T14:30:45+02:00" })]).events[0].at, at);
});

test("ordinary prompts, file reads and shell commands never infer skill or MCP calls", () => {
  const result = parse([claude([
    { type: "text", text: "Skill hidden" },
    { type: "tool_use", id: "one", name: "Bash", input: { command: "Skill hidden" } },
    { type: "tool_use", id: "two", name: "Read", input: { file_path: "/fixture/hidden/SKILL.md" } }
  ])]);
  assert.deepEqual(result.events, []); assert.equal(result.coverage.partial, false);
  const codex = parse([meta(), codexCall("one", "exec_command"), codexCall("two", "Skill")], { agent: "codex" });
  assert.deepEqual(codex.events, []); assert.equal(codex.coverage.partial, true);
  onlyMetadata(result); onlyMetadata(codex);
});

test("only explicit Claude Skill inputs may be parsed as JSON", () => {
  const record = skill(); record.input = JSON.stringify({ skill: "review", args: "hidden" });
  assert.equal(parse([claude([record])]).events[0].name, "review");
  for (const input of ["{hidden", null, {}, { name: "review" }, { skill: 0 }]) {
    record.input = input;
    const result = parse([claude([record])]);
    assert.deepEqual(result.events, []); assert.equal(result.coverage.partial, true); onlyMetadata(result);
  }
});

test("malformed JSONL records are counted and skipped without echoing their content", () => {
  const lines = [JSON.stringify(claude([skill()])), "{hidden", "null", JSON.stringify(output("call-one", true))].join("\n");
  const result = parseSessionUsage(lines, { agent: "claude", format: "jsonl" });
  assert.equal(result.coverage.records, 4); assert.equal(result.coverage.ignoredRecords, 2);
  assert.equal(result.events[0].failed, true); assert.equal(result.coverage.partial, true); onlyMetadata(result);
});

test("unsupported documents, agents, formats and malformed tool records return generic coverage", () => {
  for (const input of ["{hidden", "null", "123", '{"sops":{},"messages":[]}', '{"messages":{}}', '{"unknown":"hidden"}']) {
    const result = parseSessionUsage(input, { agent: "claude", format: "json" });
    assert.deepEqual(result.events, []); assert.equal(result.coverage.partial, true); onlyMetadata(result);
  }
  for (const options of [{ agent: "unknown" }, { format: "unknown" }]) assert.equal(parse([], options).coverage.partial, true);
  assert.equal(parseSessionUsage("[]", null).coverage.partial, true);
  assert.equal(parse([{}]).coverage.partial, true);
  for (const name of [null, 1, {}]) {
    const result = parse([claude([{ type: "tool_use", id: "one", name }])]);
    assert.deepEqual(result.events, []); assert.equal(result.coverage.partial, true);
  }
});

test("malformed metadata clears attribution instead of borrowing stale context", () => {
  const result = parse([meta(), codexCall("valid"), meta("session-one", null), codexCall("invalid"), { type: "turn_context", payload: { cwd: "" } }, codexCall("global")], { agent: "codex" });
  assert.deepEqual(result.events.map(entry => [entry.callId, entry.repo]), [["valid", repo], ["global", ""]]);
  assert.equal(result.coverage.partial, true);
  const invalidSession = parse([meta(), { type: "session_meta", payload: { id: null, cwd: repo } }, codexCall()], { agent: "codex" });
  assert.deepEqual(invalidSession.events, []); assert.equal(invalidSession.coverage.partial, true);
  const flags = parse([claude([skill()]), output("call-one", "hidden")]);
  assert.equal(flags.events[0].resultSeen, true); assert.equal(flags.events[0].failed, false); assert.equal(flags.coverage.partial, true); onlyMetadata(flags);
});

test("deduplication uses session and call identity, excludes conflicts and links out-of-order results", () => {
  const record = claude([skill()]);
  const result = parse([output("call-one", true), record, record, output("call-one"), claude([skill()], { sessionId: "session-two", cwd: otherRepo })]);
  assert.equal(result.events.length, 2); assert.equal(result.coverage.supportedCalls, 2);
  assert.equal(result.events[0].failed, true); assert.equal(result.events[1].resultSeen, false);
  const conflict = parse([record, claude([skill("call-one", "different")]), record]);
  assert.deepEqual(conflict.events, []); assert.equal(conflict.coverage.supportedCalls, 0); assert.equal(conflict.coverage.partial, true);
  assert.deepEqual(parse([record, claude([skill()], { cwd: otherRepo })]).events, []);
});

test("conflicted identities remain excluded for importers even after repeated copies", () => {
  const original = claude([skill()]);
  const conflict = claude([skill("call-one", "different")]);
  const result = parse([original, conflict, original, conflict, claude([skill("valid")])]);
  assert.deepEqual(result.excludedCalls, [{ sessionId: "session-one", callId: "call-one" }]);
  assert.deepEqual(result.events, [event("skill", "review", "valid")]);
  assert.equal(result.coverage.supportedCalls, 1);
  assert.equal(result.coverage.partial, true);
  assert.deepEqual(parse([original, original]).excludedCalls, []);
  const missingId = skill(); delete missingId.id;
  assert.deepEqual(parse([claude([missingId, { ...missingId, input: { skill: "different" } }])]).excludedCalls, []);
  onlyMetadata(result);
});

test("names and identities reject unsafe metadata without retaining rejected values", () => {
  const credentialLike = "sk-" + "x".repeat(20);
  for (const name of ["", "a".repeat(161), "bad name", "bad/path", "[REDACTED]", credentialLike]) {
    const result = parse([claude([skill("one", name)])]);
    assert.deepEqual(result.events, []); assert.equal(result.coverage.partial, true); assert.equal(JSON.stringify(result).includes(credentialLike), false);
  }
  for (const name of ["mcp__one", "mcp__one__two__three", "mcp__one__bad/name", "mcp__one__redacted", "mcp__" + credentialLike + "__two"]) assert.equal(parse([claude([mcp("one", name)])]).events.length, 0);
  for (const id of ["", null, 1, credentialLike]) assert.equal(parse([claude([skill(id)])]).events.length, 0);
  assert.equal(parse([claude([skill("one", "name._:-ok")])]).events[0].name, "name._:-ok");
});

test("input, record and event limits are explicit and bounded", () => {
  const tooBig = parseSessionUsage("x".repeat(2 * 1024 * 1024 + 1), { agent: "claude", format: "jsonl" });
  assert.deepEqual(tooBig.events, []); assert.equal(tooBig.coverage.partial, true);
  const records = parse(Array.from({ length: 20001 }, () => ({})));
  assert.equal(records.coverage.records, 20000); assert.equal(records.coverage.partial, true);
  const calls = parse([claude(Array.from({ length: 5001 }, (_, i) => skill("call-" + i)))]);
  assert.equal(calls.events.length, 5000); assert.equal(calls.coverage.supportedCalls, 5000); assert.equal(calls.coverage.partial, true);
});
