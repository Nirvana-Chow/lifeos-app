import {PlatformError,validateId} from '../platform/domain.ts';
import {assertLocalRequest,readJSONBody} from '../platform/request-boundary.ts';
import type {PersonalFinanceService} from './service.ts';
import type {FinanceMutationContext} from './contracts.ts';

export type PersonalFinanceHTTPContext={ownerId:string;baseURL:string;service?:PersonalFinanceService;assertOwner?:()=>Promise<void>;guard?:()=>Promise<void>;transactionGuard?:FinanceMutationContext['transactionGuard']};
const response=(value:unknown,status=200,headers:Record<string,string>={})=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',Vary:'Cookie',...headers}});
/** Mount after shared host/session/owner verification. This endpoint accepts no bearer authority. */
export async function handlePersonalFinance(request:Request,context:PersonalFinanceHTTPContext):Promise<Response|null>{
 const url=new URL(request.url),match=/^\/api\/platform\/personal\/finance(?:\/([^/]+))?(?:\/(history))?\/?$/.exec(url.pathname);
 if(!match)return null;
 assertLocalRequest(request,context.baseURL);
 if(request.headers.has('authorization'))throw new PlatformError(403,'OWNER_SESSION_REQUIRED','财务页面只接受已验证的本人会话。');
 const check=async(write=false)=>{if(request.signal.aborted)throw new PlatformError(409,'REQUEST_CANCELLED','请求已取消，保存结果需重新核对。');await context.assertOwner?.();if(write)await context.guard?.();if(request.signal.aborted)throw new PlatformError(409,'REQUEST_CANCELLED','请求已取消，保存结果需重新核对。');};
 await check();
 const part=match[1],history=match[2]==='history',status=part==='status'&&!history,snapshot=part==='snapshot'&&!history;
 const allowed=status||snapshot||history?['GET']:part?['GET','PATCH']:['GET','POST'];
 if(!allowed.includes(request.method))return response({error:{code:'METHOD_NOT_ALLOWED',message:'此财务操作不支持该方法。'}},405,{Allow:allowed.join(', ')});
 const params=[...url.searchParams.keys()];
 if(params.some(key=>part!==undefined||key!=='limit')||url.searchParams.getAll('limit').length>1||request.method!=='GET'&&params.length)throw new PlatformError(400,'INVALID_FINANCE_QUERY','财务读取参数无效。');
 if(request.method==='GET'&&request.body!==null)throw new PlatformError(400,'INVALID_FINANCE_QUERY','财务读取不能携带正文。');
 const {service,ownerId}=context;
 if(status){const value=service?service.status(ownerId):{scope:'personal-finance-v1',configured:false,writable:false,reason:'财务共享存储与权限尚未开放。'};await check();return response(value);}
 if(!service?.config.enabled)throw new PlatformError(503,'FINANCE_UNAVAILABLE','财务真实记录尚未开放，未确认保存。');
 if(request.method==='GET'){
  let value:unknown;
  if(snapshot)value=await service.snapshot(ownerId);
  else if(part){const id=validateId(part);value=history?await service.history(ownerId,id):{entry:await service.get(ownerId,id)};}
  else{const raw=url.searchParams.get('limit');if(raw!==null&&!/^[1-9]\d{0,3}$/.test(raw))throw new PlatformError(400,'INVALID_FINANCE_QUERY','读取上限无效。');value=await service.list(ownerId,raw===null?100:Number(raw));}
  await check();return response(value);
 }
 if(request.headers.get('origin')!==new URL(context.baseURL).origin)throw new PlatformError(403,'ORIGIN_DENIED','保存财务记录需要相同来源。');
 await check(true);
 const input=await readJSONBody(request),key=request.headers.get('idempotency-key')??'',id=part?validateId(part):null;
 const result=await service.mutate(ownerId,id,input,key,{assertActor:()=>check(true),transactionGuard:context.transactionGuard});
 await check(true);return response(result,!id&&!result.duplicate?201:200);
}

export const handlePersonalFinanceRequest=handlePersonalFinance;
