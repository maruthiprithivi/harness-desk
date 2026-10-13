import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/app.js', import.meta.url),'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url),'utf8');
const slice = (start,end) => source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const loadingCode = slice('function portableDirectory(', 'function usageCounts(');
const loadingChat = slice('function openLoadingChat()', 'function editorValue()');
const chatCode = slice('function showChatTab(', 'function updateChatAvailability()');
const selectionCode = slice('function updateSelection()', 'function budgetMetric(');
const routeCode = slice('function updateRouteNote()', 'function configureChat()');
const root = '/synthetic/repo-a', folder = root + '/src';
const map = ({repo = root,agent = 'codex',launchDirectory = repo,directories = [repo,repo+'/src'],...extra} = {}) => ({repo,agent,launchDirectory,directories,groups:[],summary:{applies:0},notes:[],observation:null,...extra});

function harness({api = async body => map(body)} = {}) {
  const nodes = new Map(), calls = [], rendered = [], observations = [], focuses = [];
  const node = id => {
    if (!nodes.has(id)) nodes.set(id,{value:'',textContent:'',hidden:false,disabled:false,options:[],children:[],dataset:{},style:{},listeners:{},classList:{toggle(){}},
      append(...items) { this.children.push(...items); },replaceChildren(...items) { this.children=items; },contains(child){return this===child||this.children.some(item=>item===child||item.contains?.(child));},setAttribute(){},
      querySelectorAll(){return [];},focus(options){context.document.activeElement=this;focuses.push({id,options:{...options}});},addEventListener(type,handler){this.listeners[type]=handler;},
    });
    return nodes.get(id);
  };
  const element = (tag,className = '',text = '') => ({tag,className,textContent:text,children:[],style:{},dataset:{},listeners:{},append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},contains(child){return this===child||this.children.some(item=>item===child||item.contains?.(child));},setAttribute(){},addEventListener(type,listener){this.listeners[type]=listener;}});
  const context = vm.createContext({
    $:node,element,button:(label,className,fn)=>({...element('button',className,label),click:fn}),badge:(text,tone)=>element('span',tone,text),empty:(title,detail)=>element('div','empty',title+' '+detail),
    setOptions(select,options,empty,preferred){select.options=options;select.value=preferred||options[0]?.value||'';},
    state:{csrfToken:'synthetic',inventory:{scannedAt:'one',items:[]},observations:[],agents:[{id:'codex'},{id:'claude'}]},
    activeRepo:root,selectedAgent:'codex',loading:undefined,loadingKey:'',loadingError:'',loadingSequence:0,loadingDirectoryNotice:'',loadingDirectories:new Map(),friendlyLimits:new Map(),
    beginnerTypes:new Set(['instruction','config']),restoredGuide:true,advanced:false,beginnerSelection:null,selectedIds:new Set(),pendingLoadingScope:null,pendingTaskScope:null,pendingGap:null,pendingImprovement:null,pendingPlan:null,activeChat:null,chatSnapshot:'',contextPreviewRequest:0,view:'dashboard',openedFrom:null,
    array:value=>Array.isArray(value)?value:[],number:String,tokens:String,date:String,time:()=>'',agentName:value=>value,repoName:value=>value,
    beginnerFileCount:()=>0,renderBeginnerHealth(){},renderComponents(){},renderUsageEvidence(){},updateStartGuide(){},renderContextBreakdowns(){rendered.push(context.activeRepo);},
    openObservation:fixed=>observations.push({fixed,repo:context.activeRepo,agent:context.selectedAgent}),openEditor(){},toast(){},
    loadingFiles:()=>context.loading?.groups.flatMap(group=>group.files)||[],filteredInventory:()=>[],includedIds:()=>[],
    chosenSections:()=>['inventory','context'],selectSections(){},configureChat(){},applyChatRoute(){},renderConversation(){},updateChatAvailability(){},effectiveRoute:()=>({agent:'codex'}),
    document:{activeElement:null,body:{style:{}}},setTimeout:fn=>fn(),
    clearError(){},showError(error){throw error;},
    api:async(path,body)=>{calls.push({path,body});return api(body,calls.length);},
  });
  vm.runInContext(slice('async function action(','function scopedItems(')+loadingCode+loadingChat+chatCode+selectionCode+routeCode,context);
  // Folder attribution uses the shared hierarchy; canvas interaction has its own DOM suite.
  context.renderLoadingBands=target=>context.renderConfigurationTree(node(target));
  const run = expression => vm.runInContext(expression,context);
  const text = item => [item.textContent,...item.children.map(text)].join(' ');
  return {context,node,calls,run,text,rendered,observations,focuses};
}

test('root is the default and mirrored selectors contain only returned discovered folders',async()=>{
  const h=harness();await h.run('refreshLoading()');
  assert.deepEqual({...h.calls[0].body},{repo:root,agent:'codex'});
  for(const prefix of ['loading','files']){
    assert.equal(h.node(prefix+'-directory-control').hidden,false);
    assert.equal(h.node(prefix+'-directory').value,root);
    assert.deepEqual(Array.from(h.node(prefix+'-directory').options,item=>item.label),['Repository root','src']);
  }
  assert.match(html,/id="loading-directory"/);assert.match(html,/id="files-directory"/);
  h.run("chooseLoadingDirectory('/synthetic/not-discovered')");assert.equal(h.calls.length,1);
});

test('setup is closed initially, advertises adding folders and retains deliberate expansion across file-map polls',async()=>{
  assert.match(html,/<details id="setup-guide"><summary>Set up your coding agent or add a repository folder<\/summary>/);assert.match(html,/id="setup-folder-form"/);assert.match(html,/id="setup-probe"/);assert.match(html,/id="setup-explain"/);assert.match(html,/id="repo-select"/);assert.match(html,/id="beginner-agent-select"/);
  for(const [preference,opened,expected]of [['closed',false,false],['closed',true,true],['done',true,false]]){const h=harness();h.context.restoredGuide=false;h.context.preference=()=>preference;h.node('setup-guide').open=opened;await h.run('refreshLoading()');assert.equal(h.node('setup-guide').open,expected);h.node('setup-guide').open=true;await h.run('refreshLoading(true)');assert.equal(h.node('setup-guide').open,true);assert.deepEqual(h.calls.map(call=>call.path),['/api/loading','/api/loading']);}
});

test('a pending and failed file map clears a prior discovery warning without closing supporting disclosures',async()=>{
  let reject;const h=harness({api:()=>new Promise((resolve,fail)=>{reject=fail;})});h.node('beginner-health-warning').hidden=false;h.node('beginner-health-warning').textContent='Prior discovery warning';h.node('beginner-health-details').open=true;const pending=h.run('refreshLoading()');assert.equal(h.node('beginner-health-warning').hidden,true);assert.equal(h.node('beginner-health-warning').textContent,'');reject(new Error('Synthetic map unavailable'));await pending;assert.equal(h.node('beginner-health-warning').hidden,true);assert.equal(h.node('beginner-health-details').open,true);assert.equal(h.calls.length,1);
});

test('starting files precede optional readings while launch scope and inferred status stay visible',()=>{
  const start=html.indexOf('<div class="context-file-map">'),end=html.indexOf('<div id="context-breakdown-beginner">',start),mapHTML=html.slice(start,end);assert.ok(mapHTML.indexOf('id="loading-directory-control"')<mapHTML.indexOf('id="beginner-loading"'));assert.ok(mapHTML.indexOf('id="beginner-loading"')<mapHTML.indexOf('id="loading-readings"'));assert.ok(mapHTML.indexOf('id="loading-readings"')<mapHTML.indexOf('id="loading-observation"'));assert.match(mapHTML,/<details id="loading-readings" class="supporting-evidence"><summary>Context readings and estimates<\/summary>/);assert.match(mapHTML,/Inferred from files/);assert.match(mapHTML,/id="loading-notes"/);
});

test('global and root-only maps hide both folder controls',async()=>{
  const h=harness({api:async body=>map({...body,directories:body.repo?[body.repo]:[]})});
  await h.run('refreshLoading()');assert.equal(h.node('loading-directory-control').hidden,true);assert.equal(h.node('files-directory-control').hidden,true);
  h.context.activeRepo='';await h.run('refreshLoading()');assert.equal(h.node('loading-directory-control').hidden,true);assert.equal(h.node('files-directory-control').hidden,true);
});

test('folder choices survive polls and switches and stay separate for each repository and agent',async()=>{
  const h=harness();await h.run('refreshLoading()');h.run(`chooseLoadingDirectory('${folder}')`);await new Promise(setImmediate);
  assert.equal(h.calls.at(-1).body.launchDirectory,folder);assert.equal(h.node('files-directory').value,folder);
  const count=h.calls.length;await h.run('refreshLoading()');assert.equal(h.calls.length,count);
  h.context.selectedAgent='claude';await h.run('refreshLoading()');assert.equal('launchDirectory' in h.calls.at(-1).body,false);
  h.context.activeRepo='/synthetic/repo-b';h.context.selectedAgent='codex';await h.run('refreshLoading()');assert.equal('launchDirectory' in h.calls.at(-1).body,false);
  h.context.activeRepo=root;await h.run('refreshLoading()');assert.equal(h.calls.at(-1).body.launchDirectory,folder);
});

test('Windows paths get relative labels while root recognition follows API normalization',()=>{
  const h=harness();assert.equal(h.run("loadingDirectoryLabel('c:/work/repo/src/deep','C:\\\\Work\\\\Repo\\\\')"),'src/deep');
  assert.equal(h.run("loadingDirectoryLabel('c:/work/repo','C:\\\\Work\\\\Repo')"),'Repository root');
});

test('pending refresh retains the chosen selector and stale response cannot overwrite the latest folder',async()=>{
  let firstRelease,secondRelease;
  const h=harness({api:(body,index)=>index===1?Promise.resolve(map(body)):new Promise(resolve=>{if(index===2)firstRelease=()=>resolve(map(body));else secondRelease=()=>resolve(map(body));})});
  await h.run('refreshLoading()');h.run(`chooseLoadingDirectory('${folder}')`);
  assert.equal(h.node('loading-directory').value,folder);assert.equal(h.node('files-directory').value,folder);assert.equal(h.node('loading-directory').disabled,true);
  h.context.loadingDirectories.delete(JSON.stringify([root,'codex']));const newest=h.run('refreshLoading(true)');
  secondRelease();await newest;assert.equal(h.node('loading-directory').value,root);
  firstRelease();await new Promise(setImmediate);assert.equal(h.context.loading.launchDirectory,root);assert.equal(h.node('files-directory').value,root);
});

test('only the documented missing-folder error triggers one root fallback and visible disclosure',async()=>{
  const message='Launch directory must be a discovered instruction folder in the selected repository.';
  const h=harness({api:async body=>{if(body.launchDirectory)throw new Error(message);return map({...body,directories:[body.repo]});}});
  h.context.loadingDirectories.set(JSON.stringify([root,'codex']),folder);await h.run('refreshLoading()');
  assert.equal(h.calls.length,2);assert.equal(h.calls[1].body.launchDirectory,undefined);assert.equal(h.context.loadingDirectories.size,0);
  assert.match(h.node('loading-summary').textContent,/no longer.*repository root/);assert.match(h.node('beginner-files-note').textContent,/Showing the repository root/);
  await h.run('refreshLoading()');assert.equal(h.calls.length,2);
  const other=harness({api:async()=>{throw new Error('Permission denied');}});other.context.loadingDirectories.set(JSON.stringify([root,'codex']),folder);await other.run('refreshLoading()');
  assert.equal(other.calls.length,1);assert.equal(other.context.loadingDirectories.size,1);assert.match(other.node('loading-summary').textContent,/Permission denied/);
});

test('a failed root fallback is not retried in a loop',async()=>{
  const h=harness({api:async()=>{throw new Error('Launch directory must be a discovered instruction folder in the selected repository.');}});
  h.context.loadingDirectories.set(JSON.stringify([root,'codex']),folder);await h.run('refreshLoading()');assert.equal(h.calls.length,2);assert.equal(h.context.loading,null);
});

test('in-place file-map retry recovers the retained selected folder without scanning or setup navigation',async()=>{
  let rejectMap,resolveMap;const h=harness({api:(body,index)=>new Promise((resolve,reject)=>{if(index===1)rejectMap=reject;else resolveMap=()=>resolve(map({...body,groups:[{id:'repo',files:[{id:'folder-guide',name:'Folder guide',type:'instruction',repo:root,path:folder+'/AGENTS.md',status:'applies'}]}]}));})});h.context.loadingDirectories.set(JSON.stringify([root,'codex']),folder);
  const failed=h.run('refreshLoading()');rejectMap(new Error('Local loading unavailable'));await failed;assert.equal(h.context.loadingDirectories.get(JSON.stringify([root,'codex'])),folder);assert.match(h.text(h.node('loading-observation')),/file map is unavailable/);assert.doesNotMatch(h.text(h.node('beginner-file-bands')),/Return to Start here/);
  const retry=h.node('beginner-file-bands').children[0].children.find(node=>node.tag==='button');assert.equal(retry.textContent,'Retry file map');retry.click();retry.click();assert.equal(h.calls.length,2);assert.equal(retry.disabled,true);assert.equal(h.context.document.activeElement,h.node('beginner-files-note'));assert.deepEqual(h.focuses,[{id:'beginner-files-note',options:{preventScroll:true}}]);assert.deepEqual(h.calls.map(call=>({...call.body})),[{repo:root,agent:'codex',launchDirectory:folder},{repo:root,agent:'codex',launchDirectory:folder}]);resolveMap();await new Promise(setImmediate);
  assert.equal(h.context.loading.launchDirectory,folder);assert.equal(h.node('loading-directory').disabled,false);assert.equal(h.node('files-directory').disabled,false);assert.equal(h.node('loading-directory').value,folder);assert.equal(h.node('files-directory').value,folder);assert.match(h.text(h.node('beginner-loading')),/Folder guide/);assert.match(h.text(h.node('beginner-file-bands')),/Folder guide/);assert.doesNotMatch(h.text(h.node('loading-observation')),/unavailable|Waiting/);assert.equal(h.context.loadingError,'');assert.equal(h.context.document.activeElement,h.node('beginner-files-note'));assert.match(h.node('beginner-files-note').textContent,/codex.*repo-a.*Launch: src/);assert.deepEqual(h.calls.map(call=>call.path),['/api/loading','/api/loading']);retry.click();assert.equal(h.calls.length,2);assert.equal(h.focuses.length,1);
});

test('persistent map summaries expose native programmatic focus and polite status announcements',()=>{
  for(const id of ['loading-summary','beginner-files-note'])assert.match(html,new RegExp('<p id="'+id+'" tabindex="-1" role="status" aria-live="polite"'));
});

test('a failed missing-folder fallback retries the new repository root, never the removed folder',async()=>{
  const missing='Launch directory must be a discovered instruction folder in the selected repository.';const h=harness({api:async(body,index)=>{if(index===1)throw new Error(missing);if(index===2)throw new Error('Root map failed');return map({...body,directories:[root]});}});h.context.loadingDirectories.set(JSON.stringify([root,'codex']),folder);await h.run('refreshLoading()');assert.equal(h.calls.length,2);assert.equal(h.context.loadingDirectories.size,0);const retry=h.node('beginner-loading').children[0].children.find(node=>node.tag==='button');retry.click();await new Promise(setImmediate);assert.equal(h.calls.length,3);assert.deepEqual({...h.calls[2].body},{repo:root,agent:'codex'});assert.equal(h.context.loading.launchDirectory,root);assert.equal(h.context.loadingError,'');
});

test('nested cards show the launch chain and never pair an old repository reading with folder estimates',async()=>{
  const files=[['root','repository instruction'],['ancestor','ancestor directory instruction'],['current','launch directory instruction']].map(([id,role])=>({id,name:id,path:root+'/'+id+'/AGENTS.md',repo:root,type:'instruction',status:'applies',role}));
  const h=harness({api:async body=>map({...body,groups:[{id:'repo',files},{id:'conditional',files:[{id:'sibling',name:'sibling',repo:root,path:root+'/other/AGENTS.md',type:'instruction',role:'directory instruction',status:'conditional'}]}],observation:{startupTokens:999,at:'old'},repositoryObservation:{startupTokens:123,at:'2026-10-01'}})});
  h.context.loadingDirectories.set(JSON.stringify([root,'codex']),folder);await h.run('refreshLoading()');
  const bands=h.text(h.node('beginner-file-bands')),evidence=h.text(h.node('loading-observation'));
  assert.match(bands,/This folder and its ancestors/);assert.match(bands,/Repository instruction/);assert.match(bands,/Ancestor folder instruction/);assert.match(bands,/Current folder instruction/);assert.match(bands,/Conditional sibling or descendant/);
  assert.match(evidence,/No folder session reading/);assert.match(evidence,/Repository readings cannot be paired/);assert.match(evidence,/Repository reading only: 123 startup tokens on 2026-10-01/);assert.doesNotMatch(evidence,/999/);
  const record=h.node('loading-observation').children.find(item=>item.tag==='button');assert.equal(record.textContent,'Record repository reading');record.click();assert.deepEqual(h.observations,[{fixed:true,repo:root,agent:'codex'}]);
});

test('file-map chat captures root or nested folder and IDs before dashboard or answering agent changes',async()=>{
  const h=harness({api:async body=>map({...body,groups:[{id:'repo',files:[{id:'original',type:'instruction'}]}]})});
  h.context.loadingDirectories.set(JSON.stringify([root,'codex']),folder);await h.run('refreshLoading()');h.run('openLoadingChat()');
  assert.match(h.node('chat-prompt').value,/launching in src/);assert.match(h.node('chat-route-note').textContent,/Fixed file map: codex.*src/);
  h.context.activeRepo='/synthetic/repo-b';h.context.selectedAgent='claude';h.node('chat-agent').value='claude';await h.run('refreshLoading()');h.run('updateSelection(); updateRouteNote()');
  const payload=h.run('contextPayload()');assert.equal(payload.repo,root);assert.equal(payload.reviewAgent,'codex');assert.equal(payload.launchDirectory,folder);assert.equal(payload.selectionMode,'explicit');assert.deepEqual([...payload.selectedIds],['original']);assert.equal(payload.globalOnly,false);
  assert.match(h.node('chat-selection-note').textContent,/repo-a.*src/);assert.doesNotMatch(h.node('chat-selection-note').textContent,/repo-b/);
  h.run('openChat(["inventory"],"Ordinary request")');assert.equal(h.context.pendingLoadingScope,null);assert.equal('launchDirectory' in h.run('contextPayload()'),false);
});

test('global loading chats stay explicit and opening another conversation or new request clears folder binding',async()=>{
  const h=harness({api:async body=>map({...body,directories:[]})});h.context.activeRepo='';await h.run('refreshLoading()');h.run('openLoadingChat()');
  let payload=h.run('contextPayload()');assert.equal(payload.repo,'');assert.equal(payload.launchDirectory,'');assert.equal(payload.reviewAgent,'codex');assert.equal(payload.globalOnly,true);
  h.run('showChatTab(true); showChatTab(false)');assert.equal(h.context.pendingLoadingScope.agent,'codex');
  h.run('openLoadingChat(); newChat()');assert.equal(h.context.pendingLoadingScope,null);
  h.run('openLoadingChat(); openChat(null,undefined,{repo:"/synthetic/history",sections:[],selectedIds:[]})');assert.equal(h.context.pendingLoadingScope,null);assert.equal('launchDirectory' in h.run('contextPayload()'),false);
});

test('active conversation uses only its saved launch folder; other conversations do not inherit the dashboard folder',()=>{
  const h=harness();h.context.activeChat={repo:root,reviewAgent:'codex',launchDirectory:folder,selectedIds:['original'],sections:['context']};
  assert.equal(h.run('contextPayload()').launchDirectory,folder);
  h.context.activeChat={repo:root,selectedIds:[],sections:['context']};assert.equal('launchDirectory' in h.run('contextPayload()'),false);
  h.context.activeChat=null;h.context.loading=map();h.run('openLoadingChat()');assert.equal(h.run('contextPayload()').launchDirectory,root);
});

test('a stale missing-folder error cannot reset another scope or start a fallback request',async()=>{
  let rejectOld;
  const h=harness({api:(body,index)=>index===1?new Promise((resolve,reject)=>{rejectOld=reject;}):Promise.resolve(map(body))});
  h.context.loadingDirectories.set(JSON.stringify([root,'codex']),folder);
  const old=h.run('refreshLoading()');h.context.activeRepo='/synthetic/repo-b';await h.run('refreshLoading()');
  rejectOld(new Error('Launch directory must be a discovered instruction folder in the selected repository.'));await old;
  assert.equal(h.calls.length,2);assert.equal(h.context.loadingDirectories.get(JSON.stringify([root,'codex'])),folder);assert.equal(h.context.loading.repo,'/synthetic/repo-b');
});

test('repository snapshots remain explicitly unattributed to a selected folder while a map request is pending',()=>{
  const h=harness();h.context.loadingDirectories.set(JSON.stringify([root,'codex']),folder);
  h.context.panel=(title,description,body,button)=>{const item=h.context.element('div','panel',title+' '+description);item.append(body,button);return item;};
  h.context.state.contextCategories=[];h.context.state.contextBreakdowns=[];h.context.openContextBreakdown=()=>{};
  vm.runInContext(slice('const contextBreakdownIds =','function contextBreakdownDraft()'),h.context);
  h.run('renderContextBreakdowns()');assert.match(h.text(h.node('context-breakdown-beginner')),/Repository snapshot; launch folder not recorded/);
});

test('visiting History keeps an unsent file-map draft bound across dashboard changes',async()=>{
  const h=harness({api:async body=>map({...body,groups:[{id:'repo',files:[{id:'original',type:'instruction'}]}]})});
  h.context.loadingDirectories.set(JSON.stringify([root,'codex']),folder);await h.run('refreshLoading()');h.run('openLoadingChat(); showChatTab(true)');
  const prompt=h.node('chat-prompt').value;
  h.context.activeRepo='/synthetic/repo-b';h.context.selectedAgent='claude';await h.run('refreshLoading()');h.run('showChatTab(false)');
  assert.equal(h.node('chat-prompt').value,prompt);
  const payload=h.run('contextPayload()');assert.equal(payload.repo,root);assert.equal(payload.reviewAgent,'codex');assert.equal(payload.launchDirectory,folder);assert.deepEqual([...payload.selectedIds],['original']);
});

test('a partial repository reading stays unknown in a nested view',async()=>{
  const h=harness({api:async body=>map({...body,repositoryObservation:{startupTokens:null,at:'2026-10-01'}})});
  h.context.loadingDirectories.set(JSON.stringify([root,'codex']),folder);await h.run('refreshLoading()');
  const evidence=h.text(h.node('loading-observation'));assert.match(evidence,/Repository reading only: Unknown startup tokens/);assert.doesNotMatch(evidence,/Repository reading only: 0 startup tokens/);
});
