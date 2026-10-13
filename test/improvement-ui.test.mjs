import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { assessImprovement } from '../lib/improvements.mjs';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const opening = source.slice(source.indexOf('function openImprovement('),source.indexOf('function updateImprovementPrompt()'));
const inventorySource = source.slice(source.indexOf('function renderImprovementInventorySource('),source.indexOf('function openImprovement('));
const recovery = source.slice(source.indexOf('function improvementRecord()'), source.indexOf('function improvementValue('));
const progress = source.slice(source.indexOf('function updateImprovementPrompt()'), source.indexOf('async function improvementAction('));
const action = source.slice(source.indexOf('async function improvementAction('), source.indexOf('async function saveImprovement('));
const handlers = source.slice(source.indexOf("$('improvement-plan').addEventListener('submit'"), source.indexOf("$('repo-select').addEventListener('change'"));
const recoveryHandlers = source.slice(source.indexOf("$('improvement-clear-draft').addEventListener('click'"), source.indexOf("$('improvement-ask').addEventListener('click'"));

function harness({ fail = false, record = { id: 'test-a', status: 'candidate', tasks: [{ id: 'task-a', label: 'Fixed task', prompt: 'Fixed prompt' }], runs: [], assessment: { ready: false, verdict: 'collect-after' } } } = {}) {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      _value: '', get value() { return this._value; }, set value(value) { this._value = String(value); }, disabled: false, hidden: true, children: [], listeners: {}, dataset:{},
      addEventListener(type, listener) { this.listeners[type] = listener; }, querySelector() { return node(id + '-submit'); },
      append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; }, setAttribute() {},showModal(){this.open=true;},focus() { this.focused = true; },
      reset() { for (const [key, item] of nodes) if (/^improvement-(?:startupTokens|totalTokens|seconds|corrections|compactions|costUSD|run-task|passed|run-note|model|agentVersion|environment|counter|correction-reason)$/.test(key)) item.value = key === 'improvement-run-task' ? 'task-a' : ''; },
    });
    return nodes.get(id);
  };
  node('improvement-tasks').children = [{ querySelector: selector => ({ value: selector === 'input' ? 'Fixed task' : 'Fixed prompt' }) }];
  node('improvement-passed').value = 'true';
  node('improvement-run-task').value = 'task-a';
  node('improvement-decision-note').value = 'Restored the saved setup';
  const calls = [],scopeChanges = [];
  const context = vm.createContext({
    $: node, crypto: webcrypto,activeRepo:'/fixture/current',selectedAgent:'codex',agentName:String,setOptions(item,options){item.value=options[0]?.value||'';}, improvementBusy: false, improvementId: 'test-a', improvementRunId: 'run-a', improvementCorrection: null, improvementDraft: '', state: { improvements: [record] }, improvementScope: { agent: 'codex', repo: '', assetIds: [] },
    improvementMetrics: { startupTokens: 'Startup', totalTokens: 'Total', seconds: 'Seconds', corrections: 'Corrections', compactions: 'Compactions', costUSD: 'Cost' },
    saveImprovement: async payload => { calls.push(payload); if (fail) throw new Error('Save failed'); return {...record,id:'test-a',agent:'codex',repo:''}; },
    array: value => Array.isArray(value) ? value : [], element: (tag, className, textContent) => Object.assign(node('element-' + nodes.size), { tag, className, textContent }),
    button: (label, className, listener) => { const item = Object.assign(node('button-' + nodes.size), { textContent: label, className }); item.listeners.click = listener; return item; },
    improvementValue: value => typeof value === 'number' ? String(value) : 'Unknown', date: value => value || 'date', time: () => 'time',
    chooseRepo(repo){scopeChanges.push({repo});context.activeRepo=repo;},chooseAgent(agent){scopeChanges.push({agent});context.selectedAgent=agent;},toast() {},
  });
  vm.runInContext(inventorySource + recovery + progress + action + opening + recoveryHandlers + handlers, context);
  vm.runInContext('improvementDraft = improvementRunDraft()', context);
  const submit = async (id, submitter = null) => {
    node(id).listeners.submit({ preventDefault() {}, currentTarget: node(id), submitter });
    await new Promise(resolve => setImmediate(resolve));
  };
  return { context, node, calls, scopeChanges, submit };
}

for (const [id, expectedAction] of [['improvement-plan', 'create'], ['improvement-run', 'run']]) {
  test(`${id} accepts a null submitter without leaving the form busy`, async () => {
    const { context, node, calls, submit } = harness();
    await submit(id);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].action, expectedAction);
    assert.equal(context.improvementBusy, false);
    assert.equal(node(id + '-submit').disabled, false);
    if (expectedAction === 'run') assert.equal(calls[0].startupTokens, null);
  });

  test(`${id} recovers from a failed save with a null submitter`, async () => {
    const { context, node, submit } = harness({ fail: true });
    await submit(id);
    assert.equal(context.improvementBusy, false);
    assert.equal(node(id + '-submit').disabled, false);
    assert.equal(node('improvement-error').hidden, false);
    assert.equal(node('improvement-error').textContent, 'Save failed');
  });
}

test('a decision with no submitter asks for an explicit choice and saves nothing', async () => {
  const { context, node, calls, submit } = harness();
  await submit('improvement-decision');
  assert.equal(calls.length, 0);
  assert.equal(context.improvementBusy, false);
  assert.equal(node('improvement-error').hidden, false);
  assert.match(node('improvement-error').textContent, /Choose Record I kept it or Record I restored prior setup/);
});

test('an explicit restore choice remains a restore decision', async () => {
  const { context, calls, submit } = harness();
  await submit('improvement-decision', { value: 'restored', disabled: false });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].decision, 'restored');
  assert.equal(context.improvementBusy, false);
});

test('creating a linked workflow plan sends only its captured identity with the user supplied experiment',async()=>{
  const {context,node,calls,submit}=harness();context.improvementScope={agent:'claude',repo:'/fixture/test-repo',assetIds:[],workflowId:'workflow-a'};
  node('improvement-variable').value='workflow';node('improvement-plan-title').value='Test fixture';node('improvement-change').value='Manually adopt fixture after before runs';node('improvement-benefit').value='Fewer corrections';node('improvement-rollback').value='Restore prior files';
  await submit('improvement-plan');assert.equal(calls.length,1);assert.equal(calls[0].workflowId,'workflow-a');assert.equal(calls[0].agent,'claude');assert.equal(calls[0].repo,'/fixture/test-repo');assert.equal(calls[0].variable,'workflow');assert.equal(calls[0].tasks[0].prompt,'Fixed prompt');assert.equal('workflowSource' in calls[0],false);assert.equal('bundle' in calls[0],false);assert.equal('inventorySource' in calls[0],false);
});

test('linked-plan save selects its target dashboard scope and opens the returned saved snapshot',async()=>{
  for(const alreadySelected of [false,true]){
    const {context,node,scopeChanges,submit}=harness();const record={...recordFor('baseline'),agent:'claude',repo:'/fixture/test-repo',workflowSource:{conversationId:'workflow-a',name:'Saved fixture',bundleHash:'saved-hash'}};
    context.improvementScope={agent:record.agent,repo:record.repo,assetIds:[],workflowId:'workflow-a'};
    if(alreadySelected){context.activeRepo=record.repo;context.selectedAgent=record.agent;}
    context.saveImprovement=async()=>{context.state.improvements=[record];return record;};await submit('improvement-plan');
    assert.deepEqual(scopeChanges,alreadySelected?[]:[{repo:record.repo},{agent:record.agent}]);assert.equal(context.activeRepo,record.repo);assert.equal(context.selectedAgent,record.agent);assert.equal(context.improvementId,record.id);assert.equal(node('improvement-progress').hidden,false);assert.equal(node('improvement-plan').hidden,true);assert.equal(node('improvement-variable').disabled,true);assert.match(textOf(node('improvement-saved-plan')),/Saved fixture.*saved-hash/);
  }
  const ordinary=harness();await ordinary.submit('improvement-plan');assert.deepEqual(ordinary.scopeChanges,[]);assert.equal(ordinary.context.activeRepo,'/fixture/current');assert.equal(ordinary.context.selectedAgent,'codex');assert.equal(ordinary.node('improvement-progress').hidden,false);
});

test('benefit is optional while the rollback and equivalent fixed task remain required',()=>{
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');const benefit=html.match(/<textarea id="improvement-benefit"[^>]*>/)?.[0];assert.ok(benefit);assert.doesNotMatch(benefit,/\brequired\b/);assert.match(html,/Expected benefit <span class="optional">optional<\/span>/);assert.match(html,/<textarea id="improvement-rollback" required/);
  const {context,node}=harness();vm.runInContext(source.slice(source.indexOf('function addImprovementTask()'),source.indexOf('function openImprovement(')),context);node('improvement-tasks').replaceChildren();context.addImprovementTask();const task=node('improvement-tasks').children[0];assert.equal(task.children[1].children[0].required,true);assert.equal(task.children[2].children[0].required,true);
});

test('saved workflow provenance shows name and hash as a reviewed draft rather than proof of execution',()=>{
  const record={...recordFor('baseline'),workflowSource:{conversationId:'workflow-a',name:'Fixture workflow',bundleHash:'sha256-fixture',placement:'global',targetAgent:'claude',repo:'/fixture/original-private-scope'}};
  const {context,node}=harness({record});context.renderImprovementProgress();const text=textOf(node('improvement-saved-plan'));
  assert.match(text,/Linked workflow draft.*Fixture workflow.*Bundle hash: sha256-fixture/);assert.match(text,/Confirm the installed files match this reviewed draft before recording after runs/);assert.match(text,/does not verify installation or execution/);assert.doesNotMatch(text,/original-private-scope|workflow-a/);
});

test('saved inventory provenance uses the captured last-scan metadata, marks unknown versions and excludes live bodies',()=>{
  const record={...recordFor('baseline'),inventorySource:{scannedAt:'2026-10-12',partial:true,items:[{id:'captured-id',name:'Captured instructions',path:'/fixture/saved/AGENTS.md',agent:'codex',repo:'/fixture/saved',type:'instruction',bytes:40,modifiedAt:'2026-10-11',contentHash:'captured-hash',content:'PRIVATE BODY'},{id:'unknown-version',name:'Metadata only',path:'/fixture/saved/unknown',agent:'codex',repo:'',type:'config',bytes:null,contentHash:null}]}};
  const {context,node}=harness({record});context.state.inventory={scannedAt:'2026-10-13',items:[{id:'captured-id',path:'/fixture/changed/AGENTS.md',contentHash:'new-hash'}]};context.renderImprovementProgress();const plan=node('improvement-saved-plan'),text=textOf(plan),details=plan.children.find(item=>item.tag==='details');
  assert.notEqual(details.open,true);assert.match(text,/Selected files captured when saved, from the last scan.*2026-10-12.*Partial inventory.*not live.*does not prove loading, use or usefulness.*Captured instructions.*fixture\/saved\/AGENTS.md.*captured-hash.*Metadata only.*Content version: Unknown/s);assert.doesNotMatch(text,/PRIVATE BODY|fixture\/changed|new-hash|2026-10-13/);
  const legacy=harness({record:recordFor('baseline')});legacy.context.renderImprovementProgress();assert.doesNotMatch(textOf(legacy.node('improvement-saved-plan')),/Selected files captured when saved/);
});

const beforeRun = { id: 'before-a', taskId: 'task-a', phase: 'before', passed: false, startupTokens: 0, totalTokens: null, note: 'Entered the wrong result', model: 'Model A', agentVersion: '1', environment: 'Fixture A', counter: 'Report A', at: '2026-10-01' };
const afterRun = { ...beforeRun, id: 'after-a', phase: 'after' };
function recordFor(status, runs = [], assessment = {}) {
  return { id: 'test-a', status, tasks: [{ id: 'task-a', label: 'Fixed task', prompt: 'Fixed prompt' }], runs, assessment };
}
function textOf(item) { return [item.textContent || '', ...item.children.map(textOf)].join(' '); }
function buttonsIn(item) { return [...(item.listeners.click ? [item] : []), ...item.children.flatMap(buttonsIn)]; }

test('history retains corrected originals while counts and correction buttons use current active runs', () => {
  const replacement = { ...afterRun, id: 'replacement-a', correctsRunId: 'after-a', correctionReason: 'Copied the wrong result', passed: true, at: '2026-10-02' };
  const { context, node } = harness({ record: recordFor('candidate', [beforeRun, afterRun, replacement]) });
  context.renderImprovementProgress();
  assert.match(textOf(node('improvement-summary')), /1\/3 before recorded · 1\/3 after recorded.*Before quality: 0 passed, 1 failed, 0 unknown\. After quality: 1 passed, 0 failed, 0 unknown/);
  const history = node('improvement-runs');
  assert.equal(history.children.length, 3);
  assert.match(textOf(history.children[1]), /Corrected on 2026-10-02.*Copied the wrong result.*Replacement run: replacement-a/);
  assert.equal(buttonsIn(history).length, 1);
  buttonsIn(history)[0].listeners.click();
  assert.equal(context.improvementCorrection, 'replacement-a');
});

test('correction prefills all recording fields and survives progress refreshes', () => {
  const { context, node } = harness({ record: recordFor('baseline', [beforeRun]) });
  context.correctImprovementRun(beforeRun);
  assert.equal(node('improvement-startupTokens').value, '0');
  assert.equal(node('improvement-totalTokens').value, '');
  assert.equal(node('improvement-passed').value, 'false');
  assert.equal(node('improvement-run-note').value, beforeRun.note);
  assert.equal(node('improvement-model').value, beforeRun.model);
  assert.equal(node('improvement-agentVersion').value, beforeRun.agentVersion);
  assert.equal(node('improvement-environment').value, beforeRun.environment);
  assert.equal(node('improvement-counter').value, beforeRun.counter);
  assert.notEqual(context.improvementRunId, 'run-a');
  assert.equal(node('improvement-correction-reason').required, true);
  assert.equal(node('improvement-correction-reason').disabled, false);
  node('improvement-correction-reason').value = 'Mistyped quality';
  context.renderImprovementProgress();
  assert.equal(context.improvementCorrection, beforeRun.id);
  assert.equal(node('improvement-correction-reason').value, 'Mistyped quality');
  assert.match(node('improvement-correction-target').textContent, /before-a/);
});

test('selecting a correction cannot silently discard a dirty run draft', () => {
  const { context, node } = harness({ record: recordFor('baseline', [beforeRun]) });
  node('improvement-seconds').value = '12';
  context.correctImprovementRun(beforeRun);
  assert.equal(context.improvementCorrection, null);
  assert.equal(context.improvementRunId, 'run-a');
  assert.equal(node('improvement-seconds').value, '12');
  assert.match(node('improvement-error').textContent, /unsaved changes.*Clear draft/);
  context.resetImprovementRun();
  context.correctImprovementRun(beforeRun);
  assert.equal(context.improvementCorrection, beforeRun.id);
});

test('cancelling a correction returns a fresh form and a new recording ID', () => {
  const { context, node } = harness({ record: recordFor('baseline', [beforeRun]) });
  context.correctImprovementRun(beforeRun);
  const correctionId = context.improvementRunId;
  node('improvement-correction-reason').value = 'Wrong entry';
  context.resetImprovementRun();
  assert.equal(context.improvementCorrection, null);
  assert.notEqual(context.improvementRunId, correctionId);
  assert.equal(node('improvement-startupTokens').value, '');
  assert.equal(node('improvement-passed').value, '');
  assert.equal(node('improvement-correction-reason').value, '');
  assert.equal(node('improvement-correction-reason').required, false);
  assert.equal(node('improvement-correction-reason').disabled, true);
});

for (const fail of [false, true]) test(`correction save ${fail ? 'failure retains the draft and recording ID' : 'appends correction metadata and clears correction after success'}`, async () => {
  const { context, node, calls, submit } = harness({ fail, record: recordFor('baseline', [beforeRun]) });
  context.correctImprovementRun(beforeRun);
  const correctionId = context.improvementRunId;
  node('improvement-passed').value = 'true';
  node('improvement-correction-reason').value = ' Mistyped quality ';
  await submit('improvement-run');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].runId, correctionId);
  assert.equal(calls[0].correctsRunId, beforeRun.id);
  assert.equal(calls[0].correctionReason, 'Mistyped quality');
  assert.equal(calls[0].startupTokens, 0);
  assert.equal(calls[0].totalTokens, null);
  assert.equal(calls[0].model, beforeRun.model);
  assert.equal(context.improvementBusy, false);
  assert.equal(context.improvementCorrection, fail ? beforeRun.id : null);
  if (fail) {
    assert.equal(context.improvementRunId, correctionId);
    assert.equal(node('improvement-passed').value, 'true');
    assert.equal(node('improvement-correction-reason').value, ' Mistyped quality ');
    assert.equal(node('improvement-error').textContent, 'Save failed');
  } else assert.notEqual(context.improvementRunId, correctionId);
});

test('corrections require a reason and a selected quality result before submitting', async () => {
  const { context, node, calls, submit } = harness({ record: recordFor('baseline', [beforeRun]) });
  context.correctImprovementRun(beforeRun);
  await submit('improvement-run');
  assert.equal(calls.length, 0);
  assert.match(node('improvement-error').textContent, /Explain the data entry mistake/);
  node('improvement-correction-reason').value = 'Mistyped result';
  node('improvement-passed').value = '';
  await submit('improvement-run');
  assert.equal(calls.length, 0);
  assert.match(node('improvement-error').textContent, /Choose Passed or Failed/);
});

test('frozen before runs and corrected runs cannot open a correction', () => {
  const { context } = harness({ record: recordFor('candidate', [beforeRun, afterRun, { ...afterRun, id: 'new-a', correctsRunId: afterRun.id }]) });
  context.correctImprovementRun(beforeRun);
  assert.equal(context.improvementCorrection, null);
  context.correctImprovementRun(afterRun);
  assert.equal(context.improvementCorrection, null);
});

test('baseline issues gate the candidate transition even with three before recordings', async () => {
  const { context, node, calls } = harness({ record: recordFor('baseline', Array.from({ length: 3 }, (_, i) => ({ ...beforeRun, id: 'before-' + i })), { baselineEligible: false, baselineIssues: ['Record a known counter for before runs.'] }) });
  context.renderImprovementProgress();
  assert.equal(node('improvement-candidate').hidden, true);
  assert.equal(node('improvement-start-after').disabled, true);
  assert.match(textOf(node('improvement-summary')), /Record a known counter/);
  await node('improvement-start-after').listeners.click({ currentTarget: node('improvement-start-after') });
  assert.equal(calls.length, 0);
});

test('eligible baseline can transition but an unsaved run draft must be handled first', async () => {
  const { context, node, calls } = harness({ record: recordFor('baseline', [], { baselineEligible: true }) });
  context.renderImprovementProgress();
  assert.equal(node('improvement-start-after').disabled, false);
  node('improvement-run-note').value = 'Unsaved run';
  await node('improvement-start-after').listeners.click({ currentTarget: node('improvement-start-after') });
  assert.equal(calls.length, 0);
  assert.equal(node('improvement-run-note').value, 'Unsaved run');
  context.resetImprovementRun();
  await node('improvement-start-after').listeners.click({ currentTarget: node('improvement-start-after') });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, 'candidate');
});

for (const verdict of ['collect-after', 'incomparable', 'insufficient-metrics', 'improved']) test(`restore is available for candidate verdict ${verdict} while keep requires comparable evidence`, async () => {
  const { context, node, calls, submit } = harness({ record: recordFor('candidate', [], { verdict, ready: true }) });
  context.renderImprovementProgress();
  assert.equal(node('improvement-decision').hidden, false);
  assert.equal(node('improvement-restored').disabled, false);
  assert.equal(node('improvement-keep').hidden, verdict !== 'improved');
  if (verdict !== 'improved') {
    await submit('improvement-decision', { value: 'keep' });
    assert.equal(calls.length, 0);
  }
  await submit('improvement-decision', { value: 'restored' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].decision, 'restored');
});

test('restore requires a decision note and cannot be recorded during baseline', async () => {
  const { node, calls, submit } = harness();
  node('improvement-decision-note').value = ' ';
  await submit('improvement-decision', { value: 'restored' });
  assert.equal(calls.length, 0);
  assert.match(node('improvement-error').textContent, /Add a decision note/);
  const baseline = harness({ record: recordFor('baseline') });
  await baseline.submit('improvement-decision', { value: 'restored' });
  assert.equal(baseline.calls.length, 0);
});

test('closing a test cannot silently discard an unfinished run or correction', async () => {
  const draft = harness();
  draft.node('improvement-run-note').value = 'Unfinished measurement';
  await draft.submit('improvement-decision', { value: 'restored' });
  assert.equal(draft.calls.length, 0);
  assert.equal(draft.node('improvement-run-note').value, 'Unfinished measurement');
  assert.match(draft.node('improvement-error').textContent, /before closing this test/);
  const correction = harness({ record: recordFor('candidate', [afterRun]) });
  correction.context.correctImprovementRun(afterRun);
  await correction.submit('improvement-decision', { value: 'restored' });
  assert.equal(correction.calls.length, 0);
  assert.equal(correction.context.improvementCorrection, afterRun.id);
  correction.context.resetImprovementRun();
  await correction.submit('improvement-decision', { value: 'restored' });
  assert.equal(correction.calls.length, 1);
});

test('a restored incomplete test explains closure without asking for inaccessible after runs', () => {
  const record = {...recordFor('closed', [], {verdict:'collect-after',ready:false}),decision:{decision:'restored',note:'Restored manually',at:'2026-10-01'}};
  const {context,node} = harness({record});
  context.renderImprovementProgress();
  assert.match(textOf(node('improvement-summary')), /Restoration recorded.*comparison remains incomplete/);
  assert.equal(textOf(node('improvement-summary')).includes('Collect after runs'),false);
  assert.equal(node('improvement-run').hidden,true);
});

test('recovery guidance distinguishes recording corrections from genuine failures and external restore', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /Genuine failed checks must stay recorded/);
  assert.match(html, /Recording a restore closes this local test ledger/);
  assert.match(html, /These buttons do not change external configuration/);
  assert.match(html, /id="improvement-correction-reason"[^>]*disabled/);
});


function descendants(item, tag) { return [...(item.tag === tag ? [item] : []), ...item.children.flatMap(child => descendants(child, tag))]; }
function comparisonTask(before = {}, after = {}) {
  return {id:'task-a',before:{metrics:before},after:{metrics:after},deltas:{startupTokens:{reduction:5,percent:50}}};
}
function comparisonDetails(node) { return node('improvement-summary').children.find(item => item.className === 'improvement-comparison-detail'); }

test('a new saved test leads with recorded progress and before-run action without empty median tables',()=>{
  const record=recordFor('baseline',[],{verdict:'collect-baseline',baselineEligible:false,tasks:[comparisonTask()],warnings:['Some metrics are unknown; missing measurements are not zero.'],baselineIssues:['Supply conditions.']});
  const {context,node}=harness({record});context.renderImprovementProgress();const summary=node('improvement-summary');
  assert.equal(summary.children[0].textContent,'Record before runs');assert.match(textOf(summary),/0\/3 before recorded · 0\/3 after recorded/);assert.match(textOf(summary),/Next: record at least 3 before runs/);
  assert.equal(descendants(summary,'table').length,0);assert.equal(comparisonDetails(node).open,false);assert.equal(node('improvement-candidate').hidden,true);
  assert.doesNotMatch(textOf(summary),/Supply conditions/);assert.match(textOf(comparisonDetails(node)),/missing measurements are not zero/);
});

test('partial recordings distinguish failed and unknown quality and expose only available median rows during collection',()=>{
  const unknown={...beforeRun,id:'unknown',passed:undefined};const record=recordFor('baseline',[beforeRun,unknown],{baselineEligible:false,tasks:[comparisonTask({startupTokens:0,totalTokens:null})]});
  const {context,node}=harness({record});context.renderImprovementProgress();const details=comparisonDetails(node);
  assert.match(textOf(node('improvement-summary')),/2\/3 before recorded.*Before quality: 0 passed, 1 failed, 1 unknown/);assert.equal(details.open,false);
  const tables=descendants(details,'table');assert.equal(tables.length,1);assert.match(textOf(tables[0]),/Startup 0 Unknown/);assert.doesNotMatch(textOf(tables[0]),/Total|Seconds|Corrections|Compactions|Cost/);
  assert.match(textOf(node('improvement-runs')),/Quality unknown/);
});

test('comparison disclosure and an unsaved task draft survive polling while a newly ready comparison opens once',()=>{
  const record=recordFor('candidate',[beforeRun,afterRun],{ready:false,tasks:[comparisonTask({startupTokens:10},{startupTokens:5})]});
  const {context,node}=harness({record});context.renderImprovementProgress();comparisonDetails(node).open=true;node('improvement-run-task').value='task-kept';node('improvement-run-note').value='Unfinished note';
  context.renderImprovementProgress();assert.equal(comparisonDetails(node).open,true);assert.equal(node('improvement-run-task').value,'task-kept');assert.equal(node('improvement-run-note').value,'Unfinished note');
  comparisonDetails(node).open=false;context.renderImprovementProgress();assert.equal(comparisonDetails(node).open,false);
  record.assessment.ready=true;record.assessment.verdict='incomparable';context.renderImprovementProgress();assert.equal(comparisonDetails(node).open,true);
  comparisonDetails(node).open=false;context.renderImprovementProgress();assert.equal(comparisonDetails(node).open,false);
});

test('record count completion never promotes an ineligible baseline to collecting after runs',()=>{
  const runs=Array.from({length:3},(_,i)=>({...beforeRun,id:'before-'+i}));const record=recordFor('baseline',runs,{verdict:'collect-after',baselineEligible:false,baselineIssues:['Fixed task: supply all four known, stable baseline condition labels']});
  const {context,node}=harness({record});context.renderImprovementProgress();const summary=node('improvement-summary');
  assert.equal(summary.children[0].textContent,'Review before-run issues');assert.match(textOf(summary),/Next: review the before-run conditions/);assert.match(textOf(summary),/all four known, stable baseline condition labels/);
  assert.equal(node('improvement-candidate').hidden,true);assert.equal(node('improvement-start-after').disabled,true);assert.doesNotMatch(textOf(summary),/Collect after runs/);
});

test('eligible failed baseline recordings permit the manual transition and show the saved change and rollback ahead of the run form',()=>{
  const runs=Array.from({length:3},(_,i)=>({...beforeRun,id:'before-'+i}));const record={...recordFor('baseline',runs,{baselineEligible:true}),change:'Remove one unused entry after backup',rollback:'Restore the backup'};
  const {context,node}=harness({record});context.renderImprovementProgress();const text=textOf(node('improvement-summary'));
  assert.match(text,/Before runs are eligible.*Before quality: 0 passed, 3 failed, 0 unknown.*Next: back up.*Before quality failures remain.*Saved change: Remove one unused entry after backup.*Restore prior setup: Restore the backup/);
  assert.equal(node('improvement-candidate').hidden,false);assert.equal(node('improvement-start-after').disabled,false);
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');assert.ok(html.indexOf('id="improvement-candidate"')<html.indexOf('id="improvement-run"'));assert.doesNotMatch(html,/before runs pass the comparison checks/);
});

test('candidate quality failures and regressions stay visible while general caveats and partial medians are collapsed',()=>{
  const record=recordFor('candidate',[beforeRun,afterRun],{ready:false,verdict:'collect-after',tasks:[comparisonTask({startupTokens:10},{startupTokens:15})],warnings:['At least one candidate task failed verification.','At least one measured task metric increased; review the regression before deciding.','Some metrics are unknown; missing measurements are not zero.']});
  const {context,node}=harness({record});context.renderImprovementProgress();const summary=node('improvement-summary'),details=comparisonDetails(node);
  assert.equal(summary.children[0].textContent,'Record after runs');assert.match(textOf(summary),/After quality: 0 passed, 1 failed, 0 unknown/);assert.equal(details.open,false);
  const visible=summary.children.filter(item=>item!==details).map(textOf).join(' ');assert.match(visible,/failed verification/);assert.match(visible,/metric increased/);assert.doesNotMatch(visible,/missing measurements are not zero/);assert.match(textOf(details),/missing measurements are not zero/);
});

for(const status of ['candidate','closed'])test(`${status} completed collection opens full comparison with honest unknown metrics`,()=>{
  const record=recordFor(status,[beforeRun,afterRun],{ready:true,verdict:'tradeoff',tasks:[comparisonTask({startupTokens:10},{startupTokens:5})]});if(status==='closed')record.decision={decision:'restored',note:'Restored manually',at:'date'};
  const {context,node}=harness({record});context.renderImprovementProgress();const details=comparisonDetails(node);assert.equal(details.open,true);assert.match(textOf(details),/Median Before After Reduction.*Startup 10 5 5.*Total Unknown Unknown Unknown/);assert.equal(node('improvement-run').hidden,status==='closed');
});

test('an earlier incomplete assessment shows no fabricated medians or eligibility and labels missing quality unknown',()=>{
  const record=recordFor('baseline',Array.from({length:3},(_,i)=>({...beforeRun,id:'legacy-'+i,passed:null})),{});const {context,node}=harness({record});context.renderImprovementProgress();
  assert.equal(descendants(node('improvement-summary'),'table').length,0);assert.match(textOf(node('improvement-summary')),/0 passed, 0 failed, 3 unknown.*does not confirm baseline eligibility/);assert.equal(node('improvement-start-after').disabled,true);assert.match(textOf(node('improvement-runs')),/Quality unknown/);
});

for(const fail of [false,true])test(`pending run save freezes the submitted draft through polling and ${fail?'restores it on failure':'clears only after success'}`,async()=>{
  const {context,node,submit}=harness({record:recordFor('baseline',[beforeRun])});context.correctImprovementRun(beforeRun);node('improvement-passed').value='true';node('improvement-correction-reason').value='Corrected copied quality';node('improvement-run-note').value='Submitted note';
  let finish;const sent=[];context.saveImprovement=payload=>{sent.push(payload);return new Promise((resolve,reject)=>{finish=()=>fail?reject(new Error('Deferred save failed')):resolve(context.state.improvements[0]);});};
  await submit('improvement-run');assert.equal(sent.length,1);assert.equal(context.improvementBusy,true);
  const keys=['startupTokens','totalTokens','seconds','corrections','compactions','costUSD','run-task','passed','run-note','model','agentVersion','environment','counter','correction-reason'];for(const key of keys)assert.equal(node('improvement-'+key).disabled,true,key);
  context.renderImprovementProgress();for(const key of keys)assert.equal(node('improvement-'+key).disabled,true,'poll '+key);
  await node('improvement-clear-draft').listeners.click();assert.equal(node('improvement-run-note').value,'Submitted note');assert.equal(node('improvement-model').value,beforeRun.model);
  finish();await new Promise(resolve=>setImmediate(resolve));assert.equal(context.improvementBusy,false);assert.equal(node('improvement-run-note').disabled,false);assert.equal(node('improvement-correction-reason').disabled,!fail);
  assert.equal(node('improvement-run-note').value,fail?'Submitted note':'');assert.equal(node('improvement-correction-reason').value,fail?'Corrected copied quality':'');assert.equal(node('improvement-model').value,beforeRun.model);assert.equal(sent[0].note,'Submitted note');
});

test('pending phase transition freezes next-run inputs until the phase and cleared draft are confirmed',async()=>{
  const {context,node}=harness({record:recordFor('baseline',[],{baselineEligible:true})});let finish;context.saveImprovement=()=>new Promise(resolve=>{finish=()=>resolve(context.state.improvements[0]);});
  const pending=node('improvement-start-after').listeners.click({currentTarget:node('improvement-start-after')});assert.equal(node('improvement-run-note').disabled,true);context.renderImprovementProgress();assert.equal(node('improvement-run-task').disabled,true);finish();await pending;assert.equal(node('improvement-run-note').disabled,false);assert.equal(context.improvementBusy,false);
});


for(const verdict of ['incomparable','insufficient-metrics'])test(`ready ${verdict} evidence offers review or restore rather than an unavailable keep action`,()=>{
  const record=recordFor('candidate',[beforeRun,afterRun],{ready:true,verdict,warnings:['Conditions are missing, varied within a phase, or changed beyond the selected variable.']});const {context,node}=harness({record});context.renderImprovementProgress();const details=comparisonDetails(node);details.open=false;
  const visible=node('improvement-summary').children.filter(item=>item!==details).map(textOf).join(' ');assert.match(visible,/Next: review the comparison conditions and shared measurements, or restore/);assert.match(visible,/Conditions are missing, varied within a phase/);assert.doesNotMatch(visible,/keep or restore decision/);assert.equal(node('improvement-keep').hidden,true);
});

test('an unknown legacy candidate quality result is not relabelled as a definite verification failure',()=>{
  const record=recordFor('candidate',[beforeRun,{...afterRun,passed:null}],{ready:true,verdict:'regression',warnings:['At least one candidate task failed verification.']});const {context,node}=harness({record});context.renderImprovementProgress();const text=textOf(node('improvement-summary'));
  assert.match(text,/After quality: 0 passed, 0 failed, 1 unknown/);assert.match(text,/Candidate quality is unknown.*failed verification is not confirmed/);assert.doesNotMatch(text,/candidate task failed verification/);
});


for(const kind of ['unknown','increased','failed'])test(`actual legacy assessment with ${kind} candidate quality keeps the headline honest`,()=>{
  const before=Array.from({length:3},(_,i)=>({...beforeRun,id:'before-'+i,passed:true,startupTokens:10,totalTokens:30}));
  const after=Array.from({length:3},(_,i)=>({...beforeRun,id:'after-'+i,phase:'after',passed:i===0?undefined:kind==='failed'?false:true,startupTokens:kind==='increased'?20:10,totalTokens:30}));
  const record={...recordFor('candidate',[...before,...after]),variable:'configuration'};record.assessment=assessImprovement(record);assert.equal(record.assessment.ready,true);assert.equal(record.assessment.verdict,'regression');
  const {context,node}=harness({record});context.renderImprovementProgress();assert.equal(node('improvement-summary').children[0].textContent,kind==='unknown'?'Candidate quality is unknown':kind==='failed'?'Candidate quality check failed':'A measured result got worse');
  if(kind==='unknown'){assert.match(textOf(node('improvement-summary')),/After quality: 2 passed, 0 failed, 1 unknown/);assert.doesNotMatch(textOf(node('improvement-summary')),/A measured result got worse|candidate task failed verification/);}
  if(kind==='increased')assert.match(textOf(node('improvement-summary')),/metric increased/);
  if(kind==='failed')assert.match(textOf(node('improvement-summary')),/candidate task failed verification/);
});

test('equal before and after quality failures with improved measured tokens do not claim a result got worse',()=>{
  const before=Array.from({length:3},(_,i)=>({...beforeRun,id:'before-'+i,passed:i!==2,startupTokens:0,totalTokens:100}));
  const after=Array.from({length:3},(_,i)=>({...beforeRun,id:'after-'+i,phase:'after',passed:i!==2,startupTokens:0,totalTokens:90}));
  const record={...recordFor('candidate',[...before,...after]),variable:'configuration'};record.assessment=assessImprovement(record);
  assert.equal(record.assessment.ready,true);assert.equal(record.assessment.verdict,'regression');assert.equal(record.assessment.tasks[0].deltas.totalTokens.reduction,10);
  const {context,node}=harness({record});context.renderImprovementProgress();const summary=node('improvement-summary');
  assert.equal(summary.children[0].textContent,'Candidate quality check failed');assert.match(textOf(summary),/Before quality: 2 passed, 1 failed, 0 unknown\. After quality: 2 passed, 1 failed, 0 unknown/);assert.match(textOf(summary),/candidate task failed verification/);assert.doesNotMatch(textOf(summary),/A measured result got worse/);
});
