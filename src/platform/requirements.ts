import baseline from './public-requirements.json' with {type:'json'};
export type Requirement={id:string;version:number;title:string;description:string;status:'not_started'|'in_progress'|'awaiting_acceptance'|'accepted';delivery:'current'|'backlog';sourceRefs:string[];acceptanceCriteria:string[];evidence:{scope:string;ref:string}[];blockedBy:string[];acceptance?:{by:'user';baselineVersion:string;ref:string}};
export type RequirementBaseline={baselineVersion:string;candidateVersion:string;scopeNote:string;newIdeaPolicy:string;requirements:Requirement[]};
const nonempty=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0;
export function validateRequirementBaseline(input:unknown):RequirementBaseline {
 const b=input as RequirementBaseline;
 if(!b||!nonempty(b.baselineVersion)||!nonempty(b.candidateVersion)||!nonempty(b.scopeNote)||!Array.isArray(b.requirements)||!b.requirements.length||b.newIdeaPolicy!=='backlog-requires-explicit-scope')throw Error('Invalid baseline.');
 const ids=new Set<string>();
 for(const r of b.requirements){
  if(!r||typeof r.id!=='string'||!/^LO-[A-Z]+-\d{3}$/.test(r.id)||ids.has(r.id))throw Error('Invalid or duplicate requirement ID.');ids.add(r.id);
  if(!Number.isSafeInteger(r.version)||r.version<1||!nonempty(r.title)||!nonempty(r.description)||!['not_started','in_progress','awaiting_acceptance','accepted'].includes(r.status)||!['current','backlog'].includes(r.delivery))throw Error('Invalid requirement.');
  if(!Array.isArray(r.sourceRefs)||!r.sourceRefs.length||!r.sourceRefs.every(nonempty))throw Error('Requirement source is missing.');
  if(!Array.isArray(r.acceptanceCriteria)||!r.acceptanceCriteria.length||!r.acceptanceCriteria.every(nonempty)||!Array.isArray(r.evidence)||!r.evidence.every(e=>e&&nonempty(e.scope)&&nonempty(e.ref))||!Array.isArray(r.blockedBy)||!r.blockedBy.every(nonempty))throw Error('Invalid acceptance criteria or evidence.');
  if(r.status==='accepted'&&(!r.acceptance||r.acceptance.by!=='user'||r.acceptance.baselineVersion!==b.baselineVersion||!nonempty(r.acceptance.ref)))throw Error('User acceptance evidence for this baseline is required.');
 }
 return b;
}
function freeze<T>(v:T):T {if(v&&typeof v==='object'){for(const child of Object.values(v))freeze(child);Object.freeze(v);}return v;}
const fixed=freeze(validateRequirementBaseline(baseline));
export function requirements():RequirementBaseline{return fixed;}
