import { randomUUID } from 'node:crypto';
import { redact } from './analysis.mjs';

const SOURCE = 'user-designed comparison; manually supplied outcomes';
const ASSESSMENT_SOURCE = 'user supplied sampled comparison; causal attribution unverified';
const LIMITS = { startupTokens: 1e7, totalTokens: 1e9, seconds: 86400, corrections: 1e5, compactions: 1e5, costUSD: 1e6 };
const COUNTS = new Set(['startupTokens', 'totalTokens', 'corrections', 'compactions']);
const CONDITIONS = ['model', 'agentVersion', 'environment', 'counter'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Supply an object');
  return value;
}
function text(value, name, limit, optional = false) {
  if (optional && (value === undefined || value === null)) return '';
  if (typeof value !== 'string' || value.length > limit || (!optional && !value.trim())) throw new Error('Supply ' + name + ' within ' + limit + ' characters');
  return redact(value.trim());
}
function rejectInventorySource(body) {
  if ('inventorySource' in body) throw new Error('Inventory source is derived from the last scan and cannot be supplied by a client');
}
function metadata(value, limit) {
  return typeof value === 'string' && value.trim() ? redact(value).slice(0, limit) : null;
}
function timestamp(value) {
  return typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value)) ? metadata(value, 64) : null;
}
function inventorySnapshot(inventory, assetIds) {
  // The snapshot refers only to the last inventory scan.
  return {
    scannedAt: timestamp(inventory?.scannedAt), partial: inventory?.coverage?.partial === true,
    items: assetIds.map(id => {
      const item = inventory.items.find(item => item.id === id);
      return {
        id: metadata(item.id, 160), name: metadata(item.name, 256), path: metadata(item.path, 4096),
        agent: metadata(item.agent, 80), repo: metadata(item.repo, 4096) ?? '', type: metadata(item.type, 80),
        bytes: Number.isSafeInteger(item.bytes) && item.bytes >= 0 ? item.bytes : null,
        modifiedAt: timestamp(item.modifiedAt),
        contentHash: typeof item.contentHash === 'string' && /^[a-f0-9]{64}$/i.test(item.contentHash) ? item.contentHash : null,
      };
    }),
  };
}
function at(now) { return new Date(now).toISOString(); }
function open(record) {
  if (!['baseline', 'candidate'].includes(record.status)) throw new Error('This comparison is closed');
}

function improvementScope(body, { agents, repos, inventory }) {
  object(body); rejectInventorySource(body);
  if (Object.hasOwn(body, 'expectedInventoryScan') && (typeof body.expectedInventoryScan !== 'string' || !body.expectedInventoryScan.trim() || body.expectedInventoryScan.length > 64 || body.expectedInventoryScan !== inventory?.scannedAt)) throw new Error('Inventory scan changed. Find task matches again before creating this comparison.');
  if (typeof body.agent !== 'string' || !agents.includes(body.agent)) throw new Error('Choose a known agent');
  const repo = body.repo ?? '';
  if (typeof repo !== 'string' || (repo && !repos.includes(repo))) throw new Error('Choose a scanned repository or global scope');
  const assetIds = body.assetIds ?? [];
  if (!Array.isArray(assetIds) || assetIds.length > 10 || new Set(assetIds).size !== assetIds.length) throw new Error('Choose up to ten distinct assets');
  for (const id of assetIds) {
    const item = inventory?.items?.find(item => item.id === id);
    if (typeof id !== 'string' || !item || ![body.agent, 'shared', 'model-gateway'].includes(item.agent) || (item.repo && item.repo !== repo)) throw new Error('Choose current assets in this agent and repository scope');
  }
  return { repo, assetIds: [...assetIds] };
}

function improvementFields(body, context) {
  const { repo, assetIds } = improvementScope(body, context);
  const variable = body.variable ?? 'configuration';
  if (!['configuration', 'model', 'workflow'].includes(variable)) throw new Error('Choose configuration, model or workflow');
  if (!Array.isArray(body.tasks) || body.tasks.length < 1 || body.tasks.length > 5) throw new Error('Supply one to five fixed benchmark tasks');
  const tasks = body.tasks.map(task => {
    object(task);
    return { label: text(task.label, 'task label', 120), prompt: text(task.prompt, 'task prompt', 4000) };
  });
  return {
    agent: body.agent, repo,
    title: text(body.title, 'title', 120), change: text(body.change, 'candidate change', 2000),
    expectedBenefit: text(body.expectedBenefit, 'expected benefit', 1000, true), rollback: text(body.rollback, 'rollback plan', 2000),
    variable, tasks, assetIds,
  };
}

export function createImprovement(body, context, now = Date.now()) {
  const fields = improvementFields(body, context);
  return {
    ...fields, id: randomUUID(), tasks: fields.tasks.map(task => ({id: randomUUID(), ...task})),
    ...(fields.assetIds.length ? { inventorySource: inventorySnapshot(context.inventory, fields.assetIds) } : {}), createdAt: at(now), updatedAt: at(now),
    status: 'baseline', runs: [], decision: null, source: SOURCE,
  };
}

function exactKeys(value, keys, name) {
  object(value);
  if (Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))) throw new Error('Supply only the required ' + name + ' fields');
}

function suggestionText(value, name, limit) {
  const result = text(value, name, limit);
  if (result.length > limit) throw new Error('Supply ' + name + ' within ' + limit + ' characters after redaction');
  return result;
}

export function previewImprovementSuggestion(body, context) {
  object(body);
  if (Object.keys(body).some(key => !['suggestion','requestId','agent','repo','assetIds','expectedInventoryScan','originalTask','fixedVariable'].includes(key))) throw new Error('Suggestion preview accepts only its captured request and scope');
  if (typeof body.requestId !== 'string' || !(UUID.test(body.requestId) || /^[a-f0-9]{16,64}$/i.test(body.requestId))) throw new Error('Supply a bounded UUID or hexadecimal request ID');
  if (typeof body.repo !== 'string' || !Array.isArray(body.assetIds)) throw new Error('Supply the captured repository scope and selected asset list');
  const scope = improvementScope(body, context);
  if (scope.assetIds.length && !Object.hasOwn(body, 'expectedInventoryScan')) throw new Error('Capture the current inventory scan for selected assets');
  if (Object.hasOwn(body, 'fixedVariable') && body.fixedVariable !== 'workflow') throw new Error('The fixed comparison variable must be workflow');
  const original = body.originalTask;
  if (Object.hasOwn(body, 'originalTask')) {
    exactKeys(original, ['label','prompt'], 'original task');
    for (const [key, limit] of [['label',120],['prompt',4000]]) {
      suggestionText(original[key], 'original task ' + key, limit);
      if (redact(original[key]) !== original[key]) throw new Error('Remove sensitive details from the original task before requesting a suggestion');
    }
  }
  if (typeof body.suggestion !== 'string' || !body.suggestion.trim() || body.suggestion.length > 14000) throw new Error('Supply one JSON suggestion within 14000 characters');
  const supplied = body.suggestion.trim(), fence = /^```json[ \t]*\r?\n([\s\S]*)\r?\n```$/.exec(supplied);
  let reply;
  try { reply = JSON.parse(fence ? fence[1] : supplied); } catch { throw new Error('Paste one JSON object or one enclosing json code fence without surrounding prose'); }
  object(reply);
  if (reply.requestId !== body.requestId) throw new Error('Suggestion request does not match this captured draft');
  if (reply.status === 'needsDetails') {
    exactKeys(reply, ['requestId','status','questions'], 'needsDetails suggestion');
    if (!Array.isArray(reply.questions) || reply.questions.length < 1 || reply.questions.length > 5) throw new Error('Supply one to five clarification questions');
    return { requestId: body.requestId, status: 'needsDetails', questions: reply.questions.map(question => suggestionText(question, 'clarification question', 500)) };
  }
  if (reply.status !== 'ready') throw new Error('Choose ready or needsDetails suggestion status');
  exactKeys(reply, ['requestId','status','title','change','rollback','variable','task'], 'ready suggestion');
  exactKeys(reply.task, ['label','prompt','qualityCheck'], 'suggested task');
  if (!['configuration','model','workflow'].includes(reply.variable)) throw new Error('Choose configuration, model or workflow');
  const prompt = suggestionText(reply.task.prompt, 'task prompt', 4000);
  if (original && (reply.task.label !== original.label || reply.task.prompt !== original.prompt)) throw new Error('Keep the original task label and prompt exactly unchanged');
  if (body.fixedVariable && reply.variable !== body.fixedVariable) throw new Error('Keep workflow as the fixed comparison variable');
  const qualityCheck = suggestionText(reply.task.qualityCheck, 'quality check', 2000);
  const combined = reply.task.prompt + '\n\nQuality check:\n' + reply.task.qualityCheck;
  const fields = improvementFields({...body, ...reply, tasks: [{label: reply.task.label, prompt: combined}]}, context);
  for (const [key, limit] of [['title',120],['change',2000],['rollback',2000]]) suggestionText(fields[key], key, limit);
  suggestionText(fields.tasks[0].label, 'task label', 120);
  suggestionText(fields.tasks[0].prompt, 'combined task prompt', 4000);
  if ((original ? original.prompt : prompt).length + '\n\nQuality check:\n'.length + qualityCheck.length > 4000) throw new Error('Supply combined task prompt within 4000 characters after redaction');
  return {
    requestId: body.requestId, status: 'ready', title: fields.title, change: fields.change, rollback: fields.rollback, variable: fields.variable,
    task: { label: original ? original.label : fields.tasks[0].label, prompt: original ? original.prompt : prompt, qualityCheck },
  };
}

function runInput(record, body) {
  object(body); rejectInventorySource(body);
  if (!record.tasks.some(task => task.id === body.taskId)) throw new Error('Choose a benchmark task');
  if (typeof body.passed !== 'boolean') throw new Error('Record whether the task passed verification');
  const input = { taskId: body.taskId, passed: body.passed, note: text(body.note, 'verification note', 2000) };
  for (const key of CONDITIONS) input[key] = text(body[key], key, 160, true);
  for (const [key, limit] of Object.entries(LIMITS)) {
    const value = body[key];
    if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) input[key] = null;
    else {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > limit || (COUNTS.has(key) && !Number.isSafeInteger(value))) throw new Error('Supply a valid numeric ' + key + ' or leave it unknown');
      input[key] = value;
    }
  }
  if (Object.keys(LIMITS).every(key => input[key] === null)) throw new Error('Supply at least one measured metric');
  if (body.correctsRunId !== undefined || body.correctionReason !== undefined) {
    if (typeof body.correctsRunId !== 'string' || !UUID.test(body.correctsRunId)) throw new Error('Supply a UUID correction target and correction reason together');
    input.correctsRunId = body.correctsRunId;
    input.correctionReason = text(body.correctionReason, 'correction reason', 2000);
  }
  return input;
}

export function activeImprovementRuns(record) {
  const superseded = new Set(record.runs.map(run => run.correctsRunId));
  return record.runs.filter(run => !superseded.has(run.id));
}

export function recordImprovementRun(record, body, now = Date.now()) {
  open(record);
  const input = runInput(record, body);
  if (body.runId !== undefined && (typeof body.runId !== 'string' || !UUID.test(body.runId))) throw new Error('Supply a UUID run ID');
  const existing = record.runs.find(run => run.id === body.runId);
  if (existing) {
    const { id, phase, at: recordedAt, ...fields } = existing;
    if ((body.phase !== undefined && body.phase !== phase) || JSON.stringify(fields) !== JSON.stringify(input)) throw new Error('This run ID already has different outcomes');
    return { ...record, runs: [...record.runs] };
  }
  const phase = record.status === 'baseline' ? 'before' : 'after';
  if (body.phase !== undefined && body.phase !== phase) throw new Error('Runs must match the current comparison phase');
  const activeRuns = activeImprovementRuns(record);
  if (input.correctsRunId) {
    if (input.correctsRunId === body.runId) throw new Error('A correction must use a new run ID');
    const target = record.runs.find(run => run.id === input.correctsRunId);
    if (!target || !activeRuns.includes(target)) throw new Error('Choose an existing active run to correct');
    if (target.taskId !== input.taskId) throw new Error('A correction must use the same benchmark task');
    if (target.phase !== phase) throw new Error('Corrections must match the current comparison phase');
  }
  if (record.runs.length >= 60 || (!input.correctsRunId && activeRuns.filter(run => run.phase === phase && run.taskId === body.taskId).length >= 10)) throw new Error('Comparison run limit reached');
  return { ...record, updatedAt: at(now), runs: [...record.runs, { id: body.runId ?? randomUUID(), phase, at: at(now), ...input }] };
}

export function prepareImprovementCandidate(record, now = Date.now()) {
  open(record);
  if (record.status !== 'baseline') throw new Error('The candidate phase has already started');
  const assessment = assessImprovement(record);
  if (!assessment.baselineEligible) throw new Error('Complete the baseline before applying a change: ' + assessment.baselineIssues.join('; '));
  return { ...record, status: 'candidate', updatedAt: at(now) };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function summary(runs) {
  return { runs: runs.length, passed: runs.filter(run => run.passed).length, metrics: Object.fromEntries(Object.keys(LIMITS).map(key => [key, runs.length && runs.every(run => typeof run[key] === 'number') ? median(runs.map(run => run[key])) : null])) };
}
function comparable(before, after, variable) {
  if ([...before, ...after].some(run => CONDITIONS.some(key => !run[key] || /^(?:unknown|not sure)$/i.test(run[key]) || run[key].includes('[REDACTED')))) return false;
  for (const phase of [before, after]) {
    if (phase.some(run => CONDITIONS.some(key => run[key] !== phase[0][key]))) return false;
  }
  return CONDITIONS.every(key => (key === 'model' && variable === 'model') || before[0][key] === after[0][key]);
}

export function assessImprovement(record) {
  let baselineReady = true, afterReady = true, conditionsMatch = true, baselineConditionsMissing = false, failed = false, increased = false, decreased = false, known = 0, unknown = false, totalCostUnknown = false;
  const activeRuns = activeImprovementRuns(record), baselineIssues = [];
  const tasks = record.tasks.map(task => {
    const beforeRuns = activeRuns.filter(run => run.taskId === task.id && run.phase === 'before');
    const afterRuns = activeRuns.filter(run => run.taskId === task.id && run.phase === 'after');
    baselineReady &&= beforeRuns.length >= 3;
    afterReady &&= afterRuns.length >= 3;
    if(beforeRuns.length) baselineConditionsMissing ||= !comparable(beforeRuns,beforeRuns,record.variable);
    if (beforeRuns.length && afterRuns.length) conditionsMatch &&= comparable(beforeRuns, afterRuns, record.variable);
    failed ||= afterRuns.some(run => !run.passed);
    const before = summary(beforeRuns), after = summary(afterRuns);
    if (beforeRuns.length < 3) baselineIssues.push(task.label + ': record at least three baseline runs for every task');
    if (!beforeRuns.length || !comparable(beforeRuns, beforeRuns, record.variable)) baselineIssues.push(task.label + ': supply all four known, stable baseline condition labels');
    if (!Object.values(before.metrics).some(value => value !== null)) baselineIssues.push(task.label + ': measure at least one metric across all baseline runs');
    const deltas = Object.fromEntries(Object.keys(LIMITS).map(key => {
      const a = before.metrics[key], b = after.metrics[key];
      if (a === null || b === null) {
        unknown = true;
        if (key === 'totalTokens' || key === 'costUSD') totalCostUnknown = true;
        return [key, null];
      }
      known++; increased ||= b > a; decreased ||= b < a;
      return [key, { before: a, after: b, reduction: a - b, percent: a === 0 ? null : (a - b) / a * 100 }];
    }));
    return { id: task.id, label: task.label, before, after, deltas };
  });
  const ready = baselineReady && afterReady;
  const warnings = ['Outcomes and conditions are manually supplied samples; this comparison does not establish causality.'];
  if (record.runs.some(run => run.correctsRunId)) warnings.push('Corrected runs are preserved in the history; only their active replacements contribute to this assessment.');
  if(baselineConditionsMissing) warnings.push('Baseline conditions are missing or vary. These runs may not support a later comparison; check the recorded conditions before applying a change.');
  if (unknown) warnings.push('Some metrics are unknown; missing measurements are not zero.');
  if (totalCostUnknown) warnings.push('Total tokens or monetary cost are unmeasured; lower startup context does not establish lower total cost.');
  if (ready && !conditionsMatch) warnings.push('Conditions are missing, varied within a phase, or changed beyond the selected variable.');
  if (failed) warnings.push('At least one candidate task failed verification.');
  if (increased) warnings.push('At least one measured task metric increased; review the regression before deciding.');
  const verdict = !baselineReady ? 'collect-baseline' : !afterReady ? 'collect-after' : !conditionsMatch ? 'incomparable' : failed ? 'regression' : increased ? (decreased ? 'tradeoff' : 'regression') : !known ? 'insufficient-metrics' : decreased ? 'improved' : 'no-change';
  return { verdict, ready, baselineEligible: baselineIssues.length === 0, baselineIssues, tasks, warnings, source: ASSESSMENT_SOURCE };
}

export function decideImprovement(record, body, now = Date.now()) {
  open(record);
  object(body); rejectInventorySource(body);
  if (!['keep', 'restored'].includes(body.decision)) throw new Error('Choose keep or restored');
  const note = text(body.note, 'decision note', 2000);
  if (record.status !== 'candidate') throw new Error('Start the candidate phase before recording a decision');
  if (body.decision === 'keep') {
    const assessment = assessImprovement(record);
    if (!assessment.ready || assessment.verdict === 'incomparable' || !assessment.tasks.some(task => Object.values(task.deltas).some(value => value !== null))) throw new Error('Complete a comparable benchmark with at least one shared measured metric before recording a keep decision');
  }
  return { ...record, status: 'closed', updatedAt: at(now), decision: { decision: body.decision, note, at: at(now) } };
}
