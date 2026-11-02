import type {SearchQuery,SearchHit,SearchDocument,SourceResponse} from '../search-candidate/contracts.ts';
import type {TimelineQuery,TimelineItem} from '../timeline-candidate/contracts.ts';
import type {RecordWindowResponse} from '../platform/window-contracts.ts';
import {parseSearchQuery} from '../search-candidate/service.ts';
import {parseTimelineQuery} from '../timeline-candidate/domain.ts';
import {object} from '../platform/domain.ts';
import {SearchClient,SearchRequestError,parseSearchWindowHit} from '../search-workbench/client.ts';
import {parseTimelineWindowItem} from '../timeline-workbench/client.ts';

export type RecordWindowMode='search'|'timeline';
export type WindowSourceResult={source:SourceResponse;selected:SearchDocument|null;currentChanged:boolean;selectedOutsideHistory:boolean};
export class RecordWindowError extends Error{
 readonly status:number;readonly code:string;
 constructor(status:number,code:string,message:string){super(message);this.name='RecordWindowError';this.status=status;this.code=code;}
}
export class RecordWindowCancelled extends RecordWindowError{constructor(){super(0,'CANCELLED','已取消读取，可重试同一页。');this.name='RecordWindowCancelled';}}
export const isWindowIdentityFailure=(cause:unknown):cause is RecordWindowError=>cause instanceof RecordWindowError&&(cause.status===401||cause.status===403||cause.code==='IDENTITY_UNAVAILABLE');
const invalid=()=>new RecordWindowError(0,'INVALID_RESPONSE','读取结果无法核对，请重试同一页。');
const identityError=(status:number)=>new RecordWindowError(status,status===401?'LOGIN_REQUIRED':'ACCOUNT_NOT_ALLOWED',status===401?'登录已失效，已清除读取内容。':'当前账号不能查看此范围，已清除读取内容。');
const cursorValid=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=1800&&/^[A-Za-z0-9_-]+$/.test(value);
const params=(input:object)=>new URLSearchParams(Object.entries(input).filter(([,value])=>value!==undefined&&value!=='').map(([key,value])=>[key,String(value)]));
function normalize(mode:RecordWindowMode,input:Partial<SearchQuery>|Partial<TimelineQuery>):SearchQuery|TimelineQuery{
 try{if(mode!=='search'&&mode!=='timeline')throw invalid();const query=mode==='search'?parseSearchQuery(params(input)):parseTimelineQuery(params(input));if(query.includeSynthetic!==true||query.type==='calendar')throw invalid();return query;}
 catch{throw new RecordWindowError(400,'INVALID_WINDOW_QUERY','请核对条件，并确认本次仅查询获准的虚构评审记录；此窗口不包含日历。');}
}
function instant(value:unknown){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==(value.includes('.')?value:value.replace('Z','.000Z')))throw invalid();}
function parsePage(value:unknown,mode:RecordWindowMode,query:SearchQuery|TimelineQuery,cursor:string|null):RecordWindowResponse{
 try{
  const raw=object(value,['mode','query','items','observedAt','syntheticIncluded','dataStatus','page']);
  const echo=object(raw.query,mode==='search'?['q','from','to','type','includeSynthetic','limit']:['axis','from','to','timeZone','type','includeSynthetic','limit']);
  if(raw.mode!==mode||raw.syntheticIncluded!==true||raw.dataStatus!=='isolated-test-drafts'||Object.keys(echo).length!==Object.keys(query).length||Object.entries(query).some(([key,value])=>echo[key]!==value)||!Array.isArray(raw.items)||raw.items.length>query.limit!)throw invalid();
  instant(raw.observedAt);
  const p=object(raw.page,['cursorUsed','nextCursor','hasMore','scanned','returned','limit','ordering','consistency','compatibilityScope','filtering','totalMatches','calendarIncluded','newerRecordsRequireRestart','revisionsMayChange','backdatedInsertionsMayBeMissed']);
  const expectedOrdering=mode==='timeline'&&(query as TimelineQuery).axis==='changed'?'history-createdAt-desc-id-desc-revision-desc':'record-createdAt-desc-id-desc';
  if(p.cursorUsed!==cursor||p.limit!==query.limit||!Number.isSafeInteger(p.scanned)||Number(p.scanned)<raw.items.length||Number(p.scanned)<0||Number(p.scanned)>query.limit!||p.returned!==raw.items.length||typeof p.hasMore!=='boolean'||(p.hasMore?(!cursorValid(p.nextCursor)||p.nextCursor===cursor||p.scanned!==p.limit):p.nextCursor!==null)||p.ordering!==expectedOrdering||p.consistency!=='per-page-read-not-snapshot'||p.compatibilityScope!=='scanned-versions-and-originals'||p.filtering!=='bounded-window-post-filter'||p.totalMatches!==null||p.calendarIncluded!==false||p.newerRecordsRequireRestart!==true||p.revisionsMayChange!==true||p.backdatedInsertionsMayBeMissed!==true)throw invalid();
  const items=raw.items.map(item=>mode==='search'?parseSearchWindowHit(item):parseTimelineWindowItem(item,query as TimelineQuery));
  if(new Set(items.map(item=>'eventKey'in item?item.eventKey:item.kind+':'+item.id)).size!==items.length||items.some(item=>item.kind==='calendar'||query.type&&item.type!==query.type&&item.kind!==query.type||query.from&&(!item.date||item.date<query.from)||query.to&&(!item.date||item.date>query.to)))throw invalid();
  return structuredClone({...raw,query,items,page:p}) as RecordWindowResponse;
 }catch{throw invalid();}
}

/** Owns one account binding; every transport, body and source read is bounded. */
export class RecordWindowClient{
 private readonly transport:typeof fetch;private ownerId:string|undefined;
 private readonly identityListeners=new Set<(error:RecordWindowError)=>void>();
 constructor(transport:typeof fetch=fetch){this.transport=transport;}
 onIdentityFailure(listener:(error:RecordWindowError)=>void){this.identityListeners.add(listener);return()=>{this.identityListeners.delete(listener);};}
 private failIdentity(error:RecordWindowError){for(const listener of this.identityListeners)listener(error);return error;}
 private async request(path:string,signal?:AbortSignal):Promise<{response:Response;body:string}>{
  if(signal?.aborted)throw new RecordWindowCancelled();
  const deadline=AbortSignal.timeout(20_000),combined=AbortSignal.any([deadline,...(signal?[signal]:[])]);
  let rejectAbort!:(reason:unknown)=>void;
  const aborted=new Promise<never>((_,reject)=>{rejectAbort=reject;});
  const onAbort=()=>rejectAbort(signal?.aborted?new RecordWindowCancelled():new RecordWindowError(0,'READ_TIMEOUT','读取超时，可重试同一页。'));
  combined.addEventListener('abort',onAbort,{once:true});
  try{
   const pending=this.transport(path,{method:'GET',credentials:'same-origin',cache:'no-store',signal:combined});
   // An ignored abort cannot publish data, but a late forbidden response still revokes visible scope.
   void pending.then(response=>{if(response.status===401||response.status===403)this.failIdentity(identityError(response.status));},()=>{});
   const response=await Promise.race([pending,aborted]);
   if(response.status===401||response.status===403)throw identityError(response.status);
   if(Number(response.headers.get('content-length'))>2_000_000)throw invalid();
   const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
   try{if(reader){for(;;){const next=await Promise.race([reader.read(),aborted]);if(next.done)break;size+=next.value.byteLength;if(size>2_000_000)throw invalid();chunks.push(next.value);}}}
   catch(cause){if(reader)void reader.cancel().catch(()=>{});throw cause;}
   const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}
   const body=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
   if(!response.ok){let code='';try{const raw=JSON.parse(body);if(raw?.error?.code==='DATA_READER_INCOMPATIBLE')code='DATA_READER_INCOMPATIBLE';}catch{}
    throw new RecordWindowError(response.status,code||'READ_UNAVAILABLE',code?'当前读者不支持本次扫描中的记录，已停止读取。':response.status>=500?'读取服务暂不可用，可重试同一页。':'读取未完成，请核对条件后重试同一页。');}
   if(response.status!==200)throw invalid();return{response,body};
  }catch(cause){if(cause instanceof RecordWindowError)throw cause;if(signal?.aborted)throw new RecordWindowCancelled();if(deadline.aborted)throw new RecordWindowError(0,'READ_TIMEOUT','读取超时，可重试同一页。');throw new RecordWindowError(0,'NETWORK_UNAVAILABLE','暂时无法读取，可重试同一页。');}
  finally{combined.removeEventListener('abort',onAbort);}
 }
 private pin(value:unknown):string{
  if(value===null)throw identityError(401);
  if(!value||typeof value!=='object')throw invalid();const raw=value as Record<string,any>;
  if(!raw.user||!raw.session||typeof raw.user.id!=='string'||!raw.user.id.trim()||raw.user.id.length>256||/[\u0000-\u001f\u007f]/.test(raw.user.id)||raw.user.id!==raw.session.userId)throw invalid();
  if(this.ownerId!==undefined&&this.ownerId!==raw.user.id)throw new RecordWindowError(403,'ACCOUNT_CHANGED','登录账号已变化，已清除原账号内容。请重新加载页面。');
  this.ownerId=raw.user.id;return raw.user.id;
 }
 async identity(signal?:AbortSignal):Promise<string>{
  try{const result=await this.request('/api/platform/auth/get-session',signal);if(signal?.aborted)throw new RecordWindowCancelled();return this.pin(JSON.parse(result.body));}
  catch(cause){if(cause instanceof RecordWindowCancelled)throw cause;const error=isWindowIdentityFailure(cause)?cause:new RecordWindowError(cause instanceof RecordWindowError?cause.status:0,'IDENTITY_UNAVAILABLE','暂时无法核对账号，已清除读取内容。');throw this.failIdentity(error);}
 }
 private async read<T>(run:()=>Promise<T>,signal?:AbortSignal):Promise<T>{
  await this.identity(signal);let result:T|undefined,error:unknown;
  try{result=await run();}catch(cause){error=cause;}
  // Cancellation stops data; fresh postflight still establishes whether its position may be retried.
  await this.identity(signal?.aborted?undefined:signal);
  if(isWindowIdentityFailure(error))throw this.failIdentity(error);if(signal?.aborted)throw new RecordWindowCancelled();if(error!==undefined)throw error;return result as T;
 }
 async page(mode:RecordWindowMode,inputQuery:Partial<SearchQuery>|Partial<TimelineQuery>,cursor:string|null=null,signal?:AbortSignal):Promise<RecordWindowResponse>{
  const query=normalize(mode,inputQuery);if(cursor!==null&&!cursorValid(cursor))throw new RecordWindowError(400,'INVALID_CURSOR','翻页位置无效，请重新开始查询。');
  return this.read(async()=>{const p=params(query);if(cursor!==null)p.set('cursor',cursor);const result=await this.request('/api/platform/'+mode+'/page?'+p,signal);if(signal?.aborted)throw new RecordWindowCancelled();let value:unknown;try{value=JSON.parse(result.body);}catch{throw invalid();}return parsePage(value,mode,query,cursor);},signal);
 }
 async source(item:SearchHit|TimelineItem,signal?:AbortSignal):Promise<WindowSourceResult>{
  if(this.ownerId===undefined)throw new RecordWindowError(0,'IDENTITY_UNAVAILABLE','请先读取一页以核对来源账号。');
  if(item.kind==='calendar')throw new RecordWindowError(400,'INVALID_SOURCE','此窗口不包含日历来源。');
  return this.read(async()=>{
   let transportFailure:RecordWindowError|undefined;
   const bounded:typeof fetch=async(input)=>{try{const result=await this.request(String(input),signal);if(String(input).endsWith('/auth/get-session'))this.pin(JSON.parse(result.body));return new Response(result.body,{status:result.response.status,headers:{'content-type':'application/json'}});}catch(cause){if(cause instanceof RecordWindowError)transportFailure=cause;throw cause;}};
   let source:SourceResponse;try{source=await new SearchClient(bounded).source(item.kind,item.id,true);}catch(cause){if(transportFailure)throw transportFailure;if(cause instanceof SearchRequestError)throw new RecordWindowError(cause.status,cause.code,cause.message);throw cause;}
   if([source.current,source.original,...source.history].some(doc=>doc.id!==item.id||doc.kind!==item.kind||doc.type!==item.type||doc.sourceId!==item.sourceId)||source.current.revision<('currentRevision'in item?item.currentRevision:item.revision))throw invalid();
   // Original input is separately projected from the immutable source; it may
   // differ from the normalized saved revision even when its revision is 1.
   const selected=[source.current,...source.history].find(doc=>doc.revision===item.revision)??null;
   if(selected?selected.title!==item.title:!source.historyTruncated)throw invalid();
   return{source,selected,currentChanged:source.current.revision>('currentRevision'in item?item.currentRevision:item.revision),selectedOutsideHistory:selected===null};
  },signal);
 }
}
