import type {DraftService} from '../platform/service.ts';
import type {CalendarService} from '../calendar-candidate/service.ts';
import {PlatformError} from '../platform/domain.ts';
import {SearchService,parseSearchQuery} from './service.ts';
const respond=(value:unknown,status=200,extra:Record<string,string>={})=>{
 const body=JSON.stringify(value),oversized=body.length>2_000_000;
 return new Response(oversized?JSON.stringify({error:{code:'SEARCH_UNAVAILABLE',message:'来源内容超过本次读取上限，请缩小范围。'}}):body,{status:oversized?503:status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Vary':'Cookie',...extra}});
};
/** Called only after the host/session/allowed-owner boundary. The owner is never
 * accepted from URL, body, headers, source metadata or a repository response. */
export async function handleSearchRequest(drafts:DraftService,calendar:CalendarService|undefined,owner:string,request:Request,url=new URL(request.url)):Promise<Response|null>{
 const match=/^\/api\/platform\/search(?:\/source\/([^/]+)\/([^/]+))?\/?$/.exec(url.pathname);if(!match)return null;
 if(request.method!=='GET')return respond({error:{code:'METHOD_NOT_ALLOWED',message:'搜索和来源回看只支持读取。'}},405,{Allow:'GET'});
 try{
  if(request.body!==null)throw new PlatformError(400,'INVALID_SEARCH_QUERY','读取请求不能携带正文。');
  const service=new SearchService(drafts,calendar);
  if(match[1]){for(const[key]of url.searchParams)if(key!=='includeSynthetic')throw new PlatformError(400,'INVALID_SEARCH_QUERY','来源请求包含未知字段。');const query=parseSearchQuery(url.searchParams);return respond(await service.source(owner,match[1],match[2],query.includeSynthetic));}
  return respond(await service.search(owner,parseSearchQuery(url.searchParams)));
 }catch(cause){
  if(cause instanceof PlatformError&&cause.code==='DATA_READER_INCOMPATIBLE')return respond({error:{code:cause.code,message:'记录类型与当前读者不兼容，已停止读取；请使用兼容版本或完整原样导出。'}},409);
  const status=cause instanceof PlatformError&&[400,404,503].includes(cause.status)?cause.status:503,code=cause instanceof PlatformError&&['INVALID_SEARCH_QUERY','INVALID_DATE','INVALID_ID','NOT_FOUND','CALENDAR_UNAVAILABLE'].includes(cause.code)?cause.code:'SEARCH_UNAVAILABLE';
  const message=status===400?'请核对搜索参数、来源 ID 和日期范围。':status===404?'没有可访问的来源。':'搜索或来源暂时无法读取，请稍后重试。';return respond({error:{code,message}},status);
 }
}
