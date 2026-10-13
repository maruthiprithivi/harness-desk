import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { agentDefinitions } from '../lib/agents.mjs';
import { agentSupport, supportsVerification } from '../lib/agent-support.mjs';
import { scan } from '../lib/inventory.mjs';
import { configurationFiles } from '../lib/loading.mjs';
import { readFile } from '../lib/files.mjs';

test('all discovered agents have explicit independent capabilities; unsupported measurement stays unavailable',()=>{
  for(const agent of agentDefinitions){assert.ok(agentSupport[agent.id]);assert.equal(supportsVerification(agent.id),['claude','codex','omp','pi','opencode','kiro','kimi'].includes(agent.id));}
  assert.equal(agentDefinitions.find(agent=>agent.id==='omp').name,'Oh My Pi');assert.equal(supportsVerification('unknown'),false);
});
test('extended discovery finds default global and project sources without reading credentials or sessions',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'agent-support-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const home=path.join(root,'home'),repo=path.join(root,'repo');await fs.mkdir(path.join(repo,'.git'),{recursive:true});
  const sources=[
    ['home/.config/opencode/opencode.jsonc','opencode','config'],['home/.config/opencode/skills/review/SKILL.md','opencode','skill'],
    ['repo/opencode.json','opencode','config'],['repo/.opencode/skills/review/SKILL.md','opencode','skill'],
    ['home/.omp/agent/config.yml','omp','config'],['home/.omp/agent/extensions/example.ts','omp','plugin'],['repo/.omp/config.yml','omp','config'],
    ['home/.pi/agent/settings.json','pi','config'],['repo/.pi/prompts/review.md','pi','command'],['repo/.pi/skills/review/SKILL.md','pi','skill'],
    ['home/.kiro/steering/project.md','kiro','rule'],['repo/.kimi/skills/review/SKILL.md','kimi','skill']
  ];
  for(const [name]of [...sources,['home/.pi/agent/auth.json'],['home/.omp/agent/sessions/private.jsonl'],['home/.config/opencode/credentials.json']]){const file=path.join(root,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,name.endsWith('.md')?'# Synthetic procedure':'{}');}
  const inventory=await scan({home,repos:[repo]});
  for(const [name,agent,type]of sources){const item=inventory.items.find(item=>item.path===path.join(root,name));assert.ok(item,name);assert.equal(item.agent,agent);assert.equal(item.type,type);}
  assert.equal(inventory.items.some(item=>/auth.json|private.jsonl|credentials.json/.test(item.path)),false);
  const files=configurationFiles({inventory,repo,agent:'opencode',home});
  assert.ok(files.some(file=>file.path===path.join(home,'.config/opencode/opencode.jsonc')));assert.equal(files.some(file=>/\.omp|\.pi\//.test(file.path)),false);
  for(const agent of ['omp','pi','opencode']){
    const item=inventory.items.find(item=>item.agent===agent&&!item.repo&&item.type==='config');
    const opened=await readFile({inventory,id:item.id,home});assert.equal(opened.editable,true);assert.ok(opened.language);
  }
});
