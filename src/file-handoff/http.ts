import {readJSONBody} from '../platform/request-boundary.ts';
import {PlatformError} from '../platform/domain.ts';
import {FileHandoffError,fileIdSchema,ackFileSchema} from './contracts.ts';
import type {FileSession} from './runtime.ts';
const headers={'Cache-Control':'private, no-store',Vary:'Authorization, Cookie','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow, noarchive'};
export const fileHttpError=(error:unknown)=>{
 if(error instanceof FileHandoffError)return Response.json({error:error.code,...(error.handoffId?{handoffId:error.handoffId}:{}),...(error.code.includes('UNKNOWN')?{outcome:'unknown'}:{})},{status:error.status,headers});
 if(error instanceof PlatformError)return Response.json({error:error.code},{status:error.status,headers});
 return Response.json({error:'FILE_HANDOFF_UNAVAILABLE',outcome:'unknown'},{status:503,headers});
};
export async function handleFileHandoffRequest(request:Request,options:{session:FileSession;mount:string;current:(write:boolean)=>Promise<void>;allowStage?:boolean}):Promise<Response|null>{
 const url=new URL(request.url);if(url.pathname!==options.mount&&!url.pathname.startsWith(options.mount+'/'))return null;
 try{
  const tail=url.pathname.slice(options.mount.length),match=/^\/([a-f0-9-]{36})(?:\/(content|acknowledgments))?$/.exec(tail);
  if(url.search||url.hash||tail&&!match)throw new FileHandoffError(404,'FILE_NOT_FOUND');
  const id=match?.[1],action=match?.[2];if(id&&!fileIdSchema.safeParse(id).success)throw new FileHandoffError(404,'FILE_NOT_FOUND');
  const write=request.method==='POST',allowed=id?(action==='acknowledgments'?'POST':'GET'):options.allowStage?'POST':'';
  if(request.method!==allowed)return Response.json({error:'METHOD_NOT_ALLOWED'},{status:405,headers:{...headers,Allow:allowed}});
  await options.current(write);const{service,actor}=options.session;
  if(!id){const result=await service.stage(actor,await readJSONBody(request),request.headers.get('idempotency-key')??'',request.signal);return Response.json({...result,links:{website:'/personal/file-handoffs?id='+result.entry.id}},{status:result.duplicate?200:201,headers});}
  if(action==='content'){
   const result=await service.download(actor,id);await options.current(false);
   const filename=encodeURIComponent(result.entry.name).replace(/[!'()*]/g,char=>'%'+char.charCodeAt(0).toString(16).toUpperCase());
   return new Response(new Uint8Array(result.bytes),{headers:{...headers,'Content-Type':result.entry.mimeType,'Content-Length':String(result.bytes.length),'Content-Disposition':`attachment; filename="file"; filename*=UTF-8''${filename}`,'X-LifeOS-File-SHA256':result.entry.sha256!,'X-LifeOS-File-Revision':String(result.entry.revision)}});
  }
  if(action==='acknowledgments'){
   const input=ackFileSchema.omit({id:true}).safeParse(await readJSONBody(request));if(!input.success)throw new FileHandoffError(400,'FILE_ACK_INVALID');
   return Response.json(await service.acknowledge(actor,{...input.data,id},request.headers.get('idempotency-key')??''),{headers});
  }
  const result=await service.get(actor,id);await options.current(false);return Response.json(result,{headers});
 }catch(error){return fileHttpError(error);}
}
