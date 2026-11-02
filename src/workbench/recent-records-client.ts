import {RecordWindowClient,RecordWindowError,RecordWindowCancelled} from '../record-window-workbench/client.ts';
import {TimelineClient,TimelineRequestError} from '../timeline-workbench/client.ts';
import type {TimelineItem} from '../timeline-candidate/contracts.ts';
import type {SourceResponse} from '../search-candidate/contracts.ts';

export type RecentRecordsResult={items:TimelineItem[];observedAt:string;limit:number;truncated:boolean;coverage:{calendarAvailable:false;snapshotConsistency:'owner-snapshot';scanTruncated:boolean;scanLimit:number}};
export class RecentRecordsCancelled extends Error{constructor(){super('已取消读取。');this.name='RecentRecordsCancelled';}}
/** Reuse the timeline/source validators while every operation retains this
 * instance's owner and its own abort signal, including nested source reads. */
export class RecentRecordsClient{
 private readonly transport:typeof fetch;private ownerId:string|undefined;private listeners=new Set<(error:TimelineRequestError)=>void>();
 onIdentityFailure(listener:(error:TimelineRequestError)=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
 private notify(error:TimelineRequestError){for(const listener of this.listeners)listener(error);return error;}
 constructor(transport:typeof fetch=fetch){this.transport=transport;}
 private async operation<T>(run:(client:TimelineClient,transport:typeof fetch)=>Promise<T>,signal?:AbortSignal):Promise<T>{
  let identityFailure:TimelineRequestError|undefined;
  const cancelled=()=>{if(signal?.aborted)throw new RecentRecordsCancelled();};
  const requestInit=(init?:RequestInit):RequestInit=>({...init,signal:AbortSignal.any([...(init?.signal?[init.signal]:[]),...(signal?[signal]:[]),AbortSignal.timeout(20_000)])});
  const verify=async()=>{
   cancelled();let responseSeen=false;
   try{
    const verifier=new TimelineClient(async(input,init)=>{cancelled();const response=await this.transport(input,requestInit(init));responseSeen=true;return response;}),owner=await verifier.identity();
    if(this.ownerId!==undefined&&owner!==this.ownerId)throw new TimelineRequestError(403,'ACCOUNT_CHANGED','登录账号已变化，已隐藏原账号的最近记录。请恢复原账号或重新加载页面。');
    this.ownerId=owner;return owner;
   }catch(cause){if(cause instanceof TimelineRequestError&&(!signal?.aborted||responseSeen||cause.status===401||cause.status===403))identityFailure=this.notify(cause);throw cause;}
  };
  const scopedTransportRaw:typeof fetch=async(input,init)=>{
   if(String(input).endsWith('/auth/get-session')){const owner=await verify();return Response.json({user:{id:owner},session:{userId:owner}});}
   cancelled();const response=await this.transport(input,requestInit(init));
   if(response.status===401||response.status===403)identityFailure=this.notify(new TimelineRequestError(response.status,response.status===401?'LOGIN_REQUIRED':'ACCOUNT_NOT_ALLOWED',response.status===401?'登录已失效，已隐藏最近记录。请恢复原账号后重试。':'当前账号不能查看这些记录，已隐藏读取内容。'));
   return response;
  };
  const scopedTransport:typeof fetch=async(input,init)=>{try{return await scopedTransportRaw(input,init);}catch(cause){if(cause instanceof RecentRecordsCancelled)throw new RecordWindowCancelled();throw cause;}};
  const client=new TimelineClient(scopedTransport);
  try{const result=await run(client,scopedTransport);if(identityFailure)throw identityFailure;cancelled();return result;}catch(cause){if(identityFailure)throw identityFailure;cancelled();throw cause;}
 }
 identity(signal?:AbortSignal):Promise<string>{return this.operation(client=>client.identity(),signal);}
 recent(includeSynthetic:boolean,signal?:AbortSignal):Promise<RecentRecordsResult>{
  if(includeSynthetic!==true)return Promise.reject(new TimelineRequestError(400,'SYNTHETIC_REVIEW_REQUIRED','请先确认本次只查看获准的虚构评审记录。'));
  return this.operation(async(_client,transport)=>{try{const pageClient=new RecordWindowClient(transport);pageClient.onIdentityFailure(error=>this.notify(new TimelineRequestError(error.status,error.code,error.message)));const value=await pageClient.page('timeline',{axis:'recorded',timeZone:'Asia/Shanghai',includeSynthetic:true,limit:8},null,signal);return{items:value.items as TimelineItem[],observedAt:value.observedAt,limit:8,truncated:value.page.hasMore,coverage:{calendarAvailable:false as const,snapshotConsistency:'owner-snapshot' as const,scanTruncated:value.page.hasMore,scanLimit:value.page.scanned}};}catch(cause){if(cause instanceof RecordWindowError)throw new TimelineRequestError(cause.status,cause.code,cause.message);throw cause;}},signal);
 }
 source(item:TimelineItem,includeSynthetic:boolean,signal?:AbortSignal):Promise<SourceResponse>{
  if(includeSynthetic!==true)return Promise.reject(new TimelineRequestError(400,'SYNTHETIC_REVIEW_REQUIRED','请先确认合成评审范围。'));
  if(this.ownerId===undefined)return Promise.reject(new TimelineRequestError(0,'IDENTITY_UNAVAILABLE','请先读取最近记录以核对来源账号。'));
  return this.operation(async client=>{await client.identity();return client.source(item);},signal);
 }
}
