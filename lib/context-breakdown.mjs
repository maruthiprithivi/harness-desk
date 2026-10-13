import { stripVTControlCharacters } from "node:util";

export const contextCategories = [
  { id: "systemPrompt", label: "System prompt", description: "Provider and harness instructions attributed to the system prompt in this report." },
  { id: "tools", label: "Built-in tools", description: "Reported space for built-in tool definitions and schemas. This is metadata, not invocation activity." },
  { id: "mcp", label: "MCP tools", description: "Reported space for MCP tool definitions and schemas. This is metadata, not a count of tool calls." },
  { id: "skills", label: "Skills", description: "Reported skill metadata or instructions. Their presence does not establish that a skill was invoked." },
  { id: "agents", label: "Custom agents", description: "Reported custom agent definitions. Their presence does not establish that an agent ran." },
  { id: "memory", label: "Instruction & memory files", description: "Instruction and memory file content attributed to this category by the harness." },
  { id: "messages", label: "Conversation, including your prompts", description: "Conversation content attributed to this category by the harness, including your prompts and any retained replies or tool activity." },
  { id: "free", label: "Free space", description: "Context capacity reported as available." },
  { id: "reserved", label: "Compaction reserve", description: "Context capacity reserved for automatic compaction." }
];

const categoryIds = new Set(contextCategories.map(category => category.id));
const labels = new Map([
  ["System prompt", "systemPrompt"], ["System tools", "tools"], ["Built-in tools", "tools"],
  ["MCP tools", "mcp"], ["Skills", "skills"], ["Custom agents", "agents"],
  ["Memory files", "memory"], ["Instruction & memory files", "memory"],
  ["Messages", "messages"], ["Conversation", "messages"],
  ["Free space", "free"], ["Autocompact buffer", "reserved"], ["Compaction reserve", "reserved"]
]);

export function validateContextPercentages(value) {
  try {
    if (value === null || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error();
    const keys = Reflect.ownKeys(value), result = {};
    if (!keys.length) throw new Error();
    let total = 0;
    for (const key of keys) {
      if (!categoryIds.has(key)) throw new Error();
      const property = Object.getOwnPropertyDescriptor(value, key);
      if (!property || !Object.hasOwn(property, "value") || !property.enumerable) throw new Error();
      const percent = property.value;
      if (typeof percent !== "number" || !Number.isFinite(percent) || percent < 0 || percent > 100) throw new Error();
      result[key] = percent;
      total += percent;
    }
    if (total > 100.5) throw new Error();
    return result;
  } catch {
    throw new Error("Context percentages require known categories with numeric values from 0 to 100, totaling at most 100.5.");
  }
}

const number = "[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)";
const count = "(?:\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?)[kKmM]?";
const percentage = new RegExp(`^(?:${count}\\s*(?:tokens?)?\\s*)?\\((${number})\\s*%\\)$|^(${number})\\s*%$`);
const percentageAnywhere = new RegExp(`${number}\\s*%`);
const aggregate = new RegExp(`${count}\\s*/\\s*${count}\\s+tokens?\\b`);

export function parseContextReport(report) {
  if (typeof report !== "string" || report.length > 32000) throw new Error("Context report must be text of at most 32000 characters.");
  const text = stripVTControlCharacters(report);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new Error("Context report contains unsupported control characters.");
  const result = {};
  // shortcut: exact English summary lines only; enter percentages manually for other report formats.
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^(?:[⛀⛁⛂⛃⛶▪●○■□▣▦▧▨▩█▓▒░]+[ \t]+)+/, "");
    // Bare category headings begin detail sections, whose entries are not summary totals.
    if (labels.has(line)) break;
    const summary = /^([^:]+):\s*(.*?)\s*$/.exec(line);
    if (!summary) continue;
    const id = labels.get(summary[1]);
    if (!id) {
      if (percentageAnywhere.test(summary[2]) && !aggregate.test(summary[2])) throw new Error("Context report contains an unsupported summary category.");
      continue;
    }
    const match = percentage.exec(summary[2]);
    if (!match) throw new Error("Context report contains an unsupported category percentage.");
    if (Object.hasOwn(result, id)) throw new Error("Context report contains duplicate summary categories.");
    result[id] = Number(match[1] ?? match[2]);
  }
  if (!Object.keys(result).length) throw new Error("No supported context summary was found. Enter percentages manually for other report formats.");
  return validateContextPercentages(result);
}
