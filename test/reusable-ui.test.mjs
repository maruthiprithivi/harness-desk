import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const functions = source.slice(source.indexOf('function reusableFields()'), source.indexOf('function renderImportedAudit()'));
const handlers = source.slice(source.indexOf("$('reusable-open').addEventListener"), source.indexOf("$('improvement-dialog').addEventListener('cancel'"));
const improvementOpening = source.slice(source.indexOf('function addImprovementTask()'), source.indexOf('function updateImprovementPrompt()'));
const scope = source.slice(source.indexOf('function scopedCandidates()'), source.indexOf('function renderPatterns()'));

function harness({ failSave = false, responseStatus = 'ready' } = {}) {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      value:'', checked:false, disabled:false, hidden:true, textContent:'', children:[], listeners:{}, open:false, dataset:{},
      append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; },
      addEventListener(type,listener) { this.listeners[type] = listener; },
      querySelector(selector) { const all = item => [item,...item.children.flatMap(all)]; return all(this).find(item => item.tag === selector) || node(id + '-option'); },
      reset() { if (id === 'improvement-plan') for (const key of ['plan-title','change','benefit','rollback','variable']) node('improvement-' + key).value = ''; },
      showModal() { this.open = true; }, close() { this.open = false; }, click() { this.clicked = true; },
    });
    return nodes.get(id);
  };
  const calls = [];
  const bundle = {name:'Fixture workflow',description:'Reusable fixture',files:[{path:'SKILL.md',content:'<script>alert("fixture")</script>'}],estimates:{descriptionTokens:4,entryTokens:12,deferredTokens:25},trigger:'Fixture task',nonTrigger:'Different task',verification:['Check the fixture']};
  const context = vm.createContext({
    $:node, activeRepo:'/fixture/repo-a', selectedAgent:'codex', reusableScope:null, reusableChat:null, reusableBusy:false, reusableAdoptionPreview:null, reusableDrafts:new Map(),improvementBusy:false,improvementScope:null,improvementId:null,improvementCorrection:null,
    state:{conversations:[],candidates:[],agents:[{id:'codex',name:'Codex',installed:true,auth:'signed-in',dispatch:'direct'},{id:'claude',name:'Claude',installed:false,auth:'unknown',dispatch:'handoff'}]},
    array:value => Array.isArray(value) ? value : [], tokens:value => String(value || 0),
    agentName:id => id || 'Unknown', agentOptions:() => [{value:'codex',label:'Codex signed in direct'},{value:'claude',label:'Claude unknown handoff'}],
    effectiveRoute:() => ({agent:'claude',model:'fixture-model'}),
    setOptions:(item,options,empty,preferred) => { item.value = preferred || options[0]?.value || ''; },
    element:(tag,className='',textContent='') => Object.assign(node('element-' + nodes.size),{tag,className,textContent:String(textContent)}),
    button:(label,className,listener) => { const item = Object.assign(node('button-' + nodes.size),{textContent:label,className}); item.listeners.click = listener; return item; },
    empty:(title,description) => Object.assign(node('empty-' + nodes.size),{textContent:title + ' ' + description}),
    api:async(path,payload) => {
      calls.push({path,payload});
      if (payload.action === 'preview') return {request:payload,prompt:'Fixed fixture prompt',estTokens:21};
      if (payload.action === 'generate') return {id:'chat-a',repo:payload.repo,status:'handoff',messages:[],reusableRequest:payload,reusable:{status:responseStatus,bundle}};
      if (payload.action === 'save') {
        if (failSave) throw new Error('Fixture save failed');
        return {...context.reusableChat,reusable:{status:'saved',bundle,path:'/fixture/private/bundle'}};
      }
      return {};
    },
    schedulePoll() {}, refresh:async() => {}, openChat:(chosen,prompt,chat) => { context.openedChat = chat; },
    Blob, URL, setTimeout,
  });
  vm.runInContext(functions + improvementOpening + handlers + scope,context);
  return {context,node,calls,bundle};
}
function contents(item) { return [item.textContent,...item.children.map(contents)].join(' '); }

const fill = h => { h.node('reusable-task').value = 'Verify a fixture'; h.node('reusable-notes').value = 'Keep the fixture isolated'; };
const reviewedChat = (h,extra={}) => ({id:'workflow-a',repo:'/fixture/repo-a',agent:'codex',status:'complete',reusableRequest:{placement:'repo',targetAgent:'claude',invocation:'explicit'},reusable:{status:'ready',bundle:h.bundle},...extra});

test('opening and typing creates no request; preview is local and scope stays captured through generation',async() => {
  const h = harness(); h.context.openReusable(); fill(h);
  assert.equal(h.calls.length,0);
  assert.equal(h.node('reusable-agent').value,'claude');
  assert.equal(h.node('reusable-target').value,'codex');
  assert.equal(h.node('reusable-invocation').value,'explicit');
  assert.equal(h.node('reusable-auto-save').checked,false);
  h.context.activeRepo = '/fixture/repo-b';
  await h.context.reusableAction('preview');
  assert.equal(h.calls[0].path,'/api/reusable');
  assert.equal(h.calls[0].payload.repo,'/fixture/repo-a');
  assert.equal(h.calls[0].payload.autoSave,false);
  assert.match(h.node('reusable-preview-text').textContent,/Fixed fixture prompt/);
  await h.context.reusableAction('generate');
  assert.equal(h.calls[1].payload.repo,'/fixture/repo-a');
  assert.equal(h.calls[1].payload.globalOnly,false);
  assert.equal(h.calls[1].payload.agent,'claude');
  assert.equal(h.calls[1].payload.targetAgent,'codex');
  await h.context.reusableAction('generate');
  assert.equal(h.calls.length,2);
});

test('auto save is sent only after explicit checkbox selection',async() => {
  const h = harness(); h.context.openReusable(); fill(h); h.node('reusable-auto-save').checked = true;
  await h.context.reusableAction('generate');
  assert.equal(h.calls[0].payload.autoSave,true);
});

test('polling updates response without overwriting notes or working scope',async() => {
  const h = harness({responseStatus:'awaiting-response'}); h.context.openReusable({id:'candidate-a',pattern:'Fixture task'}); fill(h);
  await h.context.reusableAction('generate');
  h.context.activeRepo = '/fixture/repo-b';
  h.context.state.conversations = [{...h.context.reusableChat,status:'complete',reusable:{status:'needs-details',needsDetails:['What counts as passing?']}}];
  h.context.renderReusableProgress();
  assert.equal(h.node('reusable-notes').value,'Keep the fixture isolated');
  assert.equal(h.context.reusableScope.repo,'/fixture/repo-a');
  assert.equal(h.context.reusableScope.candidateId,'candidate-a');
  assert.match(h.node('reusable-status-note').textContent,/What counts as passing/);
  assert.equal(h.node('reusable-save').hidden,true);
});

test('dismiss and reopen retains a scoped draft, and New workflow keeps the captured scope',() => {
  const h = harness(); h.context.openReusable(); fill(h); h.context.closeReusable(); h.context.openReusable();
  assert.equal(h.node('reusable-notes').value,'Keep the fixture isolated');
  h.context.activeRepo = '/fixture/repo-b';
  h.node('reusable-new').listeners.click();
  assert.equal(h.context.reusableScope.repo,'/fixture/repo-a');
  assert.equal(h.node('reusable-notes').value,'');
});

test('failed save preserves bundle and draft, successful retry displays private path',async() => {
  const h = harness({failSave:true}); h.context.openReusable(); fill(h); await h.context.reusableAction('generate');
  await h.context.reusableAction('save');
  assert.equal(h.context.reusableChat.reusable.status,'ready');
  assert.equal(h.context.reusableChat.reusable.bundle,h.bundle);
  assert.equal(h.node('reusable-error').hidden,false);
  assert.equal(h.node('reusable-error').textContent,'Fixture save failed');
  assert.equal(h.node('reusable-notes').value,'Keep the fixture isolated');
  const success = harness(); success.context.openReusable(); fill(success); await success.context.reusableAction('generate'); await success.context.reusableAction('save');
  assert.equal(success.calls[1].payload.id,'chat-a');
  assert.match(success.node('reusable-status-note').textContent,/Saved draft: \/fixture\/private\/bundle/);
  assert.equal(success.node('reusable-save').hidden,true);
});

test('validation retains draft and never sends a request',async() => {
  const h = harness(); h.context.openReusable();
  await h.context.reusableAction('generate'); assert.equal(h.calls.length,0);
  assert.match(h.node('reusable-error').textContent,/Describe what/);
  h.node('reusable-task').value = 'Fixture task'; h.node('reusable-placement').value = 'global';
  await h.context.reusableAction('generate'); assert.equal(h.calls.length,0);
  assert.match(h.node('reusable-error').textContent,/why this repository workflow belongs globally/);
  h.node('reusable-notes').value = 'x'.repeat(2001);
  await h.context.reusableAction('preview'); assert.equal(h.calls.length,0);
  assert.equal(h.node('reusable-notes').value.length,2001);
});

test('global candidates and generation list exclude other repository evidence',() => {
  const h = harness(); h.context.activeRepo = '';
  h.context.state.candidates = [{id:'mixed',examples:['other repo'],evidenceByRepo:{'':{occurrences:3,distinctSessions:2,examples:['global fixture']},'/fixture/repo-a':{occurrences:12,distinctSessions:4}}},{id:'repo-only',evidenceByRepo:{'/fixture/repo-a':{occurrences:3,distinctSessions:2}}}];
  const found = h.context.scopedCandidates();
  assert.equal(found.length,1); assert.equal(found[0].occurrences,3); assert.equal(JSON.stringify(found).includes('other repo'),false);
  h.context.state.conversations = [{id:'global',repo:'',title:'Global fixture',reusableRequest:{placement:'global',targetAgent:'codex'},reusable:{status:'ready'}},{id:'other',repo:'/fixture/repo-a',title:'Other repository fixture',reusableRequest:{placement:'repo',targetAgent:'codex'}}];
  h.context.renderReusableList(); assert.match(contents(h.node('reusable-list')),/Global fixture/); assert.equal(contents(h.node('reusable-list')).includes('Other repository fixture'),false);
});

test('global drafts appear across scopes while repository drafts stay in their original repository',()=>{
  const h=harness();h.context.state.conversations=[reviewedChat(h,{id:'global-from-repo',title:'Global from repo',reusableRequest:{placement:'global',targetAgent:'claude'},reusable:{status:'ready',bundle:{...h.bundle,name:'Global from repo'}}}),reviewedChat(h,{id:'repo-a',reusable:{status:'ready',bundle:{...h.bundle,name:'Repo A draft'}}}),reviewedChat(h,{id:'repo-b',repo:'/fixture/repo-b',reusable:{status:'ready',bundle:{...h.bundle,name:'Repo B draft'}}})];
  for(const repo of ['','/fixture/repo-a','/fixture/repo-b']){
    h.context.activeRepo=repo;h.context.renderReusableList();const text=contents(h.node('reusable-list'));assert.match(text,/Global from repo.*global draft.*original working scope: \/fixture\/repo-a.*Draft; installation not verified/);
    assert.equal(text.includes('Repo A draft'),repo==='/fixture/repo-a');assert.equal(text.includes('Repo B draft'),repo==='/fixture/repo-b');
  }
  const original=h.context.state.conversations[0];h.node('reusable-list').children[0].children.at(-1).listeners.click();assert.equal(h.context.reusableScope.repo,'/fixture/repo-a');assert.equal(h.context.reusableChat,original);
});

test('testing a repository workflow opens only a linked unsaved plan in the captured target scope',()=>{
  const h=harness(),chat=reviewedChat(h);h.context.openReusable(null,chat);h.context.activeRepo='/fixture/repo-b';h.context.selectedAgent='codex';h.node('improvement-rollback').value='Old rollback';h.node('improvement-benefit').value='Old benefit';
  h.node('reusable-test').listeners.click();assert.equal(h.calls.length,0);assert.equal(h.node('reusable-dialog').open,false);assert.equal(h.node('improvement-dialog').open,true);
  assert.equal(h.context.improvementScope.repo,'/fixture/repo-a');assert.equal(h.context.improvementScope.agent,'claude');assert.equal(h.context.improvementScope.workflowId,'workflow-a');assert.equal(h.context.reusableChat,chat);
  assert.equal(h.node('improvement-plan-title').value,'Test Fixture workflow');assert.equal(h.node('improvement-variable').value,'workflow');assert.equal(h.node('improvement-variable').disabled,true);assert.match(h.node('improvement-change').value,/explicit invocation.*manually after before runs/);
  assert.equal(h.node('improvement-benefit').value,'');assert.equal(h.node('improvement-rollback').value,'');assert.equal(h.node('improvement-tasks').children[0].querySelector('textarea').value,'');assert.equal(h.node('improvement-tasks').children[0].querySelector('input').value,'');
  const plan=JSON.stringify({scope:h.context.improvementScope,change:h.node('improvement-change').value,prompt:h.node('improvement-tasks').children[0].querySelector('textarea').value});assert.doesNotMatch(plan,/script>|Fixture task|Check the fixture|candidate-a/);assert.match(h.node('improvement-workflow-note').textContent,/equivalent task.*Collect before runs before manually adopting/);
});

test('a global workflow test captures the current repository without recasting its original conversation',()=>{
  const h=harness(),chat=reviewedChat(h,{reusableRequest:{placement:'global',targetAgent:'codex',invocation:'automatic'}});h.context.openReusable(null,chat);h.context.activeRepo='/fixture/repo-b';h.node('reusable-test').listeners.click();
  assert.equal(h.calls.length,0);assert.equal(h.context.improvementScope.repo,'/fixture/repo-b');assert.equal(h.context.improvementScope.agent,'codex');assert.equal(h.context.improvementScope.workflowId,chat.id);assert.equal(chat.repo,'/fixture/repo-a');assert.equal(h.context.reusableScope.repo,'/fixture/repo-a');assert.match(h.node('improvement-change').value,/automatic matching/);
  h.context.activeRepo='/fixture/repo-c';assert.equal(h.context.improvementScope.repo,'/fixture/repo-b');
  h.context.openImprovement();assert.equal('workflowId' in h.context.improvementScope,false);assert.equal(h.node('improvement-variable').value,'configuration');assert.equal(h.node('improvement-variable').disabled,false);assert.equal(h.node('improvement-workflow-note').hidden,true);
});

test('workflow testing is limited to ready or saved bundles and blocked during pending work',()=>{
  for(const status of ['ready','saved','awaiting-response','needs-details','invalid','save-failed'])for(const present of [false,true]){
    const h=harness();h.context.openReusable(null,reviewedChat(h,{reusable:{status,...(present?{bundle:h.bundle}:{})}}));const allowed=present && ['ready','saved'].includes(status);assert.equal(h.node('reusable-test').hidden,!allowed);h.node('reusable-test').listeners.click();assert.equal(h.node('improvement-dialog').open,allowed);assert.equal(h.calls.length,0);
  }
  for(const key of ['reusableBusy','improvementBusy']){const h=harness();h.context.openReusable(null,reviewedChat(h));h.context[key]=true;h.node('reusable-test').listeners.click();assert.equal(h.node('reusable-dialog').open,true);assert.equal(h.node('improvement-dialog').open,false);assert.equal(h.calls.length,0);}
});

test('linked workflow plan titles are bounded and the latest invalid status cannot start a test',()=>{
  const h=harness();h.context.openReusable(null,reviewedChat(h,{reusable:{status:'saved',bundle:{...h.bundle,name:'x'.repeat(200)}}}));h.node('reusable-test').listeners.click();assert.equal(h.node('improvement-plan-title').value.length,120);
  const changed=harness();const chat=reviewedChat(changed);changed.context.openReusable(null,chat);changed.context.state.conversations=[{...chat,reusable:{...chat.reusable,status:'invalid'}}];changed.node('reusable-test').listeners.click();assert.equal(changed.node('improvement-dialog').open,false);assert.equal(changed.node('reusable-dialog').open,true);
  const running=harness();running.context.openReusable(null,reviewedChat(running,{status:'running'}));assert.equal(running.node('reusable-test').hidden,true);running.node('reusable-test').listeners.click();assert.equal(running.node('improvement-dialog').open,false);assert.equal(running.calls.length,0);
});

test('bundle files render as inert text and followup opens existing conversation after modal closes',async() => {
  const h = harness(); h.context.openReusable(); fill(h); await h.context.reusableAction('generate');
  assert.match(contents(h.node('reusable-result')),/<script>alert\("fixture"\)<\/script>/);
  assert.equal([...h.node('reusable-result').children].some(item => 'innerHTML' in item),false);
  h.node('reusable-conversation').listeners.click();
  assert.equal(h.node('reusable-dialog').open,false); assert.equal(h.context.openedChat.id,'chat-a');
});

test('beginner navigation includes Reusable work and disclosure leaves audit diagnostics advanced',() => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url),'utf8');
  assert.match(html,/href="#patterns" data-view="patterns"><span/);
  assert.match(html,/panel advanced-only[^\n]+Bring in an existing audit/);
  assert.match(source,/\['dashboard','inventory','gaps','patterns'\]\.includes\(view\)/);
  assert.match(html,/Save a valid generated draft automatically/);
  assert.match(html,/id="reusable-notes"[^>]*maxlength="2000"/);
});


test('pending generation blocks duplicate requests and reopening under another scope',async() => {
  const h = harness(); h.context.openReusable(); fill(h);
  let finish;
  h.context.api = async(path,payload) => { h.calls.push({path,payload}); return await new Promise(resolve => { finish = resolve; }); };
  const pending = h.context.reusableAction('generate');
  await h.context.reusableAction('generate');
  h.context.closeReusable(); h.context.activeRepo = '/fixture/repo-b'; h.context.openReusable();
  assert.equal(h.calls.length,1); assert.equal(h.context.reusableScope.repo,'/fixture/repo-a');
  finish({id:'chat-a',repo:'/fixture/repo-a',status:'running',reusableRequest:h.calls[0].payload,reusable:{status:'awaiting-response'}});
  await pending; assert.equal(h.context.reusableBusy,false);
});

test('cancellation sends only the existing conversation ID and retry remains explicit',async() => {
  const h = harness(); h.context.openReusable(); fill(h); await h.context.reusableAction('generate');
  h.context.state.conversations = [{...h.context.reusableChat,status:'running',reusable:{status:'awaiting-response'}}]; h.context.renderReusableProgress();
  assert.equal(h.node('reusable-cancel').hidden,false);
  h.context.refresh = async() => { h.context.state.conversations[0].status = 'cancelled'; };
  await h.context.reusableAction('cancel');
  assert.equal(h.calls.length,2); assert.equal(h.calls[1].path,'/api/cancel'); assert.equal(h.calls[1].payload.id,'chat-a');
  assert.match(h.node('reusable-status-note').textContent,/cancelled.*retry explicitly/);
  await h.context.reusableAction('generate'); assert.equal(h.calls.length,2);
});

test('save-failed result retains file review and allows retry, repeated polling preserves expanded review nodes',async() => {
  const h = harness({responseStatus:'save-failed'}); h.context.openReusable(); fill(h); await h.context.reusableAction('generate');
  assert.equal(h.node('reusable-save').hidden,false);
  assert.equal(h.node('reusable-brief').open,false);h.node('reusable-brief').open=true;
  const reviewed = h.node('reusable-result').children;
  h.context.renderReusableProgress(); assert.equal(h.node('reusable-result').children,reviewed);assert.equal(h.node('reusable-brief').open,true);
  await h.context.reusableAction('save'); assert.equal(h.context.reusableChat.reusable.status,'saved');
});

test('reopening saved generation shows fixed answering agent, model, and persisted candidate metadata',() => {
  const h = harness();
  const chat = {id:'saved-a',repo:'/fixture/repo-a',agent:'codex',model:'saved-model',status:'complete',reusableRequest:{candidate:{id:'candidate-a',pattern:'Persisted fixture'},task:'Task',notes:'Saved notes',placement:'repo',targetAgent:'claude',invocation:'explicit',autoSave:false},reusable:{status:'saved',bundle:h.bundle,path:'/fixture/private/bundle'}};
  h.context.state.conversations = [chat]; h.context.openReusable(null,chat);
  assert.equal(h.node('reusable-agent').value,'codex');
  assert.equal(h.node('reusable-model').value,'saved-model');
  assert.equal(h.node('reusable-target').value,'claude');
  assert.equal(h.context.reusableScope.candidateId,'candidate-a');
  assert.match(h.node('reusable-evidence').textContent,/Selected candidate: Persisted fixture/);
  assert.equal(h.node('reusable-agent').disabled,true);
  assert.match(contents(h.node('reusable-result')),/skills\/, workflows\/, and scripts\/ as sibling directories/);
  assert.match(contents(h.node('reusable-result')),/use \.claude\/ under the captured working repository/);
});

test('workflow conversations retain local history without a broken unpin control; ordinary chats keep pin actions',() => {
  const h = harness();
  const conversation = source.slice(source.indexOf('function renderConversation()'),source.indexOf('function renderHistory()'));
  Object.assign(h.context,{updateRouteNote() {},updateChatAvailability() {},chatSnapshot:'',activeChat:{id:'ordinary',agent:'codex',status:'complete',messages:[],pinned:false},time:() => 'Fixture time',badge:(text,tone) => h.context.element('span',tone,text),requestAnimationFrame() {}});
  vm.runInContext(conversation,h.context);
  h.context.renderConversation();
  const ordinaryStatus = h.node('chat-messages').children[0];
  assert.equal(ordinaryStatus.children[1].textContent,'Pin conversation');
  h.context.activeChat = {...h.context.activeChat,id:'workflow',pinned:true,reusableRequest:{placement:'repo'}};
  h.context.renderConversation();
  const workflowStatus = h.node('chat-messages').children[0];
  assert.equal(workflowStatus.children[1].textContent,'Workflow draft kept');
  assert.equal(workflowStatus.children[1].listeners.click,undefined);
});

test('generation followups use the fixed brief with empty extra sections; ordinary empty requests stay rejected',async()=>{
  const h=harness(),chat={id:'fixed-generation',repo:'/fixture/repo-a',agent:'codex',status:'complete',reusableRequest:{task:'Fixture workflow'}};
  const handler=source.slice(source.indexOf("$('chat-form').addEventListener('submit'"),source.indexOf("$('chat-cancel').addEventListener"));
  Object.assign(h.context,{activeChat:chat,pendingGap:null,pendingImprovement:null,pendingPlan:null,pendingLoadingScope:null,pendingTaskScope:null,contextPreviewRequest:0,chatSnapshot:'',configureChat(){},renderConversation(){},contextPayload:()=>({repo:chat.repo,sections:[],selectedIds:[]}),action:(node,run)=>{h.context.submitted=run();}});
  h.context.api=async(route,payload)=>{h.calls.push({route,payload});return {...chat,status:'handoff'};};
  h.node('chat-prompt').value='Use the fixture input format';h.node('chat-agent').value='codex';h.node('chat-intent').value='build';
  vm.runInContext(handler,h.context);h.node('chat-form').listeners.submit({preventDefault(){}});await h.context.submitted;
  assert.equal(h.calls[0].route,'/api/chat');assert.equal(h.calls[0].payload.id,chat.id);assert.equal(h.calls[0].payload.repo,chat.repo);assert.equal(h.calls[0].payload.sections.length,0);
  h.context.activeChat={...chat,reusableRequest:undefined};h.node('chat-prompt').value='Unscoped ordinary request';
  h.node('chat-form').listeners.submit({preventDefault(){}});await assert.rejects(h.context.submitted,/Select at least one section/);assert.equal(h.calls.length,1);
});
