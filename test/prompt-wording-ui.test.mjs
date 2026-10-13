import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const slice=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const patterns=slice('function scopedCandidates(','function reusableFields(');
const reusable=slice('function reusableFields(','function updateReusableProvider(');
const repo='/synthetic/repo-a';
const evidence=(extra={})=>({occurrences:3,distinctSessions:2,agents:['claude'],sessions:['session-a','session-b'],estTokens:120,estSaving:null,examples:[],variants:[{pattern:'Check the fixture before changing it',occurrences:2,distinctSessions:2},{pattern:'Review the fixture before edits',occurrences:1,distinctSessions:1}],...extra});
const candidate=(extra={})=>({id:'similar-a',kind:'similar prompts',matching:'local-tfidf-v1',pattern:'Check the fixture before changing it',repos:[repo],estSaving:null,evidenceByRepo:{[repo]:evidence()},...extra});

function harness(){
  const nodes=new Map(),calls=[];
  const element=(tag='div',className='',textContent='')=>({tag,className,textContent,children:[],dataset:{},value:'',checked:false,disabled:false,hidden:false,open:false,listeners:{},classList:{add(){}},append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},querySelector(){return node('repo-option');},showModal(){this.open=true;},close(){this.open=false;},set innerHTML(value){throw new Error('Wording must remain text');}});
  const node=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
  const context=vm.createContext({$:node,element,array:value=>Array.isArray(value)?value:[],number:String,tokens:value=>String(value||0),date:String,time:()=>'',agentName:String,empty:(title,description)=>element('div','empty',title+' '+description),badge:(text,tone)=>element('span',tone,text),button:(text,className,click)=>{const button=element('button',className,text);button.listeners.click=click;return button;},panel:(title,description,body)=>{const panel=element('section','panel');panel.append(element('h2','',title),element('p','',description),body);return panel;},
    state:{candidates:[candidate()],mistakes:[],conversations:[],agents:[]},activeRepo:repo,selectedAgent:'claude',reusableScope:null,reusableChat:null,reusableBusy:false,reusableAdoptionPreview:null,reusableDrafts:new Map(),
    effectiveRoute:()=>({agent:'claude',model:'synthetic-model'}),agentOptions:()=>[{value:'claude',label:'Claude'}],setOptions(node,options,placeholder,selected){node.value=selected||options[0]?.value||'';},renderReusableList(){},renderImportedAudit(){},renderReusableProgress(){},updateReusableProvider(){},api:(...args)=>calls.push(args),
  });
  vm.runInContext(patterns+reusable,context);
  const descendants=node=>[node,...node.children.flatMap(descendants)];
  const text=node=>[node.textContent,...node.children.map(text)].join(' ');
  const render=()=>context.renderPatterns();
  const cards=()=>descendants(node('pattern-content')).filter(node=>node.tag==='article');
  return{context,node,calls,descendants,text,render,cards};
}

test('similar wording is explicitly a local heuristic with unknown savings and collapsed bounded variants',()=>{
  const h=harness();h.render();const card=h.cards()[0],text=h.text(card),details=h.descendants(card).find(node=>node.tag==='details');
  assert.match(text,/similar prompts.*3 occurrences · 2 sessions.*Local wording heuristic.*do not confirm one workflow.*Savings are unknown/);assert.match(text,/120 estimated tokens of repeated prompt text \(bytes\/4\), not an expected saving/);assert.doesNotMatch(text,/0 estimated token saving|guaranteed|\$.*saving/);assert.notEqual(details.open,true);assert.match(h.text(details),/Wording variants.*Check the fixture.*2 occurrences · 2 sessions.*Review the fixture.*1 occurrences · 1 sessions/);
});

test('similar candidates require 3 occurrences across 2 sessions in one known exact repository',()=>{
  const h=harness();h.context.state.candidates=[candidate({id:'insufficient-count',occurrences:20,distinctSessions:10,evidenceByRepo:{[repo]:evidence({occurrences:2})}}),candidate({id:'insufficient-sessions',evidenceByRepo:{[repo]:evidence({distinctSessions:1})}}),candidate({id:'other-repo',evidenceByRepo:{'/synthetic/repo-b':evidence()}}),candidate({id:'mixed',evidenceByRepo:{[repo]:evidence(),'/synthetic/repo-b':evidence()}}),candidate()];
  const found=h.context.scopedCandidates();assert.equal(found.length,1);assert.equal(found[0].id,'similar-a');assert.equal(found[0].occurrences,3);h.context.activeRepo='';h.context.state.candidates=[candidate({repos:[''],evidenceByRepo:{'':evidence()}})];h.render();assert.equal(h.cards().length,0);assert.match(h.text(h.node('pattern-content')),/No repeat candidates/);
});

test('variants use exact-scope evidence and never render another repository or execute hostile wording',()=>{
  const hostile='<img src=x onerror=alert(1)>';const local=evidence({variants:Array.from({length:7},(_,index)=>({pattern:index===0?hostile:'Local variant '+index+'x'.repeat(1000),occurrences:index+1,distinctSessions:2}))});
  const h=harness();h.context.state.candidates=[candidate({variants:[{pattern:'OTHER REPOSITORY WORDING',occurrences:20,distinctSessions:4}],examples:['OTHER EXCERPT'],evidenceByRepo:{[repo]:local}})];h.render();const card=h.cards()[0],text=h.text(card),details=h.descendants(card).find(node=>node.tag==='details');
  assert.match(text,/<img src=x onerror=alert\(1\)>/);assert.doesNotMatch(text,/OTHER REPOSITORY|OTHER EXCERPT|Local variant 5|Local variant 6/);assert.equal(h.descendants(card).some(node=>node.tag==='img'),false);assert.equal(details.children.filter(node=>node.className==='linked-path').length,5);assert.equal(details.children.filter(node=>node.className==='linked-path').every(node=>node.textContent.length<=400),true);
});

test('top-level variants are a fallback only for the exact sole repository, never mixed legacy metadata',()=>{
  const h=harness();const scoped=evidence();delete scoped.variants;h.context.state.candidates=[candidate({variants:[{pattern:'Fallback local wording',occurrences:3,distinctSessions:2}],evidenceByRepo:{[repo]:scoped}})];h.render();assert.match(h.text(h.cards()[0]),/Fallback local wording/);
  h.context.state.candidates[0].repos=[repo,'/synthetic/other'];h.render();assert.doesNotMatch(h.text(h.cards()[0]),/Fallback local wording/);assert.equal(h.context.scopedCandidates()[0].variants.length,0);
});

for(const kind of ['exact prompts','command','sequence'])test(`${kind} legacy candidates retain their existing proposal, savings, and scoped thresholds`,()=>{
  const h=harness();h.context.state.candidates=[{id:'legacy-a',kind,pattern:'Existing fixture',proposal:'Existing proposal',evidenceByRepo:{[repo]:evidence({estSaving:42,variants:undefined})}}];h.render();const text=h.text(h.cards()[0]);assert.match(text,/Existing proposal.*42 estimated token saving/);assert.doesNotMatch(text,/Local wording heuristic|Savings are unknown|Wording variants/);
});

test('Create bundle opens a scoped editable draft with uncertainty and no request or raw examples',()=>{
  const h=harness();h.context.state.candidates[0].evidenceByRepo[repo].examples=['PRIVATE EXAMPLE NOT AUTOMATICALLY SHARED'];h.render();const create=h.descendants(h.cards()[0]).find(node=>node.tag==='button');create.listeners.click();
  assert.equal(h.calls.length,0);assert.equal(h.node('reusable-dialog').open,true);assert.equal(h.context.reusableScope.repo,repo);assert.equal(h.context.reusableScope.candidateId,'similar-a');assert.match(h.node('reusable-evidence').textContent,/Raw transcript examples.*excluded.*Local wording heuristic.*may describe different tasks.*One workflow and savings are unconfirmed/);assert.doesNotMatch(h.node('reusable-task').value,/PRIVATE EXAMPLE/);
  h.context.activeRepo='/synthetic/other';const payload=h.context.reusablePayload();assert.equal(payload.repo,repo);assert.equal(payload.candidateId,'similar-a');assert.equal('variants'in payload,false);assert.equal('examples'in payload,false);assert.equal('matching'in payload,false);assert.equal(h.calls.length,0);
});

test('a retained chat preserves the original similar-wording uncertainty even when current findings change',()=>{
  const h=harness();h.context.state.candidates=[candidate({kind:'exact prompts'})];const chat={id:'chat-a',repo,status:'complete',agent:'claude',reusableRequest:{candidateId:'similar-a',candidate:{id:'similar-a',kind:'similar prompts',pattern:'Original reviewed wording'},task:'Original task',notes:'Keep these notes',placement:'repo',targetAgent:'claude',invocation:'explicit'}};
  h.context.activeRepo='/synthetic/other';h.context.openReusable(null,chat);assert.equal(h.context.reusableScope.repo,repo);assert.equal(h.node('reusable-notes').value,'Keep these notes');assert.match(h.node('reusable-evidence').textContent,/Original reviewed wording.*Local wording heuristic/);assert.equal(h.calls.length,0);
});

test('closing and reopening a local similar draft preserves user notes and uncertainty without adding request fields',()=>{
  const h=harness();h.context.openReusable(h.context.scopedCandidates()[0]);h.node('reusable-notes').value='User task differences';h.context.closeReusable();h.context.state.candidates=[];h.context.openReusable();assert.equal(h.node('reusable-notes').value,'User task differences');assert.match(h.node('reusable-evidence').textContent,/Local wording heuristic/);assert.equal('candidateKind'in h.context.reusablePayload(),false);assert.equal(h.calls.length,0);
});

test('bounded wording coverage is shown as a generic limit without dumping private method metadata',()=>{
  const h=harness();h.context.state.mining={at:'2026-10-12',files:1,coverage:{supportedRecords:8,wording:{limited:true,method:'local-tfidf-v1',rawBody:'PRIVATE DATA',path:'/private/source'}},warnings:[]};h.render();const text=h.text(h.node('mining-summary'));
  assert.match(text,/Local wording comparison reached its bounded limit.*may be incomplete.*Local wording comparison limits.*Different tasks can look alike and paraphrases can be missed/);assert.doesNotMatch(text,/PRIVATE DATA|private\/source/);const details=h.descendants(h.node('mining-summary')).find(node=>node.tag==='details');assert.notEqual(details.open,true);
  h.context.state.mining.coverage.wording.limited=false;h.render();assert.doesNotMatch(h.text(h.node('mining-summary')),/reached its bounded limit/);
});

test('unknown repeated text size never becomes zero tokens or an asserted saving for a similar group',()=>{
  const h=harness();h.context.state.candidates=[candidate({evidenceByRepo:{[repo]:evidence({estTokens:null,estSaving:null})}})];h.render();const text=h.text(h.cards()[0]);assert.match(text,/Savings are unknown/);assert.doesNotMatch(text,/0 estimated|estimated token saving|\$0/);
});
