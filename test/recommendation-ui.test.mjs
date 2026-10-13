import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const slice=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const helpers=slice('function recommendationDecisionFor(','function warningBlock(');
const health=slice('function renderBeginnerHealth(','function sortComponents(');
const scope=slice('function scopedRecords(','function includedIds(');
const repo='/synthetic/repo-a';
const proposal=(extra={})=>({id:'proposal-a',agent:'claude',repo,itemId:'skill-a',fingerprint:'version-a',title:'Review synthetic skill',evidence:'Synthetic scanned evidence',action:'Review placement',source:'Synthetic scan',...extra});
const proposals=count=>Array.from({length:count},(_,index)=>proposal({id:'proposal-'+index,title:'Synthetic proposal '+index}));
const decision=(extra={})=>({agent:'claude',repo,fingerprint:'version-a',status:'dismissed',note:'Checked the synthetic task',at:'2026-10-12',current:true,changed:false,recommendation:proposal(),...extra});

function harness({records={},recommendations=[proposal()],api:respond}={}){
  const nodes=new Map(),calls=[];
  const element=(tag='div',className='',text='')=>({tag,className,textContent:String(text),children:[],dataset:{},style:{},value:'',disabled:false,hidden:true,open:false,listeners:{},
    append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},contains(child){return this===child||this.children.some(item=>item===child||item.contains?.(child));},addEventListener(type,fn){this.listeners[type]=fn;},setAttribute(key,value){this[key]=value;},
    set innerHTML(value){throw new Error('Recommendation text must remain inert');},
  });
  const node=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
  const context=vm.createContext({$:node,element,array:value=>Array.isArray(value)?value:[],number:String,tokens:String,date:String,time:()=>'',agentName:String,repoName:String,
    button:(text,className,fn)=>{const item=element('button',className,text);item.listeners.click=fn;return item;},badge:(text,tone)=>element('span',tone,text),empty:(title,description)=>element('div','empty',title+' '+description),metric:(label,value,foot)=>element('div','metric',label+' '+value+' '+foot),panel:(title,description,body)=>{const item=element('section','panel',title+' '+description);item.append(body);return item;},
    activeRepo:repo,selectedAgent:'claude',advanced:false,friendlyLimits:new Map(),recommendationDrafts:new Map(),recommendationBusy:new Set(),selectedIds:new Set(),
    state:{agents:[{id:'claude'},{id:'codex'}],inventory:{scannedAt:'synthetic-scan'},recommendations,recommendationRecords:records},loadingKey:JSON.stringify([repo,'claude','','synthetic-scan']),loading:{repo,agent:'claude',components:{items:[{id:'skill-a'}],summary:{skills:1,toolConfigs:0,used:0,toReview:0,unknown:1}}},
    loadingFiles:()=>[],usageCountText:()=>'',fileReadSummary:()=>'',showFileView(){},openChat(){},updateRouteNote(){},openImprovement(){},proposalSelection:()=>new Set(),toast(){},renderDashboard(){},
    api:async(path,body)=>{calls.push({path,body});if(respond)return respond(path,body,context);context.state.recommendationRecords={...context.state.recommendationRecords,'opaque-saved-key':decision({...body,at:'2026-10-13',recommendation:context.state.recommendations.find(item=>item.id===body.id)})};return{};},
    refresh:async()=>context.renderBeginnerHealth(),
  });
  vm.runInContext(scope+helpers+health,context);
  const run=expression=>vm.runInContext(expression,context),all=item=>[item,...item.children.flatMap(all)],text=item=>[item.textContent,...item.children.map(text)].join(' ');
  const render=()=>run('renderBeginnerHealth()'),list=()=>node('beginner-improvements').children[0].children[0],cards=()=>list().children.filter(item=>item.tag==='article'),history=()=>list().children.find(item=>item.tag==='details');
  const forms=item=>all(item).filter(child=>child.tag==='form'),note=form=>all(form).find(child=>child.tag==='textarea');
  const edit=(form,value)=>{note(form).value=value;note(form).listeners.input();};
  const submit=(form,status)=>form.listeners.submit({preventDefault(){},submitter:all(form).find(item=>item.tag==='button'&&item.value===status)});
  return{context,node,calls,run,all,text,render,list,cards,history,forms,note,edit,submit};
}

test('current dismissed and verified decisions hide only the proposal card and remain reopenable in collapsed history',async()=>{
  for(const status of ['dismissed','verified']){
    const h=harness({records:{'opaque-key':decision({status})}});h.render();assert.equal(h.cards().length,0);assert.ok(h.history());assert.notEqual(h.history().open,true);assert.match(h.text(h.history()),/Checked the synthetic task.*Current at the last scan.*Recorded source version: version-a/);
    const form=h.forms(h.history())[0];h.edit(form,'Reviewing this proposal again');await h.submit(form,'review');assert.equal(h.calls.length,1);assert.equal(h.calls[0].body.status,'review');assert.equal(h.cards().length,1);assert.match(h.text(h.cards()[0]),/Review again/);
  }
});

test('accepted and review assessments remain visible without claiming configuration changed or usefulness proven',()=>{
  for(const status of ['accepted','review']){const h=harness({records:{'opaque-key':decision({status})}});h.render();assert.equal(h.cards().length,1);assert.match(h.text(h.cards()[0]),status==='accepted'?/Plan to try/:/Review again/);assert.match(h.text(h.cards()[0]),/evidence from the last scan.*assessment, not configuration changes or proof of improvement/);}
});

test('changed fingerprints and uncertain current flags cannot suppress a fresh proposal',()=>{
  for(const saved of [decision({changed:true,fingerprint:'old-version'}),decision({fingerprint:'old-version'}),decision({current:false}),decision({current:undefined,changed:undefined})]){
    const h=harness({records:{'opaque-key':saved}});h.render();assert.equal(h.cards().length,1);assert.match(h.text(h.cards()[0]),/Evidence changed at the last scan; needs review/);assert.equal(h.note(h.forms(h.cards()[0])[0]).value,'');
  }
});

test('other repository or agent decisions never suppress or expose notes in the beginner scope',()=>{
  for(const saved of [decision({repo:'/synthetic/repo-b',note:'OTHER REPOSITORY NOTE'}),decision({agent:'codex',note:'OTHER AGENT NOTE'})]){
    const h=harness({records:{'opaque-key':saved}});h.render();assert.equal(h.cards().length,1);assert.equal(h.history(),undefined);assert.doesNotMatch(h.text(h.list()),/OTHER REPOSITORY|OTHER AGENT/);assert.equal(h.note(h.forms(h.cards()[0])[0]).value,'');
  }
  const global=harness({records:{'opaque-key':decision({repo:''})}});global.render();assert.equal(global.cards().length,1);assert.equal(global.history(),undefined);
});

test('legacy decisions remain advanced history and never become scoped status or prefilled notes',()=>{
  const legacy={status:'verified',note:'LEGACY NOTE',at:'2026-10-01',recommendation:proposal()};const h=harness({records:{'proposal-a':legacy}});h.render();assert.equal(h.cards().length,1);assert.equal(h.history(),undefined);assert.doesNotMatch(h.text(h.cards()[0]),/Your verification recorded|LEGACY NOTE/);assert.equal(h.note(h.forms(h.cards()[0])[0]).value,'');
  const history=h.run('recommendationDecisionHistory(true)');assert.match(h.text(history),/Legacy unscoped decision; not reused.*LEGACY NOTE/);assert.equal(h.forms(history).length,0);
});

test('unavailable saved proposals keep their snapshot and note but offer no decision action',()=>{
  const h=harness({recommendations:[],records:{'opaque-key':decision({current:false,changed:false})}});h.render();assert.equal(h.cards().length,0);assert.match(h.text(h.history()),/Checked the synthetic task.*no longer available in the last scanned evidence.*Saved proposal and source/);assert.equal(h.forms(h.history()).length,0);
});

test('a rendered decision sends the original agent, repository and fingerprint even after page changes',async()=>{
  const h=harness();h.render();const form=h.forms(h.cards()[0])[0];h.edit(form,'  Scoped user assessment  ');h.context.activeRepo='/synthetic/repo-b';h.context.selectedAgent='codex';h.context.state.recommendations=[proposal({repo:'/synthetic/repo-b',fingerprint:'version-b'})];await h.submit(form,'accepted');
  assert.equal(h.calls[0].path,'/api/recommendation');assert.deepEqual({...h.calls[0].body},{id:'proposal-a',agent:'claude',repo,fingerprint:'version-a',status:'accepted',note:'Scoped user assessment'});
});

test('blank notes are required for every status and missing fingerprints expose no save form',async()=>{
  for(const status of ['accepted','dismissed','verified','review']){const h=harness();h.render();const form=h.forms(h.cards()[0])[0];assert.equal(h.note(form).required,true);await h.submit(form,status);assert.equal(h.calls.length,0);assert.match(h.text(form),/Add a note before recording any decision/);}
  const missing=harness({recommendations:[proposal({fingerprint:undefined})]});missing.render();assert.equal(missing.forms(missing.cards()[0]).length,0);assert.match(missing.text(missing.cards()[0]),/current source version is required/);
});

test('stale or failed saves retain recoverable notes across polling and a new scanned version with generic errors',async()=>{
  const h=harness({api:async()=>{throw new Error('PRIVATE RAW SOURCE PATH');}});h.render();const form=h.forms(h.cards()[0])[0];h.edit(form,'Recover this assessment');await h.submit(form,'verified');
  h.render();let next=h.forms(h.cards()[0])[0];assert.equal(h.note(next).value,'Recover this assessment');assert.match(h.text(next),/Could not confirm this decision.*note is still here.*Refresh to check saved decisions/);assert.doesNotMatch(h.text(next),/PRIVATE RAW/);
  h.context.state.recommendations=[proposal({fingerprint:'version-b'})];h.render();next=h.forms(h.cards()[0])[0];assert.equal(h.note(next).value,'Recover this assessment');h.edit(next,'Reviewed the new scanned source');await h.submit(next,'review');assert.equal(h.calls.at(-1).body.fingerprint,'version-b');assert.equal(h.calls.at(-1).body.note,'Reviewed the new scanned source');
});

test('pending saves survive rerenders and prevent duplicate decisions or note edits for the same scope',async()=>{
  let release;const h=harness({api:async()=>new Promise(resolve=>{release=resolve;})});h.render();const form=h.forms(h.cards()[0])[0];h.edit(form,'Assessment');const pending=h.submit(form,'dismissed');h.render();const current=h.forms(h.cards()[0])[0];assert.equal(h.note(current).disabled,true);assert.equal(h.all(current).filter(item=>item.tag==='button').every(item=>item.disabled),true);await h.submit(current,'verified');assert.equal(h.calls.length,1);release({});await pending;assert.equal(h.context.recommendationBusy.size,0);
});

test('advanced decisions use the known source agent and original repository with inert source metadata',async()=>{
  const h=harness({recommendations:[proposal({agent:undefined,repo:'/synthetic/repo-b',title:'<img src=x>',fingerprint:'version-b'})]});h.context.activeRepo='/synthetic/repo-b';h.context.selectedAgent='codex';h.context.state.inventory.items=[{id:'skill-a',agent:'claude'}];const cards=h.run('recommendationCards(5)');assert.match(h.text(cards),/Decision scope: claude.*repo-b/);assert.equal(h.all(cards).some(item=>item.tag==='img'),false);const form=h.forms(cards)[0];h.edit(form,'Advanced assessment');await h.submit(form,'accepted');assert.equal(h.calls[0].body.agent,'claude');assert.equal(h.calls[0].body.repo,'/synthetic/repo-b');assert.equal(h.calls[0].body.fingerprint,'version-b');
  const nonitem=harness({recommendations:[proposal({itemId:undefined,agent:'codex'})]});const other=nonitem.run('recommendationCards(5)');const otherForm=nonitem.forms(other)[0];nonitem.edit(otherForm,'Review the Codex proposal');await nonitem.submit(otherForm,'review');assert.equal(nonitem.calls[0].body.agent,'codex');
});

for(const expectedSaving of [120,0,'<img src=x onerror="synthetic()">',null,undefined])test(`legacy proposal figure ${String(expectedSaving)} never becomes an estimated benefit`,()=>{
  const record=proposal({expectedSaving}),h=harness({recommendations:[record]}),cards=h.run('recommendationCards(5)'),text=h.text(cards);
  assert.doesNotMatch(text,/Estimated benefit:|Measured saving|Proven saving/);
  if(expectedSaving==null)assert.doesNotMatch(text,/Unverified proposal figure:|0 tokens/);
  else assert.ok(text.includes('Unverified proposal figure: '+(typeof expectedSaving==='number'?expectedSaving+' tokens':expectedSaving)+'. Saving is unknown until a comparable before/after test.'));
  assert.equal(h.all(cards).some(node=>node.tag==='img'),false);assert.equal(record.expectedSaving,expectedSaving);assert.equal(h.note(h.forms(cards)[0]).value,'');assert.equal(h.calls.length,0);
});

test('failed refresh after a successful API call leaves an honest unknown confirmation and recoverable note',async()=>{
  const h=harness();h.context.refresh=async()=>{throw new Error('PRIVATE REFRESH DETAILS');};h.render();const form=h.forms(h.cards()[0])[0];h.edit(form,'Keep this note until confirmation');await h.submit(form,'accepted');h.render();const next=h.forms(h.cards()[0])[0];assert.equal(h.calls.length,1);assert.equal(h.context.state.recommendationRecords['opaque-saved-key'].status,'accepted');assert.equal(h.note(next).value,'Keep this note until confirmation');assert.match(h.text(next),/Could not confirm this decision.*Refresh to check saved decisions/);assert.doesNotMatch(h.text(next),/Could not save|PRIVATE REFRESH/);
});

test('state refresh updates beginner decisions without a new loading request and keeps identical views stable',()=>{
  const h=harness(),noop=()=>{};h.context.state.settings={budgets:{}};Object.assign(h.context,{renderSnapshots:new Map(),initialRender:false,activeChat:null,reusableScope:null,improvementId:null});
  for(const name of ['updateControls','renderDashboard','renderInventory','renderContextBreakdowns','renderContext','renderGaps','renderAgents','renderPatterns','renderJournal','renderStorage','renderHistory','renderReusableList','renderImprovements','renderConversation','updateStartGuide','refreshLoading'])h.context[name]=noop;
  vm.runInContext(slice('function hasChanged(','function effectiveBudget(')+slice('function renderState()','async function refresh()'),h.context);h.run('renderState()');assert.equal(h.cards().length,1);
  h.context.state.recommendationRecords={'opaque-key':decision()};h.run('renderState()');assert.equal(h.cards().length,0);const panel=h.node('beginner-improvements').children[0];h.run('renderState()');assert.equal(h.node('beginner-improvements').children[0],panel);
  h.context.state.recommendationRecords['opaque-key'].changed=true;h.run('renderState()');assert.equal(h.cards().length,1);assert.match(h.text(h.cards()[0]),/Evidence changed at the last scan; needs review/);
});

test('static suggestions disclosure retains expansion and decision drafts while counts stay scoped and current',()=>{
  const h=harness({recommendations:proposals(5)}),outer=h.node('beginner-suggestions');assert.equal(outer.open,false);h.render();assert.equal(outer.hidden,false);assert.equal(h.node('beginner-suggestions-count').textContent,' · 5 to review');outer.open=true;h.edit(h.forms(h.cards()[0])[0],'Retained synthetic decision draft');h.render();assert.equal(h.node('beginner-suggestions'),outer);assert.equal(outer.open,true);assert.equal(h.note(h.forms(h.cards()[0])[0]).value,'Retained synthetic decision draft');assert.equal(h.calls.length,0);
  h.context.state.recommendationRecords={'saved-key':decision({recommendation:proposals(5)[0]})};h.render();assert.equal(h.node('beginner-suggestions-count').textContent,' · 4 to review');assert.ok(h.history());assert.equal(outer.open,true);
  const old=h.context.loading;h.context.loading=null;h.render();assert.equal(outer.hidden,true);assert.equal(h.node('beginner-suggestions-count').textContent,'');assert.equal(h.node('beginner-improvements').children.length,0);assert.equal(outer.open,true);h.context.loading=old;h.render();assert.equal(outer.hidden,false);assert.equal(outer.open,true);
});

test('old scope, scan and loading identity cannot display an actionable count or trigger review and test actions',()=>{
  for(const change of [context=>{context.activeRepo='/synthetic/other';},context=>{context.selectedAgent='codex';},context=>{context.state.inventory.scannedAt='new-scan';},context=>{context.loading=null;}]){
    const h=harness(),effects=[];h.context.openChat=(...args)=>effects.push(args);h.context.openImprovement=(...args)=>effects.push(args);h.render();const buttons=h.all(h.cards()[0]).filter(node=>node.tag==='button'&&['Review this improvement','Test this improvement'].includes(node.textContent));change(h.context);for(const button of buttons)button.listeners.click();assert.equal(effects.length,0);h.render();assert.equal(h.node('beginner-suggestions').hidden,true);assert.equal(h.node('beginner-suggestions-count').textContent,'');assert.equal(h.calls.length,0);
  }
  const foreign=harness();foreign.context.loading.repo='/synthetic/other';foreign.render();assert.equal(foreign.node('beginner-suggestions').hidden,true);assert.equal(foreign.node('beginner-suggestions-count').textContent,'');
});

test('actual map requests hide old counts on pending and error, then restore disclosure and draft on success',async()=>{
  const releases=[],h=harness({api:async()=>new Promise((resolve,reject)=>releases.push({resolve,reject}))});Object.assign(h.context,{loadingDirectories:new Map(),loadingSequence:0,loadingError:'',loadingDirectoryNotice:'',renderComponents(){},renderContextBreakdowns(){},updateStartGuide(){},renderLoading(){h.render();}});h.context.state.csrfToken='synthetic';h.context.loadingKey='';vm.runInContext(slice('async function refreshLoading(', 'function friendlyStatus('),h.context);h.context.loadingKey=JSON.stringify([repo,'claude','','synthetic-scan']);h.render();const outer=h.node('beginner-suggestions');outer.open=true;h.edit(h.forms(h.cards()[0])[0],'Draft through map failure');const original=h.context.loading;
  const failed=h.run('refreshLoading(true)');assert.equal(outer.hidden,true);assert.equal(h.node('beginner-suggestions-count').textContent,'');assert.equal(h.node('beginner-improvements').children.length,0);assert.equal(outer.open,true);releases[0].reject(new Error('Synthetic failure'));await failed;assert.equal(outer.hidden,true);assert.equal(h.node('beginner-suggestions-count').textContent,'');assert.match(h.node('loading-summary').textContent,/Could not explain/);
  const succeeded=h.run('refreshLoading(true)');releases[1].resolve(original);await succeeded;assert.equal(h.node('beginner-suggestions'),outer);assert.equal(outer.open,true);assert.equal(outer.hidden,false);assert.equal(h.node('beginner-suggestions-count').textContent,' · 1 to review');assert.equal(h.note(h.forms(h.cards()[0])[0]).value,'Draft through map failure');assert.deepEqual(h.calls.map(call=>call.path),['/api/loading','/api/loading']);
});

for(const advanced of [false,true])test(`${advanced?'advanced':'beginner'} preview exposes every scoped proposal with counts and bounded local expansion`,()=>{
  const step=advanced?5:3,records=proposals(step*2+2),h=harness({recommendations:records});let body;
  const render=()=>{if(advanced)body=h.run('recommendationCards()');else h.render();},list=()=>advanced?body:h.list(),cards=()=>list().children.filter(node=>node.tag==='article'),more=()=>list().children.find(node=>node.tag==='button');h.context.renderDashboard=render;render();
  assert.equal(cards().length,step);assert.match(h.text(list()),new RegExp('Showing '+step+' of '+records.length+' proposals'));assert.equal(more().textContent,'Show '+step+' more proposals');
  assert.equal(list().children.find(node=>node.textContent.startsWith('Showing ')).role,'status');more().listeners.click();assert.equal(cards().length,step*2);assert.equal(more().textContent,'Show 2 more proposals');
  more().listeners.click();assert.equal(cards().length,records.length);assert.equal(more(),undefined);assert.match(h.text(list()),new RegExp('Showing '+records.length+' of '+records.length+' proposals'));
  for(const record of records)assert.ok(cards().some(card=>h.text(card).includes(record.title)));assert.equal(h.calls.length,0);
});

for(const advanced of [false,true])test(`${advanced?'advanced':'beginner'} preview adds no overflow controls at its exact threshold or for an empty list`,()=>{
  for(const count of [0,advanced?5:3]){
    const h=harness({recommendations:proposals(count)});let list;if(advanced)list=h.run('recommendationCards()');else{h.render();list=h.list();}
    assert.equal(list.children.filter(node=>node.tag==='article').length,count);assert.equal(list.children.some(node=>node.tag==='button'),false);assert.doesNotMatch(h.text(list),/Showing \d+ of \d+ proposals|Show \d+ more proposals/);assert.equal(h.calls.length,0);
  }
});

test('advanced previews honor a supplied initial limit and use steps of five',()=>{
  const h=harness({recommendations:proposals(8)});let body;h.context.renderDashboard=()=>{body=h.run('recommendationCards(2)');};h.context.renderDashboard();
  const cards=()=>body.children.filter(node=>node.tag==='article'),more=()=>body.children.find(node=>node.tag==='button');assert.equal(cards().length,2);assert.equal(more().textContent,'Show 5 more proposals');
  more().listeners.click();assert.equal(cards().length,7);assert.equal(more().textContent,'Show 1 more proposal');more().listeners.click();assert.equal(cards().length,8);assert.equal(more(),undefined);assert.equal(h.calls.length,0);
});

test('beginner expansion counts only actionable applicable proposals and skips current dismissed or verified cards',()=>{
  const records=proposals(6),dismissed=proposal({id:'dismissed',title:'Dismissed proposal'}),verified=proposal({id:'verified',title:'Verified proposal'}),global=proposal({id:'global',repo:'',title:'Global proposal'});
  const h=harness({recommendations:[...records,dismissed,verified,global,proposal({id:'other-repo',repo:'/synthetic/other',title:'Other repository'}),proposal({id:'other-agent',itemId:undefined,agent:'codex',title:'Other agent'}),proposal({id:'missing-asset',itemId:'missing',title:'Missing asset'})],records:{dismissed:decision({recommendation:dismissed}),verified:decision({status:'verified',recommendation:verified})}});
  h.render();assert.match(h.text(h.list()),/Showing 3 of 7 proposals/);while(h.list().children.some(node=>node.tag==='button'))h.list().children.find(node=>node.tag==='button').listeners.click();
  assert.equal(h.cards().length,7);assert.ok(h.cards().some(card=>h.text(card).includes('Global proposal')));for(const title of ['Dismissed proposal','Verified proposal','Other repository','Other agent','Missing asset'])assert.equal(h.cards().some(card=>h.text(card).includes(title)),false);
  assert.match(h.text(h.history()),/Dismissed proposal.*Verified proposal/s);assert.equal(h.calls.length,0);
});

test('advanced expansion keeps existing repository filtering and leaves other-repository cards out of its total',()=>{
  const h=harness({recommendations:[...proposals(6),proposal({id:'global',repo:'',title:'Global proposal'}),proposal({id:'other',repo:'/synthetic/other',title:'Other repository'})]});let body;h.context.renderDashboard=()=>{body=h.run('recommendationCards()');};h.context.renderDashboard();
  assert.match(h.text(body),/Showing 5 of 7 proposals/);body.children.find(node=>node.tag==='button').listeners.click();assert.equal(body.children.filter(node=>node.tag==='article').length,7);assert.doesNotMatch(h.text(body),/Other repository/);assert.equal(h.calls.length,0);
});

for(const advanced of [false,true])test(`${advanced?'advanced':'beginner'} expansion and polling preserve visibility and the scoped decision draft`,()=>{
  const records=proposals(8),h=harness({recommendations:records});let body;const render=()=>{if(advanced)body=h.run('recommendationCards()');else h.render();},list=()=>advanced?body:h.list();h.context.renderDashboard=render;render();
  h.edit(h.forms(list())[0],'Unsaved scoped assessment');const key=JSON.stringify([records[0].id,'claude',repo]),draft=h.context.recommendationDrafts.get(key);list().children.find(node=>node.tag==='button').listeners.click();
  const visible=list().children.filter(node=>node.tag==='article').length;assert.equal(h.note(h.forms(list())[0]).value,'Unsaved scoped assessment');h.context.state.recommendations=records.map(record=>({...record}));render();
  assert.equal(list().children.filter(node=>node.tag==='article').length,visible);assert.equal(h.context.recommendationDrafts.get(key),draft);assert.equal(h.note(h.forms(list())[0]).value,'Unsaved scoped assessment');assert.equal(h.calls.length,0);
});

for(const advanced of [false,true])for(const change of [{activeRepo:'/synthetic/other'},{selectedAgent:'codex'}])test(`${advanced?'advanced':'beginner'} stale expansion callback rejects changed scope ${JSON.stringify(change)}`,()=>{
  const h=harness({recommendations:proposals(8)});let list,renders=0;if(advanced){list=h.run('recommendationCards()');h.context.renderDashboard=()=>{renders++;};}else{h.render();list=h.list();h.context.renderBeginnerHealth=()=>{renders++;};}
  const more=list.children.find(node=>node.tag==='button');Object.assign(h.context,change);more.listeners.click();assert.equal(h.context.friendlyLimits.size,0);assert.equal(renders,0);assert.equal(h.calls.length,0);
});

test('beginner expansion refuses a cleared pending map and uses a separate limit from advanced preview',()=>{
  const h=harness({recommendations:proposals(8)});h.render();const old=h.list().children.find(node=>node.tag==='button');h.context.loading=null;old.listeners.click();assert.equal(h.context.friendlyLimits.size,0);
  h.context.loading={repo,agent:'claude',components:{items:[{id:'skill-a'}],summary:{}}};h.render();h.list().children.find(node=>node.tag==='button').listeners.click();assert.equal(h.context.friendlyLimits.get('beginner-recommendations'),6);
  const advanced=h.run('recommendationCards()');assert.equal(advanced.children.filter(node=>node.tag==='article').length,5);assert.equal(h.context.friendlyLimits.has('advanced-recommendations'),false);assert.equal(h.calls.length,0);
});

test('beginner cards keep complete inert evidence and steps only inside an initially closed native disclosure',()=>{
  const record=proposal({evidence:'Full synthetic evidence\n/synthetic/'+('long-path/'.repeat(30))+'<img src=x onerror="synthetic()">',action:'Complete proposed steps\n<script>synthetic()</script>'}),h=harness({recommendations:[record],records:{'saved-key':decision({status:'accepted',recommendation:record})}});h.render();
  const card=h.cards()[0],details=card.children.find(node=>node.tag==='details'&&node.children[0]?.textContent==='Evidence and proposed steps'),actions=card.children.find(node=>node.className==='item-actions');
  assert.ok(details);assert.equal(details.open,false);assert.equal(details.children[0].tag,'summary');assert.equal(details.children[1].textContent,record.evidence);assert.equal(details.children[2].textContent,record.action);
  const outside=card.children.filter(node=>node!==details).map(h.text).join(' ');assert.equal(outside.includes(record.evidence),false);assert.equal(outside.includes(record.action),false);assert.match(outside,/Review synthetic skill.*Plan to try/);
  assert.deepEqual(actions.children.map(node=>node.textContent),['Review this improvement','Test this improvement']);assert.equal(h.all(details).some(node=>node.tag==='button'),false);assert.equal(h.all(card).some(node=>['img','script'].includes(node.tag)),false);
  assert.equal(card.children.some(node=>node.className==='recommendation-decision'),true);assert.equal(h.calls.length,0);
  const css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');assert.match(css,/#beginner-improvements \.item-card>\.item-actions\{flex-wrap:wrap\}/);
});

test('visible beginner review and test actions retain the original full proposal, prompt and selected IDs',()=>{
  const record=proposal({evidence:'Original full evidence\nSynthetic detail line',action:'Original full proposed action\nSynthetic step line'}),h=harness({recommendations:[record]}),selections=[],chats=[],tests=[];
  h.context.proposalSelection=selected=>{selections.push(selected);return new Set(['skill-a','synthetic-copy']);};h.context.openChat=(...args)=>chats.push(args);h.context.openImprovement=(...args)=>tests.push(args);h.render();
  const card=h.cards()[0],actions=card.children.find(node=>node.className==='item-actions');assert.equal(chats.length,0);assert.equal(tests.length,0);actions.children[0].listeners.click();
  assert.equal(selections[0],record);assert.deepEqual([...h.context.selectedIds],['skill-a','synthetic-copy']);assert.deepEqual([...chats[0][0]],['dashboard','inventory','context']);
  assert.equal(chats[0][1],'Review this scoped proposal. Explain what to keep, what to change, how to verify it and how to roll back.\n'+record.title+'\n'+record.evidence+'\n'+record.action);assert.deepEqual([...chats[0][4]],['skill-a','synthetic-copy']);
  assert.equal(h.node('chat-agent').value,'claude');assert.equal(h.node('chat-intent').value,'optimization');actions.children[1].listeners.click();assert.equal(tests[0][0],null);assert.equal(tests[0][1],record);assert.deepEqual([...tests[0][2]],[record.itemId]);assert.equal(h.calls.length,0);
});
