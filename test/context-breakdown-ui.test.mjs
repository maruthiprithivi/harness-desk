import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const functions = slice('const contextBreakdownIds =', 'function syncObservationScope()');
const action = slice('async function action(', 'function scopedItems(');
const handlers = slice("for (const id of ['context-breakdown-close'", "$('observation-open').addEventListener");
const ids = ['systemPrompt','tools','mcp','skills','agents','memory','messages','free','reserved'];

function harness({ fail = false, pause = false, repo = '/synthetic/repo-a' } = {}) {
  const nodes = new Map(), calls = [], errors = [];
  let release;
  const pending = pause ? new Promise(resolve => { release = resolve; }) : null;
  const makeNode = (tag = 'div', className = '', text = '') => {
    const node = {
      tag, className, textContent: text, value: '', disabled: false, hidden: true, open: false, dataset: {}, style: {}, children: [], listeners: {},
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      setAttribute(key, value) { this[key] = value; },
      addEventListener(type, listener) { this.listeners[type] = listener; },
      showModal() { this.open = true; }, close() { this.open = false; },
      reset() { for (const id of [...ids,'report']) get('context-breakdown-' + id).value = ''; get('context-breakdown-stage').value = 'conversation'; },
    };
    Object.defineProperty(node, 'id', { set(id) { nodes.set(id, node); }, get() { return [...nodes].find(([,value]) => value === node)?.[0]; } });
    return node;
  };
  const get = id => { if (!nodes.has(id)) nodes.set(id, makeNode()); return nodes.get(id); };
  const context = vm.createContext({
    nestedLoadingDirectory: () => false,
    $: get, state: { contextCategories: ids.map(id => ({ id, label: id === 'messages' ? 'Conversation, including your prompts' : id, description: id === 'messages' ? 'User prompts, replies and tool results may be combined.' : 'Reported category.' })), contextBreakdowns: [] },
    activeRepo: repo, selectedAgent: 'claude', contextBreakdownScope: null, contextBreakdownBusy: false, contextBreakdownDrafts: new Map(),
    array: value => Array.isArray(value) ? value : [], agentName: value => value, repoName: value => value,
    date: value => value, time: () => '', element: makeNode,
    button: (label, className, fn) => { const node = makeNode('button',className,label); node.addEventListener('click',fn); return node; },
    empty: (title, detail) => makeNode('div','empty',title + ' ' + detail), badge: (text, tone) => makeNode('span',tone,text),
    panel: (title, detail, body, button) => { const node = makeNode('div','panel',title + ' ' + detail); node.append(body,button); return node; },
    clearError() {}, showError(error) { errors.push(error.message); }, updateChatAvailability() {}, toast() {},
    api: async (path, body) => { calls.push({ path, body }); if (pending) await pending; if (fail) throw new Error('Sensitive report must never be shown'); return { percentages: { tools: 12, memory: 0 } }; },
    refresh: async () => { vm.runInContext('renderContextBreakdowns()',context); },
  });
  vm.runInContext(action + functions + handlers,context);
  vm.runInContext('openContextBreakdown()',context);
  const run = expression => vm.runInContext(expression,context);
  const text = node => [node.textContent,...node.children.map(text)].join(' ');
  return { context, node: get, calls, errors, release, run, text };
}
const record = (repo, percentages, extra = {}) => ({ agent: 'claude', repo, percentages, at: '2026-10-01T00:00:00Z', stage: 'startup', ...extra });

test('manual fields are bounded optional percentages and the guide uses the context report', () => {
  const { node } = harness();
  for (const id of ids) {
    assert.equal(node('context-breakdown-' + id).type, 'number');
    assert.equal(node('context-breakdown-' + id).max, '100');
    assert.equal(node('context-breakdown-' + id).step, 'any');
    assert.notEqual(node('context-breakdown-' + id).required, true);
  }
  assert.match(node('context-breakdown-guide').textContent, /run \/context/); assert.doesNotMatch(html, /\/usage/);
  assert.match(html, /<details id="context-breakdown-paste" open>/);
  assert.equal(node('context-breakdown-stage').value,'conversation');
  assert.match(html,/id="context-breakdown-report"[^>]*maxlength="32000"/);
});

test('the whole-window display keeps unknowns, zero and unattributed remainder distinct', () => {
  const { context, node, run, text } = harness();
  context.state.contextBreakdowns = [record(context.activeRepo,{ tools: 25, memory: 0 })];
  run('renderContextBreakdowns()');
  const display = text(node('context-breakdown-beginner'));
  assert.match(display, /whole context window as its denominator/);
  const visibleBody=node('context-breakdown-beginner').children[0].children[0];
  assert.equal(visibleBody.children.some(child=>child.tag==='p' && /Conversation includes user prompts/.test(child.textContent)),false);
  const meanings=visibleBody.children.find(child=>child.className==='context-breakdown-meanings');assert.equal(meanings.open,false);assert.match(text(meanings),/Conversation includes user prompts, replies and tool activity when combined in the report\. Memory does not separate global and repository shares\./);assert.match(text(meanings),/bytes \/ 4.*not measure exact tokens/);
  assert.match(display, /tools 25%/); assert.match(display, /memory 0%/);
  assert.match(display, /free Unknown/); assert.match(display, /Conversation, including your prompts Unknown/);
  assert.match(display, /Unattributed 75%/); assert.match(display, /not assumed to be free space/);
  assert.match(display, /not live/); assert.match(display, /Fresh startup/);
  assert.match(display,/Recorded 2026-10-01/);
  const body=node('context-breakdown-beginner').children[0].children[0],legend=body.children.find(child=>child.className==='context-breakdown-legend');
  const swatch=legend.children.at(-1).children[0].children[0];assert.equal(swatch.className,'context-breakdown-swatch');assert.equal(swatch.dataset.category,'unattributed');assert.equal(swatch['aria-hidden'],'true');
  assert.match(css,/\.context-breakdown-segment\[data-category="unattributed"\],\.context-breakdown-swatch\[data-category="unattributed"\]\{background:repeating-linear-gradient/);
});

test('beginner missing context is concise and unknown; guidance is expandable with scope-bound poll preservation',()=>{
  const h=harness();h.run('renderContextBreakdowns()');let body=h.node('context-breakdown-beginner').children[0].children[0],details=body.children.find(child=>child.className==='context-breakdown-meanings');assert.equal(details.open,false);assert.match(h.text(body.children.find(child=>child.className==='empty')),/Context shares unknown.*No percentages are inferred/);assert.doesNotMatch(h.text(body.children.find(child=>child.className==='empty')),/system instructions|\/context/);assert.match(h.text(details),/In Claude Code, run \/context/);assert.equal(body.children.some(child=>child.className==='context-breakdown-bar'),false);
  details.open=true;details.listeners.toggle();h.run('renderContextBreakdowns()');body=h.node('context-breakdown-beginner').children[0].children[0];assert.equal(body.children.find(child=>child.className==='context-breakdown-meanings').open,true);h.context.activeRepo='/synthetic/other';h.run('renderContextBreakdowns()');assert.equal(h.node('context-breakdown-beginner').children[0].children[0].children.find(child=>child.className==='context-breakdown-meanings').open,false);h.context.activeRepo='/synthetic/repo-a';h.run('renderContextBreakdowns()');assert.equal(h.node('context-breakdown-beginner').children[0].children[0].children.find(child=>child.className==='context-breakdown-meanings').open,true);assert.equal(h.calls.length,0);
});

test('advanced context keeps its explanatory paragraph visible and recorded chart unchanged',()=>{
  const h=harness();h.context.state.contextBreakdowns=[record(h.context.activeRepo,{tools:25,memory:0})];h.run('renderContextBreakdowns()');const body=h.node('context-breakdown-advanced').children[0].children[0];assert.ok(body.children.some(child=>child.tag==='p'&&/Conversation includes user prompts/.test(child.textContent)));assert.match(h.text(body),/tools 25%.*memory 0%.*free Unknown.*Unattributed 75%/);assert.equal(h.calls.length,0);
});

test('report paste leads, manual fields start collapsed and reopen when a draft has values',()=>{
  const {node,run}=harness();const form=html.slice(html.indexOf('<form id="context-breakdown-form"'),html.indexOf('</form>',html.indexOf('<form id="context-breakdown-form"')));
  const pasteStart=form.indexOf('<details id="context-breakdown-paste"'),pasteEnd=form.indexOf('</details>',pasteStart),fieldsStart=form.indexOf('<div id="context-breakdown-fields"');
  assert.ok(pasteStart>=0 && pasteEnd<fieldsStart);assert.match(form,/<summary>Paste a context report<\/summary>/);assert.equal(node('context-breakdown-paste').open,true);
  assert.match(form,/<details id="context-breakdown-manual"><summary>Enter or review percentages manually<\/summary>/);assert.equal(node('context-breakdown-manual').open,false);
  node('context-breakdown-report').value='Synthetic report';node('context-breakdown-tools').value='4';node('context-breakdown-paste').open=false;run('closeContextBreakdown(); openContextBreakdown()');
  assert.equal(node('context-breakdown-paste').open,true);assert.equal(node('context-breakdown-report').value,'Synthetic report');assert.equal(node('context-breakdown-tools').value,'4');
  assert.equal(node('context-breakdown-manual').open,true);
});

test('beginner hides an empty report panel and exposes no manual import action',()=>{
  const h=harness();h.run('renderContextBreakdowns()');assert.equal(h.node('context-breakdown-beginner').hidden,true);assert.equal(h.node('context-breakdown-add-beginner').hidden,true);assert.equal(h.node('context-breakdown-advanced').hidden,false);assert.equal(h.node('context-breakdown-add-advanced').hidden,false);assert.equal(h.node('context-breakdown-add-advanced').textContent,'Import a context report');
});

test('Claude guidance gives its context command while Codex guidance is conditional and remains fixed to the draft',()=>{
  const {context,node,run,text}=harness();run('renderContextBreakdowns()');assert.match(text(node('context-breakdown-beginner')),/In Claude Code, run \/context/);
  context.selectedAgent='codex';run('renderContextBreakdowns()');const empty=text(node('context-breakdown-beginner'));assert.match(empty,/If codex provides a category report/);assert.match(empty,/If no such report is available, leave unavailable categories blank/);assert.doesNotMatch(empty,/\/context|\/usage/);
  assert.match(node('context-breakdown-guide').textContent,/In Claude Code, run \/context/);run('closeContextBreakdown(); openContextBreakdown()');
  assert.match(node('context-breakdown-guide').textContent,/If codex provides a category report/);assert.doesNotMatch(node('context-breakdown-guide').textContent,/\/context|\/usage/);assert.equal(context.contextBreakdownScope.agent,'codex');
});

test('latest appended exact scope snapshot is selected; global never combines repositories', () => {
  const { context, node, run, text } = harness({repo:''});
  context.state.contextBreakdowns = [record('',{ tools: 1 }),record('/synthetic/repo-a',{ tools: 90 }),record('',{ tools: 7 },{stage:'conversation'}),record('',{ tools: 88 },{agent:'codex'})];
  run('renderContextBreakdowns()');
  const display = text(node('context-breakdown-advanced'));
  assert.match(display, /tools 7%/); assert.doesNotMatch(display, /tools (90|88|1)%/);
  assert.match(display, /Global setup only/); assert.match(display, /During a conversation/);
});

test('roundoff scales only bar widths and leaves percentage labels as reported', () => {
  const { context, node, run, text } = harness();
  context.state.contextBreakdowns = [record(context.activeRepo,{ tools: 50.2, messages: 50.2 })];
  run('renderContextBreakdowns()');
  const root = node('context-breakdown-beginner'), display = text(root);
  assert.match(display, /tools 50.2%/); assert.match(display, /rounding/); assert.doesNotMatch(display,/Unattributed/);
  const bar = root.children[0].children[0].children.find(child => child.className === 'context-breakdown-bar');
  assert.equal(bar.children.length,2); assert.equal(bar.children[0].style.width,'50%');
});

test('empty panel offers recording without invented category percentages', () => {
  const { node, run, text } = harness(); run('renderContextBreakdowns()');
  const display = text(node('context-breakdown-beginner'));
  assert.match(display, /Context shares unknown/); assert.doesNotMatch(display, /\d+%/);
  assert.match(display,/system instructions, built-in tools, MCPs, skills, memory, conversation and free space/);
});

test('save captures scope at open, omits blanks, preserves zero and never sends the pasted report', async () => {
  const { context, node, calls, run } = harness({repo:''});
  node('context-breakdown-tools').value = '15'; node('context-breakdown-memory').value = '0';
  node('context-breakdown-report').value = 'Synthetic private draft'; node('context-breakdown-stage').value = 'conversation';
  context.activeRepo = '/synthetic/repo-b'; context.selectedAgent = 'codex'; run('renderContextBreakdowns()');
  await run('saveContextBreakdown()');
  assert.equal(calls.length,1); assert.equal(calls[0].body.repo,''); assert.equal(calls[0].body.agent,'claude');
  assert.equal(calls[0].body.stage,'conversation'); assert.deepEqual(JSON.parse(JSON.stringify(calls[0].body.percentages)),{tools:15,memory:0});
  assert.equal('report' in calls[0].body,false); assert.equal('note' in calls[0].body,false);
  assert.equal(node('context-breakdown-report').value,''); assert.equal(context.contextBreakdownDrafts.size,0);
  assert.equal(node('context-breakdown-dialog').open,false);
});

test('empty or overlapping fields never save; failed API keeps the draft available', async () => {
  const { node, calls, run, text } = harness({fail:true});
  await run('saveContextBreakdown()'); assert.equal(calls.length,0); assert.match(text(node('context-breakdown-error')),/at least one/);
  node('context-breakdown-tools').value='70'; node('context-breakdown-mcp').value='40';
  await run('saveContextBreakdown()'); assert.equal(calls.length,0); assert.match(text(node('context-breakdown-error')),/overlapping/);
  node('context-breakdown-mcp').value=''; await run('saveContextBreakdown()');
  assert.equal(calls.length,1); assert.equal(node('context-breakdown-tools').value,'70'); assert.equal(node('context-breakdown-dialog').open,true);
  assert.doesNotMatch(text(node('context-breakdown-error')),/Sensitive/);
});

test('parse failure preserves manual fields and successful parsing replaces the report preview', async () => {
  const failed = harness({fail:true}); failed.node('context-breakdown-tools').value='18';
  await failed.run('parseContextBreakdown()'); assert.equal(failed.node('context-breakdown-tools').value,'18');
  assert.match(failed.node('context-breakdown-error').textContent,/fields are unchanged/);
  const parsed = harness(); parsed.node('context-breakdown-skills').value='42';
  await parsed.run('parseContextBreakdown()');
  assert.equal(parsed.node('context-breakdown-tools').value,'12'); assert.equal(parsed.node('context-breakdown-memory').value,'0');
  assert.equal(parsed.node('context-breakdown-skills').value,''); assert.match(parsed.node('context-breakdown-preview').textContent,/Preview and edit/);
});

test('cancel retains each scope draft including stage and temporary report', () => {
  const { context, node, run } = harness();
  node('context-breakdown-tools').value='0'; node('context-breakdown-stage').value='conversation'; node('context-breakdown-report').value='Synthetic draft';
  run('closeContextBreakdown()'); context.selectedAgent='codex'; run('openContextBreakdown()');
  assert.equal(node('context-breakdown-tools').value,''); run('closeContextBreakdown()');
  context.selectedAgent='claude'; run('openContextBreakdown()');
  assert.equal(node('context-breakdown-tools').value,'0'); assert.equal(node('context-breakdown-stage').value,'conversation'); assert.equal(node('context-breakdown-report').value,'Synthetic draft');
});

test('pending parse gates closing, saving, filling and reopening under another scope', async () => {
  const { context, node, run, calls, release } = harness({pause:true});
  const pending = run('parseContextBreakdown()');
  for (const id of ['close','cancel','parse','save','stage','report',...ids]) assert.equal(node('context-breakdown-'+id).disabled,true);
  context.activeRepo='/synthetic/repo-b'; node('context-breakdown-dialog').listeners.cancel({preventDefault(){}});
  run('openContextBreakdown()'); await run('saveContextBreakdown()'); await run('parseContextBreakdown()');
  assert.equal(calls.length,1); assert.equal(context.contextBreakdownScope.repo,'/synthetic/repo-a'); assert.equal(node('context-breakdown-dialog').open,true);
  release(); await pending; assert.equal(node('context-breakdown-save').disabled,false);
});

test('pending save keeps its scope and draft protected until the request finishes', async () => {
  const { context, node, run, calls, release } = harness({pause:true});
  node('context-breakdown-tools').value='0'; node('context-breakdown-report').value='Synthetic draft';
  const pending = run('saveContextBreakdown()');
  context.selectedAgent='codex'; context.activeRepo='/synthetic/repo-b';
  run('closeContextBreakdown(); openContextBreakdown(); renderContextBreakdowns()');
  await run('parseContextBreakdown()'); await run('saveContextBreakdown()');
  assert.equal(calls.length,1); assert.equal(calls[0].body.agent,'claude');
  assert.equal(node('context-breakdown-dialog').open,true); assert.equal(node('context-breakdown-report').value,'Synthetic draft');
  assert.equal(node('context-breakdown-close').disabled,true);
  release(); await pending;
  assert.equal(node('context-breakdown-dialog').open,false); assert.equal(node('context-breakdown-close').disabled,false);
  assert.equal(node('context-breakdown-report').value,'');
});
