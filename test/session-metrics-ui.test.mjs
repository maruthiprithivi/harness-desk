import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const slice=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const picker=slice('function sessionFilesScopeText(','function showFileView(');
const action=slice('async function action(','function scopedItems(');
const improvementAction=slice('async function improvementAction(','async function saveImprovement(');
const handlers=slice("$('session-files-open').addEventListener", "$('usage-import-form').addEventListener");
const runHandler=slice("$('improvement-run').addEventListener('submit'", "$('improvement-start-after').addEventListener('click'");
const tick=()=>new Promise(setImmediate);
const file=(index=0,extra={})=>({path:'/synthetic/sessions/session-'+index+'.jsonl',label:'session-'+index+'.jsonl',bytes:100,modifiedAt:'2026-10-12T10:00:00Z',importable:true,...extra});
const record=()=>({id:'test-a',agent:'claude',repo:'/synthetic/repo-a',status:'baseline',tasks:[{id:'task-a',label:'Representative task'},{id:'task-b',label:'Second task'}]});
const preview=body=>({id:body.id,taskId:body.taskId,phase:body.phase,agent:'claude',repo:'/synthetic/repo-a',totalTokens:123,counter:'Selected parent-session report',method:'Reported response counters',applicable:true,coverage:{records:6,responses:2,partial:false,issues:[]},interpretation:'Reported counters only'});

function harness({api=async(path,body)=>path==='/api/session-files'?{...body,files:[file(),file(1)],coverage:{partial:false},rootStatus:'available'}:preview(body)}={}){
  const nodes=new Map(),calls=[],refreshes=[];
  const descendants=item=>[item,...item.children.flatMap(descendants)];
  const element=(tag='div',className='',text='')=>({tag,className,textContent:text,children:[],dataset:{},value:'',disabled:false,hidden:true,open:false,checked:false,listeners:{},append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},addEventListener(type,fn){this.listeners[type]=fn;},querySelectorAll(tag){return descendants(this).filter(item=>item.tag===tag);},showModal(){this.open=true;},close(){this.open=false;},set innerHTML(value){throw new Error('Text-only rendering required');}});
  const node=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
  const context=vm.createContext({$:node,element,crypto:webcrypto,array:value=>Array.isArray(value)?value:[],number:String,bytes:value=>value+' B',date:String,time:()=>'',repoName:String,agentName:String,empty:(title,description)=>element('div','empty',title+' '+description),activeRepo:'/synthetic/dashboard-other',selectedAgent:'codex',state:{improvements:[record()]},improvementId:'test-a',improvementRunId:'run-a',improvementCorrection:null,improvementDraft:'',improvementBusy:false,improvementMetrics:{startupTokens:'Startup',totalTokens:'Total'},sessionFilesScope:null,sessionFilesBusy:'',sessionFilesSequence:0,sessionFileChoices:[],sessionFileSelection:new Set(),
    improvementRecord(){return context.state.improvements.find(item=>item.id===context.improvementId);},renderImprovementProgress(){},clearError(){},showError(error){throw error;},updateChatAvailability(){},
    api:async(path,body)=>{calls.push({path,body});return api(path,body);},refreshLoading:async()=>refreshes.push('loading'),refresh:async()=>refreshes.push('state'),
    saveImprovement:async body=>{calls.push({path:'/api/improvement',body});return context.state.improvements[0];},improvementRunDraft:()=>'',toast(){},
  });
  node('improvement-dialog').open=true;node('improvement-run-task').value='task-a';node('improvement-totalTokens').value='999';node('improvement-counter').value='Prior counter';node('improvement-startupTokens').value='25';node('improvement-passed').value='false';node('improvement-model').value='Known model';node('improvement-run-note').value='Keep this quality note';node('usage-import-agent').value='codex';node('usage-import-days').value='7';
  vm.runInContext(action+improvementAction+picker+handlers+runHandler,context);
  const run=expression=>vm.runInContext(expression,context);
  const text=item=>[item.textContent,...item.children.map(text)].join(' ');
  const checks=()=>node('session-files-list').querySelectorAll('input');
  const select=index=>{const input=checks()[index];input.checked=true;input.listeners.change();};
  const open=async()=>{node('improvement-session-open').listeners.click();await tick();};
  const submit=()=>run('importSessionFiles()');
  const confirm=()=>{node('session-metrics-confirm').checked=true;node('session-metrics-confirm').listeners.change();};
  const use=()=>node('session-metrics-use').listeners.click();
  return {context,node,calls,refreshes,run,text,checks,select,open,submit,confirm,use,descendants};
}

test('explicit saved-test preview discovers metadata with a fixed scope and no automatic selection or draft change',async()=>{
  const h=harness();assert.equal(h.calls.length,0);await h.open();assert.equal(h.calls.length,1);assert.equal(h.calls[0].path,'/api/session-files');assert.equal(h.calls[0].body.agent,'claude');assert.equal(h.calls[0].body.repo,'/synthetic/repo-a');
  assert.equal(h.checks().every(item=>item.type==='radio'&&!item.checked),true);assert.match(h.node('session-files-scope').textContent,/Representative task.*before run/);assert.doesNotMatch(h.node('session-files-scope').textContent,/dashboard-other|Last 7/);assert.equal(h.node('improvement-totalTokens').value,'999');assert.equal(h.node('improvement-counter').value,'Prior counter');assert.equal(h.node('session-metrics-preview').hidden,true);
  assert.match(html,/id="improvement-session-open"[^>]*type="button"/);assert.match(html,/Task tokens from your counter/);assert.match(html,/exclude separate subagents and unreported requests/);assert.match(html,/not full context, startup tokens or cost/);
});

test('successful preview stays unsaved and explicit confirmation replaces only task tokens and counter',async()=>{
  const h=harness();await h.open();h.select(0);h.context.activeRepo='/synthetic/new-dashboard';h.context.selectedAgent='codex';await h.submit();
  const request=h.calls[1];assert.equal(request.path,'/api/improvement-session-preview');assert.deepEqual(JSON.parse(JSON.stringify(request.body)),{id:'test-a',taskId:'task-a',phase:'before',path:file().path});
  assert.equal(h.node('improvement-totalTokens').value,'999');assert.equal(h.node('improvement-counter').value,'Prior counter');assert.equal(h.node('session-metrics-use').disabled,true);assert.match(h.text(h.node('session-metrics-result')),/123.*Selected parent-session report.*Reported response counters.*Reported counters only.*6 records.*2 responses/);assert.doesNotMatch(h.text(h.node('session-metrics-result')),/session-0\.jsonl|new-dashboard/);
  h.use();assert.equal(h.node('improvement-totalTokens').value,'999');h.confirm();assert.equal(h.node('session-metrics-use').disabled,false);h.use();
  assert.equal(h.node('improvement-totalTokens').value,'123');assert.equal(h.node('improvement-counter').value,'Selected parent-session report');for(const [key,value]of [['startupTokens','25'],['passed','false'],['model','Known model'],['run-note','Keep this quality note']])assert.equal(h.node('improvement-'+key).value,value);
  assert.equal(h.calls.length,2);assert.deepEqual(h.refreshes,[]);assert.equal(h.node('session-files-dialog').open,false);assert.match(h.node('improvement-session-status').textContent,/No run was saved/);
});

test('single-file selection replaces the prior radio and changing it invalidates preview and confirmation',async()=>{
  const h=harness();await h.open();h.select(0);await h.submit();h.confirm();h.select(1);assert.equal(h.checks()[0].checked,false);assert.equal(h.context.sessionFileSelection.size,1);assert.equal(h.context.sessionFileSelection.has(file(1).path),true);assert.equal(h.node('session-metrics-preview').hidden,true);assert.equal(h.node('session-metrics-confirm').checked,false);h.use();assert.equal(h.node('improvement-totalTokens').value,'999');
  await h.submit();assert.equal(h.calls[2].body.path,file(1).path);assert.equal(h.node('session-metrics-use').disabled,true);
});

for(const changed of ['task','phase','test','repo','agent','closed','dialog'])test(`a changed ${changed} cannot apply a previously previewed counter`,async()=>{
  const h=harness();await h.open();h.select(0);await h.submit();h.confirm();const rec=h.context.state.improvements[0];
  if(changed==='task')h.node('improvement-run-task').value='task-b';if(changed==='phase')rec.status='candidate';if(changed==='test')h.context.improvementId='another-test';if(changed==='repo')rec.repo='/synthetic/other';if(changed==='agent')rec.agent='codex';if(changed==='closed')rec.status='closed';if(changed==='dialog')h.node('improvement-dialog').open=false;
  h.use();assert.equal(h.node('improvement-totalTokens').value,'999');assert.equal(h.node('improvement-counter').value,'Prior counter');assert.equal(h.node('session-metrics-use').disabled,true);assert.equal(h.calls.length,2);
});

for(const extra of [{totalTokens:null},{totalTokens:2.5},{totalTokens:-1},{applicable:false},{counter:''},{counter:'x'.repeat(161)},{totalTokens:1e9+1},{totalTokens:Number.MAX_SAFE_INTEGER+1}])test(`unusable reported counters remain visible without applying: ${JSON.stringify(extra)}`,async()=>{
  const h=harness({api:async(path,body)=>path==='/api/session-files'?{...body,files:[file()]}:{...preview(body),...extra}});await h.open();h.select(0);await h.submit();h.confirm();h.use();assert.equal(h.node('session-metrics-preview').hidden,false);assert.equal(h.node('session-metrics-use').disabled,true);assert.equal(h.node('improvement-totalTokens').value,'999');assert.match(h.text(h.node('session-metrics-result')),/cannot fill the draft/);
});

test('preview errors preserve the radio and every run draft field and never render raw errors',async()=>{
  let fail=true;const h=harness({api:async(path,body)=>{if(path==='/api/session-files')return{...body,files:[file()]};if(fail)throw new Error('PRIVATE LOG BODY /private/source');return preview(body);}});await h.open();h.select(0);await h.submit();assert.match(h.node('session-files-error').textContent,/selection and run draft are still here/);assert.doesNotMatch(h.node('session-files-error').textContent,/PRIVATE|private\/source/);assert.equal(h.checks()[0].checked,true);assert.equal(h.node('improvement-run-note').value,'Keep this quality note');assert.equal(h.node('improvement-totalTokens').value,'999');assert.equal(h.node('session-files-dialog').open,true);
  fail=false;await h.submit();assert.equal(h.node('session-metrics-preview').hidden,false);assert.equal(h.node('session-metrics-confirm').checked,false);
});

test('pending preview blocks close, repeat requests, reselection and applying even a manually checked confirmation',async()=>{
  let finish;const h=harness({api:async(path,body)=>path==='/api/session-files'?{...body,files:[file(),file(1)]}:new Promise(resolve=>{finish=()=>resolve(preview(body));})});await h.open();h.select(0);const pending=h.submit();assert.equal(h.node('session-files-close').disabled,true);assert.equal(h.node('session-metrics-confirm').disabled,true);assert.equal(h.node('session-metrics-use').disabled,true);assert.equal(h.checks().every(item=>item.disabled),true);
  h.run('closeSessionFiles(); findSessionFiles()');h.select(1);h.confirm();h.use();await h.submit();assert.equal(h.calls.length,2);assert.equal(h.context.sessionFileSelection.has(file().path),true);assert.equal(h.node('improvement-totalTokens').value,'999');finish();await pending;assert.equal(h.node('session-files-dialog').open,true);assert.equal(h.node('session-files-close').disabled,false);
});

test('retry resets preview without clearing selection; closing and purpose changes clear token state and preserve usage and mining behavior',async()=>{
  const h=harness();await h.open();h.select(0);await h.submit();h.confirm();await h.run('findSessionFiles()');assert.equal(h.node('session-metrics-preview').hidden,true);assert.equal(h.checks()[0].checked,true);assert.equal(h.node('session-metrics-confirm').checked,false);
  h.run('closeSessionFiles(); openSessionFiles()');await tick();assert.equal(h.node('session-files-title').textContent,'Choose recent local sessions');assert.equal(h.checks().every(item=>item.type==='checkbox'&&!item.checked),true);h.select(0);await h.submit();assert.equal(h.calls.at(-1).path,'/api/usage-import');assert.equal('id'in h.calls.at(-1).body,false);assert.equal(h.node('improvement-totalTokens').value,'999');
  h.node('mining-agent').value='claude';h.run("openSessionFiles('mine')");await tick();h.select(0);await h.submit();assert.equal(h.calls.at(-1).path,'/api/mine');assert.deepEqual(Object.keys(h.calls.at(-1).body),['paths']);assert.equal(h.node('improvement-totalTokens').value,'999');
});

test('zero tokens are valid and partial coverage is text only with no response bodies or session paths',async()=>{
  const h=harness({api:async(path,body)=>path==='/api/session-files'?{...body,files:[file()]}:{...preview(body),totalTokens:0,method:'<img src=x>',coverage:{records:2,responses:1,partial:true,issues:['Some reports are unavailable.']},rawBody:'SECRET CONTENT',path:'/private/transcript'}});await h.open();h.select(0);await h.submit();const result=h.node('session-metrics-result');assert.match(h.text(result),/Task tokens: 0.*<img src=x>.*Partial report.*Some reports are unavailable/);assert.doesNotMatch(h.text(result),/SECRET CONTENT|private\/transcript/);assert.equal(h.descendants(result).some(item=>item.tag==='img'),false);h.confirm();h.use();assert.equal(h.node('improvement-totalTokens').value,'0');
});

test('invalid single-file selections cannot issue previews and unsupported or unavailable saved tests cannot discover sessions',async()=>{
  const h=harness();await h.open();await h.submit();assert.equal(h.calls.length,1);assert.match(h.node('session-files-error').textContent,/Choose one available/);h.context.sessionFileSelection.add(file().path);h.context.sessionFileSelection.add(file(1).path);await h.submit();assert.equal(h.calls.length,1);
  for(const kind of ['unsaved','unsupported','closed']){const other=harness();if(kind==='unsaved')other.context.improvementId=null;if(kind==='unsupported')other.context.state.improvements[0].agent='other';if(kind==='closed')other.context.state.improvements[0].status='closed';await other.open();assert.equal(other.calls.length,0);assert.equal(other.node('session-files-dialog').open,false);}
});

test('a correction in the current phase can preview without changing correction or other draft metadata, and pending saves freeze its opener',async()=>{
  const h=harness();h.context.improvementCorrection='original-run';await h.open();h.select(0);await h.submit();h.confirm();h.use();assert.equal(h.context.improvementCorrection,'original-run');assert.equal(h.node('improvement-passed').value,'false');
  let finish;const pending=h.context.improvementAction(h.node('improvement-run-save'),()=>new Promise(resolve=>{finish=resolve;}));assert.equal(h.node('improvement-session-open').disabled,true);await h.open();assert.equal(h.calls.length,2);finish();await pending;assert.equal(h.node('improvement-session-open').disabled,false);
});


test('Codex candidate previews bind the after phase and a polling render preserves confirmation and unsaved fields',async()=>{
  const h=harness({api:async(path,body)=>path==='/api/session-files'?{...body,files:[file()]}:{...preview(body),agent:'codex'}});h.context.state.improvements[0].agent='codex';h.context.state.improvements[0].status='candidate';await h.open();h.select(0);await h.submit();assert.equal(h.calls[0].body.agent,'codex');assert.equal(h.calls[1].body.phase,'after');h.confirm();
  h.context.activeRepo='/synthetic/polled-repo';h.context.selectedAgent='claude';h.run('renderSessionTokenPreview()');assert.equal(h.node('session-metrics-confirm').checked,true);assert.equal(h.node('session-metrics-use').disabled,false);assert.match(h.text(h.node('session-metrics-result')),/codex.*repo-a.*after run/);assert.equal(h.node('improvement-run-note').value,'Keep this quality note');h.use();assert.equal(h.node('improvement-totalTokens').value,'123');
});

test('a mismatched API preview identity cannot be used and keeps the chosen file and draft recoverable',async()=>{
  const h=harness({api:async(path,body)=>path==='/api/session-files'?{...body,files:[file()]}:{...preview(body),taskId:'different-task',rawBody:'PRIVATE BODY'}});await h.open();h.select(0);await h.submit();assert.match(h.node('session-files-error').textContent,/did not match this fixed test draft/);assert.equal(h.node('session-metrics-preview').hidden,true);assert.equal(h.checks()[0].checked,true);h.confirm();h.use();assert.equal(h.node('improvement-totalTokens').value,'999');assert.doesNotMatch(h.text(h.node('session-files-dialog')),/PRIVATE BODY/);
});


test('counter interpretation is bounded and rendered as text alongside the method and coverage',async()=>{
  const interpretation='<svg> Cached input is included in this counter. '+ 'x'.repeat(1000);
  const h=harness({api:async(path,body)=>path==='/api/session-files'?{...body,files:[file()]}:{...preview(body),interpretation}});await h.open();h.select(0);await h.submit();const result=h.node('session-metrics-result'),explanation=result.children.find(item=>String(item.textContent).startsWith('<svg>'));
  assert.equal(explanation.textContent.length,600);assert.match(h.text(result),/Cached input is included in this counter/);assert.equal(h.descendants(result).some(item=>item.tag==='svg'),false);
});


for(const changed of ['phase','task'])test(`an applied preview remains bound at run Save when the ${changed} changes`,async()=>{
  const h=harness();await h.open();h.select(0);await h.submit();h.confirm();h.use();const binding=h.node('improvement-totalTokens').sessionCounterScope;
  if(changed==='phase')h.context.state.improvements[0].status='candidate';else h.node('improvement-run-task').value='task-b';
  h.node('improvement-run').listeners.submit({preventDefault(){},submitter:h.node('improvement-run-save')});await tick();assert.equal(h.calls.length,2);assert.match(h.node('improvement-error').textContent,/earlier test, task or phase/);assert.equal(h.node('improvement-totalTokens').value,'123');assert.equal(h.node('improvement-counter').value,'Selected parent-session report');assert.equal(h.node('improvement-totalTokens').sessionCounterScope,binding);assert.equal(h.node('improvement-run-note').value,'Keep this quality note');
});

for(const manual of ['tokens','counter'])test(`manual ${manual} replacement releases preview binding and a run saves its current phase explicitly`,async()=>{
  const h=harness();await h.open();h.select(0);await h.submit();h.confirm();h.use();h.context.state.improvements[0].status='candidate';
  const input=h.node(manual==='tokens'?'improvement-totalTokens':'improvement-counter');input.value=manual==='tokens'?'456':'Manual after counter';input.listeners.input();assert.equal(h.node('improvement-totalTokens').sessionCounterScope,null);
  h.node('improvement-run').listeners.submit({preventDefault(){},submitter:h.node('improvement-run-save')});await tick();assert.equal(h.calls[2].path,'/api/improvement');assert.equal(h.calls[2].body.phase,'after');assert.equal(h.calls[2].body.taskId,'task-a');assert.equal(h.calls[2].body.totalTokens,manual==='tokens'?456:123);assert.equal(h.node('improvement-totalTokens').sessionCounterScope,null);
});

test('normal confirmed preview saves a before phase but leaves save failures recoverable with their binding',async()=>{
  const h=harness();await h.open();h.select(0);await h.submit();h.confirm();h.use();let fail=true;h.context.saveImprovement=async body=>{h.calls.push({path:'/api/improvement',body});if(fail)throw new Error('Save failed');return h.context.state.improvements[0];};
  h.node('improvement-run').listeners.submit({preventDefault(){},submitter:h.node('improvement-run-save')});await tick();assert.equal(h.calls[2].body.phase,'before');assert.equal(h.node('improvement-totalTokens').value,'123');assert.equal(h.node('improvement-totalTokens').sessionCounterScope.phase,'before');assert.equal(h.node('improvement-run-note').value,'Keep this quality note');
  fail=false;h.node('improvement-run').listeners.submit({preventDefault(){},submitter:h.node('improvement-run-save')});await tick();assert.equal(h.calls[3].body.phase,'before');assert.equal(h.node('improvement-totalTokens').sessionCounterScope,null);
});
