import {PlatformError} from '../platform/domain.ts';
import {assertLocalRequest,readJSONBody} from '../platform/request-boundary.ts';
import type {StorageReviewService} from './service.ts';

const path = '/api/platform/personal/storage-review';
type Options = {
  ownerId:string;
  baseURL:string;
  service?:Pick<StorageReviewService,'get'|'saveChecklist'|'saveDecision'>;
  assertOwner:()=>Promise<void>;
  assertWritable:()=>Promise<void>;
};

function respond(value:unknown,status=200,extra:Record<string,string>={}) {
  return Response.json(value,{status,headers:{
    'Cache-Control':'private, no-store',
    'Vary':'Cookie',
    'X-Content-Type-Options':'nosniff',
    'X-Robots-Tag':'noindex, nofollow, noarchive',
    ...extra,
  }});
}

export async function handleStorageReviewRequest(request:Request,options:Options):Promise<Response|null> {
  const url = new URL(request.url);
  if(url.pathname!==path)return null;
  assertLocalRequest(request,options.baseURL);
  if(request.headers.has('authorization'))throw new PlatformError(403,'OWNER_ONLY','资料审核仅限本人会话。');
  const guard = async(write=false)=>{
    if(request.signal.aborted)throw new PlatformError(409,'REQUEST_CANCELLED','请求已取消，请回读保存结果。');
    await options.assertOwner();
    if(write)await options.assertWritable();
    if(request.signal.aborted)throw new PlatformError(409,'REQUEST_CANCELLED','请求已取消，请回读保存结果。');
  };
  await guard();
  if(url.search)throw new PlatformError(400,'INVALID_QUERY','审核入口不支持额外查询参数。');
  const {service,ownerId}=options;
  if(!service)throw new PlatformError(503,'STORAGE_REVIEW_UNAVAILABLE','资料审核存储暂不可用。');
  if(request.method==='GET'){
    const review=await service.get(ownerId);
    await guard();
    return respond({review});
  }
  if(request.method!=='POST'&&request.method!=='PATCH')return respond({
    error:{code:'METHOD_NOT_ALLOWED',message:'此审核入口不支持该方法。'},
  },405,{Allow:'GET, POST, PATCH'});
  if(request.headers.get('origin')!==new URL(options.baseURL).origin)throw new PlatformError(403,'ORIGIN_DENIED','保存需要相同来源。');
  const input=await readJSONBody(request),key=request.headers.get('idempotency-key')??'';
  await guard(true);
  const review=request.method==='POST'
    ?await service.saveChecklist(ownerId,input,key,()=>guard(true))
    :await service.saveDecision(ownerId,input,key,()=>guard(true));
  return respond({review});
}
