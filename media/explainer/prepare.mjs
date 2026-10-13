import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {chapters} from './src/chapters.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../..');
const work=path.join(root,'.verification/remotion');
await fs.mkdir(path.join(work,'public/audio'),{recursive:true});
await fs.mkdir(path.join(work,'public/screens'),{recursive:true});
await fs.mkdir(path.join(work,'output'),{recursive:true});
for(const file of ['package.json','package-lock.json','render.mjs','finalize.mjs','src'])await fs.cp(path.join(here,file),path.join(work,file),{recursive:true});
for(const file of ['01-start.png','02-canvas.png','03-editor.png','04-compare.png'])await fs.copyFile(path.join(root,'docs/assets/user-guide',file),path.join(work,'public/screens',file));
if(process.argv.includes('--narrate')){
  if(process.platform!=='darwin')throw new Error('--narrate needs macOS say. Supply your own chapter WAV files on other platforms.');
  for(const c of chapters){
    const file=path.join(work,c.id+'.txt');await fs.writeFile(file,c.narration);
    execFileSync('/usr/bin/say',['-v','Samantha','-r','185','-f',file,'-o',path.join(work,'public/audio',c.id+'.aiff')]);
  }
}
await fs.writeFile(path.join(work,'output/transcript.md'),'# Harness Desk explainer\n\nSynthetic demo. Narration is synthesized; measurements are illustrative.\n\n'+chapters.map(c=>`## ${c.label}\n\n${c.narration}`).join('\n\n')+'\n');
console.log('Prepared .verification/remotion. Render output stays private until explicitly shared.');
