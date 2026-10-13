import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {publicPath,inspect,inspectEntry,pushTargets} from '../scripts/check-public.mjs';

test('public paths exclude local data even when forced into Git',()=>{
  for(const file of ['data/settings.json','sources/journal.md','.break-free/HANDOFF.md','.env','secrets/runtime.env','.codex/config.toml','public/.env.js','scripts/.env.mjs','public/screenshots/local.png','docs/private.md','lib/../data/chat.json','.github/workflows/private.yml'])assert.equal(publicPath(file),false,file);
  for(const file of ['README.md','AGENTS.md','CHANGELOG.md','SECURITY.md','harness-desk.mjs','docs/runtime.md','docs/configuration.md','docs/workflows.md','docs/privacy.md','docs/releasing.md','.github/workflows/ci.yml','docs/context-measurement-capabilities.md','docs/designs/harness-desk-product-brief.md','server.mjs','lib/store.mjs','public/app.js','scripts/check-public.mjs','test/core.test.mjs','.githooks/pre-push'])assert.equal(publicPath(file),true,file);
});

test('credential and personal-data findings contain no matched values',()=>{
  const key='ghp_'+'a'.repeat(36),home=['','Users','private-person','project'].join('/'),email=['person','private-domain.net'].join('@');
  const findings=inspect('const key="'+key+'";\n'+home+'\n'+email+'\npassword="very-sensitive"');
  assert.ok(findings.some(f=>f.rule==='provider credential'));
  assert.ok(findings.some(f=>f.rule==='personal home path'&&f.line===2));
  assert.ok(findings.some(f=>f.rule==='email address'));
  assert.ok(findings.some(f=>f.rule==='credential assignment'));
  for(const value of [key,home,email,'very-sensitive'])assert.equal(JSON.stringify(findings).includes(value),false);
  assert.ok(inspect(home.slice(0,home.lastIndexOf('/'))).some(f=>f.rule==='personal home path'));
});

test('synthetic exceptions are exact and confined to approved fixture files',()=>{
  const assignment=(key,value)=>key+'="'+value+'"',sample=assignment('token','do-not-copy');
  assert.deepEqual(inspect(sample,'test/agents.test.mjs'),[]);
  assert.equal(inspect(sample,'public/app.js').length,1);
  assert.equal(inspect(assignment('password','hidden'),'public/app.js').length,1);
  assert.equal(inspect(assignment('token','different-sensitive-value'),'test/agents.test.mjs').length,1);
  assert.equal(inspect('api_key="'+('sk-'+'z'.repeat(40))+'"','test/agents.test.mjs').length,2);
});
test('vendored editor paths and upstream copyright contacts have narrow exceptions',()=>{
  const contact=['marijn','haverbeke.berlin'].join('@'),privateContact=['person','private-mail.net'].join('@');
  for(const file of ['public/vendor/editor.js','public/vendor/license/provenance.md']) {
    assert.equal(publicPath(file),true);assert.deepEqual(inspect(contact,file),[]);
    assert.ok(inspect(privateContact,file).some(f=>f.rule==='email address'));
  }
  assert.equal(publicPath('public/vendor/local.js'),false);
  assert.ok(inspect(contact,'public/app.js').some(f=>f.rule==='email address'));
});

test('push protocol retains exact outgoing object IDs including unreferenced objects',()=>{
  const commit='a'.repeat(40),tag='b'.repeat(40),zero='0'.repeat(40);
  assert.deepEqual(pushTargets('HEAD '+commit+' refs/heads/main '+zero+'\n'+tag+' '+tag+' refs/tags/v1 '+zero+'\n(delete) '+zero+' refs/heads/old '+commit+'\n'),[commit,tag]);
  assert.throws(()=>pushTargets('HEAD invalid refs/heads/main '+zero));
});

test('pre-push inspects an outgoing unreferenced commit before reading private blobs',{skip:process.platform==='win32'},async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'public-guard-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const object='a'.repeat(40),blob='b'.repeat(40),marker=path.join(dir,'blob-read');
  const fakeGit=`#!${process.execPath}\nconst a=process.argv.slice(2);if(a[0]==='cat-file'&&a[1]==='-t')console.log('commit');else if(a[0]==='rev-list'){if(a.includes('${object}'))console.log('${object}');}else if(a[0]==='cat-file'&&a[1]==='commit')console.log('author Fixture <fixture@users.noreply.github.com>\\n\\nGeneric change');else if(a[0]==='ls-tree')process.stdout.write('100644 blob ${blob}\\tdata/private.json\\0');else if(a[0]==='for-each-ref'){}else{require('node:fs').writeFileSync(${JSON.stringify(marker)},'unexpected blob read');process.exit(2);}`;
  await fs.writeFile(path.join(dir,'git'),fakeGit,{mode:0o700});
  const script=fileURLToPath(new URL('../scripts/check-public.mjs',import.meta.url));
  const child=spawn(process.execPath,[script,'--push'],{cwd:dir,env:{...process.env,PATH:dir},stdio:['pipe','pipe','pipe']});let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  child.stdin.end('HEAD '+object+' refs/heads/main '+'0'.repeat(40)+'\n');const [code]=await once(child,'close');
  assert.equal(code,1,output);assert.match(output,/private or unsupported path/);await assert.rejects(()=>fs.stat(marker),{code:'ENOENT'});
});

test('source objects reject symlinks, submodules, binary data and oversized files',()=>{
  const fixture=Buffer.from('export const example=true;');
  for(const mode of ['120000','160000'])assert.ok(inspectEntry({file:'lib/example.mjs',mode,content:fixture}).length);
  assert.ok(inspectEntry({file:'lib/example.mjs',content:Buffer.from([0])}).length);
  assert.ok(inspectEntry({file:'lib/example.mjs',content:Buffer.alloc(1024*1024+1,65)}).length);
  const denied=inspectEntry({file:'data/private-person.json',content:fixture});assert.equal(JSON.stringify(denied).includes('private-person'),false);
});

test('commit or tag metadata permits public noreply identities and blocks private addresses',()=>{
  const safe='author Contributor <contributor@users.noreply.github.com>\n\nGeneric source change';
  assert.deepEqual(inspect(safe),[]);
  const privateIdentity=['contributor','personal-mail.net'].join('@');assert.ok(inspect('author Contributor <'+privateIdentity+'>').some(f=>f.rule==='email address'));
});

test('only exact reviewed synthetic screenshots pass the binary publication gate',async()=>{
  for(const name of ['01-start','02-canvas','03-editor','04-compare']){
    const file=`docs/assets/user-guide/${name}.png`;
    const content=await fs.readFile(new URL('../'+file,import.meta.url));
    assert.deepEqual(inspectEntry({file,content}),[]);
    const changed=Buffer.from(content);changed[changed.length-1]^=1;
    assert.ok(inspectEntry({file,content:changed}).some(f=>f.rule.includes('reviewed synthetic')));
    assert.ok(inspectEntry({file,mode:'120000',content}).length);
  }
  assert.equal(publicPath('docs/assets/user-guide/private.png'),false);
  assert.equal(publicPath('media/explainer/output/local.mp4'),false);
});

test('public video publication is confined to exact reviewed assets, including large Git blobs',async()=>{
  for(const file of ['docs/assets/explainer/harness-desk.mp4','docs/assets/explainer/poster.png']){
    const content=await fs.readFile(new URL('../'+file,import.meta.url));
    assert.deepEqual(inspectEntry({file,content}),[]);
    const changed=Buffer.from(content);changed[changed.length-1]^=1;
    assert.ok(inspectEntry({file,content:changed}).some(f=>f.rule==='explainer differs from reviewed synthetic asset'));
    assert.ok(inspectEntry({file,mode:'120000',content}).length);
  }
  for(const file of ['docs/assets/explainer/private.mp4','data/media/harness-desk.mp4','docs/assets/explainer/local.json'])assert.equal(publicPath(file),false);
});
