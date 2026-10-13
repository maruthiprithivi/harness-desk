import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const slice=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const workspace=slice('function friendlyStatus(','function renderLoading()');
const editor=slice('function editorValue(','const contextBreakdownIds =');
const refreshLoading=slice('async function refreshLoading(','function friendlyStatus(');
const repo='/synthetic/project';
const asset=(id,type,path,extra={})=>({id,name:path.split('/').at(-1),type,path,repo:path.startsWith(repo+'/')?repo:'',agent:'codex',status:'unknown',...extra});
const startingFiles=()=>[
  asset('global','instruction','/synthetic/user/.codex/AGENTS.md',{status:'applies',readOrder:1}),
  asset('skipped','instruction',repo+'/AGENTS.md',{status:'shadowed'}),
  asset('override','instruction',repo+'/AGENTS.override.md',{status:'applies',readOrder:2}),
  asset('nested','instruction',repo+'/src/AGENTS.md',{status:'applies',readOrder:3}),
  asset('conditional','instruction',repo+'/docs/AGENTS.md',{status:'conditional'}),
  asset('settings','config',repo+'/.codex/config.toml'),
  asset('skill','skill',repo+'/.agents/skills/check/SKILL.md',{status:'on-invoke',residentTokens:12,bodyTokens:80}),
  asset('mcp','mcp-server',repo+'/.mcp.json'),
];

function harness(files=startingFiles(),withEditor=false){
  const nodes=new Map(),opened=[],notices=[],calls=[],releases=[],widgets=[],observers=[];
  const preferences = new Map();
  const all=node=>[node,...node.children.flatMap(all)];
  const matches=(node,selector)=>selector.split(',').some(part=>{
    part=part.trim();
    const combined=part.match(/^(\w+)(\[.+\])$/);if(combined)return node.tag===combined[1]&&matches(node,combined[2]);
    if(part.startsWith('#'))return node.id===part.slice(1);
    if(part.startsWith('.'))return part.slice(1).split('.').every(name=>node.className.split(/\s+/).includes(name));
    const attribute=part.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
    if(attribute){const name=attribute[1],value=name.startsWith('data-')?node.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]:node.attrs[name];return value!==undefined&&(attribute[2]===undefined||value===attribute[2]);}
    return node.tag===part;
  });
  const element=(tag='div',className='',textContent='')=>{
    const node={tag,tagName:tag.toUpperCase(),className,textContent:String(textContent),children:[],dataset:{},attrs:{},listeners:{},style:{setProperty(name,value){this[name]=value;}},value:'',hidden:false,disabled:false,open:false,isConnected:true,
      append(...children){for(const child of children){child.parentElement?.children.splice(child.parentElement.children.indexOf(child),1);child.parentElement=this;this.children.push(child);}},
      remove(){if(this.parentElement){this.parentElement.children.splice(this.parentElement.children.indexOf(this),1);this.parentElement=null;}},get firstElementChild(){return this.children[0]||null;},
      replaceChildren(...children){for(const child of this.children)child.parentElement=null;this.children=[];this.append(...children);},
      setAttribute(name,value){this.attrs[name]=String(value);if(name==='id')this.id=String(value);},getAttribute(name){return this.attrs[name];},
      addEventListener(type,fn){this.listeners[type]=fn;},querySelectorAll(selector){return all(this).slice(1).filter(child=>matches(child,selector));},querySelector(selector){return this.querySelectorAll(selector)[0]||null;},
      closest(selector){return matches(this,selector)?this:this.parentElement?.closest(selector)||null;},contains(other){return all(this).includes(other);},
      focus(options){this.focused=true;this.focusOptions=options;},scrollIntoView(){this.scrolled=true;},show(){this.open=true;this.modal=false;},showModal(){this.open=true;this.modal=true;},close(){this.open=false;},setPointerCapture(){},
      getBoundingClientRect(){return{left:0,top:0,width:900,height:600};},clientWidth:900,clientHeight:600,
    };
    node.classList={add(...names){node.className=[...new Set([...node.className.split(/\s+/),...names])].filter(Boolean).join(' ');},remove(...names){node.className=node.className.split(/\s+/).filter(name=>!names.includes(name)).join(' ');},toggle(name,force){const add=force??!node.className.split(/\s+/).includes(name);this[add?'add':'remove'](name);return add;},contains(name){return node.className.split(/\s+/).includes(name);}};
    return node;
  };
  const node=id=>{const found=[...nodes.values()].flatMap(all).find(child=>child.id===id);if(found)return found;if(!nodes.has(id)){const value=element();value.id=id;nodes.set(id,value);}return nodes.get(id);};
  const body=element('body');
  body.append(node('file-dialog'));
  node('file-dialog').append(node('configuration-selected-source'));
  const context=vm.createContext({$:node,element,array:value=>Array.isArray(value)?value:[],number:String,tokens:String,agentName:String,repoName:String,
    preference:(key,fallback)=>preferences.get(key)||fallback,savePreference:(key,value)=>preferences.set(key,value),
    button:(label,className,fn)=>{const control=element('button',className,label);control.click=fn;control.listeners.click=fn;return control;},badge:(label,className)=>element('span',className,label),empty:(title,description)=>element('div','empty',title+' '+description),
    portableDirectory:value=>String(value||'').replace(/\\/g,'/').replace(/\/+$/,''),nestedLoadingDirectory:()=>context.loading?.launchDirectory!==context.loading?.repo,loadingDirectoryLabel:(directory,root)=>directory===root?'Repository root':directory?.slice(root.length+1)||'Global setup',
    loading:{repo,agent:'codex',launchDirectory:repo+'/src',configuration:{files},groups:[],components:{items:[]},notes:[]},activeRepo:repo,selectedAgent:'codex',view:'inventory',advanced:false,
    document:{body,createElementNS:(namespace,tag)=>({...element(tag),namespaceURI:namespace}),querySelector(selector){return [...nodes.values(),body].flatMap(all).find(child=>matches(child,selector))||null;},querySelectorAll(selector){return [...nodes.values(),body].flatMap(all).filter(child=>matches(child,selector));}},
    window:{HarnessEditor:{createEditor(options){let content=options.value;const widget={options,getValue:()=>content,setValue(value){content=value;options.onChange();},setReadOnly(value){this.readOnly=value;},focus(){},destroy(){this.destroyed=true;},input(value){if(options.readOnly||this.readOnly)return false;content=value;options.onChange();return true;}};widgets.push(widget);return widget;}}},
    openFile:null,codeEditor:null,reviewedContent:null,fileBusy:false,fileWasEdited:false,fileDraftSource:null,fileRequest:0,discardResolution:null,
    requestAnimationFrame:fn=>fn(),ResizeObserver:class{constructor(callback){this.callback=callback;observers.push(this);}observe(target){this.target=target;}disconnect(){this.disconnected=true;}},appendFileReadEvidence(){},renderComponents(){},showFileView(){},componentPage:0,location:{hash:'#inventory'},
    state:{csrfToken:'synthetic',inventory:{scannedAt:'synthetic-scan'}},loadingDirectories:new Map(),loadingKey:'',loadingSequence:0,loadingError:'',loadingDirectoryNotice:'',renderContextBreakdowns(){},updateStartGuide(){},
    refresh:async()=>{},refreshLoading:async()=>{},toast:message=>notices.push(message),
    api:(path,body)=>{calls.push({path,body:JSON.parse(JSON.stringify(body))});return new Promise((resolve,reject)=>releases.push({resolve,reject}));},
    openEditor:id=>opened.push(id),
  });
  vm.runInContext(workspace+(withEditor?'\n'+editor:''),context);
  const run=expression=>vm.runInContext(expression,context);
  const text=node=>all(node).map(child=>child.textContent).join(' ');
  const render=()=>run('renderLoadingBands("beginner-file-bands",false)');
  const find=label=>all(node('beginner-file-bands')).find(child=>child.tag==='button'&&child.textContent===label);
  return{context,node,body,all,text,opened,notices,calls,releases,widgets,observers,preferences,run,render,find};
}

test('workspace selectors move with their state and listeners intact and return to the header',()=>{
  const h=harness(),controls=h.node('workspace-scope-controls'),home=h.node('topbar-scope-home'),toolbar=h.node('files-workspace-toolbar'),select=h.node('repo-select');
  let changes=0;select.value=repo;select.addEventListener('change',()=>changes++);controls.append(select);home.append(controls);
  h.context.positionWorkspaceScopeControls();assert.equal(controls.parentElement,toolbar);assert.equal(select.value,repo);select.listeners.change();assert.equal(changes,1);
  h.context.view='dashboard';h.context.positionWorkspaceScopeControls();assert.equal(controls.parentElement,h.node('first-use-scope-toolbar'));assert.equal(select.value,repo);
  h.context.view='inventory';h.context.advanced=true;h.context.positionWorkspaceScopeControls();assert.equal(controls.parentElement,home);assert.equal(h.calls.length,0);
});

test('canvas edit is a separate action from selection and stale edit buttons cannot open a new scope',()=>{
  const h=harness();h.render();const row=h.node('configuration-workspace').querySelectorAll('.configuration-node-file-row').find(row=>row.querySelector('[data-edit-asset-id="override"]'));
  const select=row.querySelector('.configuration-node-file'),edit=row.querySelector('.configuration-node-edit');assert.equal(select.querySelector('button'),null);assert.equal(edit.attrs['aria-label'],'Edit AGENTS.override.md');
  select.click();assert.deepEqual(h.opened,[]);edit.click();assert.deepEqual(h.opened,['override']);
  h.context.activeRepo='/synthetic/other';h.context.loading.repo=h.context.activeRepo;edit.click();assert.deepEqual(h.opened,['override']);
});

test('pointer and keyboard resizing clamp, persist and preserve the open reviewed editor',async()=>{
  const h=harness(startingFiles(),true);h.render();await openFixture(h);h.widgets[0].input('# Keep this draft\n');h.context.reviewFile();
  const widget=h.context.codeEditor,workspace=h.node('configuration-workspace'),separator=h.node('configuration-editor-resizer');workspace.clientWidth=1600;h.context.resizeConfigurationEditor(480);
  assert.equal(separator.attrs.role,'separator');assert.equal(separator.attrs['aria-orientation'],'vertical');
  separator.listeners.pointerdown({button:0,pointerId:1,clientX:900,preventDefault(){}});assert.equal(separator.focused,true);assert.equal(separator.focusOptions.preventScroll,true);separator.listeners.pointermove({pointerId:1,clientX:740});separator.listeners.pointerup();assert.equal(separator.attrs['aria-valuenow'],'640');assert.equal(h.preferences.get('harness-desk-editor-width'),'640');
  const key=key=>separator.listeners.keydown({key,preventDefault(){}});key('ArrowLeft');assert.equal(separator.attrs['aria-valuenow'],'672');key('Home');assert.equal(separator.attrs['aria-valuenow'],'320');key('End');assert.equal(separator.attrs['aria-valuenow'],'1000');
  workspace.clientWidth=900;h.observers[0].callback();assert.equal(separator.attrs['aria-valuenow'],'368');assert.equal(h.preferences.get('harness-desk-editor-width'),'1000');
  workspace.clientWidth=1600;h.observers[0].callback();assert.equal(separator.attrs['aria-valuenow'],'1000');assert.equal(h.context.codeEditor,widget);assert.equal(widget.destroyed,undefined);assert.equal(h.context.editorValue(),'# Keep this draft\n');assert.equal(h.context.reviewedContent,'# Keep this draft\n');assert.equal(h.calls.length,1);
});

test('solid instruction edges represent predicted read sequence, not ownership or component discovery',()=>{
  const h=harness();const model=h.run('configurationCanvasModel()');
  const layers=model.nodes.filter(node=>node.kind==='read-layer');
  assert.deepEqual(Array.from(layers,node=>node.readOrder),[1,2,3]);
  assert.deepEqual(Array.from(layers,node=>Array.from(node.files,file=>file.id)),[['global'],['override'],['nested']]);
  const reads=model.edges.filter(edge=>edge.relationship==='read-order');
  assert.deepEqual(Array.from(reads,edge=>[edge.from,edge.to]),[[layers[0].id,layers[1].id],[layers[1].id,layers[2].id]]);
  const available=model.nodes.filter(node=>node.kind==='available');
  assert.deepEqual(new Set(available.flatMap(node=>Array.from(node.files,file=>file.id))),new Set(['skipped','conditional','settings','skill','mcp']));
  for(const edge of model.edges.filter(edge=>edge.relationship==='availability'))assert.ok(['scope','available','family'].includes(model.nodes.find(node=>node.id===edge.from).kind));
  assert.ok(model.edges.some(edge=>edge.relationship==='availability'));
  assert.ok(model.edges.some(edge=>edge.relationship==='availability'&&edge.from==='scope:folder'&&edge.to===layers[2].id));
});

test('equal read-layer candidates combine without inventing within-layer order',()=>{
  const h=harness([asset('global','instruction','/synthetic/user/.claude/CLAUDE.md',{agent:'claude',status:'applies',readOrder:1}),asset('a','instruction',repo+'/CLAUDE.md',{agent:'claude',status:'applies',readOrder:2,readOrderTied:true}),asset('b','instruction',repo+'/.claude/CLAUDE.md',{agent:'claude',status:'applies',readOrder:2,readOrderTied:true})]);
  h.context.loading.agent='claude';h.context.selectedAgent='claude';const model=h.run('configurationCanvasModel()');
  const tied=model.nodes.find(node=>node.kind==='read-layer'&&node.readOrder===2);assert.deepEqual(new Set(Array.from(tied.files,file=>file.id)),new Set(['a','b']));
  assert.equal(model.edges.filter(edge=>edge.relationship==='read-order').length,1);assert.ok(model.edges.every(edge=>edge.from!==edge.to));
  h.render();const layer=h.node('configuration-workspace').querySelectorAll('.configuration-canvas-node').find(node=>node.dataset.nodeId===tied.id),labels=layer.querySelectorAll('.configuration-node-file').map(control=>control.querySelector('.configuration-node-name').textContent);
  assert.deepEqual(new Set(labels),new Set(['CLAUDE.md','.claude/CLAUDE.md']));assert.equal(layer.querySelectorAll('button[data-asset-id]').length,2);
});

test('scope headings do not overlap when instructions begin in the repository or only global setup exists',()=>{
  for(const globalOnly of [false,true]){
    const h=harness(globalOnly?[asset('global','instruction','/synthetic/user/.codex/AGENTS.md',{status:'applies',readOrder:1})]:[asset('repo','instruction',repo+'/AGENTS.md',{status:'applies',readOrder:1}),asset('nested','instruction',repo+'/src/AGENTS.md',{status:'applies',readOrder:2})]);
    if(globalOnly){h.context.loading.repo='';h.context.loading.launchDirectory='';h.context.activeRepo='';}
    const headings=Array.from(h.run('configurationCanvasModel()').nodes).filter(node=>node.kind==='scope');
    for(let index=0;index<headings.length;index++)for(const other of headings.slice(index+1))assert.ok(Math.abs(headings[index].x-other.x)>=260||Math.abs(headings[index].y-other.y)>=95,headings[index].id+' overlaps '+other.id);
  }
});

test('foreign repository and agent sources never enter the selected workspace model',()=>{
  const own=asset('own','skill',repo+'/.agents/skills/own/SKILL.md');
  const h=harness([own,asset('foreign-home','skill','/synthetic/user/.claude/skills/other/SKILL.md',{agent:'shared'}),asset('foreign-agent','config',repo+'/.codex/config.toml',{agent:'claude'}),asset('foreign-repo','instruction','/synthetic/other/AGENTS.md',{repo:'/synthetic/other',status:'applies',readOrder:2})]);
  const model=h.run('configurationCanvasModel()');assert.deepEqual([...new Set(Array.from(model.nodes).flatMap(node=>Array.from(node.files||[],file=>file.id)))],['own']);
});

test('launch comparison keeps the complete repository instruction chain and predicts a clean new folder from globals only',()=>{
  const h=harness();const model=h.run('launchScenarioModel()');
  assert.equal(model.agent,'codex');assert.equal(model.repo,repo);assert.equal(model.launchDirectory,repo+'/src');assert.equal(model.isCodex,true);
  assert.deepEqual(Array.from(model.inside.instructions,file=>file.id),['global','override','nested']);
  assert.deepEqual(Array.from(model.inside.shadowed,file=>file.id),['skipped']);
  assert.deepEqual(Array.from(model.inside.conditional,file=>file.id),['conditional']);
  assert.deepEqual(Array.from(model.empty.instructions,file=>file.id),['global']);
  for(const list of Object.values(model.empty))assert.ok(Array.from(list).every(file=>!file.repo),'Clean new folder inherited a repository source');
});

test('settings, skills and MCP sources stay separate from startup instructions in both launch scenarios',()=>{
  const h=harness([...startingFiles(),asset('global-settings','config','/synthetic/user/.codex/config.toml'),asset('global-skill','skill','/synthetic/user/.agents/skills/check/SKILL.md',{status:'on-invoke'}),asset('global-mcp','mcp-server','/synthetic/user/.codex/mcp.json')]);
  const model=h.run('launchScenarioModel()');
  assert.deepEqual(new Set(Array.from(model.inside.settings,file=>file.id)),new Set(['settings','global-settings']));
  assert.deepEqual(new Set(Array.from(model.inside.skills,file=>file.id)),new Set(['skill','global-skill']));
  assert.deepEqual(new Set(Array.from(model.inside.mcps,file=>file.id)),new Set(['mcp','global-mcp']));
  assert.deepEqual(Array.from(model.empty.settings,file=>file.id),['global-settings']);
  assert.deepEqual(Array.from(model.empty.skills,file=>file.id),['global-skill']);
  assert.deepEqual(Array.from(model.empty.mcps,file=>file.id),['global-mcp']);
  assert.ok(Array.from(model.inside.instructions).every(file=>file.type==='instruction'));
});

test('Codex settings visual follows only applicable ancestor configs and keeps project trust separate from instruction order',()=>{
  const h=harness([...startingFiles(),asset('global-settings','config','/synthetic/user/.codex/config.toml'),asset('nested-settings','config',repo+'/src/.codex/config.toml'),asset('sibling-settings','config',repo+'/docs/.codex/config.toml')]);
  h.run('renderLaunchScenarios($("launch-test"))');const scenarios=h.node('launch-test').querySelectorAll('.launch-scenario'),inside=scenarios.find(node=>node.dataset.scenario==='repository'),empty=scenarios.find(node=>node.dataset.scenario==='empty');
  const settingIds=article=>article.querySelector('.launch-settings-chain').querySelectorAll('button[data-asset-id]').map(control=>control.dataset.assetId);
  assert.deepEqual(settingIds(inside),['global-settings','settings','nested-settings']);assert.deepEqual(settingIds(empty),['global-settings']);
  assert.match(h.text(inside.querySelector('.launch-settings-chain')),/only when trusted.*active values are unverified/);
  assert.match(h.text(inside),/available candidates, not proof they loaded/);assert.equal(h.calls.length,0);assert.deepEqual(h.opened,[]);
});

test('scenario defaults never invent missing global or repository instructions',()=>{
  for(const files of [[],[asset('only-repo','instruction',repo+'/AGENTS.md',{status:'applies',readOrder:1})],[asset('only-global','instruction','/synthetic/user/.codex/AGENTS.md',{status:'applies',readOrder:1})]]){
    const h=harness(files),model=h.run('launchScenarioModel()');
    assert.deepEqual(Array.from(model.inside.instructions,file=>file.id),files.map(file=>file.id));
    assert.deepEqual(Array.from(model.empty.instructions,file=>file.id),files.filter(file=>!file.repo).map(file=>file.id));
    h.run('renderLaunchScenarios($("launch-test"))');assert.equal(h.calls.length,0);assert.deepEqual(h.opened,[]);
    const scenarios=h.node('launch-test').querySelectorAll('.launch-scenario');assert.equal(scenarios.length,2);
    const empty=scenarios.find(node=>node.dataset.scenario==='empty');assert.match(h.text(empty),/hypothetical|Hypothetical|clean folder/i);assert.match(h.text(empty),/outside|no repository/i);
  }
});

test('launch comparison excludes other repositories and agent homes before describing either session',()=>{
  const h=harness([...startingFiles(),asset('foreign-repo','instruction','/synthetic/other/AGENTS.md',{repo:'/synthetic/other',status:'applies',readOrder:1}),asset('foreign-agent','instruction','/synthetic/user/.claude/CLAUDE.md',{agent:'shared',status:'applies',readOrder:1})]);
  const model=h.run('launchScenarioModel()');
  for(const scenario of [model.inside,model.empty])for(const list of Object.values(scenario))assert.ok(Array.from(list).every(file=>!file.id.startsWith('foreign-')));
});

test('a repository override suppresses only its sibling while global and ancestor instructions remain',()=>{
  const h=harness([...startingFiles(),asset('global-skipped','instruction','/synthetic/user/.codex/AGENTS.override.md',{status:'shadowed'})]);
  const model=h.run('launchScenarioModel()');
  assert.deepEqual(Array.from(model.inside.instructions,file=>file.id),['global','override','nested']);
  assert.deepEqual(Array.from(model.empty.instructions,file=>file.id),['global']);
  assert.deepEqual(new Set(Array.from(model.inside.shadowed,file=>file.id)),new Set(['skipped','global-skipped']));
  h.run('renderLaunchScenarios($("launch-test"))');assert.match(h.text(h.node('launch-test')),/directory|sibling/i);
});

test('Claude launch comparison preserves tied instructions without borrowing Codex override claims',()=>{
  const h=harness([asset('global','instruction','/synthetic/user/.claude/CLAUDE.md',{agent:'claude',status:'applies',readOrder:1}),asset('a','instruction',repo+'/CLAUDE.md',{agent:'claude',status:'applies',readOrder:2,readOrderTied:true}),asset('b','instruction',repo+'/.claude/CLAUDE.md',{agent:'claude',status:'applies',readOrder:2,readOrderTied:true})]);
  h.context.loading.agent='claude';h.context.selectedAgent='claude';const model=h.run('launchScenarioModel()');
  assert.equal(model.isCodex,false);assert.deepEqual(new Set(Array.from(model.inside.instructions,file=>file.id)),new Set(['global','a','b']));
  h.run('renderLaunchScenarios($("launch-test"))');const text=h.text(h.node('launch-test'));assert.match(text,/order.*unresolved|combine/i);assert.doesNotMatch(text,/Codex chooses|Codex selects/);
  const inside=h.node('launch-test').querySelectorAll('.launch-scenario').find(node=>node.dataset.scenario==='repository'),controls=inside.querySelectorAll('button[data-asset-id]');
  assert.equal(controls.find(control=>control.dataset.assetId==='a').textContent,'CLAUDE.md');assert.equal(controls.find(control=>control.dataset.assetId==='b').textContent,'.claude/CLAUDE.md');
});

for(const change of ['repo','agent','folder'])test('launch files require an explicit protected editor action and detached scenarios cannot retarget a changed '+change,()=>{
  const h=harness();h.run('renderLaunchScenarios($("launch-test"))');const root=h.node('launch-test');
  assert.equal(h.calls.length,0);assert.deepEqual(h.opened,[]);
  const controls=root.querySelectorAll('button[data-asset-id]');const global=controls.find(control=>control.dataset.assetId==='global');global.click();assert.deepEqual(h.opened,['global']);
  const before=h.opened.length;
  if(change==='repo'){h.context.activeRepo='/synthetic/other';h.context.loading.repo=h.context.activeRepo;}
  if(change==='agent'){h.context.selectedAgent='claude';h.context.loading.agent='claude';}
  if(change==='folder')h.context.loading.launchDirectory=repo;
  for(const control of h.all(root).filter(node=>node.tag==='button'))control.click();
  assert.equal(h.opened.length,before);assert.equal(h.calls.length,0);
});

for(const scope of ['global','repository'])test('missing '+scope+' launch guidance opens the existing chooser in the explicit scope without writing',async()=>{
  const h=harness([]);h.run('renderLaunchScenarios($("launch-test"))');
  const control=h.all(h.node('launch-test')).find(node=>node.tag==='button'&&node.textContent==='Add '+scope+' instructions');control.click();
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].path,'/api/configuration');assert.deepEqual(h.calls[0].body,{action:'targets',agent:'codex',repo:scope==='global'?'':repo});
  assert.equal(h.node('configuration-dialog').open,true);assert.deepEqual(h.opened,[]);
  h.releases[0].resolve({agent:'codex',repo:scope==='global'?'':repo,targets:[]});await Promise.resolve();assert.equal(h.calls.length,1);assert.equal(h.node('configuration-create').disabled,true);
});

test('launch comparison with no selected repository takes the user to the existing folder setup without inventing a project',()=>{
  const h=harness([startingFiles()[0]]),frames=[];h.context.requestAnimationFrame=callback=>frames.push(callback);h.context.loading.repo='';h.context.loading.launchDirectory='';h.context.activeRepo='';
  const addFolder=h.node('setup-folder-disclosure');addFolder.tag='details';addFolder.className='setup-add';h.node('setup-guide').append(addFolder);addFolder.append(h.node('setup-folder-path'));
  h.node('setup-folder-path').focus=()=>{assert.equal(h.node('setup-guide').open,true);assert.equal(addFolder.open,true,'Folder field must be visible before focusing');h.node('setup-folder-path').focused=true;};
  h.run('renderLaunchScenarios($("launch-test"))');const control=h.all(h.node('launch-test')).find(node=>node.tag==='button'&&node.textContent==='Add a repository folder');control.click();
  assert.equal(h.context.location.hash,'dashboard');assert.equal(frames.length,1);assert.equal(addFolder.open,false);assert.equal(h.node('setup-folder-path').focused,undefined);
  h.context.view='dashboard';frames[0]();assert.equal(h.node('setup-guide').open,true);assert.equal(addFolder.open,true);assert.equal(h.node('setup-folder-path').scrolled,true);assert.equal(h.node('setup-folder-path').focused,true);assert.equal(h.context.activeRepo,'');assert.equal(h.calls.length,0);assert.deepEqual(h.opened,[]);
});

test('a pending folder-setup reveal cannot open or focus its field after the launch scope changes',()=>{
  const h=harness([startingFiles()[0]]),frames=[];h.context.requestAnimationFrame=callback=>frames.push(callback);h.context.loading.repo='';h.context.loading.launchDirectory='';h.context.activeRepo='';h.run('renderLaunchScenarios($("launch-test"))');
  h.all(h.node('launch-test')).find(node=>node.tag==='button'&&node.textContent==='Add a repository folder').click();
  h.context.view='dashboard';h.context.activeRepo=repo;h.context.loading.repo=repo;h.context.loading.launchDirectory=repo;frames[0]();
  assert.equal(h.node('setup-guide').open,false);assert.equal(h.node('setup-folder-path').focused,undefined);assert.equal(h.node('setup-folder-path').scrolled,undefined);assert.equal(h.calls.length,0);
});

test('canvas fallback geometry gives tied layers space and keeps the complete long filename selectable',()=>{
  const longName='a-very-long-repository-guidance-filename-that-must-remain-fully-readable-and-selectable.md';
  const files=[...startingFiles(),asset('long','instruction',repo+'/'+longName,{status:'applies',readOrder:2,readOrderTied:true})];
  const h=harness(files),model=h.run('configurationCanvasModel()'),single=harness().run('configurationCanvasModel()');
  const tied=model.nodes.find(node=>node.kind==='read-layer'&&node.readOrder===2);
  assert.ok(tied.height>single.nodes.find(node=>node.kind==='read-layer'&&node.readOrder===2).height);
  const baseNodes=Array.from(h.context.configurationVisibleNodes(model,{})).filter(node=>node.kind!=='available');
  for(let index=0;index<baseNodes.length;index++)for(const other of baseNodes.slice(index+1)){
    const node=baseNodes[index];
    assert.ok(node.x+node.width<=other.x||other.x+other.width<=node.x||node.y+node.height<=other.y||other.y+other.height<=node.y,node.id+' overlaps '+other.id);
  }
  h.render();const control=h.node('configuration-workspace').querySelectorAll('button[data-asset-id]').find(control=>control.dataset.assetId==='long'&&control.classList.contains('configuration-node-file'));
  assert.ok(h.text(control).includes(longName));control.click();assert.equal(h.run('configurationWorkspaceState.selectedId'),'long');assert.deepEqual(h.opened,[]);
  const override=h.node('configuration-workspace').querySelectorAll('.configuration-node-file').find(control=>control.dataset.assetId==='override');assert.equal(override.querySelector('.configuration-node-name').textContent,'AGENTS.override.md');
});

test('measured tall instruction cards and expanded source groups move following cards and connection anchors together',()=>{
  const h=harness();h.render();const root=h.node('configuration-workspace'),cards=root.querySelectorAll('.configuration-canvas-node');
  const read=cards.find(card=>card.dataset.nodeId==='layer:2');read.offsetHeight=460;
  const groups=cards.filter(card=>card.dataset.kind==='available'&&card.dataset.nodeId.startsWith('scope:repo:')).sort((a,b)=>Number(a.dataset.y)-Number(b.dataset.y));
  const expanded=groups[0],following=groups[1],oldY=Number(following.dataset.y);expanded.offsetHeight=400;
  h.observers[0].callback();
  assert.ok(Number(expanded.dataset.y)>=Number(read.dataset.y)+read.offsetHeight);
  assert.ok(Number(following.dataset.y)>=Number(expanded.dataset.y)+expanded.offsetHeight);assert.ok(Number(following.dataset.y)>oldY);
  const connector=root.querySelectorAll('path[data-relationship]').find(path=>path.dataset.relationship==='read-order'&&path.dataset.to==='layer:2');
  const coordinates=connector.attrs.d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  assert.equal(coordinates.at(-2),Number(read.dataset.x));assert.equal(coordinates.at(-1),Number(read.dataset.y)+read.offsetHeight/2);
  const world=h.node('configuration-canvas-world');assert.ok(parseFloat(world.style.height)>Math.max(...cards.map(card=>Number(card.dataset.y)+(card.offsetHeight||80))));
  const before=cards.map(card=>[card.dataset.nodeId,card.dataset.x,card.dataset.y]);h.context.activeRepo='/synthetic/other';h.context.loading.repo=h.context.activeRepo;expanded.offsetHeight=900;h.observers[0].callback();
  assert.deepEqual(cards.map(card=>[card.dataset.nodeId,card.dataset.x,card.dataset.y]),before);
});

test('revealing a canvas rendered while hidden remeasures cards and disconnected observers cannot change the old workspace',()=>{
  const h=harness();h.context.view='dashboard';h.render();const oldWorld=h.node('configuration-canvas-world'),observer=h.observers[0];assert.equal(observer.target,h.node('configuration-canvas-viewport'));
  const root=h.node('configuration-workspace'),read=root.querySelectorAll('.configuration-canvas-node').find(card=>card.dataset.nodeId==='layer:2');
  const heading=root.querySelectorAll('.configuration-canvas-node').find(card=>card.dataset.nodeId==='scope:repo');heading.offsetHeight=145;read.offsetHeight=620;
  h.context.view='inventory';observer.callback();
  assert.ok(Number(read.dataset.y)>=Number(heading.dataset.y)+heading.offsetHeight);
  for(const group of root.querySelectorAll('.configuration-canvas-node').filter(card=>card.dataset.kind==='available'))assert.ok(Number(group.dataset.y)>=Number(read.dataset.y)+read.offsetHeight);
  const connector=root.querySelectorAll('path[data-relationship]').find(path=>path.dataset.relationship==='read-order'&&path.dataset.to==='layer:2'),coordinates=connector.attrs.d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  assert.equal(coordinates.at(-1),Number(read.dataset.y)+read.offsetHeight/2);
  h.render();assert.equal(observer.disconnected,true);assert.equal(h.observers.length,2);oldWorld.isConnected=false;const before={...oldWorld.style};read.offsetHeight=1000;observer.callback();assert.deepEqual({...oldWorld.style},before);
  const current=h.observers[1],currentWorld=h.node('configuration-canvas-world'),currentBefore={...currentWorld.style};h.context.activeRepo='/synthetic/other';h.context.loading.repo=h.context.activeRepo;current.callback();assert.deepEqual({...currentWorld.style},currentBefore);
});

test('every discovered file remains reachable in the explorer and canvas without truncation',()=>{
  const files=Array.from({length:35},(_,index)=>asset('skill-'+index,'skill',repo+'/.agents/skills/check-'+index+'/SKILL.md',{status:'on-invoke'}));
  const h=harness(files);h.render();const controls=h.all(h.node('beginner-file-bands')).filter(node=>node.tag==='button'&&node.dataset.assetId);
  for(const file of files){
    const explorer=controls.find(control=>control.dataset.assetId===file.id&&control.classList.contains('configuration-explorer-file-button'));assert.ok(explorer,file.id);explorer.click();
    assert.ok(h.node('configuration-workspace').querySelectorAll('.configuration-node-file').some(control=>control.dataset.assetId===file.id),'Explorer must reveal '+file.id+' on the canvas');
  }
  assert.doesNotMatch(h.text(h.node('beginner-file-bands')),/Showing 3|Showing 5|Show more files/);
});

test('viewport zoom and pan are bounded and detached scope calls cannot alter the current workspace',()=>{
  const h=harness();h.render();const key=h.run('configurationWorkspaceKey()');h.context.key=key;
  h.run('setConfigurationViewport(999999,-999999,99,key)');let state=h.run('({...configurationWorkspaceState})');assert.equal(state.zoom,1.6);assert.equal(state.x,12000);assert.equal(state.y,-12000);
  h.run('setConfigurationViewport(0,0,0,key)');state=h.run('({...configurationWorkspaceState})');assert.equal(state.zoom,.45);
  h.run('setConfigurationViewport(24,24,1,key)');state=h.run('({...configurationWorkspaceState})');assert.equal(state.zoom,1);assert.equal(state.x,24);assert.equal(state.y,24);
  h.context.activeRepo='/synthetic/other';h.run('setConfigurationViewport(500,500,1.4,key)');assert.deepEqual({...h.run('({...configurationWorkspaceState})')},{...state});
});

test('Fit keeps the starting instruction chain readable instead of shrinking every available branch into the viewport',()=>{
  const h=harness([...startingFiles(),...Array.from({length:24},(_,index)=>asset('extra-'+index,index%2?'skill':'rule',repo+'/.agents/items/extra-'+index+'.md'))]);h.render();
  h.node('configuration-canvas-viewport').clientWidth=320;h.node('configuration-canvas-viewport').clientHeight=240;h.find('Fit startup path').click();
  assert.ok(h.run('configurationWorkspaceState.zoom')>=.8);assert.equal(h.calls.length,0);assert.deepEqual(h.opened,[]);
  for(const file of h.context.loading.configuration.files)assert.ok(h.node('configuration-workspace').querySelectorAll('button[data-asset-id]').some(control=>control.dataset.assetId===file.id));
});

test('canvas and explorer selection stay synchronized and inspection never opens or executes a file',()=>{
  const h=harness();h.render();const workspace=h.node('configuration-workspace');
  workspace.querySelectorAll('button[data-asset-id]').find(control=>control.dataset.assetId==='skill').click();
  const skillControls=workspace.querySelectorAll('button[data-asset-id]').filter(control=>control.dataset.assetId==='skill');
  assert.equal(skillControls.length,2);
  for(const control of skillControls)assert.equal(control.attrs['aria-pressed'],'true');
  for(const control of workspace.querySelectorAll('button[data-asset-id]').filter(control=>control.dataset.assetId!=='skill'))assert.equal(control.attrs['aria-pressed'],'false');
  assert.equal(h.run('configurationWorkspaceState.selectedId'),'skill');assert.deepEqual(h.opened,[]);assert.equal(h.calls.length,0);
  assert.match(h.text(h.node('configuration-inspector')),/Body on invocation.*Skill.*Estimated description: 12 tokens; body: 80 tokens/);
  for(const control of skillControls){let parent=control.parentElement;while(parent&&parent!==workspace){if(parent.tag==='details')assert.equal(parent.open,true);parent=parent.parentElement;}}
  h.find('Edit file').click();assert.deepEqual(h.opened,['skill']);
  const global=workspace.querySelectorAll('button[data-asset-id]').find(control=>control.dataset.assetId==='global');global.click();assert.equal(h.run('configurationWorkspaceState.selectedId'),'global');assert.match(h.text(h.node('configuration-inspector')),/Predicted instruction sequence, not live telemetry/);
});

test('rendered connections retain their distinct meaning and only read arrows imply sequence',()=>{
  const h=harness();h.render();const paths=h.all(h.node('beginner-file-bands')).filter(node=>node.tag==='path'&&node.dataset.relationship);
  assert.equal(paths.filter(path=>path.dataset.relationship==='read-order').length,2);
  for(const path of paths){if(path.dataset.relationship==='read-order')assert.equal(path.attrs['marker-end'],'url(#configuration-arrow)');else assert.equal(path.attrs['marker-end'],undefined);}
  assert.match(h.text(h.node('beginner-file-bands')),/Solid: instruction read order.*Dashed: available source · loading unverified/);
});

for(const change of ['repo','agent','folder'])test('detached canvas, inspector and zoom controls cannot retarget a changed '+change,()=>{
  const h=harness();h.render();const oldWorkspace=h.node('configuration-workspace');
  oldWorkspace.querySelectorAll('button[data-asset-id]').find(control=>control.dataset.assetId==='skill').click();const edit=h.find('Edit file'),zoom=h.find('+'),reset=h.find('Reset');
  const staleFile=oldWorkspace.querySelectorAll('button[data-asset-id]').find(control=>control.dataset.assetId==='global');
  if(change==='repo'){h.context.activeRepo='/synthetic/other';h.context.loading.repo=h.context.activeRepo;}
  if(change==='agent'){h.context.selectedAgent='claude';h.context.loading.agent='claude';}
  if(change==='folder')h.context.loading.launchDirectory=repo;
  h.render();const before={...h.run('({...configurationWorkspaceState})')};staleFile.click();edit.click();zoom.click();reset.click();
  assert.deepEqual({...h.run('({...configurationWorkspaceState})')},before);assert.deepEqual(h.opened,[]);assert.equal(h.calls.length,0);
});

test('explorer search narrows files locally and keeps all matching ancestors reachable',()=>{
  const h=harness();h.render();const explorer=h.node('configuration-workspace').querySelector('.configuration-explorer');
  const search=explorer.querySelector('input');search.value='config.toml';search.listeners.input();
  const rows=explorer.querySelectorAll('.configuration-explorer-file');assert.equal(rows.filter(row=>!row.hidden).length,1);assert.match(h.text(rows.find(row=>!row.hidden)),/config.toml/);
  const visibleFolder=explorer.querySelectorAll('.configuration-explorer-folder').find(row=>!row.hidden);assert.equal(visibleFolder.querySelector('details').open,true);
  search.value='';search.listeners.input();assert.equal(rows.filter(row=>!row.hidden).length,startingFiles().length);assert.equal(h.calls.length,0);
});

test('keyboard canvas controls pan and zoom while focused file controls retain their own key handling',()=>{
  const h=harness();h.render();const viewport=h.node('configuration-canvas-viewport');let prevented=0;
  const key=key=>viewport.listeners.keydown({target:viewport,key,preventDefault(){prevented++;}});
  key('ArrowRight');key('+');let state=h.run('({...configurationWorkspaceState})');assert.equal(state.x,-26);assert.equal(state.zoom,1.1);assert.equal(prevented,2);
  const file=h.node('configuration-workspace').querySelectorAll('button[data-asset-id]')[0];viewport.listeners.keydown({target:file,key:'ArrowRight',preventDefault(){prevented++;}});assert.deepEqual({...h.run('({...configurationWorkspaceState})')},{...state});assert.equal(prevented,2);
  h.find('Reset').click();state=h.run('({...configurationWorkspaceState})');assert.equal(state.x,24);assert.equal(state.y,24);assert.equal(state.zoom,1);assert.equal(h.calls.length,0);
});

const editable=(id='override',extra={})=>({id,name:'AGENTS.override.md',path:repo+'/AGENTS.override.md',content:'# Original\n',version:'original-version',language:'markdown',editable:true,...extra});
async function openFixture(h,file=editable()){
  const pending=h.context.openEditor(file.id,h.run('configurationWorkspaceKey()'));h.releases.at(-1).resolve(file);await pending;return file;
}

test('launch scenario file actions reuse the editor discard gate and preserve the original reviewed draft',async()=>{
  const h=harness(startingFiles(),true);h.render();const file=await openFixture(h);h.widgets[0].input('# Reviewed launch draft\n');h.context.reviewFile();
  h.run('renderLaunchScenarios($("launch-test"))');const global=h.node('launch-test').querySelectorAll('button[data-asset-id]').find(control=>control.dataset.assetId==='global');
  global.click();assert.equal(h.node('file-discard').hidden,false);assert.equal(h.calls.length,1);assert.equal(h.context.openFile,file);assert.equal(h.context.editorValue(),'# Reviewed launch draft\n');
  h.context.finishDiscard(false);await Promise.resolve();assert.equal(h.context.openFile,file);assert.equal(h.context.codeEditor,h.widgets[0]);assert.equal(h.context.editorValue(),'# Reviewed launch draft\n');assert.equal(h.context.reviewedContent,'# Reviewed launch draft\n');assert.equal(h.calls.length,1);
});

test('docked editor reuses syntax highlighting and preserves draft and review through workspace rerender',async()=>{
  const h=harness(startingFiles(),true);h.render();const file=await openFixture(h);const widget=h.widgets[0];
  assert.equal(widget.options.language,'markdown');assert.equal(widget.options.readOnly,false);assert.equal(h.node('file-dialog').modal,false);assert.equal(h.node('file-dialog').parentElement,h.node('configuration-editor-slot'));
  widget.input('# Reviewed draft\n');h.context.reviewFile();assert.equal(h.context.reviewedContent,'# Reviewed draft\n');
  h.render();assert.equal(h.context.openFile,file);assert.equal(h.context.codeEditor,widget);assert.equal(widget.destroyed,undefined);assert.equal(h.context.editorValue(),'# Reviewed draft\n');assert.equal(h.context.reviewedContent,'# Reviewed draft\n');assert.equal(h.node('file-dialog').parentElement,h.node('configuration-editor-slot'));assert.equal(h.node('file-dialog').open,true);assert.equal(h.calls.length,1);
  h.context.view='dashboard';h.context.configureFileEditorPresentation();assert.equal(h.node('file-dialog').parentElement,h.body);assert.equal(h.node('file-dialog').modal,true);assert.equal(h.context.editorValue(),'# Reviewed draft\n');
});

test('selecting another node cannot overwrite a dirty docked file; explicit edit keeps discard review',async()=>{
  const h=harness(startingFiles(),true);h.render();const file=await openFixture(h);h.widgets[0].input('# Unsaved draft\n');
  h.run('selectConfigurationFile("settings")');assert.equal(h.run('configurationWorkspaceState.selectedId'),'settings');assert.equal(h.context.openFile,file);assert.equal(h.context.editorValue(),'# Unsaved draft\n');assert.equal(h.calls.length,1);
  const switchFile=h.node('configuration-selected-source').querySelector('button');assert.equal(switchFile.textContent,'Open selected file');assert.equal(switchFile.disabled,false);switchFile.click();assert.equal(h.node('file-discard').hidden,false);assert.equal(h.calls.length,1);assert.equal(h.node('file-save').disabled,true);
  h.context.finishDiscard(false);await Promise.resolve();assert.equal(h.context.openFile,file);assert.equal(h.context.editorValue(),'# Unsaved draft\n');assert.equal(h.calls.length,1);
});

test('busy docked operations block retarget and close without erasing the current file',async()=>{
  const h=harness(startingFiles(),true);h.render();const file=await openFixture(h);h.context.fileBusy=true;
  h.run('selectConfigurationFile("settings")');assert.equal(h.node('configuration-selected-source').querySelector('button').disabled,true);await h.context.openEditor('settings',h.run('configurationWorkspaceKey()'));assert.equal(await h.context.closeEditor(),false);assert.equal(h.context.openFile,file);assert.equal(h.context.editorValue(),file.content);assert.equal(h.calls.length,1);assert.equal(h.node('file-dialog').open,true);assert.equal(h.notices.length,2);
});

test('scope change while discard is pending cannot launch a read or replace the current draft',async()=>{
  const h=harness(startingFiles(),true);h.render();const file=await openFixture(h);h.widgets[0].input('# Original scope draft\n');
  const pending=h.context.openEditor('settings',h.run('configurationWorkspaceKey()'));h.context.activeRepo='/synthetic/other';h.context.loading.repo=h.context.activeRepo;h.context.finishDiscard(true);await pending;
  assert.equal(h.calls.length,1);assert.equal(h.context.openFile,file);assert.equal(h.context.editorValue(),'# Original scope draft\n');
});

test('late scoped reads are rejected before constructing an editor for another workspace',async()=>{
  const h=harness(startingFiles(),true);h.render();const pending=h.context.openEditor('override',h.run('configurationWorkspaceKey()'));h.context.selectedAgent='claude';h.context.loading.agent='claude';h.releases[0].resolve(editable());await pending;
  assert.equal(h.context.openFile,null);assert.equal(h.widgets.length,0);assert.equal(h.context.fileBusy,false);assert.equal(h.node('file-error').hidden,false);assert.match(h.node('file-error').textContent,/scope changed/);
});

test('protected sources remain read only and cannot enter review or save from the dock',async()=>{
  const h=harness(startingFiles(),true);h.render();const file=await openFixture(h,editable('override',{editable:false,reason:'Synthetic protected source.'}));
  assert.equal(h.widgets[0].options.readOnly,true);assert.equal(h.widgets[0].input('Forbidden draft'),false);h.context.reviewFile();await h.context.saveFile();assert.equal(h.calls.length,1);assert.equal(h.context.openFile,file);assert.equal(h.node('file-save').disabled,true);assert.match(h.node('file-protection').textContent,/protected source/);
});

for(const fail of [false,true])test('actual file-map refresh preserves docked drafts through '+(fail?'failure':'recovery'),async()=>{
  const h=harness(startingFiles(),true);h.render();const file=await openFixture(h),snapshot=h.context.loading,widget=h.widgets[0];widget.input('# Keep this draft\n');h.context.reviewFile();
  h.context.renderLoading=h.render;vm.runInContext(refreshLoading,h.context);const pending=h.context.refreshLoading(true);
  assert.equal(h.node('file-dialog').parentElement,h.body);assert.equal(h.node('file-dialog').open,true);assert.equal(h.context.openFile,file);assert.equal(h.context.editorValue(),'# Keep this draft\n');assert.equal(widget.destroyed,undefined);
  if(fail)h.releases[1].reject(new Error('Synthetic discovery failure'));else h.releases[1].resolve(snapshot);await pending;
  assert.equal(h.context.openFile,file);assert.equal(h.context.codeEditor,widget);assert.equal(h.context.editorValue(),'# Keep this draft\n');assert.equal(h.context.reviewedContent,'# Keep this draft\n');assert.equal(h.node('file-dialog').open,true);assert.equal(widget.destroyed,undefined);assert.equal(h.calls.filter(call=>call.path==='/api/file').length,1);
  assert.equal(h.node('file-dialog').parentElement,fail?h.body:h.node('configuration-editor-slot'));
});

test('source families recognize skill suites, namespaces, plugin packages and Windows paths',()=>{
  const h=harness();
  const family=file=>({...h.context.configurationSourceFamily(file)});
  assert.equal(family(asset('g','skill','/synthetic/user/.agents/skills/gstack-review/SKILL.md')).key,'gstack');
  assert.equal(family(asset('h','skill','C:\\Synthetic\\.codex\\skills\\higgsfield-video\\SKILL.md')).key,'higgsfield');
  assert.equal(family(asset('n','skill','/synthetic/check/SKILL.md',{name:'suite:review'})).label,'suite');
  const plugin=version=>family(asset(version,'mcp-server','/synthetic/user/.codex/plugins/cache/provider/media-tools/'+version+'/.mcp.json'));
  assert.deepEqual(plugin('1.0'),plugin('2.0'));assert.equal(plugin('1.0').label,'media-tools');
  assert.notEqual(plugin('1.0').key,family(asset('p','plugin','/synthetic/user/.codex/plugins/cache/provider/other-tools/1.0/.app.json')).key);
});

test('categories expand through source families and bounded ranges before individual files',()=>{
  const files=[...Array.from({length:29},(_,index)=>asset('g'+index,'skill',repo+'/.agents/skills/gstack-review-'+String(index).padStart(2,'0')+'/SKILL.md',{name:'gstack-review-'+String(index).padStart(2,'0')})),asset('h','skill',repo+'/.agents/skills/higgsfield-image/SKILL.md',{name:'higgsfield-image'})];
  const h=harness(files),model=h.context.configurationCanvasModel(),category=model.nodes.find(node=>node.kind==='available'&&node.label==='Skills');
  let state={expandedIds:[]};const visible=()=>Array.from(h.context.configurationVisibleNodes(model,state));
  assert.equal(visible().some(node=>['family','item'].includes(node.kind)),false);assert.equal(category.files.length,30);
  state.expandedIds.push(category.id);let families=visible().filter(node=>node.kind==='family');assert.equal(families.length,2);assert.equal(visible().some(node=>node.kind==='item'),false);
  const gstack=families.find(node=>node.label==='gstack');state.expandedIds.push(gstack.id);const ranges=visible().filter(node=>node.parentId===gstack.id);assert.equal(ranges.length,3);assert.ok(ranges.every(node=>node.files.length<=12));
  state.expandedIds.push(ranges[0].id);assert.equal(visible().filter(node=>node.kind==='item').length,12);
  state.expandedIds=model.nodes.filter(node=>['available','family'].includes(node.kind)).map(node=>node.id);
  const items=visible().filter(node=>node.kind==='item');assert.equal(items.length,files.length);assert.equal(new Set(items.map(node=>node.id)).size,files.length);
  assert.deepEqual(new Set(items.flatMap(node=>Array.from(node.files,file=>file.id))),new Set(files.map(file=>file.id)));
});

test('all component types use progressive families without crossing global and repository scope',()=>{
  const files=[];
  for(const type of ['skill','plugin','mcp-server','rule','subagent','config'])for(const global of [false,true])files.push(asset(type+global,type,(global?'/synthetic/user':repo)+'/.codex/plugins/cache/vendor/suite/1.0/'+type+'.json'));
  const h=harness(files),model=h.context.configurationCanvasModel();
  for(const category of model.nodes.filter(node=>node.kind==='available')){
    const children=model.nodes.filter(node=>node.parentId===category.id);assert.equal(children.length,1);assert.equal(children[0].kind,'family');
    assert.ok(category.files.every(file=>Boolean(file.repo)===category.id.startsWith('scope:repo:')));
  }
  assert.equal(new Set(model.nodes.map(node=>node.id)).size,model.nodes.length);
});

test('focus, hiding and stale state pruning affect only visible graph nodes',()=>{
  const h=harness([asset('g','skill',repo+'/.agents/skills/gstack-review/SKILL.md'),asset('h','skill',repo+'/.agents/skills/higgsfield-video/SKILL.md')]),model=h.context.configurationCanvasModel();
  const item=model.nodes.find(node=>node.kind==='item'&&node.files[0].id==='g'),other=model.nodes.find(node=>node.kind==='item'&&node.files[0].id==='h');
  const expandedIds=model.nodes.filter(node=>['available','family'].includes(node.kind)).map(node=>node.id),state={expandedIds,focusIds:[item.id],hiddenIds:[]};
  let visible=Array.from(h.context.configurationVisibleNodes(model,state));assert.ok(visible.some(node=>node.id===item.id));assert.ok(visible.some(node=>node.id===item.parentId));assert.ok(!visible.some(node=>node.id===other.id));
  state.hiddenIds=[item.parentId];visible=Array.from(h.context.configurationVisibleNodes(model,state));assert.ok(!visible.some(node=>node.id===item.id));
  const pruned=h.context.configurationPruneCanvasState(model,{...state,selectedId:'missing-file',selectedNodes:[item.id,item.id,'missing'],expandedIds:[...expandedIds,'missing'],hiddenIds:['missing'],focusIds:['missing']});
  assert.equal(pruned.selectedId,null);assert.deepEqual(Array.from(pruned.selectedNodes),[item.id]);assert.deepEqual(Array.from(pruned.hiddenIds),[]);assert.deepEqual(Array.from(pruned.focusIds),[]);assert.ok(!pruned.expandedIds.includes('missing'));assert.equal(h.calls.length,0);
});

test('rectangular selection selects intersecting visible nodes and excludes scope labels',()=>{
  const h=harness(),nodes=[{id:'scope',kind:'scope',x:0,y:0,width:100,height:100},{id:'a',kind:'family',x:10,y:10,width:50,height:50},{id:'b',kind:'item',x:80,y:20,width:50,height:50},{id:'outside',kind:'item',x:200,y:200,width:50,height:50}];
  assert.deepEqual(Array.from(h.context.configurationSelectionInRect(nodes,{x:20,y:20,width:70,height:30})),['a','b']);
  assert.deepEqual(Array.from(h.context.configurationSelectionInRect(nodes,{x:130,y:20,width:10,height:30})),[]);
});

test('expansion, multi-selection, focus and hiding preserve an unsaved editor without writes',async()=>{
  const h=harness(startingFiles(),true);h.render();await openFixture(h);const widget=h.widgets[0];widget.input('# Keep this canvas draft\n');h.context.reviewFile();
  const card=id=>h.node('configuration-workspace').querySelectorAll('.configuration-canvas-node').find(node=>node.dataset.nodeId===id);
  const categories=h.node('configuration-workspace').querySelectorAll('.configuration-canvas-node').filter(node=>node.dataset.kind==='available');
  const first=categories[0].dataset.nodeId,second=categories[1].dataset.nodeId;
  card(first).querySelector('.configuration-node-expand').click();assert.equal(card(first).querySelector('.configuration-node-expand').attrs['aria-expanded'],'true');
  card(first).querySelector('.configuration-node-select').click();card(second).querySelector('.configuration-node-select').click({shiftKey:true});assert.equal(h.run('configurationWorkspaceState.selectedNodes.length'),2);
  h.find('Focus selection').click();assert.equal(h.run('configurationWorkspaceState.focusIds.length'),2);assert.ok(card(first));assert.ok(card(second));
  h.find('Hide from view').click();assert.equal(card(first),undefined);assert.equal(card(second),undefined);assert.equal(h.run('configurationWorkspaceState.selectedNodes.length'),0);
  h.node('configuration-workspace').querySelectorAll('button').find(node=>node.textContent.startsWith('Show all')).click();assert.ok(card(first));assert.ok(card(second));
  assert.equal(h.context.codeEditor,widget);assert.equal(widget.destroyed,undefined);assert.equal(h.context.editorValue(),'# Keep this canvas draft\n');assert.equal(h.context.reviewedContent,'# Keep this canvas draft\n');assert.equal(h.calls.length,1);
});

test('pointer lasso applies canvas pan and zoom and supports additive selection',()=>{
  const h=harness();h.render();h.run('setConfigurationViewport(-20,35,.8)');const viewport=h.node('configuration-canvas-viewport');h.find('Select area').click();
  const cards=h.node('configuration-workspace').querySelectorAll('.configuration-canvas-node').filter(node=>node.dataset.kind==='available');const target=cards[0];
  const x=Number(target.dataset.x)*.8-20,y=Number(target.dataset.y)*.8+35;
  viewport.listeners.pointerdown({target:viewport,button:0,pointerId:2,clientX:x-5,clientY:y-5});
  viewport.listeners.pointermove({pointerId:2,clientX:x+40,clientY:y+40});viewport.listeners.pointerup();
  assert.deepEqual(Array.from(h.run('configurationWorkspaceState.selectedNodes')),[target.dataset.nodeId]);
  assert.equal(h.node('configuration-workspace').querySelector('.configuration-selection-rectangle').hidden,true);
  cards[1].querySelector('.configuration-node-select').click({ctrlKey:true});assert.equal(h.run('configurationWorkspaceState.selectedNodes.length'),2);assert.equal(h.calls.length,0);
});

test('node actions are keyboard accessible and stale menu actions cannot change another scope',()=>{
  const h=harness();h.render();const card=h.node('configuration-workspace').querySelectorAll('.configuration-canvas-node').find(node=>node.dataset.kind==='available');
  card.listeners.keydown({key:'F10',shiftKey:true,preventDefault(){},stopPropagation(){}});const menu=h.node('configuration-workspace').querySelector('.configuration-node-menu');assert.equal(menu.hidden,false);assert.equal(menu.attrs.role,'menu');assert.ok(menu.querySelectorAll('button').every(node=>node.attrs.role==='menuitem'));
  menu.listeners.keydown({key:'Escape',preventDefault(){}});assert.equal(menu.hidden,true);
  card.querySelector('.configuration-node-actions').click();const hide=menu.querySelectorAll('button').find(node=>node.textContent==='Hide from view');h.context.activeRepo='/synthetic/other';h.context.loading.repo=h.context.activeRepo;h.render();const before=h.run('JSON.stringify(configurationWorkspaceState)');hide.click();assert.equal(h.run('JSON.stringify(configurationWorkspaceState)'),before);assert.equal(h.calls.length,0);
});

test('large plugin inventories reveal bounded family ranges instead of every plugin at once',()=>{
  const files=Array.from({length:129},(_,index)=>asset('plugin-'+index,'plugin','/synthetic/user/.codex/plugins/cache/vendor/plugin-'+String(index).padStart(3,'0')+'/1.0/.app.json'));
  const h=harness(files),model=h.context.configurationCanvasModel(),category=model.nodes.find(node=>node.kind==='available');
  const visible=Array.from(h.context.configurationVisibleNodes(model,{expandedIds:[category.id]})),children=visible.filter(node=>node.parentId===category.id);
  assert.ok(children.length<=12);assert.equal(children.reduce((sum,node)=>sum+node.files.length,0),129);assert.ok(!visible.some(node=>node.kind==='item'));
  assert.equal(children[0].label,'vendor plugins');assert.equal(children[0].range,undefined);
  const next=Array.from(h.context.configurationVisibleNodes(model,{expandedIds:[category.id,children[0].id]})).filter(node=>node.parentId===children[0].id);
  assert.equal(next.length,11);assert.ok(next.every(node=>node.files.length<=12));
});
test('known skill suites remain visible before collection ranges in a large mixed inventory',()=>{
 const files=[...Array.from({length:25},(_,index)=>asset('plugin-'+index,'skill','/synthetic/.codex/plugins/cache/vendor/plugin-'+index+'/1/skills/review/SKILL.md')),asset('g','skill','/synthetic/.codex/plugins/cache/vendor/gstack/1/skills/review/SKILL.md'),asset('h','skill',repo+'/.agents/skills/higgsfield-video/SKILL.md')];
 const h=harness(files),model=h.context.configurationCanvasModel(),global=model.nodes.find(node=>node.id==='scope:global:skill');
 const children=Array.from(h.context.configurationVisibleNodes(model,{expandedIds:[global.id]})).filter(node=>node.parentId===global.id);
 assert.deepEqual(new Set(children.map(node=>node.label)),new Set(['gstack','vendor plugins']));assert.equal(children.reduce((n,node)=>n+node.files.length,0),26);
 const repository=model.nodes.find(node=>node.id==='scope:repo:skill');assert.equal(model.nodes.find(node=>node.parentId===repository.id).label,'Higgsfield');
});

test('inspecting a visible source preserves focus and refresh does not reveal dismissed nodes',()=>{
  const h=harness([asset('g','skill',repo+'/.agents/skills/gstack-review/SKILL.md'),asset('h','skill',repo+'/.agents/skills/higgsfield-video/SKILL.md')]);h.render();
  const card=id=>h.node('configuration-workspace').querySelectorAll('.configuration-canvas-node').find(node=>node.dataset.nodeId===id);
  const model=h.context.configurationCanvasModel(),category=model.nodes.find(node=>node.kind==='available'),family=model.nodes.find(node=>node.kind==='family'&&node.label==='gstack'),leaf=model.nodes.find(node=>node.kind==='item'&&node.files[0].id==='g');
  card(category.id).querySelector('.configuration-node-expand').click();card(family.id).querySelector('.configuration-node-select').click();h.find('Focus selection').click();
  assert.ok(card(leaf.id));assert.match(h.text(card(leaf.id)),/gstack-review/);card(leaf.id).querySelector('.configuration-node-file').click();assert.deepEqual(Array.from(h.run('configurationWorkspaceState.focusIds')),[family.id]);
  h.find('Hide from view').click();assert.equal(card(leaf.id),undefined);const before=h.run('JSON.stringify({hidden:configurationWorkspaceState.hiddenIds,focus:configurationWorkspaceState.focusIds,x:configurationWorkspaceState.x,y:configurationWorkspaceState.y})');h.render();
  assert.equal(card(leaf.id),undefined);assert.equal(h.run('JSON.stringify({hidden:configurationWorkspaceState.hiddenIds,focus:configurationWorkspaceState.focusIds,x:configurationWorkspaceState.x,y:configurationWorkspaceState.y})'),before);assert.equal(h.calls.length,0);
});

test('source labels distinguish generic filenames without requiring full machine paths',()=>{
  const h=harness();assert.equal(h.context.configurationSourceLabel(asset('g','skill','/synthetic/user/.agents/skills/gstack-review/SKILL.md')),'gstack-review');
  const label=h.context.configurationSourceLabel(asset('p','mcp-server','/synthetic/user/.codex/plugins/cache/vendor/media-tools/1.0/.mcp.json'));assert.match(label,/media-tools/);assert.match(label,/\.mcp\.json/);assert.doesNotMatch(label,/synthetic\/user/);
});


test('editor explains installation metadata and scope before a user changes anything',async()=>{
  const h=harness(startingFiles(),true);h.render();await openFixture(h,editable('override',{name:'.skill-lock.json',repo:'',scopeLabel:'Global setup',scopeDescription:'Stored in your user-level setup.',purpose:'Installation record for skills: their sources, versions and hashes. This is not an instruction file.',impact:'Saving updates this user-level file.'}));
  assert.equal(h.node('file-kind').textContent,'File editor');assert.equal(h.node('file-scope').textContent,'Global setup');assert.match(h.node('file-purpose').textContent,/Installation record.*not an instruction file/);assert.match(h.node('file-impact').textContent,/Saving updates/);assert.match(h.node('file-protection').textContent,/Opening this file changes nothing/);assert.equal(h.calls.length,1);
});
