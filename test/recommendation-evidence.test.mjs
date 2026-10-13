import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {recommendations} from '../lib/analysis.mjs';

const budgets={globalTokens:2000,repoTokens:8000,contextPercent:15};
const repo='/fixture/repo',other='/fixture/other';
const hash=value=>createHash('sha256').update(value).digest('hex').slice(0,16);
const benchmark='Propose one reversible change, then benchmark equivalent fixed tasks before and after, comparing tokens and quality. Roll back changes that worsen quality or fail to improve measured tokens.';
const item=(patch={})=>({id:'fixture-item',name:'AGENTS.md',type:'instruction',path:repo+'/AGENTS.md',repo,scope:'repo',agent:'codex',bytes:100,...patch});
const observation=(patch={})=>({id:'fixture-reading',agent:'codex',repo,startupTokens:300,windowTokens:1000,at:'2026-01-01T00:00:00.000Z',...patch});

test('duplicate proposals retain known, unknown and zero discovered costs without claiming a saving',()=>{
  const canonical=item({id:'canonical-item',path:repo+'/canonical.md'});
  for(const residentTokens of [240,undefined,0]) {
    const duplicate=item({duplicateOf:canonical.path,residentTokens}),result=recommendations({items:[canonical,duplicate]},[],budgets);
    assert.equal(result.length,1);
    const proposal=result[0],cost=residentTokens===undefined?'; discovered metadata cost unknown; actual loading not observed.':'; discovered estimated metadata cost '+residentTokens+' tokens (bytes/4; actual loading not observed).';
    assert.equal(proposal.expectedSaving,null);
    assert.equal(proposal.evidence,duplicate.path+' and '+canonical.path+' had identical complete Markdown at the last scan'+cost);
    assert.equal(proposal.action,'Compare this copy with a known eligible canonical copy and confirm each agent can load it. '+benchmark+' Discovery alone does not prove either copy is unnecessary or that removal saves tokens.');
    assert.equal(proposal.id,hash(duplicate.id+'duplicate'));assert.equal(proposal.itemId,duplicate.id);
    assert.equal(proposal.repo,repo);assert.equal(proposal.scope,'repo');assert.equal(proposal.confidence,'exact content match');assert.equal(proposal.status,'proposal');
  }
});
test('duplicate evidence withholds an out-of-scope or undiscovered canonical path',()=>{
  const canonical=item({id:'other-item',path:other+'/canonical.md',repo:other}),duplicate=item({duplicateOf:canonical.path,residentTokens:0});
  for(const items of [[duplicate,canonical],[duplicate]]) {
    const [proposal]=recommendations({items},[],budgets);
    assert.equal(proposal.expectedSaving,null);assert.equal(proposal.evidence.includes(canonical.path),false);
    assert.match(proposal.evidence,/path is withheld from this scoped proposal/);
  }
  const globalCanonical=item({id:'global-item',repo:'',scope:'global',path:'/fixture/global/AGENTS.md'});
  assert.ok(recommendations({items:[globalCanonical,{...duplicate,duplicateOf:globalCanonical.path}]},[],budgets)[0].evidence.includes(globalCanonical.path));
});
test('duplicate proposals withhold other-agent global and repository canonical identities',()=>{
  for(const sourceAgent of ['codex','shared'])for(const targetAgent of ['codex','claude','shared','model-gateway'])for(const targetRepo of ['',repo]){
    const canonical=item({id:'canonical-item',name:'Canonical private fixture',agent:targetAgent,repo:targetRepo,path:(targetRepo||'/fixture/global')+'/'+targetAgent+'-canonical.md'}),duplicate=item({agent:sourceAgent,duplicateOf:canonical.path,residentTokens:0}),[proposal]=recommendations({items:[canonical,duplicate]},[],budgets),visible=[sourceAgent,'shared','model-gateway'].includes(targetAgent);
    assert.equal(proposal.evidence.includes(canonical.path),visible);assert.equal(proposal.evidence.includes(canonical.name),false);if(!visible)assert.match(proposal.evidence,/a source outside this agent or repository scope; its path is withheld from this scoped proposal/);
    assert.equal(proposal.id,hash(duplicate.id+'duplicate'));assert.equal(proposal.itemId,duplicate.id);assert.equal(proposal.status,'proposal');assert.equal(proposal.confidence,'exact content match');assert.equal(proposal.expectedSaving,null);
  }
});
test('inventory estimates retain exact budget gaps and repository overrides as diagnostic costs',()=>{
  const items=[item({residentTokens:6000}),item({id:'second',residentTokens:1000}),item({id:'other',repo:other,path:other+'/AGENTS.md',residentTokens:8100}),item({id:'global',repo:'',scope:'global',path:'/fixture/global/AGENTS.md',residentTokens:2500})];
  const result=recommendations({items},[],budgets,{[repo]:{repoTokens:6500},'':{repoTokens:10}});
  assert.equal(result.length,3);
  for(const [scope,source,tokens,cap,gap]of [['repo',repo,7000,6500,500],['repo',other,8100,8000,100],['global','',2500,2000,500]]) {
    const proposal=result.find(value=>value.scope===scope&&value.repo===source);
    assert.ok(proposal);assert.equal(proposal.expectedSaving,null);
    assert.equal(proposal.evidence,tokens+' estimated resident tokens, budget '+cap+', estimated budget gap '+gap+' tokens. Bytes/4 approximates discovered metadata cost; actual loading was not observed. The budget gap is not a proven or achievable saving.');
    assert.equal(proposal.action,'Inspect the discovered contributors for this scope and verify which ones actually load. '+benchmark);
    assert.equal(proposal.id,hash('codex|'+scope+'|'+source+'budget'));assert.equal(proposal.agent,'codex');assert.equal(proposal.confidence,'estimate');assert.equal(proposal.status,'proposal');
  }
});
test('inventory groups at or below their applicable cap produce no budget proposal',()=>{
  const items=[item({residentTokens:6500}),item({id:'unknown'}),item({id:'global',repo:'',scope:'global',residentTokens:2000}),item({id:'other',repo:other,residentTokens:7999})];
  assert.deepEqual(recommendations({items},[],budgets,{[repo]:{repoTokens:6500}}),[]);
});
test('observed readings retain their budget threshold and rounded gap without promising savings',()=>{
  for(const [reading,repoBudgets,percent,threshold,gap]of [[observation(),{},15,150,150],[observation({windowTokens:1001,startupTokens:151}),{[repo]:{contextPercent:10}},10,100.1,51]]) {
    const [proposal]=recommendations({items:[]},[reading],budgets,repoBudgets);
    assert.equal(proposal.expectedSaving,null);
    assert.equal(proposal.evidence,reading.startupTokens+' startup tokens / '+reading.windowTokens+' window tokens, recorded '+reading.at+', budget '+percent+'% ('+threshold+' tokens), budget gap '+gap+' tokens. The budget gap is calculated from a user supplied reading; it is not a proven or achievable saving.');
    assert.equal(proposal.action,'Compare actual startup contributors with inventory. '+benchmark);
    assert.equal(proposal.id,hash(reading.id+'observed'));assert.equal(proposal.repo,repo);assert.equal(proposal.scope,'repo');assert.equal(proposal.agent,'codex');assert.equal(proposal.confidence,'user supplied measurement');assert.equal(proposal.status,'proposal');
  }
  const [fractional]=recommendations({items:[]},[observation({windowTokens:1001,startupTokens:151})],budgets);
  assert.match(fractional.evidence,/budget 15% \(150\.15 tokens\), budget gap 1 tokens/);
});
test('at-or-below-budget readings and zero windows produce no proposal',()=>{
  for(const reading of [observation({startupTokens:150}),observation({startupTokens:149}),observation({windowTokens:0}),observation({startupTokens:100})])assert.deepEqual(recommendations({items:[]},[reading],budgets),[]);
  assert.deepEqual(recommendations({items:[]},[observation({startupTokens:200})],budgets,{[repo]:{contextPercent:20}}),[]);
});
test('only the latest reading for each exact agent and repository scope contributes',()=>{
  const readings=[observation({id:'old'}),observation({id:'latest-below',at:'2026-01-02T00:00:00.000Z',startupTokens:100}),observation({id:'other-repo',repo:other}),observation({id:'other-agent',agent:'claude'}),observation({id:'global-old',repo:''}),observation({id:'global-latest',repo:'',at:'2026-01-02T00:00:00.000Z',startupTokens:100})];
  const result=recommendations({items:[]},readings,budgets);
  assert.equal(result.length,2);assert.ok(result.some(value=>value.id===hash('other-repoobserved')));assert.ok(result.some(value=>value.id===hash('other-agentobserved')));
  const tied=recommendations({items:[]},[observation(),observation({id:'later-tie',startupTokens:100})],budgets);
  assert.deepEqual(tied,[]);
  const global=recommendations({items:[]},[observation({repo:''})],budgets)[0];assert.equal(global.scope,'global');assert.equal(global.repo,'');assert.equal(global.expectedSaving,null);
});
test('recommendations do not mutate evidence or settings and retain unrelated oversized proposals',()=>{
  const input={inventory:{items:[item({residentTokens:9000,bytes:40000}),item({id:'duplicate',path:repo+'/copy.md',duplicateOf:repo+'/AGENTS.md',residentTokens:0})]},observations:[observation()],budgets:{...budgets},repoBudgets:{[repo]:{repoTokens:8500,contextPercent:10}}},before=structuredClone(input);
  const result=recommendations(input.inventory,input.observations,input.budgets,input.repoBudgets);
  assert.deepEqual(input,before);assert.equal(result.length,4);assert.ok(result.every(value=>value.expectedSaving===null));
  const oversized=result.find(value=>value.title==='Split large instruction file');
  assert.equal(oversized.id,hash('fixture-itemoversize'));assert.equal(oversized.evidence,repo+'/AGENTS.md is 40000 bytes.');
  assert.equal(oversized.action,'Check this agent’s actual document budget. Move procedures into invoked skills, retain essential constraints and verify in a fresh session.');assert.equal(oversized.confidence,'measured bytes; load not observed');
});
