import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
const code=source.slice(source.indexOf('function friendlyStatus('),source.indexOf('function renderLoading()'));
const repo='/synthetic/project';
const asset=(id,type,path,extra={})=>({id,name:path.split('/').at(-1),type,path,repo:path.startsWith(repo+'/')?repo:'',agent:'codex',status:'unknown',...extra});
function harness(files=[],api=async()=>({agent:'codex',repo,targets:[]})){
  const nodes=new Map(),calls=[],opened=[],notices=[];
  const element=(tag,className='',textContent='')=>({tag,className,textContent,children:[],dataset:{},attrs:{},listeners:{},append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},setAttribute(name,value){this.attrs[name]=value;},addEventListener(type,fn){this.listeners[type]=fn;},focus(){this.focused=true;},showModal(){this.open=true;},close(){this.open=false;},value:'',hidden:false,disabled:false});
  const node=id=>{if(!nodes.has(id))nodes.set(id,element('div'));return nodes.get(id);};
  const context=vm.createContext({$:node,element,button:(label,style,fn)=>({...element('button',style,label),click:fn}),badge:(label,style)=>element('span',style,label),array:x=>Array.isArray(x)?x:[],number:String,tokens:String,portableDirectory:x=>String(x||'').replace(/\\/g,'/').replace(/\/+$/,''),nestedLoadingDirectory:()=>context.loading.launchDirectory!==context.loading.repo,loading:{repo,agent:'codex',launchDirectory:repo,configuration:{files},groups:[],components:{items:[]},notes:[]},activeRepo:repo,selectedAgent:'codex',appendFileReadEvidence(){},openEditor:id=>opened.push(id),agentName:String,renderComponents(){},showFileView(){},componentPage:0,location:{hash:''},refresh:async()=>calls.push({path:'refresh'}),refreshLoading:async()=>calls.push({path:'refreshLoading'}),toast:message=>notices.push(message),api:async(path,body)=>{calls.push({path,body});return api(path,body);}});
  vm.runInContext(code,context);
  const run=expression=>vm.runInContext(expression,context);
  const all=node=>[node,...node.children.flatMap(all)],text=node=>all(node).map(item=>item.textContent).join(' ');
  const find=label=>[...nodes.values()].flatMap(all).find(item=>item.tag==='button'&&item.textContent===label);
  return{node,context,calls,opened,notices,run,all,text,find};
}
test('tree represents global, project and nested folders with read order and nonselected siblings',()=>{
  const h=harness([asset('global','instruction','/synthetic/user/.codex/AGENTS.md',{status:'applies',readOrder:1}),asset('root','instruction',repo+'/AGENTS.md',{status:'shadowed',reason:'Override wins in this directory.'}),asset('override','instruction',repo+'/AGENTS.override.md',{status:'applies',readOrder:2}),asset('nested','instruction',repo+'/src/AGENTS.md',{status:'applies',readOrder:3,role:'launch directory instruction'}),asset('sibling','instruction',repo+'/docs/AGENTS.md',{status:'conditional',reason:'Outside launch chain.'})]);
  h.context.loading.launchDirectory=repo+'/src';h.run('renderConfigurationTree($("tree"))');
  const text=h.text(h.node('tree'));for(const expected of ['Global','This folder and its ancestors','.codex','src','docs','Read 1 · Start','Read 2 · Selected override','Read 3 · Start','Not selected','When needed','Current folder instruction','Override wins','Outside launch chain'])assert.ok(text.includes(expected),expected);
  assert.equal(h.all(h.node('tree')).filter(item=>item.dataset.assetId).length,5);
  assert.match(text,/sibling candidate, not the whole ancestor chain/);
});
test('all discovered asset categories are reachable without three or five file truncation',()=>{
  const types=['instruction','rule','config','delegation','skill','subagent','mcp-server','hook','command','plugin'];
  const h=harness(types.map((type,index)=>asset(String(index),type,repo+'/.codex/items/'+type+'.md')));h.run('renderConfigurationTree($("tree"))');
  assert.equal(h.all(h.node('tree')).filter(item=>item.dataset.assetId).length,types.length);
  assert.doesNotMatch(h.text(h.node('tree')),/Showing 3|Showing 5|See all.*files|Show.*more files/);
  h.find('skill.md').click();assert.deepEqual(h.opened,['4']);
});
test('scope and agent ownership filter out another repository and foreign agent homes',()=>{
  const h=harness([asset('own','skill',repo+'/.codex/skills/a/SKILL.md'),asset('foreign','skill',repo+'/.claude/skills/a/SKILL.md',{agent:'shared'}),asset('other-repo','config','/synthetic/other/.codex/config.toml',{repo:'/synthetic/other'}),asset('other-agent','skill','/synthetic/user/.agents/skills/a/SKILL.md',{agent:'claude'})]);h.run('renderConfigurationTree($("tree"))');assert.deepEqual(h.all(h.node('tree')).filter(item=>item.dataset.assetId).map(item=>item.dataset.assetId),['own']);
});
test('component fallback merges duplicate physical sources and preserves inferred loading status',()=>{
  const h=harness();delete h.context.loading.configuration;const file=asset('tool','mcp-server',repo+'/.mcp.json',{reason:'Transport unknown.'});h.context.loading.groups=[{id:'settings',files:[file]}];h.context.loading.components.items=[{...file,status:undefined,canInspectTools:true},asset('skill','skill',repo+'/.agents/skills/a/SKILL.md',{residentTokens:20,bodyTokens:200})];h.run('renderConfigurationTree($("tree"))');
  assert.equal(h.all(h.node('tree')).filter(item=>item.dataset.assetId==='tool').length,1);assert.match(h.text(h.node('tree')),/Transport unknown/);assert.match(h.text(h.node('tree')),/Description and body are separate/);assert.match(h.text(h.node('tree')),/20 tokens.*200 tokens/);assert.ok(h.find('Review component'));
});
test('tree prefers complete backend sources over partial starting-file groups',()=>{
  const h=harness([asset('complete','hook',repo+'/.claude/hooks.json',{agent:'claude'})]);h.context.selectedAgent='claude';h.context.loading.agent='claude';h.context.loading.groups=[{id:'global',files:[asset('stale','instruction','/synthetic/user/.claude/CLAUDE.md',{agent:'claude'})]}];h.run('renderConfigurationTree($("tree"))');assert.deepEqual(h.all(h.node('tree')).filter(item=>item.dataset.assetId).map(item=>item.dataset.assetId),['complete']);
});
test('Claude combines text and skill priority while MCP/config details remain explicit and unknown',()=>{
  const h=harness([asset('mcp','mcp-server','/synthetic/user/.claude.json',{agent:'claude',role:'user and project-local MCP source'}),asset('skill','skill',repo+'/.claude/skills/a/SKILL.md',{agent:'claude',status:'on-invoke'})]);h.context.selectedAgent='claude';h.context.loading.agent='claude';h.run('renderConfigurationTree($("tree"))');const text=h.text(h.node('tree'));assert.match(text,/CLAUDE.local.md does not replace CLAUDE.md/);assert.match(text,/enterprise precedes personal, then project/);assert.match(text,/user and project-local MCP source/);assert.match(text,/Body on invocation/);assert.match(text,/Managed settings, command-line flags, alternate agent homes, import targets/);assert.match(text,/effective values are unknown/);
});
test('unverified agent does not inherit Claude or Codex selection claims',()=>{
  const h=harness([asset('kiro','skill','/synthetic/user/.kiro/skills/a/SKILL.md',{agent:'kiro'})]);h.context.selectedAgent='kiro';h.context.loading.agent='kiro';h.run('renderConfigurationTree($("tree"))');const text=h.text(h.node('tree'));assert.match(text,/precedence for this agent are unverified/);assert.doesNotMatch(text,/Codex selects|Claude instruction text combines|Body on invocation/);assert.equal(h.find('Add global file'),undefined);
});
test('labels and paths use text nodes rather than executable markup',()=>{
  const hostile='<img src=x onerror=alert(1)>';const h=harness([asset('x','instruction',repo+'/'+hostile,{name:hostile,reason:hostile})]);h.run('renderConfigurationTree($("tree"))');assert.ok(h.text(h.node('tree')).includes(hostile));assert.equal(h.all(h.node('tree')).some(item=>item.tag==='img'),false);assert.doesNotMatch(code,/innerHTML/);
});
test('native folder expansion survives rerender but stays isolated by selected scope',()=>{
  const h=harness([asset('a','skill',repo+'/.codex/skills/a/SKILL.md')]);h.run('renderConfigurationTree($("tree"))');const branch=h.all(h.node('tree')).find(item=>item.tag==='details'&&item.children[0]?.children?.[0]?.textContent==='.codex');branch.open=false;branch.listeners.toggle();h.run('renderConfigurationTree($("tree"))');assert.equal(h.all(h.node('tree')).find(item=>item.tag==='details'&&item.children[0]?.children?.[0]?.textContent==='.codex').open,false);
  h.context.loading.launchDirectory=repo+'/src';h.run('renderConfigurationTree($("tree"))');assert.equal(h.all(h.node('tree')).find(item=>item.tag==='details'&&item.children[0]?.children?.[0]?.textContent==='.codex').open,true);
});
const targets=[{key:'instruction',label:'Instruction file',type:'instruction',path:repo+'/AGENTS.md',creatable:true,named:false},{key:'skill',label:'Skill',type:'skill',path:repo+'/.agents/skills/<name>/SKILL.md',creatable:true,named:true}];
test('creation chooser uses explicit scope and named template and opens the discovered result after refresh',async()=>{
  const h=harness([],async(path,body)=>body.action==='targets'?{agent:body.agent,repo:body.repo,targets}:{created:true,id:'new-skill',path:repo+'/.agents/skills/test-project/SKILL.md'});await h.run('openConfigurationCreate(activeRepo,selectedAgent)');h.find('Choose Skill').click();h.node('configuration-name').value='test-project';await h.context.submitConfigurationCreate({preventDefault(){}});
  assert.deepEqual({...h.calls[1].body},{action:'create',agent:'codex',repo,target:'skill',name:'test-project'});assert.deepEqual(h.calls.slice(2).map(call=>call.path),['refresh','refreshLoading']);assert.deepEqual(h.opened,['new-skill']);assert.equal(h.node('configuration-dialog').open,false);
});
test('existing supported target opens protected editor without creating or overwriting',async()=>{
  const h=harness([],async()=>({agent:'codex',repo,targets:[{...targets[0],exists:true,creatable:false,existingId:'original'}]}));await h.run('openConfigurationCreate(activeRepo,selectedAgent)');h.find('Open existing file').click();assert.deepEqual(h.opened,['original']);assert.equal(h.calls.length,1);
});
test('invalid template name stays local and never requests creation',async()=>{
  const h=harness([],async()=>({agent:'codex',repo,targets}));await h.run('openConfigurationCreate(activeRepo,selectedAgent)');h.find('Choose Skill').click();h.node('configuration-name').value='../outside';await h.context.submitConfigurationCreate({preventDefault(){}});assert.equal(h.calls.length,1);assert.equal(h.node('configuration-error').hidden,false);assert.match(h.node('configuration-error').textContent,/lowercase/);
});
test('global target request is explicit even while a repository is selected',async()=>{
  const h=harness([],async(path,body)=>({agent:body.agent,repo:body.repo,targets:[]}));await h.run('openConfigurationCreate("",selectedAgent)');assert.deepEqual({...h.calls[0].body},{action:'targets',agent:'codex',repo:''});assert.match(h.node('configuration-scope').textContent,/Global setup/);
});
test('late target response cannot replace a newer chooser or changed dashboard scope',async()=>{
  let release;const h=harness([],async()=>new Promise(resolve=>{release=resolve;}));const pending=h.run('openConfigurationCreate(activeRepo,selectedAgent)');h.run('closeConfigurationCreate()');release({agent:'codex',repo,targets});await pending;assert.equal(h.node('configuration-targets').children.length,0);assert.equal(h.node('configuration-dialog').open,false);
  const second=h.run('openConfigurationCreate(activeRepo,selectedAgent)');h.context.activeRepo='/synthetic/other';release({agent:'codex',repo,targets});await second;assert.equal(h.node('configuration-targets').children.length,0);
});
test('one create operation runs while busy and changed scope does not open the new file',async()=>{
  let release;const h=harness([],async(path,body)=>body.action==='targets'?{agent:'codex',repo,targets}:new Promise(resolve=>{release=resolve;}));await h.run('openConfigurationCreate(activeRepo,selectedAgent)');h.find('Choose Instruction file').click();const pending=h.context.submitConfigurationCreate({preventDefault(){}});await h.context.submitConfigurationCreate({preventDefault(){}});h.run('closeConfigurationCreate()');assert.equal(h.node('configuration-dialog').open,true);h.context.activeRepo='/synthetic/other';release({created:true,id:'new-instruction'});await pending;assert.equal(h.calls.filter(call=>call.body?.action==='create').length,1);assert.deepEqual(h.opened,[]);assert.match(h.notices[0],/original scope/);
});
test('confirmed creation without editable discovery never writes again and explains the gap',async()=>{
  const h=harness([],async(path,body)=>body.action==='targets'?{agent:'codex',repo,targets}:{created:true,id:null,warning:'Synthetic discovery limit.'});await h.run('openConfigurationCreate(activeRepo,selectedAgent)');h.find('Choose Instruction file').click();await h.context.submitConfigurationCreate({preventDefault(){}});assert.equal(h.calls.filter(call=>call.body?.action==='create').length,1);assert.deepEqual(h.opened,[]);assert.deepEqual(h.notices,['Synthetic discovery limit.']);
});
test('name syntax rejects leading numbers, repeated or trailing hyphens before creation',async()=>{
  for(const name of ['1-check','check--project','check-']){
    const h=harness([],async()=>({agent:'codex',repo,targets}));await h.run('openConfigurationCreate(activeRepo,selectedAgent)');h.find('Choose Skill').click();h.node('configuration-name').value=name;await h.context.submitConfigurationCreate({preventDefault(){}});assert.equal(h.calls.length,1,name);assert.equal(h.node('configuration-error').hidden,false);
  }
});
test('a created file remains successful when refreshing fails and the UI does not retry the write',async()=>{
  const h=harness([],async(path,body)=>body.action==='targets'?{agent:'codex',repo,targets}:{created:true,id:'created'});h.context.refresh=async()=>{throw new Error('Synthetic refresh outage');};await h.run('openConfigurationCreate(activeRepo,selectedAgent)');h.find('Choose Instruction file').click();await h.context.submitConfigurationCreate({preventDefault(){}});assert.equal(h.calls.filter(call=>call.body?.action==='create').length,1);assert.deepEqual(h.opened,[]);assert.match(h.notices[0],/File created.*could not refresh/);
});
test('failed creation keeps the chosen template and name for review with no automatic retry',async()=>{
  const h=harness([],async(path,body)=>{if(body.action==='targets')return{agent:'codex',repo,targets};throw new Error('Synthetic destination already exists');});await h.run('openConfigurationCreate(activeRepo,selectedAgent)');h.find('Choose Skill').click();h.node('configuration-name').value='keep-name';await h.context.submitConfigurationCreate({preventDefault(){}});assert.equal(h.calls.filter(call=>call.body?.action==='create').length,1);assert.equal(h.node('configuration-name').value,'keep-name');assert.equal(h.node('configuration-error').hidden,false);assert.match(h.node('configuration-error').textContent,/already exists/);assert.equal(h.node('configuration-create').disabled,false);
});
test('successful starter warnings remain visible even when a discovered editor ID is available',async()=>{
  const h=harness([],async(path,body)=>body.action==='targets'?{agent:'codex',repo,targets}:{created:true,id:'created',warning:'Synthetic cleanup warning.'});await h.run('openConfigurationCreate(activeRepo,selectedAgent)');h.find('Choose Instruction file').click();await h.context.submitConfigurationCreate({preventDefault(){}});assert.deepEqual(h.opened,['created']);assert.deepEqual(h.notices,['Synthetic cleanup warning.']);
});
test('tied same-directory instruction candidates show read layer, not invented file order',()=>{
  const h=harness([asset('a','instruction',repo+'/CLAUDE.md',{agent:'claude',status:'applies',readOrder:2,readOrderTied:true}),asset('b','instruction',repo+'/.claude/CLAUDE.md',{agent:'claude',status:'applies',readOrder:2,readOrderTied:true})]);h.context.loading.agent='claude';h.context.selectedAgent='claude';h.run('renderConfigurationTree($("tree"))');assert.equal(h.all(h.node('tree')).filter(item=>item.textContent==='Read layer 2 · Start').length,2);assert.match(h.text(h.node('tree')),/within-layer order is unresolved/);
});
test('tree retains highlighted editor and accessible create dialog without new permanent selectors',()=>{
  assert.match(html,/Your session, explained/);assert.match(html,/id="configuration-dialog" aria-labelledby="configuration-title"/);assert.match(html,/id="configuration-status"[^>]*role="status"[^>]*aria-live="polite"/);assert.doesNotMatch(html,/<select[^>]*id="configuration-/);assert.match(source,/openEditor\(file.id(?:,key)?\)/);assert.match(source,/createEditor/);assert.match(css,/\.configuration-branch>summary\{[^}]*font-size:16px/);assert.match(css,/\.configuration-order-list\{[^}]*font-size:14px/);
});
