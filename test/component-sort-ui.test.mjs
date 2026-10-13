import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const helper = source.slice(source.indexOf('function sortComponents('), source.indexOf('function renderComponents('));
const context = vm.createContext({});
vm.runInContext(helper, context);
const ids = items => items.map(item => item.id);
const sort = (items, order) => Array.from(context.sortComponents(items, order));

test('cost sort places known skill and subagent values above unknowns, including known zero', () => {
  const items = [
    { id: 'null', name: 'A', type: 'skill', residentTokens: null },
    { id: 'undefined', name: 'B', type: 'skill' },
    { id: 'nan', name: 'C', type: 'skill', residentTokens: NaN },
    { id: 'infinity', name: 'D', type: 'skill', residentTokens: Infinity },
    { id: 'negative', name: 'E', type: 'skill', residentTokens: -10 },
    { id: 'config', name: 'F', type: 'config', residentTokens: 9000 },
    { id: 'server', name: 'G', type: 'mcp-server', residentTokens: 9000 },
    { id: 'string', name: 'H', type: 'skill', residentTokens: '50' },
    { id: 'zero', name: 'Zero', type: 'skill', residentTokens: 0 },
    { id: 'skill', name: 'Skill', type: 'skill', residentTokens: 100 },
    { id: 'subagent', name: 'Subagent', type: 'subagent', residentTokens: 200 },
  ];
  assert.deepEqual(ids(sort(items, 'cost')), ['subagent', 'skill', 'zero', 'null', 'undefined', 'nan', 'infinity', 'negative', 'config', 'server', 'string']);
});

test('equal costs and unknown values use names, then paths and IDs for stable ordering', () => {
  const items = [
    { id: 'b', name: 'Same', path: '/synthetic/b', type: 'skill', residentTokens: 5 },
    { id: 'd', name: 'Same', path: '/synthetic/a', type: 'subagent', residentTokens: 5 },
    { id: 'c', name: 'Same', path: '/synthetic/a', type: 'skill', residentTokens: 5 },
    { id: 'a', name: 'First', path: '/synthetic/z', type: 'skill', residentTokens: 5 },
    { id: 'unknown-z', name: 'Z', type: 'hook' },
    { id: 'unknown-a', name: 'A', type: 'hook' },
  ];
  assert.deepEqual(ids(sort(items, 'cost')), ['a', 'c', 'd', 'b', 'unknown-a', 'unknown-z']);
});

test('review default prioritizes both manual review flags and changed components', () => {
  const items = [
    { id: 'ordinary', name: 'A' },
    { id: 'used', name: 'B', review: { status: 'used', changed: false } },
    { id: 'flagged', name: 'D', review: { status: 'review' } },
    { id: 'changed', name: 'C', review: { status: 'used', changed: true } },
  ];
  assert.deepEqual(ids(sort(items)), ['changed', 'flagged', 'ordinary', 'used']);
});

test('review order puts plugin metadata after other types within each flag group, with stable ties', () => {
  const items = [
    { id: 'plugin', name: 'A plugin', type: 'plugin' },
    { id: 'changed-plugin', name: 'B plugin', type: 'plugin', review: { changed: true } },
    { id: 'flagged-plugin', name: 'A plugin', type: 'plugin', review: { status: 'review' } },
    { id: 'flagged-skill', name: 'Z skill', type: 'skill', review: { status: 'review' } },
    { id: 'tool', name: 'B tool', type: 'config' },
    { id: 'hook-b', name: 'Same', path: '/synthetic/b', type: 'hook' },
    { id: 'hook-a2', name: 'Same', path: '/synthetic/a', type: 'hook' },
    { id: 'hook-a1', name: 'Same', path: '/synthetic/a', type: 'hook' },
    { id: 'skill', name: 'Z skill', type: 'skill' },
  ];
  assert.deepEqual(ids(sort(items)), ['flagged-skill', 'flagged-plugin', 'changed-plugin', 'tool', 'hook-a1', 'hook-a2', 'hook-b', 'skill', 'plugin']);
  assert.deepEqual(ids(sort(items, 'cost')), ['flagged-plugin', 'plugin', 'changed-plugin', 'tool', 'hook-a1', 'hook-a2', 'hook-b', 'flagged-skill', 'skill']);
});

test('sorting does not mutate the input array, components or review evidence', () => {
  const review = Object.freeze({ status: 'review' });
  const a = Object.freeze({ id: 'a', name: 'Z', type: 'skill', residentTokens: 2, review });
  const b = Object.freeze({ id: 'b', name: 'A', type: 'subagent', residentTokens: 10 });
  const input = Object.freeze([a, b]);
  const result = sort(input, 'cost');
  assert.deepEqual(ids(input), ['a', 'b']); assert.deepEqual(ids(result), ['b', 'a']);
  assert.equal(result[0], b); assert.equal(result[1], a); assert.equal(a.review, review);
  assert.deepEqual(ids(sort(input)), ['a', 'b']);assert.deepEqual(ids(input), ['a', 'b']);assert.equal(a.review, review);
});

test('changing sort resets pagination and preserves the sort choice and review drafts', () => {
  const registrations = new Map(), draft = { note: 'Unsaved review evidence', status: 'review' };
  const nodes = new Map(['component-search', 'component-filter', 'component-sort'].map(id => [id, { value: id === 'component-sort' ? 'cost' : '', addEventListener(type, handler) { registrations.set(id, { type, handler }); } }]));
  let renders = 0;
  const app = vm.createContext({ $: id => nodes.get(id), componentPage: 4, componentDrafts: new Map([['component-a', draft]]), renderComponents() { renders++; } });
  const handler = source.split('\n').find(line => line.startsWith("for(const id of ['component-search','component-filter','component-sort']"));
  assert.ok(handler); vm.runInContext(handler, app);
  assert.equal(registrations.get('component-sort').type, 'change'); registrations.get('component-sort').handler();
  assert.equal(app.componentPage, 0); assert.equal(renders, 1); assert.equal(nodes.get('component-sort').value, 'cost');
  assert.equal(app.componentDrafts.get('component-a'), draft); assert.equal(draft.note, 'Unsaved review evidence');
});

test('the sorter stays within filtered components before pagination', () => {
  const renderer = source.slice(source.indexOf('function renderComponents('), source.indexOf('function openLoadingChat('));
  assert.match(renderer, /const items=sortComponents\(all\.filter/);
  assert.ok(renderer.indexOf("$('component-sort').value") < renderer.indexOf('items.slice(componentPage*25'));
  assert.match(renderer, /\['skill','subagent'\]\.includes\(item\.type\)/);
  assert.match(html, /<label>Sort components<select id="component-sort"><option value="review" selected>Needs review first<\/option><option value="cost">Largest estimated description cost<\/option>/);
  assert.match(html, /id="component-sort-note"[^>]*>Your flagged or changed files come first\. Otherwise, skills, tool setup and helpers appear before plugin metadata\. This order does not establish loading, use or benefit\./);
});
