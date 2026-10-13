import fs from 'node:fs';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
const files=fs.readdirSync('test').filter(name=>/^[a-z0-9][a-z0-9.-]*\.test\.mjs$/.test(name)).sort().map(name=>'test/'+name);
if(!files.length)throw new Error('No tests discovered.');
// Fixtures need canonical paths so macOS temporary-directory aliases do not mimic unsafe sources.
const temporaryDirectory=fs.realpathSync(os.tmpdir());
const result=spawnSync(process.execPath,['--test',...files],{stdio:'inherit',shell:false,env:{...process.env,TMPDIR:temporaryDirectory,TMP:temporaryDirectory,TEMP:temporaryDirectory}});
process.exitCode=result.status??1;
