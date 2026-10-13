import test from 'node:test';
import assert from 'node:assert/strict';
import {configurationFiles, loadingMap} from '../lib/loading.mjs';

const home='/fixture/home',repo=home+'/projects/one';
const item=(path,type='instruction',extra={})=>({id:path,path,name:path.split('/').at(-1),type,agent:'shared',repo,scope:'repo',bytes:32,...extra});

test('complete scoped sources include skills, rules, settings, MCP, hooks and subagent definitions without other agent sources',()=>{
  const sources=[item(repo+'/AGENTS.md'),item(home+'/.codex/AGENTS.md','instruction',{repo:'',scope:'global'}),
    item(repo+'/.agents/skills/check/SKILL.md','skill',{residentTokens:7,bodyTokens:20}),item(repo+'/.codex/agents/check.toml','config',{agent:'codex'}),
    item(repo+'/.codex/rules/check.md','rule',{agent:'codex'}),item(repo+'/.codex/config.toml','config',{agent:'codex'}),
    item(repo+'/.mcp.json','mcp-server'),item(repo+'/.agents/hooks/check.sh','hook'),
    item(repo+'/.claude/agents/wrong.md','subagent'),item(repo+'/.orca/config.json','config',{agent:'orca'}),
    item(home+'/projects/two/AGENTS.md','instruction',{repo:home+'/projects/two'})];
  const result=loadingMap({inventory:{items:sources},repo,home,agent:'codex'}),files=result.configuration.files;
  assert.equal(files.length,8);
  assert.equal(files.some(file=>/wrong|orca|two/.test(file.path)),false);
  assert.equal(files.find(file=>file.type==='skill').status,'on-invoke');
  assert.match(files.find(file=>file.type==='skill').reason,/does not verify registration/);
  assert.equal(files.find(file=>file.type==='skill').residentTokens,7);
  assert.equal(files.find(file=>file.type==='skill').bodyTokens,20);
  assert.equal(files.find(file=>file.path.endsWith('check.toml')).status,'unknown');
  assert.match(files.find(file=>file.path.endsWith('/config.toml')).role,/MCP/);
  assert.equal(result.summary.estimatedInstructionBytes,64);
  assert.equal(result.configuration.inferred,true);
});

test('Codex hierarchy preserves same-directory replacement and global-to-folder instruction order',()=>{
  const sources=[item(home+'/.codex/AGENTS.md','instruction',{repo:'',scope:'global'}),item(repo+'/AGENTS.md'),
    item(repo+'/AGENTS.override.md'),item(repo+'/src/AGENTS.md','instruction',{scope:'path'}),
    item(repo+'/other/AGENTS.md','instruction',{scope:'path'})];
  const files=loadingMap({inventory:{items:sources},repo,home,agent:'codex',launchDirectory:repo+'/src'}).configuration.files;
  assert.equal(files.find(file=>file.path===repo+'/AGENTS.md').status,'shadowed');
  assert.equal(files.find(file=>file.path===repo+'/AGENTS.md').readOrder,undefined);
  assert.deepEqual(files.filter(file=>file.readOrder).sort((a,b)=>a.readOrder-b.readOrder).map(file=>file.path),
    [home+'/.codex/AGENTS.md',repo+'/AGENTS.override.md',repo+'/src/AGENTS.md']);
  assert.equal(files.find(file=>file.path===repo+'/other/AGENTS.md').status,'conditional');
});

test('Claude home MCP source is visible but is never assumed to apply globally or eagerly',()=>{
  const sources=[item(home+'/.claude.json','config',{repo:'',scope:'global',agent:'claude'}),
    item(repo+'/CLAUDE.local.md','instruction',{agent:'claude'}),item(repo+'/CLAUDE.md','instruction',{agent:'claude'}),
    item(home+'/.claude/CLAUDE.md','instruction',{repo:'',scope:'global',agent:'claude'})];
  const files=loadingMap({inventory:{items:sources},repo,home,agent:'claude'}).configuration.files;
  const mcp=files.find(file=>file.path.endsWith('.claude.json'));
  assert.equal(mcp.status,'unknown');assert.match(mcp.reason,/does not mean every entry/);
  assert.match(mcp.reason,/protected/);assert.equal(mcp.readOrder,undefined);
  assert.deepEqual(files.filter(file=>file.readOrder).sort((a,b)=>a.readOrder-b.readOrder).map(file=>file.path),
    [home+'/.claude/CLAUDE.md',repo+'/CLAUDE.md',repo+'/CLAUDE.local.md']);
  assert.equal(configurationFiles({inventory:{items:sources},repo,home,agent:'codex'}).some(file=>file.path.endsWith('.claude.json')),false);
});

test('global-only hierarchy excludes projects, deduplicates paths and rejects traversal or unrelated home documents',()=>{
  const skill=item(home+'/.agents/skills/check/SKILL.md','skill',{repo:'',scope:'global'});
  const sources=[skill,{...skill,id:'duplicate'},item(repo+'/AGENTS.md'),
    item(home+'/notes/config.json','config',{repo:'',scope:'global'}),
    item(home+'/.agents/../.claude/config.json','config',{repo:'',scope:'global'})];
  assert.deepEqual(configurationFiles({inventory:{items:sources},home,agent:'codex'}).map(file=>file.id),[skill.id]);
});

test('coexisting Claude root and hidden primary instructions share a read layer without inventing order within it',()=>{
  const files=loadingMap({inventory:{items:[item(repo+'/CLAUDE.md','instruction',{agent:'claude'}),
    item(repo+'/.claude/CLAUDE.md','instruction',{agent:'claude'}),item(repo+'/CLAUDE.local.md','instruction',{agent:'claude'})]},repo,home,agent:'claude'}).configuration.files;
  assert.equal(files.find(file=>file.path===repo+'/CLAUDE.md').readOrder,1);
  assert.equal(files.find(file=>file.path===repo+'/.claude/CLAUDE.md').readOrder,1);
  assert.equal(files.find(file=>file.path===repo+'/CLAUDE.md').readOrderTied,true);
  assert.equal(files.find(file=>file.path===repo+'/CLAUDE.local.md').readOrder,2);
});

test('Windows hierarchy filters ownership and repository case portably',()=>{
  const winHome='C:\\fixture\\home',winRepo=winHome+'\\projects\\one';
  const sources=[item(winRepo+'\\.agents\\skills\\check\\SKILL.md','skill',{repo:winRepo}),
    item(winRepo+'\\.claude\\skills\\wrong\\SKILL.md','skill',{repo:winRepo})];
  assert.equal(configurationFiles({inventory:{items:sources},home:winHome,repo:winRepo.toLowerCase(),agent:'codex'}).length,1);
});
