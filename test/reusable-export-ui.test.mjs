import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const functions=source.slice(source.indexOf('function reusableFields()'),source.indexOf('function renderImportedAudit()'));
const handlers=source.slice(source.indexOf("$('reusable-open').addEventListener"),source.indexOf("$('improvement-dialog').addEventListener('cancel'"));
const zipBytes=Uint8Array.from([80,75,5,6,...Array(18).fill(0)]);
const archive={filename:'reviewed-workflow.zip',contentType:'application/zip',encoding:'base64',data:Buffer.from(zipBytes).toString('base64'),files:['skills/reviewed/SKILL.md']};
const repo='/synthetic/repo-a';
const chat=(extra={})=>({id:'original-chat',repo,status:'complete',agent:'codex',reusableRequest:{task:'Synthetic task',notes:'Original instructions',placement:'repo',targetAgent:'claude',invocation:'explicit'},reusable:{status:'ready',bundle:{name:'reviewed-workflow',description:'Review draft',files:[{path:'skills/reviewed/SKILL.md',content:'<script>synthetic text</script>'}],estimates:{},trigger:'Task',nonTrigger:'Other task',verification:['Review']}},...extra});

function harness({api=async()=>archive,clickThrows=false}={}){
  const nodes=new Map(),calls=[],blobs=[],links=[],created=[],revoked=[],timers=[];
  const node=id=>{
    if(!nodes.has(id))nodes.set(id,{value:'',checked:false,disabled:false,hidden:true,open:false,dataset:{},children:[],listeners:{},textContent:'',
      append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},addEventListener(type,fn){this.listeners[type]=fn;},querySelector(){return node(id+'-option');},showModal(){this.open=true;},close(){this.open=false;},
      click(){links.push({href:this.href,download:this.download});if(clickThrows)throw new Error('SENSITIVE CLICK ERROR');},
      set innerHTML(value){throw new Error('Workflow text must remain inert');},
    });return nodes.get(id);
  };
  class FakeBlob{constructor(parts,options){this.parts=parts;this.type=options.type;blobs.push(this);}}
  const context=vm.createContext({$:node,array:value=>Array.isArray(value)?value:[],tokens:String,agentName:String,agentOptions:()=>[{value:'codex'}],effectiveRoute:()=>({agent:'codex'}),setOptions(node,options,empty,value){node.value=value||options[0]?.value||'';},
    element:(tag,className='',text='')=>Object.assign(node('element-'+nodes.size),{tag,className,textContent:String(text)}),button:(text,className,fn)=>{const item=Object.assign(node('button-'+nodes.size),{textContent:text,className});item.listeners.click=fn;return item;},empty:(title,description)=>Object.assign(node('empty-'+nodes.size),{textContent:title+' '+description}),
    activeRepo:repo,selectedAgent:'codex',reusableScope:null,reusableChat:null,reusableBusy:false,reusableAdoptionPreview:null,reusableDrafts:new Map(),state:{agents:[],conversations:[]},
    api:async(path,body)=>{calls.push({path,body});return api(path,body,calls.length);},schedulePoll(){},refresh:async()=>{},openChat(){context.openedChat=true;},
    atob,Uint8Array,Blob:FakeBlob,URL:{createObjectURL(blob){const url='blob:synthetic-'+created.length;created.push({url,blob});return url;},revokeObjectURL(url){revoked.push(url);}},setTimeout:fn=>{timers.push(fn);},
  });
  vm.runInContext(functions+handlers,context);
  context.openReusable(null,chat());
  const run=expression=>vm.runInContext(expression,context);
  const text=node=>[node.textContent,...node.children.map(text)].join(' ');
  return{context,node,calls,blobs,links,created,revoked,timers,run,text};
}

test('explicit ZIP download decodes actual ZIP bytes, uses MIME and revokes its object URL',async()=>{
  const h=harness();assert.equal(h.calls.length,0);await h.node('reusable-download').listeners.click();
  assert.equal(h.calls[0].path,'/api/reusable');assert.deepEqual({...h.calls[0].body},{action:'export',id:'original-chat'});
  assert.equal(h.blobs[0].type,'application/zip');assert.deepEqual([...h.blobs[0].parts[0]],[...zipBytes]);assert.deepEqual(h.links,[{href:'blob:synthetic-0',download:'reviewed-workflow.zip'}]);
  assert.equal(h.revoked.length,0);h.timers.forEach(fn=>fn());assert.deepEqual(h.revoked,['blob:synthetic-0']);
  assert.match(html,/id="reusable-download" class="button primary compact"[^>]*>Download workflow ZIP/);assert.doesNotMatch(source,/reusable-bundle\.json/);
});

test('export stays tied to the original reviewed chat across dashboard and polling changes',async()=>{
  let release;const h=harness({api:()=>new Promise(resolve=>{release=resolve;})});const pending=h.run('reusableAction("export")');
  h.context.activeRepo='/synthetic/repo-b';h.context.selectedAgent='claude';h.context.state.conversations=[chat({id:'other-chat',repo:'/synthetic/repo-b'})];h.run('renderReusableProgress()');release(archive);await pending;
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].body.id,'original-chat');assert.deepEqual(Object.keys(h.calls[0].body).sort(),['action','id']);assert.equal(h.context.reusableScope.repo,repo);
  assert.match(h.text(h.node('reusable-result')),/original working scope: \/synthetic\/repo-a/);assert.doesNotMatch(h.text(h.node('reusable-result')),/repo-b/);
});

test('pending export blocks duplicate clicks, closing, new drafts and opening a conversation',async()=>{
  let release;const h=harness({api:()=>new Promise(resolve=>{release=resolve;})});const pending=h.node('reusable-download').listeners.click();
  for(const id of ['reusable-download','reusable-close','reusable-new','reusable-conversation','reusable-test'])assert.equal(h.node(id).disabled,true);
  h.node('reusable-dialog').listeners.cancel({preventDefault(){}});h.node('reusable-new').listeners.click();h.node('reusable-conversation').listeners.click();h.context.activeRepo='/synthetic/repo-b';h.run('openReusable()');await h.node('reusable-download').listeners.click();
  h.node('reusable-test').listeners.click();assert.equal(h.node('improvement-dialog').open,false);
  assert.equal(h.calls.length,1);assert.equal(h.node('reusable-dialog').open,true);assert.equal(h.context.reusableScope.repo,repo);assert.equal(h.context.openedChat,undefined);
  release(archive);await pending;assert.equal(h.context.reusableBusy,false);assert.equal(h.node('reusable-close').disabled,false);
});

test('failure leaves the reviewed bundle, notes and expanded file view intact with a generic error',async()=>{
  const h=harness({api:async()=>{throw new Error('SENSITIVE ARCHIVE BODY');}});
  const root=h.node('reusable-result'),file=root.children.find(item=>item.tag==='details'&&item.children[0].textContent==='skills/reviewed/SKILL.md');file.open=true;
  await h.run('reusableAction("export")');assert.equal(h.node('reusable-dialog').open,true);assert.equal(h.context.reusableChat.id,'original-chat');assert.equal(h.node('reusable-notes').value,'Original instructions');assert.equal(file.open,true);assert.equal(root.children.includes(file),true);
  assert.match(h.node('reusable-error').textContent,/Could not download.*draft is still here/);assert.doesNotMatch(h.node('reusable-error').textContent,/SENSITIVE/);assert.equal(h.blobs.length,0);
});

test('ready and saved are exportable, while invalid, awaiting and save-failed never export',async()=>{
  for(const status of ['ready','saved','invalid','awaiting-response','save-failed']){
    const h=harness();h.context.reusableChat=chat({reusable:{...h.context.reusableChat.reusable,status}});h.context.state.conversations=[];h.run('renderReusableProgress()');
    const allowed=['ready','saved'].includes(status);assert.equal(h.node('reusable-download').hidden,!allowed);assert.equal(h.node('reusable-test').hidden,!allowed);await h.run('reusableAction("export")');assert.equal(h.calls.length,allowed?1:0);
  }
});

test('opening, polling and saving never export automatically',async()=>{
  const h=harness({api:async(path,body)=>({...chat(),reusable:{...chat().reusable,status:'saved',path:'/synthetic/private-draft'}})});
  h.run('renderReusableProgress(); renderReusableList()');assert.equal(h.calls.length,0);await h.run('reusableAction("save")');
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].body.action,'save');assert.equal(h.blobs.length,0);assert.equal(h.links.length,0);
});

test('archive metadata rejects hostile filenames, wrong MIME, wrong encoding and malformed or excessive bodies',async()=>{
  for(const changes of [{filename:'../../outside.zip'},{filename:'<script>.zip'},{filename:'bad\nname.zip'},{contentType:'text/html'},{encoding:'raw'},{data:'%%%bad'},{data:''},{data:'A'.repeat(140004)}]){
    const h=harness({api:async()=>({...archive,...changes})});await h.run('reusableAction("export")');assert.equal(h.blobs.length,0);assert.equal(h.links.length,0);assert.equal(h.node('reusable-error').hidden,false);assert.match(h.node('reusable-error').textContent,/draft is still here/);assert.equal(h.context.reusableChat.reusable.status,'ready');
  }
});

test('a failed anchor click still schedules object URL cleanup and retains the draft',async()=>{
  const h=harness({clickThrows:true});await h.run('reusableAction("export")');assert.equal(h.created.length,1);h.timers.forEach(fn=>fn());assert.deepEqual(h.revoked,['blob:synthetic-0']);assert.match(h.node('reusable-error').textContent,/Could not download/);assert.equal(h.context.reusableChat.id,'original-chat');
});

test('adoption guidance follows original target and placement with review and collision safeguards',()=>{
  for(const targetAgent of ['claude','codex'])for(const placement of ['repo','global']){
    const h=harness();h.context.openReusable(null,chat({reusableRequest:{...chat().reusableRequest,targetAgent,placement}}));h.context.activeRepo='/synthetic/repo-b';h.run('renderReusableProgress()');
    const display=h.text(h.node('reusable-result')),root=targetAgent==='claude'?'.claude':'.agents';
    assert.match(display,/original working scope: \/synthetic\/repo-a/);assert.ok(display.includes(placement==='global'?'~/'+root+'/':'use '+root+'/ under the captured working repository'));
    assert.match(display,/Extract the ZIP into a new review folder first/);assert.match(display,/Review the instructions and code/);assert.match(display,/preserving skills\/, workflows\/, and scripts\/ as sibling directories/);assert.match(display,/do not overwrite.*fresh name/);assert.match(display,/guided adoption requires a saved bundle and explicit review/);
    assert.doesNotMatch(display,/repo-b/);assert.match(display,/<script>synthetic text<\/script>/);
  }
});
