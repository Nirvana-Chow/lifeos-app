import {PlatformError} from '../platform/domain.ts';
import {assertLocalRequest,readJSONBody} from '../platform/request-boundary.ts';
import type {PersonalHTTPGuards} from '../personal-candidate/http.ts';
import type {RequirementsService} from './service.ts';
import {requirementId} from './domain.ts';
import {readLifeOSDevelopmentProgress} from '../ui-review/development-project-progress.ts';
const respond=(value:unknown,status=200,extra:Record<string,string>={})=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff',...extra}});
export async function handleRequirementsRequest(request:Request,owner:string,service:RequirementsService,guards:PersonalHTTPGuards & {storageVerified:boolean}):Promise<Response|null>{
 const url=new URL(request.url),match=/^\/api\/platform\/personal\/requirements(?:\/([^/]+))?(?:\/(history))?\/?$/.exec(url.pathname);
 if(!match)return null;
 if(service.config.requirementsEnabled!==true)return respond({error:{code:'REQUIREMENTS_DISABLED',message:'需求持久化尚未开放。'}},404);
 assertLocalRequest(request,service.config.baseURL);
 if(request.headers.has('authorization'))throw new PlatformError(403,'OWNER_ONLY','需求网页入口仅限当前本人 MFA 会话。');
 const guard=async(write=false)=>{if(request.signal.aborted)throw new PlatformError(409,'REQUEST_CANCELLED','请求已取消，结果未确认。');await guards.assertOwner();if(write)await guards.assertWritable();if(request.signal.aborted)throw new PlatformError(409,'REQUEST_CANCELLED','请求已取消，结果未确认。');};
 await guard();
 const progress=match[1]==='development-progress',snapshot=match[1]==='snapshot';
 const id=match[1]&&!snapshot&&!progress?requirementId(match[1]):null,history=!!match[2];
 const allowed=snapshot||progress||history?['GET']:id?['GET','PATCH']:['POST'];
 if(!allowed.includes(request.method))return respond({error:{code:'METHOD_NOT_ALLOWED',message:'此需求操作不支持该方法。'}},405,{Allow:allowed.join(', ')});
 if(history){if(!id)throw new PlatformError(404,'NOT_FOUND','无此需求历史。');if([...url.searchParams.keys()].some(k=>k!=='limit')||url.searchParams.getAll('limit').length>1)throw new PlatformError(400,'INVALID_QUERY','读取参数无效。');const raw=url.searchParams.get('limit'),limit=raw===null?50:/^[1-9]\d{0,2}$/.test(raw)?Number(raw):NaN;const result=await service.history(owner,id,limit);await guard();return respond(result);}
 if(url.search)throw new PlatformError(400,'INVALID_QUERY','需求操作不支持额外查询参数。');
 if(progress){
  if(!guards.storageVerified)throw new PlatformError(503,'PERSONAL_STORAGE_UNAVAILABLE','本人记录存储尚未核验。');
  const result=readLifeOSDevelopmentProgress(await service.snapshot(owner));
  await guard();
  return respond(result);
 }
 if(request.method==='GET'){const result=snapshot?await service.snapshot(owner):{entry:await service.get(owner,id!)};await guard();return respond(result);}
 if(request.headers.get('origin')!==new URL(service.config.baseURL).origin)throw new PlatformError(403,'ORIGIN_DENIED','需求保存需要相同来源。');
 const input=await readJSONBody(request);await guard(true);
 const result=await service.mutate(owner,id,input,request.headers.get('idempotency-key')??'',()=>guard(true));
 return respond(result,!id&&!result.duplicate?201:200);
}
