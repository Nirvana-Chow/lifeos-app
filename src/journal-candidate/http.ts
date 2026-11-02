import type {JournalService} from './service.ts';
import {PlatformError} from '../platform/domain.ts';
import {readJSONBody} from '../platform/request-boundary.ts';

const respond=(value:unknown,status=200,extra:Record<string,string>={})=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Vary':'Cookie',...extra}});

/** Mount inside createPlatformHandler AFTER its origin, session and owner checks.
 * PlatformError and storage errors intentionally use that handler's error envelope.
 * No independent repository, authentication system or journal writer is created.
 */
export async function handleJournal(request:Request,owner:string,baseURL:string,service:JournalService):Promise<Response|null>{
 const url=new URL(request.url),match=/^\/api\/platform\/journal(?:\/([^/]+))?(?:\/(history))?\/?$/.exec(url.pathname);
 if(!match)return null;
 const id=match[1]??null,history=match[2]==='history',view={includeSynthetic:url.searchParams.get('includeSynthetic')==='1'};
 const allowed=history?['GET']:id?['GET','PATCH']:['GET','POST'];
 if(!allowed.includes(request.method))return respond({error:{code:'METHOD_NOT_ALLOWED',message:'此日记操作不支持该方法。'}},405,{Allow:allowed.join(', ')});
 if(request.method==='GET'){
  if(history&&id)return respond({history:await service.history(owner,id,view),limit:100});
  return respond(id?{entry:await service.get(owner,id,view)}:{items:await service.list(owner,view),dataStatus:'isolated-test-drafts',syntheticIncluded:view.includeSynthetic});
 }
 if(request.headers.get('origin')!==new URL(baseURL).origin)throw new PlatformError(403,'ORIGIN_DENIED','日记保存需要相同来源。');
 const body=await readJSONBody(request),key=request.headers.get('idempotency-key')??'';
 const result=id?await service.update(owner,id,body,key):await service.create(owner,body,key);
 return respond(result,!id&&!result.duplicate?201:200);
}
