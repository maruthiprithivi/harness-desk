import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
import {cleanupLocal} from '../scripts/cleanup-local.mjs';
import {installHooks} from '../scripts/install-hooks.mjs';
import {releaseFindings} from '../scripts/check-release.mjs';
import {packagePatterns} from '../scripts/check-package.mjs';
import {publicPath} from '../scripts/check-public.mjs';
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'harness-gates-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));execFileSync('git',['init','-q'],{cwd:root});fs.writeFileSync(path.join(root,'.gitignore'),'.verification/\ndata/\n.local-archive/\n');return root;}
test('cleanup previews and archives only disposable artifacts with recoverable provenance',t=>{
 const root=fixture(t);for(const dir of ['.verification','data/qa','data/conversations','sources']){fs.mkdirSync(path.join(root,dir),{recursive:true});fs.writeFileSync(path.join(root,dir,'keep.md'),'synthetic');}
 const preview=cleanupLocal(root);assert.equal(preview.dryRun,true);assert.deepEqual(preview.candidates,['.verification','data/qa']);assert.ok(fs.existsSync(path.join(root,'.verification','keep.md')));
 const applied=cleanupLocal(root,{apply:true});const m=JSON.parse(fs.readFileSync(path.join(root,applied.archive,'manifest.json')));assert.equal(m.entries.every(e=>e.status==='archived'),true);assert.equal(fs.readFileSync(path.join(root,applied.archive,'.verification','keep.md'),'utf8'),'synthetic');assert.ok(fs.existsSync(path.join(root,'data/conversations/keep.md')));assert.ok(fs.existsSync(path.join(root,'sources/keep.md')));assert.deepEqual(cleanupLocal(root,{apply:true}).candidates,[]);
});
test('cleanup refuses tracked content, absent ignores and symlinked roots',t=>{
 const root=fixture(t);fs.mkdirSync(path.join(root,'.verification'));fs.writeFileSync(path.join(root,'.verification','fixture.txt'),'synthetic');execFileSync('git',['add','-f','.verification/fixture.txt'],{cwd:root});assert.throws(()=>cleanupLocal(root,{apply:true}),/tracked/);
 const second=fixture(t);fs.mkdirSync(path.join(second,'.verification'));fs.writeFileSync(path.join(second,'.gitignore'),'');assert.throws(()=>cleanupLocal(second,{apply:true}),/ignored/);
 if(process.platform!=='win32'){const third=fixture(t);fs.mkdirSync(path.join(third,'actual'));fs.symlinkSync('actual',path.join(third,'.verification'));assert.throws(()=>cleanupLocal(third,{apply:true}),/real directories/);}
});
test('release prerequisites stay blocked for the current unpublished package',()=>{
 const issues=releaseFindings({name:'old-name',private:true},'',{committed:false,clean:false});assert.equal(issues.length,8);assert.ok(issues.some(x=>x.includes('LICENSE')));assert.ok(issues.some(x=>x.includes('reviewed source commit')));assert.equal(publicPath('CONTRIBUTING.md'),true);assert.equal(publicPath('.local-archive/recovery.md'),false);
});
test('release metadata accepts only the reviewed runtime files and CLI without install hooks',()=>{
 const pkg={name:'harness-desk',private:false,license:'MIT',bin:{'harness-desk':'harness-desk.mjs'},files:packagePatterns};
 const reviewed={committed:true,clean:true};
 assert.deepEqual(releaseFindings(pkg,'Synthetic license fixture',reviewed),[]);
 for(const files of [['**/*'],[...packagePatterns,'data/'],packagePatterns.slice(1),[...packagePatterns.slice(1),packagePatterns[1]]])assert.match(releaseFindings({...pkg,files},'fixture',reviewed).join(),/allowlist/);
 assert.match(releaseFindings({...pkg,bin:{'harness-desk':'server.mjs'}},'fixture',reviewed).join(),/CLI/);
 for(const field of ['preinstall','install','postinstall'])assert.match(releaseFindings({...pkg,scripts:{[field]:'node fixture.mjs'}},'fixture',reviewed).join(),/installation hooks/);
 assert.match(releaseFindings({...pkg,dependencies:{fixture:'1.0.0'}},'fixture',reviewed).join(),/dependency-free/);
});
test('hook installation preserves prior hooks, replays push input and restores configuration',{skip:process.platform==='win32'},t=>{
 const root=fixture(t),prior=path.join(root,'original hooks');fs.mkdirSync(prior);fs.mkdirSync(path.join(root,'scripts'));
 const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();git(['config','core.hooksPath',prior]);
 fs.writeFileSync(path.join(prior,'pre-commit'),'#!/bin/sh\nprintf old > old-ran\nexit 7\n',{mode:0o700});
 fs.writeFileSync(path.join(prior,'pre-push'),'#!/bin/sh\ncat > prior-input\n',{mode:0o700});fs.writeFileSync(path.join(prior,'post-checkout'),'#!/bin/sh\nprintf kept > post-ran\n',{mode:0o700});
 fs.copyFileSync(new URL('../scripts/run-hook.mjs',import.meta.url),path.join(root,'scripts/run-hook.mjs'));
 fs.writeFileSync(path.join(root,'scripts/check-public.mjs'),"import fs from 'node:fs';let input='';for await(const c of process.stdin)input+=c;fs.writeFileSync('project-input',input);");fs.writeFileSync(path.join(root,'scripts/check-local.mjs'),"import fs from 'node:fs';fs.writeFileSync('local-ran','yes');");
 const result=installHooks(root);assert.equal(result.installed,true);assert.ok(result.hooks.includes('post-checkout'));assert.equal(installHooks(root).installed,true);
 assert.equal(spawnSync('git',['hook','run','pre-commit'],{cwd:root,stdio:'pipe'}).status,7);assert.equal(fs.existsSync(path.join(root,'project-input')),false);assert.equal(fs.readFileSync(path.join(root,'old-ran'),'utf8'),'old');
 const input='HEAD '+'a'.repeat(40)+' refs/heads/main '+'0'.repeat(40)+'\n';const inputFile=path.join(root,'fixture-stdin');fs.writeFileSync(inputFile,input);
 const managed=git(['config','--get','core.hooksPath']);const push=spawnSync(path.join(managed,'pre-push'),['origin','fixture'],{cwd:root,encoding:'utf8',input});assert.equal(push.status,0,push.stderr);assert.equal(fs.readFileSync(path.join(root,'prior-input'),'utf8'),input);assert.equal(fs.readFileSync(path.join(root,'project-input'),'utf8'),input);assert.equal(fs.readFileSync(path.join(root,'local-ran'),'utf8'),'yes');
 git(['hook','run','post-checkout']);assert.equal(fs.readFileSync(path.join(root,'post-ran'),'utf8'),'kept');installHooks(root,{uninstall:true});assert.equal(git(['config','--get','core.hooksPath']),prior);assert.ok(fs.existsSync(path.join(prior,'pre-push')));assert.equal(installHooks(root).installed,true);
});
