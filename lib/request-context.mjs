const LIMIT=28000;
const limits=new Map([['inventory',100],['recommendations',30],['gaps',30],['improvements',3],['context.observations',10],['context.breakdowns',10],['patterns.candidates',15],['patterns.mistakes',10],['journal.lessons',20],['improvements.inventorySource.items',10],['improvements.latestRunNotes',3]]);
const latest=new Set(['context.observations','context.breakdowns','improvements.latestRunNotes']);
const details=new Set([...limits.keys(),'context.loadingPrediction.groups.files','improvements.tasks','inventory.manualReviews','inventory.callEvidence.matches','inventory.callEvidence.reads','inventory.toolInspection.servers']);
const audit=section=>section.startsWith('patterns.importedAudit.tables.');

function lists(value) {
  const result=new Map();
  function visit(node,parts) {
    if(Array.isArray(node)) {
      const section=parts.join('.'),entry=result.get(section)||{available:0,arrays:[]};
      entry.available+=node.length;entry.arrays.push(node);result.set(section,entry);
      for(const item of node)visit(item,parts);
    }else if(node&&typeof node==='object')for(const [key,item]of Object.entries(node))if(key!=='coverage'||parts.length)visit(item,[...parts,key]);
  }
  visit(value,[]);return result;
}

export function boundRequestContext(bundle) {
  const available=lists(bundle);
  for(const [section,entry]of available) {
    const limit=audit(section)?20:limits.get(section);
    if(limit===undefined)continue;
    for(const array of entry.arrays)if(array.length>limit)array.splice(latest.has(section)?0:limit, array.length-limit);
  }
  for(;;) {
    const current=lists(bundle),sections=[...available].map(([section,entry])=>{
      const included=current.get(section)?.available||0;
      return {section,available:entry.available,included,omitted:entry.available-included};
    });
    const coverage={partial:sections.some(section=>section.omitted>0),sections,interpretation:'Counts describe scoped eligible saved evidence and request record omissions, not complete scans, observed loading, task relevance or full usage. Whole records are omitted to respect detail limits and the 28,000-character budget; source uncertainties remain in their evidence.'};
    bundle.coverage=coverage;
    const text=JSON.stringify(bundle,null,2);
    if(text.length<=LIMIT)return {text,estTokens:Math.ceil(Buffer.byteLength(text,'utf8')/4),truncated:coverage.partial,coverage};
    let candidate;
    for(const [section,entry]of current)if(details.has(section)||audit(section))for(const array of entry.arrays)for(let index=0;index<(latest.has(section)?Math.min(array.length,1):array.length);index++) {
      const size=JSON.stringify(array[index]).length;
      if(!candidate||size>candidate.size)candidate={array,index,size};
    }
    if(!candidate)throw new Error('Selected context metadata or critical failure summaries exceed the 28,000-character budget. Select fewer sections or a narrower scope. No request was sent.');
    candidate.array.splice(candidate.index,1);
  }
}
