// Local English wording heuristic only: no embeddings, semantic proof or savings claim.
const METHOD = 'local-tfidf-v1', MAX_PATTERNS = 512, MAX_WORDS = 160, MAX_TERMS = 64;
const STOP = new Set(('a an and any after before all also are as at be been being but by can could did do does doing each for from had has have how i if in into is it its just may me more most my of on only or our out own please same should so some than that the their them then there these they this those through to too us use used using very was we were what when where which while who will with would you your help need want task work thing things code repo repository project current existing carefully quick quickly result results report reporting summary summarize finding findings detailed details ensure make change changes improvement improvements').split(' '));
const ACTIONS = new Set(('keep retain preserve remove delete prune archive discard drop enable disable activate deactivate start stop pause resume run install uninstall add create deploy publish unpublish revert undo build compile test check review inspect analyze edit update read write configure document increase decrease allow deny include exclude convert move copy migrate transfer send sync import export').split(' '));
const DIRECTIONS = new Set(('convert move copy migrate transfer send sync import export').split(' '));
const OPPOSITES = [['keep','remove'],['keep','delete'],['retain','drop'],['preserve','prune'],['enable','disable'],['activate','deactivate'],['start','stop'],['start','pause'],['run','stop'],['install','uninstall'],['add','remove'],['create','delete'],['deploy','revert'],['publish','unpublish'],['increase','decrease'],['allow','deny'],['include','exclude'],['pause','resume'],['stop','resume']];
const FORMS = new Map(Object.entries({ enabling:'enable', enabled:'enable', disabling:'disable', disabled:'disable', creating:'create', created:'create', removing:'remove', removed:'remove', preserving:'preserve', preserved:'preserve', using:'use', used:'use', moving:'move', moved:'move', copying:'copy', copied:'copy', migrating:'migrate', migrated:'migrate', analyzing:'analyze', analyzed:'analyze', analysing:'analyze', analysed:'analyze', analyse:'analyze', configuring:'configure', configured:'configure', updating:'update', updated:'update', caching:'cache', cached:'cache', increasing:'increase', increased:'increase', decreasing:'decrease', decreased:'decrease', denied:'deny', including:'include', included:'include', excluding:'exclude', excluded:'exclude', sent:'send', kept:'keep', ran:'run', built:'build', wrote:'write', written:'write', undone:'undo' }));
const compare = (left,right) => left < right ? -1 : left > right ? 1 : 0;
function stem(word) {
  if (FORMS.has(word)) return FORMS.get(word);
  if (word.length > 5 && word.endsWith('ies')) return word.slice(0,-3)+'y';
  if (word.length > 5 && word.endsWith('ing') || word.length > 4 && word.endsWith('ed')) {
    const base=word.slice(0,word.endsWith('ing')?-3:-2).replace(/([b-df-hj-np-tv-z])\1$/, '$1');
    return ACTIONS.has(base+'e') ? base+'e' : base;
  }
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0,-1);
  return word;
}
function features(entry) {
  const {pattern,repo,evidence} = entry;
  if (typeof repo !== 'string' || !repo || typeof pattern !== 'string' || pattern.length > 2000 || /[^\x20-\x7e]/.test(pattern)) return null;
  if (!evidence || evidence.occurrences < 1 || !(evidence.sessions instanceof Set) || evidence.occurrences >= 3 && evidence.sessions.size >= 2) return null;
  // Negation and mixed opposing actions need semantic interpretation, so leave them exact-only.
  if (/\b(?:don't|dont|do not|not|never|without|avoid|cannot|can't|no|skip)\b|n't\b/.test(pattern)) return null;
  const words = pattern.match(/[a-z]+(?:'[a-z]+)?/g) || [];
  if (words.length > MAX_WORDS) return null;
  const normalized = words.map(stem), actions = new Set(normalized.filter(word=>ACTIONS.has(word)));
  if (OPPOSITES.some(([first,second])=>actions.has(first)&&actions.has(second))) return null;
  // Bag-of-words cannot distinguish reversed destinations; do not group directional requests.
  if (normalized.some(word=>DIRECTIONS.has(word)) && /\b(?:to|from|into|between)\b|->/.test(pattern)) return null;
  const terms = normalized.filter(word=>word.length >= 3 && word.length <= 24 && !STOP.has(word) && !['path','hash','url','redacted'].includes(word));
  const counts = new Map(); for (const term of terms) counts.set(term,(counts.get(term)||0)+1);
  if (counts.size < 4 || counts.size > MAX_TERMS) return null;
  return {...entry,key:JSON.stringify([repo,pattern]),counts,actions:[...actions].sort().join('|'),head:new Set(terms.slice(0,8)),tail:new Set(terms.slice(-8)),long:words.length>48};
}
function overlap(left,right) {
  let shared = 0; for (const term of left.keys()) if (right.has(term)) shared++;
  return {shared,ratio:shared/(left.size+right.size-shared)};
}
function matches(left,right) {
  if (left.actions !== right.actions) return false;
  const {shared,ratio} = overlap(left.counts,right.counts);
  if (shared < 4 || ratio < 0.65 || left.counts.size-shared > 2 || right.counts.size-shared > 2) return false;
  // For long prompts, shared boilerplate at one end must not hide different task wording.
  if ((left.long || right.long) && (overlap(left.head,right.head).ratio < 0.65 || overlap(left.tail,right.tail).ratio < 0.65)) return false;
  let dot = 0; for (const [term,value] of left.weights) dot += value*(right.weights.get(term)||0);
  return dot/(left.norm*right.norm) >= 0.8;
}
export function groupPromptWording(entries) {
  const selected = []; let eligiblePatterns = 0;
  for (const entry of entries) {
    const feature = features(entry); if (!feature) continue;
    eligiblePatterns++;
    // Retain only the lexical first 512; input selection order cannot change the compared set.
    let low=0,high=selected.length;
    while(low<high){const middle=(low+high)>>>1;if(compare(selected[middle].key,feature.key)<0)low=middle+1;else high=middle;}
    if(low<MAX_PATTERNS){selected.splice(low,0,feature);if(selected.length>MAX_PATTERNS)selected.pop();}
  }
  const byRepo = new Map();
  for (const feature of selected) {const local=byRepo.get(feature.repo)||[];local.push(feature);byRepo.set(feature.repo,local);}
  const groups = [];
  for (const [repo,local] of byRepo) {
    const frequency = new Map();
    for (const feature of local) for (const term of feature.counts.keys()) frequency.set(term,(frequency.get(term)||0)+1);
    for (const feature of local) {
      feature.weights=new Map([...feature.counts].map(([term,count])=>[term,(1+Math.log(count))*(1+Math.log((local.length+1)/(frequency.get(term)+1)))]));
      feature.norm=Math.sqrt([...feature.weights.values()].reduce((sum,value)=>sum+value*value,0));
    }
    const clustered=[];
    for (const feature of local) {
      const group=clustered.find(group=>group.length<5&&group.every(member=>matches(member,feature)));
      if(group)group.push(feature);else clustered.push([feature]);
    }
    for (const members of clustered) {
      if(members.length<2)continue;
      const sessions=new Set(members.flatMap(member=>[...member.evidence.sessions]));
      if(members.reduce((sum,member)=>sum+member.evidence.occurrences,0)<3||sessions.size<2)continue;
      groups.push({repo,members:members.map(({pattern,evidence})=>({pattern,evidence}))});
    }
  }
  return {groups,coverage:{method:METHOD,eligiblePatterns,comparedPatterns:selected.length,limited:eligiblePatterns>MAX_PATTERNS}};
}
