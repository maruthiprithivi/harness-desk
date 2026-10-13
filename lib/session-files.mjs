import fs from 'node:fs/promises';
import path from 'node:path';
import {forbidden,redact} from './analysis.mjs';

const MAX_ENTRIES=1500,MAX_DEPTH=4,MAX_FILES=30,IMPORT_BYTES=2*1024*1024;
const safe=value=>typeof value==='string'&&!/[\u0000-\u001f\u007f-\u009f]/.test(value)&&!forbidden(value)&&redact(value)===value&&!/redacted/i.test(value);
const newestFirst=(a,b)=>Date.parse(b.modifiedAt)-Date.parse(a.modifiedAt)||(a.label<b.label?-1:a.label>b.label?1:0);

export async function findSessionFiles({home,agent}={}) {
  if(!['claude','codex'].includes(agent))throw new Error('Choose a supported session agent.');
  const result={agent,files:[],rootStatus:'excluded',coverage:{partial:false,issues:[],visited:0,filesFound:0},interpretation:'File metadata only. Working repository unknown until import. Default location only; alternate homes may need manual selection.'};
  function issue(message) {result.coverage.partial=true;if(!result.coverage.issues.includes(message))result.coverage.issues.push(message);}
  if(!safe(home)||!path.isAbsolute(home)) {issue('The default session location is excluded.');return result;}
  const root=path.join(home,agent==='claude'?'.claude':'.codex',agent==='claude'?'projects':'sessions');
  let rootMetadata;
  try {
    let current=path.parse(root).root;
    for(const part of root.slice(current.length).split(path.sep)) {
      current=path.join(current,part);
      const metadata=await fs.lstat(current);
      if(!safe(current)||metadata.isSymbolicLink()||!metadata.isDirectory())throw new Error();
      rootMetadata=metadata;
    }
  }catch(error) {
    result.rootStatus=error.code==='ENOENT'?'missing':'excluded';
    issue(result.rootStatus==='missing'?'The default session location is missing.':'The default session location is excluded or unreadable.');
    return result;
  }
  result.rootStatus='available';
  async function walk(directory,depth,expected) {
    let handle;
    try {
      const current=await fs.lstat(directory);
      if(current.isSymbolicLink()||!current.isDirectory()||current.dev!==expected.dev||current.ino!==expected.ino)throw new Error();
      handle=await fs.opendir(directory,{bufferSize:1});
      const opened=await fs.lstat(directory);
      if(opened.isSymbolicLink()||opened.dev!==current.dev||opened.ino!==current.ino)throw new Error();
      while(true) {
        if(result.coverage.visited>=MAX_ENTRIES) {issue('The entry limit was reached. Results show newest files found within the bounded search.');break;}
        const entry=await handle.read();
        if(!entry)break;
        result.coverage.visited++;
        const file=path.join(directory,entry.name);
        if(!safe(file)) {issue('Some session entries were excluded or unreadable.');continue;}
        let metadata;
        try {metadata=await fs.lstat(file);}catch {issue('Some session entries were excluded or unreadable.');continue;}
        if(metadata.isSymbolicLink()) {issue('Some session entries were excluded or unreadable.');continue;}
        if(metadata.isDirectory()) {
          if(depth>=MAX_DEPTH)issue('The directory depth limit was reached. Results show newest files found within the bounded search.');
          else await walk(file,depth+1,metadata);
        }else if(metadata.isFile()&&['.json','.jsonl'].includes(path.extname(file).toLowerCase())) {
          if(metadata.nlink!==1||!Number.isSafeInteger(metadata.size)||metadata.size<0||!Number.isFinite(metadata.mtimeMs)) {issue('Some session entries were excluded or unreadable.');continue;}
          try {await fs.access(file,fs.constants.R_OK);}catch {issue('Some session entries were excluded or unreadable.');continue;}
          result.coverage.filesFound++;
          result.files.push({path:file,label:path.relative(root,file).split(path.sep).join('/'),bytes:metadata.size,modifiedAt:metadata.mtime.toISOString(),importable:metadata.size<=IMPORT_BYTES});
          result.files.sort(newestFirst);
          if(result.files.length>MAX_FILES) {result.files.pop();issue('The display limit was reached. Results show the 30 newest files found within the bounded search.');}
        }
      }
    }catch {
      if(depth===0) {result.rootStatus='excluded';result.files=[];}
      issue(depth===0?'The default session location is excluded or unreadable.':'Some session entries were excluded or unreadable.');
    }finally {if(handle)await handle.close().catch(()=>issue('Some session entries were excluded or unreadable.'));}
  }
  await walk(root,0,rootMetadata);
  return result;
}
