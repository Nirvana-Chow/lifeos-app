import {PlatformError} from '../platform/domain.ts';
import type {DraftService} from '../platform/service.ts';
import type {CalendarService} from '../calendar-candidate/service.ts';
import {parseTimelineQuery,parseTimelineComparisonQuery} from './domain.ts';
import {TimelineService} from './service.ts';
const respond=(value:unknown,status=200,extra:Record<string,string>={})=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Vary':'Cookie',...extra}});
/** Mounted after the shared host, session and allowed-owner gates. */
export async function handleTimelineRequest(drafts:DraftService,calendar:CalendarService|undefined,owner:string,request:Request,url=new URL(request.url),now:()=>Date=()=>new Date()):Promise<Response|null>{
 if(!/^\/api\/platform\/timeline(?:\/compare)?\/?$/.test(url.pathname))return null;
 if(request.method!=='GET')return respond({error:{code:'METHOD_NOT_ALLOWED',message:'时间线只支持读取。'}},405,{Allow:'GET'});
 try{
  if(request.body!==null)throw new PlatformError(400,'INVALID_TIMELINE_QUERY','时间线读取请求不能携带正文。');
  const service=new TimelineService(drafts,calendar,now);
  return respond(/\/compare\/?$/.test(url.pathname)?await service.compare(owner,parseTimelineComparisonQuery(url.searchParams)):await service.timeline(owner,parseTimelineQuery(url.searchParams)));
 }catch(cause){
  if(cause instanceof PlatformError&&cause.code==='DATA_READER_INCOMPATIBLE')return respond({error:{code:cause.code,message:'记录类型与当前读者不兼容，已停止读取；请使用兼容版本或完整原样导出。'}},409);
  const status=cause instanceof PlatformError&&cause.status===400?400:503;
  return respond({error:{code:status===400?'INVALID_TIMELINE_QUERY':'TIMELINE_UNAVAILABLE',message:status===400?'请核对时间轴、日期、时区、类型和结果上限。':'时间线暂时无法读取，请稍后重试。'}},status);
 }
}
