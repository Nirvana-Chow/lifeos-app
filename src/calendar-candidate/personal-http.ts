import {PlatformError} from '../platform/domain.ts';
import {readJSONBody} from '../platform/request-boundary.ts';
import type {Transaction} from '../platform/contracts.ts';
import type {PersonalCalendarService,CalendarAuthorityGuard} from './personal-service.ts';
const response=(value:unknown,status=200,headers:Record<string,string>={})=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',Vary:'Cookie',...headers}});
export type PersonalCalendarHTTPContext={ownerId:string;baseURL:string;service?:PersonalCalendarService;guard?:CalendarAuthorityGuard;transactionGuard?:(tx:Transaction)=>Promise<void>};
/** Mount only after the shared host/session/owner/MFA boundary. No JSON field constructs an actor. */
export async function handlePersonalCalendar(request:Request,context:PersonalCalendarHTTPContext):Promise<Response|null>{
 const url=new URL(request.url),match=/^\/api\/platform\/personal\/calendar(?:\/([^/]+))?(?:\/(history))?\/?$/.exec(url.pathname);if(!match)return null;
 const id=match[1],action=match[2],status=id==='status'&&!action,references=id==='references'&&!action,allowed=status||references||action==='history'?['GET']:id?['GET','PATCH']:['GET','POST'];
 if(!allowed.includes(request.method))return response({error:{code:'METHOD_NOT_ALLOWED',message:'此日程操作不支持该方法。'}},405,{Allow:allowed.join(', ')});
 const {ownerId,service}=context;
 if(status){if(url.search)return response({error:{code:'INVALID_CALENDAR_QUERY',message:'状态读取不接受查询参数。'}},400);return response(service?.config.enabled?service.status(ownerId):{scope:'personal-calendar-v1',configured:false,writable:false,reason:'日程共享存储与权限尚未开放。'});}
 if(request.method!=='GET'&&request.headers.get('origin')!==new URL(context.baseURL).origin)throw new PlatformError(403,'ORIGIN_DENIED','修改日程需要相同来源。');
 if(!service?.config.enabled)throw new PlatformError(503,'CALENDAR_UNAVAILABLE','个人日程尚未开放，没有确认保存。');
 if(request.method==='GET'){
  if(references){if(url.search)throw new PlatformError(400,'INVALID_CALENDAR_QUERY','关联选项读取不接受查询参数。');return response({references:await service.references(ownerId)});}
  if(id){if(url.search)throw new PlatformError(400,'INVALID_CALENDAR_QUERY','详情读取不接受查询参数。');return response(action==='history'?await service.history(ownerId,id):{entry:await service.get(ownerId,id)});}
  const query:Record<string,unknown>={};for(const[key,value]of url.searchParams){if(Object.hasOwn(query,key))throw new PlatformError(400,'INVALID_CALENDAR_QUERY','查询参数不能重复。');query[key]=value;}
  if(query.limit!==undefined){if(typeof query.limit!=='string'||!/^[1-9]\d*$/.test(query.limit))throw new PlatformError(400,'INVALID_CALENDAR_QUERY','读取上限需要正整数。');query.limit=Number(query.limit);}
  return response(await service.snapshot(ownerId,query));
 }
 const body=await readJSONBody(request),key=request.headers.get('idempotency-key')??'';
 const result=await service.mutate(ownerId,id??null,body,key,context.guard,context.transactionGuard);return response(result,!id&&!result.duplicate?201:200);
}
/** This switch is a source candidate only. It neither changes grants nor performs schema setup. */
export function readPersonalCalendarModuleFlag(env:Record<string,string|undefined>):boolean{const value=env.LIFEOS_PERSONAL_CALENDAR;if(value===undefined)return false;if(value!=='personal-calendar-v1')throw Error('Explicit personal calendar qualification required');return true;}
