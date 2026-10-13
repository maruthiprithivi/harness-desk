import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSessionUsage} from '../lib/session-usage.mjs';
import {importUsage,componentCallEvidence} from '../lib/usage-evidence.mjs';

const repo='/fixture/project',other='/fixture/other';
const at='2026-10-07T12:00:00.000Z',now=Date.parse('2026-10-08T12:00:00.000Z');
const rootFile=repo+'/AGENTS.md',skillFile=repo+'/.claude/skills/review/SKILL.md',globalFile='/fixture/agent-root/.claude/CLAUDE.md';
const assets=[{id:'instruction-one',path:rootFile},{id:'skill-one',path:skillFile},{id:'global-one',path:globalFile}];
const read=(id='read-one',file_path=rootFile)=>({type:'tool_use',id,name:'Read',input:{file_path,offset:1,limit:10,extra:'synthetic-private-arguments'}});
const skill=(id='skill-call')=>({type:'tool_use',id,name:'Skill',input:{skill:'review'}});
const mcp=(id='mcp-call')=>({type:'tool_use',id,name:'mcp__fixture__lookup',input:{query:'synthetic-private-arguments'}});
const record=(content,extra={})=>({type:'assistant',sessionId:'synthetic-session-marker',cwd:repo,timestamp:at,message:{content},...extra});
const output=(id='read-one',is_error=false)=>({type:'user',sessionId:'synthetic-session-marker',message:{content:[{type:'tool_result',tool_use_id:id,is_error,content:'synthetic-private-body'}]}});
const parse=(records,extra={})=>parseSessionUsage(JSON.stringify(records),{agent:'claude',format:'json',assets,...extra});
const file=(records,name='session.json')=>({name,content:JSON.stringify(records)});
const run=(records,extra={})=>importUsage({files:[file(records)],agent:'claude',repo,repos:[repo,other],assets,now,...extra});

function aggregatesOnly(result) {
  const serialized=JSON.stringify(result);
  for(const value of [rootFile,skillFile,globalFile,'synthetic-session-marker','synthetic-private-arguments','synthetic-private-body','arbitrary-path-marker','read-one'])assert.equal(serialized.includes(value),false,value);
  assert.ok(result.fileReads.every(item=>Object.keys(item).every(key=>['assetId','requests','resultsSeen','failed','sessions','firstRequest','lastRequest'].includes(key))));
  assert.equal('successes' in result.fileReadTotals,false);
}

test('only known explicit Claude Read targets become ID-attributed metadata events',()=>{
  const result=parse([record([read(),read('arbitrary','/fixture/arbitrary-path-marker.md'),{type:'tool_use',id:'shell',name:'Bash',input:{command:'cat '+rootFile}},{type:'text',text:'Read '+rootFile}]),output()]);
  assert.deepEqual(result.events,[{kind:'file-read',name:'instruction-one',repo,at,callId:'read-one',sessionId:'synthetic-session-marker',resultSeen:true,failed:false}]);
  assert.equal(result.coverage.partial,false);
  for(const value of [rootFile,'arbitrary-path-marker','synthetic-private-arguments','synthetic-private-body'])assert.equal(JSON.stringify(result).includes(value),false);
});

test('malformed, relative, URL, tilde, secret and redacted targets reject generically',()=>{
  const sensitive='sk-'+'x'.repeat(24);
  for(const input of [null,{},'{malformed',{file_path:42},{file_path:'AGENTS.md'},{file_path:'~/AGENTS.md'},{file_path:'https://fixture.invalid/AGENTS.md'},{file_path:'/fixture/secrets/AGENTS.md'},{file_path:'/fixture/'+sensitive+'/AGENTS.md'},{file_path:'/fixture/[REDACTED]/AGENTS.md'},{file_path:rootFile+'\u0000'}]) {
    const result=parse([record([{...read(),input}])]);
    assert.deepEqual(result.events,[]);assert.equal(result.coverage.partial,true);
    assert.equal(JSON.stringify(result).includes(sensitive),false);
    assert.equal(JSON.stringify(result).includes(rootFile),false);
  }
  for(const extra of [{id:sensitive},{sessionId:'[REDACTED]'},{timestamp:'invalid-time'},{cwd:null}]) {
    const entry={...read(),...(Object.hasOwn(extra,'id')?{id:extra.id}:{})};
    const result=parse([record([entry],extra)]);assert.deepEqual(result.events,[]);assert.equal(result.coverage.partial,true);
  }
});

test('supplied target validation rejects ambiguity and bounds inventory work',()=>{
  const duplicate={id:'instruction-two',path:rootFile};
  for(const supplied of [[...assets,duplicate],[duplicate,...assets]]) {
    const result=parse([record([read(),read('skill-read',skillFile)])],{assets:supplied});
    assert.deepEqual(result.events.map(event=>event.name),['skill-one']);assert.equal(result.coverage.partial,true);
    assert.equal(JSON.stringify(result).includes(rootFile),false);
  }
  for(const supplied of [null,{},[{id:'[REDACTED]',path:rootFile}],[{id:'one',path:'/fixture/credentials/AGENTS.md'}],[{id:'one',path:'relative/AGENTS.md'}],Array.from({length:20001},()=>assets[0])]) {
    const result=parse([record([read()])],{assets:supplied});assert.deepEqual(result.events,[]);assert.equal(result.coverage.partial,true);
  }
});

test('target matching is lexical and POSIX case-sensitive with no filesystem reads',()=>{
  assert.equal(parse([record([read('normalized',repo+'/src/../AGENTS.md')])]).events[0].name,'instruction-one');
  const changed=parse([record([read('wrong-case',repo+'/agents.md')])]);
  assert.deepEqual(changed.events,[]);assert.equal(changed.coverage.partial,false);
  assert.equal(parse([record([read()])],{assets:[{id:'one',path:rootFile},{id:'one',path:rootFile}]}).events.length,1);
});

test('Windows drive and UNC targets match case-insensitively across separators',()=>{
  const supplied=[{id:'drive',path:'C:\\Fixture\\Project\\AGENTS.md'},{id:'share',path:'\\\\fixture-host\\share\\Project\\CLAUDE.md'}];
  const result=parse([record([read('drive-read','c:/FIXTURE/project/AGENTS.md'),read('share-read','//FIXTURE-HOST/SHARE/project/claude.md')])],{assets:supplied});
  assert.deepEqual(result.events.map(event=>event.name),['drive','share']);assert.equal(result.coverage.partial,false);
  const ambiguous=parse([record([read('one','c:/fixture/project/AGENTS.md')])],{assets:[...supplied,{id:'drive-copy',path:'c:/fixture/project/agents.md'}]});
  assert.deepEqual(ambiguous.events,[]);assert.equal(ambiguous.coverage.partial,true);
  for(const target of ['C:AGENTS.md','\\Fixture\\Project\\AGENTS.md'])assert.deepEqual(parse([record([read('one',target)])],{assets:supplied}).events,[]);
});

test('read requests and result flags aggregate separately from Skill and MCP calls',async()=>{
  const result=await run([record([read(),read('missing',rootFile),read('failed',skillFile),skill(),mcp()]),output(),output('failed',true),output('skill-call')]);
  assert.deepEqual(result.totals,{calls:2,resultsSeen:1,failed:0});
  assert.ok(result.items.every(item=>['skill','mcp'].includes(item.kind)));
  assert.deepEqual(result.fileReadTotals,{requests:3,resultsSeen:2,failed:1});
  assert.deepEqual(result.fileReads,[{assetId:'instruction-one',requests:2,resultsSeen:1,failed:0,sessions:1,firstRequest:at,lastRequest:at},{assetId:'skill-one',requests:1,resultsSeen:1,failed:1,sessions:1,firstRequest:at,lastRequest:at}]);
  assert.equal(result.fileReadCoverage.supported,true);
  assert.match(result.fileReadCoverage.interpretation,/explicit.*requests/i);
  assert.match(result.fileReadCoverage.interpretation,/bytes.*ranges.*body version.*eager loading.*unknown/i);
  assert.match(result.fileReadCoverage.interpretation,/not proof of usefulness or success/i);
  aggregatesOnly(result);
});

test('missing or malformed result flags establish no successful read',async()=>{
  const missing=await run([record([read()])]);assert.deepEqual(missing.fileReadTotals,{requests:1,resultsSeen:0,failed:0});
  const malformed=await run([record([read()]),output('read-one','unsupported')]);
  assert.deepEqual(malformed.fileReadTotals,{requests:1,resultsSeen:1,failed:0});assert.equal(malformed.coverage.partial,true);
  aggregatesOnly(missing);aggregatesOnly(malformed);
});

test('duplicate exports dedupe read requests and combine explicit failure flags',async()=>{
  const first=record([read()]);
  const files=[file([first]),file([first,output('read-one',true)],'copy.json'),file([record([read()],{sessionId:'second-session'})],'second.json')];
  const result=await run([],{files});
  assert.deepEqual(result.fileReadTotals,{requests:2,resultsSeen:1,failed:1});assert.equal(result.fileReads[0].sessions,2);
  assert.deepEqual(await run([],{files:[...files,file([first,output()],'third.json')]}),{...result,files:{...result.files,selected:4,read:4},coverage:{...result.coverage,records:result.coverage.records+2}});
  aggregatesOnly(result);
});

test('different kinds with one call identity conflict within and across exports',async()=>{
  for(const conflicting of [skill('read-one'),mcp('read-one'),read('read-one',skillFile)]) {
    for(const entries of [[read(),conflicting],[conflicting,read()]]) {
      const parsed=parse([record(entries)]);assert.deepEqual(parsed.events,[]);assert.equal(parsed.coverage.partial,true);
      const result=await run([],{files:entries.map((entry,index)=>file([record([entry])],'part-'+index+'.json'))});
      assert.equal(result.fileReadTotals.requests,0);assert.equal(result.totals.calls,0);assert.equal(result.coverage.partial,true);aggregatesOnly(result);
    }
  }
});

test('an unmatched Read identity cannot revive matched file or skill evidence',async()=>{
  const unmatched=read('read-one','/fixture/arbitrary-path-marker.md');
  for(const known of [read(),skill('read-one')])for(const entries of [[known,unmatched],[unmatched,known]]) {
    const parsed=parse([record(entries)]);assert.deepEqual(parsed.events,[]);assert.equal(parsed.coverage.partial,true);
    const result=await run([],{files:[...entries,known].map((entry,index)=>file([record([entry])],'part-'+index+'.json'))});
    assert.equal(result.fileReadTotals.requests,0);assert.equal(result.totals.calls,0);assert.equal(result.coverage.partial,true);aggregatesOnly(result);
  }
  const ordinary=await run([record([unmatched])]);assert.equal(ordinary.coverage.partial,false);assert.deepEqual(ordinary.fileReads,[]);
});

test('read counts use exact working scope and inclusive request dates without global borrowing',async()=>{
  const records=[record([read('repo-global',globalFile)]),record([read('global',globalFile)],{cwd:''}),record([read('other',rootFile)],{cwd:other}),record([read('old',rootFile)],{timestamp:'2026-10-07T11:59:59.999Z'}),record([read('now',rootFile)],{timestamp:new Date(now).toISOString()}),record([read('future',rootFile)],{timestamp:'2026-10-08T12:00:00.001Z'})];
  const scoped=await run(records,{days:1});assert.equal(scoped.fileReadTotals.requests,2);assert.equal(scoped.coverage.excludedOtherScope,2);assert.equal(scoped.coverage.excludedOutsideWindow,2);
  assert.equal(scoped.fileReads.find(item=>item.assetId==='global-one').requests,1);
  assert.equal(scoped.window.observedFrom,at);assert.equal(scoped.window.observedTo,new Date(now).toISOString());
  const global=await run(records,{repo:'',days:'all'});assert.equal(global.fileReadTotals.requests,1);assert.equal(global.fileReads[0].assetId,'global-one');
  const unknown=await run([record([read()],{cwd:'/fixture/unscanned'})]);assert.deepEqual(unknown.fileReads,[]);assert.equal(unknown.coverage.partial,true);
  const nearest=await run([record([read()],{cwd:repo+'/nested/src'})],{repos:[repo,repo+'/nested']});assert.deepEqual(nearest.fileReads,[]);assert.equal(nearest.coverage.excludedOtherScope,1);
  aggregatesOnly(scoped);aggregatesOnly(global);aggregatesOnly(unknown);
});

test('legacy parsers and snapshots retain existing Skill/MCP evidence without read support',async()=>{
  const records=[record([skill(),mcp(),read()])];
  assert.deepEqual(parse(records,{assets:[]}),parseSessionUsage(JSON.stringify(records),{agent:'claude',format:'json'}));
  assert.deepEqual(parse(records,{assets:[]}).events.map(event=>event.kind),['skill','mcp']);
  const codex=await run([{type:'session_meta',payload:{id:'session',cwd:repo}},{type:'response_item',timestamp:at,payload:{type:'function_call',call_id:'read',name:'Read',arguments:JSON.stringify({file_path:rootFile})}}],{agent:'codex'});
  assert.equal(codex.fileReadCoverage.supported,false);assert.deepEqual(codex.fileReads,[]);assert.equal(codex.totals.calls,0);
  const item={id:'skill-one',type:'skill',name:'review'},legacy={items:[{kind:'skill',name:'review',calls:1}]};
  assert.deepEqual(componentCallEvidence(item,[item],legacy),{matches:legacy.items,attribution:'skill name matches one discovered file; body version unverified',ambiguous:false});
  assert.equal(componentCallEvidence({id:'instruction-one',type:'instruction'},[],legacy),null);
});

test('component evidence preserves ambiguous Skill names while file reads select exact IDs',async()=>{
  const second={id:'skill-two',path:repo+'/.claude/skills/copy/SKILL.md'};
  const usage=await run([record([skill(),read('one',skillFile),read('two',second.path),read('instruction',rootFile)])],{assets:[...assets,second]});
  const firstItem={id:'skill-one',type:'skill',name:'review'},secondItem={id:'skill-two',type:'skill',name:'review'},items=[firstItem,secondItem];
  for(const item of items) {
    const evidence=componentCallEvidence(item,items,usage);assert.equal(evidence.ambiguous,true);assert.equal(evidence.matches[0].kind,'skill');assert.deepEqual(evidence.reads.map(read=>read.assetId),[item.id]);assert.match(evidence.readAttribution,/body version.*unknown/i);
  }
  const instruction=componentCallEvidence({id:'instruction-one',type:'instruction'},[],usage);assert.deepEqual(instruction.matches,[]);assert.equal(instruction.reads[0].requests,1);
  assert.equal(componentCallEvidence({id:'absent',type:'instruction'},[],usage),null);
  assert.equal(componentCallEvidence({id:'absent',type:'config'},[],usage),null);
  assert.deepEqual(componentCallEvidence({id:'absent',type:'skill',name:'unused'},[],usage).reads,[]);
  const inspected=componentCallEvidence({id:'instruction-one',type:'config',toolInspection:{servers:[{name:'fixture'}]}},[],usage);assert.deepEqual(inspected.matches,[]);assert.equal(inspected.reads[0].requests,1);assert.equal(inspected.ambiguous,true);
  aggregatesOnly(usage);
});
