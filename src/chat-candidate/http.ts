import {checkChatSignal,waitForChatSignal} from '../platform/ark-chat.ts';
import {PlatformError,validateId} from '../platform/domain.ts';
import {readJSONBody} from '../platform/request-boundary.ts';
import {ChatService,validateChatSend,validateChatCancel,closedChatProviderSelector} from './service.ts';
import type {ChatStatus,ChatExport,ChatPageExport} from './contracts.ts';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Vary':'Cookie'};
const respond=(value:unknown,status=200,extra:Record<string,string>={})=>Response.json(value,{status,headers:{...headers,...extra}});
const unavailable=():never=>{throw new PlatformError(503,'CHAT_STORAGE_UNAVAILABLE','聊天记录存储尚未启用，本次没有生成。');};
function query(params:URLSearchParams,allowLimit=false){
 const seen=new Set<string>();for(const[key]of params){if(!['includeSynthetic',...(allowLimit?['limit']:[])].includes(key)||seen.has(key))throw new PlatformError(400,'INVALID_CHAT_QUERY','聊天读取参数无效。');seen.add(key);}
 const include=params.get('includeSynthetic'),raw=params.get('limit');if(include!==null&&!['true','false'].includes(include)||raw!==null&&!/^[1-9]\d?$/.test(raw))throw new PlatformError(400,'INVALID_CHAT_QUERY','聊天读取参数无效。');const limit=raw===null?20:Number(raw);if(limit>50)throw new PlatformError(400,'INVALID_CHAT_QUERY','聊天读取范围无效。');return{includeSynthetic:include==='true',limit};
}
/** Caller has already enforced the shared host/session/configured-owner gates. */
export async function handleChatRequest(request:Request,owner:string,baseURL:string,service?:ChatService,context:{assertOwner?:(signal:AbortSignal)=>Promise<void>}={}):Promise<Response|null>{
 const url=new URL(request.url),match=/^\/api\/platform\/ai\/chat(?:\/(status|turns|export|export-page)(?:\/([^/]+)(?:\/(cancel))?)?)?\/?$/.exec(url.pathname);if(!match)return null;
 const section=match[1],id=match[2],cancel=match[3],method=cancel||!section?'POST':'GET';
 if((section==='status'||section==='export'||section==='export-page')&&id)return respond({error:{code:'CHAT_TURN_NOT_FOUND',message:'没有可访问的聊天接口。'}},404);
 if(request.method!==method)return respond({error:{code:'METHOD_NOT_ALLOWED',message:'此聊天操作不支持该方法。'}},405,{Allow:method});
 try{
  if(method==='POST'&&request.headers.get('origin')!==new URL(baseURL).origin)throw new PlatformError(403,'ORIGIN_DENIED','聊天操作需要相同来源。');
  if(section==='export'||section==='export-page'){
   let cursor:string|null=null;if(section==='export-page'){const raw=url.searchParams.get('cursor');if(raw!==null&&(!/^[A-Za-z0-9_-]{1,1200}$/.test(raw)||url.searchParams.getAll('cursor').length!==1))throw new PlatformError(400,'INVALID_CHAT_CURSOR','分页位置无效。');cursor=raw;url.searchParams.delete('cursor');}
   const q=query(url.searchParams);if(!q.includeSynthetic||request.body!==null)throw new PlatformError(400,'INVALID_CHAT_QUERY','请明确确认导出本账号的隔离聊天评审。');
   if(!service)return unavailable();const signal=AbortSignal.any([request.signal,AbortSignal.timeout(15000)]);checkChatSignal(signal);
   const value=await waitForChatSignal<ChatExport|ChatPageExport>(section==='export-page'?service.exportPage(owner,true,cursor):service.export(owner,true),signal);checkChatSignal(signal);
   if(context.assertOwner)await waitForChatSignal(context.assertOwner(signal),signal);checkChatSignal(signal);
   return respond(value,200,{'Content-Disposition':'attachment; filename="lifeos-chat-review-'+value.exportedAt.slice(0,10)+'.json"'});
  }
  if(section==='status'){
   if([...url.searchParams].length)throw new PlatformError(400,'INVALID_CHAT_QUERY','状态请求不接受查询字段。');
   const value:ChatStatus=service?await service.status(owner):{...await closedChatProviderSelector.chatStatus(owner),storageReady:false,streaming:true,persistsTurns:true,dataScope:'current-message-only',sources:'not-connected',notice:'聊天记录存储尚未启用；不会发送给外部模型。'};return respond(value);
  }
  if(section==='turns'&&!cancel){const q=query(url.searchParams,!id);if(id)validateId(id);if(!service){if(!q.includeSynthetic)return id?respond({error:{code:'CHAT_TURN_NOT_FOUND',message:'没有可访问的聊天回合。'}},404):respond({items:[],limit:q.limit,truncated:false,syntheticIncluded:false});return unavailable();}return respond(id?{turn:await service.get(owner,id,q.includeSynthetic)}:await service.list(owner,q.includeSynthetic,q.limit));}
  if([...url.searchParams].length)throw new PlatformError(400,'INVALID_CHAT_QUERY','发送和取消请求不接受查询字段。');
  if(cancel){const body=validateChatCancel(await readJSONBody(request));validateId(id);if(!service)return unavailable();return respond({turn:await service.cancel(owner,id,body)});}
  const body=validateChatSend(await readJSONBody(request));if(!service)return unavailable();
  const controller=new AbortController(),signal=AbortSignal.any([request.signal,controller.signal]),iterator=(await service.send(owner,body,signal))[Symbol.asyncIterator](),encoder=new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({async pull(output){try{const next=await iterator.next();if(next.done)output.close();else output.enqueue(encoder.encode(JSON.stringify(next.value)+'\n'));}catch{output.error(new Error('聊天流已中断，请回查同一回合。'));controller.abort();}},async cancel(){controller.abort();await iterator.return?.();}}),{headers:{...headers,'Content-Type':'application/x-ndjson; charset=utf-8'}});
 }catch(cause){
  if((section==='export'||section==='export-page')&&cause instanceof PlatformError&&[401,403,503].includes(cause.status)&&['LOGIN_REQUIRED','ACCOUNT_NOT_ALLOWED','AUTH_UNAVAILABLE','ACCOUNT_CHANGED'].includes(cause.code))return respond({error:{code:cause.code,message:'暂时无法核对原账号，未返回导出内容。'}},cause.status);
  const status=cause instanceof PlatformError&&[400,403,404,409,413,415,499,503].includes(cause.status)?cause.status:503,code=cause instanceof PlatformError&&/^(CHAT_|INVALID_CHAT_|ORIGIN_DENIED|JSON_REQUIRED|INVALID_JSON|BODY_TOO_LARGE|INVALID_ID)/.test(cause.code)?cause.code:'CHAT_STORAGE_UNAVAILABLE';
  return respond({error:{code,message:status===400?'请核对聊天文字、标识和确认字段。':status===403?'当前来源没有访问权限。':status===404?'没有可访问的聊天回合。':status===409?'回合状态或请求内容已变化，请回查同一回合。':status===499?'本次发送已取消，请回查同一回合。':'聊天暂不可用，未确认本次生成；请回查同一回合。'}},status);
 }
}
