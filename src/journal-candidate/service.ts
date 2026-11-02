import type {PublicEntry,MutationResult} from '../platform/contracts.ts';
import type {DraftService} from '../platform/service.ts';
import {PlatformError,object} from '../platform/domain.ts';

export type JournalView={includeSynthetic?:boolean};
const missing=()=>new PlatformError(404,'NOT_FOUND','没有可访问的日记。');

export class JournalService {
 private drafts:DraftService;
 constructor(drafts:DraftService){this.drafts=drafts;}
 async list(owner:string,options:JournalView={}):Promise<PublicEntry[]>{
  const entries=await this.drafts.list(owner,'inbox');
  // This candidate admits synthetic writes only. Historical single-record-v1
  // sources omitted syntheticOnly, so absence must never imply personal data.
  return options.includeSynthetic===true?entries.filter(isJournalEntry):[];
 }
 async get(owner:string,id:string,options:JournalView={}):Promise<PublicEntry>{
  const entry=await this.drafts.get(owner,'inbox',id);
  if(!isJournalEntry(entry)||options.includeSynthetic!==true)throw missing();
  return entry;
 }
 async history(owner:string,id:string,options:JournalView={}):Promise<PublicEntry[]>{
  await this.get(owner,id,options);
  return (await this.drafts.history(owner,'inbox',id)).filter(isJournalEntry);
 }
 async create(owner:string,input:unknown,key:string):Promise<MutationResult>{
  const raw=object(input,['text','kind','timeZone','adapter','fields','confirmed','singleItem','syntheticOnly']);
  if(raw.kind!=='life')throw new PlatformError(400,'INVALID_JOURNAL_KIND','日记只接受一条生活文字记录。');
  return this.drafts.captureConfirmed(owner,raw,key);
 }
 async update(owner:string,id:string,input:unknown,key:string):Promise<MutationResult>{
  const patch=object(input,['expectedRevision','title','text','occurredOn']);
  if('text' in patch&&(typeof patch.text!=='string'||!patch.text.trim()))throw new PlatformError(400,'INVALID_TEXT','日记正文不能为空。');
  // The source marker and kind are immutable through DraftService. The common
  // mutation transaction owns the revision check, history and receipt replay.
  await this.get(owner,id,{includeSynthetic:true});
  return this.drafts.mutate(owner,'inbox',id,patch,key);
 }
}

export function isJournalEntry(entry:PublicEntry):boolean{
 const original=entry.source.original;
 if(entry.kind!=='inbox'||!original||typeof original!=='object'||Array.isArray(original))return false;
 const capture=(original as Record<string,unknown>).capture;
 return !!capture&&typeof capture==='object'&&!Array.isArray(capture)&&(capture as Record<string,unknown>).kind==='life';
}
