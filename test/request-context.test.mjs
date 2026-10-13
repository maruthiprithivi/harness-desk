import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {boundRequestContext} from '../lib/request-context.mjs';
import {Store} from '../lib/store.mjs';
import {createApp} from '../server.mjs';
import {createImprovement} from '../lib/improvements.mjs';
import {reviewKey} from '../lib/components.mjs';

const at='2026-01-01T00:00:00.000Z';
const count=(packet,section)=>packet.coverage.sections.find(row=>row.section===section);
function verify(packet) {
  assert.ok(packet.text.length<=28000);assert.equal(packet.estTokens,Math.ceil(Buffer.byteLength(packet.text,'utf8')/4));
  const parsed=JSON.parse(packet.text);assert.deepEqual(parsed.coverage,packet.coverage);
  assert.equal(packet.truncated,packet.coverage.partial);assert.equal(packet.coverage.partial,packet.coverage.sections.some(row=>row.omitted>0));
  for(const row of packet.coverage.sections){assert.equal(row.available,row.included+row.omitted);assert.ok(row.included>=0);}
  return parsed;
}
const asset=(repo,index,patch={})=>({id:'asset-'+index,name:'Fixture '+index,type:'skill',agent:'codex',scope:repo?'repo':'global',repo,path:path.join(repo||'/fixture/global','skill-'+index+'.md'),bytes:40,residentTokens:10,estTokens:10,loadMode:'unknown',usage:'unknown',...patch});

test('oversized catalogues contain valid bounded JSON and only complete identifiable records',()=>{
  const inventory=Array.from({length:500},(_,index)=>asset('/fixture/repo',index,{description:'Synthetic description '.repeat(15),contentHash:'a'.repeat(64)})),original=structuredClone(inventory);
  const packet=boundRequestContext({scope:'/fixture/repo',reviewAgent:'codex',inventory,sourceCoverage:{partial:null}}),parsed=verify(packet),row=count(packet,'inventory');
  assert.equal(row.available,500);assert.equal(row.included,parsed.inventory.length);assert.ok(row.included<=100);assert.ok(row.omitted>=400);
  for(const record of parsed.inventory)assert.deepEqual(record,original.find(item=>item.id===record.id));
  assert.deepEqual(parsed.sourceCoverage,{partial:null});
});
test('all existing section caps and nested omissions are counted before parent reduction',()=>{
  const records=n=>Array.from({length:n},(_,id)=>({id}));
  const input={scope:'synthetic',recommendations:records(35),context:{observations:records(12),breakdowns:records(11),loadingPrediction:{groups:[{id:'global',files:records(4)},{id:'repo',files:records(6)}]}},patterns:{candidates:records(16),mistakes:records(12),importedAudit:{tables:{inventory:records(25)}}},journal:{lessons:records(22)},gaps:records(31),improvements:Array.from({length:4},(_,id)=>({id,inventorySource:{items:records(13)},tasks:records(2),latestRunNotes:records(5)}))};
  const packet=boundRequestContext(input),parsed=verify(packet);
  for(const [section,available,included]of [['recommendations',35,30],['context.observations',12,10],['context.breakdowns',11,10],['context.loadingPrediction.groups',2,2],['context.loadingPrediction.groups.files',10,10],['patterns.candidates',16,15],['patterns.mistakes',12,10],['patterns.importedAudit.tables.inventory',25,20],['journal.lessons',22,20],['gaps',31,30],['improvements',4,3],['improvements.inventorySource.items',52,30],['improvements.tasks',8,6],['improvements.latestRunNotes',20,9]])assert.deepEqual(count(packet,section),{section,available,included,omitted:available-included});
  assert.deepEqual(parsed.context.observations.map(row=>row.id),Array.from({length:10},(_,index)=>index+2));
  assert.deepEqual(parsed.improvements[0].latestRunNotes.map(row=>row.id),[2,3,4]);
});
test('long optional records are omitted whole while critical identities and counts remain observable',()=>{
  const critical={id:'critical-id',title:'Synthetic provider failure',repo:'/fixture/repo',agent:'codex',severity:'error',source:'synthetic test',status:'open'};
  const packet=boundRequestContext({scope:'/fixture/repo',inventory:[asset('/fixture/repo',0,{description:'x'.repeat(40000)}),asset('/fixture/repo',1)],gaps:[{...critical,evidence:'y'.repeat(40000)}],gapSummary:{available:1,bySeverity:{error:1},criticalFailures:[critical]}}),parsed=verify(packet);
  assert.deepEqual(parsed.inventory.map(record=>record.id),['asset-1']);assert.equal(parsed.gaps.length,0);
  assert.deepEqual(parsed.gapSummary.criticalFailures,[critical]);assert.deepEqual(parsed.gapSummary.bySeverity,{error:1});
  assert.deepEqual(count(packet,'gaps'),{section:'gaps',available:1,included:0,omitted:1});
});
test('mandatory oversized scalars or critical headers fail closed without clipping',()=>{
  for(const input of [{scope:'x'.repeat(28001),inventory:[]},{scope:'synthetic',gapSummary:{criticalFailures:[{id:'x'.repeat(28001),severity:'error'}]}}])assert.throws(()=>boundRequestContext(input),/Select fewer sections or a narrower scope\. No request was sent/);
});
test('UTF8 bytes drive token estimates independently of the character budget',()=>{
  const packet=boundRequestContext({scope:'合成范围',inventory:[{id:'fixture-id',name:'合成说明😀',usage:'unknown',residentTokens:null}]}),parsed=verify(packet);
  assert.ok(packet.estTokens>Math.ceil(packet.text.length/4));assert.equal(parsed.inventory[0].name,'合成说明😀');assert.equal(parsed.inventory[0].residentTokens,null);assert.equal(packet.coverage.partial,false);
});

async function fixture(t,seed=()=>({})) {
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'request-context-'))),home=path.join(dir,'fixture-home'),repo=path.join(dir,'repo'),other=path.join(dir,'other');
  await fs.mkdir(path.join(home,'.codex'),{recursive:true});await fs.mkdir(repo);await fs.mkdir(other);
  const saved=seed({home,repo,other}),inventory={items:saved.items||[],repos:[repo,other],scannedAt:at,warnings:[],coverage:{partial:false},...saved.inventory};
  const store=await new Store(path.join(dir,'generated')).init();await store.saveSettings({...store.settings,repos:[repo,other],...(saved.settings||{})});await store.write('inventory/current.json',inventory);
  for(const [key,file]of [['observations','observations.json'],['breakdowns','context-breakdowns.json'],['patterns','patterns.json'],['journal','journal.json'],['audit','imported-audit.json'],['improvements','improvements.json'],['gaps','gaps/ledger.json'],['usageEvidence','usage-evidence.json'],['toolInspections','tool-inspections.json']])if(saved[key]!==undefined)await store.write(file,saved[key]);
  let dispatched=0;
  const app=await createApp({home,dataDir:store.root,probe:async()=>[{id:'codex',installed:true,auth:'signed-in',dispatch:'direct'},{id:'claude',installed:true,auth:'unknown',dispatch:'handoff'}],dispatch:async()=>{dispatched++;return 'Synthetic answer';}});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  t.after(async()=>{await new Promise(resolve=>app.server.close(resolve));await fs.rm(dir,{recursive:true,force:true});});
  const root='http://127.0.0.1:'+app.server.address().port,csrf=(await app.state()).csrfToken;
  const post=async(route,body)=>{const response=await fetch(root+route,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
  return {app,post,repo,other,home,inventory,saved,dispatched:()=>dispatched};
}
test('API catalogues count scoped eligible assets across agents, preserve IDs and isolate explicit and global selections',async t=>{
  const f=await fixture(t,({home,repo,other})=>({items:[...Array.from({length:160},(_,i)=>asset(repo,i,{agent:i%2?'claude':'codex'})),...Array.from({length:3},(_,i)=>asset('',160+i,{path:path.join(home,'.codex','skill-'+i+'.md'),agent:'shared'})),...Array.from({length:7},(_,i)=>asset(other,170+i))]})),scope={repo:f.repo,reviewAgent:'codex',sections:['inventory','dashboard']};
  const first=await f.post('/api/context',scope);assert.equal(first.status,200);const parsed=verify(first.body);
  assert.equal(parsed.reviewAgent,'codex');assert.equal(count(first.body,'inventory').available,163);
  assert.ok(parsed.inventory.some(row=>row.agent==='claude'));assert.ok(parsed.inventory.every(row=>row.id&&(!row.repo||row.repo===f.repo)));assert.equal(first.body.text.includes(f.other),false);
  const explicit=await f.post('/api/context',{...scope,selectionMode:'explicit',selectedIds:['asset-1']});assert.equal(explicit.status,200);assert.deepEqual(verify(explicit.body).inventory.map(row=>row.id),['asset-1']);assert.equal(count(explicit.body,'inventory').available,1);
  const empty=await f.post('/api/context',{...scope,selectionMode:'explicit',selectedIds:[]});assert.equal(empty.status,200);const emptyParsed=verify(empty.body);assert.deepEqual(emptyParsed.inventory,[]);assert.deepEqual(emptyParsed.recommendations,[]);assert.equal(count(empty.body,'inventory').available,0);
  const global=await f.post('/api/context',{globalOnly:true,reviewAgent:'claude',sections:['inventory']});assert.equal(global.status,200);assert.equal(count(global.body,'inventory').available,3);assert.ok(verify(global.body).inventory.every(row=>!row.repo));assert.equal(f.dispatched(),0);
});
test('context snapshots, loading groups, patterns, audits and journal keep scoped cap coverage',async t=>{
  const f=await fixture(t,({home,repo,other})=>{
    const readings=Array.from({length:12},(_,id)=>({id:'reading-'+id,agent:'codex',repo,at,startupTokens:null,windowTokens:1000}));
    return {items:[asset(repo,0,{name:'AGENTS.md',type:'instruction',path:path.join(repo,'AGENTS.md')}),asset(repo,1,{agent:'claude'}),asset('',2,{agent:'shared',type:'instruction',name:'AGENTS.md',path:path.join(home,'.codex','AGENTS.md')})],observations:[...readings,{id:'global-reading',agent:'codex',repo:'',at,startupTokens:0,windowTokens:1000},{id:'foreign-reading',agent:'codex',repo:other,at},{id:'other-agent',agent:'claude',repo,at}],breakdowns:[...readings.map(row=>({...row,id:'breakdown-'+row.id,percentages:{skills:0}})),{id:'foreign-breakdown',agent:'codex',repo:other,at}],patterns:{candidates:Array.from({length:17},(_,id)=>({id,pattern:'Synthetic task '+id,evidenceByRepo:{[repo]:{occurrences:3,distinctSessions:2,examples:['Synthetic task']},[other]:{occurrences:3,distinctSessions:2,examples:['Excluded task']}}})),mistakes:Array.from({length:12},(_,id)=>({id,repo,reason:'Synthetic mistake'}))},audit:{source:'synthetic audit',importedAt:at,tables:{inventory:[...Array.from({length:23},(_,id)=>({id,repo,scope:'repo'})),{id:'excluded-audit',repo:other,scope:'repo'}]}},journal:{lessons:Array.from({length:22},(_,id)=>({id,lesson:'Synthetic lesson'})),coverage:{partial:true,issues:['Synthetic unavailable date']}}};
  });
  const response=await f.post('/api/context',{repo:f.repo,reviewAgent:'codex',launchDirectory:f.repo,sections:['context','patterns','journal'],selectionMode:'explicit',selectedIds:['asset-0']});assert.equal(response.status,200);const parsed=verify(response.body);
  for(const [section,available]of [['context.observations',13],['context.breakdowns',12],['context.loadingPrediction.groups',4],['context.loadingPrediction.groups.files',1],['patterns.candidates',17],['patterns.mistakes',12],['patterns.importedAudit.tables.inventory',23],['journal.lessons',22]])assert.equal(count(response.body,section).available,available);
  assert.equal(response.body.text.includes('foreign-reading'),false);assert.equal(response.body.text.includes('Excluded task'),false);assert.equal(response.body.text.includes(f.other),false);assert.equal(parsed.journal.coverage.partial,true);
  assert.ok(parsed.context.observations.some(row=>row.startupTokens===null));assert.ok(parsed.context.observations.some(row=>row.startupTokens===0));
  assert.equal(parsed.reviewAgent,'codex');assert.equal(f.dispatched(),0);
});
test('missing and malformed scan coverage stays unknown even when the request has no omissions',async t=>{
  for(const coverage of [undefined,{}, {partial:'false'}]) {
    const f=await fixture(t,({repo})=>({items:[asset(repo,0)],inventory:{coverage}})),packet=f.app.context({repo:f.repo,sections:['inventory']});
    assert.equal(verify(packet).inventorySummary.coverage.partial,null);assert.equal(packet.coverage.partial,false);assert.match(packet.text,/completeness is unknown/);
  }
});
test('default previews and handoffs share stable context, deduplicate warnings and allow explicitly asking about that warning',async t=>{
  const f=await fixture(t,({repo})=>({items:Array.from({length:160},(_,id)=>asset(repo,id))})),scope={repo:f.repo,reviewAgent:'codex',sections:['inventory','gaps']};
  const first=await f.post('/api/context',scope),second=await f.post('/api/context',scope);assert.equal(first.status,200);assert.equal(second.status,200);verify(first.body);assert.equal(first.body.text,second.body.text);
  const chat=await f.post('/api/chat',{...scope,agent:'claude',prompt:'Explain the supplied synthetic records'});assert.equal(chat.status,200);assert.equal(chat.body.status,'handoff');assert.equal(chat.body.agent,'claude');assert.equal(chat.body.reviewAgent,'codex');assert.deepEqual(chat.body.context,second.body);assert.ok(chat.body.handoffText.includes(second.body.text));
  const warning=(await f.app.state()).gaps.find(gap=>gap.key==='coverage:request-context');assert.equal(warning.occurrences,1);
  const explicit=await f.post('/api/context',{repo:f.repo,sections:['gaps'],gapIds:[warning.id]});assert.equal(explicit.status,200);assert.deepEqual(verify(explicit.body).gaps.map(gap=>gap.id),[warning.id]);
  const linked=await f.post('/api/chat',{repo:f.repo,reviewAgent:'codex',agent:'claude',sections:[],gapId:warning.id,prompt:'Explain this coverage warning'});assert.equal(linked.status,200);assert.deepEqual(JSON.parse(linked.body.context.text).gaps.map(gap=>gap.id),[warning.id]);assert.equal(f.dispatched(),0);
});
test('critical gap summaries survive detail omissions and oversized mandatory routing fails before dispatch',async t=>{
  const f=await fixture(t,({repo})=>({items:[asset(repo,0,{description:'x'.repeat(40000)})],gaps:[{id:randomUUID(),key:'failure:synthetic',title:'Synthetic persistence failure',repo,agent:'codex',severity:'error',kind:'failure',evidence:'y'.repeat(8000),nextStep:'Inspect the synthetic fixture',source:'synthetic test',status:'open',occurrences:2,events:[],conversationIds:[],eventKeys:[]}],settings:{routes:{global:{analysis:{agent:'codex',model:'z'.repeat(28001)}},repos:{}}}}));
  const packet=f.app.context({repo:f.repo,sections:['inventory','gaps']}),parsed=verify(packet);assert.equal(count(packet,'inventory').included,0);assert.equal(parsed.gapSummary.bySeverity.error,1);assert.equal(parsed.gapSummary.criticalFailures[0].title,'Synthetic persistence failure');
  for(const route of ['/api/context','/api/chat']){const result=await f.post(route,{repo:f.repo,agent:'codex',model:'fixture-model',sections:['delegation'],prompt:'Explain the supplied synthetic routing'});assert.equal(result.status,400);assert.match(result.body.error,/No request was sent/);}
  assert.equal(f.dispatched(),0);
});
test('failed improvement outcomes remain observable when oversized details are omitted',async t=>{
  const f=await fixture(t,({repo})=>{
    const inventory={items:[asset(repo,0)],repos:[repo],scannedAt:at,coverage:{partial:false}},record=createImprovement({agent:'codex',repo,title:'Synthetic failed comparison',change:'Synthetic change',rollback:'Synthetic restoration',tasks:[{label:'Fixed task',prompt:'Synthetic fixed task'}],assetIds:['asset-0']},{agents:['codex'],repos:[repo],inventory});
    record.change='x'.repeat(40000);record.runs=[{id:randomUUID(),taskId:record.tasks[0].id,phase:'after',passed:false,note:'Synthetic failed check',startupTokens:200,totalTokens:null,at}];
    return {items:inventory.items,improvements:[record]};
  }),packet=f.app.context({repo:f.repo,reviewAgent:'codex',sections:['improvements']}),parsed=verify(packet);
  assert.deepEqual(parsed.improvements,[]);assert.deepEqual(count(packet,'improvements'),{section:'improvements',available:1,included:0,omitted:1});
  assert.equal(parsed.improvementSummary.failedSamples,1);assert.equal(parsed.improvementSummary.criticalOutcomes[0].title,'Synthetic failed comparison');assert.equal(parsed.improvementSummary.criticalOutcomes[0].failedSamples,1);assert.equal(f.dispatched(),0);
});
test('known metric regressions and incomplete increases remain visible after improvement detail is omitted',async t=>{
  for(const samples of [1,3]) {
    const f=await fixture(t,({repo})=>{
      const inventory={items:[],repos:[repo],scannedAt:at,coverage:{partial:false}},record=createImprovement({agent:'codex',repo,title:'Synthetic increased token cost',change:'Synthetic change',rollback:'Synthetic restoration',tasks:[{label:'Fixed task',prompt:'Synthetic fixed task'}],assetIds:[]},{agents:['codex'],repos:[repo],inventory});
      record.change='x'.repeat(40000);
      record.runs=['before','after'].flatMap(phase=>Array.from({length:samples},()=>({id:randomUUID(),taskId:record.tasks[0].id,phase,passed:true,note:'Synthetic measured check',startupTokens:phase==='before'?100:200,totalTokens:null,model:'fixture-model',agentVersion:'fixture-version',environment:'fixture-environment',counter:'fixture-counter',at})));
      return {improvements:[record]};
    }),packet=f.app.context({repo:f.repo,reviewAgent:'codex',sections:['improvements']}),parsed=verify(packet),outcome=parsed.improvementSummary.criticalOutcomes[0];
    assert.deepEqual(parsed.improvements,[]);assert.equal(outcome.title,'Synthetic increased token cost');assert.equal(outcome.increasedMetrics,1);assert.equal(outcome.failedSamples,0);assert.equal(outcome.verdict,samples===3?'regression':'collect-baseline');assert.match(parsed.improvementSummary.interpretation,/incomplete or incomparable conditions do not establish causal regression/);assert.equal(f.dispatched(),0);
  }
});
test('asset-filtered previews withhold unselected sampled totals while unfiltered requests retain labeled totals',async t=>{
  const f=await fixture(t,({repo})=>({items:[asset(repo,0),asset(repo,1)],usageEvidence:{[reviewKey('usage','codex',repo)]:{at,agent:'codex',repo,window:{},files:{selected:1,read:1,skipped:0},coverage:{partial:false,issues:[]},source:'synthetic sampled usage',items:[],fileReads:[{assetId:'asset-0',requests:1,resultsSeen:1,failed:0},{assetId:'asset-1',requests:8,resultsSeen:8,failed:4}],totals:{calls:9,resultsSeen:9,failed:4},fileReadTotals:{requests:9,resultsSeen:9,failed:4}}}})),scope={repo:f.repo,reviewAgent:'codex',sections:['inventory']};
  for(const selection of [{selectionMode:'explicit',selectedIds:['asset-0']},{selectionMode:'explicit',selectedIds:[]},{selectionMode:'all',selectedIds:['asset-0']}]) {
    const response=await f.post('/api/context',{...scope,...selection});assert.equal(response.status,200);const parsed=verify(response.body);
    assert.equal(Object.hasOwn(parsed.sessionCoverage,'totals'),false);assert.equal(Object.hasOwn(parsed.sessionCoverage,'fileReadTotals'),false);assert.equal(response.body.text.includes('asset-1'),false);
    if(selection.selectedIds.length)assert.equal(parsed.inventory[0].callEvidence.reads[0].requests,1);else assert.deepEqual(parsed.inventory,[]);
  }
  const all=await f.post('/api/context',scope);assert.equal(all.status,200);const parsed=verify(all.body);
  assert.deepEqual(parsed.sessionCoverage.totals,{calls:9,resultsSeen:9,failed:4});assert.deepEqual(parsed.sessionCoverage.fileReadTotals,{requests:9,resultsSeen:9,failed:4});assert.match(parsed.sessionCoverage.interpretation,/whole scoped sampled usage/);assert.equal(f.dispatched(),0);
});
const gapRecord=(repo,index)=>({id:randomUUID(),key:'reported:fixture-'+index,title:'Synthetic selected gap '+index,repo,agent:'',severity:'warning',kind:'reported',evidence:'Synthetic scoped evidence '+index,nextStep:'Review synthetic evidence',source:'synthetic test',status:'open',occurrences:1,events:[],conversationIds:[],eventKeys:[]});
test('multiple explicit gaps have identical preview and chat context and stay frozen across continuations',async t=>{
  const f=await fixture(t,({repo,other})=>({gaps:[gapRecord(repo,0),gapRecord(repo,1),gapRecord(other,2)]})),ids=f.saved.gaps.slice(0,2).map(gap=>gap.id).reverse(),scope={repo:f.repo,reviewAgent:'codex',sections:['gaps'],gapIds:ids};
  const preview=await f.post('/api/context',scope);assert.equal(preview.status,200);verify(preview.body);
  const chat=await f.post('/api/chat',{...scope,agent:'claude',prompt:'Explain the selected synthetic gaps'});assert.equal(chat.status,200);assert.deepEqual(chat.body.context,preview.body);assert.deepEqual(chat.body.gapIds,ids);assert.ok(chat.body.handoffText.includes(preview.body.text));
  for(const gapIds of [[],[ids[0]],ids.toReversed(),[f.saved.gaps[2].id],null])assert.equal((await f.post('/api/chat',{id:chat.body.id,gapIds,prompt:'Continue the original scope'})).status,400);
  const omitted=await f.post('/api/chat',{id:chat.body.id,repo:f.other,sections:[],prompt:'Continue the original scope'});assert.equal(omitted.status,200);assert.equal(omitted.body.repo,f.repo);assert.deepEqual(omitted.body.gapIds,ids);assert.deepEqual(omitted.body.context,preview.body);
  const unchanged=await f.post('/api/chat',{id:chat.body.id,gapIds:ids,prompt:'Continue the original selection'});assert.equal(unchanged.status,200);assert.deepEqual(unchanged.body.context,preview.body);assert.equal(f.dispatched(),0);
});
test('invalid, missing and cross-scope gap selections fail before dispatch and linked gaps reject conflicts',async t=>{
  const f=await fixture(t,({repo,other})=>({gaps:[gapRecord(repo,0),gapRecord(repo,1),gapRecord(other,2)]})),[linked,another,foreign]=f.saved.gaps,scope={repo:f.repo,reviewAgent:'codex',sections:['gaps']};
  for(const gapIds of [[foreign.id],[linked.id,foreign.id],['missing-gap'],[linked.id,'missing-gap'],[{}],null,false,'invalid',Array(51).fill(linked.id)])for(const route of ['/api/context','/api/chat']){
    const result=await f.post(route,{...scope,gapIds,agent:'codex',prompt:'Explain synthetic gaps'});assert.equal(result.status,400);
  }
  for(const gapIds of [[],[another.id],[linked.id,another.id]]){
    const result=await f.post('/api/chat',{...scope,gapId:linked.id,gapIds,agent:'codex',prompt:'Explain a linked synthetic gap'});assert.equal(result.status,400);assert.match(result.body.error,/conflicting gaps/);
  }
  assert.equal(f.dispatched(),0);
  const preview=await f.post('/api/context',{...scope,gapIds:[linked.id]}),chat=await f.post('/api/chat',{...scope,gapId:linked.id,gapIds:[linked.id],agent:'claude',prompt:'Explain a linked synthetic gap'});
  assert.equal(preview.status,200);assert.equal(chat.status,200);assert.deepEqual(chat.body.gapIds,[linked.id]);assert.deepEqual(chat.body.context,preview.body);
  const conflict=await f.post('/api/chat',{id:chat.body.id,gapIds:[another.id],prompt:'Change the linked selection'});assert.equal(conflict.status,400);assert.equal(f.dispatched(),0);
});
test('explicit malformed context fields are never coerced to broader new-chat defaults',async t=>{
  const f=await fixture(t,({repo})=>({items:[asset(repo,0),asset(repo,1)]})),before=(await f.app.state()).gaps,scope={repo:f.repo,reviewAgent:'codex',selectionMode:'explicit',selectedIds:['asset-0'],sections:['inventory']};
  const patches=['selectedIds','sections','improvementIds','gapIds','selectionMode','reviewAgent','repo'].flatMap(field=>[null,false].map(value=>({[field]:value})));
  patches.push({globalOnly:null},{globalOnly:'false'});
  for(const patch of patches)for(const route of ['/api/context','/api/chat']) {
    const result=await f.post(route,{...scope,...patch,agent:'codex',prompt:'Explain only the selected synthetic asset'});assert.equal(result.status,400,route+' '+JSON.stringify(patch));
  }
  assert.equal(f.dispatched(),0);assert.deepEqual((await f.app.state()).conversations,[]);assert.deepEqual((await f.app.state()).gaps,before);
  const booleanFalse=await f.post('/api/context',{...scope,globalOnly:false});assert.equal(booleanFalse.status,200);assert.deepEqual(verify(booleanFalse.body).inventory.map(record=>record.id),['asset-0']);
  const absent=await f.post('/api/chat',{agent:'claude',prompt:'Explain the default synthetic dashboard'});assert.equal(absent.status,200);assert.equal(absent.body.repo,'');assert.equal(absent.body.globalOnly,false);assert.equal(absent.body.selectionMode,'all');assert.deepEqual(absent.body.sections,['dashboard']);assert.deepEqual(absent.body.selectedIds,[]);assert.deepEqual(absent.body.improvementIds,[]);assert.deepEqual(absent.body.gapIds,[]);assert.equal(f.dispatched(),0);
});
test('selected failure flags survive oversized MCP or exact-target Read omissions without unselected aggregates',async t=>{
  for(const mode of ['mcp','read']) {
    const f=await fixture(t,({repo})=>{
      const selected=asset(repo,0,{type:mode==='mcp'?'mcp-server':'instruction',name:mode==='mcp'?'.mcp.json':'AGENTS.md',path:path.join(repo,mode==='mcp'?'.mcp.json':'AGENTS.md')}),unselected=asset(repo,1),usage={at,agent:'codex',repo,window:{},files:{selected:1,read:1,skipped:0},coverage:{partial:false,issues:[]},source:'synthetic sampled usage',totals:{calls:99,failed:99,resultsSeen:99},fileReadTotals:{requests:99,failed:99,resultsSeen:99},items:mode==='mcp'?[{kind:'mcp',name:'fixture_server',calls:1,failed:1,resultsSeen:1,metadata:'x'.repeat(40000)},{kind:'mcp',name:'unselected_server',calls:98,failed:98,resultsSeen:98}]:[],fileReads:mode==='read'?[{assetId:selected.id,requests:1,failed:1,resultsSeen:1,metadata:'x'.repeat(40000)},{assetId:unselected.id,requests:98,failed:98,resultsSeen:98}]:[]};
      return {items:[selected,unselected],usageEvidence:{[reviewKey('usage','codex',repo)]:usage},toolInspections:mode==='mcp'?{[reviewKey(selected.id,'codex',repo)]:{bytes:selected.bytes,servers:[{name:'fixture_server'}],coverage:{partial:false}}}:{}};
    }),response=await f.post('/api/context',{repo:f.repo,reviewAgent:'codex',selectionMode:'explicit',selectedIds:['asset-0'],sections:['inventory']});assert.equal(response.status,200);const parsed=verify(response.body),[header]=parsed.selectedFailureSummary.assets;
    assert.deepEqual(parsed.inventory,[]);assert.equal(count(response.body,'inventory').included,0);assert.equal(count(response.body,'selectedFailureSummary.assets').included,1);
    assert.equal(header.id,'asset-0');assert.equal(header.agent,'codex');assert.equal(header.repo,f.repo);assert.equal(header.failedCallFlags,mode==='mcp'?1:0);assert.equal(header.failedReadFlags,mode==='read'?1:0);assert.equal(header.ambiguous,mode==='mcp');
    assert.match(parsed.selectedFailureSummary.interpretation,/Name matches may overlap/);assert.match(parsed.selectedFailureSummary.interpretation,/Flags do not prove execution failure or usefulness/);
    for(const hidden of ['asset-1','unselected_server','fileReadTotals','"totals"'])assert.equal(response.body.text.includes(hidden),false,hidden);
    assert.equal(f.dispatched(),0);
  }
});
