import {PlatformError,validateId} from '../platform/domain.ts';
import type {DraftService} from '../platform/service.ts';
import {isRecordEntry,validateRecordType,validateRecordMetadata,normalizeProjectLinks} from './domain.ts';
import type {RecordEntry,RecordType,RecordMutationResult,ProjectLinkType,ProjectLinkCandidatesResponse,ProjectRecapResponse} from './contracts.ts';
import {projectLinkCandidate,projectLinkState} from '../project-candidate/links.ts';

export type RecordView={includeSynthetic?:boolean};
const missing=()=>new PlatformError(404,'NOT_FOUND','没有可访问的此类记录。');
export class RecordsService{
 private drafts:DraftService;private now:()=>Date;
 constructor(drafts:DraftService,now:()=>Date=()=>new Date()){this.drafts=drafts;this.now=now;}
 async list(owner:string,type:RecordType,view:RecordView={}):Promise<RecordEntry[]>{
  validateRecordType(type);
  if(view.includeSynthetic!==true)return[];
  return(await this.drafts.list(owner,'inbox')).filter((entry):entry is RecordEntry=>isRecordEntry(entry,type));
 }
 async get(owner:string,type:RecordType,id:string,view:RecordView={}):Promise<RecordEntry>{
  validateRecordType(type);if(view.includeSynthetic!==true)throw missing();
  const entry=await this.drafts.get(owner,'inbox',id);if(!isRecordEntry(entry,type))throw missing();return entry;
 }
 async history(owner:string,type:RecordType,id:string,view:RecordView={}):Promise<RecordEntry[]>{
  await this.get(owner,type,id,view);
  return(await this.drafts.history(owner,'inbox',id)).filter((entry):entry is RecordEntry=>isRecordEntry(entry,type));
 }
 async create(owner:string,type:RecordType,input:unknown,key:string):Promise<RecordMutationResult>{
  return this.drafts.mutateRecord(owner,type,null,input,key);
 }
 async update(owner:string,type:RecordType,id:string,input:unknown,key:string):Promise<RecordMutationResult>{
  // The shared transaction checks ownership, source/type identity and revision
  // while locked, after receipt replay. No pre-read can break a safe retry.
  return this.drafts.mutateRecord(owner,type,id,input,key);
 }
 async reviewProject(owner:string,id:string,input:unknown,key:string):Promise<RecordMutationResult>{
  return this.drafts.reviewProject(owner,id,input,key);
 }
 async linkCandidates(owner:string,type:ProjectLinkType,q='',view:RecordView={}):Promise<ProjectLinkCandidatesResponse>{
  if(!['todo','resource','article'].includes(type)||typeof q!=='string'||q.length>200||/[\u0000-\u001f\u007f]/.test(q))throw new PlatformError(400,'INVALID_PROJECT_QUERY','请核对项目关联查询。');
  const response:ProjectLinkCandidatesResponse={items:[],limit:50,truncated:false,observedAt:this.now().toISOString(),dataStatus:'isolated-test-drafts',syntheticIncluded:view.includeSynthetic===true};
  if(!response.syntheticIncluded)return response;
  const snapshot=await this.drafts.exportSnapshot(owner),needle=q.trim().normalize('NFKC').toLowerCase();
  const items=snapshot.entries.flatMap(entry=>{const candidate=projectLinkCandidate(entry,type);return candidate?[candidate]:[];}).filter(item=>[item.title,item.summary,item.link.id,item.link.sourceId].join('\n').normalize('NFKC').toLowerCase().includes(needle));
  items.sort((a,b)=>a.link.id.localeCompare(b.link.id,'en'));
  return{...response,items:items.slice(0,50),truncated:items.length>50};
 }
 async recap(owner:string,id:string,view:RecordView={}):Promise<ProjectRecapResponse>{
  id=validateId(id);if(view.includeSynthetic!==true)throw missing();
  const observedAt=this.now().toISOString(),snapshot=await this.drafts.exportSnapshot(owner);
  const row=snapshot.entries.find(entry=>entry.id===id&&isRecordEntry(entry,'project'));
  if(!row||!isRecordEntry(row,'project')||row.draft.record.type!=='project')throw missing();
  const metadata=validateRecordMetadata(row.draft.record);if(metadata.type!=='project')throw missing();
  const project:RecordEntry={...row,draft:{...row.draft,record:metadata}};
  const entries=new Map(snapshot.entries.map(entry=>[entry.id,entry]));
  const links=normalizeProjectLinks(metadata.links).map(link=>projectLinkState(link,entries.get(link.id)));
  const counts={total:links.length,current:0,updated:0,unavailable:0,todo:0,resource:0,article:0};
  for(const link of links){counts[link.status]++;counts[link.link.type]++;}
  const reviewApplicability=metadata.review.decision==='pending'?'pending':counts.updated||counts.unavailable?'stale-links':'current';
  return{project,links,counts,reviewApplicable:reviewApplicability==='current',reviewApplicability,observedAt,readOnly:true,aiGenerated:false,snapshotConsistency:'owner-snapshot',freshness:'refresh-to-check',dataStatus:'isolated-test-drafts',syntheticIncluded:true};
 }
}
