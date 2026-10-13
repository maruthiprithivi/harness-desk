import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const functions=source.slice(source.indexOf('function reusableFields()'),source.indexOf('function renderImportedAudit()'));
const handlers=source.slice(source.indexOf("$('reusable-open').addEventListener"),source.indexOf("$('improvement-dialog').addEventListener('cancel'"));
const repo='/synthetic/repository-a';
const chat=(extra={})=>({id:'saved-chat',repo,agent:'codex',status:'complete',reusableRequest:{task:'Synthetic workflow',notes:'Keep the original draft',placement:'repo',targetAgent:'claude',invocation:'explicit'},reusable:{status:'saved',bundle:{name:'synthetic-workflow',description:'Review this fixture',files:[{path:'skills/synthetic/SKILL.md',content:'<script>inert fixture text</script>'}],estimates:{},trigger:'Synthetic task',nonTrigger:'Different task',verification:['Review synthetic checks']}},...extra});
const preview=(extra={})=>({conversationId:'saved-chat',bundleHash:'bundle-version',targetAgent:'claude',placement:'repo',repo,root:repo+'/.claude',files:[{path:'skills/synthetic/SKILL.md',destination:repo+'/.claude/skills/synthetic/SKILL.md',hash:'file-version',bytes:48,exists:false}],conflicts:[],previewHash:'destination-version',canApply:true,...extra});
const adoption=(extra={})=>({id:'adoption-record',conversationId:'saved-chat',bundleHash:'bundle-version',targetAgent:'claude',placement:'repo',repo,root:repo+'/.claude',status:'installed',files:[{path:'skills/synthetic/SKILL.md',destination:repo+'/.claude/skills/synthetic/SKILL.md',hash:'file-version',bytes:48}],...extra});

function harness({initial=chat(),adoptions=[],respond}={}){
  const nodes=new Map(),calls=[];
  const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',checked:false,disabled:false,hidden:true,open:false,dataset:{},children:[],listeners:{},textContent:'',
    append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},addEventListener(type,fn){this.listeners[type]=fn;},querySelector(){return node(id+'-option');},showModal(){this.open=true;},close(){this.open=false;},
    set innerHTML(value){throw new Error('Metadata and generated bodies must stay inert');},
  });return nodes.get(id);};
  const context=vm.createContext({$:node,array:value=>Array.isArray(value)?value:[],tokens:String,number:String,agentName:String,agentOptions:()=>[{value:'codex'}],effectiveRoute:()=>({agent:'codex'}),setOptions(item,options,empty,value){item.value=value||options[0]?.value||'';},
    element:(tag,className='',text='')=>Object.assign(node('element-'+nodes.size),{tag,className,textContent:String(text)}),button:(text,className,fn)=>{const item=Object.assign(node('button-'+nodes.size),{tag:'button',textContent:text,className});item.listeners.click=fn;return item;},empty:(title,description)=>Object.assign(node('empty-'+nodes.size),{textContent:title+' '+description}),
    activeRepo:repo,selectedAgent:'codex',reusableScope:null,reusableChat:null,reusableBusy:false,reusableAdoptionPreview:null,reusableDrafts:new Map(),improvementBusy:false,state:{agents:[],conversations:[initial],adoptions},
    api:async(path,body)=>{calls.push({path,body});if(respond)return respond(path,body,calls.length);return body.action==='preview'?preview():adoption({status:body.action==='restore'?'restored':'installed'});},
    refresh:async()=>{},schedulePoll(){},openChat(){context.openedChat=true;},openImprovement(){context.openedImprovement=true;},
  });
  vm.runInContext(functions+handlers,context);context.openReusable(null,initial);
  const run=expression=>vm.runInContext(expression,context),text=item=>[item.textContent,...item.children.map(text)].join(' '),all=item=>[item,...item.children.flatMap(all)];
  const click=id=>node('reusable-adoption-'+id).listeners.click(),review=(restore=false)=>{const item=node('reusable-adoption-'+(restore?'restore-reviewed':'reviewed'));item.checked=true;item.listeners.change();};
  return{context,node,calls,run,text,all,click,review};
}

test('saved drafts offer explicit adoption without automatic requests and unsafe or unsaved drafts cannot preview',async()=>{
  const h=harness();assert.equal(h.calls.length,0);assert.equal(h.node('reusable-adoption-preview').hidden,false);assert.equal(h.node('reusable-adoption-apply').hidden,true);
  for(const initial of [chat({reusable:{...chat().reusable,status:'ready'}}),chat({reusable:{...chat().reusable,status:'save-failed'}}),chat({status:'running'}),chat({reusableRequest:{placement:'unexpected',targetAgent:'claude'}}),chat({reusable:{status:'saved'}})]){const other=harness({initial});assert.equal(other.node('reusable-adoption-preview').hidden,true);await other.click('preview');assert.equal(other.calls.length,0);}
});

test('an older backend without adoption state offers no preview or apply action',async()=>{
  const h=harness();delete h.context.state.adoptions;h.run('renderReusableProgress()');assert.equal(h.node('reusable-adoption').hidden,true);assert.equal(h.node('reusable-adoption-preview').hidden,true);assert.equal(h.node('reusable-adoption-preview').disabled,true);await h.click('preview');h.context.reusableAdoptionPreview=preview();h.review();assert.equal(h.node('reusable-adoption-apply').hidden,true);assert.equal(h.node('reusable-adoption-apply').disabled,true);await h.click('apply');assert.equal(h.calls.length,0);
});

test('preview displays exact metadata as text, stays bound across dashboard changes and requires reviewed consent',async()=>{
  const h=harness();h.context.activeRepo='/synthetic/repository-b';h.context.selectedAgent='codex';await h.click('preview');assert.deepEqual({...h.calls[0].body},{action:'preview',id:'saved-chat'});assert.equal(h.calls[0].path,'/api/reusable-adoption');
  const display=h.text(h.node('reusable-adoption-destinations'));assert.match(display,/Destination: claude.*Repository: \/synthetic\/repository-a.*bundle-version.*\.claude\/skills\/synthetic\/SKILL.md.*48 bytes.*file-version.*New file/);
  await h.click('apply');assert.equal(h.calls.length,1);assert.equal(h.node('reusable-adoption-apply').disabled,true);h.review();assert.equal(h.node('reusable-adoption-apply').disabled,false);await h.click('apply');assert.deepEqual({...h.calls[1].body},{action:'apply',id:'saved-chat',previewHash:'destination-version',reviewed:true});assert.equal(h.context.state.adoptions[0].status,'installed');assert.match(h.node('reusable-adoption-status').textContent,/Files installed.*does not prove discovery, execution, or usefulness/);
});

test('conflicts and unavailable previews block apply even with explicit review and never render HTML',async()=>{
  for(const result of [preview({conflicts:[{destination:'<img src=x>',reason:'Already exists'}],files:[{...preview().files[0],exists:true}]}),preview({canApply:false})]){const h=harness({respond:async()=>result});await h.click('preview');h.review();await h.click('apply');assert.equal(h.calls.length,1);assert.equal(h.node('reusable-adoption-apply').disabled,true);assert.equal(h.all(h.node('reusable-adoption-destinations')).some(item=>item.tag==='img'),false);assert.match(h.text(h.node('reusable-adoption-destinations')),result.conflicts.length?/Conflicts prevent adoption.*<img src=x>/s:/preview cannot be applied.*manual review/);}
});

test('busy preview and apply prevent duplicate operations, closure, new drafts and scope retargeting',async()=>{
  let release;const h=harness({respond:async()=>new Promise(resolve=>{release=resolve;})});const pending=h.click('preview');for(const id of ['close','new','download','test'])assert.equal(h.node('reusable-'+id).disabled,true);h.node('reusable-dialog').listeners.cancel({preventDefault(){}});h.node('reusable-new').listeners.click();h.run('openReusable(null,null,true)');await h.click('preview');assert.equal(h.calls.length,1);assert.equal(h.node('reusable-dialog').open,true);assert.equal(h.context.reusableChat.id,'saved-chat');release(preview());await pending;
  h.review();const applying=h.click('apply');await h.click('apply');assert.equal(h.calls.length,2);assert.equal(h.node('reusable-adoption-reviewed').disabled,true);h.node('reusable-dialog').listeners.cancel({preventDefault(){}});release(adoption());await applying;assert.equal(h.context.reusableBusy,false);assert.equal(h.node('reusable-dialog').open,true);
});

test('apply errors retain draft and reading view but invalidate consent and require another explicit preview',async()=>{
  const h=harness({respond:async(path,body)=>{if(body.action==='preview')return preview();throw new Error('PRIVATE BACKEND DETAILS');}});const file=h.node('reusable-result').children.find(item=>item.tag==='details'&&item.children[0].textContent==='skills/synthetic/SKILL.md');file.open=true;await h.click('preview');h.review();await h.click('apply');assert.equal(h.context.reusableAdoptionPreview,null);assert.equal(h.node('reusable-adoption-reviewed').checked,false);assert.equal(h.node('reusable-notes').value,'Keep the original draft');assert.equal(file.open,true);assert.match(h.node('reusable-adoption-error').textContent,/Could not confirm adoption.*Refresh.*Preview/);assert.doesNotMatch(h.node('reusable-adoption-error').textContent,/PRIVATE/);await h.click('apply');assert.equal(h.calls.length,2);await h.click('preview');assert.equal(h.calls.length,3);assert.equal(h.node('reusable-adoption-reviewed').checked,false);
});

test('reopening resets ephemeral preview and consent while retaining persisted adoption recovery',async()=>{
  const record=adoption({status:'partial'}),h=harness({adoptions:[record]});await h.click('preview');h.review();h.review(true);h.run('closeReusable()');h.run('openReusable(null,reusableChat)');assert.equal(h.context.reusableAdoptionPreview,null);assert.equal(h.node('reusable-adoption-reviewed').checked,false);assert.equal(h.node('reusable-adoption-restore-reviewed').checked,false);assert.match(h.node('reusable-adoption-status').textContent,/partially completed/);assert.match(h.text(h.node('reusable-adoption-destinations')),/Recorded destination.*bundle-version.*Changed or unowned files are retained/s);assert.equal(h.calls.length,1);
});

test('restoration requires fresh review, sends only captured adoption identity and reports incomplete restoration honestly',async()=>{
  const h=harness({adoptions:[adoption()],respond:async()=>adoption({status:'restore-incomplete'})});await h.click('restore');assert.equal(h.calls.length,0);h.review(true);h.context.activeRepo='/synthetic/repository-b';h.context.selectedAgent='codex';await h.click('restore');assert.deepEqual({...h.calls[0].body},{action:'restore',adoptionId:'adoption-record',reviewed:true});assert.match(h.node('reusable-adoption-status').textContent,/Restore incomplete; retained files need review/);assert.equal(h.node('reusable-adoption-restore-reviewed').checked,false);assert.equal(h.node('reusable-adoption-restore').disabled,true);
  h.context.state.adoptions=[adoption({status:'restored'})];h.run('renderReusableProgress()');assert.match(h.node('reusable-adoption-status').textContent,/restored to the private archive/);assert.equal(h.node('reusable-adoption-restore').hidden,true);
});

test('persisted partial and failure states are scoped to the original conversation after reload without auto requests',()=>{
  for(const status of ['installing','restoring','installed','partial','failed','restored','restore-incomplete']){const h=harness({adoptions:[adoption({status}),adoption({id:'other-record',conversationId:'other-chat',root:'OTHER SCOPE ROOT'})]});assert.equal(h.calls.length,0);assert.doesNotMatch(h.text(h.node('reusable-adoption-destinations')),/OTHER SCOPE ROOT/);assert.match(h.text(h.node('reusable-adoption-destinations')),/Recorded adoption and recovery files/);assert.equal(h.node('reusable-adoption-restore').hidden,status==='restored');}
});

test('an interrupted restoration survives reload and requires fresh review before explicit recovery',async()=>{
  const h=harness({adoptions:[adoption({status:'restoring'})]});assert.match(h.node('reusable-adoption-status').textContent,/Restoration in progress; check recovery/);assert.match(h.text(h.node('reusable-adoption-destinations')),/Review recorded files before retrying/);assert.equal(h.node('reusable-adoption-restore-reviewed').checked,false);assert.equal(h.node('reusable-adoption-restore').disabled,true);await h.click('restore');assert.equal(h.calls.length,0);h.review(true);await h.click('restore');assert.deepEqual({...h.calls[0].body},{action:'restore',adoptionId:'adoption-record',reviewed:true});assert.match(h.node('reusable-adoption-status').textContent,/restored to the private archive/);
});

test('failed apply receipts show failure and only declared file metadata, excluding receipt errors and bodies',async()=>{
  const record=adoption({status:'failed',error:'PRIVATE RECEIPT ERROR',events:[{body:'PRIVATE EVENT BODY'}],files:[{...adoption().files[0],content:'PRIVATE SOURCE BODY',error:'PRIVATE FILE ERROR',identity:{dev:'PRIVATE IDENTITY'},published:true,stageCleaned:false,restored:false,stagePath:repo+'/.claude/.synthetic-stage',capturePath:'/synthetic/private-recovery/captured-file',captureRetained:true}]});const h=harness({respond:async(path,body)=>body.action==='preview'?preview():record});await h.click('preview');h.review();await h.click('apply');const display=h.node('reusable-adoption-status').textContent+' '+h.text(h.node('reusable-adoption-destinations'));assert.match(display,/Adoption failed.*operation did not complete cleanly/s);assert.match(display,/file-version.*"published": true.*"stageCleaned": false.*"restored": false.*\.synthetic-stage.*private-recovery\/captured-file.*"captureRetained": true/s);assert.doesNotMatch(display,/PRIVATE RECEIPT|PRIVATE EVENT|PRIVATE SOURCE|PRIVATE FILE|PRIVATE IDENTITY|Files installed/);
});

test('preview failure and mismatched preview IDs expose generic retry guidance and cannot become actionable',async()=>{
  for(const respond of [async()=>{throw new Error('PRIVATE PATH');},async()=>preview({conversationId:'different-chat'}),async()=>preview({previewHash:''})]){const h=harness({respond});await h.click('preview');assert.equal(h.context.reusableAdoptionPreview,null);assert.match(h.node('reusable-adoption-error').textContent,/Could not preview adoption.*saved draft.*Retry/);assert.doesNotMatch(h.node('reusable-adoption-error').textContent,/PRIVATE PATH/);h.review();await h.click('apply');assert.equal(h.calls.length,1);}
});

test('restore errors retain explicit review for recovery and do not claim changes were reversed',async()=>{
  const h=harness({adoptions:[adoption({status:'partial'})],respond:async()=>{throw new Error('PRIVATE RESTORE ERROR');}});h.review(true);await h.click('restore');assert.equal(h.node('reusable-adoption-restore-reviewed').checked,true);assert.match(h.node('reusable-adoption-status').textContent,/partially completed/);assert.match(h.node('reusable-adoption-error').textContent,/Could not confirm restoration.*Refresh/);assert.doesNotMatch(h.node('reusable-adoption-error').textContent,/PRIVATE RESTORE/);
});

test('polling a different adoption receipt requires fresh restoration review and cannot retarget prior consent',async()=>{
  const h=harness({adoptions:[adoption()]});h.review(true);h.context.state.adoptions.push(adoption({id:'new-adoption-record',status:'partial'}));h.run('renderReusableProgress()');assert.equal(h.node('reusable-adoption-restore-reviewed').checked,false);await h.click('restore');assert.equal(h.calls.length,0);h.review(true);await h.click('restore');assert.equal(h.calls[0].body.adoptionId,'new-adoption-record');
});

test('guidance separates baseline, fresh-session discovery and manual verification from installation',()=>{
  assert.match(html,/Collect before runs with Test this workflow before adoption.*already installed, restore.*baseline/);assert.match(html,/fresh agent session, check discovery.*trigger, non-trigger and verification.*Run checks yourself/);assert.match(html,/alternate homes, download the ZIP.*manually/);assert.match(html,/only files this adoption owns that are still unchanged.*private archive/);assert.match(html,/Concurrent edits may leave a retained recovery file; check its recorded path/);assert.match(html,/I reviewed every generated file and this destination/);
});
