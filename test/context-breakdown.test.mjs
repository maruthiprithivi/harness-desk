import test from "node:test";
import assert from "node:assert/strict";
import { contextCategories, parseContextReport, validateContextPercentages } from "../lib/context-breakdown.mjs";

test("categories describe loaded metadata separately from invocation activity", () => {
  assert.deepEqual(contextCategories.map(category => category.id), ["systemPrompt", "tools", "mcp", "skills", "agents", "memory", "messages", "free", "reserved"]);
  assert.equal(contextCategories.find(category => category.id === "messages").label, "Conversation, including your prompts");
  for (const id of ["tools", "mcp", "skills", "agents"]) assert.match(contextCategories.find(category => category.id === id).description, /metadata|definitions/);
});

test("percentages preserve zeros and unknown categories remain absent in a fresh object", () => {
  const input = { skills: 0, messages: 12.5 };
  const result = validateContextPercentages(input);
  assert.deepEqual(result, input);
  assert.notEqual(result, input);
  assert.equal(Object.hasOwn(result, "tools"), false);
  assert.deepEqual(validateContextPercentages(Object.assign(Object.create(null), { free: 100 })), { free: 100 });
});

test("rounding tolerance accepts totals through 100.5 and rejects larger totals", () => {
  assert.deepEqual(validateContextPercentages({ messages: 80.2, free: 20.3 }), { messages: 80.2, free: 20.3 });
  assert.throws(() => validateContextPercentages({ messages: 80.3, free: 20.3 }));
});

test("validation rejects unknown keys, coercion, invalid ranges and nonplain objects", () => {
  for (const value of [null, [], {}, new Date(), new Number(10), { other: 1 }, { free: "10" }, { free: NaN }, { free: Infinity }, { free: -0.1 }, { free: 100.1 }, { free: true }, { free: null }, { free: 10, [Symbol("extra")]: 1 }, Object.create({ free: 10 })]) assert.throws(() => validateContextPercentages(value));
  assert.throws(() => validateContextPercentages(Object.defineProperty({}, "free", { value: 10 })));
  assert.throws(() => validateContextPercentages({ get free() { throw new Error("synthetic-private-marker"); } }), error => !error.message.includes("synthetic-private-marker"));
});

test("exact report summaries accept chart glyphs, ANSI, counts and percentages", () => {
  const report = `Context usage
  model-example · 40k/200k tokens (20%)
  ⛁ \u001b[32mSystem prompt\u001b[0m: 3.3k tokens (1.6%)
  ⛁ System tools: 2,000 tokens (1%)
  ⛁ MCP tools: 1.2k (0.6%)
  ⛁ Skills: 0 tokens (0%)
  ⛁ Custom agents: 0%
  ⛁ Memory files: 400 tokens (0.2%)
  ⛁ Messages: 33.2k tokens (16.6%)
  ⛁ Free space: 75%
  ⛁ Autocompact buffer: 5%`;
  assert.deepEqual(parseContextReport(report), { systemPrompt: 1.6, tools: 1, mcp: 0.6, skills: 0, agents: 0, memory: 0.2, messages: 16.6, free: 75, reserved: 5 });
});

test("manual labels and partial reports do not invent missing categories", () => {
  assert.deepEqual(parseContextReport("Built-in tools: 10%\nInstruction & memory files: 2%\nConversation: 20%\nCompaction reserve: 5%"), { tools: 10, memory: 2, messages: 20, reserved: 5 });
  assert.deepEqual(parseContextReport("Skills: 0%"), { skills: 0 });
  assert.deepEqual(parseContextReport("⛁ ⛁ ⛁   ⛁ Skills: 0%"), { skills: 0 });
  assert.deepEqual(parseContextReport("⛁ ⛁ ⛶ ⛶  model-example · 40k/200k tokens (20%)\n⛁ ⛁ ⛁ ⛶ ⛶  System prompt: 3.3k tokens (1.6%)"), { systemPrompt: 1.6 });
  assert.deepEqual(parseContextReport("Context usage: model-example · 40k/200k tokens (20%)\nMessages: 20%"), { messages: 20 });
});

test("duplicate summary aliases reject instead of summing", () => {
  for (const report of ["Messages: 5%\nMessages: 6%", "System tools: 2%\nBuilt-in tools: 3%", "Memory files: 1%\nInstruction & memory files: 2%"]) assert.throws(() => parseContextReport(report), /duplicate/);
});

test("unknown summary categories and prose prefixes reject generically", () => {
  for (const report of ["Messages: 10%\nOther category: 20%", "Quoted System prompt: 1.6%", "- Messages: 10%", "⛁ Future tools: 10%\nMessages: 2%"]) assert.throws(() => parseContextReport(report), /unsupported/);
});

test("known categories with invalid percentages reject rather than silently disappear", () => {
  for (const line of ["Skills: 50 tokens", "Skills:", "Skills: many%", "Skills: 1e2%", "Skills: (5%", "Skills: 5%)", "Skills: -1%", "Skills: 101%", "Skills: 2% extra", "Skills: 5 tokens 2%"]) assert.throws(() => parseContextReport("Messages: 2%\n" + line));
  assert.throws(() => parseContextReport("Messages: 60%\nFree space: 41%"));
  assert.deepEqual(parseContextReport("Messages: 80.2%\nFree space: 20.3%"), { messages: 80.2, free: 20.3 });
});

test("detail sections cannot fabricate duplicate or unsupported summary totals", () => {
  const report = "MCP tools: 2%\nMemory files: 1%\nMessages: 10%\n\nMCP tools\n  private-tool-name: 1%\n  Messages: 50%\nMemory files\n  /fixture/private-notes.md: 1%";
  assert.deepEqual(parseContextReport(report), { mcp: 2, memory: 1, messages: 10 });
  assert.throws(() => parseContextReport("MCP tools\n private-tool-name: 1%"), /No supported/);
});

test("report limits and control sequences are bounded without returning private text", () => {
  const marker = "synthetic-private-marker";
  for (const value of [null, {}, "", marker, "a".repeat(32001), "Messages: 5%\n" + marker + ": 10%", "Messages: 5%\u0000" + marker]) {
    assert.throws(() => parseContextReport(value), error => !error.message.includes(marker));
  }
  assert.deepEqual(parseContextReport("Messages: 5%\n" + marker + "\n/fixture/private-notes.md"), { messages: 5 });
  assert.deepEqual(parseContextReport("\u001b]8;;https://fixture.invalid\u0007Messages\u001b]8;;\u0007: 5%"), { messages: 5 });
  assert.deepEqual(parseContextReport("Messages: 5%\n" + " ".repeat(32000 - 13)), { messages: 5 });
});
