import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../lib/store.mjs';
import { createApp } from '../server.mjs';

test('explicit local mining persists wording hints and previews a scoped review without sending sources', async t => {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'wording-api-')));
  const home = path.join(dir, 'fixture-home'), repo = path.join(dir, 'repos', 'one'), other = path.join(dir, 'repos', 'two');
  const root = path.join(home, '.claude', 'projects', 'synthetic');
  for (const folder of [root, repo, other]) await fs.mkdir(folder, { recursive: true });
  const instruction = path.join(repo, 'AGENTS.md');
  await fs.writeFile(instruction, 'Synthetic instructions unchanged.\n');
  const wordings = [
    'Please run the fixture checks and summarize any failures.',
    'Run fixture checks, then summarize the failures.',
    'Summarize failures after you run the fixture checks.'
  ];
  const record = (cwd, sessionId, uuid, content) => ({ type: 'user', ...(cwd ? {cwd} : {}), sessionId, uuid, message: {role:'user', content} });
  const rows = [
    [record(repo, 'synthetic-wording-one', 'a', wordings[0]), record(repo, 'synthetic-wording-one', 'b', wordings[1])],
    [record(repo, 'synthetic-wording-two', 'c', wordings[2])],
    [record(other, 'synthetic-other', 'd', wordings[0]), record(other, 'synthetic-other', 'e', wordings[1])],
    [record('', 'synthetic-unknown', 'f', wordings[0]), record('', 'synthetic-unknown', 'g', wordings[2])]
  ];
  const files = [];
  for (let i=0;i<rows.length;i++) { const file=path.join(root, 'wording-'+i+'.jsonl'); await fs.writeFile(file, rows[i].map(JSON.stringify).join('\n')); files.push(file); }
  const store = await new Store(path.join(dir, 'data')).init();
  await store.write('inventory/current.json', {scannedAt:'2020-01-01T00:00:00Z',items:[],warnings:[],repos:[repo,other]});
  let calls=0;
  const app = await createApp({home,dataDir:store.root,probe:async()=>[{id:'codex',installed:true,auth:'unknown',dispatch:'handoff'}],dispatch:async()=>{calls++;throw new Error('Unexpected provider dispatch');}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>app.server.close(resolve));await fs.rm(dir,{recursive:true,force:true});});
  const url='http://127.0.0.1:'+app.server.address().port;
  const state=()=>fetch(url+'/api/state').then(response=>response.json());
  const csrf=(await state()).csrfToken;
  const post=async(route,body)=>{const response=await fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
  const mined=await post('/api/mine',{paths:files});
  assert.equal(mined.status,200);
  assert.deepEqual(await app.store.read('patterns.json'),mined.body);
  const hints=mined.body.candidates.filter(item=>item.kind==='similar prompts');
  assert.equal(hints.length,1);
  const hint=hints[0];
  assert.deepEqual(hint.repos,[repo]);
  assert.equal(hint.occurrences,3);assert.equal(hint.distinctSessions,2);assert.equal(hint.variants.length,3);
  assert.equal(hint.estSaving,null);assert.deepEqual(Object.keys(hint.evidenceByRepo),[repo]);
  const body={action:'preview',candidateId:hint.id,repo,placement:'repo',task:'Run selected fixture checks and summarize failures.',notes:'Ask which checker to use before supplying executable steps.',targetAgent:'codex',invocation:'explicit',autoSave:false,agent:'codex',model:''};
  const preview=await post('/api/reusable',body);
  assert.equal(preview.status,200);assert.equal(preview.body.request.candidate.kind,'similar prompts');
  assert.match(preview.body.prompt,/local wording hint, not proof of a shared workflow/);
  assert.match(preview.body.prompt,/return needsDetails/);
  assert.equal(Object.hasOwn(preview.body.request.candidate,'variants'),false);
  for(const value of [other,'synthetic-wording-one','synthetic-wording-two','synthetic-other','synthetic-unknown',wordings[0],wordings[2]])assert.equal(preview.body.prompt.includes(value),false,value);
  assert.equal((await post('/api/reusable',{...body,repo:other})).status,400);
  assert.equal((await post('/api/reusable',{...body,repo:'',placement:'global'})).status,400);
  assert.equal(calls,0);assert.deepEqual((await state()).conversations,[]);
  assert.equal(await fs.readFile(instruction,'utf8'),'Synthetic instructions unchanged.\n');
  assert.deepEqual(await fs.readdir(repo),['AGENTS.md']);
});
