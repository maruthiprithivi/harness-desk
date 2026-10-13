import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const files=fs.readdirSync('test').filter(name=>/^[a-z0-9][a-z0-9.-]*\.test\.mjs$/.test(name)).sort().map(name=>'test/'+name);
if(!files.length)throw new Error('No tests discovered.');
const result=spawnSync(process.execPath,['--test',...files],{stdio:'inherit',shell:false});
process.exitCode=result.status??1;
