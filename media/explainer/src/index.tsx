import React from 'react';
import {registerRoot, Composition, AbsoluteFill, Sequence, Audio, Img, staticFile, useCurrentFrame, interpolate, spring} from 'remotion';
import {chapters} from './chapters.mjs';

const C={bg:'#101f30',ink:'#f5f8fb',muted:'#abbecd',teal:'#77decb',line:'#33465a',amber:'#f5bf79'};
const FPS=30;
export const duration=chapters.reduce((n,c)=>n+c.seconds*FPS,0);
const Reveal:React.FC<{children:React.ReactNode;delay?:number;style?:React.CSSProperties}>=({children,delay=0,style})=>{
  const f=useCurrentFrame(); const p=spring({frame:f-delay,fps:FPS,config:{damping:200}});
  return <div style={{opacity:p,transform:`translateY(${(1-p)*24}px)`,...style}}>{children}</div>;
};
const Diagram:React.FC=()=>{
  return <div style={{display:'flex',alignItems:'center',gap:24,marginTop:80}}>{['Global guidance','Project instructions','Your agent session'].map((t,i)=><React.Fragment key={t}>{i>0&&<div style={{fontSize:48,color:C.teal}}>→</div>}<Reveal delay={i*12} style={{borderTop:`3px solid ${C.teal}`,padding:'30px 22px',width:410,background:'#172b3e'}}><div style={{color:C.teal,fontSize:22,marginBottom:16}}>0{i+1}</div><div style={{fontSize:32}}>{t}</div></Reveal></React.Fragment>)}</div>;
};
const Evidence:React.FC=()=> <div style={{display:'flex',gap:70,marginTop:66}}>{[['01','Same task','Keep the project, model and prompt comparable.'],['02','Observed input','Use agent-reported counters when available.'],['03','Useful result','Check behavior separately from token savings.']].map(([n,t,d])=><Reveal key={n} delay={Number(n)*10} style={{width:490,borderTop:`2px solid ${C.line}`,paddingTop:30}}><div style={{fontSize:22,color:C.teal}}>{n}</div><div style={{fontSize:38,margin:'16px 0'}}>{t}</div><div style={{fontSize:28,lineHeight:1.5,color:C.muted}}>{d}</div></Reveal>)}</div>;
const Support:React.FC=()=> <div style={{marginTop:48,display:'grid',gridTemplateColumns:'1fr 1fr',gap:'24px 80px',maxWidth:1570}}>{[
  ['Live macOS checks','Codex · OpenCode · Oh My Pi · Kimi'],
  ['Live verification gaps','Claude Code: quota-blocked · Pi: fixture-tested'],
  ['Different measurement','Kiro: context % after response'],
  ['Discovery only','Orca: manual handoff']
].map(([a,b],i)=><Reveal key={a} delay={i*8} style={{borderTop:`1px solid ${C.line}`,paddingTop:22}}><div style={{fontSize:22,color:C.teal,marginBottom:12}}>{a}</div><div style={{fontSize:30,lineHeight:1.4}}>{b}</div></Reveal>)}</div>;
const Scene:React.FC<{chapter:typeof chapters[number];index:number}>=({chapter:c,index})=>{
  const f=useCurrentFrame(); const fade=interpolate(f,[0,10,c.seconds*FPS-10,c.seconds*FPS],[0,1,1,0],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
  return <AbsoluteFill style={{opacity:fade,padding:'108px 104px 130px'}}>
    <Audio src={staticFile(`audio/${c.id}.wav`)}/>
    <div style={{display:'flex',gap:50,alignItems:'center',height:'100%'}}>
      <div style={{width:c.image?510:'100%',flexShrink:0}}>
        <Reveal><div style={{color:C.teal,fontSize:22,fontWeight:700,letterSpacing:3,marginBottom:28}}>{c.label}</div></Reveal>
        <Reveal delay={5}><h1 style={{fontSize:c.image?66:92,lineHeight:1.08,letterSpacing:-3,whiteSpace:'pre-line',margin:0,fontWeight:700}}>{c.title}</h1></Reveal>
        {c.image&&<Reveal delay={12}><p style={{color:C.muted,fontSize:29,lineHeight:1.5,marginTop:32}}>{c.caption}</p></Reveal>}
        {(c.id==='intro'||c.id==='outro')&&<Diagram/>}
        {c.id==='meaning'&&<Evidence/>}
        {c.id==='support'&&<Support/>}
      </div>
      {c.image&&<Reveal delay={10} style={{flex:1,boxShadow:'0 25px 65px #0007',borderRadius:12,overflow:'hidden',border:`1px solid ${C.line}`}}><Img src={staticFile(`screens/${c.image}`)} style={{width:'100%',display:'block'}}/></Reveal>}
    </div>
    <div style={{position:'absolute',bottom:42,left:104,right:104,display:'flex',justifyContent:'space-between',fontSize:22,color:C.muted}}><span>{c.image?'SYNTHETIC DEMO · No real configurations or measured savings':c.caption}</span><span>{String(index+1).padStart(2,'0')} / 08</span></div>
  </AbsoluteFill>;
};
const Film:React.FC=()=>{
  const f=useCurrentFrame();let at=0;
  return <AbsoluteFill style={{background:C.bg,color:C.ink,fontFamily:'Liberation Sans, Arial, sans-serif'}}>
    <div style={{position:'absolute',top:38,left:104,right:104,display:'flex',justifyContent:'space-between',fontSize:22,color:C.muted}}><span style={{color:C.teal,fontWeight:700}}>h / Harness desk</span><span>LOCAL AGENT WORKSPACE</span></div>
    {chapters.map((c,i)=>{const start=at;at+=c.seconds*FPS;return <Sequence key={c.id} from={start} durationInFrames={c.seconds*FPS}><Scene chapter={c} index={i}/></Sequence>;})}
    <div style={{position:'absolute',bottom:0,left:0,height:5,width:`${f/duration*100}%`,background:C.teal}}/>
  </AbsoluteFill>;
};
registerRoot(()=> <Composition id="HarnessDesk" component={Film} width={1920} height={1080} fps={FPS} durationInFrames={duration}/>);
