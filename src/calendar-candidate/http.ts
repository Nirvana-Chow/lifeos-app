import type {CalendarService} from './service.ts';
import {PlatformError} from '../platform/domain.ts';
import {readJSONBody} from '../platform/request-boundary.ts';
const response=(value:unknown,status=200,extra:Record<string,string>={})=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Vary':'Cookie',...extra}});
/** Only call behind the existing host/session/allowed-owner boundary. owner never comes from JSON. */
export async function handleCalendar(request:Request,owner:string,baseURL:string,service?:CalendarService):Promise<Response|null>{
 const url=new URL(request.url),match=/^\/api\/platform\/calendar(?:\/([^/]+))?(?:\/(history|cancel))?\/?$/.exec(url.pathname);if(!match)return null;
 const id=match[1],action=match[2],allowed=action==='history'?['GET']:action==='cancel'?['POST']:id?['GET','PATCH']:['GET','POST'];
 if(!allowed.includes(request.method))return response({error:{code:'METHOD_NOT_ALLOWED',message:'此日历操作不支持该方法。'}},405,{Allow:allowed.join(', ')});
 if(request.method!=='GET'&&request.headers.get('origin')!==new URL(baseURL).origin)throw new PlatformError(403,'ORIGIN_DENIED','修改日历需要相同来源。');
 if(!service)throw new PlatformError(503,'CALENDAR_UNAVAILABLE','站内日历候选存储尚未启用，没有确认保存。');
 if(request.method==='GET'){
  if(action==='history')return response({history:await service.history(owner,id)});
  if(id)return response({entry:await service.get(owner,id)});
  const query:Record<string,string>={};for(const[key,value]of url.searchParams){if(key in query)throw new PlatformError(400,'INVALID_QUERY','查询参数不能重复。');query[key]=value;}
  return response({entries:await service.list(owner,query),dataStatus:'isolated-synthetic-calendar'});
 }
 const body=await readJSONBody(request),key=request.headers.get('idempotency-key')??'';
 const result=action==='cancel'?await service.cancel(owner,id,body,key):id?await service.update(owner,id,body,key):await service.create(owner,body,key);
 return response(result,!id&&!result.duplicate?201:200);
}
