import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const slice=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
function harness() {
 const nodes=new Map(),events=[];
 const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:true,textContent:'',open:false,closest:()=>node('folder-disclosure'),scrollIntoView(){events.push('scroll');},focus(){events.push('focus');}});return nodes.get(id);};
 const context=vm.createContext({$:node,window:{HarnessFirstUse:{render(root,props){context.props=props;}}},state:{inventory:{scannedAt:null},verificationRuns:[]},loading:null,loadingKey:'global-key',selectedAgent:'codex',activeRepo:'',refreshSequence:0,array:value=>Array.isArray(value)?value:[],location:{hash:''},loadingDirectories:new Map(),
 recommendationDecisionFor(){},recommendationDecisionCurrent(){},chooseRepo:value=>events.push(['repo',value]),chooseAgent:value=>events.push(['agent',value]),api:async()=>({inventory:{scannedAt:'synthetic-scan'}}),renderState(){events.push('render');}});
 context.HarnessFirstUse=context.window.HarnessFirstUse;
 vm.runInContext(slice('function showError(','function toast(')+slice('function renderFirstUse()','function schedulePoll()'),context);
 return {context,node,events,render:()=>context.renderFirstUse()};
}
test('first project action opens every disclosure before focusing the existing protected folder form',()=>{
 const h=harness();h.render();h.context.props.onAddProject();assert.equal(h.node('first-use-more').open,true);assert.equal(h.node('setup-guide').open,true);assert.equal(h.node('folder-disclosure').open,true);assert.deepEqual(h.events,['scroll','focus']);
 h.node('setup-guide').open=false;h.context.activeRepo='/other';h.context.props.onAddProject();assert.equal(h.node('setup-guide').open,false);
});
test('return to an active check restores the exact project, agent and nested launch folder',()=>{
 const h=harness(),run={id:'run-a',status:'running',repo:'/synthetic/project',agent:'claude',launchDirectory:'/synthetic/project/src'};h.context.state.verificationRuns=[run];h.render();h.context.props.onViewRun(run);
 assert.deepEqual(h.events,[['repo',run.repo],['agent','claude']]);assert.equal(h.context.loadingDirectories.get(JSON.stringify([run.repo,run.agent])),run.launchDirectory);assert.equal(h.context.location.hash,'dashboard');
 h.context.state.verificationRuns=[{...run,status:'completed'}];h.context.props.onViewRun(run);assert.equal(h.events.length,2);
});
test('reconnecting clears a connection banner while unrelated action errors remain visible',async()=>{
 const h=harness();h.context.api=async()=>{throw new Error('Temporary connection failure');};await h.context.refresh();assert.equal(h.node('error-banner').hidden,false);assert.equal(h.node('error-banner').connectionError,true);
 h.context.api=async()=>({});await h.context.refresh();assert.equal(h.node('error-banner').hidden,true);
 h.context.showError(new Error('Save conflict: review again'));await h.context.refresh();assert.equal(h.node('error-banner').hidden,false);assert.equal(h.node('error-banner').textContent,'Save conflict: review again');
});
test('an older poll cannot clear a newer connection failure or replace newer state',async()=>{
 const h=harness();let resolve;h.context.api=()=>new Promise(done=>{resolve=done;});const older=h.context.refresh();h.context.api=async()=>{throw new Error('New failure');};await h.context.refresh();resolve({old:true});await older;assert.equal(h.node('error-banner').hidden,false);assert.equal(h.node('error-banner').textContent,'New failure');assert.equal(h.context.state.old,undefined);
});
