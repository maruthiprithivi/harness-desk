import { createHash } from 'node:crypto';
import { loadingMap } from './loading.mjs';
import { supportedToolConfig } from './tool-metadata.mjs';
import { componentCallEvidence } from './usage-evidence.mjs';

const TYPES = new Set(['skill','mcp-server','subagent','hook','command','plugin']);
export const reviewKey = (id,agent,repo) => createHash('sha256').update(JSON.stringify([id,agent,repo])).digest('hex');
export const assetVersion = item => JSON.stringify([item.contentHash,item.bytes,item.modifiedAt]);
export const componentHelpfulness = (review,agent,repo) => review?.agent===agent&&review?.repo===repo&&typeof review?.note==='string'&&review.note.trim()&&['helped','not-helped','mixed'].includes(review.helpfulness)?review.helpfulness:'unknown';
export function scopedDuplicate(inventory,item,repo='',globalOnly=false,agent='') {
  if(!item.duplicateOf)return null;
  const target=(inventory?.items||[]).find(candidate=>candidate.path===item.duplicateOf);
  return target&&(!agent||[agent,'shared','model-gateway'].includes(target.agent))&&(globalOnly?!target.repo:!repo||!target.repo||target.repo===repo)?item.duplicateOf:'Matching content outside this scope; path withheld';
}

export function componentReview({inventory,agent,repo='',home='',reviews={},toolInspections={},usageEvidence=null}) {
  const settings = new Set(loadingMap({inventory,agent,repo,home}).groups.find(group=>group.id==='settings').files.map(file=>file.id));
  const eligible = (inventory?.items || []).filter(item => (!item.repo || item.repo===repo) &&
    [agent,'shared','model-gateway'].includes(item.agent) && (TYPES.has(item.type) || settings.has(item.id)));
  const hash = item => typeof item.contentHash==='string'&&/^[a-f0-9]{64}$/i.test(item.contentHash)?item.contentHash.toLowerCase():null;
  const compare = (a,b) => a.path.localeCompare(b.path)||a.id.localeCompare(b.id);
  const paths = new Map(),groups = new Map();
  for(const item of [...eligible].sort(compare))if(!paths.has(item.path))paths.set(item.path,item);
  let hashed=0;
  for(const item of paths.values()){
    const key=hash(item);if(!key)continue;hashed++;
    if(!groups.has(key))groups.set(key,{paths:new Set(),leaders:[]});
    const group=groups.get(key);group.paths.add(item.path);if(group.leaders.length<4)group.leaders.push(item);
  }
  const coverage={scannedAt:typeof inventory?.scannedAt==='string'?inventory.scannedAt:null,scanPartial:typeof inventory?.coverage?.partial==='boolean'?inventory.coverage.partial:null,eligible:paths.size,hashed,unhashed:paths.size-hashed};
  const items = eligible
    .map(item => {
      const key=hash(item),group=groups.get(key),peerCount=key?(group?group.paths.size-Number(group.paths.has(item.path)):0):null;
      const peers=(group?.leaders||[]).filter(peer=>peer.path!==item.path).slice(0,3).map(({id,name,path,type,agent,repo,scope,contentHash,bytes,modifiedAt})=>({id,name,path,type,agent,repo:repo||'',scope,contentHash,bytes,modifiedAt}));
      const duplicates={method:key?'sha256-full-markdown':null,...coverage,peerCount,shown:peers.length,omitted:peerCount===null?0:peerCount-peers.length,peers};
      const saved = reviews[reviewKey(item.id,agent,repo)];
      const review = saved ? {...saved,helpfulness:componentHelpfulness(saved,agent,repo),changed: saved.version!==assetVersion(item)} : null;
      const inspected=toolInspections[reviewKey(item.id,agent,repo)];
      const toolInspection=inspected?{...inspected,fileChanged:inspected.bytes!==item.bytes||inspected.modifiedAt!==item.modifiedAt}:null;
      return {id:item.id,name:item.name,description:item.description||'',path:item.path,type:item.type,agent:item.agent,repo:item.repo||'',scope:item.scope,bytes:item.bytes,contentHash:item.contentHash,duplicates,
        residentTokens:item.residentTokens,bodyTokens:item.bodyTokens,loadMode:item.loadMode,
        duplicateOf:scopedDuplicate(inventory,item,repo,!repo,agent),modifiedAt:item.modifiedAt,review,canInspectTools:!!supportedToolConfig(item),toolInspection};
    }).sort((a,b)=>Number(b.review?.status==='review')-Number(a.review?.status==='review') || a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
  return {items:items.map(item=>({...item,callEvidence:componentCallEvidence(item,items,usageEvidence)})),usageEvidence,summary:{skills:items.filter(item=>item.type==='skill').length,
    toolConfigs:items.filter(item=>item.type==='mcp-server'||item.type==='config').length,
    used:items.filter(item=>item.review?.status==='used'&&!item.review.changed).length,
    toReview:items.filter(item=>item.review?.status==='review'||item.review?.changed).length,
    unknown:items.filter(item=>item.review?.status!=='used'||item.review.changed).length}};
}
