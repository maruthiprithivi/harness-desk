import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {mineTranscripts} from '../lib/analysis.mjs';

async function logs(t,records){const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'repeated-work-')));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return Promise.all(records.map(async(rows,index)=>{const file=path.join(dir,'claude-'+index+'.jsonl');await fs.writeFile(file,rows.map(row=>JSON.stringify(row)).join('\n'));return file;}));}
const repo=path.resolve('/fixture/project');
const user=text=>({type:'user',cwd:repo,message:{role:'user',content:text}});
const tool=name=>({type:'assistant',message:{role:'assistant',content:[{type:'tool_use',name,input:{}}]}});

test('workflow candidates never join tools from separate user tasks',async t=>{
  const records=[];for(let count=0;count<3;count++)for(const name of ['Read','Test','Report'])records.push(user('Run only this independent '+name+' task'),tool(name));
  const result=await mineTranscripts(await logs(t,[records,records]));
  assert.equal(result.candidates.some(candidate=>candidate.kind==='tool sequence'),false);
});

test('recurring tools within the same requested task produce scoped sequence evidence',async t=>{
  const task=[user('Check the fixture and report its result'),tool('Read'),tool('Test'),tool('Report')];
  const result=await mineTranscripts(await logs(t,[[...task,...task],task]));
  const candidate=result.candidates.find(candidate=>candidate.kind==='tool sequence'&&candidate.pattern==='Read → Test → Report');
  assert.equal(candidate.occurrences,3);assert.equal(candidate.distinctSessions,2);assert.equal(candidate.evidenceByRepo[repo].occurrences,3);
  assert.equal(candidate.status,'candidate');
  assert.equal(result.summary.supportedRecords,12);
  assert.equal(result.summary.unattributedRecords,0);
  assert.equal(result.coverage.partial,false);
});
