import type {SearchQuery,SearchKind,SearchHit,SearchDocument,SearchResponse,SourceResponse} from '../search-candidate/contracts.ts';
import {parseSearchQuery,validateSearchKind} from '../search-candidate/service.ts';
import {validateId,validateRevision,object} from '../platform/domain.ts';
import {validateCalendarDate} from '../calendar-candidate/domain.ts';
export class SearchRequestError extends Error{
 readonly status:number;readonly code:string;
 constructor(status:number,code:string,message:string){super(message);this.name='SearchRequestError';this.status=status;this.code=code;}
}
export function isSearchSessionFailure(cause:unknown):boolean{return cause instanceof SearchRequestError&&(cause.status===401||cause.status===403||cause.code==='IDENTITY_UNAVAILABLE');}
const messages:Record<string,string>={DATA_READER_INCOMPATIBLE:'当前读者不支持部分记录，已停止读取；请使用兼容版本或完整原样导出。',LOGIN_REQUIRED:'登录已失效，请重新登录后搜索。',ACCOUNT_NOT_ALLOWED:'当前账号不能查看此搜索范围。',ACCOUNT_CHANGED:'登录账号已变化，已停止显示原账号内容。请重新加载页面。',INVALID_SEARCH_QUERY:'请核对关键词、类型、日期范围和结果上限。',INVALID_DATE:'请选择有效的年月日。',INVALID_ID:'来源标识无效，请重新搜索。',NOT_FOUND:'来源不存在，或当前账号不能访问。',CALENDAR_UNAVAILABLE:'日历来源暂未启用。'};
const invalid=()=>new SearchRequestError(0,'INVALID_RESPONSE','读取结果无法核对，请重新搜索。');
const isObject=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function text(value:unknown,max:number,empty=false):string{if(typeof value!=='string'||value.length>max||value.includes('\0')||!empty&&!value.trim())throw invalid();return value;}
function parseHit(value:unknown,document=false):SearchHit|SearchDocument{
 const raw=object(value,['id','kind','type','title','date','sourceId','sourceSystem','snippet','revision',...(document?['fields']:[])]);
 const id=validateId(raw.id),sourceId=validateId(raw.sourceId),kind=validateSearchKind(text(raw.kind,16)),type=text(raw.type,32);validateRevision(raw.revision);
 if(id!==raw.id||sourceId!==raw.sourceId||raw.sourceSystem!=='website'||!/^[a-z][a-z0-9-]{0,31}$/.test(type))throw invalid();
 text(raw.title,240);text(raw.snippet,224,true);if(raw.date!==null)validateCalendarDate(raw.date);
 if(document){if(!Array.isArray(raw.fields)||raw.fields.length>64)throw invalid();for(const field of raw.fields){const item=object(field,['label','value']);text(item.label,80);text(item.value,16384,true);}}
 return structuredClone({...raw,kind}) as SearchHit|SearchDocument;
}
export function createSearchReadFence(){let generation=0,disposed=false;return{begin(){const version=++generation;return()=>!disposed&&version===generation;},invalidate(){generation++;},dispose(){disposed=true;generation++;}};}
export class SearchClient{
 private transport:typeof fetch;private accountId:string|undefined;
 constructor(transport:typeof fetch=fetch){this.transport=transport;}
 private async request(path:string):Promise<unknown>{
  let response:Response;try{response=await this.transport(path,{method:'GET',credentials:'same-origin',cache:'no-store'});}catch{throw new SearchRequestError(0,'NETWORK_UNAVAILABLE','暂时无法读取搜索内容，请重试。');}
  if(response.status>=500)throw new SearchRequestError(response.status,'SERVICE_UNAVAILABLE','搜索服务暂不可用，请稍后重试。');
  let value:unknown;try{const raw=await response.text();if(raw.length>2_000_000)throw invalid();value=JSON.parse(raw);}catch{throw invalid();}
  if(!response.ok){const code=isObject(value)&&isObject(value.error)&&typeof value.error.code==='string'?value.error.code:'';throw new SearchRequestError(response.status,code,messages[code]??'读取请求被拒绝，请核对输入后重试。');}
  if(response.status!==200)throw invalid();return value;
 }
 private async identity():Promise<string>{
  try{const value=await this.request('/api/platform/auth/get-session');if(value===null)throw new SearchRequestError(401,'LOGIN_REQUIRED',messages.LOGIN_REQUIRED);
   if(!isObject(value)||!isObject(value.user)||!isObject(value.session)||value.user.id!==value.session.userId)throw invalid();return text(value.user.id,256);
  }catch(cause){if(isSearchSessionFailure(cause))throw cause;throw new SearchRequestError(cause instanceof SearchRequestError?cause.status:0,'IDENTITY_UNAVAILABLE','暂时无法核对当前账号，已清除搜索内容。');}
 }
 private async read(path:string):Promise<unknown>{
  const owner=await this.identity();if(this.accountId!==undefined&&owner!==this.accountId)throw new SearchRequestError(403,'ACCOUNT_CHANGED',messages.ACCOUNT_CHANGED);
  this.accountId=owner;const value=await this.request(path);if(await this.identity()!==owner)throw new SearchRequestError(403,'ACCOUNT_CHANGED',messages.ACCOUNT_CHANGED);return value;
 }
 async search(input:SearchQuery):Promise<SearchResponse>{
  let query:SearchQuery;try{query=parseSearchQuery(new URLSearchParams(Object.entries(input).filter(([,value])=>value!==undefined).map(([key,value])=>[key,String(value)])));}catch{throw new SearchRequestError(400,'INVALID_SEARCH_QUERY',messages.INVALID_SEARCH_QUERY);}
  const params=new URLSearchParams(Object.entries(query).map(([key,value])=>[key,String(value)])),value=await this.read('/api/platform/search?'+params);
  try{
   const raw=object(value,['items','limit','truncated','scanned','dataStatus','syntheticIncluded','coverage']);
   if(!Array.isArray(raw.items)||raw.limit!==query.limit||raw.items.length>query.limit!||typeof raw.truncated!=='boolean'||!Number.isInteger(raw.scanned)||Number(raw.scanned)<raw.items.length||Number(raw.scanned)>2000||raw.dataStatus!=='isolated-test-drafts'||raw.syntheticIncluded!==query.includeSynthetic)throw invalid();
   const coverage=object(raw.coverage,['scanLimit','scanTruncated','calendarAvailable']);if(coverage.scanLimit!==2000||typeof coverage.scanTruncated!=='boolean'||typeof coverage.calendarAvailable!=='boolean'||coverage.scanTruncated&&(!raw.truncated||raw.scanned!==2000))throw invalid();
   const items=raw.items.map(item=>parseHit(item)as SearchHit);if(new Set(items.map(item=>item.kind+':'+item.id)).size!==items.length)throw invalid();
   if(!query.includeSynthetic&&(items.length||raw.scanned!==0||raw.truncated))throw invalid();
   if(items.some(item=>!coverage.calendarAvailable&&item.kind==='calendar'||query.type&&item.type!==query.type&&item.kind!==query.type||query.from&&(!item.date||item.date<query.from)||query.to&&(!item.date||item.date>query.to)))throw invalid();
   return structuredClone({...raw,items}) as SearchResponse;
  }catch{throw invalid();}
 }
 async source(inputKind:SearchKind,inputId:string,includeSynthetic:boolean):Promise<SourceResponse>{
  let kind:SearchKind,id:string;try{kind=validateSearchKind(inputKind);id=validateId(inputId);if(includeSynthetic!==true)throw invalid();}catch{throw new SearchRequestError(400,'INVALID_SEARCH_QUERY',messages.INVALID_SEARCH_QUERY);}
  const value=await this.read('/api/platform/search/source/'+kind+'/'+id+'?includeSynthetic=true');
  try{
   const raw=object(value,['current','original','history','historyLimit','historyTruncated','dataStatus','syntheticIncluded']);
   if(raw.dataStatus!=='isolated-test-drafts'||raw.syntheticIncluded!==true||raw.historyLimit!==20||typeof raw.historyTruncated!=='boolean'||!Array.isArray(raw.history)||raw.history.length>20)throw invalid();
   const current=parseHit(raw.current,true)as SearchDocument,original=parseHit(raw.original,true)as SearchDocument,history=raw.history.map(item=>parseHit(item,true)as SearchDocument);
   if([current,original,...history].some(doc=>doc.id!==id||doc.kind!==kind||doc.sourceId!==current.sourceId||doc.type!==current.type||doc.revision>current.revision)||history.some((doc,index)=>index>0&&doc.revision>=history[index-1].revision))throw invalid();
   return{current,original,history,historyLimit:20,historyTruncated:raw.historyTruncated,dataStatus:'isolated-test-drafts',syntheticIncluded:true};
  }catch{throw invalid();}
 }
}

export const parseSearchWindowHit=(value:unknown)=>parseHit(value) as SearchHit;
