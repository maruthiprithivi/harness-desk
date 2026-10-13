import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const slice=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const repo='/synthetic/project';
const item=(extra={})=>({id:'skill-a',name:'Synthetic skill',type:'skill',agent:'claude',repo:'',path:'/synthetic/global/SKILL.md',description:'Synthetic descriptor',residentTokens:0,bodyTokens:15,callEvidence:{matches:[],reads:[]},...extra});
const snapshot=(extra={})=>({agent:'claude',repo,coverage:{partial:false},fileReadCoverage:{supported:true},at:'2026-10-02T00:00:00.000Z',window:{from:'2026-10-01T00:00:00.000Z',to:'2026-10-02T00:00:00.000Z'},...extra});
const record=(id,extra={})=>({id,title:'Recorded '+id,agent:'claude',repo,assetIds:['skill-a'],createdAt:'2026-10-0'+id+'T00:00:00.000Z',...extra});
function harness({items=[item()],evidence=snapshot(),records=[],agent='claude'}={}) {
  const nodes=new Map(),effects=[],calls=[];
  const descendants=node=>[node,...node.children.flatMap(descendants)];
  const element=(tag='div',className='',textContent='')=>({tag,className,textContent:String(textContent),children:[],value:'',open:false,hidden:false,disabled:false,dataset:{},listeners:{},options:[],classList:{toggle(){}},setAttribute(){},focus(){},querySelectorAll(){return [];},append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},addEventListener(type,fn){this.listeners[type]=fn;},setCustomValidity(message){this.validationMessage=message;},reportValidity(){this.reported=true;},scrollIntoView(){effects.push(['scroll']);},set innerHTML(value){throw new Error('Untrusted metadata must render as text');}});
  const node=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
  const context=vm.createContext({$:node,element,array:value=>Array.isArray(value)?value:[],number:String,tokens:String,date:String,time:String,agentName:String,repoName:String,badge:(text,tone)=>element('span',tone,text),empty:(title,detail)=>element('div','empty',title+' '+detail),button:(text,className,fn)=>{const node=element('button',className,text);node.listeners.click=fn;return node;},setOptions(node,options,placeholder,selected){node.value=selected??options[0]?.value??'';},
    state:{improvements:records,inventory:{scannedAt:'2026-10-12T00:00:00Z',items}},loadingKey:JSON.stringify([repo,agent,'','2026-10-12T00:00:00Z']),loading:{repo,agent,launchDirectory:repo,components:{items,usageEvidence:evidence}},activeRepo:repo,selectedAgent:agent,componentPage:0,componentDrafts:new Map(),componentReviewPending:new Map(),componentDisclosures:new Map(),location:{hash:''},selectedIds:new Set(),pendingLoadingScope:null,
    openEditor:id=>effects.push(['editor',id]),openComponentChat:row=>effects.push(['chat',row.id]),openImprovement:(...args)=>effects.push(['test',...args]),openSessionFiles:()=>effects.push(['sessions',context.selectedAgent,context.activeRepo]),renderImprovements:()=>effects.push(['tests-list',context.selectedAgent,context.activeRepo]),refreshLoading:async()=>effects.push(['refresh']),refresh:async()=>effects.push(['state-refresh']),toast(){},
    openChat:(...args)=>{context.beginnerSelection=args[4];effects.push(['chat-draft',...args]);},updateRouteNote(){},updateSelection(){},api:async(path,body)=>{calls.push({path,body});return {};},action:(node,fn)=>fn(),
  });
  vm.runInContext(slice('function fileReadCounts(', 'function renderUsageEvidence(')+slice('function sortComponents(', 'function openLoadingChat('),context);
  const render=()=>context.renderComponents(),text=node=>[node.textContent,...node.children.map(text)].join(' '),card=(id=items[0].id)=>node('component-list').children.find(node=>node.dataset.componentId===id);
  const visibleText=node=>node.hidden?'':[node.textContent,...(node.tag==='details'&&!node.open?node.children.filter(child=>child.tag==='summary'):node.children).map(visibleText)].join(' ');
  const find=(label,id)=>descendants(card(id)).find(node=>node.tag==='button'&&node.textContent===label),details=(name,id)=>descendants(card(id)).find(node=>node.tag==='details'&&node.className===name),facts=id=>descendants(card(id)).find(node=>node.className==='component-evidence');
  render();return{context,node,effects,calls,render,text,visibleText,card,find,details,facts,descendants};
}

function actualChat(h) {
  const sections=['inventory','context','delegation'].map(value=>({value,checked:false})),errors=[];
  h.node('chat-sections').querySelectorAll=selector=>selector==='input:checked'?sections.filter(input=>input.checked):sections;
  h.node('chat-agent').options=[{value:'claude'},{value:'codex'}];h.node('chat-agent').value='claude';
  Object.assign(h.context,{advanced:false,activeChat:null,pendingPlan:null,pendingTaskScope:null,pendingGap:null,pendingImprovement:null,beginnerSelection:null,contextPreviewRequest:0,chatSnapshot:'',view:'dashboard',openedFrom:null,
    document:{activeElement:null,body:{style:{}}},setTimeout:fn=>fn(),renderConversation(){},updateChatAvailability(){},effectiveRoute:()=>({agent:'codex'}),
    filteredInventory:()=>[],includedIds:()=>[],loadingFiles:()=>[],loadingDirectoryLabel:(directory,root)=>directory===root?'Repository root':directory,
    refresh:async()=>{},schedulePoll(){},toast:message=>errors.push(message),
    action:(node,fn)=>{node.dataset.busy='true';h.context.lastAction=Promise.resolve().then(fn).catch(error=>errors.push(error.message)).finally(()=>{delete node.dataset.busy;});return h.context.lastAction;},
  });
  vm.runInContext(slice('function planningChatBusy()', 'function askImprovementPlan(')+slice('function chosenSections()', 'function updateChatAvailability(')+slice('function updateSelection()', 'function budgetMetric(')+slice('function openComponentChat(', 'function renderBeginnerHealth(')+slice('function openLoadingChat()', 'function taskSkillSources(')+slice("$('chat-preview-button').addEventListener", "$('chat-cancel').addEventListener"),h.context);
  return {errors,run:expression=>vm.runInContext(expression,h.context)};
}

test('default component page keeps other types ahead of many plugin records without hiding metadata',()=>{
  const plugins=Array.from({length:25},(_,index)=>item({id:'plugin-'+index,name:'A plugin '+String(index).padStart(2,'0'),type:'plugin',path:'/synthetic/plugins/'+index+'/manifest.json'}));
  const files=['skill','subagent','mcp-server','config','hook','instruction'].map(type=>item({id:type,name:'Z '+type,type,path:'/synthetic/files/'+type}));
  const h=harness({items:[...plugins,...files]}),ids=()=>h.node('component-list').children.filter(node=>node.tag==='article').map(node=>node.dataset.componentId);
  assert.deepEqual(ids().slice(0,6),['config','hook','instruction','mcp-server','skill','subagent']);assert.match(h.node('component-summary').textContent,/31 matching components/);assert.match(h.node('component-sort-note').textContent,/Your flagged or changed files come first.*skills, tool setup and helpers appear before plugin metadata/);
  const seen=new Set(ids());let next;while((next=h.node('component-pagination').children.find(node=>node.tag==='button'&&node.textContent==='Next'))){next.listeners.click();for(const id of ids())seen.add(id);}assert.equal(seen.size,31);for(const plugin of plugins)assert.ok(seen.has(plugin.id));
  const handler=source.split('\n').find(line=>line.startsWith("for(const id of ['component-search','component-filter','component-sort']"));vm.runInContext(handler,h.context);h.node('component-search').value='A plugin 24';h.node('component-search').listeners.input();assert.deepEqual(ids(),['plugin-24']);assert.equal(h.context.componentPage,0);assert.match(h.node('component-summary').textContent,/1 matching components/);assert.equal(h.calls.length,0);assert.equal(h.effects.length,0);
});

test('compact rows hide repeated prose and preserve explicit editing and one details disclosure',()=>{
  const h=harness({items:[item(),item({id:'other',name:'Another skill'})]});
  assert.doesNotMatch(h.visibleText(h.card()),/What we know|Measured benefit|Record use or a task outcome/);
  assert.match(h.visibleText(h.card()),/Synthetic skill.*Skill.*Global.*0 named calls.*0 tokens.*Edit.*Details/);
  h.find('Edit').listeners.click();assert.deepEqual(h.effects,[['editor','skill-a']]);
  const first=h.details('component-manager-details'),second=h.details('component-manager-details','other');
  first.open=true;first.listeners.toggle();assert.match(h.visibleText(h.card()),/Record use or a task outcome/);
  second.open=true;second.listeners.toggle();assert.equal(first.open,false);assert.equal(second.open,true);
});

test('usage sort and filter keep unknown separate from a measured zero',()=>{
  const h=harness({items:[item({id:'unknown',name:'Unknown',callEvidence:null}),item({id:'zero',name:'Zero',callEvidence:{matches:[]}}),item({id:'busy',name:'Busy',callEvidence:{matches:[{kind:'skill',name:'Busy',calls:12}]}})]});
  h.node('component-sort').value='usage-asc';h.render();assert.deepEqual(h.node('component-list').children.map(row=>row.dataset.componentId),['zero','busy','unknown']);
  h.node('component-sort').value='usage-desc';h.render();assert.deepEqual(h.node('component-list').children.map(row=>row.dataset.componentId),['busy','zero','unknown']);
  h.node('component-usage-filter').value='zero';h.render();assert.deepEqual(h.node('component-list').children.map(row=>row.dataset.componentId),['zero']);
  h.node('component-usage-filter').value='unknown';h.render();assert.deepEqual(h.node('component-list').children.map(row=>row.dataset.componentId),['unknown']);
  h.context.loading.components.usageEvidence={...snapshot(),repo:'/synthetic/different'};h.node('component-usage-filter').value='';h.render();assert.doesNotMatch(h.visibleText(h.node('component-list')),/12 named calls|0 named calls/);
});

test('configuration rows identify their plugin and server inspection is explicit and scoped',async()=>{
  const config=item({id:'mcp',name:'.mcp.json',type:'mcp-server',path:'/synthetic/.codex/plugins/cache/vendor/lookup-plugin/1.2.3/.mcp.json',canInspectTools:true});
  const h=harness({items:[config],evidence:null});assert.match(h.visibleText(h.card()),/lookup-plugin · \.mcp\.json/);assert.equal(h.calls.length,0);
  const server={id:'mcp:0',fileId:'mcp',name:'lookup',sourceLabel:'lookup-plugin',scope:'global',configuredEnabled:false,configurationStatus:'valid',authentication:'unknown',runtime:'unknown',allowedActions:[]};
  h.context.api=async(path,body)=>{h.calls.push({path,body});return{servers:[server],coverage:{partial:false}};};
  await h.context.inspectComponentServers();h.node('component-filter').value='tools';h.render();
  assert.deepEqual(h.calls.map(call=>call.path),['/api/mcp-manager']);assert.match(h.visibleText(h.node('component-list')),/lookup.*lookup-plugin.*MCP server.*Disabled.*valid.*Unknown/);assert.doesNotMatch(h.visibleText(h.node('component-list')),/0 named calls/);
  h.node('component-status-filter').value='enabled';h.render();assert.match(h.text(h.node('component-list')),/No components match/);
  h.node('component-status-filter').value='disabled';h.render();assert.equal(h.node('component-list').children[0].dataset.serverId,'mcp:0');
});

test('a stale MCP inspection response cannot replace another workspace',async()=>{
  const h=harness();let release;h.context.api=()=>new Promise(resolve=>{release=resolve;});
  const before=h.context.loading,pending=h.context.inspectComponentServers();h.context.activeRepo='/synthetic/other';release({servers:[{name:'stale'}]});await pending;assert.equal(before.components.manager,undefined);
});

test('MCP mutations require a preview and remain bound to the inspected workspace',async()=>{
  const h=harness({items:[item({id:'config',name:'config.toml',type:'config'})],evidence:null});
  const server={id:'config:0',fileId:'config',name:'search',sourceLabel:'Global config',scope:'global',configuredEnabled:true,configurationStatus:'valid',allowedActions:['disable','remove'],recordedCalls:null};
  const source=h.context.loading,row=h.context.renderManagedServer(server,source);
  const find=label=>h.descendants(row).find(node=>node.tag==='button'&&node.textContent===label);
  h.context.api=async(path,body)=>{h.calls.push({path,body});return body.phase==='preview'?{reviewToken:'fixture-review',summary:'Disable search after agent restart.'}:{saved:true};};
  find('Disable').listeners.click({currentTarget:find('Disable')});await new Promise(setImmediate);
  assert.deepEqual(h.calls.map(call=>call.body.phase),['preview']);assert.match(h.text(row),/Disable search after agent restart/);
  h.context.activeRepo='/synthetic/other';await find('Apply disable').listeners.click({currentTarget:find('Apply disable')});assert.equal(h.calls.length,1);
  h.context.activeRepo=repo;find('Apply disable').listeners.click({currentTarget:find('Apply disable')});await new Promise(setImmediate);
  assert.deepEqual(h.calls.slice(0,2).map(call=>call.body.phase),['preview','apply']);assert.deepEqual({...h.calls[1].body},{agent:'claude',repo,id:'config',server:'search',action:'disable',phase:'apply',reviewToken:'fixture-review'});
  assert.deepEqual(h.effects,[['state-refresh'],['refresh']]);
});

test('after saving a server, the next inventory poll retains the inspected disabled row',async()=>{
  const config=item({id:'config',name:'config.toml',type:'config'}),h=harness({items:[config],evidence:null});
  Object.assign(h.context,{advanced:false,loadingSequence:0,loadingDirectories:new Map(),loadingError:'',loadingDirectoryNotice:'',document:{body:{append(){}}},renderLoading(){h.context.renderComponents();},renderContextBreakdowns(){},updateStartGuide(){}});
  h.context.state.csrfToken='synthetic';h.node('beginner-file-bands').contains=()=>false;
  vm.runInContext(slice('async function refreshLoading(','function friendlyStatus('),h.context);
  const initial=h.context.loading,server={id:'config:0',fileId:'config',name:'search',sourceLabel:'Global config',scope:'global',configuredEnabled:true,configurationStatus:'valid',allowedActions:['disable'],recordedCalls:null};
  let stateWasRead=false;
  h.context.refresh=async()=>{stateWasRead=true;h.context.state.inventory.scannedAt='2026-10-13T00:00:00Z';await h.context.refreshLoading();};
  h.context.api=async(path,body)=>{h.calls.push({path,body});if(path==='/api/mcp-action')return body.phase==='preview'?{reviewToken:'review',summary:'Disable search'}:{saved:true};if(path==='/api/loading')return{repo,agent:'claude',components:{items:[config]}};if(path==='/api/mcp-manager')return{servers:[{...server,configuredEnabled:false,allowedActions:['enable']}],coverage:{partial:false}};throw new Error('Unexpected request');};
  h.node('component-filter').value='tools';h.node('component-status-filter').value='disabled';
  const row=h.context.renderManagedServer(server,initial),find=label=>h.descendants(row).find(node=>node.tag==='button'&&node.textContent===label);
  find('Disable').listeners.click({currentTarget:find('Disable')});await new Promise(setImmediate);
  find('Apply disable').listeners.click({currentTarget:find('Apply disable')});await new Promise(setImmediate);
  assert.equal(stateWasRead,true);assert.match(h.visibleText(h.node('component-list')),/search.*Disabled/);
  const map=h.context.loading,requests=h.calls.length;
  await h.context.refreshLoading();
  assert.equal(h.context.loading,map);assert.equal(h.calls.length,requests);assert.match(h.visibleText(h.node('component-list')),/search.*Disabled/);
});

test('failed and empty MCP sources remain visible as actionable diagnostics',()=>{
  const h=harness({items:[],evidence:null});h.node('component-filter').value='tools';
  h.context.loading.components.manager={servers:[],sources:[{fileId:'broken',sourceLabel:'Broken config',serverCount:null},{fileId:'empty',sourceLabel:'Empty config',serverCount:0}],coverage:{partial:true}};h.render();
  assert.match(h.text(h.node('component-list')),/2 configurations need a closer look.*Broken config · Could not inspect.*Open config.*Empty config · No server definitions found/);
  const open=h.descendants(h.node('component-list')).find(node=>node.tag==='button'&&node.textContent==='Open config');open.listeners.click();assert.deepEqual(h.effects,[['editor','broken']]);
});

test('real sort rerenders preserve manual draft, disclosures and explicit selections',()=>{
  const h=harness({items:[item(),item({id:'plugin',name:'A plugin',type:'plugin',path:'/synthetic/plugin.json'})]}),fields=h.descendants(h.card('skill-a')),form=fields.find(node=>node.tag==='form'),note=fields.find(node=>node.name==='component-note');
  note.value='Unsaved scoped task note';form.listeners.input();const draft=h.context.componentDrafts.get(JSON.stringify(['skill-a','claude',repo]));h.context.selectedIds=new Set(['skill-a','plugin']);const selection=h.context.selectedIds;
  for(const name of ['component-evidence-details','component-file-details']){const disclosure=h.details(name,'skill-a');disclosure.open=true;disclosure.listeners.toggle();}
  const handler=source.split('\n').find(line=>line.startsWith("for(const id of ['component-search','component-filter','component-sort']"));vm.runInContext(handler,h.context);
  for(const order of ['cost','review']){h.context.componentPage=4;h.node('component-sort').value=order;h.node('component-sort').listeners.change();assert.equal(h.context.componentPage,0);assert.equal(h.node('component-sort').value,order);assert.equal(h.context.componentDrafts.get(JSON.stringify(['skill-a','claude',repo])),draft);assert.equal(h.descendants(h.card('skill-a')).find(node=>node.name==='component-note').value,'Unsaved scoped task note');assert.equal(h.details('component-evidence-details','skill-a').open,true);assert.equal(h.details('component-file-details','skill-a').open,true);assert.equal(h.context.selectedIds,selection);assert.deepEqual([...selection],['skill-a','plugin']);}
  assert.equal(h.calls.length,0);assert.equal(h.effects.length,0);
});

test('selected order explanation updates even while discovery is pending or unavailable',()=>{
  const h=harness();h.context.loading=null;h.context.loadingSequence=0;
  for(const error of ['', 'Synthetic map unavailable'])for(const order of ['review','cost']){h.context.loadingError=error;h.node('component-sort').value=order;h.render();assert.match(h.node('component-sort-note').textContent,order==='cost'?/Description costs estimate text size.*In cost order, unknown values follow known estimates/:/Your flagged or changed files come first.*skills, tool setup and helpers appear before plugin metadata/);assert.equal(h.node('component-sort').value,order);}
  assert.equal(h.calls.length,0);assert.equal(h.effects.length,0);
});

test('component and map questions leave a busy planning return and its draft untouched',()=>{
  for(const opener of ['openComponentChat(state.inventory.items[0])','openLoadingChat()']){
    const h=harness(),chat=actualChat(h),scope={repo:'/synthetic/original',agent:'codex'},plan={repo:'/synthetic/plan',agent:'codex'};
    h.context.pendingLoadingScope=scope;h.context.pendingPlan=plan;h.context.selectedIds=new Set(['original-file']);h.context.beginnerSelection=['original-file'];h.node('chat-prompt').value='Keep this draft';h.node('chat-agent').value='codex';h.node('chat-intent').value='explanation';h.node('improvement-dialog').dataset.planReturn='true';h.node('chat-send').dataset.busy='true';
    chat.run("openChat(['inventory'],'Blocked draft')");chat.run(opener);
    assert.equal(h.context.pendingLoadingScope,scope);assert.equal(h.context.pendingPlan,plan);assert.deepEqual([...h.context.selectedIds],['original-file']);assert.deepEqual([...h.context.beginnerSelection],['original-file']);assert.equal(h.node('chat-prompt').value,'Keep this draft');assert.equal(h.node('chat-agent').value,'codex');assert.equal(h.node('chat-intent').value,'explanation');assert.equal(h.calls.length,0);assert.equal(h.effects.length,0);
  }
});

test('component question fixes original repo or global scope, folder and ID independently of dashboard and answering agent',()=>{
  for(const global of [false,true])for(const advanced of [false,true]){
    const row=item({repo:global?'':repo}),h=harness({items:[row]}),chat=actualChat(h),scope=global?'':repo,folder=global?'':repo+'/src';
    h.context.advanced=advanced;h.context.activeRepo=scope;h.context.loading.repo=scope;h.context.loading.launchDirectory=folder;h.context.loadingKey=JSON.stringify([scope,'claude',folder,h.context.state.inventory.scannedAt]);chat.run('openComponentChat(state.inventory.items[0])');
    assert.equal(h.calls.length,0);assert.deepEqual([...h.context.selectedIds],['skill-a']);assert.match(h.node('chat-prompt').value,/Review this component for claude/);assert.equal(h.node('chat-intent').value,'optimization');
    h.context.activeRepo='/synthetic/other';h.context.selectedAgent='codex';h.context.selectedIds=new Set(['different-file']);h.context.beginnerSelection=['different-file'];h.node('chat-agent').value='codex';chat.run('updateRouteNote(); updateSelection()');
    const payload=chat.run('contextPayload()');assert.equal(payload.repo,scope);assert.equal(payload.reviewAgent,'claude');assert.equal(payload.launchDirectory,folder);assert.equal(payload.globalOnly,global);assert.equal(payload.selectionMode,'explicit');assert.deepEqual([...payload.selectedIds],['skill-a']);assert.match(h.node('chat-selection-note').textContent,/1 selected component for claude/);assert.doesNotMatch(h.node('chat-selection-note').textContent,/synthetic\/other|different-file/);assert.match(h.node('chat-route-note').textContent,/Fixed component evidence: claude.*Answering agent: codex/);
  }
});

test('unavailable, mismatched and stale component openings preserve the current draft without reading or requesting',()=>{
  for(const change of [h=>h.context.loading=null,h=>h.context.loadingKey='',h=>h.context.loadingKey='failed-map',h=>h.context.loading.repo='/synthetic/other',h=>h.context.loading.agent='codex',h=>h.context.state.inventory.scannedAt='new scan',h=>h.context.state.inventory.items=[],h=>h.context.loading.components.items=[],h=>h.context.state.inventory.items=[{...h.context.state.inventory.items[0],bytes:99}],h=>h.context.loading.components.items=[{...h.context.loading.components.items[0],modifiedAt:'new version'}],h=>{h.context.state.inventory.items[0].agent='codex';},h=>{h.context.state.inventory.items[0].repo='/synthetic/other';}]){
    const h=harness(),chat=actualChat(h),row=h.context.state.inventory.items[0],original={repo:'/synthetic/original',agent:'codex'};h.context.pendingLoadingScope=original;h.context.selectedIds=new Set(['original']);h.node('chat-prompt').value='Keep this draft';h.context.row=row;change(h);chat.run('openComponentChat(row)');
    assert.equal(h.context.pendingLoadingScope,original);assert.deepEqual([...h.context.selectedIds],['original']);assert.equal(h.node('chat-prompt').value,'Keep this draft');assert.equal(h.node('chat-agent').value,'claude');assert.equal(h.calls.length,0);assert.match(chat.errors[0],/Component evidence changed or is unavailable/);
  }
  const h=harness(),chat=actualChat(h);chat.run('openComponentChat(null)');assert.equal(h.context.pendingLoadingScope,null);assert.equal(h.calls.length,0);assert.match(chat.errors[0],/Component evidence changed or is unavailable/);
});

test('actual preview and send reject changed captured component metadata or scan before any API call',async()=>{
  for(const change of [h=>h.context.state.inventory.scannedAt='new scan',h=>h.context.state.inventory.items=[],...['id','path','agent','repo','type','contentHash','bytes','modifiedAt'].map(field=>h=>{h.context.state.inventory.items[0]={...h.context.state.inventory.items[0],[field]:field==='bytes'?99:'changed'};})]){
    const h=harness(),chat=actualChat(h);chat.run('openComponentChat(state.inventory.items[0])');const scope=h.context.pendingLoadingScope,prompt=h.node('chat-prompt').value;change(h);
    await h.node('chat-preview-button').listeners.click({currentTarget:h.node('chat-preview-button')});h.node('chat-form').listeners.submit({preventDefault(){}});await h.context.lastAction;
    assert.equal(h.calls.length,0);assert.equal(h.context.pendingLoadingScope,scope);assert.equal(h.node('chat-prompt').value,prompt);assert.equal(h.node('chat-preview-button').dataset.busy,undefined);assert.equal(h.node('chat-send').dataset.busy,undefined);assert.equal(chat.errors.length,2);for(const error of chat.errors)assert.match(error,/Component evidence changed since review.*before previewing or sending/);
  }
});

test('component binding clears for ordinary, new and saved chats and never overrides saved conversation scope',()=>{
  const h=harness(),chat=actualChat(h);chat.run('openComponentChat(state.inventory.items[0]); openChat(["context"],"Ordinary request")');assert.equal(h.context.pendingLoadingScope,null);
  chat.run('openComponentChat(state.inventory.items[0]); newChat()');assert.equal(h.context.pendingLoadingScope,null);
  chat.run('openComponentChat(state.inventory.items[0])');h.context.saved={id:'saved',repo:'/synthetic/saved',agent:'codex',reviewAgent:'shared',intent:'explanation',launchDirectory:'/synthetic/saved/src',sections:['context'],selectedIds:['saved-file'],selectionMode:'explicit'};chat.run('openChat(null,undefined,saved)');assert.equal(h.context.pendingLoadingScope,null);h.context.state.inventory.scannedAt='new scan';const payload=chat.run('contextPayload()');assert.equal(payload.repo,'/synthetic/saved');assert.equal(payload.reviewAgent,'shared');assert.equal(payload.launchDirectory,'/synthetic/saved/src');assert.deepEqual([...payload.selectedIds],['saved-file']);assert.equal(h.calls.length,0);
});

test('shared sources are eligible but a detached same-ID card cannot ask about a changed version',()=>{
  for(const agent of ['shared','model-gateway']){
    const h=harness({items:[item({agent})]}),chat=actualChat(h);h.find('Ask about this component').listeners.click();assert.equal(h.context.pendingLoadingScope.agent,'claude');assert.deepEqual([...chat.run('contextPayload()').selectedIds],['skill-a']);assert.equal(h.calls.length,0);
  }
  const h=harness(),chat=actualChat(h),ask=h.find('Ask about this component');h.node('chat-prompt').value='Keep this draft';h.context.state.inventory.items=[{...h.context.state.inventory.items[0],bytes:99}];h.context.loading.components.items=h.context.state.inventory.items;ask.listeners.click();assert.equal(h.context.pendingLoadingScope,null);assert.equal(h.node('chat-prompt').value,'Keep this draft');assert.match(chat.errors[0],/Component evidence changed or is unavailable/);assert.equal(h.calls.length,0);
});

test('explicit preview and send share the captured component subject with the separately chosen answering agent',async()=>{
  const h=harness(),chat=actualChat(h);chat.run('openComponentChat(state.inventory.items[0])');h.context.activeRepo='/synthetic/other';h.context.selectedAgent='codex';h.node('chat-agent').value='codex';h.context.api=async(path,body)=>{h.calls.push({path,body});return path==='/api/context'?{text:'Synthetic bounded preview',estTokens:10}:{...body,id:'saved',status:'complete'};};
  await h.node('chat-preview-button').listeners.click({currentTarget:h.node('chat-preview-button')});h.node('chat-form').listeners.submit({preventDefault(){}});await h.context.lastAction;
  assert.deepEqual(h.calls.map(call=>call.path),['/api/context','/api/chat']);for(const {body} of h.calls){assert.equal(body.repo,repo);assert.equal(body.reviewAgent,'claude');assert.equal(body.launchDirectory,repo);assert.equal(body.selectionMode,'explicit');assert.deepEqual([...body.selectedIds],['skill-a']);}assert.equal(h.calls[1].body.agent,'codex');assert.equal(h.calls[1].body.intent,'optimization');assert.equal(h.context.activeChat.id,'saved');assert.equal(h.context.pendingLoadingScope,null);assert.equal(h.node('chat-prompt').value,'');assert.deepEqual(chat.errors,[]);
});

function matchingItems(count=2) {
  const items=Array.from({length:count},(_,index)=>item({id:'copy-'+index,name:'Copy '+index,agent:'claude',repo:index?repo:'',path:'/synthetic/'+index+'/SKILL.md',contentHash:'a'.repeat(64),bytes:100,modifiedAt:'2026-10-01'}));
  for(const source of items)source.duplicates={method:'sha256-full-markdown',scannedAt:'2026-10-12',scanPartial:false,eligible:count,hashed:count,unhashed:0,peerCount:count-1,shown:Math.min(3,count-1),omitted:Math.max(0,count-4),peers:items.filter(peer=>peer.id!==source.id).slice(0,3).map(({id,name,path,type,agent,repo,contentHash,bytes,modifiedAt})=>({id,name,path,type,agent,repo,contentHash,bytes,modifiedAt}))};
  return items;
}

test('matching-copy review is bounded, initially closed and requires explicit pair actions',()=>{
  const h=harness({items:matchingItems(6)}),copies=h.details('component-copies'),text=h.text(copies);
  assert.equal(copies.open,false);assert.match(text,/Other scoped files.*identical complete Markdown at the last scan: 5/);assert.match(text,/Showing 3 of 5.*2 omitted/);assert.match(text,/6 of 6 scoped component files.*0 are unassessed/);assert.equal(h.effects.length,0);assert.equal(h.calls.length,0);
  assert.match(h.text(h.card()),/Next check: Review the matching copies/);h.find('Review matching copies').listeners.click();assert.equal(copies.open,true);assert.equal(h.details('component-file-details').open,true);h.effects.length=0;
  h.node('component-filter').value='copies';h.render();assert.equal(h.node('component-list').children.filter(node=>node.tag==='article').length,6);assert.equal(h.calls.length,0);
  h.find('Open matching file').listeners.click();assert.deepEqual(h.effects.pop(),['editor','copy-1']);
  h.find('Compare these copies').listeners.click();const chat=h.effects.pop();assert.equal(chat[0],'chat-draft');assert.deepEqual([...chat[1]],['inventory','context']);assert.deepEqual([...chat[5]],['copy-0','copy-1']);assert.match(chat[2],/complete Markdown matched.*Do not choose a canonical file/);assert.equal(h.context.pendingLoadingScope.repo,repo);assert.equal(h.context.pendingLoadingScope.agent,'claude');assert.equal(h.context.pendingLoadingScope.copySources.length,2);assert.equal(h.calls.length,0);
  h.find('Test these copies').listeners.click();const comparison=h.effects.pop();assert.equal(comparison[0],'test');assert.equal(comparison[2].agent,'claude');assert.equal(comparison[2].repo,repo);assert.deepEqual([...comparison[3]],['copy-0','copy-1']);assert.equal(comparison[2].expectedBenefit,undefined);
});

test('matching-copy actions reject detached scope, scan, map and either source-version change',()=>{
  for(const change of [h=>h.context.activeRepo='/synthetic/other',h=>h.context.selectedAgent='codex',h=>h.context.state.inventory.scannedAt='new scan',h=>h.context.loadingKey='new map',h=>h.context.loading.components.items[0].bytes++,h=>h.context.loading.components.items[1].contentHash='b'.repeat(64),h=>h.context.loading.components.items.splice(1,1)]){
    const h=harness({items:matchingItems()}),actions=['Open matching file','Compare these copies','Test these copies'].map(label=>h.find(label));change(h);for(const action of actions)action.listeners.click();assert.equal(h.effects.length,0);assert.equal(h.calls.length,0);
  }
});

test('matching-copy coverage keeps unknown hashes, partial discovery and legacy pointers distinct',()=>{
  const sources=matchingItems();sources[0].duplicates.scanPartial=true;sources[0].duplicates.unhashed=2;sources[0].duplicates.eligible=4;const h=harness({items:sources});assert.match(h.text(h.details('component-copies')),/2 are unassessed.*Discovery is partial/);
  const known=h.details('component-copies');known.open=true;known.listeners.toggle();h.render();assert.equal(h.details('component-copies').open,true);
  sources[0].duplicates.peerCount=0;sources[0].duplicates.peers=[];h.render();assert.match(h.text(h.details('component-copies')),/No matching copy.*does not establish uniqueness/);
  sources[0].contentHash=null;sources[0].duplicateOf='/private/other/SKILL.md';h.render();assert.match(h.text(h.details('component-copies')),/comparison is unknown/);assert.doesNotMatch(h.text(h.details('component-copies')),/private\/other|No matching copy was found/);assert.equal(h.find('Open matching file'),undefined);h.node('component-filter').value='copies';h.render();assert.equal(h.card('copy-0'),undefined);
  assert.equal(h.effects.length,0);assert.equal(h.calls.length,0);
});

test('forged or changed peer metadata cannot create an editor or advisory target',()=>{
  for(const patch of [{repo:'/synthetic/other'},{agent:'codex'},{contentHash:'b'.repeat(64)},{bytes:99},{id:'missing'},{path:'/private/other/SKILL.md'}]){
    const sources=matchingItems();Object.assign(sources[0].duplicates.peers[0],patch);const h=harness({items:sources});assert.equal(h.find('Open matching file'),undefined);assert.equal(h.find('Compare these copies'),undefined);assert.equal(h.find('Test these copies'),undefined);assert.equal(h.calls.length,0);assert.equal(h.effects.length,0);
  }
});

test('matching-copy chat preview keeps captured pair and refuses changed inventory evidence',()=>{
  const h=harness({items:matchingItems()});h.find('Compare these copies').listeners.click();Object.assign(h.context,{activeChat:null,pendingTaskScope:null,pendingPlan:null,pendingGap:null,pendingImprovement:null,chosenSections:()=>['inventory','context']});
  vm.runInContext(slice('function contextPayload(', 'function updateChatAvailability('),h.context);let payload=h.context.contextPayload();assert.deepEqual([...payload.selectedIds],['copy-0','copy-1']);assert.equal(payload.repo,repo);assert.equal(payload.reviewAgent,'claude');h.context.activeRepo='/synthetic/other';h.context.selectedAgent='codex';payload=h.context.contextPayload();assert.equal(payload.repo,repo);assert.equal(payload.reviewAgent,'claude');h.context.state.inventory.items[1].bytes++;assert.throws(()=>h.context.contextPayload(),/Matching-copy evidence changed/);assert.equal(h.calls.length,0);
});

test('a busy planning-chat return cannot be overwritten by a matching-copy question',()=>{
  const h=harness({items:matchingItems()}),original={repo:'/synthetic/original',agent:'codex'};h.context.pendingLoadingScope=original;h.context.selectedIds=new Set(['original-file']);h.node('chat-agent').value='codex';h.node('chat-intent').value='explanation';h.node('improvement-dialog').dataset.planReturn='true';h.context.planningChatBusy=()=>true;
  vm.runInContext(slice('function openChat(', 'function closeChat('),h.context);h.context.openChat(['inventory'],'Rejected draft');h.find('Compare these copies').listeners.click();
  assert.equal(h.context.pendingLoadingScope,original);assert.deepEqual([...h.context.selectedIds],['original-file']);assert.equal(h.node('chat-agent').value,'codex');assert.equal(h.node('chat-intent').value,'explanation');assert.equal(h.effects.length,0);assert.equal(h.calls.length,0);
});

test('proposal selection uses a scoped matching peer rather than the inventory-wide first copy',()=>{
  const sources=matchingItems();sources[0].duplicateOf='/private/other/SKILL.md';const h=harness({items:sources});vm.runInContext(slice('function proposalSelection(', 'function openComponentChat('),h.context);assert.deepEqual([...h.context.proposalSelection({itemId:'copy-0'})],['copy-0','copy-1']);h.context.loading=null;assert.deepEqual([...h.context.proposalSelection({itemId:'copy-0'})],['copy-0']);
});

test('independent evidence shows simultaneous manual use, ambiguous calls and Read targets without claiming benefit',()=>{
  const h=harness({items:[item({review:{status:'used',lastUsed:'2026-10-01',note:'Manual task note'},callEvidence:{matches:[{kind:'skill',name:'Synthetic skill',calls:3,resultsSeen:1,failed:2}],ambiguous:true,reads:[{assetId:'skill-a',requests:2,resultsSeen:1,failed:1}]}})]});
  const facts=h.text(h.facts());assert.match(facts,/Found: Skill.*Global setup/);assert.match(facts,/Manual use recorded on 2026-10-01/);assert.match(facts,/3 recorded calls.*2 explicit Read target requests/);assert.match(facts,/Name\/source match unresolved/);assert.match(facts,/Measured benefit: unknown/);assert.match(facts,/does not prove loading, success or help/);
  assert.equal(h.card().children[0].children[0].children.length,0);assert.equal(h.details('component-file-details').open,false);assert.equal(h.details('component-evidence-details').open,false);assert.doesNotMatch(h.visibleText(h.facts()),/Estimated description cost|Manual task note|Measured benefit/);assert.equal(h.effects.length,0);assert.equal(h.calls.length,0);
});

test('default cards show three concise fact paragraphs and closed details retain complete manual, call and Read evidence',()=>{
  const h=harness({items:[item({review:{status:'used',lastUsed:'2026-10-01',source:'User supplied',at:'2026-10-02',note:'Full manual task evidence'},callEvidence:{matches:[{kind:'skill',name:'Synthetic skill',calls:3,resultsSeen:2,failed:1}],reads:[{assetId:'skill-a',requests:2,resultsSeen:1,failed:1}]}})]}),facts=h.facts(),detail=h.details('component-evidence-details'),visible=h.visibleText(facts);
  assert.equal(detail.open,false);assert.equal(detail.children[0].textContent,'Evidence details');assert.equal(facts.children.filter(node=>node.tag==='p').length,3);assert.match(visible,/Found: Skill.*Global setup/);assert.match(visible,/Manual use recorded on 2026-10-01\. Selected sample: 3 named calls · 2 explicit Read requests/);assert.match(visible,/Task helpfulness: unknown/);assert.doesNotMatch(visible,/Full manual task evidence|results seen|error flag|Measured benefit|does not prove loading/);
  const full=h.text(detail);assert.match(full,/Full manual task evidence/);assert.match(full,/3 recorded calls.*2 explicit Read target requests/);assert.match(full,/Skill: Synthetic skill.*2 results seen.*1 explicit error flag/);assert.match(full,/2 explicit Read requests.*1 result seen.*1 explicit error flag/);assert.match(full,/Measured benefit: unknown.*Zero recorded attempts does not mean unused/);
  detail.open=true;detail.listeners.toggle();assert.match(h.visibleText(facts),/Full manual task evidence|Measured benefit/);h.render();assert.equal(h.details('component-evidence-details').open,true);assert.equal(h.effects.length,0);assert.equal(h.calls.length,0);
});

test('visible sample summary distinguishes known zero, positive, unknown, legacy and unsupported counts without adding them',()=>{
  const cases=[
    {row:item(),sample:snapshot(),expected:/Manual use: unknown\. Selected sample: 0 named calls · 0 explicit Read requests/},
    {row:item({callEvidence:{matches:[{kind:'skill',name:'fixture',calls:2}],reads:[{assetId:'skill-a',requests:3}]}}),sample:snapshot(),expected:/Manual use: unknown\. Selected sample: 2 named calls · 3 explicit Read requests/},
    {row:item({callEvidence:{}}),sample:snapshot(),expected:/Selected sample: named calls unknown · explicit Read requests unknown/},
    {row:item({callEvidence:{matches:[{calls:'2'}],reads:[{assetId:'skill-a',requests:-1}]}}),sample:snapshot(),expected:/Selected sample: named calls unknown · explicit Read requests unknown/},
    {row:item(),sample:null,expected:/Selected sample: named calls unknown · explicit Read requests unknown/},
    {row:item(),sample:snapshot({agent:'codex'}),expected:/Selected sample: named calls unknown · explicit Read requests unknown/},
    {row:item(),sample:snapshot({repo:'/synthetic/other'}),expected:/Selected sample: named calls unknown · explicit Read requests unknown/},
    {row:item({callEvidence:{matches:[{kind:'skill',name:'legacy',calls:1}],reads:[]}}),sample:snapshot({fileReadCoverage:undefined}),expected:/Selected sample: 1 named call · explicit Read requests unknown/},
    {row:item(),sample:snapshot({fileReadCoverage:{supported:false}}),expected:/Selected sample: 0 named calls · explicit Read collection unsupported/},
  ];
  for(const {row,sample,expected}of cases){const h=harness({items:[row],evidence:sample}),visible=h.visibleText(h.facts());assert.match(visible,expected);assert.doesNotMatch(visible,/5 (?:named|recorded|explicit)|Manual use recorded|unused|loaded|successful|Measured benefit/);assert.equal(h.details('component-evidence-details').open,false);assert.equal(h.calls.length,0);assert.equal(h.effects.length,0);}
});

test('positive sample counts retain visible unresolved and partial or unknown coverage warnings when details are closed',()=>{
  for(const coverage of [{partial:true},{}, {partial:'false'}]){
    const h=harness({items:[item({callEvidence:{matches:[{kind:'mcp',name:'fixture',calls:2}],reads:[{assetId:'skill-a',requests:1}]}})],evidence:snapshot({coverage})}),visible=h.visibleText(h.facts());assert.match(visible,/Selected sample: 2 named calls · 1 explicit Read request/);assert.match(visible,/Name\/source match unresolved/);assert.match(visible,coverage.partial===true?/Session snapshot is partial/:/Session coverage is unknown/);assert.equal(h.details('component-evidence-details').open,false);assert.equal(h.calls.length,0);
  }
});

test('visible manual summaries qualify earlier versions and keep review and inspection warnings outside details',()=>{
  for(const status of ['used','review','unknown']){
    const h=harness({items:[item({review:{status,changed:true,lastUsed:'2026-10-01',note:'Historical note'},toolInspection:{fileChanged:true,servers:[],coverage:{partial:true}}})]}),visible=h.visibleText(h.facts());assert.match(visible,/earlier file version/);assert.match(visible,/Changed since review/);assert.match(visible,/Configuration changed since inspection.*Tool inspection is partial/);assert.doesNotMatch(visible,/Historical note|Measured benefit/);if(status==='review')assert.match(visible,/Your note marks this file for review/);assert.match(h.visibleText(h.card()),/Changed since review/);h.details("component-manager-details").open=true;assert.match(h.visibleText(h.card()),/Next check: Review your kept note/);assert.equal(h.details('component-evidence-details').open,false);assert.equal(h.calls.length,0);
  }
  const unknown=harness({items:[item({toolInspection:{servers:[],coverage:{}}})]});assert.match(unknown.visibleText(unknown.facts()),/Tool inspection coverage is unknown/);
});

test('closed evidence stays closed with scoped drafts and pending locks while open state remains separate by agent and repository',()=>{
  const h=harness(),key=JSON.stringify(['skill-a','claude',repo]),detail=h.details('component-evidence-details');detail.open=true;detail.listeners.toggle();h.render();assert.equal(h.details('component-evidence-details').open,true);
  h.context.selectedAgent='codex';h.render();assert.equal(h.details('component-evidence-details').open,false);h.context.selectedAgent='claude';h.context.activeRepo='';h.render();assert.equal(h.details('component-evidence-details').open,false);h.context.activeRepo=repo;h.render();assert.equal(h.details('component-evidence-details').open,true);
  h.details('component-evidence-details').open=false;h.details('component-evidence-details').listeners.toggle();const draft={status:'unknown',helpfulness:'mixed',lastUsed:'',note:'Recoverable task note'};h.context.componentDrafts.set(key,draft);h.context.componentReviewPending.set(key,{...draft});h.render();assert.equal(h.details('component-evidence-details').open,false);assert.equal(h.descendants(h.card()).find(node=>node.name==='component-note').value,draft.note);assert.equal(h.descendants(h.card()).find(node=>node.name==='component-helpfulness').disabled,true);assert.equal(h.context.componentDrafts.get(key),draft);h.context.componentReviewPending.delete(key);h.render();assert.equal(h.details('component-evidence-details').open,false);assert.equal(h.descendants(h.card()).find(node=>node.name==='component-helpfulness').disabled,false);assert.equal(h.calls.length,0);assert.equal(h.effects.length,0);
});

test('known zero counts remain zero while missing, malformed and legacy fields remain unknown',()=>{
  const zero=harness();assert.match(zero.text(zero.facts()),/0 recorded calls.*0 explicit Read target requests/);
  for(const extra of [{callEvidence:{}},{callEvidence:{matches:[{calls:'2'}],reads:[{assetId:'skill-a',requests:-1}]}},{callEvidence:{matches:[null],reads:[null]}}]){const h=harness({items:[item(extra)]}),facts=h.text(h.facts());assert.match(facts,/Recorded calls: unknown.*Explicit Read requests: unknown/);assert.doesNotMatch(facts,/0 recorded|0 explicit/);assert.equal(h.calls.length,0);}
  for(const supported of [undefined,false]){const h=harness({items:[item({callEvidence:{matches:[],reads:[{assetId:'skill-a',requests:2}]}})],evidence:snapshot({fileReadCoverage:supported===undefined?undefined:{supported}})});assert.match(h.text(h.facts()),supported===false?/collection unsupported/:/Explicit Read requests: unknown/);assert.doesNotMatch(h.text(h.card()),/2 explicit Read/);}
});

test('foreign or missing snapshots cannot lend counts, names, Reads or filter use to this scope',()=>{
  for(const evidence of [null,snapshot({agent:'codex'}),snapshot({repo:'/synthetic/other'}),{agent:'claude'}]) {
    const h=harness({items:[item({callEvidence:{matches:[{kind:'mcp',name:'foreign-name',calls:8}],reads:[{assetId:'skill-a',requests:7}]}})],evidence});const facts=h.text(h.facts());assert.match(facts,/Recorded calls: unknown.*Explicit Read requests: unknown/);assert.doesNotMatch(h.text(h.card()),/foreign-name|8 recorded|7 explicit/);h.node('component-filter').value='unknown';h.render();assert.equal(h.node('component-list').children[0].dataset.componentId,'skill-a');assert.equal(h.effects.length,0);
  }
});

test('legacy supported coverage absent cannot turn empty or positive Reads into collected evidence',()=>{
  for(const reads of [[],[{assetId:'skill-a',requests:4}]]) {
    const h=harness({items:[item({callEvidence:{matches:[],reads}})],evidence:snapshot({fileReadCoverage:undefined})});assert.match(h.text(h.facts()),/Explicit Read requests: unknown/);assert.doesNotMatch(h.text(h.card()),/4 explicit Read|0 explicit Read/);h.node('component-filter').value='unknown';h.render();assert.equal(h.node('component-list').children[0].dataset.componentId,'skill-a');
  }
});

test('MCP name matches remain source-unverified even without the ambiguous flag',()=>{
  const h=harness({items:[item({callEvidence:{matches:[{kind:'mcp',name:'fixture-tool',calls:1}],ambiguous:false,reads:[]}})]});assert.match(h.text(h.facts()),/1 recorded call.*Name\/source match unresolved/);assert.doesNotMatch(h.text(h.facts()),/loaded|successful|beneficial/);
});

test('fractional or unsafe call counts stay unknown in facts and details without inventing result counts',()=>{
  for(const field of ['calls','resultsSeen','failed'])for(const invalid of [1.5,Number.MAX_SAFE_INTEGER+1]) {
    const h=harness({items:[item({callEvidence:{matches:[{kind:'skill',name:'fixture',calls:1,resultsSeen:1,failed:0,[field]:invalid}],reads:[]}})]});
    const detail=h.descendants(h.details('component-evidence-details')).find(node=>node.className==='call-evidence'),row=h.descendants(detail).find(node=>node.tag==='li');
    if(field==='calls'){assert.match(h.text(h.facts()),/Recorded calls: unknown/);assert.match(detail.children[0].textContent,/Call count unknown/);assert.match(row.textContent,/Call count unknown/);}
    else{assert.match(h.text(h.facts()),/1 recorded call/);assert.match(detail.children[0].textContent,/1 recorded call.*Result\/error counts unknown/);assert.match(row.textContent,/1 recorded call.*Result\/error counts unknown/);}
    assert.doesNotMatch(detail.children[0].textContent,/1\.5|9007199254740992/);assert.doesNotMatch(row.textContent,/1\.5|9007199254740992/);
  }
  const h=harness({items:[item({callEvidence:{matches:[{calls:Number.MAX_SAFE_INTEGER,resultsSeen:0,failed:0},{calls:1,resultsSeen:0,failed:0}],reads:[]}})]});const detail=h.descendants(h.details('component-evidence-details')).find(node=>node.className==='call-evidence');assert.match(h.text(h.facts()),/Recorded calls: unknown/);assert.match(detail.children[0].textContent,/Call count unknown/);
});

test('changed manual notes and partial/stale tool snapshots stay visible and choose the proper next check',()=>{
  const h=harness({items:[item({review:{status:'used',changed:true,lastUsed:'2026-02-30',note:'Earlier note'},canInspectTools:true,toolInspection:{servers:[],fileChanged:true,coverage:{partial:true}},callEvidence:{matches:[],reads:[]}})],evidence:snapshot({coverage:{partial:true}})});const facts=h.text(h.facts());assert.match(facts,/use date unknown.*earlier file version/);assert.match(facts,/Changed since review/);assert.match(facts,/Configuration changed since inspection.*Tool inspection is partial/);assert.match(h.text(h.card()),/Next check: Review your kept note/);h.find('Open file').listeners.click();assert.deepEqual(h.effects,[['editor','skill-a']]);
  const config=harness({items:[item({type:'config',canInspectTools:true,toolInspection:{servers:[],fileChanged:true,coverage:{partial:false}}})]});assert.match(config.text(config.card()),/Next check: Inspect the configuration/);
});

test('related change tests require exact working scope and asset, show newest three and an honest omitted count',()=>{
  const records=[record('1'),record('2'),record('3'),record('4'),record('5',{repo:''}),record('6',{repo:'/synthetic/other'}),record('7',{agent:'codex'}),record('8',{assetIds:['another']}),record('9',{repo:undefined})];const h=harness({records});const related=h.details('component-tests'),text=h.text(related);assert.match(h.text(h.facts()),/4 related change tests are recorded/);assert.deepEqual(related.children.filter(row=>row.className==='component-test-row').map(row=>row.children[0].textContent),['Recorded 4','Recorded 3','Recorded 2']);assert.match(text,/Showing 3 of 4 related tests; 1 omitted/);assert.doesNotMatch(text,/Recorded [156789]/);assert.match(text,/Historical manually supplied change samples/);
  h.find('Review test').listeners.click();assert.equal(h.effects[0][1].id,'4');assert.equal(h.effects[0][1].repo,repo);h.find('See all tests for this agent and scope').listeners.click();assert.equal(h.context.location.hash,'dashboard');assert.equal(h.node('improvement-panel').open,true);
});

test('improved or kept historical tests, missing/stale captures and multiple assets never establish component benefit',()=>{
  const records=[record('1',{assessment:{ready:true,verdict:'improved'},decision:{decision:'keep'},assetIds:['skill-a','another'],inventorySource:{items:[{id:'skill-a',path:'/synthetic/old/SKILL.md',contentHash:'old'}]}}),record('2',{assessment:{ready:false,verdict:'improved'}}),record('3',{assessment:null})];const h=harness({records}),text=h.text(h.details('component-tests'));assert.match(h.text(h.facts()),/Measured benefit: unknown/);assert.match(text,/Current source and component benefit remain unknown/);assert.match(text,/selected 2 assets.*cannot be attributed to this file alone/);assert.match(text,/Captured file metadata is unavailable/);assert.match(text,/Captured metadata is available; confirm it/);assert.doesNotMatch(text,/improved in|kept change|benefit proven/);
});

test('global related tests stay exact global scope and cannot borrow a repository test',()=>{
  const h=harness({records:[record('1',{repo:''}),record('2')]});h.context.activeRepo='';h.context.loading.components.usageEvidence=snapshot({repo:''});h.render();assert.match(h.text(h.facts()),/1 related change test is recorded/);h.find('Review test').listeners.click();assert.equal(h.effects[0][1].repo,'');assert.equal(h.effects[0][1].id,'1');
});

test('opening a picker is explicit and stale card callbacks cannot retarget editor, chat, tests or inspection',async()=>{
  const h=harness({evidence:null});assert.equal(h.effects.length,0);h.find('Choose sessions').listeners.click();assert.deepEqual(h.effects,[['sessions','claude',repo]]);assert.equal(h.calls.length,0);
  const config=harness({items:[item({canInspectTools:true})],records:[record('1')]});const buttons=['Open file','Ask about this component','Test one improvement','Inspect configured tools','Review test','Recorded 1'].map(label=>config.find(label));config.context.activeRepo='/synthetic/other';config.context.selectedAgent='codex';for(const button of buttons)await button.listeners.click({currentTarget:button});assert.equal(config.effects.length,0);assert.equal(config.calls.length,0);
  const valid=harness({items:[item({canInspectTools:true})]});await valid.find('Inspect configured tools').listeners.click({currentTarget:valid.find('Inspect configured tools')});assert.deepEqual({...valid.calls[0].body},{id:'skill-a',agent:'claude',repo});assert.equal(valid.calls[0].path,'/api/tool-inspection');
});

test('file details, related disclosure and scoped manual drafts survive rerenders and scope switches',()=>{
  const h=harness({records:[record('1')]});for(const name of ['component-evidence-details','component-file-details','component-tests']){const disclosure=h.details(name);disclosure.open=true;disclosure.listeners.toggle();}
  const fields=h.descendants(h.card()),form=fields.find(node=>node.tag==='form'),note=fields.find(node=>node.name==='component-note');note.value='Recoverable task note';form.listeners.input();h.render();assert.equal(h.details('component-evidence-details').open,true);assert.equal(h.details('component-file-details').open,true);assert.equal(h.details('component-tests').open,true);assert.equal(h.details('component-review').open,true);
  h.context.activeRepo='/synthetic/other';h.render();assert.equal(h.details('component-evidence-details').open,false);assert.equal(h.details('component-file-details').open,false);assert.equal(h.descendants(h.card()).find(node=>node.name==='component-note').value,'');h.context.activeRepo=repo;h.render();assert.equal(h.details('component-evidence-details').open,true);assert.equal(h.details('component-file-details').open,true);assert.equal(h.descendants(h.card()).find(node=>node.name==='component-note').value,'Recoverable task note');assert.equal(h.effects.length,0);
});

test('untrusted names, descriptions, notes and recorded titles stay text without arbitrary extra evidence',()=>{
  const malicious='<img src=x onerror="synthetic()">';const h=harness({items:[item({name:malicious,description:malicious,review:{status:'review',note:malicious},callEvidence:{matches:[{kind:'mcp',name:malicious,calls:2,privatePrompt:'do-not-display'}],reads:[]}})],records:[record('1',{title:malicious,prompt:'do-not-display'})]});const text=h.text(h.card());assert.ok(text.includes(malicious));assert.doesNotMatch(text,/do-not-display/);assert.equal(h.descendants(h.card()).some(node=>['img','script'].includes(node.tag)),false);assert.equal(h.effects.length,0);assert.equal(h.calls.length,0);
});

const taskReview=(helpfulness,extra={})=>({agent:'claude',repo,status:'unknown',helpfulness,note:'Task: format a report. Effect: more corrections were needed.',at:'2026-10-02T00:00:00.000Z',...extra});
test('reported task helpfulness coexists with manual use and never becomes measured benefit',()=>{
  const h=harness({items:[item({review:taskReview('not-helped',{status:'used',lastUsed:'2026-10-01'})})]}),facts=h.text(h.facts());assert.match(facts,/Manual use recorded on 2026-10-01/);assert.match(facts,/For the task in your note, you reported it did not help.*recorded 2026-10-02/);assert.match(facts,/your assessment; what caused the outcome is unknown/);assert.match(facts,/Measured benefit: unknown/);assert.match(h.text(h.card()),/Next check: Test one change/);h.node('component-filter').value='unknown';h.render();assert.equal(h.card(),undefined);assert.equal(h.effects.length,0);assert.equal(h.calls.length,0);
});

test('task outcome alone does not add use evidence or skip inspection and related-test priorities',()=>{
  const h=harness({items:[item({review:taskReview('helped')})]}),facts=h.text(h.facts());assert.match(facts,/Manual use: unknown|Manual note recorded; use is unknown/);assert.match(facts,/reported it helped/);h.node('component-filter').value='unknown';h.render();assert.ok(h.card());h.find('Test one improvement').listeners.click();assert.equal(h.effects[0][0],'test');assert.deepEqual([...h.effects[0][3]],['skill-a']);
  const config=harness({items:[item({review:taskReview('mixed'),canInspectTools:true})]});assert.match(config.text(config.card()),/Next check: Inspect the configuration/);const related=harness({items:[item({review:taskReview('not-helped')})],records:[record('1')]});assert.match(related.text(related.card()),/Next check: Review the latest/);
});

test('reported-no-help filter includes only current exact-scope not-helped or mixed assessments',()=>{
  const rows=[item({id:'no-help',review:taskReview('not-helped')}),item({id:'mixed',review:taskReview('mixed')}),item({id:'helped',review:taskReview('helped')}),item({id:'changed',review:taskReview('not-helped',{changed:true})}),item({id:'foreign',review:taskReview('mixed',{repo:'/synthetic/other'})}),item({id:'agent',review:taskReview('not-helped',{agent:'codex'})}),item({id:'legacy',review:{status:'review',note:'Legacy note'}})];const h=harness({items:rows});h.node('component-filter').value='reported-no-help';h.render();assert.deepEqual(h.node('component-list').children.map(card=>card.dataset.componentId),['mixed','no-help']);h.context.activeRepo='/synthetic/other';h.render();assert.deepEqual(h.node('component-list').children.map(card=>card.dataset.componentId),['foreign']);assert.equal(h.effects.length,0);assert.equal(h.calls.length,0);
  const changed=harness({items:[rows[3]]});assert.match(changed.text(changed.facts('changed')),/reported it did not help for an earlier file version/);assert.match(changed.text(changed.card('changed')),/Next check: Review your kept note/);
});

test('legacy, malformed and foreign outcomes are unknown in facts and form without rendering arbitrary enum text',()=>{
  for(const review of [taskReview(undefined),taskReview(null),taskReview('<img onerror="run()">'),taskReview('helped',{note:''}),taskReview('helped',{agent:undefined}),taskReview('helped',{repo:undefined}),taskReview('helped',{repo:'/synthetic/other'})]){const h=harness({items:[item({review})]});assert.match(h.text(h.facts()),/Task helpfulness: unknown/);assert.doesNotMatch(h.text(h.facts()),/you reported|<img/);assert.equal(h.descendants(h.card()).find(node=>node.name==='component-helpfulness').value,'unknown');assert.equal(h.calls.length,0);assert.equal(h.effects.length,0);}
  const invalidDate=harness({items:[item({review:taskReview('mixed',{at:'not-a-date'})})]});assert.match(invalidDate.text(invalidDate.facts()),/mixed results.*recording date unknown/);
});

test('outcome drafts and closed review disclosure survive polling and untrusted task notes remain text',()=>{
  const note='<img onerror="run()"> task effect',h=harness({items:[item({review:taskReview('mixed',{note})})]}),fields=h.descendants(h.card()),form=fields.find(node=>node.tag==='form'),outcome=fields.find(node=>node.name==='component-helpfulness');assert.equal(outcome.value,'mixed');assert.equal(h.details('component-review').children[0].textContent,'Record use or a task outcome');outcome.value='not-helped';outcome.listeners.change();form.listeners.change();h.details('component-review').open=false;h.details('component-review').listeners.toggle();h.render();assert.equal(h.details('component-review').open,false);assert.equal(h.descendants(h.card()).find(node=>node.name==='component-helpfulness').value,'not-helped');assert.equal(h.descendants(h.card()).find(node=>node.name==='component-note').value,note);assert.ok(h.text(h.details('component-evidence-details')).includes(note));assert.equal(h.descendants(h.card()).some(node=>node.tag==='img'),false);assert.equal(h.calls.length,0);assert.equal(h.effects.length,0);
});

test('explicit component advice distinguishes reported task helpfulness from measured benefit without dispatch',()=>{
  const h=harness({items:[item({review:taskReview('helped')})]}),opened=[];h.context.selectedIds=new Set();h.context.openChat=(...args)=>opened.push(args);h.context.updateRouteNote=()=>{};vm.runInContext(slice('function openComponentChat(', 'function renderBeginnerHealth('),h.context);h.find('Ask about this component').listeners.click();assert.equal(opened.length,1);assert.match(opened[0][1],/user-reported task helpfulness.*not measured benefit or proof of what caused/);assert.match(opened[0][1],/earlier file version/);assert.deepEqual([...opened[0][4]],['skill-a']);assert.equal(h.calls.length,0);
});
