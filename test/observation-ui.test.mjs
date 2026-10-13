import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const controls = slice('function updateControls()', 'function costBars(');
const dialog = slice('function syncObservationScope()', 'const improvementMetrics =');
const action = slice('async function action(', 'function scopedItems(');
const handlers = slice("$('observation-open').addEventListener", "$('repo-budget-scope').addEventListener");

function harness({ fail = false, global = false, pause = false } = {}) {
  const nodes = new Map(), calls = [], errors = [];
  let release;
  const pending = pause ? new Promise(resolve => { release = resolve; }) : null;
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      value: '', textContent: '', disabled: false, hidden: true, open: false, dataset: {}, options: [], listeners: {},
      addEventListener(type, listener) { this.listeners[type] = listener; },
      append(option) { this.options.push(option); },
      querySelector() { return node('observation-save'); },
      showModal() { this.open = true; }, close() { this.open = false; },
      reset() { for (const key of ['startup', 'window', 'paths', 'note']) node('observation-' + key).value = ''; },
    });
    return nodes.get(id);
  };
  const setOptions = (select, options, emptyLabel, preferred = select.value) => {
    select.options = (emptyLabel === undefined ? [] : [{ value: '' }]).concat(options);
    select.value = select.options.some(option => option.value === preferred) ? preferred : select.options[0]?.value || '';
  };
  const context = vm.createContext({
    nestedLoadingDirectory: () => false, loading: null, loadingError: '',
    $: node, setOptions, observationScope: null, observationDrafts: new Map(), advanced: false, activeRepo: global ? '' : '/synthetic/repo-a', selectedAgent: 'codex', initialRender: false,
    state: { inventory: { repos: ['/synthetic/repo-a'], items: [] }, agents: [{ id: 'codex' }, { id: 'claude' }], conversations: [], gaps: [] },
    array: value => Array.isArray(value) ? value : [], repoPath: value => value, repoName: value => value,
    agentName: value => value, agentOptions: () => context.state.agents.map(agent => ({ value: agent.id, label: agent.id })),
    element: (tag, className, text) => ({ textContent: text, value: '' }),
    number: String, time: () => '', date: () => '', attentionGaps: () => [], beginnerFileCount: () => 0,
    clearError() {}, updateChatAvailability() {}, showError(error) { errors.push(error.message); },
    lines: value => value.split(/\r?\n/).map(line => line.trim()).filter(Boolean),
    api: async (path, body) => { calls.push({ path, body }); if (pending) await pending; if (fail) throw new Error('Reading was not saved'); },
    refresh: async () => {}, refreshLoading: async force => { assert.equal(force, true); }, toast() {},
  });
  vm.runInContext(controls + dialog + action + handlers, context);
  vm.runInContext('updateControls(); openObservation(true);', context);
  node('observation-startup').value = '120'; node('observation-window').value = '1000';
  node('observation-paths').value = 'reported-one\nreported-two'; node('observation-note').value = 'Reported by the chosen agent';
  const pollAfterScopeChange = () => {
    context.activeRepo = '/synthetic/repo-b'; context.selectedAgent = 'claude';
    context.state.inventory.repos = ['/synthetic/repo-b']; context.state.agents = [{ id: 'claude' }];
    node('observation-repo').value = context.activeRepo; node('observation-agent').value = context.selectedAgent;
    vm.runInContext('updateControls()', context);
  };
  const submit = async () => {
    node('observation-form').listeners.submit({ preventDefault() {}, currentTarget: node('observation-form'), submitter: null });
    await new Promise(resolve => setImmediate(resolve));
  };
  return { context, node, calls, errors, pollAfterScopeChange, submit, release };
}

test('there is one dialog form with required bounded readings and visible comparison conditions', () => {
  assert.equal([...html.matchAll(/id="observation-form"/g)].length, 1);
  for (const id of ['observation-startup', 'observation-window']) assert.match(html, new RegExp(`id="${id}"[^>]*max="10000000"[^>]*required`));
  assert.match(html, /<details id="improvement-conditions" open>/);
});

test('polling and dashboard changes preserve the beginner scope and unsaved reading', async () => {
  const { node, calls, pollAfterScopeChange, submit } = harness();
  pollAfterScopeChange();
  assert.equal(node('observation-agent').value, 'codex'); assert.equal(node('observation-repo').value, '/synthetic/repo-a');
  assert.equal(node('observation-agent').disabled, true); assert.equal(node('observation-repo').disabled, true);
  assert.equal(node('observation-startup').value, '120'); assert.equal(node('observation-note').value, 'Reported by the chosen agent');
  await submit();
  assert.equal(calls.length, 1); assert.equal(calls[0].path, '/api/observation');
  assert.equal(calls[0].body.agent, 'codex'); assert.equal(calls[0].body.repo, '/synthetic/repo-a');
  assert.equal(calls[0].body.startupTokens, 120); assert.equal(calls[0].body.windowTokens, 1000);
  assert.equal(node('observation-dialog').open, false); assert.equal(node('observation-save').disabled, false);
});

test('a global beginner reading remains global after a repository is selected', async () => {
  const { calls, pollAfterScopeChange, submit } = harness({ global: true });
  pollAfterScopeChange(); await submit();
  assert.equal(calls[0].body.repo, ''); assert.equal(calls[0].body.agent, 'codex');
});

test('a failed null-submitter save keeps the dialog, draft and fixed scope available', async () => {
  const { node, calls, errors, pollAfterScopeChange, submit } = harness({ fail: true });
  pollAfterScopeChange(); await submit();
  assert.equal(calls.length, 1); assert.deepEqual(errors, ['Reading was not saved']);
  assert.equal(node('observation-dialog').open, true); assert.equal(node('observation-save').disabled, false);
  assert.equal(node('observation-startup').value, '120'); assert.equal(node('observation-window').value, '1000');
  assert.equal(node('observation-note').value, 'Reported by the chosen agent'); assert.equal(node('observation-agent').value, 'codex');
  assert.equal(node('observation-error').hidden, false); assert.equal(node('observation-error').textContent, 'Reading was not saved');
});

test('advanced observation scope remains editable and the submitted choice is used', async () => {
  const { context, node, calls, submit } = harness();
  vm.runInContext('closeObservation(); openObservation(false)', context);
  assert.equal(node('observation-agent').disabled, false); assert.equal(node('observation-repo').disabled, false);
  node('observation-agent').value = 'claude'; node('observation-repo').value = '';
  await submit(); assert.equal(calls[0].body.agent, 'claude'); assert.equal(calls[0].body.repo, '');
});

test('canceled beginner readings stay with their original agent and repository', () => {
  const { context, node } = harness();
  vm.runInContext('closeObservation()', context);
  context.selectedAgent = 'claude'; context.activeRepo = '/synthetic/repo-b';
  vm.runInContext('openObservation(true)', context);
  for (const key of ['startup','window','paths','note']) assert.equal(node('observation-' + key).value, '');
  node('observation-startup').value = '450'; vm.runInContext('closeObservation()', context);
  context.selectedAgent = 'codex'; context.activeRepo = '/synthetic/repo-a';
  vm.runInContext('openObservation(true)', context);
  assert.equal(node('observation-startup').value, '120'); assert.equal(node('observation-window').value, '1000');
  assert.equal(node('observation-note').value, 'Reported by the chosen agent');
});

test('a blank startup reading stays unknown and is never posted as zero', async () => {
  const { node, calls, submit } = harness(); node('observation-startup').value = '';
  await submit();
  assert.equal(calls.length, 0); assert.equal(node('observation-dialog').open, true);
  assert.match(node('observation-error').textContent, /Copy both token numbers/);
  assert.equal(node('observation-save').disabled, false);
});

test('an actual measured zero is accepted', async () => {
  const { node, calls, submit } = harness(); node('observation-startup').value = '0';
  await submit(); assert.equal(calls.length, 1); assert.equal(calls[0].body.startupTokens, 0);
});

test('a pending save prevents closing or reopening the draft under a new scope', async () => {
  const { context, node, calls, submit, release } = harness({ pause: true });
  await submit(); assert.equal(calls.length, 1); assert.equal(node('observation-save').disabled, true);
  assert.equal(node('observation-close').disabled, true); assert.equal(node('observation-cancel').disabled, true);
  node('observation-dialog').listeners.cancel({ preventDefault() {} });
  context.selectedAgent = 'claude'; context.activeRepo = '/synthetic/repo-b';
  vm.runInContext('openObservation(true)', context);
  assert.equal(node('observation-dialog').open, true); assert.equal(context.observationScope.agent, 'codex');
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(node('observation-dialog').open, false); assert.equal(node('observation-save').disabled, false);
  assert.equal(node('observation-close').disabled, false); assert.equal(node('observation-cancel').disabled, false);
});
