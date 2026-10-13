import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const slice=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const helpers=slice('function fileReadCounts(','function usageCounts(');
const usage=slice('function usageCounts(','async function importUsageEvidence(');
const components=slice('function sortComponents(','function openLoadingChat(');
const bands=slice('function friendlyStatus(','function renderLoading()');
const directories=slice('function portableDirectory(','function loadingDirectoryLabel(');
const recommendations=slice('function recommendationDecisionFor(','function recommendationCards(');
const health=slice('function renderBeginnerHealth(','function sortComponents(');
const ask=slice('function openComponentChat(','function renderBeginnerHealth(');
const root='/synthetic/repo';
const read=(assetId,extra={})=>({assetId,requests:2,resultsSeen:1,failed:1,sessions:1,firstRequest:'2026-10-01',lastRequest:'2026-10-02',...extra});
const component=(id,extra={})=>({id,name:'Same skill',description:'Synthetic description',path:root+'/'+id+'/SKILL.md',type:'skill',agent:'claude',repo:root,residentTokens:10,bodyTokens:20,...extra});
const snapshot=extra=>({repo:root,agent:'claude',at:'2026-10-03',items:[],totals:{calls:0,resultsSeen:0,failed:0},coverage:{},files:{read:1,skipped:0},...extra});

function harness(){
  const nodes=new Map(),chats=[];
  const element=(tag,className='',text='')=>({tag,className,textContent:text,children:[],style:{},dataset:{},value:'',listeners:{},
    append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},addEventListener(type,fn){this.listeners[type]=fn;},setAttribute(){},
    set innerHTML(value){throw new Error('Evidence must remain text');},
  });
  const node=id=>{if(!nodes.has(id))nodes.set(id,element('div'));return nodes.get(id);};
  const context=vm.createContext({
    $:node,element,button:(text,className,fn)=>({...element('button',className,text),click:fn}),badge:(text,tone)=>element('span',tone,text),empty:(title,description)=>element('div','empty',title+' '+description),
    panel:(title,description,body)=>{const panel=element('div','panel',title+' '+description);panel.append(body);return panel;},metric:(label,value,foot)=>element('div','metric',label+' '+value+' '+foot),
    array:value=>Array.isArray(value)?value:[],number:String,tokens:String,date:String,time:()=>'',agentName:String,repoName:String,
    activeRepo:root,selectedAgent:'claude',loadingKey:JSON.stringify([root,'claude','','synthetic-scan']),loading:{repo:root,agent:'claude',components:{items:[],summary:{skills:0,toolConfigs:0,used:0,toReview:0,unknown:0}},groups:[]},state:{inventory:{scannedAt:'synthetic-scan'},recommendations:[]},
    componentPage:0,recommendationDrafts:new Map(),recommendationBusy:new Set(),componentDrafts:new Map(),componentReviewPending:new Map(),componentDisclosures:new Map(),friendlyLimits:new Map(),configurationTreeOpen:new Map(),beginnerTypes:new Set(['instruction','config']),selectedIds:new Set(),
    setOptions(node,options,empty,selected){node.value=selected||options[0]?.value||'';},nestedLoadingDirectory:()=>true,
    loadingFiles:()=>[],showFileView(){},openEditor(){},openImprovement(){},updateRouteNote(){},updateSelection(){},
    openChat:(...args)=>chats.push(args),
  });
  vm.runInContext(directories+helpers+usage+components+bands+recommendations+health+ask,context);
  const run=expression=>vm.runInContext(expression,context);
  const text=node=>[node.textContent,...node.children.map(text)].join(' ');
  const all=node=>[node,...node.children.flatMap(all)];
  return{context,node,run,text,all,chats};
}

test('legacy, unsupported and collected zero read snapshots stay distinct from call counts',()=>{
  const h=harness();
  h.context.loading.components.usageEvidence=snapshot();h.run('renderUsageEvidence()');
  assert.match(h.node('usage-evidence-summary').textContent,/0 recorded calls/);assert.match(h.node('usage-evidence-summary').textContent,/Read requests were not collected in this snapshot/);
  h.context.loading.components.usageEvidence=snapshot({agent:'codex',fileReads:[],fileReadTotals:{requests:0,resultsSeen:0,failed:0},fileReadCoverage:{supported:false,interpretation:'Codex Read collection is unsupported.'}});h.context.selectedAgent='codex';h.run('renderUsageEvidence()');
  assert.match(h.node('usage-evidence-summary').textContent,/Explicit Read requests are not supported for codex/);assert.doesNotMatch(h.node('usage-evidence-summary').textContent,/0 explicit Read requests/);
  h.context.selectedAgent='claude';h.context.loading.components.usageEvidence=snapshot({fileReads:[],fileReadTotals:{requests:0,resultsSeen:0,failed:0},fileReadCoverage:{supported:true}});h.run('renderUsageEvidence()');
  assert.match(h.node('usage-evidence-summary').textContent,/0 explicit Read requests/);assert.doesNotMatch(h.node('usage-evidence-summary').textContent,/not collected/);
});

test('session and beginner summaries count Read requests separately and keep raw names Skill/MCP only',()=>{
  const h=harness(),evidence=snapshot({items:[{kind:'skill',name:'known-skill',calls:3,resultsSeen:2,failed:0}],totals:{calls:3,resultsSeen:2,failed:0},fileReads:[read('read-file')],fileReadTotals:{requests:2,resultsSeen:1,failed:1},fileReadCoverage:{supported:true}});
  h.context.loading.components.usageEvidence=evidence;h.run('renderUsageEvidence(); renderBeginnerHealth()');
  for(const display of [h.node('usage-evidence-summary').textContent,h.text(h.node('beginner-health'))]){assert.match(display,/3 recorded calls/);assert.match(display,/2 explicit Read requests/);assert.doesNotMatch(display,/5 recorded calls/);}
  assert.match(h.node('usage-evidence-summary').textContent,/1 session files parsed/);
  const names=h.text(h.node('usage-evidence-calls'));assert.match(names,/Skill: known-skill/);assert.doesNotMatch(names,/read-file|Read request/);
  assert.equal(evidence.totals.calls,3);assert.match(h.text(h.node('beginner-health')),/Manual use recorded 0/);
});

test('session read metadata is not displayed under another agent or repository',()=>{
  const h=harness();h.context.loading.components.usageEvidence=snapshot({repo:'/synthetic/other',fileReads:[read('a')],fileReadTotals:{requests:2,resultsSeen:1,failed:1}});h.run('renderUsageEvidence(); renderBeginnerHealth()');
  assert.doesNotMatch(h.text(h.node('beginner-health')),/2 explicit Read requests/);
  assert.match(h.node('usage-evidence-summary').textContent,/No session evidence imported/);assert.doesNotMatch(h.node('usage-evidence-summary').textContent,/explicit Read/);
});

test('positive read section is collapsed, dated and explicit about failed and missing results',()=>{
  const h=harness(),card=h.context.element('article');h.context.card=card;h.context.evidence={reads:[read('a')],readAttribution:'Known discovered file ID matched.'};
  h.run('appendFileReadEvidence(card,evidence,"a")');
  const detail=card.children[0];assert.equal(detail.tag,'details');assert.notEqual(detail.open,true);
  const display=h.text(detail);assert.match(display,/2 explicit Read requests.*1 result seen.*1 explicit error flag/);assert.match(display,/2026-10-01 to 2026-10-02/);
  assert.match(display,/do not verify full contents.*body version.*eager loading.*successful execution or usefulness/);assert.match(display,/Missing results do not prove failure/);assert.match(display,/snapshot does not record the launch folder/);
});

test('legacy absence and collected empty reads add no repeated details or bogus zero',()=>{
  const h=harness();h.context.card=h.context.element('article');h.context.evidence={};h.run('appendFileReadEvidence(card,evidence,"a")');assert.equal(h.context.card.children.length,0);
  h.context.evidence={reads:[],readAttribution:'No matching explicit Read requests in collected Claude sessions.'};h.run('appendFileReadEvidence(card,evidence,"a")');assert.equal(h.context.card.children.length,0);assert.doesNotMatch(h.text(h.context.card),/0 explicit Read/);
});

test('duplicate names do not transfer target matches between asset IDs',()=>{
  const h=harness();h.context.loading.components.usageEvidence=snapshot({fileReadCoverage:{supported:true}});h.context.loading.components.items=[component('a',{callEvidence:{matches:[],reads:[read('a')],readAttribution:'Matched a known file ID.'}}),component('b',{callEvidence:{matches:[],reads:[read('a')],readAttribution:'No matching requests for this file.'}})];
  h.run('renderComponents()');const cards=h.node('component-list').children;
  assert.match(h.text(cards[0]),/2 explicit Read target requests/);assert.match(h.text(cards[0]),/2 explicit Read requests/);
  assert.match(h.text(cards[1]),/Manual use: unknown/);assert.match(h.text(cards[1]),/0 explicit Read target requests/);assert.doesNotMatch(h.text(cards[1]),/Read requests recorded|2 explicit Read/);
});

test('no-evidence filter excludes positive known target requests, including failed requests, without treating zero or unknown as use',()=>{
  const h=harness();h.context.loading.components.usageEvidence=snapshot({fileReadCoverage:{supported:true}});h.node('component-filter').value='unknown';
  h.context.loading.components.items=[component('positive',{callEvidence:{matches:[],reads:[read('positive',{resultsSeen:0,failed:2})]}}),component('zero',{callEvidence:{matches:[],reads:[read('zero',{requests:0,resultsSeen:0,failed:0})]}}),component('legacy'),component('other-target',{callEvidence:{matches:[],reads:[read('different-id')]}})];
  h.run('renderComponents()');assert.deepEqual(h.node('component-list').children.map(item=>item.dataset.componentId),['legacy','other-target','zero']);
  assert.match(html,/<option value="unknown">No calls, read requests or use notes<\/option>/);
});

test('manual notes, calls and Read requests remain independent in the component evidence block',()=>{
  const h=harness();h.context.loading.components.usageEvidence=snapshot({fileReadCoverage:{supported:true}});h.context.loading.components.items=[component('changed',{review:{changed:true,status:'used',source:'Manual',at:'date',note:'Synthetic'},callEvidence:{reads:[read('changed')]}}),component('used',{review:{status:'used',source:'Manual',at:'date',note:'Synthetic'},callEvidence:{reads:[read('used')]}}),component('calls',{callEvidence:{matches:[{calls:1}],ambiguous:true,reads:[read('calls')]}})];
  h.run('renderComponents()');const cards=new Map(h.node('component-list').children.map(item=>[item.dataset.componentId,item]));
  assert.match(h.text(cards.get('changed')),/Changed since review/);assert.match(h.text(cards.get('used')),/Manual use recorded/);assert.match(h.text(cards.get('calls')),/1 recorded call.*2 explicit Read target requests/);
  assert.match(h.text(cards.get('calls')),/Source or version is unresolved/);assert.match(h.text(cards.get('calls')),/1 recorded call/);assert.match(h.text(cards.get('calls')),/2 explicit Read requests/);
});

test('file-map Read details keep inferred status and render only matched safe metadata as text',()=>{
  const h=harness(),file=Object.freeze({id:'known',name:'AGENTS.md <img src=x onerror=alert(1)>',path:root+'/AGENTS.md',type:'instruction',repo:root,status:'applies',role:'repository instruction',readEvidence:{reads:[read('known',{path:'/synthetic/excluded-path',body:'Excluded body',name:'Excluded name'})],readAttribution:'Excluded attribution <img src=y onerror=alert(2)>'}});
  h.context.loading.groups=[{id:'repo',files:[file,{id:'legacy',name:'Legacy.md',path:root+'/Legacy.md',type:'instruction',status:'unknown'}]}];h.run('renderConfigurationTree($("beginner-loading"))');
  const display=h.text(h.node('beginner-loading'));assert.match(display,/2 explicit Read requests/);assert.match(display,/Start/);assert.match(display,/snapshot does not record the launch folder/);assert.equal(file.status,'applies');
  assert.match(display,/<img src=x onerror=alert\(1\)>/);assert.doesNotMatch(display,/Excluded body|excluded-path|Excluded name|Excluded attribution/);assert.equal(h.all(h.node('beginner-loading')).some(item=>item.tag==='img'),false);
  assert.equal(h.all(h.node('beginner-loading')).filter(item=>item.tag==='details'&&item.children.some(child=>child.tag==='summary'&&h.text(child).includes('explicit Read requests'))).length,1);
});

test('component ask draft distinguishes Read target evidence and remains an explicit item selection',()=>{
  const h=harness();h.context.item=component('chosen');h.context.loading.launchDirectory=root;h.context.loading.components.items=[h.context.item];h.context.state.inventory.items=[h.context.item];h.run('openComponentChat(item)');
  assert.match(h.chats[0][1],/explicit Read target matches/);assert.match(h.chats[0][1],/does not establish full bytes.*loaded version.*eager loading.*success or usefulness/);assert.deepEqual([...h.chats[0][4]],['chosen']);
});

test('import guidance identifies known file IDs and excludes arbitrary paths and bodies',()=>{
  assert.match(html,/known discovered file IDs for explicit Claude Read requests/);assert.match(html,/Arbitrary read paths and file bodies are excluded/);
});

test('Read-only snapshot dates describe activity without claiming Skill or MCP calls',()=>{
  const h=harness();h.context.loading.components.usageEvidence=snapshot({window:{observedFrom:'2026-10-01',observedTo:'2026-10-02'},fileReads:[read('known')],fileReadTotals:{requests:2,resultsSeen:1,failed:1},fileReadCoverage:{supported:true}});h.run('renderUsageEvidence()');
  const display=h.node('usage-evidence-summary').textContent;assert.match(display,/0 recorded calls/);assert.match(display,/2 explicit Read requests/);assert.match(display,/Recorded activity: 2026-10-01 to 2026-10-02/);assert.doesNotMatch(display,/Recorded calls:|No calls observed/);
});
