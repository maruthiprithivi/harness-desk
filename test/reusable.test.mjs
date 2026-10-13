import test from 'node:test';
import assert from 'node:assert/strict';
import { createReusableRequest, reusablePrompt, parseReusableAnswer } from '../lib/reusable.mjs';

const evidence = (occurrences = 3, distinctSessions = 2, extra = {}) => ({ occurrences, distinctSessions, agents: ['codex'], sessions: ['private-session'], examples: ['private-example'], ...extra });
const context = { agents: ['codex', 'claude'], inventory: { repos: ['/fixture/repo', '/fixture/other'] }, patterns: { candidates: [{
  id: 'candidate', pattern: 'Summarize fixture counts', kind: 'command', ...evidence(99, 9),
  repos: ['/fixture/repo', '/fixture/other'], evidenceByRepo: { '/fixture/repo': evidence(), '/fixture/other': evidence(50, 6, { agents: ['claude'] }), '': evidence(4, 2) },
}] } };
const request = extra => createReusableRequest({ task: 'Count supplied fixture records', ...extra }, context);
const draft = extra => ({ name: 'count-records', description: 'Count supplied records with bounded output.', instructions: 'Validate the supplied input. Run run.mjs with its file argument.', scripts: [{ name: 'run.mjs', content: 'import fs from "node:fs";\nconsole.log("fixture draft");' }], verification: 'Compare the reported count with a small synthetic fixture.', trigger: 'Use when asked to count fixture records.', nonTrigger: 'Do not use for remote data.', ...extra });
const parse = (extra = {}, options = {}) => parseReusableAnswer(JSON.stringify(draft(extra)), request(options));
const byteTokens = value => Math.ceil(Buffer.byteLength(value) / 4);

test('request defaults are fixed, redacted and frozen without caller fields', () => {
  const value = request({ notes: 'token=synthetic-value', unrelated: 'discard' });
  assert.deepEqual(Object.keys(value), ['task', 'candidate', 'notes', 'repo', 'placement', 'targetAgent', 'invocation', 'autoSave']);
  assert.equal(value.targetAgent, 'codex');
  assert.equal(value.placement, 'global');
  assert.equal(value.invocation, 'explicit');
  assert.equal(value.autoSave, false);
  assert.equal(value.candidate, null);
  assert.match(value.notes, /REDACTED/);
  assert.ok(Object.isFrozen(value));
  assert.throws(() => { value.task = 'changed'; }, TypeError);
});

test('candidate request uses only exact scoped evidence and excludes other provenance', () => {
  const value = request({ task: undefined, repo: '/fixture/repo', candidateId: 'candidate' });
  assert.equal(value.placement, 'repo');
  assert.equal(value.task, '');
  assert.deepEqual(value.candidate, { id:'candidate', pattern: 'Summarize fixture counts', kind: 'command', occurrences: 3, distinctSessions: 2, agents: ['codex'] });
  assert.ok(Object.isFrozen(value.candidate));
  assert.ok(Object.isFrozen(value.candidate.agents));
  for (const hidden of ['private-session', 'private-example', '/fixture/other', 'evidenceByRepo']) assert.equal(JSON.stringify(value).includes(hidden), false);
  const global = request({ candidateId: 'candidate' });
  assert.equal(global.candidate.occurrences, 4);
  const insufficient = structuredClone(context);
  insufficient.patterns.candidates[0].evidenceByRepo['/fixture/repo'] = evidence(2, 2);
  assert.throws(() => createReusableRequest({ repo: '/fixture/repo', candidateId: 'candidate' }, insufficient), /scoped candidate/);
  insufficient.patterns.candidates[0].evidenceByRepo['/fixture/repo'] = evidence(3, 1);
  assert.throws(() => createReusableRequest({ repo: '/fixture/repo', candidateId: 'candidate' }, insufficient), /scoped candidate/);
  delete insufficient.patterns.candidates[0].evidenceByRepo[''];
  assert.throws(() => createReusableRequest({ candidateId: 'candidate' }, insufficient), /scoped candidate/);
});

test('requests require exact scanned repositories and an explicit global rationale', () => {
  for (const repo of ['/fixture/repo/', '/fixture/repo/../repo', '/fixture/missing', 1]) assert.throws(() => request({ repo }), /scanned repository/);
  assert.throws(() => request({ placement: 'repo' }), /requires a repository/);
  assert.throws(() => request({ repo: '/fixture/repo', placement: 'global' }), /Explain why/);
  assert.equal(request({ repo: '/fixture/repo', placement: 'global', notes: 'This input format is shared.' }).placement, 'global');
  for (const extra of [{ candidateId: 'missing' }, { candidateId: 1 }, { task: '' }, { task: ' ' }, { task: 'x'.repeat(2001) }, { task: '\0' }, { notes: 'x'.repeat(2001) }, { targetAgent: 'shared' }, { invocation: 'sometimes' }, { placement: 'other' }, { autoSave: 'true' }]) assert.throws(() => request(extra));
  assert.throws(() => createReusableRequest({ task: 'Count', targetAgent: 'claude' }, { ...context, agents: ['codex'] }), /available/);
});

test('prompt bounds data and asks for details instead of fabricating execution', () => {
  const prompt = reusablePrompt(request({ candidateId: 'candidate', task: 'x'.repeat(2000), notes: 'x'.repeat(2000) }));
  assert.ok(prompt.length <= 12000);
  for (const phrase of ['Provide a draft only', 'Do not run commands', 'only tool names', 'needsDetails', 'standard-library', 'dry-run', 'idempotency', 'shell-interpolated', 'metadata remains discoverable']) assert.ok(prompt.includes(phrase), phrase);
  for (const phrase of ['Workflow links and relative paths must use ../scripts/', 'bare filename is script shorthand', 'command path relative to the bundle/configuration root', './<file>.mjs is not a workflow shorthand', 'Script imports may use ./<file>.mjs']) assert.ok(prompt.includes(phrase), phrase);
  assert.equal(prompt.includes('private-session'), false);
  assert.throws(() => reusablePrompt({ task: 'x'.repeat(12001) }), /prompt exceeds/);
});

test('workflow guidance bounds deterministic work and failures without expanding execution or permissions',()=>{
  const value=request({task:'Review supplied fixture counts',notes:'Keep uncertain outcomes unknown'}),prompt=reusablePrompt(value);
  for(const phrase of ['When supplied facts require filtering, deduplication or aggregation','reviewed reusable scripts before model reasoning','keep intermediate data local','structured results with processed/shown/omitted/failed/unknown counts','explicit item/output caps','Stop or qualify partial failures or tool isError','never hide failure as success','Parallelize only independent reads','order dependent/effectful steps','Preserve permissions','never blindly retry mutations after lost results','no implicit provider/classifier calls, installs, network or runtime requirements','Ask for missing details'])assert.ok(prompt.includes(phrase),phrase);
  assert.match(prompt,/Provide a draft only\. Do not run commands, invoke tools, edit files, install packages, or contact a network/);
  assert.deepEqual(parseReusableAnswer('{"needsDetails":"Which supplied fields and output caps should the workflow use?"}',value),{needsDetails:'Which supplied fields and output caps should the workflow use?'});
  assert.deepEqual(Object.keys(value),['task','candidate','notes','repo','placement','targetAgent','invocation','autoSave']);
  assert.deepEqual(Object.keys(parse({instructions:'Review supplied counts manually.',scripts:[]})),['name','description','files','estimates','verification','trigger','nonTrigger']);
});

test('maximum task and notes plus bounded candidate metadata fit the prompt cap for both targets and invocations',()=>{
  const bounded=structuredClone(context),source=bounded.patterns.candidates[0];
  source.id='c'.repeat(100);source.pattern='p'.repeat(2000);source.kind='k'.repeat(80);
  source.evidenceByRepo['/fixture/repo'].agents=Array.from({length:16},(_,i)=>String(i).padEnd(80,'a'));
  for(const targetAgent of ['codex','claude'])for(const invocation of ['explicit','automatic']){
    const value=createReusableRequest({repo:'/fixture/repo',candidateId:source.id,task:'t'.repeat(2000),notes:'n'.repeat(2000),targetAgent,invocation},bounded);
    assert.equal(value.candidate.pattern.length,2000);assert.equal(value.candidate.kind.length,80);assert.equal(value.candidate.agents.length,16);assert.equal(value.candidate.agents.every(agent=>agent.length===80),true);
    assert.ok(reusablePrompt(value).length<=12000,targetAgent+' '+invocation);
    assert.ok(reusablePrompt({...value,candidate:{...value.candidate,kind:'similar prompts'}}).length<=12000,targetAgent+' '+invocation+' wording hint');
  }
  source.pattern='p'.repeat(2001);source.kind='k'.repeat(81);source.evidenceByRepo['/fixture/repo'].agents.push('extra');
  const shortened=createReusableRequest({repo:'/fixture/repo',candidateId:source.id,task:'Task'},bounded);
  assert.equal(shortened.candidate.pattern.length,2000);assert.equal(shortened.candidate.kind.length,80);assert.equal(shortened.candidate.agents.length,16);
});

test('strict JSON accepts one whole JSON fence and bounded details, rejecting prose and extra keys', () => {
  const encoded = JSON.stringify(draft());
  assert.equal(parseReusableAnswer('```json\n' + encoded + '\n```', request()).name, 'count-records');
  assert.deepEqual(parseReusableAnswer('{"needsDetails":"Which input format should I count?"}', request()), { needsDetails: 'Which input format should I count?' });
  for (const answer of ['Here is the draft: ' + encoded, encoded + '\nDone', '```\n' + encoded + '\n```', '```json\n' + encoded + '\n```\n```json\n{}\n```', 'null', '[]', '{"needsDetails":"","name":"x"}', '{"needsDetails":""}', JSON.stringify({ needsDetails: 'x'.repeat(2001) }), 'x'.repeat(64001)]) assert.throws(() => parseReusableAnswer(answer, request()));
  assert.throws(() => parse({ path: '../escape' }), /schema/);
  assert.throws(() => parse({ scripts: [{ ...draft().scripts[0], executable: true }] }), /schema/);
});

test('bundle paths are fixed and portable, with a tiny deferred skill entry', () => {
  const result = parse();
  assert.deepEqual(result.files.map(file => file.path), ['skills/count-records/SKILL.md', 'workflows/count-records.md', 'scripts/count-records/run.mjs', 'skills/count-records/agents/openai.yaml']);
  const entry = result.files[0].content;
  assert.ok(Buffer.byteLength(entry) < 1200);
  assert.match(entry, /\.\.\/\.\.\/workflows\/count-records\.md/);
  assert.equal(entry.includes('console.log'), false);
  assert.equal(entry.includes('@'), false);
  assert.match(result.files[1].content, /\.\.\/scripts\/count-records\/run\.mjs/);
  for (const name of ['../escape', 'Count', 'a/b', 'a_b', 'a'.repeat(64), 'nul']) assert.throws(() => parse({ name }));
  for (const name of ['../run.mjs', 'nested/run.mjs', 'Run.mjs', 'run.js', 'con.mjs', 'run.MJS', 'a'.repeat(64) + '.mjs']) assert.throws(() => parse({ scripts: [{ name, content: 'console.log(1);' }] }));
  assert.throws(() => parse({ scripts: [draft().scripts[0], draft().scripts[0]] }), /unique/);
  assert.throws(() => parse({ scripts: Array.from({ length: 5 }, (_, index) => ({ name: 'run-' + index + '.mjs', content: 'console.log(1);' })) }), /four/);
  assert.throws(() => parse({ instructions: '@../../workflow.md' }), /@imports/);
  assert.throws(() => parse({ instructions: 'First read @details.md.' }), /@imports/);
  assert.throws(() => parse({ instructions: 'Run missing.mjs.' }), /outside this bundle/);
  assert.throws(() => parse({ scripts: [{ name: 'run.mjs', content: 'import "./missing.mjs";' }] }), /outside this bundle/);
  assert.throws(() => parse({ instructions: 'Run '+['/home/','example/.codex/skills/run.mjs.'].join('') }), /portable/);
  const helper = parse({ scripts: [{ name: 'run.mjs', content: 'import "./helper.mjs";\nthrow new Error("Draft must never execute");' }, { name: 'helper.mjs', content: 'export const value = 1;' }] });
  assert.match(helper.files.find(file => file.path.endsWith('/run.mjs')).content, /Draft must never execute/);
});

test('explicit target policies differ from automatic invocation', () => {
  const codex = parse();
  assert.match(codex.files.at(-1).content, /allow_implicit_invocation: false/);
  const claude = parse({}, { targetAgent: 'claude' });
  assert.match(claude.files[0].content, /disable-model-invocation: true/);
  assert.equal(claude.files.length, 3);
  for (const targetAgent of ['codex', 'claude']) {
    const automatic = parse({}, { targetAgent, invocation: 'automatic' });
    assert.equal(automatic.files.length, 3);
    assert.equal(automatic.files[0].content.includes('disable-model-invocation'), false);
  }
  const procedure = parse({ instructions: 'Compare supplied values manually.', scripts: [] });
  assert.equal(procedure.files.some(file => file.path.startsWith('scripts/')), false);
});

test('automatic discovery includes trigger and exclusion without reading the deferred procedure',()=>{
  const result=parse({description:'Format supplied records.',trigger:'Only for invoice CSV.',nonTrigger:'Never for medical records.'},{invocation:'automatic'});
  assert.match(result.files[0].content,/invoice CSV/);assert.match(result.files[0].content,/medical records/);assert.ok(result.description.split(/\s+/).length<=25);
  assert.throws(()=>parse({trigger:Array(26).fill('word').join(' ')},{invocation:'automatic'}),/Automatic description/);
});

test('secret rejection preserves generated code by refusing altered content', () => {
  for (const content of [['const token','"synthetic-value";'].join('='), 'console.log("[REDACTED]");', 'console.log("Bearer synthetic-value");', 'console.log("\0");', ['const password','"synthetic-value";'].join('=')]) assert.throws(() => parse({ scripts: [{ name: 'run.mjs', content }] }));
  assert.throws(() => parse({ verification: 'token=synthetic-value' }), /secret/);
  assert.throws(() => parseReusableAnswer(JSON.stringify({ needsDetails: 'password=synthetic-value' }), request()), /secret/);
  assert.throws(() => parseReusableAnswer(JSON.stringify({ needsDetails: '[REDACTED PRIVATE KEY]' }), request()), /secret/);
});

test('field and UTF-8 bundle limits are enforced, and estimates count bytes including metadata', () => {
  for (const extra of [{ description: 'two\nlines' }, { description: Array(26).fill('word').join(' ') }, { description: 'x'.repeat(241) }, { instructions: 'x'.repeat(16001) }, { verification: 'x'.repeat(4001) }, { trigger: '' }, { trigger: 'x'.repeat(1001) }, { nonTrigger: '' }, { scripts: [{ name: 'run.mjs', content: 'x'.repeat(16001) }] }]) assert.throws(() => parse(extra));
  const large = draft({ instructions: '界'.repeat(15000), scripts: [{ name: 'run.mjs', content: '// ' + '界'.repeat(15000) }] });
  assert.ok(JSON.stringify(large).length < 64000);
  assert.throws(() => parseReusableAnswer(JSON.stringify(large), request()), /64000 bytes/);
  const result = parse({ description: 'Count records with café input.' });
  assert.equal(result.estimates.descriptionTokens, byteTokens(result.description));
  assert.equal(result.estimates.entryTokens, result.files.filter(file => file.path.startsWith('skills/')).reduce((total, file) => total + byteTokens(file.content), 0));
  assert.equal(result.estimates.deferredTokens, result.files.filter(file => !file.path.startsWith('skills/')).reduce((total, file) => total + byteTokens(file.content), 0));
  assert.ok(result.estimates.entryTokens > result.estimates.descriptionTokens);
});
