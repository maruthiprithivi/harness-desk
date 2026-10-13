import test from 'node:test';
import assert from 'node:assert/strict';
import {captureKiroVerification} from '../lib/kiro-verification.mjs';
import {captureKimiVerification,kimiSession} from '../lib/kimi-verification.mjs';
import {compareContextEvidence} from '../lib/context-evidence.mjs';
import {sessionZipEntries} from '../lib/session-zip.mjs';
const opts={cwd:'/synthetic/project',repo:'/synthetic/project',input:'Fixed task',started:1000,finished:2000,version:'2.24.1'};
const kiro=()=>[{type:'runStarted',data:{payloadSchema:'acp',acpProtocolVersion:1,engine:'v2'}},{type:'metadata',data:{sessionId:'fixture',contextUsagePercentage:10}},{type:'sessionUpdate',data:{sessionId:'fixture',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Ready'}}}},{type:'metadata',data:{sessionId:'fixture',contextUsagePercentage:1.5,meteringUsage:[{value:4,unit:'credit'}]}},{type:'runFinished',data:{sessionId:'fixture',status:'success',stopReason:'end_turn',finalText:'Ready',finalTextTruncated:false}}];
const lines=rows=>rows.map(e=>JSON.stringify(e)).join('\n');
test('Kiro preserves its after-response percentage without inventing token counts or savings',()=>{
 const r=captureKiroVerification(lines(kiro()),opts);assert.equal(r.measurement.inputTokens,null);assert.equal(r.measurement.contextPercentage,1.5);assert.equal(r.measurement.capacity,null);assert.equal(r.toolActivity,false);
 const comparison=compareContextEvidence(r.measurement,{...r.measurement,sessionId:'b'.repeat(64),contextPercentage:1});assert.equal(comparison.comparable,false);assert.equal(comparison.reductionTokens,null);
});
test('Kiro rejects mismatched sessions, failed/truncated responses and invalid readings',()=>{
 for(const mutate of [r=>r[1].data.sessionId='other',r=>r[3].data.contextUsagePercentage=101,r=>r[4].data.finalTextTruncated=true,r=>r[4].data.status='failed',r=>r[0].data.engine='unknown',r=>r.pop()]){const r=kiro();mutate(r);assert.throws(()=>captureKiroVerification(lines(r),opts));}
 const r=kiro();r[2].data.update.sessionUpdate='tool_call';assert.equal(captureKiroVerification(lines(r),opts).toolActivity,true);
});
const id='session_12345678-1234-4234-8234-123456789012';
const kimiOpts={...opts,version:'2.1.1',session:id,answer:'Ready'};
const manifest=()=>({sessionId:id,workspaceDir:opts.cwd,kimiCodeVersion:'2.1.1',wireProtocolVersion:'1.5',sessionFirstActivity:new Date(1000).toISOString()});
const usage=()=>({inputOther:10,inputCacheRead:20,inputCacheCreation:30,output:4});
const wire=()=>[
 {type:'metadata',protocol_version:'1.5'},
 {type:'profile.bind',agentId:'main',environmentDisclosure:{cwd:opts.cwd},modelAlias:'provider/model'},
 {type:'permission.set_mode',agentId:'main',mode:'auto'},
 {type:'turn.prompt',agentId:'main',input:[{type:'text',text:opts.input}],promptId:'prompt',turnId:0},
 {type:'llm.request',agentId:'main',kind:'loop',time:1100,modelAlias:'provider/model'},
 {type:'usage.record',agentId:'main',usageScope:'turn',usage:usage(),model:'provider/model',time:1900},
 {type:'context.append_loop_event',agentId:'main',event:{type:'step.end',finishReason:'end_turn',usage:usage()}},
 {type:'turn.ended',agentId:'main',turnId:0,reason:'completed'},
 {type:'prompt.completed',agentId:'main',promptId:'prompt',reason:'completed',time:2000}
];
test('Kimi stream identity and native journal capture use one request, including cached input once',()=>{
 assert.deepEqual(kimiSession(lines([{role:'meta',type:'system.version',version:'2.1.1'},{role:'assistant',content:'Ready'},{role:'meta',type:'session.resume_hint',session_id:id}])),{session:id,answer:'Ready',version:'2.1.1'});
 const r=captureKimiVerification(manifest(),lines(wire()),kimiOpts);assert.equal(r.measurement.inputTokens,60);assert.equal(r.measurement.outputTokens,4);assert.equal(r.measurement.model,'provider/model');
 const after={...r.measurement,sessionId:'b'.repeat(64),inputTokens:50};assert.equal(compareContextEvidence(r.measurement,after).reductionTokens,10);
});
test('Kimi rejects wrong scope, another session, protocol drift, extra requests and usage mismatch',()=>{
 for(const mutate of [m=>m.sessionId='other',m=>m.workspaceDir='/other',m=>m.wireProtocolVersion='2',m=>m.sessionFirstActivity=new Date(-10000).toISOString()]){const m=manifest();mutate(m);assert.throws(()=>captureKimiVerification(m,lines(wire()),kimiOpts));}
 for(const mutate of [r=>r.push(r[4]),r=>r[3].input[0].text='Other',r=>r[5].usage.inputOther=-1,r=>r[5].agentId='child',r=>r[6].event.usage.output=8,r=>r[6].event.finishReason='tool_use',r=>r.pop(),r=>r.push({type:'compaction.started'})]){const r=wire();mutate(r);assert.throws(()=>captureKimiVerification(manifest(),lines(r),kimiOpts));}
 assert.throws(()=>kimiSession(lines([{role:'tool',content:'Private'}])));
});
function zip(entries){let offset=0;const locals=[],central=[];for(const [name,text] of entries){const n=Buffer.from(name),data=Buffer.from(text);let crc=0xffffffff;for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=crc>>>1^(crc&1?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;const l=Buffer.alloc(30);l.writeUInt32LE(0x04034b50);l.writeUInt32LE(crc,14);l.writeUInt32LE(data.length,18);l.writeUInt32LE(data.length,22);l.writeUInt16LE(n.length,26);locals.push(l,n,data);const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt32LE(crc,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);central.push(c,n);offset+=l.length+n.length+data.length;}const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,directory,end]);}
test('session archive reader only returns requested entries and rejects duplicate, corrupt or excessive data',()=>{
 const data=zip([['manifest.json','{}'],['agents/main/wire.jsonl','synthetic'],['../../ignored','not read']]);assert.deepEqual(sessionZipEntries(data,['manifest.json']),{'manifest.json':'{}'});
 assert.throws(()=>sessionZipEntries(data,['missing']));assert.throws(()=>sessionZipEntries(data,['agents/main/wire.jsonl'],2));assert.throws(()=>sessionZipEntries(zip([['same','one'],['same','two']]),['same']));const damaged=Buffer.from(data);damaged[43]^=1;assert.throws(()=>sessionZipEntries(damaged,['manifest.json']));assert.throws(()=>sessionZipEntries(Buffer.alloc(40),[]));
});
