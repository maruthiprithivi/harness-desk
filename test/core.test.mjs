import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { Store } from '../lib/store.mjs';
import {redact,mineTranscripts,readJournal,safeText,scopeCandidate,recommendations} from '../lib/analysis.mjs';
import {codexArguments,findExecutable} from '../lib/agents.mjs';
import {parseCsv} from '../lib/import-audit.mjs';
import {createApp} from '../server.mjs';
import {componentReview,reviewKey,assetVersion,scopedDuplicate} from '../lib/components.mjs';
async function temp(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'harness-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}

test('redacts credentials before storage or dispatch',()=>{
 const source='api_key="sk-abcdefghijklmno" password=hidden Bearer abcdefgh ghp_abcdefghijklmno https://'+'user:pass@example.test';
 const result=redact(source);for(const text of ['sk-abcdefghijklmno','hidden','abcdefghijklmno','user:pass'])assert.equal(result.includes(text),false);
});
test('retention archives only manifested old unpinned artifacts and preserves source/settings',async t=>{
 const dir=await temp(t),store=await new Store(path.join(dir,'data')).init();
 await store.write('old.md','old');await store.write('pinned.json',{decision:true},{pinned:true});
 await fs.writeFile(path.join(store.root,'untracked.md'),'untouched');await fs.writeFile(path.join(dir,'source.md'),'source');
 store.manifest['old.md'].updatedAt='2000-01-01T00:00:00Z';store.manifest['pinned.json'].updatedAt='2000-01-01T00:00:00Z';
 const preview=await store.prune(1,true);assert.equal(preview.files.length,1);assert.equal(await fs.readFile(path.join(store.root,'old.md'),'utf8'),'old');
 await store.prune(1,false);assert.equal(await fs.readFile(path.join(dir,'source.md'),'utf8'),'source');assert.equal(await fs.readFile(path.join(store.root,'untracked.md'),'utf8'),'untouched');assert.ok(await store.read('pinned.json'));
 assert.equal((await store.storage()).archiveBytes,3);await assert.rejects(()=>store.prune(2));
});
test('storage and imports reject symlink escapes and traversal',async t=>{
 const dir=await temp(t),store=await new Store(path.join(dir,'data')).init();await fs.mkdir(path.join(dir,'outside'));await fs.symlink(path.join(dir,'outside'),path.join(store.root,'escape'));
 await assert.rejects(()=>store.write('escape/file.md','no'));await assert.rejects(()=>store.write('../source.md','no'));
 const source=path.join(dir,'outside','source.md');await fs.writeFile(source,'fixture');
 await fs.symlink(source,path.join(dir,'source-link.md'));await assert.rejects(()=>safeText(path.join(dir,'source-link.md'),['.md']),/symlinks are excluded/);
 await fs.symlink(path.join(dir,'outside'),path.join(dir,'directory-link'));await assert.rejects(()=>safeText(path.join(dir,'directory-link','source.md'),['.md']),/symlinks are excluded/);
 for(const name of ['auth.json','AUTH.JSON','authentication.toml','auth.yaml','auth.ini','auth.env']){
  await fs.writeFile(path.join(dir,name),'{}');await assert.rejects(()=>safeText(path.join(dir,name),[path.extname(name).toLowerCase()]),/allowed non-secret file/);
 }
 await fs.writeFile(path.join(dir,'auth-guide.md'),'Safe documentation fixture');assert.equal(await safeText(path.join(dir,'auth-guide.md'),['.md']),'Safe documentation fixture');
});
test('repeat proposals require three occurrences across two sessions, ignore single words and redact excerpts',async t=>{
 const dir=await temp(t);const one=path.join(dir,'a.jsonl'),two=path.join(dir,'b.jsonl');
 const record={type:'user',message:{role:'user',content:'Run tests in /some/repo with token=hidden'}};
 await fs.writeFile(one,[record,record,{type:'user',message:{content:'yes'}}].map(JSON.stringify).join('\n'));await fs.writeFile(two,JSON.stringify(record));
 const result=await mineTranscripts([one,two]);assert.equal(result.candidates.length,1);assert.equal(result.candidates[0].occurrences,3);assert.equal(JSON.stringify(result).includes('hidden'),false);
 assert.equal((await mineTranscripts([one])).candidates.length,0);
});
test('journal excerpts remain unassessed and symlinks are skipped',async t=>{
 const dir=await temp(t);await fs.writeFile(path.join(dir,'lesson.md'),'# Lessons\n- Verify before saying done\n');await fs.symlink('/etc/passwd',path.join(dir,'outside.md'));
 const result=await readJournal(dir);assert.equal(result.files,1);assert.equal(result.coverage,null);assert.ok(result.lessons.every(l=>l.status==='not assessed'));
});
test('Codex advisory arguments keep read-only isolation and explicit model',()=>{
 const args=codexArguments('chosen-model','/isolated/job');assert.ok(args.includes('read-only'));assert.ok(args.includes('--ignore-user-config'));assert.ok(args.includes('--ephemeral'));assert.equal(args[args.indexOf('--model')+1],'chosen-model');assert.equal(args.includes('--dangerously-bypass-approvals-and-sandbox'),false);assert.ok(args.includes('shell_tool'));
});
test('Windows npm shim resolves a Node entry without shell execution',async t=>{
 const dir=await temp(t);await fs.writeFile(path.join(dir,'codex.cmd'),'shim');await fs.mkdir(path.join(dir,'node_modules/@openai/codex/bin'),{recursive:true});await fs.writeFile(path.join(dir,'node_modules/@openai/codex/bin/codex.js'),'');
 const found=await findExecutable(['codex'],{PATH:dir},'win32');assert.equal(found.command,process.execPath);assert.match(found.prefix[0],/codex\.js$/);
});
test('CSV importer handles quoted commas, multiline fields and double quotes',()=>{
 const result=parseCsv('name,note\r\na,"line, one\nline ""two"""\r\n');assert.deepEqual(result,[{name:'a',note:'line, one\nline "two"'}]);
});
async function appFixture(t,options={}) {
 const dir=await temp(t),home=path.join(dir,'home');await fs.mkdir(home);
 const app=await createApp({home,dataDir:path.join(dir,'data'),probe:async()=>[{id:'codex',name:'Codex',installed:true,auth:'signed-in',dispatch:'direct'}],...options});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>new Promise(resolve=>app.server.close(resolve)));
 const root='http://127.0.0.1:'+app.server.address().port;const state=await (await fetch(root+'/api/state')).json();
 const post=async(route,body)=>{const response=await fetch(root+route,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':state.csrfToken},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 return {app,root,post,dir};
}
test('HTTP rejects cross-origin/host requests and mutations without CSRF',async t=>{
 const {root}=await appFixture(t);
 assert.equal((await fetch(root+'/api/state',{headers:{Origin:'https://attacker.test'}})).status,400,'Cross-origin request is rejected');
 const hostileHostStatus=await new Promise((resolve,reject)=>{
  const request=http.get(root+'/api/state',{headers:{Host:'attacker.test'}},response=>{response.resume();response.on('end',()=>resolve(response.statusCode));});
  request.on('error',reject);
 });
 assert.equal(hostileHostStatus,400,'The supplied wire Host header is rejected');
 assert.equal((await fetch(root+'/api/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,400,'Mutation without CSRF is rejected');
});
test('multi-turn advisory chat persists and supplies bounded local history',async t=>{
 const sent=[];const {post,app}=await appFixture(t,{dispatch:async request=>{sent.push(request);return 'A scoped recommendation';}});
 await post('/api/probe',{});const first=await post('/api/chat',{agent:'codex',intent:'analysis',prompt:'Explain this setup',sections:['context']});assert.equal(first.body.status,'running');
 async function finished(){for(let i=0;i<100;i++){const chat=(await app.state()).conversations[0];if(chat?.status==='complete')return chat;await new Promise(r=>setTimeout(r,10));}throw new Error('did not complete');}
 let chat=await finished();assert.equal(chat.messages.at(-1).content,'A scoped recommendation');
 await post('/api/chat',{id:chat.id,prompt:'What should I keep globally?'});chat=await finished();assert.equal(sent.length,2);assert.match(sent[1].prompt,/Explain this setup/);assert.match(sent[1].prompt,/A scoped recommendation/);assert.equal(chat.messages.filter(m=>m.role==='user').length,2);
 assert.match(sent[0].cwd,/jobs/);assert.equal(sent[0].cwd, sent[1].cwd);
});
test('unverified agent creates explicit handoff and manual reply resumes it',async t=>{
 const {post}=await appFixture(t);let result=await post('/api/chat',{agent:'claude',prompt:'Suggest a script',intent:'build',sections:['patterns']});assert.equal(result.body.status,'handoff');assert.match(result.body.handoffText,/draft a script or patch/);result=await post('/api/reply',{id:result.body.id,content:'Draft response'});assert.equal(result.body.status,'complete');
});
test('settings validate scopes and persist independent repository routes',async t=>{
 const {post,app,dir}=await appFixture(t);const repos={};repos[path.join(dir,'a')]={analysis:{agent:'codex',model:'cheap'}};repos[path.join(dir,'b')]={analysis:{agent:'claude',model:'other'}};
 assert.equal((await post('/api/settings',{routes:{global:{analysis:{agent:'codex',model:'default'}},repos}})).status,200);assert.equal(Object.keys((await app.state()).settings.routes.repos).length,2);assert.equal((await post('/api/settings',{repos:['../bad']})).status,400);
});

test('pin changes while an agent runs survive completion',async t=>{
 let finish;const {post,app}=await appFixture(t,{dispatch:()=>new Promise(resolve=>{finish=resolve;})});await post('/api/probe',{});
 const response=await post('/api/chat',{agent:'codex',prompt:'Review the scope'});await post('/api/conversation',{id:response.body.id,pinned:true});finish('Finished');
 for(let i=0;i<100;i++){const chat=(await app.state()).conversations[0];if(chat.status==='complete'){assert.equal(chat.pinned,true);return;}await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('completion not observed');
});
test('repository-scoped context excludes unattributed transcript patterns and imported other-repo rows',async t=>{
 const {post,app,dir}=await appFixture(t);
 const audit=path.join(dir,'audit');await fs.mkdir(audit);await fs.writeFile(path.join(audit,'repeated-tasks.csv'),'repo,pattern\n/repo-a,Keep A\n/repo-b,Private B\n');
 await post('/api/import-audit',{path:audit});const result=app.context({repo:'/repo-a',sections:['patterns']});assert.match(result.text,/Keep A/);assert.equal(result.text.includes('Private B'),false);
});

test('global-only previews and conversations exclude repository evidence across turns',async t=>{
 const {post,app,dir}=await appFixture(t);
 const home=path.join(dir,'home'),repo=path.join(dir,'sample');
 await fs.mkdir(path.join(home,'.codex'),{recursive:true});await fs.mkdir(repo);
 await fs.writeFile(path.join(home,'.codex','AGENTS.md'),'Global fixture instructions');await fs.writeFile(path.join(repo,'AGENTS.md'),'Project fixture instructions');
 await post('/api/settings',{repos:[repo]});await post('/api/scan',{});
 await post('/api/observation',{agent:'codex',repo,startupTokens:100,windowTokens:1000,note:'project reading'});
 await post('/api/observation',{agent:'codex',repo:'',startupTokens:50,windowTokens:1000,note:'global reading'});
 await post('/api/gap',{title:'Project fixture gap',evidence:'project evidence',repo});
 await post('/api/gap',{title:'Global fixture gap',evidence:'global evidence'});
 const sections=['inventory','context','gaps'];
 const preview=await post('/api/context',{globalOnly:true,sections});assert.equal(preview.status,200);
 const bundle=JSON.parse(preview.body.text);assert.equal(bundle.scope,'global setup');assert.ok(bundle.inventory.every(item=>!item.repo));
 assert.deepEqual(bundle.context.observations.map(item=>item.note),['global reading']);assert.ok(bundle.gaps.every(item=>!item.repo));
 assert.equal(preview.body.text.includes('project evidence'),false);
 const all=JSON.parse(app.context({sections}).text);assert.ok(all.context.observations.some(item=>item.repo===repo));
 assert.equal((await post('/api/context',{globalOnly:true,repo,sections})).status,400);
 assert.equal((await post('/api/chat',{agent:'claude',globalOnly:'true',prompt:'Invalid scope'})).status,400);
 const first=await post('/api/chat',{agent:'claude',globalOnly:true,sections,prompt:'Explain global fixture evidence'});assert.equal(first.body.status,'handoff');
 await post('/api/reply',{id:first.body.id,content:'Fixture reply'});
 const next=await post('/api/chat',{id:first.body.id,globalOnly:false,repo,prompt:'Continue in the original scope'});
 assert.equal(next.body.globalOnly,true);assert.equal(next.body.repo,'');assert.equal(next.body.handoffText.includes('project evidence'),false);
 assert.equal((await app.store.read('conversations/'+first.body.id+'.json')).globalOnly,true);
});

test('global repeat candidates require evidence attributed to global scope',()=>{
 const candidate={pattern:'fixture task',evidenceByRepo:{'/fixture/project':{occurrences:3,distinctSessions:2}}};
 assert.equal(scopeCandidate(candidate,'',true),null);
 candidate.evidenceByRepo['']={occurrences:3,distinctSessions:2,examples:['global fixture']};
 const scoped=scopeCandidate(candidate,'',true);assert.deepEqual(scoped.repos,['']);assert.equal(scoped.evidenceByRepo,undefined);
});

test('context improvements use latest readings for each agent and scope',()=>{
 const reading=(id,agent,repo,startupTokens,at)=>({id,agent,repo,startupTokens,at,windowTokens:1000});
 const records=[reading('new','codex','/repo-a',100,'2026-01-02'),reading('old','codex','/repo-a',500,'2026-01-01'),reading('other-agent','claude','/repo-a',500,'2026-01-01'),reading('global','codex','',500,'2026-01-01')];
 const result=recommendations({items:[]},records,{globalTokens:2000,repoTokens:8000,contextPercent:15});
 assert.equal(result.length,2);assert.ok(result.some(item=>item.agent==='claude'&&item.repo==='/repo-a'));assert.ok(result.some(item=>item.agent==='codex'&&item.scope==='global'));assert.equal(result.some(item=>item.agent==='codex'&&item.repo==='/repo-a'),false);
});

test('component reviews stay scoped, distinguish manual use, flag drift and survive retention/restart',async t=>{
 const {post,app,dir}=await appFixture(t);
 const home=path.join(dir,'home'),repoA=path.join(dir,'project-a'),repoB=path.join(dir,'project-b');
 for(const [root,folder,name] of [[home,'.codex','global-skill'],[home,'.claude','other-agent'],[repoA,'.codex','repo-a-skill'],[repoB,'.codex','repo-b-skill']]){
  const skill=path.join(root,folder,'skills',name);await fs.mkdir(skill,{recursive:true});await fs.writeFile(path.join(skill,'SKILL.md'),'---\nname: '+name+'\ndescription: Synthetic review task token=hidden\n---\nFixture procedure');
 }
 await fs.writeFile(path.join(repoA,'.mcp.json'),'{"mcpServers":{"fixture":{"env":{"API_KEY":"hidden"}}}}');
 await post('/api/settings',{repos:[repoA,repoB]});await post('/api/scan',{});
 const map=async(repo,agent='codex')=>(await post('/api/loading',{repo,agent})).body.components;
 const initial=await map(repoA);assert.equal(initial.summary.skills,2);assert.equal(initial.summary.used,0);assert.equal(initial.summary.unknown,3);assert.equal(initial.summary.toolConfigs,1);
 assert.equal(JSON.stringify(initial).includes('hidden'),false);assert.equal(initial.items.some(item=>item.name==='other-agent'||item.name==='repo-b-skill'),false);
 assert.ok(initial.items.find(item=>item.type==='skill').description.includes('Synthetic review task'));assert.equal(JSON.stringify(initial).includes('Fixture procedure'),false);
 const skill=initial.items.find(item=>item.name==='global-skill'),other=(await map(repoB)).items.find(item=>item.name==='repo-b-skill');
 const body={id:skill.id,repo:repoA,agent:'codex',version:assetVersion(skill),status:'used',lastUsed:'2020-01-01',note:'Used for a fixture task; token=hidden'};
 for(const patch of [{note:''},{lastUsed:''},{lastUsed:'2999-01-01'},{lastUsed:'2020-02-30'},{status:'unused'},{id:other.id},{agent:'claude'},{repo:path.join(dir,'not-scanned')}])assert.equal((await post('/api/component-review',{...body,...patch})).status,400);
 const legacy=await post('/api/component-review',body);assert.equal(legacy.status,200);assert.equal(legacy.body.helpfulness,'unknown');
 let reviewed=await map(repoA);assert.equal(reviewed.summary.used,1);assert.equal(reviewed.items.find(item=>item.id===skill.id).review.changed,false);assert.equal(JSON.stringify(reviewed).includes('token=hidden'),false);
 assert.equal((await map(repoB)).items.find(item=>item.id===skill.id).review,null);assert.equal((await map('')).items.find(item=>item.id===skill.id).review,null);
 const scoped=JSON.parse(app.context({repo:repoA,reviewAgent:'codex',sections:['inventory'],selectedIds:[skill.id]}).text);assert.equal(scoped.inventory[0].manualReviews.length,1);assert.equal(scoped.inventory[0].manualReviews[0].source,'user supplied component review');
 assert.equal(JSON.parse(app.context({repo:repoB,sections:['inventory'],selectedIds:[skill.id]}).text).inventory[0].manualReviews.length,0);
 assert.equal((await post('/api/component-review',{...body,helpfulness:'helped'})).status,200);
 const before=await fs.stat(skill.path),original=await fs.readFile(skill.path,'utf8');await fs.writeFile(skill.path,original.replace('Fixture procedure','Changed procedure'));await fs.utimes(skill.path,before.atime,before.mtime);assert.equal((await fs.stat(skill.path)).size,before.size);await post('/api/scan',{});
 reviewed=await map(repoA);assert.equal(reviewed.summary.used,0);assert.equal(reviewed.summary.toReview,1);assert.equal(reviewed.items.find(item=>item.id===skill.id).review.changed,true);
 app.store.manifest['component-reviews.json'].updatedAt='2000-01-01T00:00:00Z';await app.store.prune(1,false);assert.ok(await app.store.read('component-reviews.json'));
 const resumed=await createApp({home,dataDir:app.store.root,probe:async()=>[]});
 const restoredReview=JSON.parse(resumed.context({repo:repoA,reviewAgent:'codex',sections:['inventory'],selectedIds:[skill.id]}).text).inventory[0].manualReviews[0];assert.equal(restoredReview.changed,true);assert.equal(restoredReview.helpfulness,'helped');
});

test('component review versions reject stale drafts without changing persisted evidence',async t=>{
 const {post,app,dir}=await appFixture(t),source=path.join(dir,'home','.codex','skills','versioned-task','SKILL.md');
 await fs.mkdir(path.dirname(source),{recursive:true});await fs.writeFile(source,'---\nname: versioned-task\ndescription: Synthetic version task.\n---\nFixture procedure');await post('/api/scan',{});
 const loading=async()=>(await post('/api/loading',{repo:'',agent:'codex'})).body.components.items[0];
 const component=await loading(),body={id:component.id,agent:'codex',repo:'',version:assetVersion(component),status:'review',helpfulness:'mixed',note:'Original fixture evidence'};
 const snapshot=async()=>({reviews:await app.store.read('component-reviews.json'),manifest:await fs.readFile(path.join(app.store.root,'manifest.json'),'utf8'),revision:(await app.state()).componentReviewRevision});
 const empty=await snapshot();
 for(const version of [undefined,null,0,false,{},[],[body.version],'','wrong version']){
  const rejected=await post('/api/component-review',{...body,version});assert.equal(rejected.status,400);assert.match(rejected.body.error,/File evidence changed.*Refresh and review.*note is preserved/);assert.equal(rejected.body.error.includes(body.version),false);assert.deepEqual(await snapshot(),empty);
 }
 const saved=await post('/api/component-review',body);assert.equal(saved.status,200);assert.equal(saved.body.version,body.version);
 const before=await fs.stat(source),original=await fs.readFile(source,'utf8');await fs.writeFile(source,original.replace('Fixture procedure','Changed procedure'));await fs.utimes(source,before.atime,before.mtime);assert.equal((await fs.stat(source)).size,before.size);await post('/api/scan',{});
 const latest=await loading();assert.notEqual(assetVersion(latest),body.version);assert.equal(latest.review.changed,true);
 const preserved=await snapshot(),stale=await post('/api/component-review',{...body,note:'Unsaved revised fixture evidence',helpfulness:'helped'});assert.equal(stale.status,400);assert.deepEqual(await snapshot(),preserved);assert.equal((await loading()).review.note,body.note);assert.equal((await loading()).review.changed,true);
 const accepted=await post('/api/component-review',{...body,version:assetVersion(latest),note:'Reviewed current fixture evidence',helpfulness:'helped'});assert.equal(accepted.status,200);assert.equal(accepted.body.version,assetVersion(latest));assert.equal((await loading()).review.changed,false);assert.equal((await loading()).review.note,'Reviewed current fixture evidence');assert.notEqual((await app.state()).componentReviewRevision,preserved.revision);
});

test('manual helpfulness is validated, scoped and independent of component use counts',async t=>{
 const {post,app,dir}=await appFixture(t),home=path.join(dir,'home'),repoA=path.join(dir,'project-a'),repoB=path.join(dir,'project-b');
 const source=path.join(home,'.agents','skills','shared-task','SKILL.md');await fs.mkdir(path.dirname(source),{recursive:true});await fs.writeFile(source,'---\nname: shared-task\ndescription: Synthetic helpfulness task.\n---\nFixture procedure');
 for(const repo of [repoA,repoB])await fs.mkdir(repo);
 await post('/api/settings',{repos:[repoA,repoB]});await post('/api/scan',{});
 const loading=async(postFn=post,repo=repoA,agent='codex')=>(await postFn('/api/loading',{repo,agent})).body.components;
 const initial=await loading(),id=initial.items[0].id,key=reviewKey(id,'codex',repoA);
 const context=appFn=>JSON.parse(appFn.context({repo:repoA,reviewAgent:'codex',sections:['inventory'],selectedIds:[id]}).text).inventory[0].manualReviews[0];
 const body={id,agent:'codex',repo:repoA,version:assetVersion(initial.items[0]),status:'unknown',note:'Fixture task result token=hidden'};
 for(const status of ['unknown','used','review']){
  let summary;
  for(const helpfulness of ['unknown','helped','not-helped','mixed']){
   const result=await post('/api/component-review',{...body,status,lastUsed:'2020-01-01',helpfulness});assert.equal(result.status,200);assert.equal(result.body.helpfulness,helpfulness);assert.equal(result.body.lastUsed,status==='used'?'2020-01-01':'');assert.equal(result.body.note.includes('hidden'),false);
   const map=await loading();summary??=map.summary;assert.deepEqual(map.summary,summary);assert.equal(map.items[0].review.helpfulness,helpfulness);assert.equal(context(app).helpfulness,helpfulness);
  }
  assert.equal(summary.used,status==='used'?1:0);assert.equal(summary.toReview,status==='review'?1:0);
 }
 const persisted=await app.store.read('component-reviews.json'),manifest=JSON.stringify(app.store.manifest['component-reviews.json']);
 for(const helpfulness of [null,false,0,{},[],['helped'],'',' ','HELPED','not_helped','useful']){
  assert.equal((await post('/api/component-review',{...body,helpfulness})).status,400);assert.deepEqual(await app.store.read('component-reviews.json'),persisted);assert.equal(JSON.stringify(app.store.manifest['component-reviews.json']),manifest);
 }
 for(const helpfulness of ['helped','not-helped','mixed'])for(const note of [undefined,'', ' \n\t']){
  assert.equal((await post('/api/component-review',{...body,helpfulness,note})).status,400);assert.deepEqual(await app.store.read('component-reviews.json'),persisted);
 }
 assert.equal((await post('/api/component-review',{...body,helpfulness:'helped',note:'x'.repeat(2001)})).status,400);assert.deepEqual(await app.store.read('component-reviews.json'),persisted);
 assert.equal((await loading(post,repoB)).items[0].review,null);assert.equal((await loading(post,repoA,'claude')).items[0].review,null);assert.equal((await loading(post,'')).items[0].review,null);
 for(const scope of [{repo:repoB,reviewAgent:'codex'},{repo:repoA,reviewAgent:'claude'},{repo:'',globalOnly:true,reviewAgent:'codex'}])assert.equal(JSON.parse(app.context({...scope,sections:['inventory'],selectedIds:[id]}).text).inventory[0].manualReviews.length,0);
 const cleared=await post('/api/component-review',{...body,helpfulness:'unknown',note:''});assert.equal(cleared.status,200);assert.equal(cleared.body.helpfulness,'unknown');assert.equal(cleared.body.note,'');assert.deepEqual((await loading()).summary,initial.summary);
 await post('/api/component-review',{...body,helpfulness:'mixed'});
 const restarted=await appFixture(t,{home,dataDir:app.store.root});assert.equal((await loading(restarted.post)).items[0].review.helpfulness,'mixed');assert.equal(context(restarted.app).helpfulness,'mixed');assert.equal((await restarted.app.store.read('component-reviews.json'))[key].helpfulness,'mixed');
 const omitted=await restarted.post('/api/component-review',{...body,note:''});assert.equal(omitted.status,200);assert.equal(omitted.body.helpfulness,'unknown');assert.equal(context(restarted.app).helpfulness,'unknown');assert.equal((await restarted.app.store.read('component-reviews.json'))[key].helpfulness,'unknown');
 assert.equal(await fs.readFile(source,'utf8'),'---\nname: shared-task\ndescription: Synthetic helpfulness task.\n---\nFixture procedure');
});

test('legacy and malformed stored helpfulness normalize without widening advisory review fields',async t=>{
 const {post,app,dir}=await appFixture(t),home=path.join(dir,'home'),folder=path.join(home,'.codex','skills','legacy-task');await fs.mkdir(folder,{recursive:true});await fs.writeFile(path.join(folder,'SKILL.md'),'---\nname: legacy-task\ndescription: Synthetic legacy task.\n---\nFixture procedure');await post('/api/scan',{});
 const component=(await post('/api/loading',{repo:'',agent:'codex'})).body.components.items[0],id=component.id,key=reviewKey(id,'codex','');await post('/api/component-review',{id,agent:'codex',repo:'',version:assetVersion(component),status:'unknown'});
 const saved=await app.store.read('component-reviews.json');
 const cases=[...[undefined,'unknown',null,'unexpected',{},['helped'],false].map(helpfulness=>({helpfulness})),...[undefined,null,'',' \n\t',{},42].map(note=>({helpfulness:'helped',note})),{helpfulness:'mixed',note:'Foreign agent fixture evidence',agent:'claude'},{helpfulness:'not-helped',note:'Foreign repository fixture evidence',repo:path.join(dir,'other-repo')}];
 for(const patch of cases){
  const record={...saved[key],...patch,arbitraryEvidence:'Do not include'};if(patch.helpfulness===undefined)delete record.helpfulness;if(patch.note===undefined&&'note' in patch)delete record.note;
  await app.store.write('component-reviews.json',{[key]:record},{kind:'component-review',pinned:true});
  const resumed=await appFixture(t,{home,dataDir:app.store.root});const map=(await resumed.post('/api/loading',{repo:'',agent:'codex'})).body.components;assert.equal(map.items[0].review.helpfulness,'unknown');assert.equal(map.summary.used,0);assert.equal(map.summary.toReview,0);
  const reviews=JSON.parse(resumed.app.context({globalOnly:true,reviewAgent:'codex',sections:['inventory'],selectedIds:[id]}).text).inventory[0].manualReviews;if(record.agent!=='codex'||record.repo!==''){assert.equal(reviews.length,0);continue;}const review=reviews[0];assert.equal(review.helpfulness,'unknown');assert.equal('arbitraryEvidence' in review,false);assert.equal('version' in review,false);
 }
});

test('explicit empty selections and shared reviews preserve subject scope and withhold unrelated duplicate paths',async t=>{
 const {post,app,dir}=await appFixture(t,{probe:async()=>[{id:'codex',auth:'unknown',dispatch:'handoff'}]}),repoA=path.join(dir,'project-a'),repoB=path.join(dir,'project-b');
 for(const repo of [repoB,repoA]){const folder=path.join(repo,'.agents','skills','shared-task');await fs.mkdir(folder,{recursive:true});await fs.writeFile(path.join(folder,'SKILL.md'),'---\nname: shared-task\ndescription: Synthetic shared task.\n---\nFixture procedure');}
 await post('/api/settings',{repos:[repoB,repoA]});await post('/api/scan',{});
 const component=(await post('/api/loading',{repo:repoA,agent:'codex'})).body.components.items.find(item=>item.type==='skill');assert.ok(component);
 assert.equal(JSON.stringify(component).includes(repoB),false);
 assert.equal((await post('/api/component-review',{id:component.id,repo:repoA,agent:'claude',version:assetVersion(component),status:'review',note:'Claude-specific fixture evidence'})).status,200);
 const payload={repo:repoA,sections:['inventory','dashboard'],selectionMode:'explicit',selectedIds:[component.id],reviewAgent:'codex'};
 const codex=JSON.parse(app.context(payload).text);assert.equal(codex.inventory[0].manualReviews.length,0);assert.equal(JSON.stringify(codex).includes(repoB),false);
 const claude=JSON.parse(app.context({...payload,reviewAgent:'claude'}).text);assert.equal(claude.inventory[0].manualReviews.length,1);assert.equal('version' in claude.inventory[0].manualReviews[0],false);
 const empty=JSON.parse(app.context({...payload,selectedIds:[]}).text);assert.equal(empty.inventory.length,0);assert.equal(empty.recommendations.length,0);assert.equal(empty.selection.count,0);
 assert.ok(JSON.parse(app.context({...payload,selectionMode:'all',selectedIds:[]}).text).inventory.length>0);
 for(const patch of [{reviewAgent:'unknown-agent'},{selectionMode:'unknown-mode'}])assert.equal((await post('/api/context',{...payload,...patch})).status,400);
 const chat=await post('/api/chat',{...payload,reviewAgent:'claude',agent:'codex',prompt:'Explain the selected fixture'});assert.equal(chat.status,200);assert.equal(chat.body.reviewAgent,'claude');assert.equal(chat.body.selectionMode,'explicit');assert.ok(chat.body.handoffText.includes('Claude-specific fixture evidence'));
 const next=await post('/api/chat',{id:chat.body.id,reviewAgent:'codex',selectionMode:'all',prompt:'Continue with the original scope'});assert.equal(next.body.reviewAgent,'claude');assert.equal(next.body.selectionMode,'explicit');assert.ok(next.body.handoffText.includes('Claude-specific fixture evidence'));
});

test('component duplicate peers use only scoped full hashes and bound deterministic distinct-path evidence',async t=>{
 const {app,dir}=await appFixture(t),home=path.join(dir,'home'),repo=path.join(dir,'project'),other=path.join(dir,'outside'),contentHash='a'.repeat(64),at='2026-01-01T00:00:00.000Z';
 const row=(id,patch={})=>({id,name:id,path:path.join(repo,id+'.md'),type:'skill',agent:'codex',repo,scope:'repo',bytes:100,modifiedAt:at,contentHash,description:'Scoped description',body:'PRIVATE BODY',review:{note:'PRIVATE REVIEW'},...patch});
 const outside=row('outside-first',{path:path.join(other,'first.md'),repo:other}),a=row('a',{duplicateOf:outside.path}),b=row('b',{agent:'shared',duplicateOf:outside.path}),c=row('c',{agent:'model-gateway'}),d=row('d',{type:'command'}),e=row('e',{contentHash:contentHash.toUpperCase()}),global=row('global',{path:path.join(home,'.agents','global.md'),repo:'',scope:'global',agent:'shared'}),unknown=row('unknown',{contentHash:null}),config=row('config',{type:'mcp-server',path:path.join(repo,'.mcp.json'),contentHash:null});
 const scoped=[a,b,c,d,e,global,unknown,config],inventory={scannedAt:at,coverage:{partial:true},repos:[repo,other],items:[outside,...scoped,row('same-path',{path:a.path}),row('foreign-agent',{agent:'claude'}),row('foreign-global',{path:path.join(home,'.claude','private.md'),repo:'',scope:'global',agent:'claude'}),row('instruction',{type:'instruction'})]};
 const before=structuredClone(inventory);await app.store.write('inventory/current.json',inventory,{kind:'inventory'});
 const resumed=await appFixture(t,{home,dataDir:app.store.root}),map=(await resumed.post('/api/loading',{repo,agent:'codex'})).body.components;
 const expectedKeys=['agent','bytes','contentHash','id','modifiedAt','name','path','repo','scope','type'];
 for(const source of scoped){
  const component=map.items.find(item=>item.id===source.id);assert.equal(component.bytes,source.bytes);assert.equal(component.contentHash,source.contentHash);assert.equal(component.agent,source.agent);
  const evidence=component.duplicates;assert.equal(evidence.scannedAt,at);assert.equal(evidence.scanPartial,true);assert.equal(evidence.eligible,8);assert.equal(evidence.hashed,6);assert.equal(evidence.unhashed,2);
  if(source.contentHash){
   assert.equal(evidence.method,'sha256-full-markdown');assert.equal(evidence.peerCount,5);assert.equal(evidence.shown,3);assert.equal(evidence.omitted,2);
   const expected=scoped.filter(peer=>peer.contentHash&&peer.path!==source.path).sort((x,y)=>x.path.localeCompare(y.path)||x.id.localeCompare(y.id)).slice(0,3);assert.deepEqual(evidence.peers.map(peer=>peer.id),expected.map(peer=>peer.id));
   for(const peer of evidence.peers){assert.deepEqual(Object.keys(peer).sort(),expectedKeys);assert.notEqual(peer.path,source.path);assert.ok(peer.repo===''||peer.repo===repo);assert.ok(['codex','shared','model-gateway'].includes(peer.agent));}
  }else{assert.equal(evidence.method,null);assert.equal(evidence.peerCount,null);assert.equal(evidence.shown,0);assert.equal(evidence.omitted,0);assert.deepEqual(evidence.peers,[]);}
  assert.equal(JSON.stringify(evidence).includes(other),false);assert.equal(JSON.stringify(evidence).includes('PRIVATE'),false);assert.equal(JSON.stringify(evidence).includes('foreign-'),false);
 }
 assert.match(map.items.find(item=>item.id==='a').duplicateOf,/outside this scope/);assert.equal(map.items.find(item=>item.id==='a').duplicates.peerCount,5);
 const globalMap=(await resumed.post('/api/loading',{repo:'',agent:'codex'})).body.components;assert.equal(globalMap.items.length,1);assert.deepEqual(globalMap.items[0].duplicates,{method:'sha256-full-markdown',scannedAt:at,scanPartial:true,eligible:1,hashed:1,unhashed:0,peerCount:0,shown:0,omitted:0,peers:[]});
 const clean=componentReview({inventory:{...inventory,items:scoped},home,repo,agent:'codex'});assert.deepEqual(clean.items.find(item=>item.id==='a').duplicates,map.items.find(item=>item.id==='a').duplicates);
 assert.deepEqual(inventory,before);
});

test('unknown component hashes and malformed coverage never imply zero duplicate peers',async t=>{
 const {app,dir}=await appFixture(t),home=path.join(dir,'home'),repo=path.join(dir,'project');
 const invalid=[undefined,null,'','short','g'.repeat(64),'a'.repeat(63),'a'.repeat(65),{},false,0,['a'.repeat(64)]];
 const items=invalid.map((contentHash,index)=>({id:'unknown-'+index,name:'unknown-'+index,path:path.join(repo,index+'.md'),type:'skill',agent:'codex',repo,scope:'repo',bytes:0,contentHash}));
 await app.store.write('inventory/current.json',{coverage:{partial:'true'},repos:[repo],items},{kind:'inventory'});
 const resumed=await appFixture(t,{home,dataDir:app.store.root}),map=(await resumed.post('/api/loading',{repo,agent:'codex'})).body.components;
 for(const item of map.items)assert.deepEqual(item.duplicates,{method:null,scannedAt:null,scanPartial:null,eligible:11,hashed:0,unhashed:11,peerCount:null,shown:0,omitted:0,peers:[]});
 const valid={...items[0],id:'known',path:path.join(repo,'known.md'),contentHash:'b'.repeat(64)};
 assert.equal(componentReview({inventory:{scannedAt:42,items},home,repo,agent:'codex'}).items[0].duplicates.scannedAt,null);
 for(const partial of [false,true,undefined]){
  const result=componentReview({inventory:{scannedAt:'fixture scan',coverage:{partial},items:[...items,valid]},home,repo,agent:'codex'}).items.find(item=>item.id==='known').duplicates;assert.equal(result.peerCount,0);assert.equal(result.hashed,1);assert.equal(result.unhashed,11);assert.equal(result.scanPartial,partial??null);
 }
});

test('legacy duplicate pointers respect the selected evidence agent without changing unscoped callers',async t=>{
 const {app,dir}=await appFixture(t),home=path.join(dir,'home'),repo=path.join(dir,'project'),contentHash='c'.repeat(64),at='2026-01-01T00:00:00.000Z';
 const row=(id,agent,scopeRepo=repo)=>({id,name:id,path:path.join(scopeRepo||home,id+'.md'),type:'skill',agent,repo:scopeRepo,scope:scopeRepo?'repo':'global',contentHash,bytes:100,modifiedAt:at});
 const targets=[row('foreign-global','claude',''),row('foreign-project','claude'),row('shared-global','shared',''),row('same-agent','codex'),row('gateway','model-gateway')];
 const sources=targets.map((target,index)=>({...row('source-'+index,'codex'),duplicateOf:target.path})),globalSource={...row('global-source','codex',''),duplicateOf:targets[0].path};
 const inventory={scannedAt:at,coverage:{partial:false},repos:[repo],items:[...targets,...sources,globalSource]};await app.store.write('inventory/current.json',inventory,{kind:'inventory'});
 const resumed=await appFixture(t,{home,dataDir:app.store.root}),map=(await resumed.post('/api/loading',{repo,agent:'codex'})).body.components;
 for(const [index,source]of sources.entries()){
  const component=map.items.find(item=>item.id===source.id),expected=index<2?'Matching content outside this scope; path withheld':targets[index].path;assert.equal(component.duplicateOf,expected);
  const payload={repo,reviewAgent:'codex',sections:['inventory','dashboard'],selectionMode:'explicit',selectedIds:[source.id]},context=await resumed.post('/api/context',payload);assert.equal(context.status,200);const bundle=JSON.parse(context.body.text);assert.equal(bundle.inventory[0].duplicateOf,expected);assert.equal(bundle.recommendations.length,1);assert.equal(bundle.recommendations[0].itemId,source.id);assert.equal(bundle.recommendations[0].status,'proposal');assert.equal(bundle.recommendations[0].evidence.includes(targets[index].path),index>=2);
  for(const target of targets.slice(0,2)){assert.equal(JSON.stringify(component).includes(target.path),false);assert.equal(context.body.text.includes(target.path),false);}
  assert.equal(component.duplicates.peerCount,8);assert.ok(component.duplicates.peers.every(peer=>['codex','shared','model-gateway'].includes(peer.agent)));
  assert.equal(scopedDuplicate(inventory,source,repo,false),targets[index].path,'Older callers without an evidence agent retain their existing repository visibility');
 }
 const globalMap=(await resumed.post('/api/loading',{repo:'',agent:'codex'})).body.components,global=globalMap.items.find(item=>item.id===globalSource.id);assert.equal(global.duplicateOf,'Matching content outside this scope; path withheld');assert.equal(global.duplicates.eligible,2);assert.equal(global.duplicates.peerCount,1);assert.deepEqual(global.duplicates.peers.map(peer=>peer.id),['shared-global']);
 const globalContext=await resumed.post('/api/context',{globalOnly:true,reviewAgent:'codex',sections:['inventory','dashboard'],selectionMode:'explicit',selectedIds:[globalSource.id]});assert.equal(globalContext.status,200);assert.equal(globalContext.body.text.includes(targets[0].path),false);assert.equal(JSON.parse(globalContext.body.text).recommendations.length,1);
 const advanced=await resumed.post('/api/context',{repo,sections:['inventory'],selectionMode:'explicit',selectedIds:[sources[0].id]});assert.equal(advanced.status,200);assert.equal(JSON.parse(advanced.body.text).inventory[0].duplicateOf,targets[0].path);
});

test('scanned component duplicate hashes cover complete Markdown including frontmatter and exact bytes',async t=>{
 const {post,app,dir}=await appFixture(t),home=path.join(dir,'home'),repo=path.join(dir,'project'),other=path.join(dir,'a-other'),body='---\nname: identical\ndescription: Synthetic exact duplicate.\n---\nIdentical procedure\n';
 const paths=[];
 for(const [root,name,content]of [[other,'outside',body],[repo,'inside-a',body],[repo,'inside-b',body],[repo,'frontmatter-change',body.replace('name: identical','name: different')],[repo,'byte-change',body.trimEnd()]]){
  const file=path.join(root,'.codex','skills',name,'SKILL.md');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,content);paths.push(file);
 }
 await post('/api/settings',{repos:[other,repo]});await post('/api/scan',{});
 const map=(await post('/api/loading',{repo,agent:'codex'})).body.components,inventory=(await app.state()).inventory;
 const a=map.items.find(item=>item.path===paths[1]),b=map.items.find(item=>item.path===paths[2]);assert.ok(a);assert.ok(b);assert.equal(a.bytes,Buffer.byteLength(body));assert.match(a.contentHash,/^[a-f0-9]{64}$/);assert.equal(a.contentHash,b.contentHash);assert.equal(inventory.items.find(item=>item.id===a.id).duplicateOf,paths[0]);
 assert.deepEqual(a.duplicates.peers.map(item=>item.id),[b.id]);assert.deepEqual(b.duplicates.peers.map(item=>item.id),[a.id]);assert.equal(a.duplicates.eligible,4);assert.equal(a.duplicates.hashed,4);assert.equal(a.duplicates.unhashed,0);assert.equal(a.duplicates.scanPartial,false);assert.equal(a.duplicates.scannedAt,inventory.scannedAt);
 for(const file of paths.slice(3)){const changed=map.items.find(item=>item.path===file);assert.notEqual(changed.contentHash,a.contentHash);assert.equal(changed.duplicates.peerCount,0);assert.deepEqual(changed.duplicates.peers,[]);}
 assert.equal(JSON.stringify(a.duplicates).includes(other),false);assert.equal(JSON.stringify(a.duplicates).includes('Identical procedure'),false);
});

test('timed-out subprocess ignoring termination is forcibly reaped',async()=>{
 const {runProcess}=await import('../lib/agents.mjs');
 await assert.rejects(()=>runProcess({command:process.execPath,prefix:[]},['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],'',{timeout:200}),/timed out/);
});

test('structured secrets are redacted by key without masking numeric usage counters',async()=>{
 const {redactDeep}=await import('../lib/analysis.mjs');
 const result=redactDeep({env:{ANTHROPIC_API_KEY:'hidden',access_token:'hidden2',password:123456},usage:{input_tokens:99,cached_input_tokens:42}});
 assert.equal(result.env.ANTHROPIC_API_KEY,'[REDACTED]');assert.equal(result.env.password,'[REDACTED]');assert.equal(result.usage.input_tokens,99);assert.equal(JSON.stringify(result).includes('hidden'),false);
});

test('scoped repeat evidence excludes other repositories and preserves nested command JSON',async t=>{
 const {post,app,dir}=await appFixture(t);const files=[];
 for(const repo of ['/repo-a','/repo-b'])for(let i=1;i<=2;i++) {
  const file=path.join(dir,path.basename(repo)+'-'+i+'.jsonl');files.push(file);
  const records=[{type:'session_meta',payload:{cwd:repo}}];
  for(let n=0;n<(i===1?2:1);n++)records.push({type:'user',message:{role:'user',content:'Run the checks in '+repo+'/private'}},{type:'response_item',payload:{type:'function_call',name:'shell',arguments:JSON.stringify({cmd:'check '+repo+'/private token=hidden'})}});
  await fs.writeFile(file,records.map(JSON.stringify).join('\n'));
 }
 assert.equal((await post('/api/mine',{paths:files})).status,200);
 const local=JSON.parse(app.context({repo:'/repo-a',sections:['patterns']}).text).patterns;
 assert.equal(local.candidates.length,2);for(const candidate of local.candidates){assert.equal(candidate.occurrences,3);assert.equal(candidate.distinctSessions,2);assert.deepEqual(candidate.repos,['/repo-a']);assert.equal(JSON.stringify(candidate).includes('/repo-b'),false);assert.equal(JSON.stringify(candidate).includes('repo-b-'),false);assert.equal('evidenceByRepo' in candidate,false);}
 assert.ok(local.candidates.some(c=>c.kind==='command'));assert.equal(JSON.stringify(local).includes('hidden'),false);
});

test('conversation mutations require manifested ownership and matching IDs',async t=>{
 const {post,app}=await appFixture(t);const id='11111111-1111-4111-8111-111111111111';
 await fs.mkdir(path.join(app.store.root,'conversations'),{recursive:true});await fs.writeFile(path.join(app.store.root,'conversations',id+'.json'),JSON.stringify({id,messages:[],updatedAt:new Date().toISOString()}));
 assert.equal((await post('/api/conversation',{id,pinned:true})).status,400);
 assert.equal((await post('/api/chat',{id,prompt:'Resume this request'})).status,400);
 await app.store.write('conversations/'+id+'.json',{id:'22222222-2222-4222-8222-222222222222',messages:[]},{kind:'conversation'});
 assert.equal((await post('/api/conversation',{id,pinned:true})).status,400);
});

test('saved recommendation decisions retain their evidence after inventory changes',async t=>{
 const {post,app,dir}=await appFixture(t);const skill=path.join(dir,'home','.claude','skills');
 for(const name of ['one','two']){await fs.mkdir(path.join(skill,name),{recursive:true});await fs.writeFile(path.join(skill,name,'SKILL.md'),'---\nname: shared\ndescription: Verify a fixture\n---\nRead the fixture.\n');}
 await post('/api/scan',{});const recommendation=(await app.state()).recommendations.find(r=>r.confidence==='exact content match');assert.ok(recommendation);
 const result=await post('/api/recommendation',{id:recommendation.id,status:'accepted',note:'Keep canonical copy for a reviewed migration'});assert.equal(result.status,200);assert.equal(result.body.recommendation.evidence,recommendation.evidence);
 await fs.rename(path.join(skill,'two'),path.join(dir,'retired-skill'));await post('/api/scan',{});
 const state=await app.state();assert.equal(state.recommendations.some(r=>r.id===recommendation.id),false);assert.equal(state.recommendationRecords[recommendation.id].recommendation.evidence,recommendation.evidence);
});

test("transcript import reports malformed and non-object records without losing valid repeat evidence",async t=>{
 const dir=await temp(t),one=path.join(dir,"mixed.jsonl"),two=path.join(dir,"valid-envelope.json"),unsupported=path.join(dir,"unsupported-envelope.json");
 const record={type:"user",message:{role:"user",content:"Check the fixture before changing configuration"}};
 await fs.writeFile(one,[JSON.stringify(record),JSON.stringify(record),"malformed-private-content", "{broken-private-content", "null", JSON.stringify("nonobject-private-content"),"7","[]"].join("\n"));
 await fs.writeFile(two,JSON.stringify({turns:[record,null,"nonobject-private-content",8,[]]}));
 await fs.writeFile(unsupported,JSON.stringify({messages:"unsupported-private-content"}));
 const result=await mineTranscripts([one,two,unsupported]);
 assert.equal(result.candidates.length,1);assert.equal(result.candidates[0].occurrences,3);assert.equal(result.candidates[0].distinctSessions,2);
 assert.equal(result.warnings.length,3);
 assert.ok(result.warnings.some(warning=>/2 malformed JSONL record\(s\); 4 non-object record\(s\)/.test(warning)));
 assert.ok(result.warnings.some(warning=>warning.includes("valid-envelope.json")&&warning.includes("4 non-object record(s)")));
 assert.ok(result.warnings.some(warning=>warning.includes("unsupported JSON envelope")));
 for(const marker of ["malformed-private-content","broken-private-content","nonobject-private-content","unsupported-private-content"])assert.equal(JSON.stringify(result).includes(marker),false);
 assert.ok(result.warnings.every(warning=>warning.length<650));
});
