import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {archiveEntries,inspectPackage,packagePath} from '../scripts/check-package.mjs';

function tar(file='package/start.mjs',content=Buffer.from('export const fixture=true;'),type='0'){
  const header=Buffer.alloc(512);header.write(file);header.write('0000644\0',100);header.write('0000000\0',108);header.write('0000000\0',116);header.write(content.length.toString(8).padStart(11,'0')+'\0',124);header.write('00000000000\0',136);header.fill(32,148,156);header.write(type,156);header.write('ustar\0',257);
  const checksum=[...header].reduce((a,b)=>a+b,0);header.write(checksum.toString(8).padStart(6,'0')+'\0 ',148);
  return Buffer.concat([header,content,Buffer.alloc((512-content.length%512)%512),Buffer.alloc(1024)]);
}
const hash=buffer=>createHash('sha256').update(buffer).digest('hex');

test('package allowlist excludes reports, media, tests, credential paths and arbitrary assets',()=>{
  for(const file of ['data/settings.json','.env','.npmrc','.break-free/ledger.md','secrets/runtime.env','test/core.test.mjs','docs/assets/explainer/harness-desk.mp4','public/private.json','lib/../data/chat.mjs'])assert.equal(packagePath(file),false,file);
  for(const file of ['harness-desk.mjs','server.mjs','lib/store.mjs','public/vendor/license/provenance.md','LICENSE'])assert.equal(packagePath(file),true,file);
});

test('archive inspection verifies every file against the reviewed source and requires completeness',()=>{
  const content=Buffer.from('export const fixture=true;'),expected=new Map([['start.mjs',hash(content)]]),entries=archiveEntries(gzipSync(tar('package/start.mjs',content)));
  assert.deepEqual(inspectPackage(entries,expected),[]);
  assert.match(inspectPackage([{...entries[0],content:Buffer.from('altered')}],expected).join(),/differs/);
  assert.match(inspectPackage(entries,new Map([...expected,['server.mjs','missing']])).join(),/missing/);
  assert.match(inspectPackage([{...entries[0],file:'data/settings.json'}],expected).join(),/Unexpected/);
  assert.match(inspectPackage([{...entries[0],mode:0o777}],expected).join(),/permissions/);
});

test('tar parser rejects links, traversal, duplicates, corrupt checksums and incomplete archives',()=>{
  for(const type of ['1','2','x','g'])assert.throws(()=>archiveEntries(gzipSync(tar('package/start.mjs',Buffer.alloc(0),type))),/unsupported/);
  for(const name of ['package/../data/chat.json','package/./start.mjs','other/start.mjs','package/lib\\private.mjs'])assert.throws(()=>archiveEntries(gzipSync(tar(name))),/unsafe/);
  const plain=tar();const corrupt=Buffer.from(plain);corrupt[0]^=1;assert.throws(()=>archiveEntries(gzipSync(corrupt)),/checksum/);
  assert.throws(()=>archiveEntries(gzipSync(plain.subarray(0,700))),/incomplete/);
  assert.throws(()=>archiveEntries(gzipSync(Buffer.concat([plain.subarray(0,-1024),plain]))),/duplicate/);
  assert.throws(()=>archiveEntries(gzipSync(Buffer.alloc(1024))),/empty/);
});

test('packaged content receives the privacy scan after hash verification',()=>{
  const content=Buffer.from('const value="'+('ghp_'+'z'.repeat(36))+'";');
  assert.match(inspectPackage([{file:'start.mjs',type:'0',mode:0o644,content}],new Map([['start.mjs',hash(content)]])).join(),/privacy/);
});
