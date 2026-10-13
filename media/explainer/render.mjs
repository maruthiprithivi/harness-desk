import {bundle} from '@remotion/bundler';
import {selectComposition, renderMedia, renderStill} from '@remotion/renderer';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {chapters} from './src/chapters.mjs';
for(const chapter of chapters){
  const duration=Number(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',`public/audio/${chapter.id}.wav`],{encoding:'utf8'}));
  if(!Number.isFinite(duration)||duration<=0||duration>chapter.seconds-0.3)throw new Error(`Narration missing, empty or too long: ${chapter.id}`);
}
const serveUrl=await bundle({entryPoint:'src/index.tsx'});
const browserExecutable=process.env.REMOTION_BROWSER_EXECUTABLE;
const options={serveUrl,browserExecutable,chromiumOptions:{disableWebSecurity:false}};
const composition=await selectComposition({...options,id:'HarnessDesk'});
await fs.mkdir('output',{recursive:true});
let offset=0;
for(const chapter of chapters){await renderStill({...options,composition,output:`output/${chapter.id}.png`,frame:offset+90});offset+=chapter.seconds*30;}
if(!process.argv.includes('--stills'))await renderMedia({...options,composition,codec:'h264',crf:18,concurrency:2,outputLocation:'output/harness-desk-explainer.mp4',onProgress:({progress})=>{const p=Math.floor(progress*100);if(p%10===0&&p!==globalThis.lastProgress){globalThis.lastProgress=p;console.log(`Rendering ${p}%`);}}});
