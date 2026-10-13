import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server.mjs';
import {Store} from '../lib/store.mjs';

async function fixture(t) {
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'improvement-api-')));
  const home=path.join(dir,'home-fixture'),repo=path.join(dir,'repos','a'),other=path.join(dir,'repos','b');
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  for(const root of [home,repo,other])await fs.mkdir(root,{recursive:true});
  const config=path.join(repo,'.mcp.json'),instruction=path.join(repo,'AGENTS.md');
  await fs.writeFile(config,JSON.stringify({mcpServers:{fixture_server:{command:'fixture-config-body'}}}));
  await fs.writeFile(instruction,'Synthetic instruction body excluded from comparison context.');
  const store=await new Store(path.join(dir,'data')).init();
  await store.saveSettings({...store.settings,repos:[repo,other],repoRoots:[]});
  const originalConfig=await fs.readFile(config),originalInstruction=await fs.readFile(instruction),originalSettings=await fs.readFile(path.join(store.root,'settings.json'));
  let dispatched=0;
  const options={home,dataDir:store.root,probe:async()=>[{id:'codex',auth:'unknown',dispatch:'handoff',installed:false,version:''}],dispatch:async()=>{dispatched++;throw new Error('Unexpected synthetic dispatch');}};
  async function start() {
    const app=await createApp(options);
    await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});
    t.after(()=>new Promise(resolve=>app.server.close(resolve)));
    const root='http://127.0.0.1:'+app.server.address().port;
    const state=()=>fetch(root+'/api/state').then(response=>response.json()),token=(await state()).csrfToken;
    const post=async(route,body)=>{
      const response=await fetch(root+route,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':token},body:JSON.stringify(body)});
      return {status:response.status,body:await response.json()};
    };
    return {app,root,post,state};
  }
  const current=await start();assert.equal((await current.post('/api/scan',{})).status,200);
  const asset=(await current.state()).inventory.items.find(item=>item.path===instruction);assert.ok(asset);
  const create=(patch={})=>current.post('/api/improvement',{action:'create',agent:'codex',repo,title:'Synthetic comparison',change:'Use one shorter instruction',expectedBenefit:'Lower startup tokens with passing tasks',rollback:'Restore the fixture instruction',variable:'configuration',tasks:[{label:'Fixed task',prompt:'Check the synthetic result'}],assetIds:[asset.id],...patch});
  const unchanged=async()=>{
    assert.equal(dispatched,0);
    assert.deepEqual(await fs.readFile(config),originalConfig);
    assert.deepEqual(await fs.readFile(instruction),originalInstruction);
    assert.deepEqual(await fs.readFile(path.join(store.root,'settings.json')),originalSettings);
  };
  return {...current,home,repo,other,asset,create,start,unchanged};
}
function run(record,patch={}) {
  return {action:'run',id:record.id,taskId:record.tasks[0].id,runId:randomUUID(),passed:true,note:'Synthetic verification passed',model:'fixture-model',agentVersion:'fixture-version',environment:'fixture-environment',counter:'fixture-counter',startupTokens:100,totalTokens:500,seconds:10,corrections:0,compactions:0,costUSD:0,...patch};
}
async function saveRun(post,record,patch={}) {
  const result=await post('/api/improvement',run(record,patch));assert.equal(result.status,200,JSON.stringify(result.body));return result.body;
}

test('suggestion preview is read-only, scoped, scan-bound and preserves the fixed original task',async t=>{
  const f=await fixture(t),requestId=randomUUID(),scannedAt=(await f.state()).inventory.scannedAt;
  const originalTask={label:' Fixed fixture task ',prompt:'\nVerify the original synthetic result \n'};
  const ready={requestId,status:'ready',title:'Suggested fixture comparison',change:'Try the scoped procedure',rollback:'Restore the prior procedure',variable:'workflow',task:{...originalTask,qualityCheck:'Run the synthetic verification'}};
  const body={requestId,agent:'codex',repo:f.repo,assetIds:[f.asset.id],expectedInventoryScan:scannedAt,originalTask,fixedVariable:'workflow',suggestion:JSON.stringify(ready)};
  const snapshot=async()=>{
    const entries=[];
    for(const relative of (await fs.readdir(f.app.store.root,{recursive:true})).sort()){
      const file=path.join(f.app.store.root,relative);if((await fs.stat(file)).isFile())entries.push([relative,await fs.readFile(file,'utf8')]);
    }
    return {files:entries,manifest:structuredClone(f.app.store.manifest),revision:(await f.state()).componentReviewRevision,improvements:(await f.state()).improvements};
  };
  const before=await snapshot();
  assert.equal((await fetch(f.root+'/api/improvement-suggestion',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).status,400);
  const result=await f.post('/api/improvement-suggestion',body);assert.equal(result.status,200);assert.deepEqual(result.body,ready);
  const fenced=await f.post('/api/improvement-suggestion',{...body,suggestion:'```json\n'+JSON.stringify(ready)+'\n```'});assert.equal(fenced.status,200);assert.deepEqual(fenced.body,ready);
  const questions={requestId,status:'needsDetails',questions:['Which output should pass verification?']};
  assert.deepEqual((await f.post('/api/improvement-suggestion',{...body,suggestion:JSON.stringify(questions)})).body,questions);
  for(const patch of [{agent:'missing'},{repo:f.other+'/unscanned'},{repo:f.other},{assetIds:['missing']},{expectedInventoryScan:undefined},{expectedInventoryScan:'stale'},{requestId:randomUUID()},{suggestion:'Preface '+JSON.stringify(ready)},{suggestion:JSON.stringify({...ready,results:[]})},{suggestion:JSON.stringify({...ready,task:{...ready.task,prompt:ready.task.prompt.trim()}})},{suggestion:JSON.stringify({...ready,variable:'configuration'})},{suggestion:JSON.stringify({...questions,questions:[]})},{action:'create'}]){
    assert.equal((await f.post('/api/improvement-suggestion',{...body,...patch})).status,400);assert.deepEqual(await snapshot(),before);
  }
  assert.deepEqual(await snapshot(),before);await f.unchanged();
  assert.equal((await f.post('/api/scan',{})).status,200);assert.notEqual((await f.state()).inventory.scannedAt,scannedAt);
  const afterScan=await snapshot();
  for(const suggestion of [JSON.stringify(ready),JSON.stringify(questions)]){
    const stale=await f.post('/api/improvement-suggestion',{...body,suggestion});assert.equal(stale.status,400);assert.match(stale.body.error,/Inventory scan changed/);assert.equal(stale.body.error.includes(scannedAt),false);assert.deepEqual(await snapshot(),afterScan);
  }
  const refreshed=await f.post('/api/improvement-suggestion',{...body,expectedInventoryScan:(await f.state()).inventory.scannedAt});assert.equal(refreshed.status,200);assert.deepEqual(refreshed.body,ready);assert.deepEqual(await snapshot(),afterScan);await f.unchanged();
});

test('improvement actions require CSRF, known scope and immutable experiment identity',async t=>{
  const f=await fixture(t),body={action:'create',agent:'codex',repo:f.repo,title:'Synthetic comparison',change:'Shorten instruction',rollback:'Restore instruction',tasks:[{label:'Fixed task',prompt:'Synthetic prompt'}],assetIds:[]};
  assert.equal((await fetch(f.root+'/api/improvement',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).status,400);
  for(const patch of [{agent:'unknown-agent'},{repo:f.other+'/unscanned'},{assetIds:['missing-asset']},{variable:'automatic'},{tasks:[]}])assert.equal((await f.create(patch)).status,400);
  let record=(await f.create({tasks:[{label:'First',prompt:'First fixed prompt'},{label:'Second',prompt:'Second fixed prompt'}]})).body;
  assert.equal(record.assessment.verdict,'collect-baseline');
  const before=await f.app.store.read('improvements.json');
  for(const patch of [{repo:f.other},{agent:'claude'},{taskId:randomUUID()},{phase:'after'},{passed:'yes'},{startupTokens:-1},{seconds:'10'},{runId:'invalid'}])assert.equal((await f.post('/api/improvement',run(record,patch))).status,400);
  assert.deepEqual(await f.app.store.read('improvements.json'),before);
  record=await saveRun(f.post,record,{startupTokens:'',totalTokens:500,seconds:undefined,corrections:null,compactions:undefined,costUSD:''});
  assert.equal(record.runs[0].startupTokens,null);assert.equal(record.runs[0].seconds,null);assert.equal(record.runs[0].corrections,null);assert.equal(record.runs[0].costUSD,null);
  for(let index=0;index<2;index++)record=await saveRun(f.post,record);
  assert.equal((await f.post('/api/improvement',{action:'candidate',id:record.id})).status,400);
  assert.equal((await f.post('/api/improvement',{action:'decision',id:record.id,decision:'keep',note:'Synthetic decision'})).status,400);
  assert.deepEqual((await f.state()).improvements[0],record);
  await f.unchanged();
});

test('a changed inventory scan rejects comparison creation without retaining the client precondition',async t=>{
  const f=await fixture(t),captured=(await f.state()).inventory.scannedAt;
  const before=await f.app.store.read('improvements.json');
  await fs.writeFile(f.asset.path,'A new synthetic instruction version for scan freshness.');
  assert.equal((await f.post('/api/scan',{})).status,200);
  const current=(await f.state()).inventory.scannedAt;
  assert.notEqual(current,captured);
  const stale=await f.create({expectedInventoryScan:captured});
  assert.equal(stale.status,400);
  assert.equal(stale.body.error,'Inventory scan changed. Find task matches again before creating this comparison.');
  assert.equal(JSON.stringify(stale.body).includes(captured),false);
  assert.equal(JSON.stringify(stale.body).includes(current),false);
  assert.deepEqual((await f.state()).improvements,[]);
  assert.deepEqual(await f.app.store.read('improvements.json'),before);
  const exact=await f.create({expectedInventoryScan:current});
  assert.equal(exact.status,200);assert.equal(exact.body.inventorySource.scannedAt,current);
  assert.equal(Object.hasOwn(exact.body,'expectedInventoryScan'),false);
  assert.equal((await f.create()).status,200);
  const stored=await f.app.store.read('improvements.json');
  assert.equal(stored.length,2);assert.ok(stored.every(record=>!Object.hasOwn(record,'expectedInventoryScan')));
  await fs.writeFile(f.asset.path,'Synthetic instruction body excluded from comparison context.');
  await f.unchanged();
});

test('comparison captures scoped scan metadata without reading configuration bodies and cannot accept replacement evidence',async t=>{
  const f=await fixture(t),snapshot=await f.state(),config=snapshot.inventory.items.find(item=>item.path===path.join(f.repo,'.mcp.json'));
  assert.ok(config);
  for(const inventorySource of [null,{},snapshot.inventory])assert.equal((await f.create({inventorySource})).status,400);
  let record=(await f.create({assetIds:[f.asset.id,config.id]})).body;
  const captured=structuredClone(record.inventorySource);
  assert.equal(captured.scannedAt,snapshot.inventory.scannedAt);assert.equal(captured.partial,snapshot.inventory.coverage?.partial===true);
  assert.deepEqual(captured.items.map(item=>item.id),[f.asset.id,config.id]);
  assert.equal(captured.items[0].contentHash,f.asset.contentHash);assert.equal(captured.items[1].contentHash,null);
  assert.ok(captured.items.every(item=>Object.keys(item).sort().join(',')==='agent,bytes,contentHash,id,modifiedAt,name,path,repo,type'));
  assert.equal(JSON.stringify(captured).includes('fixture-config-body'),false);assert.equal(JSON.stringify(captured).includes('Synthetic instruction body'),false);
  await fs.writeFile(f.asset.path,'A changed synthetic version.');await f.post('/api/scan',{});
  const next=(await f.create({title:'Later snapshot'})).body;assert.notEqual(next.inventorySource.items[0].contentHash,captured.items[0].contentHash);
  record=await saveRun(f.post,record);assert.deepEqual(record.inventorySource,captured);
  for(let i=0;i<2;i++)record=await saveRun(f.post,record);
  for(const action of ['run','candidate','decision'])assert.equal((await f.post('/api/improvement',{...run(record),action,decision:'restored',inventorySource:captured})).status,400);
  record=(await f.post('/api/improvement',{action:'candidate',id:record.id})).body;assert.deepEqual(record.inventorySource,captured);
  record=(await f.post('/api/improvement',{action:'decision',id:record.id,decision:'restored',note:'Synthetic manual restoration noted'})).body;assert.deepEqual(record.inventorySource,captured);
  const restarted=await f.start();assert.deepEqual((await restarted.state()).improvements.find(item=>item.id===record.id).inventorySource,captured);
  const preview=await f.post('/api/context',{repo:f.repo,reviewAgent:'codex',selectionMode:'explicit',selectedIds:[],sections:['improvements'],improvementIds:[record.id]});
  const evidence=JSON.parse(preview.body.text).improvements[0].inventorySource;
  assert.deepEqual(evidence.items,captured.items);assert.match(evidence.interpretation,/last scan.*Not live or loaded-version/);
  assert.equal(preview.body.text.includes('fixture-config-body'),false);assert.equal(preview.body.text.includes('A changed synthetic version.'),false);
  await fs.writeFile(f.asset.path,'Synthetic instruction body excluded from comparison context.');await f.unchanged();
});

test('saved three-run phases are idempotent, assessed per task and locked after decision',async t=>{
  const f=await fixture(t);let record=(await f.create()).body;
  const first=run(record),saved=await f.post('/api/improvement',first);assert.equal(saved.status,200);record=saved.body;
  assert.deepEqual((await f.post('/api/improvement',first)).body,record);
  assert.equal((await f.post('/api/improvement',{...first,totalTokens:501})).status,400);
  for(let index=0;index<2;index++)record=await saveRun(f.post,record);
  assert.equal(record.runs.length,3);assert.ok(record.runs.every(item=>item.phase==='before'));
  const candidate=await f.post('/api/improvement',{action:'candidate',id:record.id});assert.equal(candidate.status,200);record=candidate.body;
  assert.deepEqual((await f.post('/api/improvement',first)).body,record);
  assert.equal((await f.post('/api/improvement',{action:'candidate',id:record.id})).status,400);
  for(let index=0;index<2;index++)record=await saveRun(f.post,record,{startupTokens:50,totalTokens:400,seconds:8});
  assert.equal(record.assessment.ready,false);
  assert.equal((await f.post('/api/improvement',{action:'decision',id:record.id,decision:'keep',note:'Too early'})).status,400);
  record=await saveRun(f.post,record,{startupTokens:50,totalTokens:400,seconds:8,environment:'different-fixture'});
  assert.equal(record.assessment.verdict,'incomparable');
  assert.equal((await f.post('/api/improvement',{action:'decision',id:record.id,decision:'keep',note:'Conditions differ'})).status,400);
  const matching=(await f.create({title:'Comparable comparison'})).body;record=matching;
  for(let index=0;index<3;index++)record=await saveRun(f.post,record);
  record=(await f.post('/api/improvement',{action:'candidate',id:record.id})).body;
  for(let index=0;index<3;index++)record=await saveRun(f.post,record,{startupTokens:50,totalTokens:400,seconds:8});
  assert.equal(record.assessment.ready,true);assert.equal(record.assessment.verdict,'improved');
  assert.deepEqual(record.assessment.tasks[0].deltas.totalTokens,{before:500,after:400,reduction:100,percent:20});
  assert.equal(record.assessment.tasks[0].deltas.costUSD.percent,null);
  const decision=await f.post('/api/improvement',{action:'decision',id:record.id,decision:'restored',note:'Restored manually after synthetic review'});assert.equal(decision.status,200);record=decision.body;
  assert.equal(record.status,'closed');assert.equal(record.decision.decision,'restored');
  for(const action of ['run','candidate','decision'])assert.equal((await f.post('/api/improvement',{...run(record),action,decision:'keep'})).status,400);
  assert.deepEqual((await f.state()).improvements.find(item=>item.id===record.id),record);
  await f.unchanged();
});

test('private ledger stays pinned through retention and restart, caps records and never applies changes',async t=>{
  const f=await fixture(t);let record=(await f.create()).body;record=await saveRun(f.post,record);
  assert.equal(f.app.store.manifest['improvements.json'].kind,'improvement-test');assert.equal(f.app.store.manifest['improvements.json'].pinned,true);
  f.app.store.manifest['improvements.json'].updatedAt='2000-01-01T00:00:00Z';
  const prune=await f.post('/api/prune',{days:1,preview:false});assert.equal(prune.status,200);
  assert.equal(prune.body.files.some(item=>item.path==='improvements.json'),false);
  assert.equal((await fs.stat(await f.app.store.location('improvements.json'))).mode&0o777,0o600);
  const resumed=await f.start();assert.deepEqual((await resumed.state()).improvements,[record]);
  const records=Array.from({length:100},(_,index)=>({...record,id:randomUUID(),title:'Synthetic retained comparison '+index}));
  await f.app.store.write('improvements.json',records,{kind:'improvement-test',pinned:true});
  const full=await f.start();assert.equal((await full.state()).improvements.length,100);
  assert.equal((await full.post('/api/improvement',{action:'create',agent:'codex',repo:f.repo,title:'Overflow comparison',change:'Synthetic change',rollback:'Synthetic restore',tasks:[{label:'Fixed',prompt:'Synthetic prompt'}],assetIds:[]})).status,400);
  assert.equal((await full.state()).improvements.length,100);
  assert.equal((await full.post('/api/improvement',run(records[0]))).status,200);
  await f.unchanged();
});

test('comparison context is bounded and redacted; handoffs retain experiment, scope and evidence agent',async t=>{
  const f=await fixture(t),sensitive=['sk','-', 'syntheticcredential12345'].join('');
  const prompt='Synthetic fixed prompt '+sensitive+' '+'.'.repeat(700),note='Synthetic checked outcome '+sensitive+' '+'.'.repeat(600);
  let record=(await f.create({title:'Review '+sensitive,change:'Change '+sensitive,expectedBenefit:'Benefit '+sensitive,rollback:'Restore '+sensitive,tasks:[{label:'Task '+sensitive,prompt}]})).body;
  for(let index=0;index<4;index++)record=await saveRun(f.post,record,{note});
  for(const patch of [{agent:'claude',assetIds:[],title:'Other evidence agent'},{repo:f.other,assetIds:[],title:'Other repository'},{repo:'',assetIds:[],title:'Global comparison'}])assert.equal((await f.create(patch)).status,200);
  const scope={repo:f.repo,reviewAgent:'codex',selectionMode:'explicit',selectedIds:[f.asset.id],sections:['improvements'],improvementIds:[record.id]};
  const preview=await f.post('/api/context',scope);assert.equal(preview.status,200);
  const context=JSON.parse(preview.body.text);assert.equal(context.improvements.length,1);assert.equal(context.improvements[0].id,record.id);
  assert.ok(context.improvements[0].tasks[0].promptExcerpt.length<=400);assert.ok(context.improvements[0].tasks[0].omittedPromptCharacters>0);
  assert.equal(context.improvements[0].latestRunNotes.length,3);assert.ok(context.improvements[0].latestRunNotes.every(item=>item.noteExcerpt.length<=300&&item.omittedNoteCharacters>0));
  for(const value of [sensitive,'fixture-config-body','Synthetic instruction body','Other evidence agent','Other repository','Global comparison'])assert.equal(preview.body.text.includes(value),false,value);
  assert.match(preview.body.text,/REDACTED/);assert.equal((await fs.readFile(await f.app.store.location('improvements.json'),'utf8')).includes(sensitive),false);
  for(const patch of [{repo:f.other},{reviewAgent:'claude'},{reviewAgent:''},{repo:'',globalOnly:true},{improvementIds:[randomUUID()]}])assert.equal((await f.post('/api/context',{...scope,...patch})).status,400);
  const global=(await f.state()).improvements.find(item=>!item.repo);
  assert.equal((await f.post('/api/context',{...scope,repo:'',globalOnly:false,improvementIds:[global.id]})).status,400);
  assert.equal((await f.post('/api/context',{...scope,repo:'',globalOnly:true,selectedIds:[],improvementIds:[global.id]})).status,200);
  const selected=JSON.parse((await f.post('/api/context',{...scope,improvementIds:[]})).body.text);assert.deepEqual(selected.improvements.map(item=>item.id),[record.id]);
  const empty=JSON.parse((await f.post('/api/context',{...scope,improvementIds:[],selectedIds:[]})).body.text);assert.deepEqual(empty.improvements,[]);
  for(let index=0;index<3;index++)await f.create({title:'Scoped extra '+index});
  const all=await f.post('/api/context',{...scope,improvementIds:[],selectionMode:'all',selectedIds:[]});assert.equal(JSON.parse(all.body.text).improvements.length,3);assert.equal(all.body.truncated,true);
  let chat=(await f.post('/api/chat',{...scope,agent:'codex',prompt:'Review this synthetic comparison'})).body;
  assert.equal(chat.status,'handoff');assert.deepEqual(chat.improvementIds,[record.id]);assert.equal(chat.repo,f.repo);assert.equal(chat.reviewAgent,'codex');assert.equal(chat.globalOnly,false);
  assert.equal(chat.handoffText.includes(sensitive),false);assert.equal(JSON.parse(chat.context.text).improvements[0].id,record.id);
  assert.equal((await f.post('/api/chat',{id:chat.id,prompt:'Switch experiment',improvementIds:[global.id]})).status,400);
  assert.equal((await f.post('/api/chat',{id:chat.id,prompt:'Remove experiment',improvementIds:[]})).status,400);
  assert.equal((await f.post('/api/reply',{id:chat.id,content:'Synthetic advisory response '+sensitive})).status,200);
  const followup=await f.post('/api/chat',{id:chat.id,prompt:'Check the same experiment again',repo:f.other,reviewAgent:'claude',globalOnly:true,agent:'claude'});assert.equal(followup.status,200);chat=followup.body;
  assert.equal(chat.status,'handoff');assert.deepEqual(chat.improvementIds,[record.id]);assert.equal(chat.repo,f.repo);assert.equal(chat.reviewAgent,'codex');assert.equal(chat.agent,'codex');assert.equal(chat.globalOnly,false);
  assert.equal(chat.messages.filter(message=>message.role==='user').length,2);assert.equal(chat.handoffText.includes('Synthetic advisory response'),true);assert.equal(chat.handoffText.includes(sensitive),false);
  const resumed=await f.start(),saved=(await resumed.state()).conversations.find(item=>item.id===chat.id);assert.deepEqual(saved.improvementIds,[record.id]);assert.equal(saved.repo,f.repo);assert.equal(saved.reviewAgent,'codex');
  await f.unchanged();
});

test('recording corrections recover baseline eligibility, retain originals and survive failed writes and restart',async t=>{
  const f=await fixture(t);let record=(await f.create()).body;
  record=await saveRun(f.post,record,{model:'',note:'Original mistaken recording'});
  const original=record.runs[0];
  for(let index=0;index<2;index++)record=await saveRun(f.post,record);
  assert.equal(record.assessment.baselineEligible,false);
  assert.equal((await f.post('/api/improvement',{action:'candidate',id:record.id})).status,400);
  const reason='Corrected an omitted condition '+['sk','-','syntheticcredential12345'].join('')+' '+'.'.repeat(400);
  const correction=run(record,{correctsRunId:original.id,correctionReason:reason,note:'Corrected recording'});
  const write=f.app.store.write;
  f.app.store.write=async function(file,...args){if(file==='improvements.json')throw new Error('Synthetic write failure');return write.call(this,file,...args);};
  assert.equal((await f.post('/api/improvement',correction)).status,400);
  assert.deepEqual((await f.state()).improvements[0],record);
  f.app.store.write=write;
  const saved=await f.post('/api/improvement',correction);assert.equal(saved.status,200);record=saved.body;
  assert.deepEqual(record.runs[0],original);
  assert.equal(record.runs.length,4);assert.equal(record.assessment.tasks[0].before.runs,3);
  assert.equal(record.assessment.baselineEligible,true);
  assert.equal(record.runs.at(-1).correctsRunId,original.id);
  assert.deepEqual((await f.post('/api/improvement',correction)).body,record);
  assert.equal((await f.post('/api/improvement',{...correction,note:'Conflicting retry'})).status,400);
  const preview=await f.post('/api/context',{repo:f.repo,reviewAgent:'codex',selectionMode:'explicit',sections:['improvements'],selectedIds:[],improvementIds:[record.id]});
  assert.equal(preview.status,200);
  const context=JSON.parse(preview.body.text).improvements[0];
  assert.equal(context.correctedRecordings,1);
  assert.equal(context.latestRunNotes.some(run=>run.noteExcerpt==='Original mistaken recording'),false);
  assert.equal(context.latestRunNotes.at(-1).correctedRecording,true);
  assert.ok(context.latestRunNotes.at(-1).correctionReasonExcerpt.length<=300);
  assert.ok(context.latestRunNotes.at(-1).omittedCorrectionCharacters>0);
  assert.equal(preview.body.text.includes(['sk','-','syntheticcredential12345'].join('')),false);
  record=(await f.post('/api/improvement',{action:'candidate',id:record.id})).body;
  assert.equal(record.status,'candidate');
  assert.equal((await f.post('/api/improvement',run(record,{correctsRunId:original.id,correctionReason:'Too late'}))).status,400);
  const resumed=await f.start();assert.deepEqual((await resumed.state()).improvements,[record]);
  await f.unchanged();
});

test('manual restoration is recordable before complete or comparable outcomes without asserting improvement',async t=>{
  const f=await fixture(t);
  for(const variant of ['incomplete','incomparable','insufficient-metrics']){
    let record=(await f.create({title:'Restoration '+variant})).body;
    for(let index=0;index<3;index++)record=await saveRun(f.post,record,{startupTokens:null,seconds:null,corrections:null,compactions:null,costUSD:null});
    record=(await f.post('/api/improvement',{action:'candidate',id:record.id})).body;
    const repeats=variant==='incomplete'?1:3;
    for(let index=0;index<repeats;index++)record=await saveRun(f.post,record,variant==='incomparable'?{environment:'changed-task-input'}:variant==='insufficient-metrics'?{startupTokens:50,totalTokens:null,seconds:null,corrections:null,compactions:null,costUSD:null}:{});
    const verdict=record.assessment.verdict;
    assert.equal(verdict,variant==='incomplete'?'collect-after':variant);
    assert.equal((await f.post('/api/improvement',{action:'decision',id:record.id,decision:'keep',note:'No adequate comparison'})).status,400);
    assert.equal((await f.post('/api/improvement',{action:'decision',id:record.id,decision:'restored',note:''})).status,400);
    const result=await f.post('/api/improvement',{action:'decision',id:record.id,decision:'restored',note:'I restored the fixture setup myself; comparison remains unresolved'});
    assert.equal(result.status,200);record=result.body;
    assert.equal(record.status,'closed');assert.equal(record.decision.decision,'restored');
    assert.equal(record.assessment.verdict,verdict);
    assert.equal((await f.post('/api/improvement',run(record))).status,400);
  }
  const resumed=await f.start();assert.ok((await resumed.state()).improvements.every(record=>record.status==='closed'&&record.decision.decision==='restored'));
  await f.unchanged();
});
