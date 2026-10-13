import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const html = readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const slice = (start,end) => source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const root = '/synthetic/repo';
const skill = (id,extra = {}) => ({id,name:id,path:root+'/'+id+'/SKILL.md',repo:root,scope:'repo',agent:'codex',type:'skill',description:'Check failing tests',...extra});
const peer = item => Object.fromEntries(['id','name','path','repo','scope','agent'].map(key=>[key,item[key]||'']));
const candidate = (item,extra = {}) => ({...peer(item),description:item.description.trim().slice(0,500),matchedTerms:['check','test'],overlaps:[],overlapIds:[],overlapCount:0,omittedOverlaps:0,unresolvedOverlap:false,...extra});
function response(body,items,candidates = [candidate(items[0])],extra = {}) {
  const eligible = items.filter(item=>item.type==='skill'&&[body.agent,'shared','model-gateway'].includes(item.agent)&&(!item.repo||body.repo&&item.repo===body.repo));
  const described = eligible.filter(item=>item.description?.trim()).length;
  return {...body,scannedAt:'2026-10-01T00:00:00.000Z',queryTerms:['check','test'],coverage:{eligible:eligible.length,described,missingDescriptions:eligible.length-described,matched:candidates.length,shown:candidates.length,notShown:0,scanPartial:false,truncatedDescriptions:eligible.filter(item=>(item.description?.trim().length||0)>500).length},candidates,...extra};
}

function harness({items = [skill('check-tests')],api,fileApi,clipboard} = {}) {
  const nodes = new Map(),calls = [],reads = [],actions = [],copies = [];
  let nextUUID=0;
  const make = (tag = 'div',className = '',textContent = '') => ({tag,className,textContent,children:[],value:'',hidden:false,disabled:false,open:false,checked:false,dataset:{},style:{},options:[],listeners:{},classList:{toggle(){}},append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},setAttribute(){},addEventListener(type,fn){this.listeners[type]=fn;},focus(){this.focused=true;},showModal(){this.open=true;},close(){this.open=false;},reset(){},querySelector(selector){return this.querySelectorAll(selector)[0]||null;},querySelectorAll(selector){const all=node=>node.children.flatMap(child=>[child,...all(child)]);return all(this).filter(node=>selector.split(',').includes(node.tag));}});
  const node = id => {if(!nodes.has(id)){const value=make();if(id==='improvement-plan')value.reset=()=>{for(const key of ['plan-title','change','benefit','rollback','variable'])node('improvement-'+key).value='';};nodes.set(id,value);}return nodes.get(id);};
  const sectionNodes = ['inventory','context','dashboard','delegation'].map(value=>({...make('input'),value}));
  node('chat-sections').querySelectorAll = selector => selector==='input:checked'?sectionNodes.filter(item=>item.checked):sectionNodes;
  node('improvement-plan').querySelectorAll = selector => [...['plan-title','change','benefit','rollback','variable','task-quality','plan-ask','add-task'].map(key=>node('improvement-'+key)),node('synthetic-plan-submit'),...node('improvement-tasks').querySelectorAll(selector)];
  node('chat-agent').options = [{value:'codex'},{value:'claude'}];node('chat-agent').value='claude';
  const context = vm.createContext({
    $:node,element:make,button:(label,className,fn)=>({...make('button',className,label),click:fn}),empty:(title,detail)=>make('div','empty',title+' '+detail),
    array:value=>Array.isArray(value)?value:[],number:String,date:String,time:String,agentName:String,repoName:String,
    state:{csrfToken:'synthetic',inventory:{scannedAt:'2026-10-01T00:00:00.000Z',coverage:{partial:false},items},agents:[{id:'codex',dispatch:'direct',auth:'signed-in'},{id:'claude',dispatch:'direct',auth:'signed-in'}],gaps:[],improvements:[]},
    activeRepo:root,selectedAgent:'codex',advanced:false,view:'inventory',loading:null,beginnerSelection:null,selectedIds:new Set(),pendingTaskScope:null,pendingLoadingScope:null,pendingImprovement:null,pendingPlan:null,pendingGap:null,activeChat:null,chatSnapshot:'',contextPreviewRequest:0,openedFrom:null,
    taskSkillsDraft:null,taskSkillsSequence:0,filteredInventory:()=>[],includedIds:()=>[],effectiveRoute:()=>({agent:'claude',model:''}),renderConversation(){},updateChatAvailability(){},planningChatBusy:()=>false,document:{activeElement:null,body:{style:{}}},setTimeout:fn=>fn(),
    improvementId:null,improvementScope:null,improvementBusy:false,improvementCorrection:null,improvementMetrics:{},renderImprovements(){},renderImprovementProgress(){},crypto:{randomUUID:()=> '00000000-0000-4000-8000-'+String(++nextUUID).padStart(12,'0')},improvementRunDraft:()=>({}),toast(){},
    codeEditor:null,fileBusy:false,openFile:null,reviewedContent:null,fileWasEdited:false,fileDraftSource:null,fileRequest:0,discardResolution:null,editorDirty:()=>false,updateFileEditor(){},configureFileEditorPresentation:()=>false,updateConfigurationEditorSelection(){},requestAnimationFrame:fn=>fn(),window:{},navigator:{clipboard:{writeText:async text=>{copies.push(text);if(clipboard)return clipboard(text);}}},
    action:(button,fn)=>{const promise=fn();actions.push(promise);return promise;},refresh:async()=>{},schedulePoll(){},
    api:async(path,body)=>{calls.push({path,body});if(path==='/api/file'){reads.push(body);return fileApi?fileApi(body,reads.length):{id:body.id,name:body.id,path:root+'/SKILL.md',content:'Protected skill body',editable:false,reason:'Protected source',language:'markdown'};}return api?api(body,calls.length,path):response(body,items);},
  });
  vm.runInContext(slice('function taskSkillSources(', 'function editorValue()')+slice('function chosenSections()', 'function updateChatAvailability()')+slice('function updateSelection()', 'function budgetMetric(')+slice('async function openEditor(', 'function reviewFile()'),context);
  vm.runInContext(slice('function addImprovementTask()', 'function updateImprovementPrompt()')+slice('async function improvementAction(', 'function navigate()'),context);
  vm.runInContext(source.split('\n').find(line=>line.startsWith("$('improvement-dialog').addEventListener('cancel'"))+source.split('\n').find(line=>line.startsWith("$('improvement-plan-ask').addEventListener"))+slice("$('improvement-plan').addEventListener('submit'", "$('improvement-run').addEventListener('submit'"),context);
  vm.runInContext(slice("$('improvement-suggestion-text').addEventListener", "$('improvement-plan').addEventListener('submit'"),context);
  vm.runInContext(slice("$('improvement-close').addEventListener", "$('reusable-close').addEventListener"),context);
  vm.runInContext(slice('function editorValue()', 'function confirmDiscard('),context);
  vm.runInContext(slice("$('task-skills-invocation').addEventListener", "$('setup-explain').addEventListener"),context);
  vm.runInContext(slice("$('task-skills-start').addEventListener", "$('task-skills-open').addEventListener"),context);
  vm.runInContext(slice('function updateStartGuide()', 'let initialDiscovery;'),context);
  vm.runInContext(slice("$('chat-form').addEventListener('submit'", "$('chat-cancel').addEventListener"),context);
  vm.runInContext(slice("$('reply-form').addEventListener('submit'", "$('handoff-copy').addEventListener"),context);
  const run = code=>vm.runInContext(code,context);
  const text = item=>[item.textContent,...item.children.map(text)].join(' ');
  const find = item=>item.tag==='button'&&item.textContent==='Review file'?item:item.children.map(find).find(Boolean);
  return {context,node,calls,reads,copies,run,text,find,invoke(value){node('task-skills-invocation').value=value;node('task-skills-invocation').listeners.input();},confirm(){node('task-skills-confirm').checked=true;node('task-skills-confirm').listeners.change();},send(){node('chat-form').listeners.submit({preventDefault(){}});return actions.at(-1);},reply(){node('reply-form').listeners.submit({preventDefault(){}});return actions.at(-1);},async search(task='Check failing project tests'){run('openTaskSkills()');node('task-skills-task').value=task;await run('findTaskSkills()');}};
}

test('task entry uses existing Start here and Skills & tools, with local and explicit sharing labels',()=>{
  assert.match(html,/id="task-skills-start"/);assert.match(html,/id="task-skills-open"/);
  assert.match(html,/Find matches locally/);assert.match(html,/Ask an agent about these matches/);
  assert.match(html,/required project instructions, security checks and tests/);
  assert.doesNotMatch(html.slice(html.indexOf('<nav'),html.indexOf('</nav>')),/task-skills/);
});

test('beginner hierarchy has one primary task entry outside setup before map, health and closed suggestions',()=>{
  const dashboard=html.slice(html.indexOf('id="beginner-dashboard"'),html.indexOf('id="improvement-panel"'));
  assert.equal((html.match(/id="task-skills-start"/g)||[]).length,1);const cue=dashboard.indexOf('id="beginner-task-cue"'),map=dashboard.indexOf('class="context-start-grid"'),health=dashboard.indexOf('id="beginner-health"'),suggestions=dashboard.indexOf('id="beginner-suggestions"');assert.ok(cue<map&&map<health&&health<suggestions);assert.match(dashboard.slice(0,cue),/<\/details>\s*<div $/);
  assert.match(dashboard,/Describe your next task\. Review local matches or proceed without an extra skill\./);assert.match(dashboard,/id="task-skills-start" class="button primary"[^>]*disabled/);assert.match(dashboard,/<details id="beginner-suggestions" class="panel" hidden><summary>Improvement suggestions<span id="beginner-suggestions-count"><\/span><\/summary><div id="beginner-improvements">/);assert.doesNotMatch(dashboard,/<details id="beginner-suggestions"[^>]*\bopen\b/);
  const css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');assert.match(html,/id="chat-open" class="button primary compact"/);assert.match(css,/body\[data-mode="beginner"\] #chat-open\{background:white/);assert.doesNotMatch(css,/body\[data-mode="advanced"\] #chat-open/);
});

test('workspace typography keeps every literal supporting size readable across responsive, editor and chat rules',()=>{
  const css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');for(const match of css.matchAll(/font-size:(\d+(?:\.\d+)?)px|font:(\d+)px\//g))assert.ok(Number(match[1]||match[2])>=14,match[0]);
  assert.match(css,/:root\{[^}]*font-family:[^;}]*sans-serif/);assert.match(css,/font-size:16px/);
  const heading=css.match(/^h1\{([^}]*)\}/m)[1],family=heading.match(/font-family:([^;]+)/)?.[1];assert.ok(!family||/inherit|sans-serif/.test(family),'Headings should share the readable sans-serif family');assert.match(heading,/font-size:clamp\(/);assert.match(heading,/line-height:1\./);
  assert.match(css,/\.panel-heading h2\{font-size:22px/);assert.match(css,/\.loading-band\{[^}]*border:0[^}]*border-top:1px solid var\(--line\)/);assert.match(css,/\.metric\{border:0;[^}]*background:transparent/);assert.match(css,/button:focus-visible[^}]*outline:2px solid/);
});

test('sidebar text and keyboard focus rings remain visible against sidebar and editor backgrounds',()=>{
  const css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8'),variables=new Map(Array.from(css.matchAll(/(--[\w-]+):([^;}]+)/g),match=>[match[1],match[2].trim()]));
  const resolve=value=>value.startsWith('var(')?variables.get(value.slice(4,-1)):value;
  const luminance=value=>{const hex=resolve(value);assert.match(hex,/^#[\da-f]{6}$/i);const channels=hex.slice(1).match(/../g).map(channel=>parseInt(channel,16)/255).map(channel=>channel<=.04045?channel/12.92:((channel+.055)/1.055)**2.4);return channels.reduce((sum,channel,index)=>sum+channel*[.2126,.7152,.0722][index],0);};
  const contrast=(foreground,background)=>{const values=[luminance(foreground),luminance(background)].sort((a,b)=>b-a);return(values[0]+.05)/(values[1]+.05);};
  const sidebar=css.match(/\.sidebar\{([^}]+)\}/)[1],sidebarBackground=sidebar.match(/background:([^;]+)/)[1],sidebarText=sidebar.match(/(?:^|;)color:([^;]+)/)[1];
  const sidebarFocus=css.match(/\.sidebar a:focus-visible,\.sidebar button:focus-visible\{outline-color:([^}]+)\}/)[1];
  const editorFocus=css.match(/#file-editor-host \.cm-focused\{outline:(\d+)px solid ([^;]+)/),editorBackground=css.match(/#file-editor-host \.cm-editor\{[^}]*background:([^;}]+)/)[1];
  assert.ok(contrast(sidebarText,sidebarBackground)>=4.5,'Sidebar text needs readable contrast');assert.ok(contrast(sidebarFocus,sidebarBackground)>=3,'Sidebar keyboard focus needs visible contrast');assert.ok(Number(editorFocus[1])>=2);assert.ok(contrast(editorFocus[2],editorBackground)>=3,'Editor keyboard focus needs visible contrast');
});

test('narrow headers keep repository and agent selection readable on separate full-width rows',()=>{
  const css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8'),start=css.indexOf('@media(max-width:600px){\n.setup-card'),end=css.indexOf('\n}',start),narrow=css.slice(start,end);assert.match(narrow,/\.scope-control,\.beginner-agent-control\{flex:0 0 100%;width:100%;margin-left:0;justify-content:space-between\}/);assert.match(narrow,/\.scope-control select,\.beginner-agent-control select\{flex:1;width:100%;max-width:none;font-size:16px\}/);assert.match(narrow,/\.topbar-actions\{width:100%;flex-wrap:wrap;justify-content:flex-start\}/);assert.doesNotMatch(narrow,/body\[data-mode=/);
});

test('the primary task entry stays disabled until discovery and only captures metadata when explicitly opened',async()=>{
  const h=harness(),inventory=h.context.state.inventory;delete h.context.state.inventory;h.run('updateStartGuide()');assert.equal(h.node('task-skills-start').disabled,true);h.node('task-skills-start').listeners.click();assert.equal(h.node('task-skills-dialog').open,false);assert.equal(h.calls.length,0);
  h.context.state.inventory={items:[]};h.run('updateStartGuide()');assert.equal(h.node('task-skills-start').disabled,true);h.context.state.inventory=inventory;h.run('updateStartGuide()');assert.equal(h.node('task-skills-start').disabled,false);assert.equal(h.calls.length,0);h.node('task-skills-start').listeners.click();assert.equal(h.node('task-skills-dialog').open,true);assert.equal(h.context.taskSkillsDraft.repo,root);assert.equal(h.context.taskSkillsDraft.agent,'codex');assert.equal(h.calls.length,0);
  await h.search();h.context.activeRepo='/synthetic/other';h.context.selectedAgent='claude';assert.equal(h.context.taskSkillsDraft.repo,root);assert.equal(h.context.taskSkillsDraft.agent,'codex');h.context.state=null;h.run('updateStartGuide()');assert.equal(h.node('task-skills-start').disabled,true);
});

test('Explain my files success scrolls to the task cue without opening import or task search',async()=>{
  const h=harness(),scrolls=[],preferences=[],focuses=[];h.context.discoverInitialFiles=async()=>{};h.context.refreshLoading=async()=>{h.context.loading={repo:root,agent:'codex'};};h.context.savePreference=(...args)=>preferences.push(args);h.node('beginner-task-cue').scrollIntoView=options=>scrolls.push(options);h.node('task-skills-start').focus=options=>focuses.push({...options});h.node('beginner-health').scrollIntoView=()=>{throw new Error('Must not focus health importer');};h.node('setup-guide').open=true;
  vm.runInContext(slice("$('setup-explain').addEventListener", "for (const id of ['loading-directory'"),h.context);h.node('setup-explain').listeners.click({currentTarget:h.node('setup-explain')});await new Promise(setImmediate);assert.equal(scrolls.length,1);assert.deepEqual(focuses,[{preventScroll:true}]);assert.equal(h.node('setup-guide').open,false);assert.deepEqual(preferences,[['harness-desk-guided','done']]);assert.equal(h.node('task-skills-dialog').open,false);assert.equal(h.node('usage-import').open,false);assert.equal(h.calls.length,0);
  h.node('task-skills-start').disabled=true;h.node('setup-explain').listeners.click({currentTarget:h.node('setup-explain')});await new Promise(setImmediate);assert.equal(focuses.length,1);
});

test('opening and matching read only metadata; review explicitly uses the protected existing editor',async()=>{
  const h=harness();h.run('openTaskSkills()');assert.equal(h.calls.length,0);
  await h.search();assert.equal(h.calls.length,1);assert.equal(h.calls[0].path,'/api/task-skills');
  assert.deepEqual({...h.calls[0].body},{repo:root,agent:'codex',task:'Check failing project tests'});
  const text=h.text(h.node('task-skills-results'));assert.match(text,/Matching words: check, test/);assert.match(text,/unverified/);
  h.find(h.node('task-skills-results')).click();await new Promise(setImmediate);
  assert.deepEqual(h.reads.map(body=>({...body})),[{id:'check-tests',action:'read'}]);
  assert.equal(h.context.openFile.editable,false);assert.equal(h.node('file-fallback').readOnly,true);
  assert.equal(h.node('task-skills-dialog').open,false);h.node('file-dialog').close();h.run('openTaskSkills()');
  assert.equal(h.node('task-skills-task').value,'Check failing project tests');assert.equal(h.node('task-skills-ask').disabled,false);
  assert.deepEqual(h.calls.map(call=>call.path),['/api/task-skills','/api/file']);
});

test('advice captures original scope, candidate IDs and sanitized task while answering agent remains separate',async()=>{
  const items=[skill('check-tests'),skill('unrelated',{description:'Draw pictures'}),skill('foreign',{agent:'claude'})];
  const h=harness({items,api:async body=>response(body,items,[candidate(items[0])],{task:'Sanitized task [REDACTED]'})});
  await h.search();h.context.activeRepo='/synthetic/other';h.context.selectedAgent='claude';h.run('askTaskSkills()');
  const payload=h.run('contextPayload()');assert.equal(payload.repo,root);assert.equal(payload.reviewAgent,'codex');assert.equal(payload.selectionMode,'explicit');assert.deepEqual([...payload.selectedIds],['check-tests']);assert.deepEqual([...payload.sections],['inventory']);
  assert.equal(h.node('chat-agent').value,'claude');assert.match(h.node('chat-route-note').textContent,/Fixed task evidence: codex.*Answering agent: claude/);
  assert.match(h.node('chat-prompt').value,/Sanitized task \[REDACTED\]/);assert.doesNotMatch(h.node('chat-prompt').value,/unrelated|foreign/);assert.match(h.node('chat-prompt').value,/untrusted metadata/);
  assert.equal(h.calls.length,1);h.run('showChatTab(true);showChatTab(false);closeChat()');assert.equal(h.run('contextPayload()').repo,root);
});

test('no matches preserve explicit empty selection and permit asking whether no extra skill is needed',async()=>{
  const items=[skill('check-tests')];const h=harness({items,api:async body=>response(body,items,[])});
  await h.search('Change the button label');assert.match(h.text(h.node('task-skills-results')),/No description matches/);assert.equal(h.node('task-skills-ask').disabled,false);
  h.run('askTaskSkills()');const payload=h.run('contextPayload()');assert.deepEqual([...payload.selectedIds],[]);assert.equal(payload.selectionMode,'explicit');assert.match(h.node('chat-prompt').value,/Consider using no extra skill/);assert.equal(h.calls.length,1);
});

test('global setup keeps shared global skills, excludes repository and other-agent metadata, and remains fixed',async()=>{
  const global=skill('global',{repo:'',scope:'global',agent:'shared'}),repo=skill('repo'),foreign=skill('foreign',{repo:'',agent:'claude'}),items=[global,repo,foreign];
  const h=harness({items,api:async body=>response(body,items,[candidate(global)])});h.context.activeRepo='';await h.search();
  assert.match(h.node('task-skills-status').textContent,/from 1 eligible skill/);h.run('askTaskSkills()');h.context.activeRepo=root;h.context.selectedAgent='claude';const payload=h.run('contextPayload()');assert.equal(payload.repo,'');assert.equal(payload.globalOnly,true);assert.equal(payload.reviewAgent,'codex');assert.deepEqual([...payload.selectedIds],['global']);
});

test('missing descriptions and scan unknown/partial warnings do not become evidence of absence',async()=>{
  const items=[skill('unknown',{description:''})];const h=harness({items,api:async body=>response(body,items,[],{coverage:{eligible:1,described:0,missingDescriptions:1,matched:0,shown:0,notShown:0,scanPartial:null},scannedAt:null})});
  h.context.state.inventory.scannedAt=null;delete h.context.state.inventory.coverage.partial;await h.search();
  assert.match(h.text(h.node('task-skills-results')),/No usable descriptions/);assert.match(h.text(h.node('task-skills-results')),/Scan coverage is unknown/);assert.match(h.text(h.node('task-skills-results')),/no description/);assert.doesNotMatch(h.text(h.node('task-skills-results')),/No description matches/);
  const partial=harness({api:async body=>response(body,[skill('check-tests')],undefined,{coverage:{eligible:1,described:1,missingDescriptions:0,matched:1,shown:1,notShown:0,scanPartial:true}})});partial.context.state.inventory.coverage.partial=true;await partial.search();assert.match(partial.text(partial.node('task-skills-results')),/Scan is partial/);
});

test('overlap details display bounded identities and honest omission counts',async()=>{
  const items=[skill('check-tests'),...Array.from({length:8},(_,i)=>skill('peer-'+i,{repo:'',scope:'global',name:'check-tests'}))];
  const c=candidate(items[0],{overlaps:items.slice(1,6).map(peer),overlapIds:items.slice(1,6).map(item=>item.id),overlapCount:8,omittedOverlaps:3,unresolvedOverlap:true});
  const h=harness({items,api:async body=>response(body,items,[c])});await h.search();const text=h.text(h.node('task-skills-results'));assert.match(text,/8 other files may overlap/);assert.match(text,/3 other overlapping files are omitted/);assert.match(text,/peer-4\/SKILL.md/);assert.doesNotMatch(text,/peer-5\/SKILL.md/);assert.match(text,/Another copy could not be identified/);
});

test('close, task edits and a newer search reject stale responses without fabricating zero matches',async()=>{
  const releases=[];const h=harness({api:body=>new Promise(resolve=>releases.push(()=>resolve(response(body,[skill('check-tests')]))))});
  h.run('openTaskSkills()');h.node('task-skills-task').value='First task';const first=h.run('findTaskSkills()');assert.equal(h.node('task-skills-task').disabled,true);assert.equal(h.node('task-skills-find').disabled,true);
  h.run('closeTaskSkills();openTaskSkills()');h.node('task-skills-task').value='Second task';h.run('changeTaskSkillsTask()');const second=h.run('findTaskSkills()');releases[1]();await second;releases[0]();await first;
  assert.equal(h.context.taskSkillsDraft.result.task,'Second task');assert.equal(h.node('task-skills-task').value,'Second task');
  h.node('task-skills-task').value='Third task';h.run('changeTaskSkillsTask()');assert.equal(h.node('task-skills-ask').disabled,true);assert.equal(h.context.taskSkillsDraft.result,null);assert.doesNotMatch(h.node('task-skills-status').textContent,/0 description matches/);
});

test('scope changes and source races reject pending results; reopening another scope invalidates old matches',async()=>{
  let release;const h=harness({api:body=>new Promise(resolve=>{release=()=>resolve(response(body,[skill('check-tests')]));})});
  h.run('openTaskSkills()');h.node('task-skills-task').value='Check tests';let request=h.run('findTaskSkills()');h.context.activeRepo='/synthetic/other';h.run('invalidateTaskSkillsSearch()');h.context.activeRepo=root;release();await request;assert.equal(h.context.taskSkillsDraft.result,null);assert.match(h.node('task-skills-error').textContent,/scope changed/);
  request=h.run('findTaskSkills()');h.context.state.inventory.items[0].description='Different evidence';release();await request;assert.equal(h.context.taskSkillsDraft.result,null);assert.match(h.node('task-skills-error').textContent,/current scan/);
  h.context.activeRepo='/synthetic/other';h.run('openTaskSkills()');assert.equal(h.context.taskSkillsDraft.repo,'/synthetic/other');assert.equal(h.node('task-skills-task').value,'Check tests');assert.match(h.node('task-skills-status').textContent,/Previous matches were cleared/);
});

test('API errors preserve task and allow retry; completed results become unavailable after rescan',async()=>{
  let fail=true;const items=[skill('check-tests')];const h=harness({items,api:async body=>{if(fail)throw new Error('Permission denied');return response(body,items);}});await h.search();assert.match(h.node('task-skills-error').textContent,/Permission denied/);assert.equal(h.node('task-skills-task').value,'Check failing project tests');assert.equal(h.node('task-skills-find').disabled,false);assert.equal(h.node('task-skills-ask').disabled,true);assert.doesNotMatch(h.node('task-skills-status').textContent,/0 description matches/);
  fail=false;await h.run('findTaskSkills()');h.context.state.inventory.scannedAt='2026-10-02T00:00:00.000Z';h.run('renderTaskSkills();reviewTaskSkill("check-tests");askTaskSkills()');assert.equal(h.calls.length,2);assert.equal(h.node('task-skills-ask').disabled,true);assert.match(h.node('task-skills-error').textContent,/no longer match/);
});

test('malformed, foreign, wrong-agent, count and overlap responses are unavailable, never no matches',async()=>{
  for(const mutate of [r=>({...r,candidates:null}),r=>({...r,agent:'claude'}),r=>({...r,repo:'/synthetic/foreign'}),r=>({...r,coverage:{...r.coverage,matched:0}}),r=>({...r,coverage:{...r.coverage,scanPartial:true}}),r=>({...r,candidates:[...r.candidates,...r.candidates]}),r=>({...r,candidates:[{...r.candidates[0],path:'/synthetic/foreign/SKILL.md'}]}),r=>({...r,candidates:[{...r.candidates[0],overlaps:[{...peer(skill('foreign'))}],overlapIds:['foreign'],overlapCount:1,omittedOverlaps:0}]})]) {
    const items=[skill('check-tests')],h=harness({items,api:async body=>mutate(response(body,items))});await h.search();assert.equal(h.context.taskSkillsDraft.result,null);assert.equal(h.node('task-skills-ask').disabled,true);assert.match(h.node('task-skills-error').textContent,/unavailable/);assert.doesNotMatch(h.text(h.node('task-skills-results')),/No description matches/);
  }
});

test('unsent task advice cannot preview or send changed sources; ordinary chats, history and new chat clear binding',async()=>{
  const h=harness();await h.search();h.run('askTaskSkills()');h.context.state.inventory.items[0].description='Changed source';assert.throws(()=>h.run('contextPayload()'),/Task evidence changed/);
  h.run('openChat(["inventory"],"Ordinary request")');assert.equal(h.context.pendingTaskScope,null);
  h.context.state.inventory.items[0].description='Check failing tests';await h.search();h.run('askTaskSkills();newChat()');assert.equal(h.context.pendingTaskScope,null);
  await h.search();h.run('askTaskSkills();openChat(null,undefined,{id:"history",repo:"/synthetic/history",sections:[],selectedIds:[],agent:"claude"})');assert.equal(h.context.pendingTaskScope,null);assert.equal(h.run('contextPayload()').repo,'/synthetic/history');
});

test('advice bounds untrusted fields and does not carry arbitrary response properties',async()=>{
  const items=[skill('check-tests',{description:'Check tests '+ '\u0000'.repeat(490),name:'\u0000'.repeat(2000),path:'\u0000'.repeat(2000)})];const h=harness({items,api:async body=>response(body,items,[candidate(items[0])],{coverage:{eligible:1,described:1,missingDescriptions:0,matched:1,shown:1,notShown:0,scanPartial:false,unexpected:'DO NOT SHARE'.repeat(2000)}})});await h.search('x'.repeat(2000));h.run('askTaskSkills()');assert.ok(h.node('chat-prompt').value.length<12000);assert.doesNotMatch(h.node('chat-prompt').value,/DO NOT SHARE/);assert.equal(h.calls.length,1);
});

test('complete advisory JSON stays valid and below the provider prompt limit under worst escaping',async()=>{
  const hostile = '\\"\u0000'.repeat(2000),items=Array.from({length:9},(_,i)=>skill('candidate-'+i,{name:hostile,path:hostile,description:'Check tests '+hostile}));
  const rows=items.slice(0,3).map(item=>candidate(item,{matchedTerms:['check','test'],overlaps:items.filter(other=>other!==item).slice(0,5).map(peer),overlapIds:items.filter(other=>other!==item).slice(0,5).map(other=>other.id),overlapCount:8,omittedOverlaps:3}));
  const h=harness({items,api:async body=>response(body,items,rows)});await h.search('x'.repeat(2000));h.run('askTaskSkills()');const prompt=h.node('chat-prompt').value;assert.ok(prompt.length<=12000);assert.match(prompt,/control characters replaced by spaces/);
  const json=JSON.parse(prompt.slice(prompt.indexOf('\n{')+1));assert.equal(json.candidates.length,3);assert.equal(json.candidates[0].overlappingSources.length,3);assert.equal(json.candidates[0].omittedOverlaps,5);assert.ok(json.candidates[0].descriptionExcerpt.length<=300);
});

test('the actual Send handler never replaces a newer task draft or chosen saved conversation',async()=>{
  for(const next of ['task','history','edit']) {
    let release;const items=[skill('check-tests')];const h=harness({items,api:async(body,index,path)=>path==='/api/chat'?new Promise(resolve=>{release=()=>resolve({id:'old-result',repo:root,reviewAgent:'codex',agent:'claude',selectedIds:['check-tests'],sections:['inventory'],status:'complete'});}):response(body,items)});
    await h.search();h.run('askTaskSkills()');const sending=h.send();assert.equal(h.calls.at(-1).path,'/api/chat');
    if(next==='task') {h.run('newChat();openTaskSkills()');h.node('task-skills-task').value='A newer task';h.run('changeTaskSkillsTask()');await h.run('findTaskSkills()');h.run('askTaskSkills()');}
    else if(next==='history') h.run('openChat(null,undefined,{id:"chosen-history",repo:"/synthetic/history",sections:["inventory"],selectedIds:[],agent:"claude"})');
    else h.node('chat-prompt').value='A new editable request';
    const prompt=h.node('chat-prompt').value,scope=h.context.pendingTaskScope;release();await sending;
    assert.equal(h.node('chat-prompt').value,prompt);assert.equal(h.context.pendingTaskScope,scope);assert.equal(h.context.activeChat?.id,next==='history'?'chosen-history':undefined);assert.equal(h.calls.filter(call=>call.path==='/api/chat').length,1);
  }
});

test('successful Send adopts its matching task conversation and clears the unsent task binding',async()=>{
  const items=[skill('check-tests')];const h=harness({items,api:async(body,index,path)=>path==='/api/chat'?{id:'matching-result',repo:root,reviewAgent:'codex',agent:'claude',selectedIds:['check-tests'],sections:['inventory'],status:'complete'}:response(body,items)});await h.search();h.run('askTaskSkills()');await h.send();assert.equal(h.context.pendingTaskScope,null);assert.equal(h.context.activeChat.id,'matching-result');assert.equal(h.node('chat-prompt').value,'');
});

test('saving a manual handoff reply cannot replace a newer task draft or saved conversation',async()=>{
  for(const next of ['task','history']) {
    let release;const items=[skill('check-tests')];const h=harness({items,api:async(body,index,path)=>path==='/api/reply'?new Promise(resolve=>{release=()=>resolve({id:'handoff',repo:root,agent:'claude',sections:['inventory'],selectedIds:['check-tests'],status:'complete'});}):response(body,items)});
    h.context.activeChat={id:'handoff',status:'handoff',repo:root,agent:'claude',sections:['inventory'],selectedIds:['check-tests']};h.node('reply-content').value='Old response';const replying=h.reply();
    if(next==='task'){h.run('newChat()');await h.search('New task');h.run('askTaskSkills()');}
    else h.run('openChat(null,undefined,{id:"chosen-history",repo:"/synthetic/history",sections:["inventory"],selectedIds:[],agent:"claude"})');
    const prompt=h.node('chat-prompt').value,scope=h.context.pendingTaskScope;release();await replying;assert.equal(h.node('chat-prompt').value,prompt);assert.equal(h.context.pendingTaskScope,scope);assert.equal(h.context.activeChat?.id,next==='history'?'chosen-history':undefined);
  }
});

const readableSkill = (item,extra={}) => ({id:item.id,name:'Frontmatter name differs',path:item.path,type:'skill',repo:item.repo || '',content:'Never copy this source body',version:'a'.repeat(64),editable:true,language:'markdown',...extra});
async function reviewPreparation(h,id='check-tests',invocation='$host-selected') {
  h.run('prepareTaskSkill('+JSON.stringify(id)+')');h.invoke(invocation);
  await h.node('task-skills-prepare-review').listeners.click();
  h.node('file-dialog').close();h.run('openTaskSkills()');
}

test('manual preparation performs no implicit reads or dispatch and preserves invocation through real editor review',async()=>{
  const item=skill('check-tests',{name:'Never infer invocation'}),h=harness({items:[item],fileApi:async()=>readableSkill(item),api:async body=>response(body,[item],undefined,{task:'Sanitized task [REDACTED]'})});
  await h.search();const prepare=h.node('task-skills-results').children.flatMap(card=>card.children).find(node=>node.textContent==='Prepare task prompt');prepare.click();
  assert.equal(h.calls.length,1);assert.equal(h.context.taskSkillsDraft.preparation.invocation,'');assert.equal(h.copies.length,0);assert.equal(h.node('task-skills-confirm').disabled,true);
  h.invoke('$host-selected');assert.equal(h.node('task-skills-prepare-copy').disabled,true);await h.node('task-skills-prepare-review').listeners.click();
  assert.equal(h.context.openFile.path,item.path);assert.equal(h.context.taskSkillsDraft.preparation.review.version,'a'.repeat(64));assert.equal(h.node('task-skills-dialog').open,false);
  h.node('file-dialog').close();h.run('openTaskSkills()');assert.equal(h.node('task-skills-invocation').value,'$host-selected');h.confirm();await h.node('task-skills-prepare-copy').listeners.click();
  assert.deepEqual(h.calls.map(call=>call.path),['/api/task-skills','/api/file','/api/file']);assert.equal(h.copies.length,1);assert.match(h.copies[0],/^\$host-selected\n/);assert.doesNotMatch(h.copies[0],/Never infer invocation|Never copy this source body/);
  const metadata=JSON.parse(h.copies[0].slice(h.copies[0].indexOf('\n{')+1));assert.equal(metadata.task,'Sanitized task [REDACTED]');assert.equal(metadata.agent,'codex');assert.equal(metadata.repo,root);assert.equal(metadata.source.path,item.path);assert.match(h.copies[0],/required project instructions, security checks and tests/);assert.match(h.node('task-skills-prepare-status').textContent,/invocation remains unverified/);
});

test('Claude and Codex use only manually entered host prefixes with strict single-line grammar',async()=>{
  for(const agent of ['claude','codex']){
    const item=skill('check-tests',{agent}),h=harness({items:[item],fileApi:async()=>readableSkill(item)});h.context.selectedAgent=agent;await h.search();await reviewPreparation(h,item.id,agent==='claude'?'/team:check-tests':'$team:check-tests');h.confirm();
    assert.equal(h.node('task-skills-prepare-copy').disabled,false);assert.match(h.node('task-skills-prepare-guide').textContent,agent==='claude'?/Claude Code.*\/skills.*\/name/:/Codex CLI or IDE.*\/skills.*picker/);
    for(const invocation of ['',agent==='claude'?'$wrong':'/wrong','/name argument','$name;rm','/name\nnext','`/name`','/../name','$name$(x)','/name_underscore','/a:b:c',' /name','/name ', '$'+'a'.repeat(100)]){h.invoke(invocation);assert.equal(h.node('task-skills-prepare-copy').disabled,true,invocation);await h.run('copyTaskPreparation()');}
    assert.equal(h.reads.length,1);assert.equal(h.copies.length,0);
  }
});

test('unsupported agents keep advice available and explicit no-extra choice works for every agent and with matches',async()=>{
  for(const agent of ['claude','codex','other']){
    const item=skill('check-tests',{agent}),h=harness({items:[item]});h.context.selectedAgent=agent;await h.search();h.run('prepareTaskSkill("check-tests")');
    if(agent==='other'){assert.match(h.node('task-skills-prepare-guide').textContent,/unavailable.*Ask an agent/);assert.equal(h.node('task-skills-prepare-copy').disabled,true);await h.run('reviewTaskPreparation()');}
    const choice=h.node('task-skills-results').children.find(node=>node.textContent==='Prepare without an extra skill');choice.click();assert.equal(h.node('task-skills-prepare-copy').disabled,false);await h.node('task-skills-prepare-copy').listeners.click();
    assert.equal(h.reads.length,0);assert.equal(h.copies.length,1);assert.match(h.copies[0],/explicitly chose.*without an extra skill/);assert.match(h.copies[0],/does not prove/);assert.equal(JSON.parse(h.copies[0].slice(h.copies[0].indexOf('\n{')+1)).source,null);assert.equal(h.calls.length,1);
  }
});

test('no matches alone do not select the no-extra path',async()=>{
  const item=skill('check-tests'),h=harness({items:[item],api:async body=>response(body,[item],[])});await h.search('Change a button label');assert.equal(h.context.taskSkillsDraft.preparation,null);await h.run('copyTaskPreparation()');assert.equal(h.copies.length,0);h.run('prepareTaskSkill(null)');await h.run('copyTaskPreparation()');assert.equal(h.copies.length,1);
});

test('protected and mismatched initial source reviews cannot enable host confirmation',async()=>{
  const item=skill('check-tests');
  for(const extra of [{editable:false,content:'[Protected file contents withheld]'}, {id:'foreign'}, {path:'/synthetic/foreign/SKILL.md'}, {type:'instruction'}, {repo:'/synthetic/foreign'}, {version:'bad'}]){
    const h=harness({items:[item],fileApi:async()=>readableSkill(item,extra)});await h.search();await reviewPreparation(h);assert.equal(h.context.taskSkillsDraft.preparation.review,null);assert.equal(h.node('task-skills-confirm').disabled,true);assert.equal(h.node('task-skills-invocation').value,'$host-selected');assert.match(h.node('task-skills-prepare-error').textContent,/unavailable, protected, changed/);await h.run('copyTaskPreparation()');assert.equal(h.copies.length,0);
  }
});

test('copy rereads identity and version; failures clear confirmation and preserve the invocation draft',async()=>{
  const item=skill('check-tests');
  for(const replacement of [{version:'b'.repeat(64)},{editable:false},{id:'other'},{path:'/synthetic/other/SKILL.md'},{type:'instruction'},{repo:''},new Error('Read failed')]){
    const h=harness({items:[item],fileApi:async(body,index)=>{if(index===2&&replacement instanceof Error)throw replacement;return readableSkill(item,index===2?replacement:{});}});await h.search();await reviewPreparation(h);h.confirm();await h.node('task-skills-prepare-copy').listeners.click();
    assert.equal(h.copies.length,0);assert.equal(h.context.taskSkillsDraft.preparation.review,null);assert.equal(h.context.taskSkillsDraft.preparation.confirmed,false);assert.equal(h.node('task-skills-invocation').value,'$host-selected');assert.match(h.node('task-skills-prepare-error').textContent,/Source check failed/);
  }
});

test('dirty editing in the real editor clears review and confirmation without losing invocation',async()=>{
  const item=skill('check-tests'),h=harness({items:[item],fileApi:async()=>readableSkill(item)});await h.search();await reviewPreparation(h);h.confirm();h.node('file-fallback').value='Unsaved editing';h.context.fileWasEdited=true;h.run('updateFileEditor()');assert.equal(h.context.taskSkillsDraft.preparation.review,null);assert.equal(h.context.taskSkillsDraft.preparation.confirmed,false);assert.equal(h.node('task-skills-invocation').value,'$host-selected');assert.match(h.node('task-skills-prepare-error').textContent,/unsaved draft/);await h.run('copyTaskPreparation()');assert.equal(h.copies.length,0);
});

test('changing the invocation after host confirmation requires a fresh acknowledgement',async()=>{
  const item=skill('check-tests'),h=harness({items:[item],fileApi:async()=>readableSkill(item)});await h.search();await reviewPreparation(h,item.id,'$source-a');h.confirm();const review=h.context.taskSkillsDraft.preparation.review;assert.equal(h.node('task-skills-prepare-copy').disabled,false);
  h.invoke('$source-b');assert.equal(h.node('task-skills-confirm').checked,false);assert.equal(h.context.taskSkillsDraft.preparation.confirmed,false);assert.equal(h.context.taskSkillsDraft.preparation.review,review);assert.equal(h.node('task-skills-prepare-copy').disabled,true);await h.run('copyTaskPreparation()');assert.equal(h.copies.length,0);assert.equal(h.reads.length,1);
  h.confirm();assert.equal(h.node('task-skills-prepare-copy').disabled,false);await h.run('copyTaskPreparation()');assert.match(h.copies[0],/^\$source-b\n/);h.node('task-skills-confirm').checked=false;h.node('task-skills-confirm').listeners.change();assert.equal(h.node('task-skills-prepare-copy').disabled,true);
});

test('an older cancelled clipboard completion cannot unfreeze a newer copy operation',async()=>{
  const releases=[],h=harness({clipboard:()=>new Promise(resolve=>releases.push(resolve))});await h.search();h.run('prepareTaskSkill(null)');const first=h.node('task-skills-prepare-copy').listeners.click();await new Promise(setImmediate);h.run('closeTaskSkills();openTaskSkills()');const second=h.node('task-skills-prepare-copy').listeners.click();await new Promise(setImmediate);assert.equal(h.context.taskSkillsDraft.preparation.busy,true);releases[0]();await first;assert.equal(h.context.taskSkillsDraft.preparation.busy,true);assert.equal(h.node('task-skills-prepare-copy').disabled,true);releases[1]();await second;assert.equal(h.context.taskSkillsDraft.preparation.busy,false);assert.match(h.node('task-skills-prepare-status').textContent,/Task prompt copied/);
});

test('pending source checks reject task, scope, scan and close races without copying',async()=>{
  for(const change of ['task','scope','scan','close']){
    const item=skill('check-tests');let release;const h=harness({items:[item],fileApi:(body,index)=>index===2?new Promise(resolve=>{release=()=>resolve(readableSkill(item));}):Promise.resolve(readableSkill(item))});await h.search();await reviewPreparation(h);h.confirm();const pending=h.node('task-skills-prepare-copy').listeners.click();assert.equal(h.node('task-skills-task').disabled,true);assert.equal(h.node('task-skills-invocation').disabled,true);
    if(change==='task'){h.node('task-skills-task').value='New task';h.run('changeTaskSkillsTask()');}
    if(change==='scope'){h.context.activeRepo='/synthetic/other';h.run('invalidateTaskSkillsSearch();openTaskSkills()');}
    if(change==='scan'){h.context.state.inventory.scannedAt='New scan';h.run('renderTaskSkills()');}
    if(change==='close')h.run('closeTaskSkills();openTaskSkills()');
    release();await pending;assert.equal(h.copies.length,0);assert.doesNotMatch(h.node('task-skills-prepare-status').textContent,/Task prompt copied/);if(change!=='close')assert.ok(h.context.taskSkillsDraft.preparation==null);
  }
});

test('initial review response cannot attach to a changed task or source',async()=>{
  for(const change of ['task','source']){
    const item=skill('check-tests');let release;const h=harness({items:[item],fileApi:()=>new Promise(resolve=>{release=()=>resolve(readableSkill(item));})});await h.search();h.run('prepareTaskSkill("check-tests")');h.invoke('$host-selected');const pending=h.node('task-skills-prepare-review').listeners.click();
    if(change==='task'){h.node('task-skills-task').value='Changed task';h.run('changeTaskSkillsTask()');}else{h.context.state.inventory.items[0].contentHash='changed';h.run('renderTaskSkills()');}release();await pending;assert.equal(h.context.taskSkillsDraft.preparation,null);assert.equal(h.copies.length,0);
  }
});

test('clipboard failures preserve preparation and delayed completion cannot overwrite a newer draft',async()=>{
  const item=skill('check-tests');let fail=true;const h=harness({items:[item],fileApi:async()=>readableSkill(item),clipboard:async()=>{if(fail)throw new Error('Clipboard denied');}});await h.search();await reviewPreparation(h);h.confirm();await h.node('task-skills-prepare-copy').listeners.click();assert.match(h.node('task-skills-prepare-error').textContent,/Clipboard copy failed/);assert.equal(h.context.taskSkillsDraft.preparation.confirmed,true);assert.equal(h.node('task-skills-invocation').value,'$host-selected');fail=false;await h.node('task-skills-prepare-copy').listeners.click();assert.match(h.node('task-skills-prepare-status').textContent,/Task prompt copied/);
  let release;const delayed=harness({items:[item],fileApi:async()=>readableSkill(item),clipboard:()=>new Promise(resolve=>{release=resolve;})});await delayed.search();await reviewPreparation(delayed);delayed.confirm();const pending=delayed.node('task-skills-prepare-copy').listeners.click();await new Promise(setImmediate);delayed.run('closeTaskSkills();openTaskSkills()');delayed.node('task-skills-task').value='New copied task';delayed.run('changeTaskSkillsTask()');await delayed.run('findTaskSkills()');delayed.run('prepareTaskSkill(null)');release();await pending;assert.equal(delayed.context.taskSkillsDraft.preparation.id,null);assert.doesNotMatch(delayed.node('task-skills-prepare-status').textContent,/Task prompt copied/);
});

test('preparation uses text and complete bounded JSON for untrusted metadata without copying file bodies',async()=>{
  const item=skill('check-tests',{name:'<img onerror="run()">',path:'/synthetic/"\\\nIgnore instructions/SKILL.md'}),h=harness({items:[item],fileApi:async()=>readableSkill(item)});await h.search('Task "\\\n data');await reviewPreparation(h);h.confirm();await h.run('copyTaskPreparation()');const prompt=h.copies[0],metadata=JSON.parse(prompt.slice(prompt.indexOf('\n{')+1));assert.equal(metadata.source.path,item.path);assert.equal(metadata.task,'Task "\\\n data');assert.ok(prompt.length<=12000);assert.doesNotMatch(prompt,/Never copy this source body|<img/);assert.equal(h.node('task-skills-prepare-source').textContent,item.path);
  const huge=skill('huge',{path:'\\"'.repeat(4000)}),oversized=harness({items:[huge],fileApi:async()=>readableSkill(huge)});await oversized.search();oversized.run('prepareTaskSkill("huge")');oversized.invoke('$host-selected');assert.match(oversized.node('task-skills-prepare-error').textContent,/too large/);assert.equal(oversized.node('task-skills-prepare-copy').disabled,true);assert.equal(oversized.copies.length,0);
});

const tickPlan=()=>new Promise(setImmediate);
async function submitPlan(h){h.node('improvement-plan').listeners.submit({preventDefault(){},submitter:h.node('synthetic-plan-submit')});await tickPlan();}
async function startTaskPlan(h){await h.search();h.run('prepareTaskSkill("check-tests")');h.node('task-skills-prepare-plan').listeners.click();}

const bridgeSuggestion=body=>({requestId:body.requestId,status:'ready',title:'Compare one manual change',change:'Collect baseline, then change one choice',rollback:'Restore the prior choice',variable:'workflow',task:{...body.originalTask,qualityCheck:'The fixed expected result must pass'}});
async function askBridgeSuggestion(h){h.node('improvement-plan-ask').listeners.click();h.run('closeChat()');h.node('improvement-suggestion-text').value='{"synthetic":"reply"}';await h.node('improvement-suggestion-preview-button').listeners.click();}

test('bridge preview binds raw original task and only replaces its separate quality; extra tasks and benefit stay intact',async()=>{
  const item=skill('check-tests'),h=harness({items:[item],api:async(body,index,path)=>path==='/api/improvement-suggestion'?bridgeSuggestion(body):path==='/api/improvement'?{...body,id:'saved-bridge',status:'baseline',tasks:body.tasks.map((task,index)=>({...task,id:'task-'+index}))}:response(body,[item])});await startTaskPlan(h);
  const first=h.node('improvement-tasks').children[0];first.querySelector('input').value='  Original label  ';first.querySelector('textarea').value='  Exact raw task\nDo not invoke anything.  ';h.node('improvement-task-quality').value='Old separate quality';h.node('improvement-benefit').value='My own expectation';h.run('addImprovementTask()');const second=h.node('improvement-tasks').children[1];second.querySelector('input').value='Second task';second.querySelector('textarea').value='Keep exact extra prompt';await askBridgeSuggestion(h);
  const body=h.calls.find(call=>call.path==='/api/improvement-suggestion').body;assert.equal(body.originalTask.label,'  Original label  ');assert.equal(body.originalTask.prompt,'  Exact raw task\nDo not invoke anything.  ');assert.equal('fixedVariable' in body,false);assert.doesNotMatch(body.originalTask.prompt,/Old separate quality/);assert.equal(body.agent,'codex');assert.equal(body.repo,root);assert.equal(body.expectedInventoryScan,'2026-10-01T00:00:00.000Z');assert.equal(h.reads.length,0);assert.equal(h.copies.length,0);
  const preview=JSON.parse(h.node('improvement-suggestion-after').textContent);assert.equal(preview.firstTask.prompt,body.originalTask.prompt);assert.equal(preview.qualityCheck,'The fixed expected result must pass');h.node('improvement-suggestion-use').listeners.click();assert.equal(first.querySelector('textarea').value,body.originalTask.prompt);assert.equal(first.querySelector('input').value,body.originalTask.label);assert.equal(h.node('improvement-task-quality').value,preview.qualityCheck);assert.equal(h.node('improvement-benefit').value,'My own expectation');assert.equal(h.node('improvement-tasks').children[1],second);assert.equal(second.querySelector('textarea').value,'Keep exact extra prompt');assert.equal(h.context.improvementId,null);
  await submitPlan(h);const create=h.calls.find(call=>call.path==='/api/improvement').body;assert.equal(create.tasks[0].prompt,body.originalTask.prompt.trim()+'\n\nQuality check:\n'+preview.qualityCheck);assert.equal((create.tasks[0].prompt.match(/Quality check:/g)||[]).length,1);assert.equal(create.tasks[1].prompt,'Keep exact extra prompt');assert.equal(create.expectedInventoryScan,body.expectedInventoryScan);
});

test('bridge rejects changed original reply text and keeps its quality and preparation draft',async()=>{
  const item=skill('check-tests'),h=harness({items:[item],api:async(body,index,path)=>path==='/api/improvement-suggestion'?{...bridgeSuggestion(body),task:{...body.originalTask,prompt:body.originalTask.prompt+' rewritten',qualityCheck:'Suggestion'}}:response(body,[item])});await startTaskPlan(h);h.node('improvement-task-quality').value='My quality';const draft=h.context.taskSkillsDraft;await askBridgeSuggestion(h);assert.match(h.node('improvement-suggestion-status').textContent,/malformed|another request/);assert.equal(h.node('improvement-suggestion-use').disabled,true);assert.equal(h.node('improvement-task-quality').value,'My quality');assert.equal(h.context.taskSkillsDraft,draft);assert.equal(h.node('improvement-tasks').children[0].querySelector('textarea').value,'Check failing project tests');assert.equal(h.calls.length,2);
});

test('bridge quality edits or a changed original source reject delayed suggestions without replacing kept fields',async()=>{
  for(const mutation of ['quality','source']){const item=skill('check-tests');let release;const h=harness({items:[item],api:async(body,index,path)=>path==='/api/improvement-suggestion'?new Promise(resolve=>{release=()=>resolve(bridgeSuggestion(body));}):response(body,[item])});await startTaskPlan(h);h.node('improvement-task-quality').value='Original quality';h.node('improvement-plan-ask').listeners.click();h.run('closeChat()');h.node('improvement-suggestion-text').value='Reply';const pending=h.node('improvement-suggestion-preview-button').listeners.click();if(mutation==='quality')h.node('improvement-task-quality').value='New quality';else item.contentHash='b'.repeat(64);release();await pending;assert.equal(h.node('improvement-suggestion-preview').hidden,true);assert.match(h.node('improvement-suggestion-status').textContent,/changed while previewing/);assert.equal(h.node('improvement-task-quality').value,mutation==='quality'?'New quality':'Original quality');assert.equal(h.reads.length,0);assert.equal(h.copies.length,0);}
});

test('selected candidate bridges into the real comparison planner before review or host confirmation',async()=>{
  const h=harness();await startTaskPlan(h);assert.equal(h.node('improvement-dialog').open,true);assert.equal(h.node('task-skills-dialog').open,false);assert.equal(h.context.taskSkillsDraft.preparation.review,null);assert.equal(h.context.taskSkillsDraft.preparation.confirmed,false);assert.equal(h.node('improvement-variable').value,'workflow');assert.equal(h.node('improvement-benefit').value,'');assert.equal(h.node('improvement-rollback').value,'');assert.match(h.node('improvement-change').value,/baseline.*manually.*invoke.*same fixed task/);assert.match(h.node('improvement-change').value,/unverified/);assert.equal(h.context.improvementScope.repo,root);assert.equal(h.context.improvementScope.agent,'codex');assert.deepEqual([...h.context.improvementScope.assetIds],['check-tests']);assert.match(h.text(h.node('improvement-selected-files')),/metadata is not live.*check-tests\/SKILL.md/s);
  assert.equal(h.node('improvement-tasks').children[0].querySelector('textarea').value,'Check failing project tests');assert.equal(h.node('improvement-task-quality').required,true);assert.equal(h.calls.length,1);assert.equal(h.reads.length,0);assert.equal(h.copies.length,0);
});

test('bridge handles global and shared sources plus unsupported hosts without inventing invocation or extra selections',async()=>{
  for(const [agent,scope,sourceAgent]of [['claude','','shared'],['codex',root,'shared'],['other',root,'other']]){
    const item=skill('check-tests',{agent:sourceAgent,repo:scope,scope:scope?'repo':'global'}),h=harness({items:[item]});h.context.selectedAgent=agent;h.context.activeRepo=scope;await startTaskPlan(h);assert.equal(h.context.improvementScope.agent,agent);assert.equal(h.context.improvementScope.repo,scope);assert.deepEqual([...h.context.improvementScope.assetIds],['check-tests']);assert.equal(h.calls.length,1);assert.doesNotMatch(h.node('improvement-change').value,/\$check-tests|\/check-tests/);assert.equal(h.node('improvement-tasks').children[0].querySelector('textarea').value,'Check failing project tests');h.node('improvement-task-back').listeners.click();assert.equal(h.context.taskSkillsDraft.repo,scope);assert.equal(h.context.taskSkillsDraft.agent,agent);
  }
  const noSkill=harness();await noSkill.search();noSkill.run('prepareTaskSkill(null)');assert.equal(noSkill.node('task-skills-prepare-plan').hidden,true);noSkill.run('planTaskComparison()');assert.equal(noSkill.node('improvement-dialog').open,false);assert.equal(noSkill.calls.length,1);
});

test('bridge save rejects blank and overlong quality but incomplete planning help stays explicit',async()=>{
  const h=harness();await startTaskPlan(h);await submitPlan(h);assert.equal(h.calls.length,1);assert.match(h.node('improvement-error').textContent,/concrete quality check/);h.node('improvement-plan-ask').listeners.click();assert.equal(h.node('chat-drawer').hidden,false);assert.match(h.node('chat-prompt').value,/First task quality check: \(not filled in\)/);assert.equal(h.calls.length,1);h.run('closeChat()');
  h.node('improvement-task-quality').value='q'.repeat(2000);h.node('improvement-tasks').children[0].querySelector('textarea').value='t'.repeat(2000);await submitPlan(h);assert.equal(h.calls.length,1);assert.match(h.node('improvement-error').textContent,/together fit 4000/);assert.equal(h.node('improvement-task-quality').value.length,2000);assert.equal(h.node('improvement-tasks').children[0].querySelector('textarea').value.length,2000);
});

test('failed create preserves editable fields and retries compose quality exactly once with expected scan',async()=>{
  const item=skill('check-tests');let fail=true;const h=harness({items:[item],api:async(body,index,path)=>{if(path==='/api/improvement'){if(fail)throw new Error('Synthetic save failure');const{expectedInventoryScan,...record}=body;return {...record,id:'saved-test',status:'baseline',tasks:record.tasks.map((task,index)=>({...task,id:'task-'+index}))};}return response(body,[item]);}});await startTaskPlan(h);const first=h.node('improvement-tasks').children[0];first.querySelector('textarea').value='Edited representative task';h.node('improvement-task-quality').value='Every project test must pass';h.node('improvement-rollback').value='Restore prior invocation choice';h.node('improvement-benefit').value='User expectation only';await submitPlan(h);assert.match(h.node('improvement-error').textContent,/Synthetic save failure/);assert.equal(first.querySelector('textarea').value,'Edited representative task');assert.equal(h.node('improvement-task-quality').value,'Every project test must pass');assert.equal(h.node('improvement-rollback').value,'Restore prior invocation choice');fail=false;await submitPlan(h);
  const writes=h.calls.filter(call=>call.path==='/api/improvement');assert.equal(writes.length,2);for(const {body}of writes){assert.equal(body.expectedInventoryScan,'2026-10-01T00:00:00.000Z');assert.equal(body.repo,root);assert.equal(body.agent,'codex');assert.deepEqual([...body.assetIds],['check-tests']);assert.equal(body.variable,'workflow');assert.equal(body.tasks[0].prompt,'Edited representative task\n\nQuality check:\nEvery project test must pass');assert.doesNotMatch(body.tasks[0].prompt,/\$|host-selected/);}assert.equal(h.context.improvementId,'saved-test');assert.equal(h.node('improvement-dialog').taskBridge,null);assert.deepEqual(h.calls.map(call=>call.path),['/api/task-skills','/api/improvement','/api/improvement']);
});

test('actual delayed create locks plan and dynamic task controls and restores their states on failure',async()=>{
  const item=skill('check-tests'),pending=[];const h=harness({items:[item],api:async(body,index,path)=>path==='/api/improvement'?new Promise((resolve,reject)=>pending.push({resolve,reject,body})):response(body,[item])});await startTaskPlan(h);for(let index=1;index<5;index++)h.run('addImprovementTask()');h.node('improvement-task-quality').value='User quality';h.node('improvement-rollback').value='User rollback';h.node('improvement-benefit').disabled=true;
  const first=h.node('improvement-tasks').children[0],controls=h.node('improvement-plan').querySelectorAll('input,textarea,select,button');h.node('improvement-plan').listeners.submit({preventDefault(){},submitter:h.node('synthetic-plan-submit')});assert.equal(pending.length,1);assert.ok(controls.every(control=>control.disabled));assert.equal(h.context.improvementBusy,true);h.node('improvement-task-back').listeners.click();assert.equal(h.node('improvement-dialog').open,true);h.node('improvement-plan').listeners.submit({preventDefault(){},submitter:h.node('synthetic-plan-submit')});assert.equal(pending.length,1);
  pending[0].reject(new Error('Delayed failure'));await tickPlan();assert.equal(h.context.improvementBusy,false);assert.equal(h.node('improvement-task-quality').disabled,false);assert.equal(first.querySelector('textarea').disabled,false);assert.equal(h.node('improvement-benefit').disabled,true);assert.equal(h.node('improvement-add-task').disabled,true);assert.equal(h.node('improvement-task-quality').value,'User quality');assert.equal(h.node('improvement-rollback').value,'User rollback');
  h.node('improvement-plan').listeners.submit({preventDefault(){},submitter:h.node('synthetic-plan-submit')});assert.ok(controls.every(control=>control.disabled));const {expectedInventoryScan,...record}=pending[1].body;pending[1].resolve({...record,id:'saved-after-delay',status:'baseline',tasks:record.tasks.map((task,index)=>({...task,id:'task-'+index}))});await tickPlan();assert.equal(h.context.improvementId,'saved-after-delay');assert.equal(h.node('improvement-task-quality').disabled,true);assert.equal(h.node('improvement-task-quality-row').hidden,true);assert.equal(h.reads.length,0);assert.equal(h.copies.length,0);h.run('openImprovement()');for(const key of ['plan-title','change','rollback','variable','plan-ask','add-task'])assert.equal(h.node('improvement-'+key).disabled,false);assert.equal(h.node('improvement-tasks').children[0].querySelector('textarea').disabled,false);assert.equal(h.node('improvement-task-quality').disabled,true);
});

test('catalog, scan, captured scope and missing source changes block create without resetting plan fields',async()=>{
  for(const change of ['scan','catalog','scope','missing']){
    const h=harness();await startTaskPlan(h);h.node('improvement-task-quality').value='Pass tests';h.node('improvement-rollback').value='User rollback';h.node('improvement-plan-title').value='User title';if(change==='scan')h.context.state.inventory.scannedAt='2026-10-02';if(change==='catalog')h.context.state.inventory.items[0].contentHash='changed';if(change==='scope')h.context.improvementScope={...h.context.improvementScope,repo:'/synthetic/other'};if(change==='missing')h.context.state.inventory.items=[];await submitPlan(h);assert.equal(h.calls.length,1);assert.match(h.node('improvement-error').textContent,/captured task scope or source changed|Selected source metadata changed/);assert.equal(h.node('improvement-plan-title').value,'User title');assert.equal(h.node('improvement-rollback').value,'User rollback');assert.equal(h.node('improvement-task-quality').value,'Pass tests');
  }
});

test('Back, close and Escape return the original task preparation and resume the unchanged comparison draft',async()=>{
  for(const exit of ['back','close','escape']){
    const h=harness();await startTaskPlan(h);const draft=h.context.taskSkillsDraft,preparation=draft.preparation,scope=h.context.improvementScope,first=h.node('improvement-tasks').children[0];preparation.invocation='$host-selected';h.node('improvement-task-quality').value='User quality';h.node('improvement-rollback').value='User rollback';h.context.activeRepo='/synthetic/other';h.context.selectedAgent='claude';h.run('invalidateTaskSkillsSearch()');assert.equal(draft.preparation,preparation);
    if(exit==='escape'){let prevented=false;h.node('improvement-dialog').listeners.cancel({preventDefault(){prevented=true;}});assert.equal(prevented,true);}else h.node(exit==='back'?'improvement-task-back':'improvement-close').listeners.click();
    assert.equal(h.node('task-skills-dialog').open,true);assert.equal(h.context.taskSkillsDraft,draft);assert.equal(draft.preparation,preparation);assert.equal(h.node('task-skills-invocation').value,'$host-selected');assert.equal(h.node('task-skills-prepare-plan').focused,true);h.node('task-skills-prepare-plan').listeners.click();assert.equal(h.context.improvementScope,scope);assert.equal(h.node('improvement-tasks').children[0],first);assert.equal(h.node('improvement-task-quality').value,'User quality');assert.equal(h.node('improvement-rollback').value,'User rollback');assert.equal(h.calls.length,1);
  }
});

test('planning-help detour keeps original bridge and quality while answering agent or dashboard changes',async()=>{
  const h=harness();await startTaskPlan(h);const draft=h.context.taskSkillsDraft,preparation=draft.preparation,first=h.node('improvement-tasks').children[0];first.querySelector('textarea').value='t'.repeat(2000);h.node('improvement-task-quality').value='Specific quality at the tail';h.node('improvement-plan-ask').listeners.click();assert.match(h.node('chat-prompt').value,/First task quality check: Specific quality at the tail/);const payload=h.run('contextPayload()');assert.equal(payload.repo,root);assert.equal(payload.reviewAgent,'codex');assert.deepEqual([...payload.selectedIds],['check-tests']);h.node('chat-agent').value='claude';h.context.activeRepo='/synthetic/other';h.context.selectedAgent='claude';h.run('invalidateTaskSkillsSearch();closeChat()');assert.equal(h.node('improvement-dialog').open,true);assert.equal(h.node('improvement-tasks').children[0],first);assert.equal(h.node('improvement-task-quality').value,'Specific quality at the tail');h.node('improvement-task-back').listeners.click();assert.equal(h.context.taskSkillsDraft,draft);assert.equal(draft.preparation,preparation);assert.equal(h.calls.length,1);
  h.node('task-skills-prepare-plan').listeners.click();h.node('improvement-plan-ask').listeners.click();h.context.state.inventory.scannedAt='Later scan';h.run('closeChat()');assert.match(h.node('improvement-error').textContent,/captured task scope or source changed|Selected source metadata changed/);h.node('improvement-task-back').listeners.click();assert.equal(draft.preparation,null);assert.match(h.node('task-skills-error').textContent,/no longer match/);assert.equal(h.node('improvement-task-quality').value,'Specific quality at the tail');
});

test('maximum comparison draft keeps whole bounded planning-help fields and the separate quality excerpt',async()=>{
  const h=harness();await startTaskPlan(h);for(let index=1;index<5;index++)h.run('addImprovementTask()');
  for(const id of ['plan-title','change','benefit','rollback'])h.node('improvement-'+id).value='"\\\n'.repeat(2000);
  for(const task of h.node('improvement-tasks').children){task.querySelector('input').value='label'.repeat(20);task.querySelector('textarea').value='t'.repeat(1800);}
  h.node('improvement-task-quality').value='QUALITY-PRESENT '+ 'q'.repeat(1984);h.node('improvement-plan-ask').listeners.click();
  const prompt=h.node('chat-prompt').value;assert.ok(prompt.length<=12000);assert.match(prompt,/First task quality check: QUALITY-PRESENT/);assert.ok(prompt.includes('t'.repeat(1800)));assert.match(prompt,/Task 5 label excerpt: [^\n]+\nPrompt and quality check excerpt: t{250} \[excerpt; 1550 characters omitted\]$/);assert.equal(h.calls.length,1);assert.equal(h.reads.length,0);assert.equal(h.copies.length,0);
});

test('opening an ordinary comparison clears bridge-only fields and retains ordinary task composition',async()=>{
  const h=harness();await startTaskPlan(h);h.node('improvement-task-quality').value='Bridge-only quality';h.run('openImprovement(null,{agent:"claude",repo:"/synthetic/ordinary",title:"Ordinary comparison"},[])');assert.equal(h.node('improvement-dialog').taskBridge,null);assert.equal(h.node('improvement-task-quality-row').hidden,true);assert.equal(h.node('improvement-task-quality').required,false);assert.equal(h.node('improvement-task-quality').disabled,true);const first=h.node('improvement-tasks').children[0];first.querySelector('input').value='Ordinary task';first.querySelector('textarea').value='Existing prompt and quality together';assert.equal(h.run('improvementPlanTasks()')[0].prompt,'Existing prompt and quality together');assert.equal(h.calls.length,1);
});
