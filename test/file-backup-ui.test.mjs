import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const editor=source.slice(source.indexOf('function editorValue('),source.indexOf('const contextBreakdownIds ='));
const events=source.split('\n').find(line=>line.startsWith("$('file-fallback').addEventListener('input'"));
const file={id:'synthetic-file',name:'Instructions',path:'/synthetic/project/AGENTS.md',content:'Current content\n',version:'current-digest',editable:true};
const backup=(content='Previous content\n',overrides={})=>({id:file.id,version:file.version,content,backupAt:'2026-10-01T12:00:00.000Z',...overrides});

function harness(syntax=false) {
  const nodes=new Map(),calls=[],releases=[],toasts=[];
  const node=id=>{
    if(!nodes.has(id)) {
      let value='';
      nodes.set(id,{textContent:'',hidden:false,disabled:false,readOnly:false,open:false,listeners:{},classList:{remove(){}},
        get value(){return value;},set value(text){value=id==='file-fallback'?text.replace(/\r\n?/g,'\n'):text;},
        addEventListener(type,fn){this.listeners[type]=fn;},replaceChildren(){},querySelector(){return null;},focus(){},scrollIntoView(){},showModal(){this.open=true;},close(){this.open=false;}});
    }
    return nodes.get(id);
  };
  let widget;
  // Backup cases use the modal editor; the canvas suite exercises actual docking and selection.
  const context=vm.createContext({$:node,openFile:null,codeEditor:null,reviewedContent:null,fileBusy:false,fileWasEdited:false,fileDraftSource:null,fileRequest:0,discardResolution:null,configureFileEditorPresentation:()=>false,updateConfigurationEditorSelection(){},
    document:{querySelector(){return null;}},window:syntax?{HarnessEditor:{createEditor(options){
      let value=options.value.replace(/\r\n?/g,'\n');
      widget={readOnly:options.readOnly,getValue:()=>value,setValue(text){value=text.replace(/\r\n?/g,'\n');options.onChange();},setReadOnly(readOnly){this.readOnly=readOnly;},focus(){},destroy(){},
        input(text){if(this.readOnly)return false;value=text.replace(/\r\n?/g,'\n');options.onChange();return true;}};
      return widget;
    }}}:{},requestAnimationFrame:fn=>fn(),toast:message=>toasts.push(message),refresh:async()=>{},refreshLoading:async()=>{},
    api:(path,body)=>{calls.push({path,body:JSON.parse(JSON.stringify(body))});return new Promise((resolve,reject)=>releases.push({resolve,reject}));}
  });
  vm.runInContext(editor+'\n'+events,context);
  const open=async(overrides={})=>{const pending=context.openEditor(file.id);releases.at(-1).resolve({...file,...overrides});await pending;calls.length=0;releases.length=0;};
  const input=content=>{if(syntax)return widget.input(content);if(node('file-fallback').readOnly)return false;node('file-fallback').value=content;node('file-fallback').listeners.input();return true;};
  return {context,node,calls,releases,toasts,open,input,get widget(){return widget;}};
}

test('the backup control uses the existing compact secondary action and actual click binding',async()=>{
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  assert.match(html,/<button id="file-backup" class="button secondary compact" type="button" disabled>Load latest backup<\/button>/);
  const h=harness();await h.open();const pending=h.node('file-backup').listeners.click();
  assert.deepEqual(h.calls,[{path:'/api/file',body:{action:'backup',id:file.id,version:file.version}}]);
  h.releases[0].resolve(backup());await pending;
});

for(const syntax of [false,true])test(`backup preview in ${syntax?'syntax':'fallback'} editor is a draft until explicit review and save`,async()=>{
  const h=harness(syntax);await h.open();const base=h.context.openFile;
  const pending=h.context.loadFileBackup();h.releases[0].resolve(backup());await pending;
  assert.equal(h.context.openFile,base);assert.equal(base.content,file.content);assert.equal(base.version,file.version);
  assert.equal(h.context.editorValue(),'Previous content\n');assert.equal(h.context.fileWasEdited,true);assert.equal(h.context.reviewedContent,null);
  assert.equal(h.node('file-review').hidden,true);assert.equal(h.node('file-save').disabled,true);assert.equal(h.node('file-backup').disabled,true);
  assert.match(h.node('file-protection').textContent,/Backup from .*source file is unchanged.*Review this draft.*Save reviewed changes/);
  await h.context.saveFile();assert.equal(h.calls.length,1);
  h.context.reviewFile();assert.equal(h.node('file-review-before').textContent,file.content);assert.equal(h.node('file-review-after').textContent,'Previous content\n');assert.equal(h.node('file-save').disabled,false);
  const save=h.context.saveFile();assert.deepEqual(h.calls[1].body,{id:file.id,action:'save',version:file.version,content:'Previous content\n'});
  await h.context.saveFile();assert.equal(h.calls.length,2);
  h.releases[1].resolve({content:'Previous content\n',version:'saved-digest',saved:true,backup:'/synthetic/private-backup'});await save;
  assert.equal(h.context.editorDirty(),false);assert.equal(h.node('file-backup').disabled,false);
  assert.equal(h.node('file-protection').textContent,'Saved with backup. Use Load latest backup to review the previous content.');
});

test('no file, protected files, unsaved drafts, discard prompts and busy files disable and reject previews',async()=>{
  const h=harness();h.context.updateFileEditor();assert.equal(h.node('file-backup').disabled,true);await h.context.loadFileBackup();assert.equal(h.calls.length,0);
  await h.open({editable:false});await h.context.loadFileBackup();assert.equal(h.node('file-backup').disabled,true);assert.equal(h.calls.length,0);
  h.context.openFile.editable=true;h.node('file-fallback').readOnly=false;h.input('Unsaved draft');await h.context.loadFileBackup();assert.equal(h.node('file-backup').disabled,true);assert.equal(h.context.editorValue(),'Unsaved draft');assert.equal(h.calls.length,0);
  h.input(file.content);
  for(const key of ['fileBusy','discardResolution']) {h.context[key]=true;h.context.updateFileEditor();assert.equal(h.node('file-backup').disabled,true);await h.context.loadFileBackup();assert.equal(h.calls.length,0);h.context[key]=false;}
  h.context.updateFileEditor();assert.equal(h.node('file-backup').disabled,false);
});

for(const syntax of [false,true])test(`pending preview freezes ${syntax?'syntax':'fallback'} edits and keeps the current file scope`,async()=>{
  const h=harness(syntax);await h.open();const base=h.context.openFile;
  const pending=h.context.loadFileBackup();assert.equal(h.node('file-fallback').readOnly,true);if(syntax)assert.equal(h.widget.readOnly,true);
  assert.equal(h.input('Impossible pending edit'),false);assert.equal(h.node('file-backup').disabled,true);assert.equal(h.node('file-copy').disabled,true);
  await h.context.loadFileBackup();await h.context.openEditor('other-file');assert.equal(await h.context.closeEditor(),false);h.context.reviewFile();await h.context.saveFile();
  assert.equal(h.calls.length,1);assert.equal(h.context.openFile,base);assert.equal(h.node('file-dialog').open,true);
  h.releases[0].resolve(backup());await pending;assert.equal(h.node('file-fallback').readOnly,false);if(syntax)assert.equal(h.widget.readOnly,false);
});

for(const malformed of [null,backup('',{id:'other-file'}),backup('',{version:'stale-digest'}),backup([],{}),backup(new String('text')),backup('',{backupAt:null}),backup('',{backupAt:'not a date'}),backup('',{backupAt:'1'}),backup('',{backupAt:'2026-02-31T12:00:00.000Z'})])test(`invalid backup response preserves the editor: ${JSON.stringify(malformed)}`,async()=>{
  const h=harness();await h.open();const base=h.context.openFile;h.node('file-protection').textContent='Original protection';
  const pending=h.context.loadFileBackup();h.releases[0].resolve(malformed);await pending;
  assert.equal(h.context.openFile,base);assert.equal(h.context.editorValue(),file.content);assert.equal(base.version,file.version);assert.equal(h.context.fileWasEdited,false);assert.equal(h.context.reviewedContent,null);assert.equal(h.context.fileDraftSource,file.content);
  assert.equal(h.node('file-protection').textContent,'Original protection');assert.equal(h.node('file-error').hidden,false);assert.equal(h.context.fileBusy,false);assert.equal(h.node('file-backup').disabled,false);
});

test('a changed current version cannot validate a preview request captured against the original version',async()=>{
  const h=harness();await h.open();const pending=h.context.loadFileBackup();h.context.openFile.version='newer-digest';
  h.releases[0].resolve(backup('Previous content\n',{version:'newer-digest'}));await pending;
  assert.equal(h.calls[0].body.version,file.version);assert.equal(h.context.editorValue(),file.content);assert.equal(h.context.openFile.version,'newer-digest');assert.equal(h.context.fileDraftSource,file.content);assert.equal(h.node('file-error').hidden,false);
});

test('request failures show a generic error and preserve the file and candidate draft',async()=>{
  const h=harness();await h.open();const base=h.context.openFile;
  const pending=h.context.loadFileBackup();h.releases[0].reject(new Error('Synthetic private transport detail'));await pending;
  assert.equal(h.context.openFile,base);assert.equal(h.context.editorValue(),file.content);assert.equal(h.node('file-error').textContent,'Could not load the backup. Retry, or reload this file before retrying. Your draft and source file are unchanged by this preview.');
  const retry=h.context.loadFileBackup();h.node('file-fallback').value='Newer programmatic draft';h.node('file-fallback').listeners.input();h.releases[1].resolve(backup());await retry;
  assert.equal(h.context.editorValue(),'Newer programmatic draft');assert.equal(h.context.editorDirty(),true);assert.equal(h.context.reviewedContent,null);assert.equal(h.context.openFile,base);
});

for(const message of ['No saved backup was found for this file. Backups are created when you save changes in this utility.','File changed outside the editor. Reload before comparing its backup.'])test(`expected backup error gives a safe next step: ${message}`,async()=>{
  const h=harness();await h.open();const base=h.context.openFile;const pending=h.context.loadFileBackup();h.releases[0].reject(new Error(message));await pending;
  assert.equal(h.node('file-error').textContent,message+' Your draft and source file are unchanged by this preview.');assert.equal(h.node('file-error').hidden,false);
  assert.equal(h.context.openFile,base);assert.equal(h.context.editorValue(),file.content);assert.equal(h.context.openFile.version,file.version);assert.equal(h.context.fileDraftSource,file.content);assert.equal(h.node('file-backup').disabled,false);
});

for(const syntax of [false,true])test(`identical backup contents produce no review or save in ${syntax?'syntax':'fallback'} editor`,async()=>{
  const h=harness(syntax);await h.open();const pending=h.context.loadFileBackup();h.releases[0].resolve(backup(file.content));await pending;
  assert.equal(h.context.fileWasEdited,false);assert.equal(h.context.editorDirty(),false);assert.equal(h.node('file-review-button').disabled,true);assert.equal(h.node('file-save').disabled,true);assert.equal(h.node('file-backup').disabled,false);
  assert.match(h.node('file-protection').textContent,/matches the current content.*no changes to review or save/);h.context.reviewFile();await h.context.saveFile();assert.equal(h.calls.length,1);
});

for(const syntax of [false,true])for(const [current,prior] of [['Current\n','Prior\r\n'],['Current\r\n','Prior\n'],['Same\r\n','Same\r\n'],['Current\n','Mixed\r\nLine\nEnd\r']])test(`${syntax?'syntax':'fallback'} preview retains backup line endings independently of current source`,async()=>{
  const h=harness(syntax);await h.open({content:current});const pending=h.context.loadFileBackup();h.releases[0].resolve(backup(prior));await pending;
  assert.equal(h.context.editorValue(),prior);assert.equal(h.context.openFile.content,current);assert.equal(h.context.openFile.version,file.version);
  if(current===prior) {assert.equal(h.context.editorDirty(),false);return;}
  h.context.reviewFile();assert.equal(h.context.reviewedContent,prior);assert.equal(h.node('file-review-before').textContent,current);
  const save=h.context.saveFile();assert.equal(h.calls[1].body.content,prior);assert.equal(h.calls[1].body.version,file.version);h.releases[1].resolve({content:prior,version:'saved',saved:true});await save;assert.equal(h.context.editorValue(),prior);assert.equal(h.context.editorDirty(),false);
});

for(const syntax of [false,true])test(`actual ${syntax?'syntax onChange':'fallback input'} callback invalidates review after editing a backup draft`,async()=>{
  const h=harness(syntax);await h.open({content:'Current\r\n'});const pending=h.context.loadFileBackup();h.releases[0].resolve(backup('Prior\r\n'));await pending;
  h.context.reviewFile();assert.equal(h.context.reviewedContent,'Prior\r\n');h.input('Edited\n');
  assert.equal(h.context.editorValue(),'Edited\r\n');assert.equal(h.context.reviewedContent,null);assert.equal(h.node('file-review').hidden,true);assert.equal(h.node('file-save').disabled,true);await h.context.saveFile();assert.equal(h.calls.length,1);
});
