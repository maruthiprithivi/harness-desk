import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/first-use.js',import.meta.url),'utf8');
function harness(api=async()=>({files:[]})) {
  class Node {
    constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.style={};this.events={};this.textContent='';}
    append(...nodes){this.children.push(...nodes);}
    replaceChildren(...nodes){this.children=nodes;}
    setAttribute(key,value){this[key]=value;}
    addEventListener(name,callback){this.events[name]=callback;}
    contains(node){return this===node || this.children.some(child=>child.contains(node));}
    all(){return [this,...this.children.flatMap(child=>child.all())];}
    querySelectorAll(query){const tags=query.split(',');return this.all().filter(node=>tags.includes(node.tag));}
    querySelector(query){const key=query.match(/data-first-use-focus="([^" ]+)"/)?.[1];return this.all().find(node=>node.dataset.firstUseFocus===key);}
    focus(){doc.activeElement=this;}
    async click(){if(!this.disabled)await this.events.click?.();}
    async change(value){this.value=value;await this.events.change?.();}
  }
  const doc={createElement:tag=>new Node(tag),activeElement:null};const context=vm.createContext({window:{},document:doc,Intl,Date});vm.runInContext(source,context);
  const root=new Node('root'), calls=[];
  const props={agent:'codex',repo:'/project',state:{contextEvidence:[]},loading:{agent:'codex',repo:'/project',launchDirectory:'/project',groups:[{files:[{id:'global',name:'AGENTS.md',type:'instruction',status:'applies',repo:'',path:'/synthetic/global/AGENTS.md'},{id:'local',name:'AGENTS.override.md',type:'instruction',status:'applies',repo:'/project',path:'/project/AGENTS.override.md'}]}]},insights:[],api,onEdit:id=>calls.push(id),onFiles:()=>calls.push('files'),onAsk:record=>calls.push(record),onImprove:()=>calls.push('check')};
  const ui=context.window.HarnessFirstUse;
  return {ui,root,props,calls,render:()=>ui.render(root,props),text:()=>root.all().map(node=>node.textContent).join(' '),find:label=>root.all().find(node=>node.textContent===label),flush:()=>new Promise(resolve=>setImmediate(resolve))};
}
const reading=(id,inputTokens=100)=>({id,agent:'codex',repo:'/project',launchDirectory:'/project',inputTokens,capacity:1000,measuredAt:'2026-01-01',model:'test'});

test('initial flow explains sources without fetching sessions or inventing a context split',()=>{
  let calls=0;const h=harness(async()=>{calls++;return {};});h.render();
  assert.equal(calls,0);assert.match(h.text(),/Global.*AGENTS.md.*Project.*AGENTS.override.md/);assert.match(h.text(),/Read a local session/);
  assert.equal(h.root.all().some(node=>node.className==='first-use-meter'),false);
  assert.doesNotMatch(h.text(),/Not measured|Verified improvement/);
  h.find('Open file').click();assert.equal(h.calls[0],'global');
});
test('measurement selection requires agent, repository and launch directory and preserves zero',()=>{
  const h=harness();const values=[reading('zero',0),{...reading('folder'),launchDirectory:'/project/src'},{...reading('other'),agent:'claude'},{...reading('global'),repo:''},{...reading('invalid'),inputTokens:-1}];
  assert.deepEqual(Array.from(h.ui.measurements(values,'codex','/project','/project'),item=>item.id),['zero']);
  assert.equal(h.ui.occupancy(values[0]),0);assert.equal(h.ui.occupancy({...values[0],capacity:null}),null);
});
test('shadowed instructions are excluded and repeated sources deduplicated',()=>{
  const h=harness();h.props.loading.groups[0].files.push({...h.props.loading.groups[0].files[0]},{id:'shadowed',type:'instruction',status:'shadowed'});
  assert.equal(h.ui.sources(h.props.loading).length,2);
});
test('session read requires selection, preview and explicit save with source digest',async()=>{
  const calls=[];const h=harness(async(path,body)=>{
    calls.push({path,body});if(path==='/api/session-files')return {files:[{path:'/session.jsonl',label:'Session A',importable:true,modifiedAt:'2026-01-01'}]};
    if(body.action==='preview')return {applicable:true,measurement:reading('preview'),sourceDigest:'exact-file-version',issues:[]};
    return {measurement:reading('saved')};
  });h.render();await h.find('Read a local session').click();await h.flush();
  assert.equal(calls.length,1);assert.equal(h.find('Preview selected session').disabled,true);
  await h.root.all().find(node=>node.tag==='input' && node.type==='radio').change('/session.jsonl');await h.find('Preview selected session').click();
  assert.equal(calls.length,2);assert.match(h.text(),/Preview · not saved/);assert.equal(h.props.state.contextEvidence.length,0);
  await h.find('Save this reading').click();assert.equal(calls[2].body.sourceDigest,'exact-file-version');assert.match(h.text(),/Latest saved reading/);
});
test('refresh preserves draft selection but scope change ignores an in-flight preview',async()=>{
  let resolvePreview;const h=harness(async(path)=>path==='/api/session-files'?{files:[{path:'/session.jsonl',label:'Session A',importable:true}]}:new Promise(resolve=>{resolvePreview=resolve;}));
  h.render();await h.find('Read a local session').click();await h.flush();await h.root.all().find(node=>node.tag==='input' && node.type==='radio').change('/session.jsonl');h.render();
  assert.equal(h.root.all().find(node=>node.tag==='input' && node.type==='radio').checked,true);
  const pending=h.find('Preview selected session').click();h.props={...h.props};
  // The caller uses a fresh scope object when navigating.
  h.ui.render(h.root,{...h.props,repo:'/other',loading:{agent:'codex',repo:'/other',launchDirectory:'/other'}});
  resolvePreview({applicable:true,measurement:reading('old'),sourceDigest:'old'});await pending;
  assert.doesNotMatch(h.text(),/Preview · not saved|Session A/);
});
test('comparison stays explicit and reports reduction without claiming behavior verified',async()=>{
  const h=harness(async()=>({comparable:true,reasons:[],savedTokens:30,inputTokensBefore:100,inputTokensAfter:70}));h.props.state.contextEvidence=[reading('before'),reading('after',70)];h.render();
  const select=()=>h.root.all().filter(node=>node.tag==='select');await select()[0].change('before');await select()[1].change('after');await h.find('Compare readings').click();
  assert.match(h.text(),/30 fewer input tokens observed/);assert.match(h.text(),/does not.*establish that behavior improved/);assert.match(h.text(),/Plan a representative check/);
});
test('reader failures remain actionable, unsupported agents do not offer collection',async()=>{
  const h=harness(async()=>{throw new Error('Session file changed. Preview again.');});h.render();await h.find('Read a local session').click();await h.flush();
  assert.match(h.text(),/Session file changed/);assert.equal(h.find('Find sessions again').disabled,undefined);
  h.ui.render(h.root,{...h.props,agent:'kimi'});assert.equal(h.find('Read a local session'),undefined);assert.match(h.text(),/automatic measurement not available yet/);
});
test('insights remain bounded and source content is rendered as text',()=>{
  const h=harness();h.props.insights=Array.from({length:4},(_,i)=>({title:'Finding '+i,evidence:'<img src=x onerror=alert(1)>',itemId:'item'+i}));h.render();
  assert.match(h.text(),/Finding 2/);assert.doesNotMatch(h.text(),/Finding 3/);assert.equal(h.root.all().some(node=>node.tag==='img'),false);
});
test('matching repository but different launch folder cannot be captured',async()=>{
  const h=harness(async(path)=>path==='/api/session-files'?{files:[{path:'/session.jsonl',label:'Nested session',importable:true}]}:{applicable:true,measurement:{...reading('nested'),launchDirectory:'/project/src'},sourceDigest:'digest'});
  h.render();await h.find('Read a local session').click();await h.flush();await h.root.all().find(node=>node.tag==='input' && node.type==='radio').change('/session.jsonl');await h.find('Preview selected session').click();
  assert.equal(h.find('Save this reading'),undefined);assert.match(h.text(),/different folder/);
});
test('global measurements retain explicit launch folders instead of requiring an empty cwd',()=>{
  const h=harness();const records=[{...reading('global-a'),repo:'',launchDirectory:'/new-project'},{...reading('global-b'),repo:'',launchDirectory:'/another-project'},reading('repo')];
  assert.deepEqual(Array.from(h.ui.measurements(records,'codex','',''),record=>record.id),['global-a','global-b']);
  h.ui.render(h.root,{...h.props,repo:'',loading:{agent:'codex',repo:'',launchDirectory:'',groups:[]},state:{contextEvidence:records}});
  assert.match(h.text(),/Launch folder: \/new-project/);assert.match(h.text(),/\/another-project/);assert.equal(h.root.all().some(node=>node.tag==='h1'),false);
});
test('validated global session can be saved with a real launch folder',async()=>{
  const global={...reading('global'),repo:'',launchDirectory:'/new-project'};
  const calls=[];const h=harness(async(path,body)=>{
    calls.push(body);
    if(path==='/api/session-files')return {files:[{path:'/session.jsonl',label:'New project session',importable:true}]};
    if(body.action==='preview')return {applicable:true,measurement:global,sourceDigest:'digest'};
    return global;
  });
  h.props.repo='';h.props.loading={agent:'codex',repo:'',launchDirectory:'',groups:[]};h.render();
  await h.find('Read a local session').click();await h.flush();await h.root.all().find(node=>node.tag==='input' && node.type==='radio').change('/session.jsonl');await h.find('Preview selected session').click();
  assert.ok(h.find('Save this reading'));await h.find('Save this reading').click();assert.equal(calls.at(-1).action,'capture');assert.match(h.text(),/Launch folder: \/new-project/);
});
const runRecord=(extra={})=>({id:'run-a',agent:'codex',repo:'/project',launchDirectory:'/project',status:'completed',prompt:'Explain the testing instructions.',expectedText:'tests',model:'chosen-model',createdAt:'2026-01-01',check:{status:'passed',description:'The response contains the expected literal text.'},...extra});
function acknowledge(h) {const box=h.root.all().find(node=>node.tag==='input'&&node.type==='checkbox');box.checked=true;return box.change();}
function draftField(h,name) {return h.root.all().find(node=>node.dataset.firstUseFocus==='draft-'+name);}

test('automatic baseline requires explicit acknowledgement and preserves draft through refresh',async()=>{
  const calls=[];const h=harness(async(path,body)=>{calls.push({path,body});return runRecord({status:'running'});});h.render();
  assert.equal(h.find('Run baseline check').disabled,true);assert.equal(calls.length,0);
  const prompt=draftField(h,'prompt');prompt.value='Explain the lint workflow without tools.';prompt.events.input();h.render();
  assert.equal(draftField(h,'prompt').value,'Explain the lint workflow without tools.');assert.match(h.text(),/uses account tokens/);assert.match(h.text(),/hooks, extensions and MCP servers may run/);
  await acknowledge(h);await h.find('Run baseline check').click();
  assert.equal(calls.length,1);assert.equal(calls[0].path,'/api/verification');assert.equal(calls[0].body.prompt,prompt.value);assert.equal(calls[0].body.acknowledge,true);assert.match(h.text(),/Verification is running/);assert.ok(h.find('Cancel verification'));
});
test('completed baseline repeats exact conditions with fresh permission and baseline identity',async()=>{
  let sent;const h=harness(async(_path,body)=>{sent=body;return runRecord({id:'run-b',status:'running',baselineId:'run-a',createdAt:'2026-01-02'});});h.props.state.verificationRuns=[runRecord()];h.render();
  assert.equal(h.find('Run again after a change').disabled,true);assert.match(h.text(),/Response text check: passed/);assert.match(h.text(),/contains the expected literal text/);
  await acknowledge(h);await h.find('Run again after a change').click();
  assert.equal(sent.baselineId,'run-a');assert.equal(sent.prompt,'Explain the testing instructions.');assert.equal(sent.model,'chosen-model');assert.equal(sent.expectedText,'tests');assert.equal(sent.launchDirectory,'/project');
});
test('running check has cancellation and changed scope ignores a late start response',async()=>{
  const calls=[];const h=harness(async(_path,body)=>{calls.push(body);return runRecord({status:'cancelled'});});h.props.state.verificationRuns=[runRecord({status:'running'})];h.render();await h.find('Cancel verification').click();assert.equal(calls[0].action,'cancel');assert.equal(calls[0].id,'run-a');
  let finish;const other=harness(()=>new Promise(resolve=>{finish=resolve;}));other.render();await acknowledge(other);const pending=other.find('Run baseline check').click();other.ui.render(other.root,{...other.props,repo:'/other',loading:{agent:'codex',repo:'/other',launchDirectory:'/other',groups:[]}});finish(runRecord({status:'running'}));await pending;assert.doesNotMatch(other.text(),/Verification is running/);
});
test('global automatic checks require an absolute folder and Claude also offers automatic collection',async()=>{
  let called=false;const h=harness(async()=>{called=true;return {};});h.props.repo='';h.props.loading={agent:'codex',repo:'',launchDirectory:'',groups:[]};h.render();
  await acknowledge(h);await h.find('Run baseline check').click();assert.equal(called,false);assert.match(h.text(),/Enter an absolute launch-folder path/);
  h.ui.render(h.root,{...h.props,agent:'claude'});assert.ok(h.find('Run baseline check'));assert.match(h.text(),/Starts real Claude Code/);assert.ok(h.find('Read a local session'));
});
test('automatic run comparison reports independent input and response findings',()=>{
  const h=harness();h.props.state.verificationRuns=[runRecord({check:{status:'failed',description:'Expected text absent.'},comparison:{comparable:true,reductionTokens:50,issues:[]}})];h.render();
  assert.match(h.text(),/50 fewer input tokens observed/);assert.match(h.text(),/Response text check: failed/);assert.match(h.text(),/Neither proves that every instruction was followed/);
});
test('automatic comparable runs render paired observed values on reported capacity',()=>{
  const h=harness();h.props.state.verificationRuns=[runRecord({comparison:{comparable:true,reductionTokens:50,reductionPercentagePoints:5,before:reading('before',100),after:reading('after',50),issues:[]}})];h.render();
  assert.equal(h.root.all().filter(node=>node.className==='first-use-meter').length,2);assert.match(h.text(),/5.00 percentage points lower/);assert.match(h.text(),/Before.*100 input tokens.*After.*50 input tokens/);
});

test('support matrix distinguishes live, fixture-only, percentage and unavailable adapters',()=>{
 const h=harness();h.props.state.agents=[{id:'codex',name:'Codex',installed:true},{id:'pi',name:'Pi',installed:false},{id:'kiro',name:'Kiro',installed:true},{id:'orca',name:'Orca',installed:true}];h.props.state.agentSupport={codex:{loading:'predicted',verification:'automatic',validation:'live-tested'},pi:{loading:'unverified',verification:'automatic',validation:'adapter-tested'},kiro:{loading:'unverified',verification:'automatic',measurement:'context-percentage'},orca:{loading:'unverified',verification:'unavailable'}};h.render();assert.match(h.text(),/Automatic · live tested on macOS/);assert.match(h.text(),/Automatic · adapter tested/);assert.match(h.text(),/After-response % · no token comparison/);assert.match(h.text(),/Not available yet/);
 h.ui.render(h.root,{...h.props,agent:'pi',loading:{agent:'pi',repo:'/project',groups:[]}});assert.equal(h.find('Run baseline check').disabled,true);assert.match(h.text(),/Install Pi/);assert.match(h.text(),/loading order has not been verified/);assert.equal(h.find('Read an existing local session instead'),undefined);
});
test('Kiro reading shows a labeled percentage and never zero input tokens or a startup saving',()=>{
 const h=harness();h.props.agent='kiro';h.props.state.agentSupport={kiro:{verification:'automatic',measurement:'context-percentage'}};h.props.state.contextEvidence=[{...reading('kiro-reading',null),agent:'kiro',capacity:null,contextPercentage:2.5,method:'kiro-reported-context-percentage'}];h.props.state.verificationRuns=[{...runRecord(),agent:'kiro',measurementId:'kiro-reading'}];h.render();assert.match(h.text(),/2.50% context after response/);assert.doesNotMatch(h.text(),/0 input tokens|Observed first request/);assert.match(h.text(),/cannot verify a startup saving/);assert.equal(h.find('Compare readings'),undefined);
});
