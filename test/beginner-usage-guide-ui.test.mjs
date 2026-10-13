import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const slice=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const action=slice('async function action(','function scopedItems(');
const picker=slice('function sessionFilesScopeText(','function proposalSelection(');
const health=slice('function renderBeginnerHealth(','function openLoadingChat(');
const repo='/synthetic/repo-a';
const item={id:'skill-a',name:'Synthetic skill',type:'skill',path:'/synthetic/SKILL.md',repo:'',residentTokens:3,bodyTokens:10};
const snapshot=(extra={})=>({agent:'claude',repo,totals:{calls:0},coverage:{partial:false},...extra});
const tick=()=>new Promise(setImmediate);

function harness({agent='claude',scope=repo,items=[item],evidence,files=[],rootStatus='missing',partial=false}={}){
  const nodes=new Map(),calls=[],scans=[],refreshes=[];
  const all=node=>[node,...node.children.flatMap(all)];
  const element=(tag='div',className='',text='')=>({tag,className,textContent:String(text),children:[],dataset:{},value:'',disabled:false,hidden:false,open:false,listeners:{},
    append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},addEventListener(type,fn){this.listeners[type]=fn;},
    setAttribute(key,value){this[key]=value;},querySelectorAll(tag){return all(this).filter(node=>node.tag===tag);},showModal(){this.open=true;},close(){this.open=false;},click(){this.listeners.click?.();},
    setCustomValidity(message){this.validationMessage=message;},reportValidity(){return !this.validationMessage;},
    set innerHTML(value){throw new Error('Synthetic evidence must remain text');},
  });
  const node=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
  const context=vm.createContext({$:node,element,array:value=>Array.isArray(value)?value:[],number:String,tokens:String,bytes:value=>value+' B',date:String,time:()=>'',agentName:String,repoName:String,
    button:(text,className,fn)=>{const button=element('button',className,text);button.listeners.click=fn;return button;},badge:(text,tone)=>element('span',tone,text),
    empty:(title,description)=>element('div','empty',title+' '+description),metric:(label,value,foot)=>element('div','metric',label+' '+value+' '+foot),panel:(title,description,body)=>{const panel=element('section','panel',title+' '+description);panel.append(body);return panel;},
    setOptions(node,options,placeholder,selected){node.value=selected??options[0]?.value??'';},matchingFileReads:()=>[],appendFileReadEvidence(){},usageCounts:()=>({calls:0}),usageCountText:totals=>totals.calls+' recorded calls',fileReadSummary:()=> 'Read requests are separate.',
    activeRepo:scope,selectedAgent:agent,location:{hash:''},selectedIds:new Set(),state:{inventory:{scannedAt:'synthetic-scan',coverage:{partial}},recommendations:[]},loadingKey:JSON.stringify([scope,agent,'','synthetic-scan']),
    loading:{repo:scope,agent,components:{items,usageEvidence:evidence,summary:{skills:items.length,toolConfigs:0,used:items.filter(item=>item.review?.status==='used').length,toReview:items.filter(item=>item.review?.status==='review').length,unknown:items.filter(item=>!item.review).length}}},loadingFiles:()=>[],
    componentPage:0,friendlyLimits:new Map(),componentDrafts:new Map(),componentReviewPending:new Map(),componentDisclosures:new Map(),sessionFilesScope:null,sessionFilesBusy:'',sessionFilesSequence:0,sessionFileChoices:[],sessionFileSelection:new Set(),
    recommendationDecisionFor:()=>null,recommendationDecisionCurrent:()=>false,recommendationDecisionHistory:()=>null,
    clearError(){},showError(error){throw error;},updateChatAvailability(){},toast(){},openEditor(){throw new Error('Unexpected editor action');},openComponentChat(){throw new Error('Unexpected provider action');},openImprovement(){throw new Error('Unexpected improvement action');},
    api:async(path,body)=>{calls.push({path,body});if(path==='/api/session-files')return {...body,files,rootStatus,coverage:{partial:false}};if(path==='/api/component-review')return {};throw new Error('Unexpected dispatch: '+path);},
    refreshLoading:async force=>refreshes.push(force),
  });
  node('usage-import-agent').value='codex';node('usage-import-days').value='7';node('usage-import').open=false;
  node('scan-button').listeners.click=()=>scans.push('existing scan handler');
  vm.runInContext(action+picker+health,context);
  const text=node=>[node.textContent,...node.children.map(text)].join(' ');
  const render=()=>context.renderBeginnerHealth();
  const ctas=()=>all(node('beginner-health')).filter(node=>node.tag==='button');
  const click=async()=>{assert.equal(ctas().length,1);ctas()[0].click();await tick();};
  return{context,node,calls,scans,refreshes,all,text,render,ctas,click};
}

for(const agent of ['claude','codex'])test(agent+' without scoped evidence opens the existing usage chooser without importing',async()=>{
  const h=harness({agent,partial:true});h.render();assert.equal(h.calls.length,0);
  assert.equal(h.ctas()[0].textContent,'Choose recent local sessions');assert.equal(h.ctas()[0].className,'button secondary');
  const before=h.text(h.node('beginner-health'));assert.match(before,/No session evidence imported for this agent and scope\. Recorded session calls are unknown/);assert.match(before,/1 components have no current manual use note/);assert.equal(h.node('beginner-health-warning').hidden,false);assert.match(h.node('beginner-health-warning').textContent,/Discovery is incomplete/);
  assert.match(h.text(h.node('beginner-improvements')),/Optional session evidence.*Optionally choose recent local sessions above/);assert.doesNotMatch(h.text(h.node('beginner-improvements')),/fresh session context|recognize/);assert.match(before,/Optionally choose.*without importing sessions/);assert.doesNotMatch(before,/before reviewing/);
  await h.click();assert.equal(h.node('usage-import-agent').value,agent);assert.equal(h.node('usage-import').open,true);assert.equal(h.context.location.hash,'inventory');
  assert.equal(h.node('beginner-components').hidden,false);assert.equal(h.node('beginner-instructions').hidden,true);assert.equal(h.node('files-components')['aria-pressed'],'true');
  assert.equal(h.node('session-files-dialog').open,true);assert.equal(h.node('session-files-title').textContent,'Choose recent local sessions');
  assert.deepEqual({...h.context.sessionFilesScope},{agent,repo,days:7});assert.deepEqual(h.calls.map(call=>({path:call.path,body:{...call.body}})),[{path:'/api/session-files',body:{agent,repo}}]);
  assert.equal(h.context.sessionFileSelection.size,0);assert.equal(h.refreshes.length,0);assert.equal(h.scans.length,0);
});

test('supporting setup evidence is closed initially while partial discovery stays visible and clears with stale scope',()=>{
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');assert.match(html,/<details id="beginner-health-details" class="supporting-evidence"><summary>Setup checks and session evidence<\/summary><div id="beginner-health">/);assert.ok(html.indexOf('id="beginner-health-warning"')<html.indexOf('id="beginner-health-details"'));
  const h=harness({partial:true});h.node('beginner-health-details').open=true;h.render();assert.equal(h.node('beginner-health-warning').hidden,false);assert.equal(h.node('beginner-health-details').open,true);assert.equal(h.calls.length,0);h.context.activeRepo='/synthetic/other';h.render();assert.equal(h.node('beginner-health-warning').hidden,true);assert.equal(h.node('beginner-health-warning').textContent,'');assert.equal(h.node('beginner-health').children.length,0);assert.equal(h.node('beginner-health-details').open,true);h.context.activeRepo=repo;h.render();assert.equal(h.node('beginner-health-warning').hidden,false);assert.equal(h.calls.length,0);
});

test('the guide captures the current selected agent and global window through the existing chooser',async()=>{
  const h=harness({scope:''});h.render();h.context.selectedAgent='codex';h.node('usage-import-days').value='all';await h.click();
  assert.deepEqual({...h.context.sessionFilesScope},{agent:'codex',repo:'',days:'all'});assert.match(h.node('session-files-scope').textContent,/Global setup only.*All dates/);
  h.context.selectedAgent='claude';h.context.activeRepo=repo;h.node('usage-import-days').value='30';
  assert.deepEqual({...h.context.sessionFilesScope},{agent:'codex',repo:'',days:'all'});assert.equal(h.calls.length,1);
});

test('foreign agent or repository snapshots cannot skip the session evidence first step',async()=>{
  for(const evidence of [snapshot({agent:'codex'}),snapshot({repo:'/synthetic/repo-b'}),snapshot({repo:''})]){
    const h=harness({evidence});h.render();assert.equal(h.ctas()[0].textContent,'Choose recent local sessions');
    assert.doesNotMatch(h.text(h.node('beginner-health')),/in your last imported session snapshot/);await h.click();assert.equal(h.calls[0].body.agent,'claude');assert.equal(h.calls[0].body.repo,repo);
  }
});

test('matching zero and partial snapshots keep the existing review action and never imply unused',async()=>{
  for(const evidence of [snapshot(),snapshot({totals:{calls:4},coverage:{partial:true}}),snapshot({agent:'codex',repo:''})]){
    const h=harness({agent:evidence.agent,scope:evidence.repo,evidence});h.render();assert.equal(h.ctas()[0].textContent,'Review skills & tools');
    assert.match(h.text(h.node('beginner-health')),/in your last imported session snapshot.*Calls do not establish usefulness\. No recorded calls does not mean unused/);
    assert.match(h.text(h.node('beginner-improvements')),/Use Review skills & tools above/);assert.doesNotMatch(h.text(h.node('beginner-improvements')),/fresh session context/);
    await h.click();assert.equal(h.context.location.hash,'inventory');assert.equal(h.node('beginner-components').hidden,false);assert.equal(h.node('usage-import').open,false);assert.equal(h.node('session-files-dialog').open,false);assert.equal(h.calls.length,0);
    assert.equal(h.context.loading.components.usageEvidence,evidence);
  }
});

test('unsupported agents review components without opening an invalid session picker',async()=>{
  for(const agent of ['kimi','kiro','orca']){
    const h=harness({agent});h.render();assert.equal(h.ctas()[0].textContent,'Review skills & tools');assert.match(h.text(h.node('beginner-health')),/Recorded session calls are unknown.*Session import supports Claude and Codex/);
    await h.click();assert.equal(h.context.location.hash,'inventory');assert.equal(h.node('beginner-components').hidden,false);assert.equal(h.node('session-files-dialog').open,false);assert.equal(h.calls.length,0);assert.equal(h.node('usage-import-agent').value,'codex');
  }
});

for(const evidence of [undefined,snapshot()])for(const [label,search,filter] of [['search','Earlier nonmatching search',''],['tools','','tools'],['unknown','','unknown'],['review','','review']])test(`${evidence?'review':'missing evidence'} dashboard action clears stale ${label} view and starts with needs review`,async()=>{
  const review={status:'used',lastUsed:'2026-10-01',note:'Synthetic manual evidence',source:'Manual note',at:'2026-10-12'};
  const items=Array.from({length:12},(_,index)=>({...item,id:'skill-'+index,name:'Synthetic skill '+String(index).padStart(2,'0'),residentTokens:100-index,review}));
  items[11]={...items[11],review:{...review,status:'review'}};
  const h=harness({items,evidence});const draft={status:'used',lastUsed:'2026-10-02',note:'Unsaved synthetic draft'},key=JSON.stringify([items[0].id,'claude',repo]);
  h.context.componentDrafts.set(key,draft);h.node('component-search').value=search;h.node('component-filter').value=filter;h.node('component-sort').value='cost';h.context.componentPage=1;
  h.context.renderComponents();if(search||filter==='tools')assert.match(h.text(h.node('component-list')),/No components match/);else assert.equal(h.node('component-list').children.length,1);h.context.componentPage=1;
  h.render();await h.click();
  assert.equal(h.node('component-search').value,'');assert.equal(h.node('component-filter').value,'');assert.equal(h.node('component-sort').value,'review');assert.equal(h.context.componentPage,0);
  assert.equal(h.node('beginner-components').hidden,false);assert.equal(h.node('component-list').children[0].dataset.componentId,items[11].id);assert.equal(h.node('component-list').children.length,12);
  assert.doesNotMatch(h.text(h.node('component-list')),/No components match/);assert.match(h.text(h.node('component-pagination')),/Showing 1–12 of 12/);
  assert.equal(h.context.activeRepo,repo);assert.equal(h.context.selectedAgent,'claude');assert.equal(h.context.loading.components.items,items);assert.equal(items[0].review,review);assert.equal(h.context.componentDrafts.get(key),draft);
  if(evidence) {assert.equal(h.calls.length,0);assert.equal(h.node('session-files-dialog').open,false);}
  else {assert.deepEqual(h.calls.map(call=>({path:call.path,body:{...call.body}})),[{path:'/api/session-files',body:{agent:'claude',repo}}]);assert.equal(h.node('session-files-dialog').open,true);assert.equal(h.context.sessionFileSelection.size,0);}
  assert.equal(h.refreshes.length,0);assert.equal(h.scans.length,0);
});

test('ordinary file view switches retain search, filter, sort and page without dispatch',()=>{
  const h=harness();h.node('component-search').value='Remember this search';h.node('component-filter').value='tools';h.node('component-sort').value='cost';h.context.componentPage=2;
  for(const components of [true,false,true]) {
    h.context.showFileView(components);assert.equal(h.node('component-search').value,'Remember this search');assert.equal(h.node('component-filter').value,'tools');assert.equal(h.node('component-sort').value,'cost');assert.equal(h.context.componentPage,2);
    assert.equal(h.node('beginner-components').hidden,!components);assert.equal(h.node('beginner-instructions').hidden,components);
  }
  assert.equal(h.calls.length,0);assert.equal(h.refreshes.length,0);assert.equal(h.scans.length,0);
});

test('no discovered components route to the existing scan handler without picker or direct dispatch',async()=>{
  for(const agent of ['claude','codex','gemini']){
    const h=harness({agent,items:[]});h.node('component-search').value='Remember this search';h.node('component-filter').value='tools';h.node('component-sort').value='cost';h.context.componentPage=2;h.render();assert.equal(h.ctas()[0].textContent,'Scan workspace');assert.match(h.text(h.node('beginner-health')),/No skills or tool configuration files were discovered.*Choose another agent or repository/);
    assert.match(h.text(h.node('beginner-improvements')),/No components discovered.*Scan the workspace above/);await h.click();assert.equal(h.scans.length,1);assert.equal(h.calls.length,0);assert.equal(h.node('session-files-dialog').open,false);assert.equal(h.context.location.hash,'');
    assert.equal(h.node('component-search').value,'Remember this search');assert.equal(h.node('component-filter').value,'tools');assert.equal(h.node('component-sort').value,'cost');assert.equal(h.context.componentPage,2);
  }
});

test('missing, empty and oversized discovery leaves manual file selection visible after cancellation',async()=>{
  const cases=[{rootStatus:'missing'},{rootStatus:'excluded'},{rootStatus:'available'},{rootStatus:'available',files:[{path:'/synthetic/large.jsonl',label:'large.jsonl',bytes:2*1048576+1,modifiedAt:'2026-10-12',importable:false}]}];
  for(const options of cases){
    const h=harness(options);h.render();await h.click();assert.equal(h.calls.length,1);assert.equal(h.context.sessionFileSelection.size,0);
    if(options.files){const input=h.node('session-files-list').querySelectorAll('input')[0];assert.equal(input.disabled,true);assert.equal(input.checked,false);assert.match(h.text(h.node('session-files-list')),/Over the 2 MiB limit/);}
    else assert.match(h.text(h.node('session-files-list')),/Choose local files manually/);
    h.context.closeSessionFiles();assert.equal(h.node('session-files-dialog').open,false);assert.equal(h.node('usage-import').open,true);assert.equal(h.node('beginner-components').hidden,false);assert.equal(h.calls.length,1);
  }
});

test('the chooser enables import only for an explicit available file selection',async()=>{
  const files=[{path:'/synthetic/available.jsonl',label:'available.jsonl',bytes:100,modifiedAt:'2026-10-12',importable:true},{path:'/synthetic/unavailable.jsonl',label:'unavailable.jsonl',bytes:100,modifiedAt:'2026-10-12',importable:false}];
  const h=harness({files,rootStatus:'available'});h.render();await h.click();
  const [available,unavailable]=h.node('session-files-list').querySelectorAll('input'),submit=h.node('session-files-import');
  assert.equal(h.context.sessionFileSelection.size,0);assert.equal(submit.disabled,true);assert.equal(available.checked,false);assert.equal(unavailable.disabled,true);
  unavailable.checked=true;unavailable.listeners.change();assert.equal(submit.disabled,true);assert.equal(h.context.sessionFileSelection.size,0);
  available.checked=true;available.listeners.change();assert.equal(submit.disabled,false);assert.equal(h.context.sessionFileSelection.size,1);
  available.checked=false;available.listeners.change();assert.equal(submit.disabled,true);assert.equal(h.context.sessionFileSelection.size,0);
  await h.context.importSessionFiles();assert.equal(submit.disabled,true);assert.equal(h.calls.length,1);assert.match(h.node('session-files-error').textContent,/Choose 1–20/);
});

test('session guidance preserves manual review flags, dated notes and the existing explicit review save',async()=>{
  const review={status:'used',lastUsed:'2026-10-01',note:'Used on a synthetic task',source:'Manual note',at:'2026-10-12'};
  const h=harness({items:[{...item,review},{...item,id:'skill-b',review:{...review,status:'review',changed:true}}]});h.render();
  assert.match(h.text(h.node('beginner-health')),/Manual use recorded 1.*Need review 1/);assert.match(h.text(h.node('beginner-health')),/0 components have no current manual use note/);
  assert.match(h.text(h.node('beginner-health')),/Recorded session calls are unknown/);assert.match(h.text(h.node('beginner-improvements')),/Recorded session calls stay unknown until you import/);assert.doesNotMatch(h.text(h.node('beginner-health')),/Usage is unknown/);
  await h.click();h.context.renderComponents();const card=h.node('component-list').children.find(node=>node.dataset.componentId==='skill-a'),fields=h.all(card),form=fields.find(node=>node.tag==='form');
  assert.equal(fields.find(node=>node.name==='component-status').value,'used');assert.equal(fields.find(node=>node.name==='last-used').value,'2026-10-01');assert.equal(fields.find(node=>node.name==='component-note').value,review.note);
  assert.match(h.text(h.node('component-list')),/Changed since review/);assert.equal(h.calls.length,1);
  form.listeners.submit({preventDefault(){}});await tick();assert.equal(h.calls.length,2);assert.equal(h.calls[1].path,'/api/component-review');
  assert.deepEqual({...h.calls[1].body},{id:'skill-a',agent:'claude',repo,version:JSON.stringify([item.contentHash,item.bytes,item.modifiedAt]),status:'used',helpfulness:'unknown',lastUsed:'2026-10-01',note:review.note});
});
