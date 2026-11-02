import type{PlatformConfig}from'../platform/config.ts';
import type{PlatformAuth}from'../platform/auth.ts';
import{OwnerRecoveryBusy}from'./owner-recovery-lock.ts';
import{passwordAccess}from'./password-access.ts';
export function readOwnerAccountAccess(env:Record<string,string|undefined>):boolean{const flag=env.LIFEOS_PERSONAL_ACCOUNT_ACCESS;if(flag===undefined)return false;if(flag!=='owner-password-v1')throw Error('Owner account access approval unavailable');return true;}
/** Only the existing authenticated owner may change a password. No recovery or signup. */
export function ownerAccountAccess(config:PlatformConfig,auth:PlatformAuth,options:{enabled:boolean;withOwnerLock:<T>(run:()=>Promise<T>)=>Promise<T>;readOwner:(headers:Headers)=>Promise<string|null>}){
 const change=passwordAccess({enabled:options.enabled,allowReset:false,signOutAfterChange:true,baseURL:config.baseURL,ownerId:config.ownerId,readOwner:options.readOwner,readResetOwner:async()=>null,handler:r=>auth.handler(r)});
 return async(request:Request)=>{if(new URL(request.url).pathname!=='/api/platform/personal/password')return Response.json({message:'此身份操作未开放。'},{status:404});if(!options.enabled)return change(request);try{return await options.withOwnerLock(()=>change(request));}catch(e){return Response.json({message:e instanceof OwnerRecoveryBusy?'另一个账号操作正在进行，请稍后重试。':'账号操作结果未确认，请重新登录核对。'},{status:e instanceof OwnerRecoveryBusy?409:503,headers:{'Cache-Control':'private, no-store'}});}};
}
