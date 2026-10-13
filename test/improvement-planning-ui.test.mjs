import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const slice=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const repo='/synthetic/plan-repository';

function harness({assetIds=['asset-a'],scope=repo,respond,proposal={}}={}){
  const nodes=new Map(),calls=[],routes=[];
  let nextUUID=0;
  const all=item=>[item,...item.children.flatMap(all)];
  const node=id=>{if(!nodes.has(id))nodes.set(id,{tag:'div',value:'',textContent:'',checked:false,hidden:true,disabled:false,open:false,dataset:{},children:[],listeners:{},options:[{value:'claude'},{value:'codex'}],classList:{toggle(){}},
    append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},addEventListener(type,fn){this.listeners[type]=fn;},setAttribute(){},focus(){this.focused=true;},showModal(){this.open=true;},close(){this.open=false;},
    reset(){this.resets=(this.resets||0)+1;for(const key of ['plan-title','change','benefit','rollback','variable'])node('improvement-'+key).value='';},
    querySelector(selector){return all(this).find(item=>item.tag===selector)||node(id+'-option');},querySelectorAll(selector){if(id==='chat-sections')return sections.filter(item=>selector!=='input:checked'||item.checked);return all(this).filter(item=>selector.split(',').includes(item.tag));},remove(){},
    set innerHTML(value){throw new Error('Plan metadata must stay inert');},
  });return nodes.get(id);};
  const sections=['dashboard','inventory','context','improvements','gaps','patterns'].map(value=>({value,checked:false}));
  const context=vm.createContext({$:node,array:value=>Array.isArray(value)?value:[],number:String,date:String,time:()=>'',agentName:String,repoName:String,view:'dashboard',advanced:true,selectedAgent:'claude',activeRepo:scope,
    pendingPlan:null,pendingImprovement:null,pendingGap:null,pendingLoadingScope:null,pendingTaskScope:null,activeChat:null,chatSnapshot:'',contextPreviewRequest:0,beginnerSelection:null,selectedIds:new Set(['unrelated-id']),loading:null,openedFrom:null,improvementId:null,improvementBusy:false,improvementCorrection:null,improvementScope:null,
    state:{csrfToken:'synthetic',settings:{budgets:{}},agents:[{id:'claude',dispatch:'handoff'},{id:'codex',dispatch:'handoff'}],improvements:[],conversations:[],inventory:{scannedAt:'2026-10-12',coverage:{partial:true},items:[{id:'asset-a',name:'Synthetic skill',path:repo+'/skill.md',agent:'claude',repo,type:'skill',bytes:42,modifiedAt:'2026-10-11',contentHash:null,content:'PRIVATE FILE BODY'}]}},
    element:(tag,className='',text='')=>Object.assign(node('element-'+nodes.size),{tag,className,textContent:String(text)}),button:(text,className,fn)=>{const item=Object.assign(node('button-'+nodes.size),{tag:'button',className,textContent:text});item.listeners.click=fn;return item;},badge:(text,tone)=>Object.assign(node('badge-'+nodes.size),{tag:'span',textContent:text}),empty:(title,description)=>Object.assign(node('empty-'+nodes.size),{textContent:title+' '+description}),
    crypto:{randomUUID:()=> '00000000-0000-4000-8000-'+String(++nextUUID).padStart(12,'0')},document:{activeElement:{focus(){}},body:{style:{}}},setTimeout:fn=>fn(),requestAnimationFrame:fn=>fn(),toast(message){context.lastToast=message;},setOptions(){},effectiveRoute(intent,workingRepo){routes.push({intent,repo:workingRepo});return{agent:workingRepo===repo?'claude':'codex',model:'synthetic-model'};},
    includedIds:()=>['unrelated-id'],filteredInventory:()=>[],loadingFiles:()=>[],loadingDirectoryLabel:String,updateChatAvailability(){},renderConversation(){},renderImprovements(){},renderImprovementProgress(){},improvementMetrics:{},improvementRunDraft:()=>({}),schedulePoll(){},refresh:async()=>{},
    api:async(path,body)=>{calls.push({path,body});return respond?respond(path,body):path==='/api/context'?{text:'Synthetic preview',estTokens:1}:{id:'planning-chat',agent:body.agent,repo:body.repo,globalOnly:body.globalOnly,reviewAgent:body.reviewAgent,selectionMode:body.selectionMode,sections:body.sections,selectedIds:body.selectedIds,status:'handoff',intent:body.intent};},tokens:String,
    action(control,run){context.lastAction=(async()=>{if(control.dataset.busy)return;control.dataset.busy='true';try{await run();}finally{delete control.dataset.busy;}})();return context.lastAction;},
  });
  vm.runInContext(slice('function addImprovementTask()','function updateImprovementPrompt()')+slice('function planningChatBusy()','function navigate()')+slice('function chosenSections()','function updateChatAvailability()')+slice('function updateSelection()','function budgetMetric(')+slice('function renderHistory()','function fillSettings()')+slice("$('chat-preview-button').addEventListener","$('chat-cancel').addEventListener")+slice("$('reply-form').addEventListener","$('handoff-copy').addEventListener"),context);
  vm.runInContext(source.split('\n').find(line=>line.startsWith("$('improvement-plan-ask').addEventListener")),context);
  vm.runInContext(slice("$('improvement-suggestion-text').addEventListener", "$('improvement-run').addEventListener('submit'"),context);
  vm.runInContext(slice('async function improvementAction(', 'function askImprovement()'),context);
  vm.runInContext(slice("$('section-chat').addEventListener","$('inventory-chat').addEventListener"),context);
  context.openImprovement(null,{agent:'claude',repo:scope,...proposal},assetIds);
  const run=expression=>vm.runInContext(expression,context),text=item=>[item.textContent,...item.children.map(text)].join(' '),ask=()=>node('improvement-plan-ask').listeners.click(),payload=()=>context.contextPayload(),task=()=>node('improvement-tasks').children[0];
  const snapshot=()=>({scope:context.improvementScope,taskNodes:[...node('improvement-tasks').children],values:['plan-title','change','benefit','rollback','variable'].map(id=>node('improvement-'+id).value),taskValues:node('improvement-tasks').children.map(item=>[item.querySelector('input').value,item.querySelector('textarea').value]),resets:node('improvement-plan').resets});
  return{context,node,calls,routes,run,text,ask,payload,task,snapshot};
}

for(const {entry,view,origin} of [{entry:'section-chat',view:'gaps',origin:'proposal'},{entry:'chat-open',view:'patterns',origin:'component'}])test(`${entry} starts a clean ${view} request after closing an unsent ${origin} request in another scope`,()=>{
  const h=harness();h.context.advanced=false;h.context.loading={groups:[]};h.context.openChat(['inventory','context'],'Original '+origin+' request for Claude in repo A',null,null,['asset-a']);h.context.closeChat();
  h.context.activeRepo='/synthetic/repo-b';h.context.selectedAgent='codex';h.context.view=view;h.node(entry).listeners.click();
  assert.equal(h.node('chat-prompt').value,'');assert.equal(h.context.activeChat,null);assert.equal(h.node('chat-drawer').hidden,false);assert.equal(h.node('chat-agent').value,'codex');
  assert.equal(h.payload().repo,'/synthetic/repo-b');assert.equal(h.payload().reviewAgent,'codex');assert.deepEqual([...h.payload().sections],[view]);assert.deepEqual([...h.payload().selectedIds],[]);assert.equal(h.context.beginnerSelection,null);assert.equal(h.calls.length,0);
});

for(const prompt of [undefined,null,'','Explicit replacement prompt'])test(`new requests replace prior composer text with ${String(prompt)}`,()=>{
  const h=harness();h.node('chat-prompt').value='Prior unsent text';h.context.openChat(['context'],prompt);
  assert.equal(h.node('chat-prompt').value,prompt??'');assert.equal(h.context.activeChat,null);assert.equal(h.calls.length,0);
});

for(const entry of ['continuation','history'])test(`${entry} clears a different conversation composer and preserves a same-conversation follow-up`,()=>{
  const h=harness(),saved={id:'saved-b',repo:'/synthetic/repo-b',agent:'codex',intent:'analysis',sections:['context'],selectedIds:['saved-b-asset'],status:'complete'};
  const open=chat=>{if(entry==='continuation')h.context.openChat(null,undefined,chat);else{h.context.state.conversations=[chat];h.context.renderHistory();h.node('chat-history').children[0].children[0].listeners.click();}};
  h.context.openChat(['inventory'],'Original unsent proposal for repo A',null,null,['asset-a']);h.run('showChatTab(true)');open(saved);
  assert.equal(h.node('chat-prompt').value,'');assert.equal(h.context.activeChat.id,saved.id);assert.equal(h.payload().repo,saved.repo);assert.equal(h.node('chat-agent').value,saved.agent);assert.deepEqual([...h.payload().selectedIds],saved.selectedIds);
  h.node('chat-prompt').value='My unsent follow-up for saved B';h.context.closeChat();open({...saved,title:'Refreshed same conversation'});assert.equal(h.node('chat-prompt').value,'My unsent follow-up for saved B');
  open({...saved,id:'saved-c',repo:'/synthetic/repo-c'});assert.equal(h.node('chat-prompt').value,'');assert.equal(h.context.activeChat.id,'saved-c');assert.equal(h.payload().repo,'/synthetic/repo-c');assert.equal(h.calls.length,0);
});

test('empty unsaved plans can ask for planning help without validation, saving, previewing or dispatching',()=>{
  const h=harness();h.ask();assert.equal(h.calls.length,0);assert.equal(h.context.improvementId,null);assert.equal(h.node('improvement-dialog').open,false);assert.equal(h.node('chat-drawer').hidden,false);assert.match(h.node('chat-prompt').value,/plan is unsaved.*one change.*backup and rollback.*quality check.*measured metric.*stable comparison conditions.*unresolved loading and use assumptions/s);assert.match(h.node('chat-prompt').value,/\(not filled in\)/);assert.deepEqual([...h.payload().improvementIds],[]);assert.match(html,/<button id="improvement-plan-ask"[^>]*type="button">Ask for help planning/);assert.match(html,/Your unsaved plan stays here while you ask.*Review the reply.*not a page reload/);
});

for(const expectedSaving of [120,0,'<img src=x>',null,undefined])test(`a fresh legacy proposal plan leaves expected benefit blank for ${String(expectedSaving)}`,()=>{
  const proposal=Object.freeze({title:'Synthetic proposed test',action:'One reversible change',expectedSaving}),before=JSON.stringify(proposal),h=harness({proposal});
  assert.equal(h.node('improvement-benefit').value,'');assert.equal(h.node('improvement-plan-title').value,proposal.title);assert.equal(h.node('improvement-change').value,proposal.action);
  assert.equal(h.context.improvementId,null);assert.deepEqual({...h.context.improvementScope,assetIds:[...h.context.improvementScope.assetIds]},{agent:'claude',repo,assetIds:['asset-a']});assert.equal(h.node('improvement-tasks').children.length,1);
  assert.equal(JSON.stringify(proposal),before);assert.equal(h.context.state.improvements.length,0);assert.equal(h.calls.length,0);
});

test('user-authored expected benefit survives the planning chat detour without being replaced by a proposal figure',()=>{
  const h=harness({proposal:{expectedSaving:120}});h.node('improvement-benefit').value='Measure fewer corrections with equal quality';const before=h.snapshot();h.ask();
  assert.match(h.node('chat-prompt').value,/Expected benefit: Measure fewer corrections with equal quality/);h.context.openImprovement(null,{expectedSaving:900});h.context.closeChat();
  assert.equal(h.node('improvement-benefit').value,'Measure fewer corrections with equal quality');assert.deepEqual(h.snapshot().values,before.values);assert.deepEqual(h.snapshot().taskNodes,before.taskNodes);assert.equal(h.snapshot().scope,before.scope);assert.equal(h.calls.length,0);
});

test('opening a saved manual experiment preserves its expected benefit and measured records',()=>{
  const h=harness(),record={id:'saved-test',agent:'claude',repo,assetIds:['asset-a'],expectedBenefit:'Manually expected fewer corrections',tasks:[{id:'task-a',label:'Synthetic task',prompt:'Fixed synthetic prompt'}],runs:[{id:'run-a',phase:'before',startupTokens:0,totalTokens:42,passed:true}],assessment:{verdict:'collect-baseline'}};
  h.context.state.improvements=[record];h.context.crypto={randomUUID:()=> 'synthetic-run-id'};h.context.improvementRunDraft=()=>({});const before=JSON.stringify(record);let renders=0;h.context.renderImprovementProgress=()=>{renders++;};
  h.context.openImprovement(record,{expectedSaving:900});assert.equal(h.context.improvementId,record.id);assert.equal(h.node('improvement-plan').hidden,true);assert.equal(h.node('improvement-progress').hidden,false);assert.equal(renders,1);
  assert.equal(h.context.state.improvements[0],record);assert.equal(JSON.stringify(record),before);assert.equal(record.expectedBenefit,'Manually expected fewer corrections');assert.equal(record.runs[0].totalTokens,42);assert.equal(h.calls.length,0);
});

test('planning binds original agent, exact repository and IDs despite answering-agent and dashboard changes',()=>{
  const h=harness();h.context.activeRepo='/synthetic/other-repository';h.context.selectedAgent='codex';h.ask();h.node('chat-agent').value='codex';h.context.updateSelection();h.context.updateRouteNote();const payload=h.payload();assert.equal(payload.repo,repo);assert.equal(payload.reviewAgent,'claude');assert.equal(payload.selectionMode,'explicit');assert.deepEqual([...payload.selectedIds],['asset-a']);assert.equal(payload.globalOnly,false);assert.deepEqual([...payload.sections],['inventory','context']);assert.deepEqual([...payload.gapIds],[]);assert.deepEqual([...payload.improvementIds],[]);assert.equal('improvementId' in payload,false);assert.equal('inventorySource' in payload,false);assert.equal(h.routes.at(-1).repo,repo);assert.match(h.node('chat-selection-note').textContent,/claude.*plan-repository.*scope stays fixed/);
});

test('global planning keeps an explicit empty selection even in advanced mode and with other inventory selections',()=>{
  const h=harness({assetIds:[],scope:''});h.ask();h.context.activeRepo=repo;h.context.selectedAgent='codex';const payload=h.payload();assert.equal(payload.repo,'');assert.equal(payload.globalOnly,true);assert.equal(payload.reviewAgent,'claude');assert.equal(payload.selectionMode,'explicit');assert.deepEqual([...payload.selectedIds],[]);assert.match(h.text(h.node('improvement-selected-files')),/No files explicitly selected/);
});

test('bounded excerpts retain the complete first prompt and explicit omission counts without file bodies',()=>{
  const h=harness();for(const id of ['plan-title','change','benefit','rollback'])h.node('improvement-'+id).value=id+' '+('x'.repeat(5000));for(let index=0;index<4;index++)h.context.addImprovementTask();for(const group of h.node('improvement-tasks').children){group.querySelector('input').value='Representative task';group.querySelector('textarea').value='Task input and passing quality '+('y'.repeat(3900))+'\nDo not change files.';}const first=h.task().querySelector('textarea').value;h.ask();const prompt=h.node('chat-prompt').value;assert.ok(prompt.length<=12000);for(const phrase of ['Title: plan-title','Proposed change: change','Expected benefit: benefit','Backup and rollback: rollback','Task 5 label excerpt: Representative task',first,'characters omitted','needsDetails'])assert.ok(prompt.includes(phrase));assert.doesNotMatch(prompt,/PRIVATE FILE BODY|improvementId|test-a/);
});

test('closing planning chat returns the identical form, tasks, scope and local draft without resetting',()=>{
  const h=harness();h.node('improvement-plan-title').value='My unsaved test';h.node('improvement-change').value='One reversible change';h.node('improvement-benefit').value='Measure corrections';h.node('improvement-rollback').value='Restore exact backup';h.task().querySelector('input').value='Equivalent task';h.task().querySelector('textarea').value='Exact prompt and quality';h.context.addImprovementTask();const before=h.snapshot();h.ask();h.context.activeRepo='/synthetic/changed';h.run('showChatTab(true); showChatTab(false); closeChat()');const after=h.snapshot();assert.equal(h.node('improvement-dialog').open,true);assert.equal(h.node('improvement-dialog').dataset.planReturn,undefined);assert.equal(h.context.pendingPlan,null);assert.equal(after.scope,before.scope);assert.deepEqual(after.values,before.values);assert.deepEqual(after.taskValues,before.taskValues);assert.deepEqual(after.taskNodes,before.taskNodes);assert.equal(after.resets,before.resets);assert.equal(h.calls.length,0);
});

test('new chat and history reset planning request scope but still return to the untouched outstanding plan',()=>{
  for(const transition of ['new','history']){const h=harness();h.node('improvement-change').value='Outstanding change';const before=h.snapshot();h.ask();h.context.openImprovement(null,{title:'Replacement plan'},[]);assert.equal(h.snapshot().scope,before.scope);assert.equal(h.node('improvement-plan-title').value,'');if(transition==='new'){h.context.newChat();assert.equal(h.context.pendingPlan,null);}else{h.context.state.conversations=[{id:'history-chat',repo:'/synthetic/history',agent:'codex',sections:['inventory'],selectedIds:[],status:'handoff'}];h.context.renderHistory();h.node('chat-history').children[0].children[0].listeners.click();assert.equal(h.context.pendingPlan,null);assert.equal(h.payload().repo,'/synthetic/history');}h.context.closeChat();assert.equal(h.node('improvement-dialog').open,true);assert.deepEqual(h.snapshot().values,before.values);assert.deepEqual(h.snapshot().taskNodes,before.taskNodes);}
});

test('busy planning requests prevent closing or replacing the outstanding plan and duplicate assistance',()=>{
  const h=harness();h.ask();const scope=h.context.improvementScope,prompt=h.node('chat-prompt').value;h.node('chat-send').dataset.busy='true';h.context.closeChat();h.context.newChat();h.context.openChat(['dashboard'],'Replacement request');h.context.openImprovement(null,{title:'Replacement plan'});h.ask();assert.equal(h.context.improvementScope,scope);assert.equal(h.node('chat-prompt').value,prompt);assert.equal(h.node('improvement-dialog').open,false);assert.ok(h.context.pendingPlan);assert.equal(h.calls.length,0);delete h.node('chat-send').dataset.busy;h.context.closeChat();assert.equal(h.node('improvement-dialog').open,true);
});

test('a deferred history reply cannot return and reopen planning until its original response finishes',async()=>{
  let release;const history={id:'history-handoff',repo:'/synthetic/history-repository',agent:'codex',sections:['inventory'],selectedIds:[],status:'handoff',intent:'analysis'};
  const h=harness({respond:async(path)=>path==='/api/reply'?new Promise(resolve=>{release=resolve;}):{}});h.node('improvement-change').value='Original unsaved change';const before=h.snapshot();h.ask();h.context.state.conversations=[history];h.context.renderHistory();h.node('chat-history').children[0].children[0].listeners.click();h.node('reply-content').value='Synthetic pasted response';h.node('reply-form').listeners.submit({preventDefault(){}});const reply=h.context.lastAction;assert.equal(h.node('reply-button').dataset.busy,'true');
  h.context.closeChat();h.context.newChat();h.context.openChat(['context'],'New planning request');h.ask();h.context.state.conversations.push({...history,id:'another-history'});h.context.renderHistory();h.node('chat-history').children[1].children[0].listeners.click();assert.equal(h.node('improvement-dialog').open,false);assert.equal(h.context.activeChat.id,'history-handoff');assert.equal(h.payload().repo,'/synthetic/history-repository');assert.equal(h.calls.length,1);assert.equal(h.calls[0].path,'/api/reply');assert.equal(h.calls[0].body.id,'history-handoff');assert.deepEqual(h.snapshot().values,before.values);
  release({...history,status:'complete'});await reply;h.context.closeChat();assert.equal(h.node('improvement-dialog').open,true);h.ask();assert.equal(h.context.activeChat,null);assert.equal(h.payload().repo,repo);assert.equal(h.payload().reviewAgent,'claude');assert.deepEqual([...h.payload().selectedIds],['asset-a']);assert.equal(h.calls.length,1);assert.deepEqual(h.snapshot().taskNodes,before.taskNodes);
});

test('planning assistance also waits for a preexisting reply before a return flag has been created',async()=>{
  let release;const history={id:'preexisting-handoff',repo:'/synthetic/history-repository',agent:'codex',sections:[],selectedIds:[],status:'handoff',intent:'analysis'};
  const h=harness({respond:async()=>new Promise(resolve=>{release=resolve;})});h.context.activeChat=history;h.node('reply-content').value='Synthetic response';h.node('reply-form').listeners.submit({preventDefault(){}});const reply=h.context.lastAction;h.ask();assert.equal(h.context.pendingPlan,null);assert.equal(h.node('improvement-dialog').open,true);assert.equal(h.node('improvement-dialog').dataset.planReturn,undefined);assert.equal(h.calls.length,1);release({...history,status:'complete'});await reply;h.ask();assert.equal(h.context.pendingPlan.repo,repo);assert.equal(h.node('improvement-dialog').open,false);
});

test('a deferred actual pin callback cannot replace reopened planning or a different ordinary conversation',async()=>{
  for(const destination of ['planning','ordinary']){
    let release;const history={id:'pin-history',repo:'/synthetic/pin-history-repository',agent:'codex',sections:['inventory'],selectedIds:[],status:'complete',intent:'analysis',messages:[],pinned:false};
    const h=harness({respond:async()=>new Promise(resolve=>{release=resolve;})});vm.runInContext(slice('function renderConversation()','function renderHistory()'),h.context);h.ask();h.context.state.conversations=[history];h.context.renderHistory();h.node('chat-history').children[0].children[0].listeners.click();const pin=h.node('chat-messages').children[0].children.find(item=>item.tag==='button');pin.listeners.click({currentTarget:pin});const pending=h.context.lastAction;assert.equal(h.calls[0].path,'/api/conversation');assert.equal(h.calls[0].body.id,'pin-history');
    if(destination==='planning'){h.context.closeChat();h.ask();assert.equal(h.context.activeChat,null);assert.equal(h.payload().repo,repo);}else{h.context.openChat(null,undefined,{...history,id:'different-conversation',repo:'/synthetic/different-repository',pinned:false});assert.equal(h.context.activeChat.id,'different-conversation');}
    release({...history,pinned:true});await pending;assert.equal(h.context.lastToast,'Conversation pinned.');if(destination==='planning'){assert.equal(h.context.activeChat,null);assert.equal(h.payload().repo,repo);assert.equal(h.payload().reviewAgent,'claude');assert.deepEqual([...h.payload().selectedIds],['asset-a']);}else{assert.equal(h.context.activeChat.id,'different-conversation');assert.equal(h.context.activeChat.pinned,false);assert.equal(h.payload().repo,'/synthetic/different-repository');}
  }
});

test('preview and send stay explicit and send the captured metadata selection without a fabricated saved test',async()=>{
  const h=harness();h.ask();h.context.activeRepo='/synthetic/other-repository';h.node('chat-preview-button').listeners.click({currentTarget:h.node('chat-preview-button')});await h.context.lastAction;assert.equal(h.calls.length,1);assert.equal(h.calls[0].path,'/api/context');assert.equal(h.calls[0].body.repo,repo);assert.deepEqual([...h.calls[0].body.selectedIds],['asset-a']);assert.deepEqual([...h.calls[0].body.improvementIds],[]);h.node('chat-form').listeners.submit({preventDefault(){}});await h.context.lastAction;assert.equal(h.calls.length,2);assert.equal(h.calls[1].path,'/api/chat');assert.equal(h.calls[1].body.reviewAgent,'claude');assert.equal(h.calls[1].body.repo,repo);assert.equal(h.calls[1].body.id,undefined);assert.equal('inventorySource' in h.calls[1].body,false);assert.equal(h.context.pendingPlan,null);h.context.closeChat();assert.equal(h.node('improvement-dialog').open,true);
});

test('polling inventory cannot reset or retarget a draft and blocks sharing its stale selection',()=>{
  const h=harness();h.node('improvement-rollback').value='Original exact backup';const before=h.snapshot();h.ask();const noop=()=>{};Object.assign(h.context,{renderSnapshots:new Map(),initialRender:false,reusableScope:null});for(const name of ['updateControls','renderDashboard','renderBeginnerHealth','renderInventory','renderContextBreakdowns','renderContext','renderGaps','renderAgents','renderPatterns','renderJournal','renderStorage','renderReusableList','renderImprovements','updateStartGuide','refreshLoading'])h.context[name]=noop;vm.runInContext(slice('function hasChanged(','function effectiveBudget(')+slice('function renderState()','async function refresh()'),h.context);h.context.state.inventory={scannedAt:'2026-10-13',items:[]};h.context.activeRepo='/synthetic/other-repository';h.context.selectedAgent='codex';h.context.renderState();assert.throws(h.payload,/Selected source metadata changed/);assert.equal(h.context.pendingPlan.repo,repo);assert.deepEqual([...h.context.pendingPlan.assetIds],['asset-a']);assert.deepEqual(h.snapshot().values,before.values);assert.deepEqual(h.snapshot().taskNodes,before.taskNodes);assert.match(h.text(h.node('improvement-selected-files')),/Selected files at last scan.*2026-10-12.*Partial inventory.*Synthetic skill.*Content version: Unknown/s);assert.doesNotMatch(h.text(h.node('improvement-selected-files')),/PRIVATE FILE BODY|2026-10-13/);h.context.closeChat();assert.equal(h.snapshot().resets,before.resets);
});

const suggested=(body,extra={})=>({requestId:body.requestId,status:'ready',title:'One explicit test',change:'Change one setting after baseline',rollback:'Restore the saved setting',variable:'configuration',task:{label:'Representative task',prompt:'Check the fixed task. Do not modify files.',qualityCheck:'The expected result must match'},...extra});
const beginSuggestion=h=>{h.ask();h.context.closeChat();h.node('improvement-suggestion-text').value='{"synthetic":"pasted reply"}';};
const previewSuggestion=h=>h.node('improvement-suggestion-preview-button').listeners.click();
const useSuggestion=h=>h.node('improvement-suggestion-use').listeners.click();
const createPlan=async h=>{h.node('improvement-plan').listeners.submit({preventDefault(){},submitter:h.node('synthetic-submit')});await new Promise(setImmediate);};
const planRecord=body=>({...body,id:'saved-local-test',status:'baseline',tasks:body.tasks.map((task,index)=>({...task,id:'task-'+index}))});

test('suggestion disclosure is collapsed, labeled and explicit; Ask retains the exact first task and request schema',()=>{
  const h=harness(),task=h.task();task.querySelector('textarea').value='  Exact task\nDo not run commands.  ';h.ask();
  assert.match(html,/<details id="improvement-suggestion">/);assert.match(html,/id="improvement-suggestion-text"[^>]*maxlength="14000"/);assert.match(html,/id="improvement-suggestion-status"[^>]*role="status"[^>]*aria-live="polite"/);assert.match(html,/id="chat-prompt"[^>]*maxlength="12000"/);assert.equal(h.node('improvement-suggestion').open,false);assert.equal(h.calls.length,0);
  const request=h.node('improvement-dialog').planSuggestion,prompt=h.node('chat-prompt').value;assert.ok(prompt.includes(task.querySelector('textarea').value));assert.ok(prompt.includes(request.requestId));assert.match(prompt,/Return only JSON.*qualityCheck 2000.*needsDetails.*Never invent/s);assert.ok(prompt.length<=12000);assert.doesNotMatch(prompt,/PRIVATE FILE BODY/);
});

test('oversized first tasks reject Ask without truncating or replacing the draft',()=>{
  for(const field of ['label','prompt']){const h=harness(),control=h.task().querySelector(field==='label'?'input':'textarea');control.value='x'.repeat(field==='label'?121:4001);const before=h.snapshot();h.ask();assert.equal(h.node('improvement-dialog').open,true);assert.match(h.node('improvement-error').textContent,/full draft is kept/);assert.equal(h.node('improvement-dialog').planSuggestion,null);assert.deepEqual(h.snapshot().taskValues,before.taskValues);assert.equal(h.calls.length,0);}
});

test('local preview shows exact replacements; explicit apply preserves benefit and all extra task nodes, then Create saves captured scope',async()=>{
  const h=harness({respond:async(path,body)=>path==='/api/improvement-suggestion'?suggested(body):planRecord(body)});h.node('improvement-benefit').value='My own unmeasured expectation';h.context.addImprovementTask();const extra=h.node('improvement-tasks').children[1];extra.querySelector('input').value='Second task';extra.querySelector('textarea').value='Keep this exact extra task';const before=h.snapshot();beginSuggestion(h);h.context.activeRepo='/synthetic/other';h.context.selectedAgent='codex';h.node('chat-agent').value='codex';await previewSuggestion(h);
  assert.deepEqual(h.snapshot().values,before.values);assert.deepEqual(h.snapshot().taskValues,before.taskValues);assert.equal(h.calls.length,1);const body=h.calls[0].body;assert.equal(h.calls[0].path,'/api/improvement-suggestion');assert.deepEqual(Object.keys(body).sort(),['agent','assetIds','expectedInventoryScan','repo','requestId','suggestion']);assert.equal(body.agent,'claude');assert.equal(body.repo,repo);assert.deepEqual([...body.assetIds],['asset-a']);assert.equal(body.expectedInventoryScan,'2026-10-12');
  assert.equal(JSON.parse(h.node('improvement-suggestion-before').textContent).title,'');assert.equal(JSON.parse(h.node('improvement-suggestion-after').textContent).firstTask.prompt,suggested(body).task.prompt+'\n\nQuality check:\n'+suggested(body).task.qualityCheck);assert.equal(h.node('improvement-suggestion-preview').hidden,false);assert.equal(h.node('improvement-suggestion-use').disabled,false);
  useSuggestion(h);assert.equal(h.node('improvement-plan-title').value,'One explicit test');assert.equal(h.node('improvement-benefit').value,'My own unmeasured expectation');assert.equal(h.node('improvement-tasks').children[1],extra);assert.equal(extra.querySelector('textarea').value,'Keep this exact extra task');assert.equal(h.context.improvementId,null);assert.equal(h.calls.length,1);
  h.node('improvement-change').value+='; manually clarified';h.node('improvement-plan').listeners.input({target:h.node('improvement-change')});await createPlan(h);assert.equal(h.calls.length,2);assert.equal(h.calls[1].path,'/api/improvement');assert.equal(h.calls[1].body.expectedInventoryScan,'2026-10-12');assert.equal(h.calls[1].body.repo,repo);assert.equal(h.calls[1].body.agent,'claude');assert.equal(h.calls[1].body.expectedBenefit,'My own unmeasured expectation');assert.equal(h.calls[1].body.tasks.length,2);assert.equal(h.context.improvementId,'saved-local-test');
});

test('needsDetails and failed parsing preserve paste and the full unsaved plan; a retry remains explicit',async()=>{
  let mode='questions';const h=harness({respond:async(path,body)=>{if(mode==='failure')throw new Error('Synthetic parse error');return mode==='questions'?{requestId:body.requestId,status:'needsDetails',questions:['What is the exact backup?','Which passing result?']}:suggested(body);}});h.node('improvement-change').value='My draft';beginSuggestion(h);const before=h.snapshot(),paste=h.node('improvement-suggestion-text').value;await previewSuggestion(h);assert.match(h.node('improvement-suggestion-status').textContent,/needs more details.*exact backup.*passing result/s);assert.equal(h.node('improvement-suggestion-preview').hidden,true);mode='failure';await previewSuggestion(h);assert.match(h.node('improvement-suggestion-status').textContent,/Synthetic parse error/);assert.equal(h.node('improvement-suggestion-text').value,paste);assert.deepEqual(h.snapshot().values,before.values);mode='ready';await previewSuggestion(h);assert.equal(h.node('improvement-suggestion-preview').hidden,false);assert.deepEqual(h.snapshot().values,before.values);
});

for(const invalid of [body=>null,body=>suggested(body,{requestId:'wrong-request'}),body=>suggested(body,{extra:'not allowed'}),body=>suggested(body,{variable:'unknown'}),body=>suggested(body,{title:'x'.repeat(121)}),body=>suggested(body,{task:{label:'Task',prompt:'Prompt',qualityCheck:'q'.repeat(2001)}}),body=>({requestId:body.requestId,status:'needsDetails',questions:[]}),body=>({requestId:body.requestId,status:'needsDetails',questions:[' ']}),body=>suggested(body,{task:{label:'Task',prompt:'p'.repeat(3000),qualityCheck:'q'.repeat(1200)}})])test('malformed or wrong-request replies cannot become an applicable preview: '+invalid.toString(),async()=>{
  const h=harness({respond:async(path,body)=>invalid(body)});h.node('improvement-change').value='Kept draft';beginSuggestion(h);const before=h.snapshot();await previewSuggestion(h);assert.match(h.node('improvement-suggestion-status').textContent,/malformed|another request/);assert.equal(h.node('improvement-suggestion-use').disabled,true);useSuggestion(h);assert.deepEqual(h.snapshot().values,before.values);assert.deepEqual(h.snapshot().taskValues,before.taskValues);assert.equal(h.calls.length,1);
});

for(const mutation of ['benefit','extra','order','node','control','quality'])test('the full form fingerprint and task ownership block Use after '+mutation+' changes',async()=>{
  const h=harness({respond:async(path,body)=>suggested(body)});h.context.addImprovementTask();beginSuggestion(h);await previewSuggestion(h);
  if(mutation==='benefit')h.node('improvement-benefit').value='New personal expectation';else if(mutation==='extra')h.node('improvement-tasks').children[1].querySelector('textarea').value='New second task';else if(mutation==='order')h.node('improvement-tasks').children.reverse();else if(mutation==='node'){const old=h.task();h.node('improvement-tasks').children[0]={...old};}else if(mutation==='control'){const old=h.task().querySelector('input'),replacement={...old};const parent=h.task().children.find(item=>item.children.includes(old));parent.children=parent.children.map(item=>item===old?replacement:item);}else h.node('improvement-task-quality').value='Changed quality';const before=h.snapshot();useSuggestion(h);assert.match(h.node('improvement-suggestion-status').textContent,/no longer current/);assert.deepEqual(h.snapshot().values,before.values);assert.deepEqual(h.snapshot().taskValues,before.taskValues);assert.equal(h.calls.length,1);
});

for(const mutation of ['scan','hash','bytes','modifiedAt','path','type','agent','repo','missing'])test('captured source drift rejects preview and Create after '+mutation+' changes, without saving or sending',async()=>{
  const h=harness({respond:async(path,body)=>suggested(body)});beginSuggestion(h);const before=h.snapshot(),item=h.context.state.inventory.items[0];if(mutation==='scan')h.context.state.inventory.scannedAt='new-scan';else if(mutation==='missing')h.context.state.inventory.items=[];else item[mutation==='hash'?'contentHash':mutation]=mutation==='bytes'?43:'changed';await previewSuggestion(h);assert.equal(h.calls.length,0);assert.match(h.node('improvement-suggestion-status').textContent,/source changed/);await createPlan(h);assert.equal(h.calls.length,0);assert.match(h.node('improvement-error').textContent,/Selected source metadata changed/);assert.deepEqual(h.snapshot().values,before.values);assert.deepEqual(h.snapshot().taskValues,before.taskValues);
});

test('source or form drift during a delayed preview produces a kept-draft recovery message without a stale preview',async()=>{
  for(const mutation of ['source','form']){let release;const h=harness({respond:async(path,body)=>new Promise(resolve=>{release=()=>resolve(suggested(body));})});beginSuggestion(h);const pending=previewSuggestion(h);if(mutation==='source')h.context.state.inventory.items[0].bytes++;else h.node('improvement-benefit').value='New expectation without an input event';release();await pending;assert.match(h.node('improvement-suggestion-status').textContent,/changed while previewing.*kept/s);assert.equal(h.node('improvement-suggestion-preview').hidden,true);assert.equal(h.node('improvement-suggestion-preview-button').disabled,false);assert.equal(h.node('improvement-dialog').planSuggestion.busy,false);}
});

test('edited paste, new Ask and new plan own their status despite an older async failure or success',async()=>{
  for(const transition of ['paste','ask','plan']){let resolve,reject;const h=harness({respond:async()=>new Promise((yes,no)=>{resolve=yes;reject=no;})});beginSuggestion(h);const original=h.node('improvement-dialog').planSuggestion,pending=previewSuggestion(h);if(transition==='paste'){h.node('improvement-suggestion-text').value='New reply';h.node('improvement-suggestion-text').listeners.input();}else if(transition==='ask'){h.ask();h.context.closeChat();assert.notEqual(h.node('improvement-dialog').planSuggestion.requestId,original.requestId);}else h.context.openImprovement(null,{title:'A newer plan'},[]);const status=h.node('improvement-suggestion-status').textContent;if(transition==='paste')reject(new Error('Old error'));else resolve(suggested(original));await pending;assert.equal(h.node('improvement-suggestion-status').textContent,status);assert.equal(h.node('improvement-suggestion-preview').hidden,true);if(transition==='plan'){assert.equal(h.node('improvement-plan-title').value,'A newer plan');assert.equal(h.node('improvement-suggestion-text').value,'');}}
});

test('clear and close preserve paste and fields but invalidate an old preview',async()=>{
  const h=harness({respond:async(path,body)=>suggested(body)});h.node('improvement-change').value='My change';beginSuggestion(h);await previewSuggestion(h);const paste=h.node('improvement-suggestion-text').value;h.node('improvement-suggestion-cancel').listeners.click();assert.equal(h.node('improvement-suggestion-preview').hidden,true);assert.equal(h.node('improvement-suggestion-text').value,paste);assert.equal(h.node('improvement-change').value,'My change');await previewSuggestion(h);h.context.closeImprovement();assert.equal(h.node('improvement-suggestion-preview').hidden,true);assert.equal(h.node('improvement-suggestion-text').value,paste);h.node('improvement-dialog').showModal();assert.match(h.node('improvement-suggestion-status').textContent,/Preview cleared.*kept/);
});

test('selected-file manual Create is source-stamped before Ask; drift blocks it, while unselected legacy plans allow an unknown scan',async()=>{
  for(const stale of [false,true]){const h=harness({respond:async(path,body)=>planRecord(body)});h.node('improvement-change').value='Manual change';if(stale)h.context.state.inventory.items[0].bytes++;await createPlan(h);if(stale){assert.equal(h.calls.length,0);assert.match(h.node('improvement-error').textContent,/metadata changed/);assert.equal(h.node('improvement-change').value,'Manual change');}else{assert.equal(h.calls[0].body.expectedInventoryScan,'2026-10-12');assert.equal(h.context.improvementId,'saved-local-test');}}
  const h=harness({assetIds:[],respond:async(path,body)=>planRecord(body)});h.context.state.inventory.scannedAt=null;await createPlan(h);assert.equal('expectedInventoryScan' in h.calls[0].body,false);assert.equal(h.context.improvementId,'saved-local-test');
});

test('Ask rejects opening metadata drift and unavailable scan instead of binding an older visible source to new metadata',()=>{
  for(const mutation of ['scan','source','unknown']){const h=harness();if(mutation==='source')h.context.state.inventory.items[0].bytes++;else h.context.state.inventory.scannedAt=mutation==='scan'?'new-scan':null;h.ask();assert.equal(h.node('improvement-dialog').open,true);assert.equal(h.node('improvement-dialog').planSuggestion,null);assert.match(h.node('improvement-error').textContent,/source metadata changed/i);assert.equal(h.calls.length,0);}
});

test('global suggestion preview stays explicit and empty after dashboard and answering-agent changes',async()=>{
  const h=harness({assetIds:[],scope:'',respond:async(path,body)=>suggested(body)});beginSuggestion(h);h.context.activeRepo=repo;h.context.selectedAgent='codex';h.node('chat-agent').value='codex';await previewSuggestion(h);assert.equal(h.calls[0].body.repo,'');assert.equal(h.calls[0].body.agent,'claude');assert.deepEqual([...h.calls[0].body.assetIds],[]);useSuggestion(h);assert.equal(h.context.improvementScope.repo,'');assert.equal(h.context.improvementScope.agent,'claude');
});

test('saved workflow suggestions fix workflow and reject changed workflow metadata or a different variable',async()=>{
  for(const mode of ['valid','variable','drift']){const h=harness({respond:async(path,body)=>suggested(body,{variable:mode==='variable'?'model':'workflow'})});h.context.state.conversations=[{id:'workflow-a',repo,agent:'claude',status:'complete',reusable:{status:'ready',bundle:{source:'Synthetic workflow text'}},reusableRequest:{targetAgent:'claude',placement:'repo'}}];h.context.openImprovement(null,{agent:'claude',repo,workflowId:'workflow-a'},['asset-a']);beginSuggestion(h);if(mode==='drift')h.context.state.conversations[0].reusable.bundle.source='Changed workflow text';await previewSuggestion(h);if(mode==='drift'){assert.equal(h.calls.length,0);assert.match(h.node('improvement-suggestion-status').textContent,/source changed/);}else{assert.equal(h.calls[0].body.fixedVariable,'workflow');assert.equal('originalTask' in h.calls[0].body,false);assert.equal(h.node('improvement-suggestion-preview').hidden,mode==='variable');}assert.equal(h.context.improvementId,null);}
});

test('editing a kept field invalidates preview through real form events; paste edits preserve a retryable request',async()=>{
  const h=harness({respond:async(path,body)=>suggested(body)});beginSuggestion(h);await previewSuggestion(h);h.node('improvement-suggestion-text').value='New matching reply';h.node('improvement-suggestion-text').listeners.input();h.node('improvement-plan').listeners.input({target:h.node('improvement-suggestion-text')});assert.equal(h.node('improvement-dialog').planSuggestion.invalid,false);assert.equal(h.node('improvement-suggestion-preview').hidden,true);await previewSuggestion(h);assert.equal(h.node('improvement-suggestion-preview').hidden,false);h.node('improvement-benefit').value='New expectation';h.node('improvement-plan').listeners.input({target:h.node('improvement-benefit')});assert.equal(h.node('improvement-suggestion-preview').hidden,true);assert.match(h.node('improvement-suggestion-status').textContent,/Plan fields changed/);await previewSuggestion(h);assert.equal(h.calls.length,2);assert.equal(h.node('improvement-benefit').value,'New expectation');
});

test('source drift after ready or explicit apply blocks Use or Create without discarding the unsaved suggestion',async()=>{
  for(const stage of ['ready','applied']){const h=harness({respond:async(path,body)=>suggested(body)});beginSuggestion(h);await previewSuggestion(h);if(stage==='applied')useSuggestion(h);const before=h.snapshot();h.context.state.inventory.items[0].modifiedAt='2026-10-14';if(stage==='ready')useSuggestion(h);else await createPlan(h);assert.deepEqual(h.snapshot().values,before.values);assert.deepEqual(h.snapshot().taskValues,before.taskValues);assert.equal(h.calls.length,1);assert.match(h.node(stage==='ready'?'improvement-suggestion-status':'improvement-error').textContent,/no longer current|metadata changed/);}
});

test('an older completion cannot unfreeze a newer preview; duplicate preview clicks make one request',async()=>{
  const pending=[];const h=harness({respond:async(path,body)=>new Promise(resolve=>pending.push({body,resolve}))});beginSuggestion(h);const first=previewSuggestion(h);await previewSuggestion(h);assert.equal(h.calls.length,1);h.ask();h.context.closeChat();const second=previewSuggestion(h);assert.equal(h.calls.length,2);assert.equal(h.node('improvement-suggestion-preview-button').disabled,true);pending[0].resolve(suggested(pending[0].body));await first;assert.equal(h.node('improvement-suggestion-preview-button').disabled,true);assert.equal(h.node('improvement-dialog').planSuggestion.busy,true);pending[1].resolve(suggested(pending[1].body));await second;assert.equal(h.node('improvement-suggestion-preview-button').disabled,false);assert.equal(h.node('improvement-suggestion-preview').hidden,false);
});

test('closing a pending local preview clears reading status and its later response cannot appear on reopening',async()=>{
  let release;const h=harness({respond:async(path,body)=>new Promise(resolve=>{release=()=>resolve(suggested(body));})});beginSuggestion(h);const pending=previewSuggestion(h),paste=h.node('improvement-suggestion-text').value;h.context.closeImprovement();const status=h.node('improvement-suggestion-status').textContent;assert.match(status,/Preview cleared/);h.node('improvement-dialog').showModal();release();await pending;assert.equal(h.node('improvement-suggestion-status').textContent,status);assert.equal(h.node('improvement-suggestion-text').value,paste);assert.equal(h.node('improvement-suggestion-preview').hidden,true);
});

const previewCoverage=(sections=[],partial=sections.some(row=>row.omitted>0))=>({partial,sections,interpretation:'Selected scoped summary records only.'});
const previewRow=(section,available,included)=>({section,available,included,omitted:available-included});
const previewClick=h=>{h.node('chat-preview-button').listeners.click({currentTarget:h.node('chat-preview-button')});return h.context.lastAction;};

for(const advanced of [false,true])test(`${advanced?'advanced':'beginner'} preview keeps its readable summary visible and raw evidence ${advanced?'open':'collapsed'}`,async()=>{
  const text='Exact synthetic evidence\n'+('Synthetic record\n'.repeat(200)),h=harness({respond:async()=>({text,estTokens:500,truncated:false,coverage:previewCoverage([previewRow('inventory',2,2)])})});h.context.advanced=advanced;h.context.openChat(['inventory'],'Unchanged draft');await previewClick(h);
  assert.equal(h.node('context-preview').hidden,false);assert.equal(h.node('context-preview').open,advanced);assert.match(h.node('context-preview-summary').textContent,/All selected summary records included/);assert.equal(h.node('context-preview-text').textContent,text);assert.equal(h.node('chat-prompt').value,'Unchanged draft');assert.deepEqual([...h.payload().sections],['inventory']);assert.deepEqual(h.calls.map(call=>call.path),['/api/context']);
});

test('preview shows complete selected-summary coverage and a bytes/4 estimate without claiming source completeness or dispatching',async()=>{
  const text='{"synthetic":"<script>inert()</script>","coverage":"inspectable"}',h=harness({respond:async()=>({text,estTokens:12,truncated:false,coverage:previewCoverage([previewRow('inventory',0,0),previewRow('context.observations',2,2)])})});h.context.openChat(['inventory','context'],'Keep my draft');await previewClick(h);
  assert.match(h.node('context-preview-summary').textContent,/All selected summary records included.*12 estimated context tokens \(bytes\/4\).*separate from source and runtime coverage/);assert.doesNotMatch(h.node('context-preview-summary').textContent,/omitted|Select fewer|unused|measured/);assert.equal(h.node('context-preview-text').textContent,text);assert.equal(h.node('context-preview').hidden,false);assert.equal(h.node('context-preview').open,true);assert.equal(h.node('chat-prompt').value,'Keep my draft');assert.deepEqual(h.calls.map(call=>call.path),['/api/context']);
});

test('partial preview names only omitted sections with included/available counts and keeps the full raw preview',async()=>{
  const text='Full synthetic scoped preview',h=harness({respond:async()=>({text,estTokens:0,truncated:true,coverage:previewCoverage([previewRow('inventory',7,3),previewRow('gaps',2,2),previewRow('context.observations',5,1),previewRow('inventory.toolInspection.servers',3,1),previewRow('patterns.importedAudit.tables.synthetic',4,2)])})});h.context.openChat(['inventory','context','gaps','patterns'],'Original prompt');await previewClick(h);const summary=h.node('context-preview-summary').textContent;
  assert.ok(summary.includes('Configured tool definitions: 1 of 3 included (2 omitted)'));
  assert.match(summary,/Partial scoped summary.*Files: 3 of 7 included \(4 omitted\).*Manual context readings: 1 of 5 included \(4 omitted\).*Imported audit records: 2 of 4 included \(2 omitted\)/);assert.match(summary,/0 estimated context tokens \(bytes\/4\).*Select fewer items or sections, then preview again/);assert.doesNotMatch(summary,/Needs attention|synthetic|All selected/);assert.equal(h.node('context-preview-text').textContent,text);assert.equal(h.node('chat-prompt').value,'Original prompt');assert.deepEqual(h.calls.map(call=>call.path),['/api/context']);
});

for(const truncated of [false,true])test(`legacy preview without coverage stays honest when truncated is ${truncated}`,async()=>{
  const h=harness({respond:async()=>({text:'Legacy preview',estTokens:5,truncated})});h.context.openChat(['inventory'],'Legacy draft');await previewClick(h);const summary=h.node('context-preview-summary').textContent;
  assert.match(summary,truncated?/Partial scoped summary.*coverage details unavailable.*Select fewer/:/Coverage unknown/);assert.doesNotMatch(summary,/All selected|NaN|of undefined/);assert.equal(h.node('context-preview-text').textContent,'Legacy preview');assert.deepEqual(h.calls.map(call=>call.path),['/api/context']);
});

for(const coverage of [null,{partial:false,sections:'invalid',interpretation:''},previewCoverage([previewRow('inventory',4,1)],false),previewCoverage([{section:'inventory',available:4,included:1,omitted:NaN}],true),previewCoverage([{section:'inventory',available:4,included:-1,omitted:5}],true),previewCoverage([previewRow('inventory',2,2),previewRow('inventory',2,2)]),previewCoverage([{section:'',available:0,included:0,omitted:0}])])test(`malformed optional preview coverage does not fabricate completeness: ${JSON.stringify(coverage)}`,async()=>{
  const h=harness({respond:async()=>({text:'Inspectable fallback',estTokens:NaN,truncated:false,coverage})});h.context.openChat(['context'],'My prompt');await previewClick(h);assert.match(h.node('context-preview-summary').textContent,/Coverage unknown.*Context token estimate unknown \(bytes\/4\)/);assert.doesNotMatch(h.node('context-preview-summary').textContent,/All selected|NaN|undefined|omitted/);assert.equal(h.node('context-preview-text').textContent,'Inspectable fallback');assert.equal(h.calls.length,1);
});

test('untrusted coverage keys and extra interpretation remain inert and are not copied into readable labels',async()=>{
  const h=harness({respond:async()=>({text:'Raw synthetic preview',estTokens:1,truncated:true,coverage:{...previewCoverage([previewRow('<img src=x onerror="synthetic()">',3,1),previewRow('__proto__',2,1)]),interpretation:'<script>synthetic()</script>',privateExtra:'DO NOT DISPLAY'}})});h.context.openChat(['context'],'My prompt');await previewClick(h);assert.match(h.node('context-preview-summary').textContent,/Other selected evidence: 1 of 3 included \(2 omitted\)/);assert.doesNotMatch(h.node('context-preview-summary').textContent,/img|script|DO NOT DISPLAY|object Object|__proto__/);assert.equal(h.calls.length,1);
});

for(const transition of ['scope','sections','close','reopen','conversation'])test(`a deferred preview cannot appear after ${transition} replaces its request context`,async()=>{
  let release;const h=harness({respond:()=>new Promise(resolve=>{release=resolve;})});h.context.openChat(['inventory'],'Original draft');if(transition==='conversation')h.context.openChat(null,undefined,{id:'saved-a',repo,agent:'claude',sections:['inventory'],selectedIds:[],status:'complete'});const pending=previewClick(h);
  if(transition==='scope')h.context.activeRepo='/synthetic/other';else if(transition==='sections')h.context.selectSections(['context']);else if(transition==='close')h.context.closeChat();else if(transition==='reopen'){h.context.closeChat();h.context.openChat(['inventory'],'Original draft');}else h.context.openChat(null,undefined,{id:'saved-b',repo,agent:'claude',sections:['inventory'],selectedIds:[],status:'complete'});
  release({text:'Obsolete preview',estTokens:5,truncated:true,coverage:previewCoverage([previewRow('inventory',3,1)])});await pending;assert.equal(h.node('context-preview').hidden,true);assert.notEqual(h.node('context-preview-text').textContent,'Obsolete preview');assert.equal(h.calls.length,1);
});

test('a failed new preview hides the prior summary while preserving the request composer',async()=>{
  let reject;const h=harness({respond:()=>new Promise((resolve,fail)=>{reject=fail;})});h.context.openChat(['inventory'],'Keep this draft');h.node('context-preview').hidden=false;h.node('context-preview-summary').textContent='Prior summary';const pending=previewClick(h);assert.equal(h.node('context-preview').hidden,true);reject(new Error('Synthetic metadata budget rejection'));await assert.rejects(pending,/Synthetic metadata budget rejection/);assert.equal(h.node('context-preview').hidden,true);assert.equal(h.node('chat-prompt').value,'Keep this draft');assert.deepEqual(h.calls.map(call=>call.path),['/api/context']);
});
