import {matchesPersonalSearchDate,readPersonalSearchDateRange,type PersonalSearchDateRange} from '../personal-candidate/search-dates.ts';
import {object} from '../platform/domain.ts';
import {personalTypes} from '../personal-candidate/business.ts';
import {readSearchSelection,searchRow,searchCalendarRow,searchParams,type SearchSelection,type SearchRow,type SearchCoverage} from './model.ts';
type SearchBinding={ownerId:string;spaceId:string};
export type PersonalSearchData={binding:SearchBinding;query:string;rows:SearchRow[];coverage:SearchCoverage;detail:SearchRow|null;detailUnavailable:boolean};
type Fetcher=(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>;
export class PersonalSearchError extends Error{readonly kind:'auth'|'unavailable';constructor(kind:'auth'|'unavailable',message:string){super(message);this.kind=kind;}}
const unavailable=()=>new PersonalSearchError('unavailable','无法核对完整搜索结果，请重新读取。');
const auth=()=>new PersonalSearchError('auth','本人会话已失效或身份已变化，搜索结果已隐藏。请重新登录。');
function searchReader(fetcher:Fetcher,signal?:AbortSignal){
 const read=async(path:string,allowMissing=false)=>{
  const response=await fetcher('/api/platform/personal/'+path,{cache:'no-store',credentials:'same-origin',signal});
  if(response.status===401||response.status===403)throw auth();
  if(allowMissing&&response.status===404)return null;
  if(!response.ok)throw unavailable();
  return response.json();
 };
 const identity=async():Promise<SearchBinding>=>{
  const value=await read('status');
  if(value?.scope!=='personal-manual-candidate'||value.storageVerified!==true||typeof value.ownerId!=='string'||!value.ownerId||typeof value.spaceId!=='string'||!value.spaceId)throw auth();
  return {ownerId:value.ownerId,spaceId:value.spaceId};
 };
 const original=async(selection:SearchSelection,spaceId:string,query:string,sourceId?:string)=>{
  const value=await read(selection.type+'/'+selection.id,true);
  if(value===null)return null;
  try{
   const entry=object(value,['entry']).entry;
   const detail=selection.type==='calendar'?searchCalendarRow(entry,spaceId,query):searchRow(entry,spaceId,query);
   if(detail.id!==selection.id||detail.type!==selection.type||sourceId&&detail.sourceId!==sourceId)throw unavailable();
   return detail;
  }catch{throw unavailable();}
 };
 return {read,identity,original};
}
function assertSameBinding(before:SearchBinding,after:SearchBinding,signal?:AbortSignal){
 if(before.ownerId!==after.ownerId||before.spaceId!==after.spaceId)throw auth();
 if(signal?.aborted)throw new DOMException('Aborted','AbortError');
}
export async function verifyPersonalSearchBinding(binding:SearchBinding,signal:AbortSignal,fetcher:Fetcher=fetch){
 assertSameBinding(binding,await searchReader(fetcher,signal).identity(),signal);
}
export async function loadPersonalSearchOriginal(results:PersonalSearchData,row:SearchRow,signal:AbortSignal,fetcher:Fetcher=fetch){
 const selection=readSearchSelection(row.type,row.id)!;
 const {identity,original}=searchReader(fetcher,signal);
 assertSameBinding(results.binding,await identity(),signal);
 const detail=await original(selection,results.binding.spaceId,results.query,row.sourceId);
 assertSameBinding(results.binding,await identity(),signal);
 return {...results,detail,detailUnavailable:detail===null};
}
export async function loadPersonalSearch(query:string,selection:SearchSelection|null,signal?:AbortSignal,fetcher:Fetcher=fetch,dates:PersonalSearchDateRange={}):Promise<PersonalSearchData>{
 if(selection)selection=readSearchSelection(selection.type,selection.id);
 const range=readPersonalSearchDateRange(dates.from,dates.to);
 if(query.length>240)throw new PersonalSearchError('unavailable','搜索内容最多240字。');
 const {read,identity,original}=searchReader(fetcher,signal);
 const before=await identity(),value=await read('search?'+searchParams(query,range));
 if(value?.scope!=='full-current-snapshot'||value.query!==query||value.from!==range.from||value.to!==range.to||!Array.isArray(value.items)||value.items.length>10000)throw unavailable();
 const c=value.coverage;if(!c||!Array.isArray(c.types)||c.types.some((type:unknown)=>!personalTypes.includes(type as never))||new Set(c.types).size!==c.types.length||!Number.isInteger(c.scanned)||c.scanned<value.items.length||c.scanned>10000||c.matched!==value.items.length)throw unavailable();
 let rows:SearchRow[];
 try{rows=value.items.map((entry:unknown)=>searchRow(entry,before.spaceId,query));if(new Set(rows.map(row=>row.id)).size!==rows.length||rows.some(row=>!c.types.includes(row.type)||!matchesPersonalSearchDate(row.date,range)))throw unavailable();}catch{throw unavailable();}
 const detail=selection?await original(selection,before.spaceId,query,rows.find(row=>row.id===selection.id)?.sourceId):null;
 assertSameBinding(before,await identity(),signal);
 return {binding:before,query,rows,coverage:c,detail,detailUnavailable:selection!==null&&detail===null};
}
