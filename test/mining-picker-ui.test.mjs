import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const slice=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const picker=slice('function sessionFilesScopeText(','function showFileView(');
const action=slice('async function action(','function scopedItems(');
const handlers=slice("$('session-files-open').addEventListener", "$('usage-import-form').addEventListener");
const repo='/synthetic/repo-a';
const file=(index=0,extra={})=>({path:'/synthetic/sessions/session-'+index+'.jsonl',label:'session-'+index+'.jsonl',bytes:100,modifiedAt:new Date(Date.UTC(2026,9,1,index)).toISOString(),importable:true,...extra});
const response=(body,files=[file()],extra={})=>({...body,files,rootStatus:'available',coverage:{partial:false,visited:1,filesFound:files.length},...extra});
const tick=()=>new Promise(setImmediate);

function harness({api=async(path,body)=>path==='/api/session-files'?response(body):{}}={}){
  const nodes=new Map(),calls=[],refreshes=[],analyses=[];
  const descendants=item=>[item,...item.children.flatMap(descendants)];
  const element=(tag='div',className='',text='')=>({tag,className,textContent:text,children:[],dataset:{},value:'',disabled:false,hidden:true,open:false,listeners:{},
    append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},addEventListener(type,fn){this.listeners[type]=fn;},
    querySelectorAll(tag){return descendants(this).filter(item=>item.tag===tag);},showModal(){this.open=true;},close(){this.open=false;},
    set innerHTML(value){throw new Error('Session metadata must remain text');},
  });
  const node=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
  const context=vm.createContext({$:node,element,array:value=>Array.isArray(value)?value:[],number:String,bytes:value=>value+' B',date:String,time:()=>'',repoName:String,agentName:String,
    empty:(title,description)=>element('div','empty',title+' '+description),activeRepo:repo,selectedAgent:'claude',sessionFilesScope:null,sessionFilesBusy:'',sessionFilesSequence:0,sessionFileChoices:[],sessionFileSelection:new Set(),
    clearError(){},showError(error){throw error;},updateChatAvailability(){},
    api:async(path,body)=>{calls.push({path,body});return api(path,body,calls.length);},refresh:async()=>{analyses.push({repo:context.activeRepo,agent:context.selectedAgent});},refreshLoading:async force=>{refreshes.push({force,repo:context.activeRepo,agent:context.selectedAgent});},
  });
  node('mining-agent').value='claude';node('mine-paths').value='';node('usage-import-agent').value='claude';node('usage-import-days').value='7';
  vm.runInContext(action+picker+handlers,context);
  const run=expression=>vm.runInContext(expression,context);
  const text=item=>[item.textContent,...item.children.map(text)].join(' ');
  const checks=()=>node('session-files-list').querySelectorAll('input');
  const select=(index,checked=true)=>{const check=checks()[index];check.checked=checked;check.listeners.change();};
  const open=async(purpose='mine')=>{node(purpose==='mine'?'mining-session-files-open':'session-files-open').listeners.click({type:'click'});await tick();};
  return{context,node,calls,refreshes,analyses,run,text,checks,select,open,descendants};
}

test('mining starts with metadata only, safe unselected choices and an explicit Analyze action',async()=>{
  const h=harness({api:async(path,body)=>response(body,[file(0,{label:'<img src=x onerror=alert(1)>'}),file(1,{bytes:2*1048576+1})])});
  assert.equal(h.calls.length,0);await h.open();
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].path,'/api/session-files');assert.deepEqual(Object.keys(h.calls[0].body).sort(),['agent','repo']);
  assert.equal(h.checks().every(check=>!check.checked),true);assert.equal(h.checks()[0].disabled,true);assert.match(h.text(h.node('session-files-list')),/<img src=x onerror=alert\(1\)>/);
  assert.equal(h.descendants(h.node('session-files-list')).some(item=>item.tag==='img'),false);
  assert.equal(h.node('session-files-import').textContent,'Analyze selected sessions');assert.match(h.node('session-files-title').textContent,/analysis/);
  assert.match(h.node('session-files-notice').textContent,/metadata only.*Modification dates are not activity dates.*unknown until analysis/);
  assert.match(h.node('session-files-action-note').textContent,/Only Analyze reads prompts and tool commands locally/);
  assert.match(h.node('session-files-action-note').textContent,/all dates and all repositories.*replaces previous findings.*Analysis makes no LLM request.*bounded excerpts.*Known secret patterns are redacted.*may retain confidential text/);
  await h.run('importSessionFiles()');assert.equal(h.calls.length,1);
});

test('analysis sends only selected paths and reports the original working scope across dashboard changes',async()=>{
  const h=harness();h.node('mining-agent').value='codex';h.node('usage-import-days').value='unsupported';await h.open();h.select(0);
  h.context.activeRepo='/synthetic/repo-b';h.context.selectedAgent='claude';h.node('mining-agent').value='claude';
  await h.run('importSessionFiles()');assert.equal(h.calls[1].path,'/api/mine');assert.deepEqual(Object.keys(h.calls[1].body),['paths']);assert.deepEqual([...h.calls[1].body.paths],[file().path]);
  assert.equal(h.refreshes.length,0);assert.deepEqual(h.analyses,[{repo:'/synthetic/repo-b',agent:'claude'}]);assert.equal(h.node('session-files-dialog').open,false);
  assert.match(h.node('mining-status').textContent,/codex.*repo-a.*All dates and all repositories/);assert.match(h.node('mining-status').textContent,/Previous findings were replaced.*cards follow the dashboard scope.*dashboard selection now differs/);
  assert.equal(h.node('mine-paths').value,'');assert.equal(h.node('usage-import-status').textContent,'');
});

test('failed analysis retains selections and retries without exposing backend errors',async()=>{
  let attempts=0;const h=harness({api:async(path,body)=>{if(path==='/api/mine' && ++attempts===1)throw new Error('PRIVATE TRANSCRIPT BODY');return path==='/api/session-files'?response(body):{};}});
  await h.open();h.select(0);await h.run('importSessionFiles()');
  assert.equal(h.node('session-files-dialog').open,true);assert.equal(h.checks()[0].checked,true);assert.equal(h.checks()[0].disabled,false);assert.match(h.node('session-files-error').textContent,/Could not analyze.*selection is still here/);assert.doesNotMatch(h.node('session-files-error').textContent,/PRIVATE/);
  await h.run('importSessionFiles()');assert.equal(attempts,2);assert.equal(h.analyses.length,1);assert.equal(h.node('session-files-dialog').open,false);
});

test('pending analysis blocks duplicate requests, cancellation, purpose changes and reselection',async()=>{
  let release;const h=harness({api:async(path,body)=>path==='/api/session-files'?response(body):new Promise(resolve=>{release=resolve;})});await h.open();h.select(0);const pending=h.run('importSessionFiles()');
  h.run("closeSessionFiles(); openSessionFiles(); openSessionFiles('mine')");h.select(0,false);await h.run('importSessionFiles(); findSessionFiles()');
  assert.equal(h.calls.length,2);assert.equal(h.calls[1].path,'/api/mine');assert.equal(h.node('session-files-dialog').open,true);assert.equal(h.node('session-files-close').disabled,true);assert.equal(h.node('session-files-cancel').disabled,true);assert.equal(h.context.sessionFileSelection.has(file().path),true);
  release({});await pending;assert.equal(h.node('session-files-dialog').open,false);
});

test('usage mode resets labels, notes and endpoint after successful or cancelled mining',async()=>{
  for(const successful of [false,true]){
    const h=harness();await h.open();h.select(0);if(successful)await h.run('importSessionFiles()');else h.run('closeSessionFiles()');
    await h.open('usage');assert.equal(h.node('session-files-title').textContent,'Choose recent local sessions');assert.equal(h.node('session-files-import').textContent,'Import selected sessions');assert.equal(h.checks()[0].checked,false);
    assert.match(h.node('session-files-scope').textContent,/Fixed import scope.*Last 7 days/);assert.doesNotMatch(h.node('session-files-action-note').textContent,/prompts|previous findings/);assert.match(h.node('session-files-action-note').textContent,/Nothing is imported.*press Import/);
    h.select(0);await h.run('importSessionFiles()');const imported=h.calls.at(-1);assert.equal(imported.path,'/api/usage-import');assert.deepEqual(Object.keys(imported.body).sort(),['agent','days','paths','repo']);assert.equal(imported.body.days,7);assert.equal(h.refreshes.length,1);
  }
});

test('mining enforces available files, count and byte limits before any transcript analysis',async()=>{
  const count=harness({api:async(path,body)=>response(body,Array.from({length:30},(_,index)=>file(index)))});await count.open();for(let i=0;i<21;i++)count.select(i);await count.run('importSessionFiles()');assert.equal(count.calls.length,1);assert.match(count.node('session-files-error').textContent,/1–20/);
  const size=harness({api:async(path,body)=>response(body,Array.from({length:5},(_,index)=>file(index,{bytes:2*1048576})))});await size.open();for(let i=0;i<5;i++)size.select(i);await size.run('importSessionFiles()');assert.equal(size.calls.length,1);size.select(4,false);await size.run('importSessionFiles()');assert.equal(size.calls.at(-1).path,'/api/mine');
  const unavailable=harness({api:async(path,body)=>response(body,[file(0,{importable:false}),file(1,{bytes:2*1048576+1})])});await unavailable.open();unavailable.select(0);unavailable.select(1);unavailable.context.sessionFileSelection.add('/synthetic/not-found.jsonl');await unavailable.run('importSessionFiles()');assert.equal(unavailable.calls.length,1);
});

test('cancelled mining discovery cannot overwrite a reopened usage chooser',async()=>{
  const releases=[];const h=harness({api:async(path,body)=>new Promise(resolve=>releases.push(()=>resolve(response(body,[file(releases.length)]))))});
  await h.open();h.run('closeSessionFiles()');h.context.activeRepo='/synthetic/repo-b';h.node('usage-import-agent').value='codex';await h.open('usage');
  releases[0]();await tick();assert.equal(h.checks().length,0);assert.equal(h.context.sessionFilesBusy,'finding');assert.equal(h.node('session-files-import').textContent,'Import selected sessions');
  releases[1]();await tick();assert.equal(h.checks().length,1);assert.match(h.node('session-files-scope').textContent,/codex.*repo-b.*Last 7 days/);assert.doesNotMatch(h.node('session-files-scope').textContent,/Original working scope/);
});

test('unsupported agents and unavailable discovery retain manual absolute-file fallback',async()=>{
  const invalid=harness();invalid.node('mining-agent').value='other';await invalid.open();assert.equal(invalid.calls.length,0);assert.match(invalid.node('mining-status').textContent,/absolute transcript file paths manually/);
  const failure=harness({api:async()=>{throw new Error('PRIVATE PATH');}});await failure.open();assert.match(failure.node('session-files-error').textContent,/choose files manually/);assert.doesNotMatch(failure.node('session-files-error').textContent,/PRIVATE/);
  const miningPanel=html.slice(html.indexOf('<h2>Find work you keep repeating'),html.indexOf('<h2>Bring in an existing audit'));
  assert.match(miningPanel,/<details><summary>Advanced: enter absolute transcript file paths<\/summary>/);assert.doesNotMatch(miningPanel,/files or directories|<details[^>]*open/);assert.match(miningPanel,/Known secret patterns are redacted, but excerpts may retain confidential text.*Review them before sharing with an agent/);
});

test('persisted analysis coverage is shown safely and global mistake cards exclude other and unknown scopes',()=>{
  const h=harness();Object.assign(h.context,{state:{mining:{at:'2026-10-12T00:00:00Z',files:2,coverage:{supportedRecords:8,unattributedRecords:3},warnings:['<img src=x> Unknown working scope.']},mistakes:[{repo:'',category:'Global signal',examples:['Synthetic excerpt']},{repo:null,category:'Unknown signal'},{repo:'/synthetic/repo-b',category:'Other signal'}]},activeRepo:'',scopedCandidates:()=>[],badge:()=>h.context.element('span'),button:()=>h.context.element('button'),panel:(title,description,body)=>{const el=h.context.element('section');el.classList={add(){}};el.append(h.context.element('h2','',title),body);return el;},renderReusableList(){},renderImportedAudit(){}});
  vm.runInContext(slice('function renderPatterns()','function reusableFields('),h.context);
  h.run('renderPatterns()');const summary=h.text(h.node('mining-summary'));assert.match(summary,/2 files.*8 supported records.*3 records without a working scope/);assert.match(summary,/<img src=x> Unknown working scope/);assert.equal(h.descendants(h.node('mining-summary')).some(item=>item.tag==='img'),false);
  const patterns=h.text(h.node('pattern-content'));assert.match(patterns,/Global signal/);assert.match(patterns,/Redacted excerpts.*Review for confidential text before sharing/);assert.doesNotMatch(patterns,/Unknown signal|Other signal|Sanitized examples/);
  h.context.state.mistakes.push({category:'Legacy unattributed signal'});h.run('renderPatterns()');assert.doesNotMatch(h.text(h.node('pattern-content')),/Legacy unattributed signal/);
  h.context.state.mining.coverage={analyzedFiles:1,supportedRecords:4,partial:true,unreadableFiles:1,duplicatePaths:2,duplicateContents:1,issues:['Some files could not be read.']};h.run('renderPatterns()');
  const partial=h.text(h.node('mining-summary'));assert.match(partial,/1 analyzed of 2 selected files.*4 supported records.*Partial coverage.*1 unreadable files.*2 duplicate paths.*1 duplicate contents/);assert.match(partial,/Some files could not be read/);assert.doesNotMatch(partial,/undefined|0 records without/);
  h.context.state.mining.coverage=null;h.run('renderPatterns()');const legacy=h.text(h.node('mining-summary'));assert.match(legacy,/event counts unavailable for this earlier analysis/);assert.doesNotMatch(legacy,/0 supported records|undefined/);
  h.context.state.mining=null;h.run('renderPatterns()');assert.equal(h.node('mining-summary').children.length,0);
});

test('state refresh renders coverage changes with unchanged empty findings and skips identical snapshots',()=>{
  const h=harness();const noop=()=>{};
  Object.assign(h.context,{loading:null,state:{settings:{budgets:{}},inventory:{items:[]},candidates:[],mistakes:[],mining:null},activeRepo:'',selectedIds:new Set(),renderSnapshots:new Map(),initialRender:false,activeChat:null,reusableScope:null,improvementId:null,
    scopedCandidates:()=>[],renderImportedAudit:noop,renderReusableList:noop,panel:(title,description,body)=>{const el=h.context.element('section');el.classList={add(){}};el.append(body);return el;}});
  for(const name of ['updateControls','renderDashboard','renderInventory','renderContextBreakdowns','renderContext','renderGaps','renderAgents','renderJournal','renderStorage','renderHistory','renderImprovements','renderConversation','updateStartGuide'])h.context[name]=noop;
  vm.runInContext(slice('function hasChanged(','function effectiveBudget(')+slice('function renderPatterns()','function reusableFields(')+slice('function renderState()','async function refresh()'),h.context);
  h.run('renderState()');assert.equal(h.node('mining-summary').children.length,0);
  h.context.state.mining={at:'2026-10-12T00:00:00Z',files:1,coverage:{supportedRecords:4,unattributedRecords:0},warnings:[]};h.run('renderState()');
  assert.match(h.text(h.node('mining-summary')),/4 supported records/);const first=h.node('mining-summary').children[0];h.run('renderState()');assert.equal(h.node('mining-summary').children[0],first);
  h.context.state.mining.coverage.supportedRecords=8;h.run('renderState()');assert.match(h.text(h.node('mining-summary')),/8 supported records/);assert.notEqual(h.node('mining-summary').children[0],first);
  h.context.state.mining=null;h.run('renderState()');assert.equal(h.node('mining-summary').children.length,0);assert.equal(h.context.state.candidates.length,0);
});
