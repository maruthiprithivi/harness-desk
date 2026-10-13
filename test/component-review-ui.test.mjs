import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const slice=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const components=slice('function sortComponents(','function openLoadingChat(');
const action=slice('async function action(','function scopedItems(');
const tick=()=>new Promise(setImmediate);
const item={id:'component-a',name:'Synthetic skill',description:'Synthetic description',type:'skill',agent:'shared',path:'/synthetic/shared/SKILL.md',repo:'',contentHash:'a'.repeat(64),bytes:80,modifiedAt:'2026-10-01',residentTokens:4,bodyTokens:20,canInspectTools:true};
const version=(source=item)=>JSON.stringify([source.contentHash,source.bytes,source.modifiedAt]);
const key=(agent='claude',repo='/synthetic/repo-a')=>JSON.stringify([item.id,agent,repo]);

function harness(){
  const row={...item};
  const nodes=new Map(),calls=[],refreshes=[],errors=[],otherActions=[],releases=[];
  const descendants=node=>[node,...node.children.flatMap(descendants)];
  const element=(tag='div',className='',textContent='')=>({tag,className,textContent,children:[],dataset:{},value:'',disabled:false,hidden:false,listeners:{},focus(){this.focused=true;},append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},addEventListener(type,fn){this.listeners[type]=fn;},setAttribute(name,value){this[name]=value;},setCustomValidity(message){this.validationMessage=message;},reportValidity(){this.reported=true;},set innerHTML(value){throw new Error('Text-only rendering required');}});
  const node=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
  const context=vm.createContext({$:node,element,array:value=>Array.isArray(value)?value:[],number:String,tokens:String,date:String,agentName:String,repoName:String,badge:(text,tone)=>element('span',tone,text),empty:(title,description)=>element('div','empty',title+' '+description),button:(text,className,fn)=>{const button=element('button',className,text);button.listeners.click=fn;return button;},setOptions(node,options,placeholder,selected){node.value=selected??options[0]?.value??'';},matchingFileReads:()=>[],appendFileReadEvidence(){},usageCounts:()=>({}),usageCountText:()=>'',
    state:{improvements:[],inventory:{scannedAt:'synthetic-scan',items:[row]}},loading:{components:{items:[row]}},componentPage:0,componentDrafts:new Map(),componentReviewPending:new Map(),componentDisclosures:new Map(),activeRepo:'/synthetic/repo-a',selectedAgent:'claude',clearError(){},showError:error=>errors.push(error.message),updateChatAvailability(){},toast(){},
    openEditor:id=>otherActions.push(['editor',id]),openComponentChat:component=>otherActions.push(['chat',component.id]),openImprovement:(...args)=>otherActions.push(['test',...args]),
    api:(path,body)=>{calls.push({path,body});return new Promise((resolve,reject)=>releases.push({resolve,reject}));},refreshLoading:async force=>{refreshes.push({force,agent:context.selectedAgent,repo:context.activeRepo});context.renderComponents();},
  });
  vm.runInContext(action+components,context);
  const render=()=>context.renderComponents();
  const card=()=>node('component-list').children.find(node=>node.dataset.componentId===item.id);
  const controls=()=>{const all=descendants(card()),form=all.find(node=>node.tag==='form');return{form,helpfulness:all.find(node=>node.name==='component-helpfulness'),status:all.find(node=>node.name==='component-status'),date:all.find(node=>node.name==='last-used'),note:all.find(node=>node.name==='component-note'),save:all.find(node=>node.tag==='button'&&node.type==='submit')};};
  const fill=(values={status:'used',lastUsed:'2026-10-01',note:'  Submitted evidence  '})=>{const c=controls();c.status.value=values.status;c.helpfulness.value=values.helpfulness??'unknown';c.date.value=values.lastUsed;c.note.value=values.note;c.form.listeners.input();return c;};
  const submit=c=>c.form.listeners.submit({preventDefault(){}});
  const find=label=>descendants(card()).find(node=>node.tag==='button'&&node.textContent===label),text=node=>[node.textContent,...node.children.map(text)].join(' ');
  const change=patch=>{const row={...context.loading.components.items[0],...patch};context.loading.components.items=[row];context.state.inventory.items=[row];return row;};
  return{context,node,calls,refreshes,errors,otherActions,releases,descendants,render,card,controls,fill,submit,find,text,change};
}

test('deferred saves freeze every review field and replacement cards reject duplicate saves while unrelated actions remain available',async()=>{
  const h=harness();h.render();const original=h.fill();h.submit(original);assert.equal(h.calls.length,1);
  for(const c of [original.status,original.date,original.helpfulness,original.note,original.save])assert.equal(c.disabled,true);
  h.render();const replacement=h.controls();for(const c of [replacement.status,replacement.date,replacement.helpfulness,replacement.note,replacement.save])assert.equal(c.disabled,true);assert.equal(replacement.note.value,'  Submitted evidence  ');assert.match(replacement.save.textContent,/Saving/);
  h.submit(replacement);h.submit(original);assert.equal(h.calls.length,1);
  const links=h.descendants(h.card()).filter(node=>node.tag==='button'&&node.type!=='submit'&&!['Open current file','Use this note for the current file'].includes(node.textContent));assert.equal(links.every(node=>!node.disabled),true);for(const link of links.slice(0,3))link.listeners.click({currentTarget:link});assert.equal(h.otherActions.length,3);
  h.releases[0].resolve({});await tick();assert.equal(h.context.componentReviewPending.size,0);for(const c of Object.values(h.controls()).filter(node=>node.tag!=='form'))assert.equal(c.disabled,false);
});

test('submitted assessment, date, trimmed note and original scope are captured before awaiting the save',async()=>{
  const h=harness();h.render();const original=h.fill();h.submit(original);original.status.value='review';original.date.value='2026-10-12';original.note.value='Programmatically changed node';original.form.listeners.input();
  h.context.activeRepo='/synthetic/repo-b';h.context.selectedAgent='codex';h.render();
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].body)),{id:item.id,agent:'claude',repo:'/synthetic/repo-a',version:version(),status:'used',helpfulness:'unknown',lastUsed:'2026-10-01',note:'Submitted evidence'});assert.equal(h.context.componentDrafts.get(key()).note,'  Submitted evidence  ');
  h.releases[0].resolve({});await tick();assert.deepEqual(h.refreshes,[{force:true,agent:'codex',repo:'/synthetic/repo-b'}]);assert.equal(h.context.activeRepo,'/synthetic/repo-b');assert.equal(h.context.selectedAgent,'codex');assert.equal(h.controls().status.value,'unknown');
});

test('switching away and back retains the pending original form and leaves another scoped draft intact',async()=>{
  const h=harness();h.render();h.submit(h.fill());h.context.activeRepo='/synthetic/repo-b';h.render();const other=h.fill({status:'review',lastUsed:'',note:'Other repository draft'});assert.equal(other.save.disabled,false);
  h.context.activeRepo='/synthetic/repo-a';h.render();const originalAgain=h.controls();assert.equal(originalAgain.status.disabled,true);assert.equal(originalAgain.note.value,'  Submitted evidence  ');h.submit(originalAgain);assert.equal(h.calls.length,1);
  h.context.activeRepo='/synthetic/repo-b';h.render();h.releases[0].resolve({});await tick();assert.equal(h.context.componentDrafts.has(key()),false);assert.equal(h.context.componentDrafts.get(key('claude','/synthetic/repo-b')).note,'Other repository draft');assert.equal(h.controls().note.value,'Other repository draft');assert.equal(h.controls().save.disabled,false);
});

test('a save failure restores a replacement card with the entire submitted draft and permits a deliberate retry',async()=>{
  const h=harness();h.render();h.submit(h.fill());h.render();h.releases[0].reject(new Error('Synthetic failure'));await tick();assert.deepEqual(h.errors,['Synthetic failure']);assert.equal(h.refreshes.length,0);assert.equal(h.context.componentReviewPending.size,0);
  const restored=h.controls();assert.equal(restored.status.value,'used');assert.equal(restored.date.value,'2026-10-01');assert.equal(restored.note.value,'  Submitted evidence  ');for(const c of [restored.status,restored.date,restored.helpfulness,restored.note,restored.save])assert.equal(c.disabled,false);
  restored.note.value='Retry evidence';restored.form.listeners.input();h.submit(restored);assert.equal(h.calls.length,2);assert.equal(h.calls[1].body.note,'Retry evidence');h.releases[1].resolve({});await tick();assert.equal(h.context.componentDrafts.has(key()),false);
});

for(const fail of [false,true])test(`a newer same-scope draft is not lost when the original save ${fail?'fails':'succeeds'}`,async()=>{
  const h=harness();h.render();h.submit(h.fill());const newer={status:'review',lastUsed:'',note:'Newer recoverable draft',sourceVersion:version()};h.context.componentDrafts.set(key(),newer);h.render();assert.equal(h.controls().note.value,'  Submitted evidence  ');assert.equal(h.controls().save.disabled,true);
  fail?h.releases[0].reject(new Error('Synthetic failure')):h.releases[0].resolve({});await tick();assert.equal(h.context.componentDrafts.get(key()),newer);assert.equal(h.controls().note.value,'Newer recoverable draft');assert.equal(h.controls().status.value,'review');assert.equal(h.controls().save.disabled,false);
});

test('separate scope saves can run independently and each completion clears only its own submitted draft',async()=>{
  const h=harness();h.render();h.submit(h.fill());h.context.selectedAgent='codex';h.context.activeRepo='';h.render();h.submit(h.fill({status:'unknown',lastUsed:'2026-10-03',note:'Global Codex note'}));assert.equal(h.calls.length,2);assert.equal(h.calls[1].body.agent,'codex');assert.equal(h.calls[1].body.repo,'');assert.equal(h.calls[1].body.lastUsed,'');assert.equal(h.context.componentReviewPending.size,2);
  h.releases[0].resolve({});await tick();assert.equal(h.context.componentReviewPending.size,1);assert.equal(h.controls().save.disabled,true);assert.equal(h.context.componentDrafts.has(key()),false);assert.equal(h.context.componentDrafts.has(key('codex','')),true);
  h.releases[1].reject(new Error('Global save failed'));await tick();assert.equal(h.context.componentReviewPending.size,0);assert.equal(h.controls().note.value,'Global Codex note');assert.equal(h.controls().save.disabled,false);
});

test('an unedited form still has a recoverable draft after failure and pending event callbacks cannot replace it',async()=>{
  const h=harness();h.render();const initial=h.controls();h.submit(initial);assert.equal(h.context.componentDrafts.has(key()),true);h.render();const pending=h.controls();pending.note.value='Impossible disabled edit';pending.form.listeners.change();assert.equal(h.context.componentDrafts.get(key()).note,'');
  h.releases[0].reject(new Error('Synthetic failure'));await tick();assert.equal(h.controls().note.value,'');assert.equal(h.context.componentDrafts.get(key()).status,'unknown');assert.equal(h.controls().save.disabled,false);
});


test('submitted values remain immutable when a later draft object is edited in place',async()=>{
  const h=harness();h.render();h.submit(h.fill());const later=h.context.componentDrafts.get(key());later.note='Later draft edited in place';h.render();assert.equal(h.controls().note.value,'  Submitted evidence  ');assert.equal(h.calls[0].body.note,'Submitted evidence');
  h.releases[0].resolve({});await tick();assert.equal(h.context.componentDrafts.get(key()),later);assert.equal(h.controls().note.value,'Later draft edited in place');assert.equal(h.controls().save.disabled,false);
});

test('task outcome is optional and independent of use status and date but a known outcome requires a task note',async()=>{
  const h=harness();h.render();const initial=h.controls();assert.equal(initial.helpfulness.value,'unknown');assert.equal(initial.note.required,false);initial.helpfulness.value='not-helped';initial.helpfulness.listeners.change();initial.form.listeners.change();assert.equal(initial.note.required,true);assert.equal(initial.date.required,false);assert.equal(initial.date.value,'');h.submit(initial);assert.equal(h.calls.length,0);assert.match(initial.note.validationMessage,/task and its effect/);assert.equal(initial.note.reported,true);
  initial.note.value='The formatting task was slower without changing its result.';initial.form.listeners.input();assert.equal(initial.note.validationMessage,'');h.submit(initial);assert.equal(h.calls.length,1);assert.deepEqual({...h.calls[0].body},{id:item.id,agent:'claude',repo:'/synthetic/repo-a',version:version(),status:'unknown',helpfulness:'not-helped',lastUsed:'',note:initial.note.value});h.releases[0].resolve({});await tick();
});

test('pending task outcome survives replacement, failure and retry with the original captured scope',async()=>{
  const h=harness();h.render();const original=h.fill({status:'used',helpfulness:'mixed',lastUsed:'2026-10-01',note:'Task passed but needed more correction'});h.submit(original);assert.equal(original.helpfulness.disabled,true);original.helpfulness.value='helped';original.form.listeners.change();h.render();assert.equal(h.controls().helpfulness.value,'mixed');assert.equal(h.controls().helpfulness.disabled,true);assert.equal(h.calls[0].body.helpfulness,'mixed');h.context.activeRepo='/synthetic/repo-b';h.render();h.fill({status:'unknown',helpfulness:'not-helped',lastUsed:'',note:'Other task note'});h.releases[0].reject(new Error('Save failed'));await tick();assert.equal(h.controls().helpfulness.value,'not-helped');h.context.activeRepo='/synthetic/repo-a';h.render();assert.equal(h.controls().helpfulness.value,'mixed');assert.equal(h.controls().helpfulness.disabled,false);h.submit(h.controls());assert.equal(h.calls[1].body.helpfulness,'mixed');assert.equal(h.calls[1].body.repo,'/synthetic/repo-a');h.releases[1].resolve({});await tick();assert.equal(h.context.componentDrafts.has(key()),false);assert.equal(h.context.componentDrafts.get(key('claude','/synthetic/repo-b')).helpfulness,'not-helped');
});

for(const fail of [false,true])test(`a newer outcome-only draft survives original save ${fail?'failure':'success'}`,async()=>{
  const h=harness();h.render();h.submit(h.fill({status:'unknown',helpfulness:'helped',lastUsed:'',note:'Same task note'}));const later=h.context.componentDrafts.get(key());later.helpfulness='mixed';h.render();assert.equal(h.controls().helpfulness.value,'helped');fail?h.releases[0].reject(new Error('Save failed')):h.releases[0].resolve({});await tick();assert.equal(h.context.componentDrafts.get(key()),later);assert.equal(h.controls().helpfulness.value,'mixed');assert.equal(h.controls().helpfulness.disabled,false);
});

test('an old detached outcome save rejects a changed scope without a request or replacing the current draft',()=>{
  const h=harness();h.render();const old=h.fill({status:'unknown',helpfulness:'not-helped',lastUsed:'',note:'Original task'});h.context.activeRepo='/synthetic/repo-b';h.render();h.fill({status:'unknown',helpfulness:'helped',lastUsed:'',note:'New task'});h.submit(old);assert.equal(h.calls.length,0);assert.equal(h.context.componentDrafts.get(key('claude','/synthetic/repo-b')).helpfulness,'helped');
});

test('draft version stays captured through edits, closed polling and explicit current-file recovery',async()=>{
  const h=harness();h.render();const first=h.fill(),review=h.descendants(h.card()).find(node=>node.className==='component-review');review.open=false;review.listeners.toggle();const original=h.context.componentDrafts.get(key());assert.equal(original.sourceVersion,version());
  const next=h.change({contentHash:'b'.repeat(64),bytes:90,modifiedAt:'2026-10-02'});h.submit(first);assert.equal(h.calls.length,0);assert.equal(h.context.componentDrafts.get(key()).sourceVersion,version());assert.match(first.note.validationMessage,/current file/);
  h.render();const current=h.controls(),closed=h.descendants(h.card()).find(node=>node.className==='component-review');assert.equal(closed.open,false);assert.match(h.text(h.descendants(h.card()).find(node=>node.className==='component-evidence')),/Your kept note describes earlier or unknown file metadata/);assert.match(h.text(h.card()),/Next check: Review your kept note/);assert.equal(current.save.disabled,true);assert.equal(current.note.value,first.note.value);
  h.find('Review kept note').listeners.click();assert.equal(closed.open,true);assert.equal(current.note.focused,true);assert.equal(h.calls.length,0);current.note.value='Rechecked task note';current.form.listeners.input();assert.equal(h.context.componentDrafts.get(key()).sourceVersion,version());assert.equal(current.save.disabled,true);
  h.find('Open current file').listeners.click();assert.deepEqual(h.otherActions,[['editor',item.id]]);assert.equal(h.calls.length,0);h.find('Use this note for the current file').listeners.click();assert.equal(h.context.componentDrafts.get(key()).sourceVersion,version(next));assert.equal(current.save.disabled,false);assert.equal(h.descendants(h.card()).find(node=>node.textContent.startsWith('Your kept note describes')).hidden,true);assert.match(h.text(h.card()),/Next check: Save your confirmed note when ready/);assert.ok(h.find('Review confirmed note'));assert.equal(current.note.focused,true);assert.match(h.text(current.form),/your confirmation, not measured proof or a live-file check/);
  first.note.value='Detached old edit';first.form.listeners.input();h.submit(first);assert.equal(h.context.componentDrafts.get(key()).note,'Rechecked task note');assert.equal(h.calls.length,0);
  h.submit(current);assert.equal(h.calls[0].body.version,version(next));assert.equal(h.calls[0].body.note,'Rechecked task note');h.releases[0].resolve({});await tick();assert.equal(h.context.componentDrafts.has(key()),false);
});

test('changed saved notes retain their recorded version and legacy unknown notes require explicit confirmation',()=>{
  for(const savedVersion of [version(),undefined]){
    const h=harness(),current=h.change({contentHash:'b'.repeat(64),bytes:90,modifiedAt:'2026-10-02'});current.review={agent:'claude',repo:'/synthetic/repo-a',status:'used',helpfulness:'mixed',note:'Earlier task assessment',lastUsed:'2026-10-01',changed:true,version:savedVersion};h.render();const c=h.controls();assert.equal(c.note.value,'Earlier task assessment');assert.equal(c.save.disabled,true);assert.equal(h.context.componentDrafts.size,0);
    const disclosure=h.descendants(h.card()).find(node=>node.className==='component-review');disclosure.open=true;disclosure.listeners.toggle();assert.equal(h.context.componentDrafts.get(key()).sourceVersion,savedVersion??null);c.note.value='Edited earlier task assessment';c.form.listeners.input();h.submit(c);assert.equal(h.calls.length,0);assert.equal(h.context.componentDrafts.get(key()).sourceVersion,savedVersion??null);
    h.find('Use this note for the current file').listeners.click();assert.equal(c.save.disabled,false);assert.equal(h.context.componentDrafts.get(key()).sourceVersion,version(current));assert.equal(h.context.componentDrafts.get(key()).note,'Edited earlier task assessment');assert.equal(h.context.componentDrafts.get(key()).helpfulness,'mixed');assert.equal(h.calls.length,0);
  }
});

test('detached saves and confirmations reject scope or either source metadata drift without rebinding the note',()=>{
  const patches=[{id:'other'},{path:'/synthetic/other/SKILL.md'},{agent:'codex'},{repo:'/synthetic/other'},{type:'config'},{contentHash:'b'.repeat(64)},{bytes:81},{modifiedAt:'2026-10-02'}];
  for(const inventoryOnly of [false,true])for(const patch of patches){
    const h=harness();h.render();const c=h.fill(),draft=h.context.componentDrafts.get(key());const row={...h.context.loading.components.items[0],...patch};if(inventoryOnly)h.context.state.inventory.items=[row];else h.context.loading.components.items=[row];h.submit(c);h.find('Open current file').listeners.click();h.find('Use this note for the current file').listeners.click();assert.equal(h.calls.length,0);assert.equal(h.otherActions.length,0);assert.equal(h.context.componentDrafts.get(key()).sourceVersion,draft.sourceVersion);assert.equal(h.context.componentDrafts.get(key()).note,draft.note);
  }
  for(const change of [h=>h.context.activeRepo='/synthetic/other',h=>h.context.selectedAgent='codex']){const h=harness();h.render();const c=h.fill(),draft=h.context.componentDrafts.get(key());change(h);h.submit(c);h.find('Open current file').listeners.click();h.find('Use this note for the current file').listeners.click();assert.equal(h.context.componentDrafts.get(key()),draft);assert.equal(h.calls.length,0);assert.equal(h.otherActions.length,0);}
});

test('acknowledging version B cannot carry the note into version C or overwrite a newer acknowledged draft',()=>{
  const h=harness();h.render();h.fill();const next=h.change({contentHash:'b'.repeat(64)});h.render();const older=h.controls(),oldReuse=h.find('Use this note for the current file');h.render();const latest=h.controls();h.find('Use this note for the current file').listeners.click();latest.note.value='Newer confirmed note';latest.form.listeners.input();oldReuse.listeners.click();assert.equal(h.context.componentDrafts.get(key()).note,'Newer confirmed note');assert.equal(h.context.componentDrafts.get(key()).sourceVersion,version(next));
  h.context.state.inventory.items=[{...next,contentHash:'c'.repeat(64)}];h.submit(latest);h.find('Use this note for the current file').listeners.click();assert.equal(h.calls.length,0);assert.equal(h.context.componentDrafts.get(key()).sourceVersion,version(next));assert.equal(latest.save.disabled,true);assert.equal(older.note.value,'  Submitted evidence  ');
});

test('pending version and note survive source drift and API failure, then explicit recovery sends the current version',async()=>{
  const h=harness();h.render();h.submit(h.fill());const submitted=h.context.componentReviewPending.get(key());assert.equal(submitted.sourceVersion,version());assert.equal(h.calls[0].body.version,version());const next=h.change({contentHash:'b'.repeat(64)});h.render();h.find('Open current file').listeners.click();h.find('Use this note for the current file').listeners.click();assert.equal(h.otherActions.length,0);assert.equal(h.context.componentReviewPending.get(key()),submitted);h.releases[0].reject(new Error('File version changed'));await tick();assert.equal(h.controls().note.value,'  Submitted evidence  ');assert.equal(h.controls().save.disabled,true);assert.equal(h.context.componentDrafts.get(key()).sourceVersion,version());
  h.find('Use this note for the current file').listeners.click();h.submit(h.controls());assert.equal(h.calls[1].body.version,version(next));h.releases[1].resolve({});await tick();assert.equal(h.context.componentDrafts.has(key()),false);
});

test('an earlier successful response cannot clear identical fields belonging to a newer source version',async()=>{
  const h=harness();h.render();h.submit(h.fill());const next=h.change({contentHash:'b'.repeat(64)}),newer={...h.context.componentDrafts.get(key()),sourceVersion:version(next)};h.context.componentDrafts.set(key(),newer);h.releases[0].resolve({});await tick();assert.equal(h.context.componentDrafts.get(key()),newer);assert.equal(h.controls().note.value,'  Submitted evidence  ');assert.equal(h.controls().save.disabled,false);
});

test('an opened same-version form and unchanged metadata rescan preserve a usable captured draft',async()=>{
  const h=harness();h.render();const details=h.descendants(h.card()).find(node=>node.className==='component-review');details.open=true;details.listeners.toggle();assert.equal(h.context.componentDrafts.get(key()).sourceVersion,version());h.context.state.inventory.scannedAt='new scan';h.change({});h.render();const c=h.fill();assert.equal(c.save.disabled,false);h.node('component-sort').value='cost';h.render();assert.equal(h.controls().note.value,'  Submitted evidence  ');assert.equal(h.context.componentDrafts.get(key()).sourceVersion,version());h.submit(h.controls());assert.equal(h.calls[0].body.version,version());h.releases[0].resolve({});await tick();assert.equal(h.context.componentDrafts.size,0);
});
