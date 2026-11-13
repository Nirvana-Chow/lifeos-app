import {object} from '../platform/domain.ts';
import {personalTypes} from '../personal-candidate/business.ts';
import {readSearchSelection,searchRow,searchCalendarRow,type SearchSelection,type SearchRow,type SearchCoverage} from './model.ts';
export type PersonalSearchData={query:string;rows:SearchRow[];coverage:SearchCoverage;detail:SearchRow|null;detailUnavailable:boolean};
type Fetcher=(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>;
export class PersonalSearchError extends Error{readonly kind:'auth'|'unavailable';constructor(kind:'auth'|'unavailable',message:string){super(message);this.kind=kind;}}
const unavailable=()=>new PersonalSearchError('unavailable','无法核对完整搜索结果，请重新读取。');
const auth=()=>new PersonalSearchError('auth','本人会话已失效或身份已变化，搜索结果已隐藏。请重新登录。');
export async function loadPersonalSearch(query:string,selection:SearchSelection|null,signal?:AbortSignal,fetcher:Fetcher=fetch):Promise<PersonalSearchData>{
 if(selection)selection=readSearchSelection(selection.type,selection.id);
 if(query.length>240)throw new PersonalSearchError('unavailable','搜索内容最多240字。');
 const read=async(path:string,allowMissing=false)=>{const response=await fetcher('/api/platform/personal/'+path,{cache:'no-store',credentials:'same-origin',signal});if(response.status===401||response.status===403)throw auth();if(allowMissing&&response.status===404)return null;if(!response.ok)throw unavailable();return response.json();};
 const identity=async()=>{const value=await read('status');if(value?.scope!=='personal-manual-candidate'||value.storageVerified!==true||typeof value.ownerId!=='string'||!value.ownerId||typeof value.spaceId!=='string'||!value.spaceId)throw auth();return{ownerId:value.ownerId as string,spaceId:value.spaceId as string};};
 const before=await identity(),value=await read('search?'+new URLSearchParams({q:query}));
 if(value?.scope!=='full-current-snapshot'||value.query!==query||!Array.isArray(value.items)||value.items.length>10000)throw unavailable();
 const c=value.coverage;if(!c||!Array.isArray(c.types)||c.types.some((type:unknown)=>!personalTypes.includes(type as never))||new Set(c.types).size!==c.types.length||!Number.isInteger(c.scanned)||c.scanned<value.items.length||c.scanned>10000||c.matched!==value.items.length)throw unavailable();
 let rows:SearchRow[],detail:SearchRow|null=null,detailUnavailable=false;
 try{rows=value.items.map((entry:unknown)=>searchRow(entry,before.spaceId,query));if(new Set(rows.map(row=>row.id)).size!==rows.length||rows.some(row=>!c.types.includes(row.type)))throw unavailable();}catch{throw unavailable();}
 if(selection){const original=await read(selection.type+'/'+selection.id,true);if(original===null)detailUnavailable=true;else{try{const entry=object(original,['entry']).entry;detail=selection.type==='calendar'?searchCalendarRow(entry,before.spaceId,query):searchRow(entry,before.spaceId,query);if(detail.id!==selection.id||detail.type!==selection.type)throw unavailable();const found=rows.find(row=>row.id===detail!.id);if(found&&found.sourceId!==detail.sourceId)throw unavailable();}catch{throw unavailable();}}}
 const after=await identity();if(before.ownerId!==after.ownerId||before.spaceId!==after.spaceId)throw auth();
 if(signal?.aborted)throw new DOMException('Aborted','AbortError');
 return{query,rows,coverage:c,detail,detailUnavailable};
}
