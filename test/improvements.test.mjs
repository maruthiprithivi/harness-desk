import test from 'node:test';
import assert from 'node:assert/strict';
import { createImprovement, previewImprovementSuggestion, recordImprovementRun, activeImprovementRuns, prepareImprovementCandidate, decideImprovement, assessImprovement } from '../lib/improvements.mjs';

const context = {
  agents: ['codex', 'claude'], repos: ['/fixture/repo'], inventory: { items: [
    { id: 'global', agent: 'codex', repo: '' }, { id: 'shared', agent: 'shared', repo: '/fixture/repo' },
    { id: 'gateway', agent: 'model-gateway', repo: '' }, { id: 'other-agent', agent: 'claude', repo: '' },
    { id: 'other-repo', agent: 'codex', repo: '/fixture/other' },
  ] },
};
const design = { agent: 'codex', repo: '/fixture/repo', title: 'Reduce startup context', change: 'Invoke the procedure when needed', rollback: 'Restore the prior configuration', tasks: [{ label: 'Fix a fixture bug', prompt: 'Fix the bug and verify behavior' }] };
const conditions = { model: 'fixture-model', agentVersion: '1', environment: 'fixture environment', counter: 'fixture counter' };
function create(extra = {}) { return createImprovement({ ...design, ...extra }, context, 0); }
const suggestionId = '0123456789abcdef';
const readySuggestion = { requestId: suggestionId, status: 'ready', title: 'Synthetic comparison', change: 'Try the scoped procedure', rollback: 'Restore the prior procedure', variable: 'configuration', task: { label: 'Fixed task', prompt: 'Verify the synthetic result', qualityCheck: 'Run the fixture assertions' } };
function suggestion(reply = readySuggestion, patch = {}, scope = context) {
  return previewImprovementSuggestion({ suggestion: JSON.stringify(reply), requestId: suggestionId, agent: 'codex', repo: '/fixture/repo', assetIds: [], ...patch }, scope);
}
function run(record, extra = {}) {
  return recordImprovementRun(record, { taskId: record.tasks[0].id, passed: true, note: 'Fixture assertions pass', ...conditions, startupTokens: 100, ...extra }, 1000);
}
function comparison(before = {}, after = {}, extra = {}) {
  let record = create(extra);
  for (let i = 0; i < 3; i++) record = run(record, before);
  record = prepareImprovementCandidate(record, 2000);
  for (let i = 0; i < 3; i++) record = run(record, after);
  return record;
}

test('missing or changing baseline conditions warn before collecting candidate runs', () => {
  const complete = run(create());
  assert.equal(assessImprovement(complete).warnings.some(text=>text.startsWith('Baseline conditions')),false);
  for(const record of [run(create(),{counter:''}),run(complete,{agentVersion:'2'})]) {
    const assessment=assessImprovement(record);
    assert.equal(assessment.verdict,'collect-baseline');
    assert.match(assessment.warnings.join(' '),/Baseline conditions are missing or vary/);
  }
});

test('suggestion previews validate raw or fenced JSON without emitting experiment identity', () => {
  const snapshot = structuredClone(context), reply = structuredClone(readySuggestion);
  assert.deepEqual(suggestion(), readySuggestion);
  assert.deepEqual(suggestion(reply, { suggestion: '\n```json\n' + JSON.stringify(reply) + '\n```\n' }), readySuggestion);
  assert.deepEqual(context, snapshot);assert.deepEqual(reply, readySuggestion);
  const result = suggestion({ ...reply, title: '  Synthetic comparison  ', change: ['to','ken'].join('') + '=fixture-sensitive-value' });
  assert.equal(result.title, 'Synthetic comparison');assert.match(result.change, /REDACTED/);
  for (const key of ['id','agent','repo','assetIds','inventorySource','tasks','runs','assessment','expectedBenefit','createdAt']) assert.equal(Object.hasOwn(result, key), false);
});

test('suggestion protocol rejects prose, malformed objects, unsupported types and extra fields', () => {
  for (const supplied of ['', 'x'.repeat(14001), null, {}, '[]', 'null', '"text"', '{', JSON.stringify(readySuggestion) + '{}', 'Preface\n' + JSON.stringify(readySuggestion), '```\n' + JSON.stringify(readySuggestion) + '\n```', '```json\n' + JSON.stringify(readySuggestion) + '\n```\nPostscript']) assert.throws(() => suggestion(readySuggestion, { suggestion: supplied }));
  for (const patch of [{ requestId: '' }, { requestId: 'x'.repeat(65) }, { requestId: null }, { requestId: 'g'.repeat(32) }, { repo: null }, { assetIds: null }, { fixedVariable: 'configuration' }, { expectedBenefit: 'Claimed benefit' }, { originalTask: { label: 'Fixed task', prompt: 'Task', extra: true } }]) assert.throws(() => suggestion(readySuggestion, patch));
  for (const patch of [{ requestId: 'fedcba9876543210' }, { status: 'unknown' }, { id: 'unexpected' }, { title: '' }, { title: 'x'.repeat(121) }, { change: 'x'.repeat(2001) }, { rollback: 'x'.repeat(2001) }, { variable: null }, { variable: 'automatic' }, { task: [] }, { task: { ...readySuggestion.task, extra: true } }, { task: { ...readySuggestion.task, label: 'x'.repeat(121) } }, { task: { ...readySuggestion.task, prompt: 123 } }, { task: { ...readySuggestion.task, prompt: '' } }, { task: { ...readySuggestion.task, qualityCheck: false } }, { task: { ...readySuggestion.task, qualityCheck: '' } }]) assert.throws(() => suggestion({ ...readySuggestion, ...patch }));
  const { rollback, ...missing } = readySuggestion;assert.throws(() => suggestion(missing));
});

test('needsDetails validates captured scope and stamp without requiring invented design fields', () => {
  const reply = { requestId: suggestionId, status: 'needsDetails', questions: ['Which fixed result should pass?'] }, scannedAt = '2020-01-01T00:00:00.000Z', scoped = { ...context, inventory: { ...context.inventory, scannedAt } };
  assert.deepEqual(suggestion(reply), reply);
  assert.deepEqual(suggestion(reply, { assetIds: ['global','shared','gateway'], expectedInventoryScan: scannedAt }, scoped), reply);
  for (const patch of [{ agent: 'missing' }, { repo: '/fixture/missing' }, { assetIds: ['other-agent'] }, { assetIds: ['other-repo'] }, { assetIds: ['missing'] }, { assetIds: ['global','global'] }, { assetIds: ['global'] }, { expectedInventoryScan: 'stale' }, { expectedInventoryScan: null }]) assert.throws(() => suggestion(reply, patch, scoped));
  for (const questions of [[], Array(6).fill('Question'), [''], ['x'.repeat(501)], [null], 'Question']) assert.throws(() => suggestion({ ...reply, questions }));
  assert.throws(() => suggestion({ ...reply, title: 'Invented comparison' }));
});

test('suggestions preserve bridge task bytes and fixed workflow while bounding combined task text', () => {
  const originalTask = { label: ' Fixed task ', prompt: '\nVerify the synthetic result \n' }, reply = { ...readySuggestion, variable: 'workflow', task: { ...readySuggestion.task, ...originalTask } };
  const result = suggestion(reply, { originalTask, fixedVariable: 'workflow' });assert.equal(result.task.label, originalTask.label);assert.equal(result.task.prompt, originalTask.prompt);
  for (const patch of [{ label: originalTask.label.trim() }, { prompt: originalTask.prompt.trim() }]) assert.throws(() => suggestion({ ...reply, task: { ...reply.task, ...patch } }, { originalTask }));
  assert.throws(() => suggestion(readySuggestion, { fixedVariable: 'workflow' }));
  const sensitive = ['to','ken'].join('') + '=fixture-sensitive-value';
  for (const key of ['label','prompt']) { const original = { ...originalTask, [key]: sensitive };assert.throws(() => suggestion({ ...reply, task: { ...reply.task, ...original } }, { originalTask: original }), /Remove sensitive details/); }
  const separator = '\n\nQuality check:\n', prompt = 'x'.repeat(4000 - separator.length - 1);
  assert.equal(suggestion({ ...readySuggestion, task: { label: 'Fixed', prompt, qualityCheck: 'y' } }).task.prompt.length, prompt.length);
  assert.throws(() => suggestion({ ...readySuggestion, task: { label: 'Fixed', prompt: prompt + 'x', qualityCheck: 'y' } }), /4000 characters/);
  assert.equal(suggestion({ ...readySuggestion, task: { label: 'Fixed', prompt: 'x', qualityCheck: 'y'.repeat(2000) } }).task.qualityCheck.length, 2000);
  assert.throws(() => suggestion({ ...readySuggestion, task: { label: 'Fixed', prompt: 'x', qualityCheck: 'y'.repeat(2001) } }), /2000 characters/);
});

test('suggestion output remains bounded when redaction expands short sensitive values', () => {
  const sensitive = ['to','ken'].join('') + '=x';
  for (const [key, limit] of [['title',120],['change',2000],['rollback',2000]]) assert.throws(() => suggestion({ ...readySuggestion, [key]: 'a'.repeat(limit - sensitive.length - 1) + ' ' + sensitive }), /characters/);
  for (const [key, limit] of [['label',120],['qualityCheck',2000]]) assert.throws(() => suggestion({ ...readySuggestion, task: { ...readySuggestion.task, [key]: 'a'.repeat(limit - sensitive.length - 1) + ' ' + sensitive } }), /characters/);
  assert.throws(() => suggestion({ requestId: suggestionId, status: 'needsDetails', questions: ['a'.repeat(500 - sensitive.length - 1) + ' ' + sensitive] }), /after redaction/);
  const prompt = 'a'.repeat(4000 - '\n\nQuality check:\n'.length - sensitive.length - 1);
  assert.throws(() => suggestion({ ...readySuggestion, task: { label: 'Fixed', prompt: prompt + ' ', qualityCheck: sensitive } }), /4000 characters/);
});

test('creates a fixed redacted design with stable IDs and scoped assets', () => {
  const original = { ...design, change: 'token=fixture-sensitive-value', assetIds: ['global', 'shared', 'gateway'] };
  const record = createImprovement(original, context, 0);
  assert.equal(record.status, 'baseline');
  assert.equal(record.createdAt, '1970-01-01T00:00:00.000Z');
  assert.match(record.change, /REDACTED/);
  assert.equal(original.change, 'token=fixture-sensitive-value');
  assert.equal(run(record).tasks[0].id, record.tasks[0].id);
  assert.throws(() => create({ agent: 'missing' }), /known agent/);
  assert.throws(() => create({ repo: '/fixture/missing' }), /scanned repository/);
  for (const assetIds of [['missing'], ['other-agent'], ['other-repo'], ['global', 'global']]) assert.throws(() => create({ assetIds }));
  assert.throws(() => create({ repo: '', assetIds: ['shared'] }), /scope/);
});

test('requires bounded nonempty design and tasks', () => {
  for (const extra of [{ title: '' }, { title: 'x'.repeat(121) }, { change: '' }, { rollback: '' }, { tasks: [] }, { tasks: Array(6).fill(design.tasks[0]) }, { tasks: [{ label: 'x', prompt: '' }] }, { variable: 'other' }]) assert.throws(() => create(extra));
  assert.throws(() => create({ assetIds: Array.from({ length: 11 }, (_, i) => String(i)) }));
});

test('optional expected scan is an exact bounded create precondition, not stored provenance', () => {
  const scannedAt = '2020-01-01T00:00:00.000Z';
  const scanned = { ...context, inventory: { ...context.inventory, scannedAt } };
  const make = patch => createImprovement({ ...design, assetIds: ['global'], ...patch }, scanned, 0);
  const legacy = make({});
  assert.equal(legacy.inventorySource.scannedAt, scannedAt);
  assert.equal(Object.hasOwn(legacy, 'expectedInventoryScan'), false);
  const exact = make({ expectedInventoryScan: scannedAt });
  assert.equal(exact.inventorySource.scannedAt, scannedAt);
  assert.equal(Object.hasOwn(exact, 'expectedInventoryScan'), false);
  for (const expectedInventoryScan of [undefined, null, false, 1, {}, [], '', ' ', 'x'.repeat(65), '2020-01-02T00:00:00.000Z', scannedAt + ' ']) {
    assert.throws(() => make({ expectedInventoryScan }), { message: 'Inventory scan changed. Find task matches again before creating this comparison.' });
  }
  assert.throws(() => create({ expectedInventoryScan: scannedAt }), /Inventory scan changed/);
  const limit = 'x'.repeat(64);
  const bounded = createImprovement({ ...design, expectedInventoryScan: limit }, { ...context, inventory: { ...context.inventory, scannedAt: limit } }, 0);
  assert.equal(Object.hasOwn(bounded, 'expectedInventoryScan'), false);
  assert.equal(scanned.inventory.scannedAt, scannedAt);
});

test('freezes baseline at the candidate transition and requires three runs per task', () => {
  let record = create({ tasks: [...design.tasks, { label: 'Second task', prompt: 'Verify the second fixture' }] });
  assert.throws(() => prepareImprovementCandidate(record), /three baseline/);
  for (let i = 0; i < 3; i++) record = run(record);
  assert.throws(() => prepareImprovementCandidate(record), /every task/);
  for (let i = 0; i < 3; i++) record = run(record, { taskId: record.tasks[1].id });
  const candidate = prepareImprovementCandidate(record, 2000);
  assert.equal(record.status, 'baseline');
  assert.equal(candidate.status, 'candidate');
  assert.throws(() => run(candidate, { phase: 'before' }), /phase/);
  assert.throws(() => prepareImprovementCandidate(candidate), /already/);
  assert.equal(run(candidate).runs.at(-1).phase, 'after');
});

test('accepts missing metrics as unknown and rejects invalid numeric values', () => {
  const record = create();
  assert.equal(run(record, { totalTokens: ' ', costUSD: null }).runs[0].totalTokens, null);
  for (const startupTokens of [NaN, Infinity, -1, '100', 0.5, 1e7 + 1]) assert.throws(() => run(record, { startupTokens }));
  for (const extra of [{ seconds: 86401 }, { costUSD: 1e6 + 1 }, { totalTokens: 1e9 + 1 }, { corrections: 1e5 + 1 }, { compactions: 0.1 }, { startupTokens: null }, { passed: 'true' }, { note: '' }, { taskId: 'missing' }]) assert.throws(() => run(record, extra));
  assert.equal(run(record, { startupTokens: 0, costUSD: 0, seconds: 0 }).runs[0].seconds, 0);
});

test('client UUID deduplicates retries and rejects conflicting outcomes', () => {
  const runId = '11111111-1111-4111-8111-111111111111';
  const record = run(create(), { runId, at: '2099-01-01' });
  const retried = run(record, { runId });
  assert.equal(retried.runs.length, 1);
  assert.equal(retried.runs[0].at, '1970-01-01T00:00:01.000Z');
  assert.throws(() => run(record, { runId, startupTokens: 90 }), /different outcomes/);
  assert.throws(() => run(record, { runId, phase: 'after' }), /different outcomes/);
  assert.throws(() => run(record, { runId: 'bad' }), /UUID/);
});

test('enforces per-task and record run limits without mutating the record', () => {
  let record = create();
  for (let i = 0; i < 10; i++) record = run(record);
  assert.throws(() => run(record), /limit/);
  const complete = comparison();
  assert.throws(() => run({ ...complete, runs: Array(60).fill(complete.runs[0]) }), /limit/);
  assert.equal(complete.runs.length, 6);
});

test('uses per-task medians, zero-aware percentages, and warns when total cost is unknown', () => {
  let record = create();
  for (const startupTokens of [0, 0, 900]) record = run(record, { startupTokens });
  record = prepareImprovementCandidate(record);
  for (const startupTokens of [0, 0, 0]) record = run(record, { startupTokens });
  const assessed = assessImprovement(record);
  assert.equal(assessed.verdict, 'no-change');
  assert.equal(assessed.tasks[0].deltas.startupTokens.percent, null);
  assert.equal(assessed.tasks[0].before.metrics.startupTokens, 0);
  const improved = assessImprovement(comparison({}, { startupTokens: 50 }));
  assert.equal(improved.verdict, 'improved');
  assert.equal(improved.tasks[0].deltas.startupTokens.percent, 50);
  assert.equal(improved.tasks[0].deltas.costUSD, null);
  assert.ok(improved.warnings.some(warning => warning.includes('total cost')));
  assert.match(improved.source, /causal attribution unverified/);
});

test('one missing measurement makes the task metric unknown and cannot imply zero', () => {
  let record = create();
  record = run(record, { startupTokens: null, seconds: 10 });
  for (let i = 0; i < 2; i++) record = run(record, { seconds: 10 });
  record = prepareImprovementCandidate(record);
  for (let i = 0; i < 3; i++) record = run(record, { startupTokens: 50, seconds: 1 });
  const assessed = assessImprovement(record);
  assert.equal(assessed.tasks[0].deltas.startupTokens, null);
  assert.equal(assessed.tasks[0].before.metrics.startupTokens, null);
  assert.equal(assessed.tasks[0].after.metrics.startupTokens, 50);
  assert.equal(assessed.verdict, 'improved');
  assert.equal(assessed.tasks[0].deltas.seconds.reduction, 9);
});

test('candidate gate requires enough runs, stable known conditions and a complete baseline metric per task', () => {
  const incomplete = run(run(create()));
  assert.equal(assessImprovement(incomplete).baselineEligible, false);
  assert.throws(() => prepareImprovementCandidate(incomplete), /three baseline/);
  for (const conditionsChange of [{ model: '' }, { counter: 'unknown' }, { environment: 'not sure' }, { agentVersion: '2' }, { counter: 'token=fixture-sensitive-value' }]) {
    let record = run(run(create()));
    record = run(record, conditionsChange);
    const assessed = assessImprovement(record);
    assert.equal(assessed.tasks[0].before.runs, 3);
    assert.equal(assessed.baselineEligible, false);
    assert.match(assessed.baselineIssues.join(' '), /condition labels/);
    assert.throws(() => prepareImprovementCandidate(record), /known, stable/);
  }
  let record = create();
  record = run(record);
  record = run(record, { startupTokens: null, seconds: 10 });
  record = run(record, { startupTokens: null, totalTokens: 500 });
  assert.equal(assessImprovement(record).baselineEligible, false);
  assert.throws(() => prepareImprovementCandidate(record), /metric across all baseline runs/);
  const baseline = comparison();
  assert.equal(assessImprovement(baseline).baselineEligible, true);
  assert.deepEqual(assessImprovement(baseline).baselineIssues, []);
});

test('appended corrections restore baseline eligibility and recompute active counts and medians', () => {
  let record = create();
  record = run(record, { startupTokens: 1000, counter: '', passed: false });
  record = run(record, { startupTokens: 100 });
  record = run(record, { startupTokens: 200 });
  const original = record.runs[0], snapshot = structuredClone(record);
  assert.equal(assessImprovement(record).baselineEligible, false);
  const corrected = run(record, { correctsRunId: original.id, correctionReason: 'Correct the measurement and conditions; token=fixture-sensitive-value', startupTokens: 50 });
  assert.deepEqual(record, snapshot);
  assert.equal(corrected.runs.length, 4);
  assert.equal(corrected.runs[0], original);
  assert.notEqual(corrected.runs[3].id, original.id);
  assert.match(corrected.runs[3].correctionReason, /REDACTED/);
  assert.deepEqual(activeImprovementRuns(corrected), [corrected.runs[1], corrected.runs[2], corrected.runs[3]]);
  const assessed = assessImprovement(corrected);
  assert.equal(assessed.baselineEligible, true);
  assert.equal(assessed.tasks[0].before.runs, 3);
  assert.equal(assessed.tasks[0].before.passed, 3);
  assert.equal(assessed.tasks[0].before.metrics.startupTokens, 100);
  assert.match(assessed.warnings.join(' '), /preserved in the history/);
  assert.equal(prepareImprovementCandidate(corrected).status, 'candidate');
});

test('correction chains retain exact retry identity after supersession and phase advancement', () => {
  let record = run(run(run(create())));
  const first = { runId: '22222222-2222-4222-8222-222222222222', correctsRunId: record.runs[0].id, correctionReason: 'Correct the first measurement', startupTokens: 90 };
  record = run(record, first);
  const second = { runId: '33333333-3333-4333-8333-333333333333', correctsRunId: first.runId, correctionReason: 'Correct the follow-up measurement', startupTokens: 80 };
  record = run(record, second);
  assert.equal(record.runs.length, 5);
  assert.equal(activeImprovementRuns(record).length, 3);
  assert.equal(activeImprovementRuns(record).at(-1).id, second.runId);
  assert.deepEqual(run(record, first), record);
  assert.deepEqual(run(record, second), record);
  const candidate = prepareImprovementCandidate(record);
  assert.deepEqual(run(candidate, { ...first, phase: 'before' }), candidate);
  assert.deepEqual(run(candidate, second), candidate);
  for (const extra of [{ correctionReason: 'A different reason' }, { correctsRunId: record.runs[1].id }, { startupTokens: 70 }, { phase: 'after' }, { correctsRunId: undefined, correctionReason: undefined }]) {
    assert.throws(() => run(candidate, { ...first, ...extra }), /different outcomes/);
  }
  assert.throws(() => run(candidate, { correctsRunId: second.runId, correctionReason: 'Too late' }), /phase/);
});

test('corrections require a bounded reason and an active target in the same task and phase', () => {
  let record = create({ tasks: [...design.tasks, { label: 'Second task', prompt: 'Verify another fixture' }] });
  record = run(record);
  const target = record.runs[0].id;
  for (const extra of [
    { correctsRunId: target }, { correctionReason: 'Missing target' },
    { correctsRunId: target, correctionReason: '' }, { correctsRunId: target, correctionReason: 'x'.repeat(2001) },
    { correctsRunId: 'bad', correctionReason: 'Invalid target' },
    { correctsRunId: '44444444-4444-4444-8444-444444444444', correctionReason: 'Missing target' },
    { correctsRunId: target, correctionReason: 'Wrong task', taskId: record.tasks[1].id },
    { correctsRunId: target, correctionReason: 'Wrong phase', phase: 'after' },
    { correctsRunId: target, correctionReason: 'Self correction', runId: target },
  ]) assert.throws(() => run(record, extra));
  record = run(record, { correctsRunId: target, correctionReason: 'Correct measurement' });
  assert.throws(() => run(record, { correctsRunId: target, correctionReason: 'Superseded target' }), /active run/);
  assert.throws(() => run({ ...record, status: 'closed' }, { correctsRunId: record.runs[1].id, correctionReason: 'Closed comparison' }), /closed/);
});

test('replacement leaves the active per-task limit unchanged while all stored runs count toward sixty', () => {
  let record = create();
  for (let i = 0; i < 10; i++) record = run(record);
  const original = record.runs[0];
  record = run(record, { correctsRunId: original.id, correctionReason: 'Correct at the active limit' });
  assert.equal(record.runs.length, 11);
  assert.equal(activeImprovementRuns(record).length, 10);
  assert.throws(() => run(record), /limit/);
  for (let i = record.runs.length; i < 60; i++) record = run(record, { correctsRunId: record.runs.at(-1).id, correctionReason: 'Correct another measurement' });
  assert.equal(record.runs.length, 60);
  assert.equal(activeImprovementRuns(record).length, 10);
  assert.equal(record.runs[0], original);
  const last = record.runs.at(-1);
  assert.deepEqual(run(record, { runId: last.id, correctsRunId: last.correctsRunId, correctionReason: last.correctionReason }), record);
  assert.throws(() => run(record, { correctsRunId: last.id, correctionReason: 'Over storage limit' }), /limit/);
});

test('active candidate failures still count when another candidate run is corrected', () => {
  let record = comparison({}, { startupTokens: 50 });
  record = run(record, { passed: false });
  record = run(record, { correctsRunId: record.runs[3].id, correctionReason: 'Correct a successful measurement', startupTokens: 40 });
  const assessed = assessImprovement(record);
  assert.equal(assessed.tasks[0].after.runs, 4);
  assert.equal(assessed.tasks[0].after.passed, 3);
  assert.equal(assessed.verdict, 'regression');
});

test('restoration can close any open candidate without changing its incomplete or incomparable assessment', () => {
  let incomplete = create();
  for (let i = 0; i < 3; i++) incomplete = run(incomplete);
  incomplete = prepareImprovementCandidate(incomplete);
  for (const record of [incomplete, run(incomplete), comparison({}, { counter: '' })]) {
    const before = assessImprovement(record);
    assert.throws(() => decideImprovement(record, { decision: 'keep', note: 'Keep the change' }), /comparable/);
    assert.throws(() => decideImprovement(record, { decision: 'restored', note: '' }), /decision note/);
    const restored = decideImprovement(record, { decision: 'restored', note: 'Restored the original configuration' });
    assert.equal(restored.status, 'closed');
    assert.equal(restored.decision.decision, 'restored');
    assert.deepEqual(assessImprovement(restored), before);
    assert.equal(record.status, 'candidate');
  }
  for (const decision of ['keep', 'restored']) assert.throws(() => decideImprovement(create(), { decision, note: 'Not a candidate yet' }), /candidate phase/);
});

test('keep rejects complete comparable samples without any shared measured metric', () => {
  const record = comparison({}, { startupTokens: null, seconds: 1 });
  assert.equal(assessImprovement(record).ready, true);
  assert.equal(assessImprovement(record).verdict, 'insufficient-metrics');
  assert.throws(() => decideImprovement(record, { decision: 'keep', note: 'Keep the change' }), /shared measured metric/);
  assert.equal(decideImprovement(record, { decision: 'restored', note: 'Restored configuration' }).status, 'closed');
});

test('keeps the known baseline median visible before and during candidate collection', () => {
  let record = create();
  for (const startupTokens of [100, 120, 140]) record = run(record, { startupTokens });
  const baseline = assessImprovement(record);
  assert.equal(baseline.tasks[0].before.metrics.startupTokens, 120);
  assert.equal(baseline.tasks[0].after.metrics.startupTokens, null);
  assert.equal(baseline.tasks[0].deltas.startupTokens, null);
  record = prepareImprovementCandidate(record);
  for (let i = 0; i < 3; i++) record = run(record, { startupTokens: null, seconds: 1 });
  const candidate = assessImprovement(record);
  assert.equal(candidate.tasks[0].before.metrics.startupTokens, 120);
  assert.equal(candidate.tasks[0].after.metrics.startupTokens, null);
  assert.equal(candidate.tasks[0].deltas.startupTokens, null);
  assert.equal(candidate.verdict, 'insufficient-metrics');
});

test('failed candidate tasks override savings and increasing metrics produce tradeoffs or regressions', () => {
  assert.equal(assessImprovement(comparison({}, { startupTokens: 50, passed: false })).verdict, 'regression');
  assert.equal(assessImprovement(comparison({ seconds: 10 }, { startupTokens: 50, seconds: 20 })).verdict, 'tradeoff');
  assert.equal(assessImprovement(comparison({}, { startupTokens: 150 })).verdict, 'regression');
});

test('requires complete consistent conditions, allowing only the selected model change', () => {
  for (const extra of [{ model: '' }, { counter: 'unknown' }, { environment: 'not sure' }, { agentVersion: '2' }, { model: 'another-model' }]) assert.equal(assessImprovement(comparison({}, extra)).verdict, 'incomparable');
  assert.equal(assessImprovement(comparison({}, { model: 'another-model', startupTokens: 50 }, { variable: 'model' })).verdict, 'improved');
  const varied = comparison();
  varied.runs[0] = { ...varied.runs[0], environment: 'another environment' };
  assert.equal(assessImprovement(varied).verdict, 'incomparable');
});

test('requires a complete comparable benchmark for an explicit decision and closes further mutations', () => {
  assert.equal(assessImprovement(create()).verdict, 'collect-baseline');
  let record = create();
  for (let i = 0; i < 3; i++) record = run(record);
  record = prepareImprovementCandidate(record);
  assert.equal(assessImprovement(record).verdict, 'collect-after');
  assert.throws(() => decideImprovement(record, { decision: 'keep', note: 'Keep it' }), /Complete/);
  assert.throws(() => decideImprovement(comparison({}, { counter: '' }), { decision: 'keep', note: 'Keep it' }), /comparable/);
  const regression = comparison({}, { startupTokens: 200 });
  const closed = decideImprovement(regression, { decision: 'keep', note: 'Accepted the measured tradeoff' }, 3000);
  assert.equal(closed.status, 'closed');
  assert.equal(closed.decision.decision, 'keep');
  assert.equal(assessImprovement(closed).verdict, 'regression');
  assert.equal(regression.status, 'candidate');
  assert.throws(() => run(closed), /closed/);
  assert.throws(() => prepareImprovementCandidate(closed), /closed/);
  assert.throws(() => decideImprovement(closed, { decision: 'restored', note: 'Restore' }), /closed/);
  assert.throws(() => decideImprovement(regression, { decision: 'keep', note: '' }));
});


test('selected assets pin only bounded canonical last-scan metadata without copying asset bodies or extra fields', () => {
  const inventory = structuredClone(context.inventory), scannedAt = '2026-01-02T03:04:05.000Z';
  inventory.scannedAt = scannedAt; inventory.coverage = { partial: true, limitsReached: ['FIXTURE-COVERAGE-DETAIL'] };
  Object.assign(inventory.items[0], {
    name: 'Fixture skill', path: '/fixture/global-config/.codex/skills/fixture/SKILL.md', type: 'skill', bytes: 0,
    modifiedAt: '2026-01-01T01:02:03.000Z', contentHash: 'a'.repeat(64),
    description: 'PRIVATE-DESCRIPTION-MARKER', content: 'PRIVATE-BODY-MARKER', settings: { private: 'PRIVATE-SETTINGS-MARKER' }, extra: 'PRIVATE-EXTRA-MARKER',
  });
  Object.assign(inventory.items[1], { name: 'Repo instruction', path: '/fixture/repo/AGENTS.md', type: 'instruction', bytes: 123, modifiedAt: null, contentHash: 'B'.repeat(64) });
  const original = structuredClone(inventory);
  const record = createImprovement({ ...design, assetIds: ['shared', 'global'] }, { ...context, inventory }, 0);
  assert.deepEqual(record.inventorySource, { scannedAt, partial: true, items: [
    { id: 'shared', name: 'Repo instruction', path: '/fixture/repo/AGENTS.md', agent: 'shared', repo: '/fixture/repo', type: 'instruction', bytes: 123, modifiedAt: null, contentHash: 'B'.repeat(64) },
    { id: 'global', name: 'Fixture skill', path: '/fixture/global-config/.codex/skills/fixture/SKILL.md', agent: 'codex', repo: '', type: 'skill', bytes: 0, modifiedAt: '2026-01-01T01:02:03.000Z', contentHash: 'a'.repeat(64) },
  ] });
  assert.deepEqual(inventory, original, 'Creating a snapshot must not mutate the live inventory');
  for (const marker of ['PRIVATE-DESCRIPTION-MARKER', 'PRIVATE-BODY-MARKER', 'PRIVATE-SETTINGS-MARKER', 'PRIVATE-EXTRA-MARKER', 'FIXTURE-COVERAGE-DETAIL']) assert.equal(JSON.stringify(record.inventorySource).includes(marker), false);
  inventory.scannedAt = '2026-02-01T00:00:00.000Z'; inventory.coverage.partial = false;
  inventory.items[0].name = 'Changed later'; inventory.items[0].contentHash = 'c'.repeat(64);
  assert.equal(record.inventorySource.scannedAt, scannedAt); assert.equal(record.inventorySource.partial, true);
  assert.equal(record.inventorySource.items[1].name, 'Fixture skill'); assert.equal(record.inventorySource.items[1].contentHash, 'a'.repeat(64));
});

test('asset provenance keeps unknown metadata null and accepts only complete hexadecimal content hashes', () => {
  const base = create({ assetIds: ['global', 'gateway'] });
  assert.equal(base.inventorySource.scannedAt, null); assert.equal(base.inventorySource.partial, false);
  assert.equal(base.inventorySource.items[0].bytes, null); assert.equal(base.inventorySource.items[0].modifiedAt, null); assert.equal(base.inventorySource.items[0].contentHash, null);
  for (const patch of [{ bytes: -1, modifiedAt: 'unknown', contentHash: 'g'.repeat(64) }, { bytes: NaN, contentHash: 'a'.repeat(63) }, { bytes: 1.5, contentHash: 'a'.repeat(65) }, { bytes: null, modifiedAt: '', contentHash: 123 }]) {
    const inventory = { scannedAt: 'unknown', items: [{ ...context.inventory.items[0], ...patch }], coverage: { partial: 'true' } };
    const record = createImprovement({ ...design, assetIds: ['global'] }, { ...context, inventory }, 0);
    assert.equal(record.inventorySource.scannedAt, null); assert.equal(record.inventorySource.partial, false); assert.equal(record.inventorySource.items[0].bytes, null);
    assert.equal(record.inventorySource.items[0].modifiedAt, null); assert.equal(record.inventorySource.items[0].contentHash, null);
  }
  const inventory = { scannedAt: 'x'.repeat(1000), items: [{ ...context.inventory.items[0], name: 'n'.repeat(1000), path: '/fixture/' + 'p'.repeat(5000), type: 't'.repeat(1000) }] };
  const bounded = createImprovement({ ...design, assetIds: ['global'] }, { ...context, inventory }, 0).inventorySource;
  assert.equal(bounded.scannedAt, null); assert.equal(bounded.items[0].name.length, 256); assert.equal(bounded.items[0].path.length, 4096); assert.equal(bounded.items[0].type.length, 80);
  const sensitive = ['to', 'ken'].join('') + '=fixture-sensitive-metadata'; inventory.items[0].name = sensitive;
  assert.match(createImprovement({ ...design, assetIds: ['global'] }, { ...context, inventory }, 0).inventorySource.items[0].name, /REDACTED/);
  assert.equal(Object.hasOwn(create(), 'inventorySource'), false); assert.equal(Object.hasOwn(create({ assetIds: [] }), 'inventorySource'), false);
});

test('last-scan asset provenance is unchanged across run retries, corrections, phase transition and decisions', () => {
  let record = create({ assetIds: ['global', 'shared', 'gateway'] });
  const snapshot = structuredClone(record.inventorySource);
  Object.freeze(record.inventorySource); record.inventorySource.items.forEach(Object.freeze); Object.freeze(record.inventorySource.items);
  for (let i = 0; i < 3; i++) record = run(record);
  const runId = record.runs[0].id;
  record = run(record, { runId });
  record = run(record, { correctsRunId: runId, correctionReason: 'Correct the sampled fixture outcome', startupTokens: 90 });
  assert.deepEqual(record.inventorySource, snapshot);
  record = prepareImprovementCandidate(record);
  for (let i = 0; i < 3; i++) record = run(record, { startupTokens: 50 });
  const keep = decideImprovement(record, { decision: 'keep', note: 'Comparable sampled fixture passed' });
  const restored = decideImprovement(record, { decision: 'restored', note: 'Restore after reviewing the samples' });
  for (const result of [record, keep, restored]) assert.deepEqual(result.inventorySource, snapshot);
});

test('clients cannot supply or mutate inventory provenance even when the supplied value is empty', () => {
  const initial = create({ assetIds: ['global'] }), untouched = structuredClone(initial);
  let candidate = initial;
  for (let i = 0; i < 3; i++) candidate = run(candidate);
  candidate = prepareImprovementCandidate(candidate);
  for (const inventorySource of [undefined, null, {}, { scannedAt: 'FORGED-SCAN', items: [] }]) {
    assert.throws(() => create({ inventorySource }), /derived from the last scan/);
    assert.throws(() => create({ assetIds: ['global'], inventorySource }), /derived from the last scan/);
    assert.throws(() => run(initial, { inventorySource }), /derived from the last scan/);
    assert.throws(() => decideImprovement(candidate, { decision: 'restored', note: 'Restore the fixture', inventorySource }), /derived from the last scan/);
  }
  const inherited = Object.assign(Object.create({ inventorySource: {} }), design);
  assert.throws(() => createImprovement(inherited, context), /derived from the last scan/);
  assert.deepEqual(initial, untouched);
  for (const assetIds of [['global', 'global'], ['missing'], ['other-agent'], ['other-repo']]) assert.throws(() => create({ assetIds }));
});

test('legacy comparisons retain absent provenance without inferring a historical inventory snapshot', () => {
  let record = create({ assetIds: ['global'] }); delete record.inventorySource;
  const original = structuredClone(record);
  for (let i = 0; i < 3; i++) record = run(record);
  assert.equal(Object.hasOwn(record, 'inventorySource'), false);
  record = prepareImprovementCandidate(record);
  const closed = decideImprovement(record, { decision: 'restored', note: 'Restore the legacy comparison' });
  for (const result of [record, closed]) { assert.equal(Object.hasOwn(result, 'inventorySource'), false); assert.deepEqual(result.assetIds, original.assetIds); }
  assert.equal(Object.hasOwn(original, 'inventorySource'), false);
});
