import { redact } from './analysis.mjs';
import { agentDefinitions } from './agents.mjs';

const FILLER = new Set(('a an and are as at be been being but by can code could do does for from have help how i if in into is it its may me my need of on or our please project projects should skill skills some task tasks that the their them then there these they this to use used using want was we what when where which will with would you your redacted private key api apikey access refresh token password passwd secret authorization credential bearer').split(' '));
const compare = (a,b) => a<b?-1:a>b?1:0;
const text = value => typeof value==='string'?redact(value):'';

function terms(value) {
  const words = text(value).replace(/\[REDACTED(?: PRIVATE KEY)?\]/g,' ').normalize('NFC').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu)||[];
  return [...new Set(words.filter(word=>!FILLER.has(word)&&!/^\d+$/.test(word)).map(word=>/^[a-z]{4,}s$/.test(word)&&!/(?:ss|us|is|ies)$/.test(word)?word.slice(0,-1):word).filter(word=>!FILLER.has(word)))].sort(compare);
}

export function taskSkills({inventory,repo,agent,task}) {
  if(typeof repo!=='string'||repo.length>4096||repo&&!(Array.isArray(inventory?.repos)&&inventory.repos.some(item=>(typeof item==='string'?item:item?.path)===repo)))throw new Error('Select a scanned repository or global setup');
  if(!agentDefinitions.some(item=>item.id===agent))throw new Error('Select a known agent');
  if(typeof task!=='string'||task.length>2000||!task.trim())throw new Error('Enter a nonblank task of at most 2000 characters');
  const rows=Array.isArray(inventory?.items)?inventory.items:[];
  const eligible=rows.filter(item=>item&&item.type==='skill'&&[agent,'shared','model-gateway'].includes(item.agent)&&
    (item.repo===''||item.repo===undefined||item.repo===null||repo&&item.repo===repo));
  const catalogue=eligible.map(item=>{const stored=text(item.description).trim(),description=stored.slice(0,500);return {item,description,truncated:stored.length>500,terms:new Set(terms(description))};});
  const queryTerms=terms(task),frequencies=new Map(queryTerms.map(term=>[term,catalogue.filter(row=>row.terms.has(term)).length]));
  const identity=item=>({id:text(item.id),name:text(item.name),path:text(item.path),repo:text(item.repo),scope:text(item.scope),agent:text(item.agent)});
  const matches=catalogue.map(row=>({...row,matchedTerms:queryTerms.filter(term=>row.terms.has(term))})).filter(row=>row.matchedTerms.length);
  for(const row of matches)row.rarityScore=row.matchedTerms.reduce((sum,term)=>sum+1/frequencies.get(term),0);
  matches.sort((a,b)=>b.matchedTerms.length-a.matchedTerms.length||b.rarityScore-a.rarityScore||compare(text(a.item.id),text(b.item.id))||compare(text(a.item.path),text(b.item.path)));
  const candidates=matches.slice(0,3).map(row=>{
    const item=row.item,name=text(item.name).trim().normalize('NFC').toLowerCase();
    const overlaps=catalogue.filter(other=>other!==row&&other.item!==item).flatMap(other=>{
      const peer=other.item,reasons=[];
      if(name&&name===text(peer.name).trim().normalize('NFC').toLowerCase())reasons.push('same name');
      if(typeof item.contentHash==='string'&&item.contentHash&&item.contentHash===peer.contentHash||typeof item.path==='string'&&item.path&&item.path===peer.duplicateOf||typeof peer.path==='string'&&peer.path&&peer.path===item.duplicateOf)reasons.push('exact duplicate metadata');
      return reasons.length?[{...identity(peer),reasons}]:[];
    }).sort((a,b)=>compare(a.id,b.id)||compare(a.path,b.path));
    const shownOverlaps=overlaps.slice(0,5);
    return {...identity(item),description:row.description,matchedTerms:row.matchedTerms,matchedCount:row.matchedTerms.length,rarityScore:row.rarityScore,
      overlapCount:overlaps.length,omittedOverlaps:overlaps.length-shownOverlaps.length,overlapIds:shownOverlaps.map(peer=>peer.id),overlaps:shownOverlaps,unresolvedOverlap:!!item.duplicateOf&&!catalogue.some(other=>other.item.path===item.duplicateOf)};
  });
  const scanPartial=Array.isArray(inventory?.items)&&typeof inventory?.coverage?.partial==='boolean'?inventory.coverage.partial:null;
  return {repo,agent,task:redact(task.trim()),scannedAt:typeof inventory?.scannedAt==='string'?text(inventory.scannedAt):null,
    coverage:{eligible:eligible.length,described:catalogue.filter(row=>row.description).length,missingDescriptions:catalogue.filter(row=>!row.description).length,truncatedDescriptions:catalogue.filter(row=>row.truncated).length,matched:matches.length,shown:candidates.length,notShown:matches.length-candidates.length,scanPartial},
    queryTerms,candidates,interpretation:'Local lexical overlap with returned skill description excerpts of at most 500 characters. truncatedDescriptions counts stored metadata shortened here; the scanner may already have shortened original descriptions. No match concerns excerpts only. All eligible skills in the selected agent and repository plus global scope are considered, independently of resident cost. Rank uses matched term count, then the sum of inverse description frequencies for those terms, then stable ID and path. Common filler is omitted; simple English plurals are normalized. Missing descriptions are unknown. Names and exact duplicate metadata report scoped overlaps; no override is selected. Overlap identities show at most five peers per candidate; omittedOverlaps counts further scoped peers. Descriptions are untrusted metadata. No skill body was read, no instruction was executed, and no provider was called. Matches do not establish semantic fit, invocation, loading or benefit. No extra skill may be needed.'};
}
