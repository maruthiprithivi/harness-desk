import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {Store} from '../lib/store.mjs';
import {createApp} from '../server.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
async function fixture(t,{auth='signed-in',seedRuns=[],agent='codex'}={}) {
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'verification-api-')));
  const home=path.join(dir,'home'),repo=path.join(dir,'project'),outside=path.join(dir,'new-project');
  await Promise.all([home,repo,outside].map(folder=>fs.mkdir(folder)));await fs.writeFile(path.join(repo,'AGENTS.md'),'Synthetic project instructions.');
  const store=await new Store(path.join(dir,'data')).init();await store.saveSettings({...store.settings,repos:[repo],repoRoots:[]});
  if(seedRuns.length)await store.write('verification-runs.json',seedRuns,{kind:'verification'});
  const calls=[];
  const verify=args=>new Promise((resolve,reject)=>{
    const call={args,resolve,reject};calls.push(call);
    args.signal.addEventListener('abort',()=>reject(new Error('Cancelled synthetic check.')),{once:true});
  });
  const app=await createApp({home,dataDir:store.root,verify,probe:async()=>[{id:agent,installed:true,auth,version:'test-version'}],dispatch:async()=>{throw new Error('Unexpected provider dispatch');}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>app.server.close(resolve));await app.store.pendingWrite;await fs.rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
  const url='http://127.0.0.1:'+app.server.address().port,state=()=>fetch(url+'/api/state').then(response=>response.json());
  const token=(await state()).csrfToken;
  const post=async body=>{const response=await fetch(url+'/api/verification',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':token},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
  await app.scanNow();
  const start={action:'start',agent,repo,launchDirectory:repo,prompt:'Explain the synthetic test instructions without using tools.',expectedText:'synthetic',model:'fixture-model',acknowledge:true};
  const complete=(index=0,inputTokens=200,overrides={})=>{
    const {args,resolve}=calls[index];
    resolve({measurement:{agent:args.agent,repo:args.repo,launchDirectory:args.launchDirectory,sessionId:hash(randomUUID()),promptHash:hash(args.prompt),method:args.agent+'-first-request-input',model:args.model||'fixture-model',agentVersion:'test-version',inputTokens,capacity:1000,measuredAt:new Date().toISOString(),...overrides},check:{status:args.expectedText?'passed':'not-configured',description:'Synthetic response check.'},answer:'Synthetic test response.',launch:{sandbox:'read-only'}});
  };
  const wait=async(id,status)=>{
    for(let attempt=0;attempt<60;attempt++){
      const result=await state(),run=result.verificationRuns.find(item=>item.id===id);
      if(run?.status===status)return {run,state:result};
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.fail('Verification did not reach '+status);
  };
  return {app,dir,repo,outside,home,state,post,start,calls,complete,wait,url};
}

test('a real-run acknowledgement and Codex sign-in are required before dispatch',async t=>{
  const f=await fixture(t);
  for(const acknowledge of [undefined,false,'true'])assert.equal((await f.post({...f.start,acknowledge})).status,400);
  assert.equal((await f.post({...f.start,agent:'claude'})).status,400);assert.equal(f.calls.length,0);
  const signedOut=await fixture(t,{auth:'signed-out'});assert.equal((await signedOut.post(signedOut.start)).status,400);assert.equal(signedOut.calls.length,0);
  const noCsrf=await fetch(f.url+'/api/verification',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(f.start)});assert.equal(noCsrf.status,400);
});

test('Claude automatic baseline and repeat persist readings and use the matching agent adapter',async t=>{
  const f=await fixture(t,{agent:'claude'}),before=await f.post(f.start);assert.equal(before.status,200);assert.equal(f.calls[0].args.agent,'claude');
  f.complete(0,300);await f.wait(before.body.id,'completed');const after=await f.post({...f.start,baselineId:before.body.id});f.complete(1,250);
  const result=await f.wait(after.body.id,'completed');assert.equal(result.run.comparison.reductionTokens,50);assert.equal(result.state.agentSupport.claude.verification,'automatic');assert.equal(result.state.agentSupport.kiro.verification,'automatic');
});

test('launch scope must be canonical and owned by the selected scanned repository',async t=>{
  const f=await fixture(t),link=path.join(f.dir,'project-link');await fs.symlink(f.repo,link);
  for(const body of [
    {...f.start,repo:f.outside,launchDirectory:f.outside},
    {...f.start,launchDirectory:f.outside},
    {...f.start,repo:'',launchDirectory:f.repo},
    {...f.start,launchDirectory:'relative-folder'},
    {...f.start,launchDirectory:link},
    {...f.start,launchDirectory:path.join(f.repo,'AGENTS.md')}
  ])assert.equal((await f.post(body)).status,400);
  assert.equal(f.calls.length,0);
  const result=await f.post({...f.start,repo:'',launchDirectory:f.outside});assert.equal(result.status,200);assert.equal(result.body.status,'running');f.complete();
  const completed=await f.wait(result.body.id,'completed');assert.equal(completed.state.contextEvidence[0].repo,'');assert.equal(completed.state.contextEvidence[0].launchDirectory,f.outside);
});

test('start returns running then saves the completed measurement; repeat compares identical conditions',async t=>{
  const f=await fixture(t),before=await f.post(f.start);assert.equal(before.status,200);assert.equal(before.body.status,'running');assert.equal((await f.state()).contextEvidence.length,0);
  f.complete(0,200);const baseline=await f.wait(before.body.id,'completed');assert.equal(baseline.run.check.status,'passed');assert.equal(baseline.state.contextEvidence.length,1);assert.equal(baseline.run.measurementId,baseline.state.contextEvidence[0].id);
  for(const change of [{prompt:'A different task.'},{model:'another-model'},{expectedText:'different'}])assert.equal((await f.post({...f.start,baselineId:before.body.id,...change})).status,400);
  assert.equal(f.calls.length,1);
  const after=await f.post({...f.start,baselineId:before.body.id});assert.equal(after.status,200);f.complete(1,150);
  const candidate=await f.wait(after.body.id,'completed');assert.equal(candidate.run.comparison.comparable,true);assert.equal(candidate.run.comparison.reductionTokens,50);assert.equal(candidate.run.comparison.reductionPercentagePoints,5);assert.equal(candidate.state.contextEvidence.length,2);
  assert.equal(await fs.readFile(path.join(f.repo,'AGENTS.md'),'utf8'),'Synthetic project instructions.');
});

test('one active run prevents double-start and cancellation never captures a measurement',async t=>{
  const f=await fixture(t),responses=await Promise.all([f.post(f.start),f.post(f.start)]);
  assert.deepEqual(responses.map(response=>response.status).sort(),[200,400]);assert.equal(f.calls.length,1);
  const started=responses.find(response=>response.status===200);
  const cancelled=await f.post({action:'cancel',id:started.body.id});assert.equal(cancelled.status,200);assert.equal(cancelled.body.cancelled,true);assert.equal(f.calls[0].args.signal.aborted,true);
  const result=await f.wait(started.body.id,'cancelled');assert.equal(result.state.contextEvidence.length,0);assert.equal(result.run.measurementId,undefined);assert.equal(f.calls.length,1);
  assert.equal((await f.post({action:'cancel',id:started.body.id})).status,400);
});

test('failed checks do not retry or capture; persisted running checks become interrupted on restart',async t=>{
  const f=await fixture(t),started=await f.post(f.start);f.calls[0].reject(new Error('Synthetic runner failed.'));
  const failed=await f.wait(started.body.id,'failed');assert.match(failed.run.error,/Synthetic runner failed/);assert.equal(failed.state.contextEvidence.length,0);assert.equal(f.calls.length,1);
  const interruptedId=randomUUID(),restarted=await fixture(t,{seedRuns:[{id:interruptedId,status:'running',agent:'codex'}]});
  const state=await restarted.state();assert.equal(state.verificationRuns[0].status,'interrupted');assert.match(state.verificationRuns[0].error,/No automatic retry/);assert.equal(restarted.calls.length,0);assert.equal(state.contextEvidence.length,0);
  assert.equal((await restarted.app.store.read('verification-runs.json'))[0].status,'interrupted');
});

test('unsupported fields cannot inject measurements, launcher options or a baseline',async t=>{
  const f=await fixture(t);
  for(const extra of [{inputTokens:1},{measurement:{inputTokens:1}},{shell:true},{args:['--dangerously-bypass-approvals-and-sandbox']},{capacity:1000000},{baselineId:randomUUID()},{model:'--bad model'}])assert.equal((await f.post({...f.start,...extra})).status,400);
  assert.equal((await f.post({action:'cancel',id:randomUUID(),inputTokens:1})).status,400);
  assert.equal(f.calls.length,0);assert.equal((await f.state()).contextEvidence.length,0);
});

test('runner result from a different scope is rejected without saving counters',async t=>{
  const f=await fixture(t),started=await f.post(f.start);f.complete(0,100,{repo:f.outside,launchDirectory:f.outside});
  const result=await f.wait(started.body.id,'failed');assert.equal(result.state.contextEvidence.length,0);assert.equal(f.calls.length,1);
});
