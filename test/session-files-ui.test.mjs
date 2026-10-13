import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const slice=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const picker=slice('function sessionFilesScopeText(','function showFileView(');
const action=slice('async function action(','function scopedItems(');
const handlers=slice("$('session-files-open').addEventListener", "$('usage-import-form').addEventListener");
const repo='/synthetic/repo-a';
const file=(index=0,extra={})=>({path:'/synthetic/sessions/session-'+index+'.jsonl',label:'session-'+index+'.jsonl',bytes:100,modifiedAt:new Date(Date.UTC(2026,9,1,index)).toISOString(),importable:true,...extra});
const response=(body,files=[file()],extra={})=>({...body,files,rootStatus:'available',coverage:{partial:false,visited:1,filesFound:files.length},...extra});
const tick=()=>new Promise(setImmediate);

function harness({api=async(path,body)=>path==='/api/session-files'?response(body):{}}={}){
  const nodes=new Map(),calls=[],refreshes=[];
  const descendants=item=>[item,...item.children.flatMap(descendants)];
  const element=(tag='div',className='',text='')=>({tag,className,textContent:text,children:[],dataset:{},value:'',disabled:false,hidden:true,open:false,listeners:{},
    append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},addEventListener(type,fn){this.listeners[type]=fn;},
    querySelectorAll(tag){return descendants(this).filter(item=>item.tag===tag);},showModal(){this.open=true;},close(){this.open=false;},
    set innerHTML(value){throw new Error('Session metadata must remain text');},
  });
  const node=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
  const context=vm.createContext({$:node,element,array:value=>Array.isArray(value)?value:[],number:String,bytes:value=>value+' B',date:String,time:()=>'',repoName:String,agentName:String,
    empty:(title,description)=>element('div','empty',title+' '+description),activeRepo:repo,selectedAgent:'claude',sessionFilesScope:null,sessionFilesBusy:'',sessionFilesSequence:0,sessionFileChoices:[],sessionFileSelection:new Set(),
    clearError(){},showError(error){throw error;},updateChatAvailability(){},
    api:async(path,body)=>{calls.push({path,body});return api(path,body,calls.length);},refreshLoading:async force=>{refreshes.push({force,repo:context.activeRepo,agent:context.selectedAgent});},
  });
  node('usage-import-agent').value='claude';node('usage-import-days').value='7';
  vm.runInContext(action+picker+handlers,context);
  const run=expression=>vm.runInContext(expression,context);
  const text=item=>[item.textContent,...item.children.map(text)].join(' ');
  const checks=()=>node('session-files-list').querySelectorAll('input');
  const select=(index,checked=true)=>{const check=checks()[index];check.checked=checked;check.listeners.change();};
  const open=async()=>{node('session-files-open').listeners.click();await tick();};
  return{context,node,calls,refreshes,run,text,checks,select,open,descendants};
}

test('chooser is an explicit native dialog and discovery never selects or imports files automatically',async()=>{
  const h=harness();assert.equal(h.calls.length,0);await h.open();
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].path,'/api/session-files');assert.equal(h.calls[0].body.agent,'claude');assert.equal(h.calls[0].body.repo,repo);
  assert.equal(h.node('session-files-dialog').open,true);assert.equal(h.checks()[0].checked,false);
  await h.run('importSessionFiles()');assert.equal(h.calls.length,1);assert.match(h.node('session-files-error').textContent,/Choose 1–20/);
  assert.match(html,/<dialog id="session-files-dialog" aria-labelledby="session-files-title">/);assert.match(html,/id="session-files-open"[^>]*type="button"/);
  assert.match(html,/id="usage-import-files"[^>]*multiple required/);
});

test('choices are bounded to 30 newest metadata entries, with oversize files disabled and safe text only',async()=>{
  const entries=Array.from({length:35},(_,index)=>file(index));entries[34]=file(34,{label:'<img src=x onerror=alert(1)>',bytes:2*1048576+1});
  const h=harness({api:async(path,body)=>response(body,entries,{coverage:{partial:true,issues:['The entry limit was reached. Results show newest files found within the bounded search.','Some session entries were excluded or unreadable.'],visited:3,filesFound:35}})});await h.open();
  assert.equal(h.checks().length,30);assert.equal(h.checks()[0].disabled,true);assert.equal(h.checks().every(check=>!check.checked),true);
  const display=h.text(h.node('session-files-list'));assert.match(display,/<img src=x onerror=alert\(1\)>/);assert.match(display,/Over the 2 MiB limit/);assert.match(display,/Modified/);
  assert.equal(h.descendants(h.node('session-files-list')).some(item=>item.tag==='img'),false);assert.doesNotMatch(display,/session-0\.jsonl/);
  assert.match(h.node('session-files-status').textContent,/Search was partial/);assert.match(h.node('session-files-status').textContent,/entry limit was reached/);assert.match(h.node('session-files-status').textContent,/excluded or unreadable/);
});

test('fixed scope and window survive polls and the import sends only selected found paths',async()=>{
  const h=harness();await h.open();h.select(0);
  h.context.activeRepo='/synthetic/repo-b';h.context.selectedAgent='codex';h.node('usage-import-agent').value='codex';h.node('usage-import-days').value='30';
  await h.run('importSessionFiles()');const request=h.calls[1];
  assert.equal(request.path,'/api/usage-import');assert.equal(request.body.agent,'claude');assert.equal(request.body.repo,repo);assert.equal(request.body.days,7);assert.deepEqual([...request.body.paths],[file().path]);
  assert.deepEqual(Object.keys(request.body).sort(),['agent','days','paths','repo']);assert.equal(h.node('session-files-dialog').open,false);
  assert.deepEqual(h.refreshes,[{force:true,repo:'/synthetic/repo-b',agent:'codex'}]);assert.match(h.node('usage-import-status').textContent,/claude.*repo-a.*Last 7 days/);assert.match(h.node('usage-import-status').textContent,/dashboard selection differs/);
});

test('global scope and all dates are captured exactly for Codex',async()=>{
  const h=harness();h.context.activeRepo='';h.context.selectedAgent='codex';h.node('usage-import-agent').value='codex';h.node('usage-import-days').value='all';await h.open();h.select(0);await h.run('importSessionFiles()');
  assert.equal(h.calls[1].body.repo,'');assert.equal(h.calls[1].body.agent,'codex');assert.equal(h.calls[1].body.days,'all');assert.match(h.node('session-files-scope').textContent,/Global setup only.*All dates/);
});

test('file-count and total-byte limits are checked before a path import',async()=>{
  const h=harness({api:async(path,body)=>response(body,Array.from({length:30},(_,index)=>file(index)))});await h.open();for(let index=0;index<21;index++)h.select(index);await h.run('importSessionFiles()');assert.equal(h.calls.length,1);
  const big=harness({api:async(path,body)=>response(body,Array.from({length:5},(_,index)=>file(index,{bytes:2*1048576})))});await big.open();for(let index=0;index<5;index++)big.select(index);await big.run('importSessionFiles()');assert.equal(big.calls.length,1);
  big.select(4,false);await big.run('importSessionFiles()');assert.equal(big.calls.length,2);assert.equal(big.calls[1].body.paths.length,4);
});

test('unavailable file metadata and arbitrary paths cannot become import selections',async()=>{
  const h=harness({api:async(path,body)=>response(body,[file(0,{importable:false}),file(1,{bytes:2*1048576+1})])});await h.open();h.select(0);h.select(1);h.context.sessionFileSelection.add('/synthetic/not-found.jsonl');await h.run('importSessionFiles()');
  assert.equal(h.calls.length,1);assert.equal(h.context.sessionFileSelection.has(file().path),false);
});

test('failed imports keep the chosen files and show a generic error without a raw response body',async()=>{
  const h=harness({api:async(path,body)=>{if(path==='/api/usage-import')throw new Error('SENSITIVE RAW BODY');return response(body);}});await h.open();h.select(0);await h.run('importSessionFiles()');
  assert.equal(h.node('session-files-dialog').open,true);assert.equal(h.checks()[0].checked,true);assert.equal(h.checks()[0].disabled,false);assert.match(h.node('session-files-error').textContent,/selection is still here/);assert.doesNotMatch(h.node('session-files-error').textContent,/SENSITIVE/);
});

test('missing, excluded and empty folders offer manual file fallback without an import',async()=>{
  for(const rootStatus of ['missing','excluded','available']){
    const h=harness({api:async(path,body)=>response(body,[],{rootStatus})});await h.open();assert.equal(h.checks().length,0);assert.match(h.text(h.node('session-files-list')),/Choose local files manually/);assert.equal(h.calls.length,1);
  }
});

test('discovery failure and unsupported agent preserve the manual chooser path',async()=>{
  const h=harness({api:async()=>{throw new Error('SENSITIVE PATH');}});await h.open();assert.match(h.node('session-files-error').textContent,/choose files manually/);assert.doesNotMatch(h.node('session-files-error').textContent,/SENSITIVE/);assert.equal(h.node('session-files-cancel').disabled,false);
  const unsupported=harness();unsupported.node('usage-import-agent').value='other';await unsupported.open();assert.equal(unsupported.calls.length,0);assert.equal(unsupported.node('session-files-dialog').open,false);assert.match(unsupported.node('usage-import-status').textContent,/manually/);
});

test('cancelled discovery replies cannot reopen or overwrite a new chooser scope',async()=>{
  const releases=[];const h=harness({api:async(path,body)=>new Promise(resolve=>releases.push(()=>resolve(response(body,[file(releases.length)]))))});
  await h.open();assert.equal(h.node('session-files-close').disabled,false);h.node('session-files-dialog').listeners.cancel({preventDefault(){}});assert.equal(h.node('session-files-dialog').open,false);
  h.context.activeRepo='/synthetic/repo-b';h.node('usage-import-agent').value='codex';await h.open();releases[0]();await tick();assert.equal(h.checks().length,0);assert.equal(h.context.sessionFilesBusy,'finding');
  releases[1]();await tick();assert.match(h.node('session-files-scope').textContent,/codex.*repo-b/);assert.equal(h.checks().length,1);assert.equal(h.node('session-files-dialog').open,true);
  h.run('closeSessionFiles()');assert.equal(h.node('session-files-dialog').open,false);
});

test('closing discovery and leaving it closed ignores its later reply',async()=>{
  let release;const h=harness({api:async(path,body)=>new Promise(resolve=>{release=()=>resolve(response(body));})});await h.open();h.run('closeSessionFiles()');release();await tick();assert.equal(h.node('session-files-dialog').open,false);assert.equal(h.checks().length,0);assert.equal(h.context.sessionFilesScope,null);
});

test('pending import blocks close, reselection, retry and duplicate submission',async()=>{
  let release;const h=harness({api:async(path,body)=>path==='/api/session-files'?response(body):new Promise(resolve=>{release=resolve;})});await h.open();h.select(0);const pending=h.run('importSessionFiles()');
  assert.equal(h.node('session-files-close').disabled,true);assert.equal(h.node('session-files-cancel').disabled,true);h.run('closeSessionFiles(); openSessionFiles()');h.select(0,false);await h.run('findSessionFiles(); importSessionFiles()');assert.equal(h.calls.length,2);assert.equal(h.context.sessionFileSelection.has(file().path),true);
  assert.equal(h.node('session-files-dialog').open,true);release({});await pending;assert.equal(h.node('session-files-dialog').open,false);assert.equal(h.node('session-files-import').disabled,false);
});
