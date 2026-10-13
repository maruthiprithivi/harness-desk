import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const context=vm.createContext({});
vm.runInContext(source.slice(source.indexOf('function sessionStartupModel('),source.indexOf('function renderSessionStartup(')),context);
const model=context.sessionStartupModel;
const map={agent:'codex',repo:'/project',launchDirectory:'/project',summary:{estimatedInstructionBytes:800,projectInstructionBytes:400},groups:[{files:[{type:'instruction',status:'applies',repo:''},{type:'instruction',status:'applies',repo:'/project'},{type:'instruction',status:'shadowed',repo:'/project'}]}],configuration:{files:[{type:'skill',residentTokens:10,bodyTokens:9000},{type:'skill',residentTokens:null}]}};
const reading=(repo,stage,percentages)=>({agent:'codex',repo,stage,percentages});
test('startup preview separates global/project instructions and skill descriptions from full bodies',()=>{
  const result=model(map,[],'codex','/project');
  assert.equal(result.global.count,1);assert.equal(result.project.count,1);assert.equal(result.global.tokens,100);assert.equal(result.project.tokens,100);
  assert.equal(result.descriptionTokens,10);assert.equal(result.unknownDescriptions,1);assert.equal(result.skillCount,2);assert.equal(result.attributed,0);
});
test('only matching startup readings count, never conversations or another scope',()=>{
  const readings=[reading('','startup',{skills:99}),reading('/project','startup',{skills:0,memory:12}),reading('/project','conversation',{messages:90})];
  const result=model(map,readings,'codex','/project');assert.equal(result.percentages.skills,0);assert.equal(result.percentages.tools,undefined);assert.equal(result.attributed,12);
  assert.equal(model({...map,launchDirectory:'/project/src'},readings,'codex','/project').record,null);
  assert.equal(model(map,readings,'claude','/project'),null);assert.equal(model(map,readings,'codex',''),null);assert.equal(model(null,readings,'codex','/project'),null);
});
test('global startup uses its own reading and preserves the unknown remainder',()=>{
  const result=model({...map,repo:'',launchDirectory:'',groups:[{files:map.groups[0].files.slice(0,1)}],summary:{estimatedInstructionBytes:400,projectInstructionBytes:0}},[reading('','startup',{memory:3,free:0})],'codex','');
  assert.equal(result.project.count,0);assert.equal(result.project.tokens,0);assert.equal(result.percentages.free,0);assert.equal(result.attributed,3);assert.equal(result.nested,false);
});

function renderHarness(records=[]) {
  const nodes=new Map(),calls=[];
  const node=(tag='div',className='',textContent='')=>({tag,className,textContent,children:[],dataset:{},style:{},open:false,append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},setAttribute(key,value){this[key]=value;},scrollIntoView(){calls.push('scroll');}});
  const get=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
  const ctx=vm.createContext({$:get,element:node,button:(label,classes,click)=>Object.assign(node('button',classes,label),{click}),loading:map,state:{contextBreakdowns:records},selectedAgent:'codex',activeRepo:'/project',loadingError:'',number:String,tokens:String,agentName:String,repoName:String,loadingDirectoryLabel:String,date:String,contextBreakdownCategories:()=>[{id:'skills',label:'Skills'},{id:'memory',label:'Instructions'}],showFileView:()=>calls.push('canvas'),componentDrilldown:type=>calls.push(type),inspectComponentServers:async()=>calls.push('inspect'),action:async(_button,fn)=>fn(),openEditor:(id,key)=>calls.push({id,key})});
  vm.runInContext(source.slice(source.indexOf('function sessionStartupModel('),source.indexOf('const contextBreakdownIds =')),ctx);
  const render=()=>vm.runInContext('renderSessionStartup()',ctx);
  const all=root=>[root,...root.children.flatMap(all)];
  render();return {ctx,render,calls,all:()=>all(get('session-startup-overview'))};
}
test('beginner default displays actionable estimates without an empty context-window meter or manual form',async()=>{
  const h=renderHarness(),text=h.all().map(n=>n.textContent).join(' ');
  assert.match(text,/File-size estimates, not percentages/);assert.match(text,/~200 tokens/);assert.match(text,/~10 tokens \+ unknown/);
  assert.doesNotMatch(text,/Not measured|Measure startup|Read or add measured/);
  assert.equal(h.all().some(n=>n.className.includes('context-breakdown-bar')),false);
  const fills=h.all().filter(n=>n.tag==='span'&&n.style.width);assert.deepEqual(fills.map(n=>n.style.width),['100%','5%']);
  h.all().find(n=>n.textContent==='Review skills').click();assert.equal(h.calls.at(-1),'skill');
  h.all().find(n=>n.textContent==='Review instructions').click();assert.deepEqual(h.calls.slice(-2),['canvas','scroll']);
  await h.all().find(n=>n.textContent==='Inspect MCP servers').click({currentTarget:{}});assert.deepEqual(h.calls.slice(-2),['tools','inspect']);
});
test('reported percentages are a separate collapsed snapshot, preserving zero and unknown remainder',()=>{
  const h=renderHarness([reading('/project','startup',{skills:0,memory:12})]);
  const report=h.all().find(n=>n.className.includes('startup-recorded-report'));assert.equal(report.open,false);
  assert.match(h.all().map(n=>n.textContent).join(' '),/Missing categories are unknown.*0%.*12%.*88% unattributed/);
});
test('empty inventory does not produce invalid bars; changing scope removes stale estimates',()=>{
  const h=renderHarness();h.ctx.loading={agent:'codex',repo:'/project',launchDirectory:'/project',groups:[],configuration:{files:[]}};h.render();
  assert.ok(h.all().filter(n=>n.tag==='span'&&n.style.width).every(n=>n.style.width==='0%'));
  h.ctx.activeRepo='/different';h.render();assert.equal(h.all().some(n=>n.className==='startup-estimate-row'),false);assert.match(h.all().map(n=>n.textContent).join(' '),/Preparing/);
});


test('startup preview identifies global, repository and launch-folder instruction sources and opens the exact file',()=>{
  const h=renderHarness();
  const files=[{id:'g',name:'AGENTS.md',path:'/synthetic/user/.codex/AGENTS.md',repo:'',type:'instruction',status:'applies',role:'global instruction',readOrder:1},{id:'p',name:'AGENTS.override.md',path:'/project/AGENTS.override.md',repo:'/project',type:'instruction',status:'applies',readOrder:2},{id:'n',name:'AGENTS.md',path:'/project/src/AGENTS.md',repo:'/project',type:'instruction',status:'applies',role:'launch directory instruction',readOrder:3},{id:'s',name:'AGENTS.md',path:'/project/AGENTS.md',repo:'/project',type:'instruction',status:'shadowed'}];
  h.ctx.loading={...map,launchDirectory:'/project/src',groups:[{files:[...files,files[0]]}],configuration:{files}};h.render();
  const rows=h.all().filter(n=>n.className==='startup-source');assert.deepEqual(rows.map(n=>n.dataset.scope),['Global','Repository','Launch folder']);
  const names=h.all().filter(n=>n.className==='startup-source-name text-link');assert.deepEqual(names.map(n=>n.textContent),['AGENTS.md','AGENTS.override.md','AGENTS.md']);assert.deepEqual(names.map(n=>n.dataset.assetId),['g','p','n']);
  assert.deepEqual(h.all().filter(n=>n.className==='startup-source-path').map(n=>n.textContent),['/synthetic/user/.codex/AGENTS.md','AGENTS.override.md','src/AGENTS.md']);
  names[1].click();assert.deepEqual(h.calls.at(-1),{id:'p',key:JSON.stringify(['/project','codex','/project/src'])});
  const before=h.calls.length;h.ctx.activeRepo='/different';names[0].click();assert.equal(h.calls.length,before);
  h.ctx.activeRepo='/project';h.ctx.loading={...h.ctx.loading,launchDirectory:'/project'};names[2].click();assert.equal(h.calls.length,before);
});

test('origin labels recognize Windows paths, Claude project homes and ancestor guidance',()=>{
  const origin=context.startupInstructionOrigin;
  assert.equal(origin({path:'C:\\work\\repo\\src\\AGENTS.md',repo:'C:\\work\\repo'},{agent:'codex',launchDirectory:'C:\\work\\repo\\src'}).scope,'Launch folder');
  assert.equal(origin({path:'/project/.claude/CLAUDE.md',repo:'/project'},{agent:'claude',launchDirectory:'/project'}).scope,'Repository');
  assert.equal(origin({path:'/synthetic/user/CLAUDE.md',repo:'',role:'ancestor instruction'},{agent:'claude',launchDirectory:'/project'}).scope,'Ancestor folder');
  assert.equal(origin({path:'/project/src/AGENTS.md',repo:'/project'},{agent:'codex',launchDirectory:'/project/src/deep'}).scope,'Ancestor folder');
});
