import path from "node:path";
import { forbidden, redact } from "./analysis.mjs";

const MAX_BYTES = 2 * 1024 * 1024, MAX_RECORDS = 20000, MAX_EVENTS = 5000;
const own = (value, key) => Object.hasOwn(value, key);
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const identifier = value => typeof value === "string" && value.length > 0 && value.length <= 160 && /^[A-Za-z0-9._:-]+$/.test(value) && redact(value) === value && !/redacted/i.test(value);
const reference = value => typeof value === "string" && value.trim().length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value) && redact(value) === value;
const repository = value => typeof value === "string" && value.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(value) && redact(value) === value;

function timestamp(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, zone] = match;
  const calendar = new Date(0);
  calendar.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  if (calendar.getUTCFullYear() !== Number(year) || calendar.getUTCMonth() !== Number(month) - 1 || calendar.getUTCDate() !== Number(day) || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
  if (zone !== "Z" && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59)) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function readPath(value) {
  if (!repository(value) || !value || /redacted/i.test(value) || forbidden(value)) return null;
  const windows = /^[a-z]:[\\/]/i.test(value) || /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/.test(value);
  if (!windows && !value.startsWith("/")) return null;
  const normalized = windows ? path.win32.normalize(value).toLowerCase() : path.posix.normalize(value);
  return forbidden(normalized) ? null : normalized;
}

export function parseSessionUsage(text, options = {}) {
  const { agent, format, assets = [] } = object(options) ? options : {};
  const result = {
    events: [],
    excludedCalls: [],
    coverage: { partial: false, issues: [], limit: "Coverage includes only supported Claude and Codex JSON/JSONL records; other runtime calls may be absent.", records: 0, supportedCalls: 0, ignoredRecords: 0 },
    source: "explicit local session import; tool calls are not proof of benefit"
  };
  function issue(message) {
    result.coverage.partial = true;
    if (!result.coverage.issues.includes(message)) result.coverage.issues.push(message);
  }
  if (!["claude", "codex"].includes(agent) || !["json", "jsonl"].includes(format)) { issue("Session agent or format is unsupported."); return result; }
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_BYTES) { issue("Session input is invalid or exceeds the input limit."); return result; }
  const targets = new Map(), ambiguousTargets = new Set();
  const includeReads = agent === "claude" && (!Array.isArray(assets) || assets.length > 0);
  if (!Array.isArray(assets) || assets.length > MAX_RECORDS) issue("Supplied file targets are invalid or exceed the target limit.");
  else if (includeReads) for (const asset of assets) {
    const target = object(asset) ? readPath(asset.path) : null;
    if (!target || !identifier(asset.id)) { issue("Some supplied file targets are invalid or ambiguous."); continue; }
    if (ambiguousTargets.has(target)) continue;
    if (targets.has(target) && targets.get(target) !== asset.id) {
      targets.delete(target); ambiguousTargets.add(target); issue("Some supplied file targets are invalid or ambiguous.");
    } else targets.set(target, asset.id);
  }
  let records;
  if (format === "json") {
    let document;
    try { document = JSON.parse(text.replace(/^\uFEFF/, "")); } catch { issue("Session JSON could not be parsed."); return result; }
    if (Array.isArray(document)) records = document;
    else if (object(document) && !own(document, "sops") && Array.isArray(document.messages)) records = document.messages;
    else { issue("Session document has an unsupported shape."); return result; }
  } else records = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim());
  if (records.length > MAX_RECORDS) issue("Session record limit reached.");
  const calls = new Map(), outputs = new Map(), repos = new Map(), ignoredReads = new Set();
  let currentSession;
  function ignoreRead(entry, sessionId) {
    if (!reference(entry.id) || !reference(sessionId) || /redacted/i.test(entry.id) || /redacted/i.test(sessionId)) return;
    const key = JSON.stringify([sessionId, entry.id]);
    if (calls.get(key)) issue("Some call identities conflict; conflicting calls were excluded.");
    if (!calls.has(key) && calls.size >= MAX_EVENTS) { issue("Session event limit reached."); return; }
    calls.set(key, null);
    if (!ignoredReads.has(key)) { ignoredReads.add(key); result.excludedCalls.push({ sessionId, callId: entry.id }); }
  }
  function call(entry, sessionId, repo, at) {
    let kind, name, tool;
    if (entry.name === "Read" && includeReads) {
      const target = object(entry.input) ? readPath(entry.input.file_path) : null;
      if (!target) issue("Some explicit file read inputs are unsupported.");
      name = target ? targets.get(target) : undefined;
      if (!name) { ignoreRead(entry, sessionId); return; }
      if (/redacted/i.test(String(entry.id)) || /redacted/i.test(String(sessionId)) || /redacted/i.test(String(repo))) {
        issue("Some explicit file reads lack valid attribution."); ignoreRead(entry, sessionId); return;
      }
      kind = "file-read";
    } else if (entry.name === "Skill" && agent === "claude") {
      kind = "skill";
      let input = entry.input;
      if (typeof input === "string") {
        try { input = JSON.parse(input); } catch { issue("Some explicit skill inputs are malformed."); return; }
      }
      if (!object(input) || !identifier(input.skill)) { issue("Some explicit skill names or inputs are unsupported."); return; }
      name = input.skill;
    } else if (typeof entry.name === "string" && entry.name.startsWith("mcp__")) {
      const parts = entry.name.slice(5).split("__");
      if (parts.length !== 2 || !parts.every(identifier)) { issue("Some MCP call names are unsupported."); return; }
      [name, tool] = parts; kind = "mcp";
    } else {
      if (entry.name === "Skill") issue("Explicit skill calls are unsupported for this session agent.");
      return;
    }
    const callId = agent === "claude" ? entry.id : entry.call_id;
    if (!reference(callId) || !reference(sessionId) || !repository(repo) || !at) { issue("Some supported calls lack valid call, session, repository or timestamp attribution."); return; }
    const key = JSON.stringify([sessionId, callId]);
    const event = { kind, name, ...(kind === "mcp" ? { tool } : {}), repo, at, callId, sessionId, resultSeen: false, failed: false };
    if (calls.has(key)) {
      const previous = calls.get(key);
      if (ignoredReads.has(key)) issue("Some call identities conflict; conflicting calls were excluded.");
      if (previous && ["kind", "name", "tool", "repo", "at"].some(field => previous[field] !== event[field])) {
        result.excludedCalls.push({ sessionId, callId });
        calls.set(key, null); issue("Some call identities conflict; conflicting calls were excluded.");
      }
      return;
    }
    if (calls.size >= MAX_EVENTS) { issue("Session event limit reached."); return; }
    calls.set(key, event);
  }
  function output(entry, sessionId, callId) {
    if (!reference(sessionId) || !reference(callId)) { issue("Some result records lack valid call or session attribution."); return; }
    if (own(entry, "is_error") && typeof entry.is_error !== "boolean") issue("Some result error flags are unsupported.");
    const key = JSON.stringify([sessionId, callId]);
    outputs.set(key, { resultSeen: true, failed: entry.is_error === true || outputs.get(key)?.failed === true });
  }
  for (const raw of records.slice(0, MAX_RECORDS)) {
    result.coverage.records++;
    let record = raw;
    if (format === "jsonl") {
      try { record = JSON.parse(raw); } catch { issue("Some session records could not be parsed."); result.coverage.ignoredRecords++; continue; }
    }
    if (!object(record) || own(record, "sops")) { issue("Some session records have an unsupported shape."); result.coverage.ignoredRecords++; continue; }
    if (!own(record, "type") && !own(record, "role") && !object(record.message)) issue("Some session records have an unsupported shape.");
    if (agent === "codex" && record.type === "session_meta") {
      if (!object(record.payload) || !reference(record.payload.id)) { issue("Some session metadata is malformed."); currentSession = undefined; }
      else {
        currentSession = record.payload.id;
        if (own(record.payload, "cwd")) {
          repos.set(currentSession, repository(record.payload.cwd) ? record.payload.cwd : undefined);
          if (!repository(record.payload.cwd)) issue("Some repository context is malformed.");
        }
      }
    }
    const sessionId = own(record, "sessionId") ? record.sessionId : agent === "codex" ? currentSession : undefined;
    if (own(record, "sessionId") && !reference(record.sessionId)) issue("Some session identities are malformed.");
    if (own(record, "cwd")) {
      if (reference(sessionId)) repos.set(sessionId, repository(record.cwd) ? record.cwd : undefined);
      if (!repository(record.cwd)) issue("Some repository context is malformed.");
    }
    if (agent === "codex" && record.type === "turn_context") {
      if (!object(record.payload) || !own(record.payload, "cwd") || !repository(record.payload.cwd) || !reference(sessionId)) {
        issue("Some turn context is malformed.");
        if (reference(sessionId)) repos.set(sessionId, undefined);
      } else repos.set(sessionId, record.payload.cwd);
    }
    const repo = repos.get(sessionId), at = timestamp(record.timestamp);
    let handled = false;
    if (agent === "claude") {
      const message = object(record.message) ? record.message : record;
      const role = record.type === "assistant" ? "assistant" : record.type === "user" ? "user" : message.role;
      if (["assistant", "user"].includes(role)) {
        if (!Array.isArray(message.content)) issue("Some message records have an unsupported shape.");
        else for (const entry of message.content) {
          if (!object(entry)) { issue("Some message entries have an unsupported shape."); continue; }
          if (role === "assistant" && entry.type === "tool_use") {
            if (typeof entry.name !== "string") issue("Some tool call records are malformed.");
            if (entry.name === "Skill" || (entry.name === "Read" && includeReads) || (typeof entry.name === "string" && entry.name.startsWith("mcp__"))) { handled = true; call(entry, sessionId, repo, at); }
          } else if (role === "user" && entry.type === "tool_result") { handled = true; output(entry, sessionId, entry.tool_use_id); }
        }
      }
    } else if (record.type === "response_item") {
      if (!object(record.payload)) issue("Some response records have an unsupported shape.");
      else if (record.payload.type === "function_call") {
        const entry = record.payload;
        if (typeof entry.name !== "string") issue("Some tool call records are malformed.");
        if (entry.name === "Skill" || (typeof entry.name === "string" && entry.name.startsWith("mcp__"))) { handled = true; call(entry, sessionId, repo, at); }
      } else if (record.payload.type === "function_call_output") { handled = true; output(record.payload, sessionId, record.payload.call_id); }
    }
    if (!handled) result.coverage.ignoredRecords++;
  }
  for (const [key, event] of calls) if (event) result.events.push({ ...event, ...outputs.get(key) });
  result.coverage.supportedCalls = result.events.length;
  return result;
}
