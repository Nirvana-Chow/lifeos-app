import{AISettingsService}from'./ai-settings-service.ts';import{unavailableAISettings}from'./ai-settings-contract.ts';import{readJSONBody}from'./request-boundary.ts';import{PlatformError}from'./domain.ts';
import{checkCaptureSignal,waitForCaptureSignal}from'./capture.ts';
const response=(value:unknown,status=200,extra:Record<string,string>={})=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Vary':'Cookie',...extra}});
async function connectionBody(request:Request,signal:AbortSignal):Promise<unknown>{
 checkCaptureSignal(signal);if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw new PlatformError(415,'JSON_REQUIRED','需要 JSON 请求。');
 const reader=request.body?.getReader();if(!reader)throw new PlatformError(400,'INVALID_JSON','缺少请求内容。');
 const cancel=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});let size=0;const chunks:Uint8Array[]=[];
 try{for(;;){checkCaptureSignal(signal);const part=await waitForCaptureSignal(reader.read(),signal);checkCaptureSignal(signal);if(part.done)break;size+=part.value.byteLength;if(size>131072)throw new PlatformError(413,'BODY_TOO_LARGE','请求过长。');chunks.push(part.value);}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return await readJSONBody(new Request(request.url,{method:'POST',headers:request.headers,body:bytes}));}
 finally{signal.removeEventListener('abort',cancel);cancel();try{reader.releaseLock();}catch{}}
}
export async function handleAISettings(request:Request,owner:string,baseURL:string,service?:AISettingsService,unavailableReason?:string,context:{assertOwner?:(signal:AbortSignal)=>Promise<void>}={}):Promise<Response|null>{
 const match=/^\/api\/platform\/ai\/(settings|secret|connection-test|activation)\/?$/.exec(new URL(request.url).pathname);if(!match)return null;
 const action=match[1],allowed=action==='settings'?['GET','PUT']:action==='secret'?['PUT','DELETE']:['POST'];
 if(!allowed.includes(request.method))return response({error:{code:'METHOD_NOT_ALLOWED',message:'此配置操作不支持该方法。'}},405,{Allow:allowed.join(', ')});
 if(request.method!=='GET'&&request.headers.get('origin')!==new URL(baseURL).origin)throw new PlatformError(403,'ORIGIN_DENIED','配置修改需要相同来源。');
 if(action==='settings'&&request.method==='GET')return response(service?await service.view(owner):unavailableAISettings(unavailableReason));
 if(!service)throw new PlatformError(503,'AI_SETTINGS_UNAVAILABLE','AI 配置存储尚未启用，本次没有保存。');
 if(action==='secret'&&request.method==='PUT'&&!(await service.view(owner)).capabilities.secretWritable)throw new PlatformError(503,'AI_SECRET_ENTRY_UNAVAILABLE','安全入口或秘密存储未就绪，不接收 API key。');
 if(action==='connection-test'){
  const signal=AbortSignal.any([request.signal,AbortSignal.timeout(20000)]);
  const ownerCheck=async()=>{checkCaptureSignal(signal);if(context.assertOwner)await waitForCaptureSignal(context.assertOwner(signal),signal);checkCaptureSignal(signal);};
  let started=false,postflight=false;
  try{const body=await connectionBody(request,signal);await ownerCheck();started=true;const value=await waitForCaptureSignal(service.testConnection(owner,body,{signal}),signal);await ownerCheck();postflight=true;const current=await waitForCaptureSignal(service.view(owner),signal);checkCaptureSignal(signal);if(current.revision!==value.revision)throw new PlatformError(409,'AI_SETTINGS_CONFLICT','配置已变化，请重新读取并核对测试状态。');return response(current);}
  catch(cause){if(cause instanceof PlatformError&&(cause.status===401||cause.status===403))throw cause;if(started&&!postflight&&!signal.aborted){try{await ownerCheck();}catch(identity){if(identity instanceof PlatformError&&(identity.status===401||identity.status===403))throw identity;cause=identity;}}if(signal.aborted)throw new PlatformError(signal.reason?.name==='TimeoutError'?503:499,signal.reason?.name==='TimeoutError'?'AI_CONNECTION_TEST_TIMEOUT':'AI_CONNECTION_TEST_CANCELLED','连接测试已停止等待，结果需重新读取；请求可能已发送、产生费用或保存状态。');throw cause;}
 }
 const body=await readJSONBody(request);
 const value=action==='settings'?await service.saveConfig(owner,body):action==='secret'?request.method==='PUT'?await service.saveSecret(owner,body):await service.removeSecret(owner,body):await service.activate(owner,body);
 return response(value);
}
