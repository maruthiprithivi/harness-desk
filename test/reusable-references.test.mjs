import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReusableAnswer, reusablePrompt } from '../lib/reusable.mjs';

const request = { targetAgent: 'codex', invocation: 'explicit' };
const draft = extra => ({
  name: 'count-records', description: 'Count supplied fixture records.',
  instructions: 'Run run.mjs with the supplied fixture.',
  scripts: [{ name: 'run.mjs', content: 'console.log("fixture");' }],
  verification: 'Compare the count with the fixture.', trigger: 'Invoke for a supplied fixture.',
  nonTrigger: 'Exclude remote data.', ...extra,
});
const parse = (extra = {}, options = {}) => parseReusableAnswer(JSON.stringify(draft(extra)), { ...request, ...options });

test('workflow Markdown links resolve to their bundled script without capturing labels or punctuation', () => {
  for (const link of [
    '[the script](../scripts/count-records/run.mjs).',
    '[`run.mjs`](../scripts/count-records/run.mjs), then compare.',
    '[script](<../scripts/count-records/run.mjs>);',
    '[script](../scripts/count-records/run.mjs "Fixture runner")!',
    '[script](../scripts/count-records/run.mjs "Runner\'s fixture")!',
    '[script](../scripts/count-records/run.mjs \'Runner "fixture"\')!',
  ]) {
    const bundle = parse({ instructions: 'Read ' + link });
    assert.ok(bundle.files.find(file => file.path === 'workflows/count-records.md').content.includes(link));
  }
  const mixed = parse({ instructions: 'Read [the script](../scripts/count-records/run.mjs). Run run.mjs, or from the bundle root run node scripts/count-records/run.mjs.' });
  assert.equal(mixed.name, 'count-records');
  assert.equal(parse({ instructions: 'Use [missing.mjs][runner].\n\n[runner]: ../scripts/count-records/run.mjs "Fixture runner"' }).name, 'count-records');
  for (const reference of ['run.mjs', 'scripts/count-records/run.mjs', '../../scripts/count-records/run.mjs']) {
    assert.throws(() => parse({ instructions: 'Use [runner][id].\n\n[id]: ' + reference }), /outside this bundle/);
  }
});

test('workflow paths must be exact owner-relative links or documented command shorthands', () => {
  for (const reference of ['run.mjs', 'scripts/count-records/run.mjs', '../scripts/count-records/run.mjs']) {
    assert.equal(parse({ instructions: 'Run `' + reference + '`.' }).name, 'count-records');
  }
  for (const reference of [
    './run.mjs', '../../scripts/count-records/run.mjs', '../scripts/other/run.mjs',
    '../scripts/count-records/missing.mjs', '../scripts/count-records/../count-records/run.mjs',
    '../scripts/count-records/./run.mjs', '../scripts//count-records/run.mjs',
    '/scripts/count-records/run.mjs', '//host/scripts/count-records/run.mjs',
    '~/scripts/count-records/run.mjs', 'file:///scripts/count-records/run.mjs',
    'https://example.invalid/run.mjs', 'C:/scripts/count-records/run.mjs',
    'C:\\scripts\\count-records\\run.mjs', '..\\scripts\\count-records\\run.mjs',
    '../scripts/count-records/run.mjs#section', '../scripts/count-records/run.mjs?fixture=1',
    '../scripts/count-records/%2e%2e/run.mjs', '../scripts/count-records/run.mjs.bak',
  ]) {
    assert.throws(() => parse({ instructions: 'Read `' + reference + '`.' }), /outside this bundle|portable/, reference);
    assert.throws(() => parse({ instructions: 'Read [script](' + reference + ').' }), /outside this bundle|portable/, reference);
  }
  for (const reference of ['run.mjs', 'scripts/count-records/run.mjs']) {
    assert.throws(() => parse({ instructions: 'Read [script](' + reference + ').' }), /outside this bundle/);
    assert.throws(() => parse({ instructions: 'Read [script](' + reference + ' "Runner\'s fixture").' }), /outside this bundle/);
    assert.throws(() => parse({ instructions: 'Read [script](' + reference + ' "unclosed).' }), /outside this bundle/);
  }
  assert.throws(() => parse({ instructions: 'Read [valid](../scripts/count-records/run.mjs), then missing.mjs.' }), /outside this bundle/);
});

test('verification and trigger Markdown use the same file owner and reject eager imports', () => {
  for (const field of ['instructions', 'verification', 'trigger', 'nonTrigger']) {
    assert.equal(parse({ [field]: 'Use [script](../scripts/count-records/run.mjs).' }).name, 'count-records');
    assert.throws(() => parse({ [field]: 'Read ../../scripts/count-records/run.mjs.' }), /outside this bundle/);
    for (const eager of ['@details.md', 'First read @details.md.', 'Read `@../details.md`.', 'Read (@../details.md).', 'Read @procedure.txt.', 'Read @config.yaml.']) {
      assert.throws(() => parse({ [field]: eager }), /@imports/, field + ': ' + eager);
    }
  }
  assert.equal(parse({ verification: 'Ask fixture@example.invalid about the fixture.' }).name, 'count-records');
});

test('script imports resolve from the importing script rather than the workflow', () => {
  const scripts = [
    { name: 'run.mjs', content: 'import { value } from "./helper.mjs";\nexport { value } from "./helper.mjs";\nconst module = await import("./helper.mjs");\nconsole.log(value, module);' },
    { name: 'helper.mjs', content: 'export const value = 1;' },
  ];
  assert.equal(parse({ scripts }).files.filter(file => file.path.startsWith('scripts/')).length, 2);
  for (const reference of ['./missing.mjs', './helper.mjs.', './helper.mjs:', '../count-records/helper.mjs', '../scripts/count-records/helper.mjs', '../../scripts/count-records/helper.mjs', 'scripts/count-records/helper.mjs', '/helper.mjs', 'file:///helper.mjs', '.\\helper.mjs']) {
    assert.throws(() => parse({ scripts: [{ ...scripts[0], content: 'import "' + reference + '";' }, scripts[1]] }), /outside this bundle|portable/, reference);
  }
  for (const content of ['import "helper.mjs";', 'import { value } from "helper.mjs";', 'const helper = await import("helper.mjs");', 'export { value } from "helper.mjs";', 'export * from "helper.mjs";', 'const sibling = "helper.mjs";']) {
    assert.throws(() => parse({ scripts: [{ ...scripts[0], content }, scripts[1]] }), /outside this bundle/);
  }
});

test('Claude reserved skill names reject only Claude bundles and are documented in its prompt', () => {
  for (const name of ['synced', 'anthropic-skills']) {
    assert.throws(() => parse({ name }, { targetAgent: 'claude' }), /reserved by Claude/);
    assert.equal(parse({ name }).name, name);
  }
  assert.ok(reusablePrompt({ ...request, targetAgent: 'claude' }).includes('Claude names synced and anthropic-skills are reserved.'));
  assert.equal(reusablePrompt(request).includes('Claude names synced and anthropic-skills are reserved.'), false);
});
