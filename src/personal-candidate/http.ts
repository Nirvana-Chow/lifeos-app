import {PlatformError,validateId} from '../platform/domain.ts';
import {assertLocalRequest,readJSONBody} from '../platform/request-boundary.ts';
import {personalEntryType} from './service.ts';
import type {PersonalService,PersonalGuard} from './service.ts';
import type {PersonalType} from './config.ts';
export type PersonalHTTPGuards={assertOwner:PersonalGuard;assertWritable:PersonalGuard};
const respond=(value:unknown,status=200,extra:Record<string,string>={})=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Vary':'Cookie',...extra}});
/** Mount only after the platform origin/session/owner boundary. Guards must
 * re-read that same request identity and deployment permit, never client claims. */
export async function handlePersonalRequest(request:Request,owner:string,baseURL:string,service:PersonalService,guards:PersonalHTTPGuards):Promise<Response|null>{
 const url=new URL(request.url),match=/^\/api\/platform\/personal\/(todo|journal|project|domain|topic|person|health|overview|search|export)(?:\/([^/]+))?(?:\/(history))?\/?$/.exec(url.pathname);
 if(!match)return null;
 if(baseURL!==service.config.baseURL)throw new PlatformError(403,'ORIGIN_DENIED','本人空间来源无效。');
 assertLocalRequest(request,baseURL);
 const guard=async(write=false)=>{if(request.signal.aborted)throw new PlatformError(409,'REQUEST_CANCELLED','请求已取消，未确认保存。');await guards.assertOwner();if(write)await guards.assertWritable();if(request.signal.aborted)throw new PlatformError(409,'REQUEST_CANCELLED','请求已取消，未确认保存。');};
 await guard();const type=match[1];
 if(match[2]==='snapshot'&&!['overview','search','export'].includes(type)){if(request.method!=='GET'||url.search||match[3])throw new PlatformError(400,'INVALID_QUERY','完整快照仅可读取。');const items=(await service.currentSnapshot(owner)).filter(entry=>personalEntryType(entry,service.config.spaceId)===type);await guard();return respond({scope:'full-current-snapshot',items,total:items.length,truncated:false,observedAt:new Date().toISOString()});}
 const id=match[2]?validateId(match[2]):null,history=match[3]==='history';
 if(type==='overview'||type==='search'){if(id||history)throw new PlatformError(404,'NOT_FOUND','无此查询。');if(request.method!=='GET')return respond({error:{code:'METHOD_NOT_ALLOWED',message:'查询仅可读取。'}},405,{Allow:'GET'});const key=type==='overview'?'today':'q';if([...url.searchParams.keys()].some(k=>k!==key)||url.searchParams.getAll(key).length!==1)throw new PlatformError(400,'INVALID_QUERY','查询参数无效。');return respond(type==='overview'?await service.overview(owner,url.searchParams.get(key)!):await service.search(owner,url.searchParams.get(key)!));}
 const allowed=type==='export'||history?['GET']:id?['GET','PATCH']:['GET','POST'];
 if(!allowed.includes(request.method))return respond({error:{code:'METHOD_NOT_ALLOWED',message:'此本人空间操作不支持该方法。'}},405,{Allow:allowed.join(', ')});
 const queries=[...url.searchParams.keys()];if(queries.some(key=>key!=='limit')||url.searchParams.getAll('limit').length>1)throw new PlatformError(400,'INVALID_QUERY','读取参数无效。');const text=url.searchParams.get('limit'),limit=text===null?50:/^[1-9]\d{0,2}$/.test(text)?Number(text):NaN;
 if(type==='export'){if(id||history)throw new PlatformError(404,'NOT_FOUND','无此本人空间操作。');return respond(await service.exportSnapshot(owner,limit));}
 const personalType=type as PersonalType;
 if(request.method==='GET'){const value=history&&id?await service.history(owner,personalType,id,limit):id?{entry:await service.get(owner,personalType,id)}:await service.list(owner,personalType,limit);await guard();return respond(value);}
 if(request.headers.get('origin')!==new URL(baseURL).origin)throw new PlatformError(403,'ORIGIN_DENIED','本人空间保存需要相同来源。');
 await guard(true);const input=await readJSONBody(request),key=request.headers.get('idempotency-key')??'';
 const result=await service.mutate(owner,personalType,id,input,key,()=>guard(true));return respond(result,!id&&!result.duplicate?201:200);
}
