import type {TrustedActor} from '../agent-authority/contracts.ts';
import {PlatformError} from '../platform/domain.ts';
import {assertLocalRequest,readJSONBody} from '../platform/request-boundary.ts';
import {ClassificationService,classificationConfirmation} from './classification-service.ts';
const response=(status:number,body:unknown)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff'}});
export async function handleOwnerClassificationRequest(request:Request,actor:TrustedActor,service:ClassificationService,guards:{baseURL:string;assertOwner:()=>Promise<void>;assertWritable:()=>Promise<void>}):Promise<Response|null>{
 const url=new URL(request.url),prefix='/api/platform/personal/todo-classifications';if(url.pathname!==prefix&&!url.pathname.startsWith(prefix+'/'))return null;
 try{
  assertLocalRequest(request,guards.baseURL);
  if(request.headers.has('authorization')||actor.kind!=='owner-session')throw new PlatformError(403,'OWNER_ONLY','仅限本人会话。');
  if(request.method!=='GET'&&request.headers.get('origin')!==new URL(guards.baseURL).origin)throw new PlatformError(403,'ORIGIN_DENIED','需要同源确认。');
  if(request.signal.aborted)throw new PlatformError(499,'REQUEST_CANCELLED','已取消。');await guards.assertOwner();
  const route=/^\/api\/platform\/personal\/todo-classifications\/([a-f0-9-]{36})(?:\/(approve|commit|preview))?$/.exec(url.pathname);
  if(!route||url.search||!route[2]&&request.method!=='GET'||route[2]&&request.method!=='POST')return response(404,{error:{code:'NOT_FOUND'}});
  if(!route[2])return response(200,await service.review(actor,route[1]));
  if(route[2]==='preview')return response(200,await service.previewSelection(actor,route[1],await readJSONBody(request)));
  const body={...classificationConfirmation(await readJSONBody(request),false),planId:route[1]};
  if(route[2]==='approve')return response(200,await service.approve(actor,body));
  await guards.assertWritable();return response(200,await service.commit(actor,body,request.headers.get('idempotency-key')??''));
 }catch(error){return error instanceof PlatformError?response(error.status,{error:{code:error.code,message:error.message}}):response(503,{error:{code:'CLASSIFICATION_UNAVAILABLE',message:'结果未确认，请保留原请求。'}});}
}
