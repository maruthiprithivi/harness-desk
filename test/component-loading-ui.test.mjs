import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const slice=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const refresh=slice('async function refreshLoading(','function friendlyStatus(');
const components=slice('function sortComponents(','function openLoadingChat(');
const controls=slice('function updateControls()','function costBars(');
const repo='/synthetic/repo';
const item={id:'synthetic-skill',name:'Synthetic skill',type:'skill',path:'/synthetic/SKILL.md',residentTokens:3,bodyTokens:12};
const map=(extra={})=>({repo,agent:'claude',components:{items:[item]},...extra});

function harness(){
  const nodes=new Map(),calls=[],releases=[],focuses=[];
  const descendants=node=>[node,...node.children.flatMap(descendants)];
  const element=(tag='div',className='',textContent='')=>({tag,className,textContent:String(textContent),children:[],dataset:{},value:'',disabled:false,hidden:false,listeners:{},
    append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},contains(child){return descendants(this).includes(child);},addEventListener(type,fn){this.listeners[type]=fn;},setAttribute(name,value){this[name]=value;},set innerHTML(value){throw new Error('Status must stay text');}});
  const node=id=>{if(!nodes.has(id)){const value=element();value.focus=options=>{context.document.activeElement=value;focuses.push({id,options:{...options}});};nodes.set(id,value);}return nodes.get(id);};
  const context=vm.createContext({$:node,element,array:value=>Array.isArray(value)?value:[],number:String,tokens:String,date:String,time:String,agentName:String,repoName:String,repoPath:value=>value,agentOptions:()=>[],syncObservationScope(){},attentionGaps:()=>[],initialRender:false,
    badge:(text,tone)=>element('span',tone,text),empty:(title,description)=>element('div','empty',title+' '+description),button:(text,className,fn)=>{const button=element('button',className,text);button.listeners.click=fn;return button;},
    setOptions(node,options,placeholder,selected){node.value=selected??options[0]?.value??'';},matchingFileReads:()=>[],appendFileReadEvidence(){},
    state:{csrfToken:'synthetic',inventory:{scannedAt:'2026-10-01',repos:[repo],items:Array.from({length:7},(_,index)=>({id:'inventory-'+index,type:'skill',agent:'claude'}))},agents:[]},loading:map(),loadingError:'',loadingKey:'',loadingSequence:0,loadingDirectoryNotice:'',loadingDirectories:new Map(),
    activeRepo:repo,selectedAgent:'claude',advanced:false,document:{activeElement:null},componentPage:0,componentDrafts:new Map(),componentReviewPending:new Map(),componentDisclosures:new Map(),selectedIds:new Set(['selected-synthetic']),
    renderLoading(){context.renderComponents();},beginnerFileCount:()=>context.loading?.components?.items?.length?7:0,renderContextBreakdowns(){},updateStartGuide(){},openEditor(){throw new Error('Unexpected editor');},openComponentChat(){throw new Error('Unexpected provider');},openImprovement(){throw new Error('Unexpected improvement');},clearError(){},showError(error){throw error;},updateChatAvailability(){},toast(){},
    api:(path,body)=>{calls.push({path,body:JSON.parse(JSON.stringify(body))});return new Promise((resolve,reject)=>releases.push({resolve,reject}));},
  });
  vm.runInContext(slice('async function action(','function scopedItems(')+refresh+components+controls,context);
  const text=node=>[node.textContent,...node.children.map(text)].join(' ');
  const retry=()=>node('component-list').children.find(node=>node.tag==='button');
  node('inventory-count').textContent='7';
  context.renderComponents();
  return{context,node,calls,releases,focuses,descendants,text,retry};
}

test('pending discovery clears stale cards, summary and pagination without claiming zero or absence',async()=>{
  const h=harness();assert.match(h.node('component-summary').textContent,/1 matching components/);assert.match(h.text(h.node('component-pagination')),/Showing 1–1 of 1/);
  assert.equal(h.node('inventory-count').textContent,'7');const pending=h.context.refreshLoading();assert.equal(h.context.loading,null);assert.equal(h.retry(),undefined);assert.equal(h.node('inventory-count').textContent,'…');
  assert.match(h.node('component-summary').textContent,/Component discovery is loading.*claude.*\/synthetic\/repo.*Counts and use are unknown/);assert.match(h.text(h.node('component-list')),/Loading skills & tools.*Discovery and recorded use are unknown/);
  assert.equal(h.node('component-pagination').children.length,0);assert.doesNotMatch(h.text(h.node('component-list')),/No components match|No skills|Synthetic skill/);assert.doesNotMatch(h.node('component-summary').textContent,/0 matching|1 matching/);
  h.releases[0].resolve(map());await pending;assert.match(h.node('component-summary').textContent,/1 matching components/);assert.equal(h.node('component-list').children[0].dataset.componentId,item.id);
});

test('a rejected load exposes generic scoped retry and duplicate clicks launch one metadata request',async()=>{
  const h=harness(),pending=h.context.refreshLoading();h.releases[0].reject(new Error('Synthetic private transport marker'));await pending;
  assert.match(h.node('component-summary').textContent,/Component discovery is unavailable.*claude.*\/synthetic\/repo.*Counts and use are unknown/);assert.match(h.text(h.node('component-list')),/Skills & tools unavailable/);assert.doesNotMatch(h.text(h.node('component-list')),/Synthetic private transport marker/);assert.equal(h.node('component-pagination').children.length,0);assert.equal(h.node('inventory-count').textContent,'Unknown');
  const retry=h.retry();assert.equal(retry.textContent,'Retry');retry.listeners.click();retry.listeners.click();assert.equal(h.calls.length,2);assert.equal(h.retry(),undefined);assert.match(h.node('component-summary').textContent,/discovery is loading/);
  assert.deepEqual(h.calls,[{path:'/api/loading',body:{repo,agent:'claude'}},{path:'/api/loading',body:{repo,agent:'claude'}}]);
  h.releases[1].resolve(map());await new Promise(setImmediate);assert.equal(h.retry(),undefined);assert.match(h.node('component-summary').textContent,/1 matching components/);assert.equal(h.context.loadingError,'');
});

test('advanced workspace inventory badge remains its legitimate count while the selected map loads or fails',async()=>{
  const h=harness();h.context.advanced=true;const pending=h.context.refreshLoading();assert.equal(h.node('inventory-count').textContent,'7');
  h.releases[0].reject(new Error('Synthetic failure'));await pending;assert.equal(h.node('inventory-count').textContent,'7');assert.match(h.node('component-summary').textContent,/discovery is unavailable/);
});

test('actual polling controls keep beginner pending and failed badges unknown while advanced and loaded counts remain numeric',async()=>{
  const h=harness(),pending=h.context.refreshLoading();h.context.updateControls();assert.equal(h.node('inventory-count').textContent,'…');
  h.context.advanced=true;h.context.updateControls();assert.equal(h.node('inventory-count').textContent,'7');h.context.advanced=false;h.context.updateControls();assert.equal(h.node('inventory-count').textContent,'…');
  h.releases[0].reject(new Error('Synthetic failure'));await pending;h.context.updateControls();assert.equal(h.node('inventory-count').textContent,'Unknown');
  h.context.advanced=true;h.context.updateControls();assert.equal(h.node('inventory-count').textContent,'7');h.context.advanced=false;h.context.updateControls();assert.equal(h.node('inventory-count').textContent,'Unknown');
  h.context.loading=map({components:{items:[]}});h.context.loadingError='';h.context.updateControls();assert.equal(h.node('inventory-count').textContent,'0');
  h.context.loading=map();h.context.updateControls();assert.equal(h.node('inventory-count').textContent,'7');assert.equal(h.calls.length,1);
});

test('changing controls and rerendering during pending and failed discovery never fabricates an empty match result',async()=>{
  const h=harness(),pending=h.context.refreshLoading();
  for(const [phase,search,filter,sort] of [['loading','Pending search','tools','cost'],['unavailable','Failed search','review','review']]){
    if(phase==='unavailable'){h.releases[0].reject(new Error('Synthetic failure'));await pending;}
    h.node('component-search').value=search;h.node('component-filter').value=filter;h.node('component-sort').value=sort;h.context.renderComponents();
    assert.match(h.node('component-summary').textContent,new RegExp('Component discovery is '+phase+'.*Counts and use are unknown'));
    assert.doesNotMatch(h.node('component-summary').textContent,/0 matching components/);assert.doesNotMatch(h.text(h.node('component-list')),/No components match/);assert.equal(h.node('component-pagination').children.length,0);
    assert.equal(!!h.retry(),phase==='unavailable');assert.equal(h.node('component-search').value,search);assert.equal(h.node('component-filter').value,filter);assert.equal(h.node('component-sort').value,sort);assert.equal(h.calls.length,1);
  }
});

for(const change of [{activeRepo:''},{activeRepo:'/synthetic/other'},{selectedAgent:'codex'}])for(const fail of [false,true])test(`a stale ${fail?'error':'response'} cannot overwrite the latest scope ${JSON.stringify(change)}`,async()=>{
  const h=harness(),old=h.context.refreshLoading();Object.assign(h.context,change);const current=h.context.refreshLoading();
  const latest=map({repo:h.context.activeRepo,agent:h.context.selectedAgent,components:{items:[{...item,id:'latest-skill',name:'Latest skill'}]}});h.releases[1].resolve(latest);await current;
  const summary=h.node('component-summary').textContent,list=h.node('component-list').children[0];
  if(fail)h.releases[0].reject(new Error('Synthetic stale transport marker'));else h.releases[0].resolve(map({components:{items:[]}}));await old;
  assert.equal(h.context.loading,latest);assert.equal(h.context.loadingError,'');assert.equal(h.node('component-summary').textContent,summary);assert.equal(h.node('component-list').children[0],list);assert.equal(h.retry(),undefined);assert.equal(h.calls.length,2);
});

for(const change of [{activeRepo:''},{activeRepo:'/synthetic/other'},{selectedAgent:'codex'}])test(`an old retry button cannot retarget a changed scope ${JSON.stringify(change)}`,async()=>{
  const h=harness(),pending=h.context.refreshLoading();h.releases[0].reject(new Error('Synthetic failure'));await pending;const old=h.retry();Object.assign(h.context,change);old.listeners.click();assert.equal(h.calls.length,1);
  const current=h.context.refreshLoading();old.listeners.click();assert.equal(h.calls.length,2);h.releases[1].resolve(map({repo:h.context.activeRepo,agent:h.context.selectedAgent}));await current;old.listeners.click();assert.equal(h.calls.length,2);
});

test('a same-scope old retry cannot restart a newer loading sequence',async()=>{
  const h=harness(),first=h.context.refreshLoading();h.releases[0].reject(new Error('Synthetic failure'));await first;const old=h.retry();
  const newer=h.context.refreshLoading(true);old.listeners.click();assert.equal(h.calls.length,2);h.releases[1].reject(new Error('New synthetic failure'));await newer;old.listeners.click();assert.equal(h.calls.length,2);assert.notEqual(h.retry(),old);
});

test('loading failures and retries preserve search, filter, sort, page, selection and unsaved scoped reviews',async()=>{
  const h=harness(),draft={status:'used',lastUsed:'2026-10-01',note:'Unsaved synthetic note'},key=JSON.stringify([item.id,'claude',repo]);h.context.componentDrafts.set(key,draft);
  h.node('component-search').value='Earlier search';h.node('component-filter').value='tools';h.node('component-sort').value='cost';h.context.componentPage=3;const selected=h.context.selectedIds;
  const pending=h.context.refreshLoading();h.releases[0].reject(new Error('Synthetic failure'));await pending;
  for(const [id,value] of [['component-search','Earlier search'],['component-filter','tools'],['component-sort','cost']])assert.equal(h.node(id).value,value);
  assert.equal(h.context.componentPage,3);assert.equal(h.context.componentDrafts.get(key),draft);assert.equal(h.context.selectedIds,selected);h.retry().listeners.click();
  assert.equal(h.context.componentPage,3);assert.equal(h.context.componentDrafts.get(key),draft);h.releases[1].resolve(map());await new Promise(setImmediate);
  assert.match(h.text(h.node('component-list')),/No components match/);assert.equal(h.node('component-search').value,'Earlier search');assert.equal(h.node('component-filter').value,'tools');assert.equal(h.node('component-sort').value,'cost');assert.equal(h.context.componentDrafts.get(key),draft);assert.equal(h.context.selectedIds,selected);
  h.node('component-search').value='';h.node('component-filter').value='';h.context.renderComponents();const card=h.node('component-list').children[0],fields=h.descendants(card);assert.equal(fields.find(node=>node.name==='component-note').value,draft.note);assert.equal(fields.find(node=>node.name==='component-status').value,'used');assert.deepEqual(h.calls.map(call=>call.path),['/api/loading','/api/loading']);
});

test('a successfully loaded empty component map retains its normal no-match view',async()=>{
  const h=harness(),pending=h.context.refreshLoading();h.releases[0].resolve(map({components:{items:[]}}));await pending;
  assert.match(h.node('component-summary').textContent,/0 matching components/);assert.match(h.text(h.node('component-list')),/No components match/);assert.match(h.text(h.node('component-pagination')),/No matches/);assert.equal(h.retry(),undefined);
});

const fileMapRetry=(h,target)=>h.descendants(h.node(target)).find(node=>node.tag==='button'&&node.textContent==='Retry file map');

test('both failed file maps offer one guarded loading retry and preserve component and suggestion drafts',async()=>{
  const h=harness(),draft={status:'used',lastUsed:'2026-10-01',note:'Local draft'},draftKey=JSON.stringify([item.id,'claude',repo]);h.context.componentDrafts.set(draftKey,draft);h.context.componentDisclosures.set(draftKey,{file:true,review:true});h.node('beginner-suggestions').open=true;h.node('beginner-suggestions-count').textContent=' · 9 to review';h.node('loading-notes').append({children:[],textContent:'Old scope method'});h.node('component-search').value='Synthetic';h.node('component-sort').value='cost';const selection=h.context.selectedIds;
  const failed=h.context.refreshLoading();h.releases[0].reject(new Error('Synthetic failure'));await failed;assert.match(h.text(h.node('loading-observation')),/selected file map is unavailable.*unknown/);assert.doesNotMatch(h.text(h.node('loading-observation')),/Waiting/);assert.doesNotMatch(h.text(h.node('loading-notes')),/Old scope/);assert.equal(h.node('beginner-suggestions').hidden,true);assert.equal(h.node('beginner-suggestions-count').textContent,'');assert.equal(h.node('beginner-suggestions').open,true);assert.match(h.node('usage-evidence-summary').textContent,/Retry file map/);
  const dashboard=fileMapRetry(h,'beginner-loading'),files=fileMapRetry(h,'beginner-file-bands');assert.ok(dashboard&&files);dashboard.listeners.click();files.listeners.click();dashboard.listeners.click();assert.equal(h.calls.length,2);assert.equal(dashboard.disabled,true);assert.equal(fileMapRetry(h,'beginner-loading'),undefined);assert.equal(fileMapRetry(h,'beginner-file-bands'),undefined);assert.match(h.text(h.node('loading-observation')),/Waiting/);assert.equal(h.context.componentDrafts.get(draftKey),draft);assert.equal(h.context.componentDisclosures.get(draftKey).file,true);assert.equal(h.node('beginner-suggestions').open,true);
  h.releases[1].resolve(map());await new Promise(setImmediate);assert.equal(dashboard.disabled,false);dashboard.listeners.click();files.listeners.click();assert.equal(h.calls.length,2);assert.equal(h.context.loadingError,'');assert.equal(h.node('component-search').value,'Synthetic');assert.equal(h.node('component-sort').value,'cost');assert.equal(h.context.selectedIds,selection);const card=h.node('component-list').children[0];assert.ok(h.descendants(card).some(node=>node.tag==='details'&&node.open));assert.equal(h.descendants(card).find(node=>node.name==='component-note').value,draft.note);assert.deepEqual(h.calls.map(call=>call.path),['/api/loading','/api/loading']);
});

for(const change of ['repo','agent','scan','folder','error','sequence'])test('detached file-map retry rejects changed '+change+' before any metadata request',async()=>{
  const h=harness(),failed=h.context.refreshLoading();h.releases[0].reject(new Error('Original failure'));await failed;const buttons=['beginner-loading','beginner-file-bands'].map(target=>fileMapRetry(h,target));
  if(change==='repo')h.context.activeRepo='/synthetic/other';if(change==='agent')h.context.selectedAgent='codex';if(change==='scan')h.context.state.inventory.scannedAt='2026-10-02';if(change==='folder')h.context.loadingDirectories.set(JSON.stringify([repo,'claude']),repo+'/src');if(change==='error')h.context.loadingError='Changed failure';if(change==='sequence')h.context.loadingSequence++;
  for(const control of buttons)control.listeners.click();assert.equal(h.calls.length,1);assert.equal(h.focuses.length,0);assert.equal(h.context.document.activeElement,null);assert.deepEqual(h.calls.map(call=>call.path),['/api/loading']);
});

for(const [target,status] of [['beginner-loading','loading-summary'],['beginner-file-bands','beginner-files-note']])for(const success of [true,false])test('accepted '+target+' retry keeps focus on persistent status through '+(success?'recovery':'failure'),async()=>{
  const h=harness(),failed=h.context.refreshLoading();h.releases[0].reject(new Error('Synthetic initial failure'));await failed;const retry=fileMapRetry(h,target);h.context.document.activeElement=retry;retry.listeners.click();assert.equal(h.context.document.activeElement,h.node(status));assert.deepEqual(h.focuses,[{id:status,options:{preventScroll:true}}]);assert.equal(h.calls.length,2);retry.listeners.click();assert.equal(h.focuses.length,1);assert.equal(h.calls.length,2);
  if(success)h.releases[1].resolve(map());else h.releases[1].reject(new Error('Synthetic retry failure'));await new Promise(setImmediate);assert.equal(h.context.document.activeElement,h.node(status));assert.equal(h.focuses.length,1);retry.listeners.click();assert.equal(h.focuses.length,1);assert.equal(h.calls.length,2);
});

test('retry completion never steals focus after the user moves away from the persistent status',async()=>{
  const h=harness(),failed=h.context.refreshLoading();h.releases[0].reject(new Error('Initial failure'));await failed;fileMapRetry(h,'beginner-file-bands').listeners.click();assert.equal(h.context.document.activeElement,h.node('beginner-files-note'));h.node('component-search').focus({preventScroll:true});h.releases[1].resolve(map());await new Promise(setImmediate);assert.equal(h.context.document.activeElement,h.node('component-search'));assert.equal(h.focuses.length,2);
});
