import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {chapters} from './src/chapters.mjs';
const stamp=s=>new Date(Math.round(s*1000)).toISOString().slice(11,23);
const assStamp=s=>stamp(s).slice(1,-1);
const escapeAss=s=>s.replaceAll('\\','\\\\').replaceAll('{','\\{').replaceAll('}','\\}');
function wrap(text){
  if(text.length<=60)return text;
  const words=text.split(' ');let best;
  for(let i=1;i<words.length;i++){
    const a=words.slice(0,i).join(' '),b=words.slice(i).join(' ');
    if(a.length<=60&&b.length<=60&&(!best||Math.abs(a.length-b.length)<best.balance))best={text:a+'\n'+b,balance:Math.abs(a.length-b.length)};
  }
  if(!best)throw new Error('Caption cannot fit in two lines: shorten this cue');
  return best.text;
}
let offset=0,index=1,srt='',vtt='WEBVTT\n\n';const cues=[];
for(const c of chapters){
  const duration=Number(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',`public/audio/${c.id}.wav`],{encoding:'utf8'}));
  if(!Number.isFinite(duration)||duration<=0||duration>c.seconds)throw new Error('Invalid narration timing');
  const words=c.narration.split(/\s+/),count=Math.ceil(words.length/12);
  // Balanced groups avoid a one-word caption flashing at the end of a chapter.
  for(let group=0;group<count;group++){
    const i=Math.round(group*words.length/count),j=Math.round((group+1)*words.length/count);
    const start=offset+duration*i/words.length,end=offset+duration*j/words.length,text=wrap(words.slice(i,j).join(' '));
    if(end-start<1)throw new Error('Caption is too brief to read');
    cues.push({chapter:c.id,start,end,text});
    srt+=`${index++}\n${stamp(start).replace('.',',')} --> ${stamp(end).replace('.',',')}\n${text}\n\n`;
    vtt+=`${stamp(start)} --> ${stamp(end)}\n${text}\n\n`;
  }
  offset+=c.seconds;
}
// Visuals occupy y=0..899; the final 180 pixels belong exclusively to captions.
// Fixed line length, font and margins keep both lines inside that reserved band.
const ass=`[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 2\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Liberation Sans,42,&H00FFFFFF,&H00FFFFFF,&H00301F10,&H00301F10,0,0,0,0,100,100,0,0,1,1,0,2,180,180,46,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`+cues.map(c=>`Dialogue: 0,${assStamp(c.start)},${assStamp(c.end)},Default,,0,0,0,,${c.text.split('\n').map(escapeAss).join('\\N')}`).join('\n')+'\n';
await fs.writeFile('output/captions.srt',srt);await fs.writeFile('output/captions.vtt',vtt);await fs.writeFile('output/captions.ass',ass);
await fs.writeFile('output/caption-layout.json',JSON.stringify({content:{x:160,y:0,width:1600,height:900},captionBand:{y:900,height:180},maxLines:2,maxCharactersPerLine:60,fontSize:42,cues},null,2));
execFileSync('ffmpeg',['-y','-v','error','-i','output/harness-desk-explainer.mp4','-map','0:v','-map','0:a','-vf','scale=1600:900,pad=1920:1080:160:0:color=0x101f30,subtitles=output/captions.ass','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-c:a','copy','-movflags','+faststart','output/harness-desk.mp4']);
await fs.mkdir('output/caption-proofs',{recursive:true});
for(const c of cues)execFileSync('ffmpeg',['-y','-v','error','-ss',String((c.start+c.end)/2),'-i','output/harness-desk.mp4','-frames:v','1',`output/caption-proofs/${String(cues.indexOf(c)+1).padStart(2,'0')}.png`]);
const bounds=[];
for(let i=0;i<cues.length;i++){
const bytes=execFileSync('ffmpeg',['-v','error','-i',`output/caption-proofs/${String(i+1).padStart(2,'0')}.png`,'-vf','crop=1920:180:0:900','-pix_fmt','rgb24','-f','rawvideo','-'],{maxBuffer:2*1024*1024});
let minX=1920,maxX=-1,minY=180,maxY=-1;
for(let y=0;y<180;y++)for(let x=0;x<1920;x++){const at=(y*1920+x)*3;if(bytes[at]>200&&bytes[at+1]>200&&bytes[at+2]>200){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}}
if(maxX<0||minX<180||maxX>1740||minY<20||maxY>160)throw new Error(`Caption ${i+1} outside safe bounds: ${[minX,maxX,minY,maxY]}`);
bounds.push({cue:i+1,minX,maxX,minY:minY+900,maxY:maxY+900});
}
await fs.writeFile('output/caption-bounds-check.json',JSON.stringify({passed:true,cues:bounds},null,2));
console.log(`Final MP4: ${cues.length} captions in a reserved band, maximum two lines. No native subtitle track can duplicate them.`);
