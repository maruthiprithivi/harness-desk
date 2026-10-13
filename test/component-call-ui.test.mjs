import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const slice=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const helpers=slice('function usageCounts(','function renderUsageEvidence(');
const components=slice('function sortComponents(','function openLoadingChat(');
const repo='/synthetic/repo';
const match=(extra={})=>({kind:'mcp',name:'fixture-server',tool:'lookup',calls:3,resultsSeen:2,failed:1,sessions:2,firstCall:'2026-10-01T08:10:00.000Z',lastCall:'2026-10-05T14:20:00.000Z',...extra});
const snapshot=(extra={})=>({agent:'claude',repo,at:'2026-10-08T12:00:00.000Z',window:{from:'2026-10-01T00:00:00.000Z',to:'2026-10-08T00:00:00.000Z'},coverage:{partial:false},fileReadCoverage:{supported:true},files:{selected:2,read:2,skipped:0},...extra});
const component=(extra={})=>({id:'component-a',name:'Synthetic configuration',type:'config',path:'/synthetic/settings.json',repo:'',callEvidence:{matches:[match()],attribution:'Server names matched this configuration.'},...extra});

function harness({items=[component()],evidence=snapshot(),agent='claude',scope=repo}={}){
  const nodes=new Map(),calls=[];
  const descendants=node=>[node,...node.children.flatMap(descendants)];
  const element=(tag='div',className='',textContent='')=>({tag,className,textContent:String(textContent),children:[],dataset:{},value:'',disabled:false,hidden:false,open:false,listeners:{},append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},addEventListener(type,fn){this.listeners[type]=fn;},setAttribute(name,value){this[name]=value;},set innerHTML(value){throw new Error('Metadata must render as text');}});
  const node=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
  const context=vm.createContext({$:node,element,array:value=>Array.isArray(value)?value:[],number:value=>String(Number(value)||0),tokens:String,date:value=>value.slice(0,10),time:value=>value.slice(11,19),agentName:String,repoName:String,
    badge:(text,tone)=>element('span',tone,text),empty:(title,description)=>element('div','empty',title+' '+description),button:(text,className,fn)=>{const button=element('button',className,text);button.listeners.click=fn;return button;},
    setOptions(node,options,placeholder,selected){node.value=selected??options[0]?.value??'';},matchingFileReads:()=>[],appendFileReadEvidence(card){card.append(element('p','','Explicit Read requests are separate.'));},
    state:{improvements:[]},loading:{components:{items,usageEvidence:evidence}},activeRepo:scope,selectedAgent:agent,componentPage:0,componentDrafts:new Map(),componentReviewPending:new Map(),componentDisclosures:new Map(),
    api:async(path,body)=>{calls.push({path,body});throw new Error('Unexpected dispatch');},openEditor(){throw new Error('Unexpected editor');},openComponentChat(){throw new Error('Unexpected provider');},openImprovement(){throw new Error('Unexpected improvement');},action(){throw new Error('Unexpected action');},refreshLoading(){throw new Error('Unexpected refresh');},toast(){},
  });
  vm.runInContext(helpers+components,context);
  const text=node=>[node.textContent,...node.children.map(text)].join(' ');
  const card=id=>node('component-list').children.find(node=>node.dataset.componentId===id);
  const detail=id=>descendants(card(id)).find(node=>node.tag==='details'&&node.className==='call-evidence')||descendants(card(id)).find(node=>node.className==='component-evidence-details');
  context.renderComponents();
  return {context,node,calls,descendants,text,card,detail};
}

test('existing collapsed call detail names distinct servers and tools with their own counts, sessions and dates',()=>{
  const matches=[match(),match({name:'other-server',tool:'search',calls:8,resultsSeen:6,failed:0,sessions:1,firstCall:'2026-10-02T09:00:00.000Z',lastCall:'2026-10-07T10:30:00.000Z'})];
  const h=harness({items:[component({callEvidence:{matches}})]}),detail=h.detail('component-a'),list=detail.children.find(node=>node.tag==='ul');
  assert.equal(detail.open,false);assert.equal(list.className,'tool-server-list');assert.equal(list.children.length,2);
  assert.equal(list.children[0].textContent,'MCP: fixture-server / lookup · 3 recorded calls · 2 results seen · 1 explicit error flag · 2 recorded sessions · First recorded call: 2026-10-01 at 08:10:00 · Last recorded call: 2026-10-05 at 14:20:00');
  assert.equal(list.children[1].textContent,'MCP: other-server / search · 8 recorded calls · 6 results seen · 0 explicit error flags · 1 recorded session · First recorded call: 2026-10-02 at 09:00:00 · Last recorded call: 2026-10-07 at 10:30:00');
  assert.match(h.text(detail),/Showing 2 of 2 matching names/);assert.equal(h.calls.length,0);
});

test('unique and duplicate skill attribution stay visible with per-name metadata and cross-card count warning',()=>{
  const skill=match({kind:'skill',name:'synthetic-review',tool:''}),unique='The skill name matches one discovered file.',duplicate='The skill name matches several files; source attribution is unresolved.';
  const h=harness({items:[component({id:'unique',type:'skill',callEvidence:{matches:[skill],attribution:unique,ambiguous:false}}),component({id:'duplicate',type:'skill',callEvidence:{matches:[skill],attribution:duplicate,ambiguous:true}})]});
  assert.match(h.text(h.detail('unique')),/Skill: synthetic-review.*3 recorded calls/);assert.ok(h.text(h.detail('unique')).includes(unique));
  assert.ok(h.text(h.detail('duplicate')).includes(duplicate));assert.match(h.text(h.detail('duplicate')),/Source or version is unresolved.*cannot be assigned to this file alone/);
  const detail=h.detail('duplicate');assert.ok(detail.children.findIndex(node=>node.textContent===duplicate)<detail.children.findIndex(node=>node.tag==='ul'));assert.ok(detail.children.findIndex(node=>node.textContent.startsWith('Source or version is unresolved'))<detail.children.findIndex(node=>node.tag==='ul'));
  for(const id of ['unique','duplicate'])assert.match(h.text(h.detail(id)),/must not be summed across file cards.*do not sum sessions across rows.*do not establish usefulness.*Missing results do not prove failure/);
  assert.match(h.text(h.card('unique')),/Explicit Read requests: unknown for this agent and scope/);assert.equal(h.calls.length,0);
});

test('known zero calls are reported as zero and legacy missing metadata stays unknown',()=>{
  const h=harness({items:[component({callEvidence:{matches:[match({calls:0,resultsSeen:0,failed:0,sessions:0,firstCall:null,lastCall:null}),{kind:'skill',name:'legacy-skill'},{kind:'skill',name:'legacy-call',calls:1}]}})]}),list=h.detail('component-a').children.find(node=>node.tag==='ul');
  assert.match(list.children[0].textContent,/0 recorded calls.*0 results seen.*0 explicit error flags.*0 recorded sessions.*First call date unknown.*Last call date unknown/);
  assert.equal(list.children[1].textContent,'Skill: legacy-skill · Call count unknown · Result/error counts unknown · Session count unknown · First call date unknown · Last call date unknown');
  assert.match(list.children[2].textContent,/Skill: legacy-call · 1 recorded call · Result\/error counts unknown/);assert.equal(h.detail('component-a').children[0].textContent,'Call count unknown · Result/error counts unknown');
  assert.match(h.text(h.detail('component-a')),/No recorded calls does not mean unused/);assert.doesNotMatch(h.text(h.detail('component-a')),/successful|benefit proven|loaded source|live evidence/);
});

test('legacy known call counts remain in the summary while missing result and error counts stay unknown',()=>{
  const h=harness({items:[component({callEvidence:{matches:[{kind:'skill',name:'legacy-call',calls:1}]}})]}),detail=h.detail('component-a');
  assert.equal(detail.children[0].textContent,'1 recorded call · Result/error counts unknown');assert.match(h.text(detail),/Skill: legacy-call · 1 recorded call · Result\/error counts unknown/);assert.doesNotMatch(h.text(detail),/0 results seen|0 explicit error flags/);
});

test('empty match metadata explicitly means no matching calls in this snapshot and preserves separate reads',()=>{
  const h=harness({items:[component({callEvidence:{matches:[],attribution:'No matching metadata.'}})]});
  assert.match(h.text(h.detail('component-a')),/No matching skill or MCP calls in this snapshot\. This does not mean unused/);
  assert.equal(h.detail('component-a').children.some(node=>node.tag==='ul'),false);assert.match(h.text(h.card('component-a')),/Explicit Read requests: unknown for this agent and scope/);assert.equal(h.calls.length,0);
});

test('matching scope snapshot states its date, sampled agent and repository, call window and selected-file coverage',()=>{
  const h=harness(),text=h.text(h.detail('component-a'));
  assert.match(text,/Snapshot 2026-10-08 at 12:00:00\. Sampled agent: claude\. Sampled scope: \/synthetic\/repo\. Call window: 2026-10-01 to 2026-10-08\. Coverage of selected files only/);
  assert.doesNotMatch(text,/live|current activity|complete coverage/);assert.equal(h.calls.length,0);
});

for(const evidence of [undefined,snapshot({agent:'codex'}),snapshot({repo:'/synthetic/other'}),snapshot({repo:''})])test(`foreign or missing scoped snapshot does not lend provenance: ${evidence?evidence.agent+' '+evidence.repo:'missing'}`,()=>{
  const h=harness({evidence:evidence??null}),text=h.text(h.detail('component-a'));
  assert.match(text,/Session details unavailable for this agent and scope/);assert.match(h.text(h.card('component-a')),/Recorded calls: unknown/);assert.doesNotMatch(text,/Snapshot 2026-10-08|Sampled agent:|Call window: 2026-10-01/);
  assert.doesNotMatch(text,/MCP: fixture-server|3 recorded calls/);assert.equal(h.calls.length,0);
});

test('global all-date partial snapshot names global scope and bounds coverage to selected files',()=>{
  const h=harness({scope:'',evidence:snapshot({repo:'',window:{from:null,to:'2026-10-08T12:00:00.000Z'},coverage:{partial:true,issues:['arbitrary-extra-marker']}})}),text=h.text(h.detail('component-a'));
  assert.match(text,/Sampled scope: Global setup only\. All dates in selected files through 2026-10-08\. Partial coverage of selected files only/);assert.doesNotMatch(text,/arbitrary-extra-marker/);
});

test('legacy matching snapshot with missing date, window and coverage keeps those facts unknown',()=>{
  const h=harness({evidence:{agent:'claude',repo}}),text=h.text(h.detail('component-a'));
  assert.match(text,/Snapshot date unknown.*Sampled agent: claude.*Call window unknown\. Coverage unknown/);assert.doesNotMatch(text,/All dates in selected files|Coverage of selected files only/);
});

test('invalid snapshot and per-name dates stay unknown rather than appearing as recorded dates',()=>{
  const h=harness({items:[component({callEvidence:{matches:[match({firstCall:'bad date',lastCall:{unexpected:'extra-marker'}})]}})],evidence:snapshot({at:'bad date',window:{from:'bad date',to:{unexpected:'extra-marker'}}})}),text=h.text(h.detail('component-a'));
  assert.match(text,/Snapshot date unknown.*Call window unknown/);assert.match(text,/First call date unknown.*Last call date unknown/);assert.doesNotMatch(text,/bad date|extra-marker/);
});

test('matched names are bounded to twenty with an explicit shown and total count',()=>{
  const matches=Array.from({length:23},(_,index)=>match({name:'server-'+index}));
  const h=harness({items:[component({callEvidence:{matches}})]}),detail=h.detail('component-a'),list=detail.children.find(node=>node.tag==='ul');
  assert.equal(list.children.length,20);assert.match(h.text(detail),/Showing 20 of 23 matching names/);assert.match(h.text(detail),/server-19/);assert.doesNotMatch(h.text(detail),/server-20/);assert.equal(h.calls.length,0);
});

test('untrusted names stay text and arbitrary prompt, args, output and extra properties never render',()=>{
  const name='<img src=x onerror="synthetic()">',tool='<script>synthetic()</script>',extra={prompt:'prompt-extra-marker',args:'args-extra-marker',output:'output-extra-marker',unexpected:'other-extra-marker'};
  const h=harness({items:[component({callEvidence:{matches:[match({name,tool,...extra})],...extra}})],evidence:snapshot(extra)}),detail=h.detail('component-a'),text=h.text(detail);
  assert.ok(text.includes(name));assert.ok(text.includes(tool));for(const marker of Object.values(extra))assert.equal(text.includes(marker),false);
  assert.equal(h.descendants(detail).some(node=>['img','script'].includes(node.tag)),false);assert.equal(h.calls.length,0);
});
