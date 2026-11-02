import type{BetterAuthOptions}from'better-auth';import type{PlatformConfig}from'../platform/config.ts';import{createPlatformAuth}from'../platform/auth.ts';import{assertLocalRequest,readJSONBody}from'../platform/request-boundary.ts';import{OwnerRecoveryRateLimited,OwnerRecoveryBusy}from'./owner-recovery-lock.ts';
export type OwnerRecoveryDelivery={recipient:string;send:(message:{to:string;code:string;expiresInSeconds:number})=>Promise<void>};
type OperatorDelivery={kind:'trusted-operator';send:(message:{code:string;expiresInSeconds:number;signal:AbortSignal})=>Promise<void>};
type Delivery={kind:'email';recipient:string;send:OwnerRecoveryDelivery['send']}|OperatorDelivery;
type Options={enabled:boolean;withOwnerLock:<T>(run:()=>Promise<T>)=>Promise<T>;limit:(action:'request'|'finish')=>Promise<void>};
type Result={status:number;message:string};
const invalid:Result={status:400,message:'请求未获确认，请核对验证码、有效期或稍后重试。'};
const unknown:Result={status:503,message:'恢复结果未确认；若刚提交新密码，请先登录核对，不要反复重试。'};
const reply=(result:Result)=>Response.json({message:result.message},{status:result.status,headers:{'Cache-Control':'private, no-store'}});

/** All issuance and completion use the same owner lock and native verification lifecycle. */
function recoveryCore(config:PlatformConfig,database:BetterAuthOptions['database'],options:Options){
 return async(action:'request'|'finish',input:{request?:Request;otp?:string;newPassword?:string;delivery?:Delivery;signal?:AbortSignal;startedAt:number}):Promise<Result>=>{
  if(options.enabled!==true)return{status:503,message:'本人密码恢复尚未启用。'};
  try{
   if(input.signal?.aborted)return unknown;
   await options.limit(action);
   return await options.withOwnerLock(async()=>{
    if(input.signal?.aborted)return unknown;
    const expiresAt=new Date(input.startedAt+600000);let delivered=false;let auth:ReturnType<typeof createPlatformAuth>;
    auth=createPlatformAuth(config,database,{forceSecureCookies:true,ownerRecoveryPending:true,ownerPasswordResetDelivery:async data=>{
     if(action!=='request'||!input.delivery||data.userId!==config.ownerId||!/^[A-Za-z0-9_-]{20,256}$/.test(data.token))throw Error('RECOVERY_DELIVERY_UNAVAILABLE');
     const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;let onAbort:(()=>void)|undefined;
     try{
      const interrupted=new Promise<never>((_,reject)=>{onAbort=()=>{controller.abort();reject(Error('RECOVERY_CANCELLED'));};input.signal?.addEventListener('abort',onAbort,{once:true});timer=setTimeout(onAbort,10000);});
      if(input.signal?.aborted)throw Error('RECOVERY_CANCELLED');
      const operation=input.delivery.kind==='email'?input.delivery.send({to:input.delivery.recipient,code:data.token,expiresInSeconds:600}):input.delivery.send({code:data.token,expiresInSeconds:600,signal:controller.signal});
      await Promise.race([operation,interrupted]);
      if(input.signal?.aborted||controller.signal.aborted||Date.now()>=expiresAt.valueOf())throw Error('RECOVERY_UNCONFIRMED');
      const context=await auth.$context;const activated=await context.internalAdapter.updateVerificationByIdentifier('reset-password:'+data.token,{expiresAt});
      if(!activated||activated.value!==config.ownerId||new Date(activated.expiresAt).valueOf()!==expiresAt.valueOf()||Date.now()>=expiresAt.valueOf()||controller.signal.aborted||input.signal?.aborted)throw Error('RECOVERY_UNCONFIRMED');
      delivered=true;
     }finally{clearTimeout(timer);if(onAbort)input.signal?.removeEventListener('abort',onAbort);controller.abort();}
    }});
    const context=await auth.$context;const accounts=await context.adapter.findMany<{accountId:string}>({model:'account',where:[{field:'userId',value:config.ownerId},{field:'providerId',value:'credential'}],select:['accountId'],limit:2});
    if(accounts.length!==1||accounts[0].accountId!==config.ownerId)return{status:503,message:'本人账号状态未确认。'};
    if(action==='finish'){const verification=await context.internalAdapter.findVerificationValue('reset-password:'+input.otp);if(!verification||verification.value!==config.ownerId||new Date(verification.expiresAt).valueOf()<=Date.now())return invalid;}
    if(input.signal?.aborted)return unknown;
    let ok=false,status=400;
    if(input.request){const headers=new Headers(input.request.headers);headers.set('x-platform-client','127.0.0.1');headers.delete('content-length');const path=action==='request'?'/request-password-reset':'/reset-password';const body=action==='request'?{email:config.ownerEmail}:{token:input.otp,newPassword:input.newPassword};const r=await auth.handler(new Request(config.baseURL+'/api/platform/auth'+path,{method:'POST',headers,body:JSON.stringify(body)}));ok=r.ok;status=r.status;}
    else if(action==='request'){try{await auth.api.requestPasswordReset({body:{email:config.ownerEmail}});ok=true;}catch{return unknown;}}
    else return invalid;
    if(action==='request'&&(!ok||!delivered))return unknown;
    if(ok&&action==='finish')await context.adapter.deleteMany({model:'verification',where:[{field:'value',value:config.ownerId}]});
    if(input.signal?.aborted)return unknown;
    return ok?{status:200,message:action==='request'?'恢复码交付已确认。':'密码已更新，旧会话已撤销，请返回登录。'}:{status:status===429?429:400,message:invalid.message};
   });
  }catch(error){if(error instanceof OwnerRecoveryBusy)return{status:409,message:'另一个恢复操作正在进行，请稍后核对。'};if(error instanceof OwnerRecoveryRateLimited)return{status:429,message:'尝试过于频繁，请稍后再试。'};return unknown;}
 };
}
function validateDelivery(delivery:Delivery){if(delivery.kind==='email'&&(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(delivery.recipient)||delivery.recipient.toLowerCase().endsWith('.local')))throw Error('VERIFIED_RECOVERY_CHANNEL_REQUIRED');}
function webGateway(config:PlatformConfig,database:BetterAuthOptions['database'],options:Options,delivery?:Delivery){
 const run=recoveryCore(config,database,options);return async(request:Request)=>{const startedAt=Date.now();try{
  if(options.enabled!==true)return reply({status:503,message:'本人密码恢复尚未启用。'});const url=new URL(request.url);if(request.method!=='POST'||url.search||url.pathname!=='/api/platform/personal/recover-password')return reply({status:404,message:'无此操作。'});assertLocalRequest(request,config.baseURL);if(request.headers.get('origin')!==config.baseURL)return reply({status:403,message:'来源不符。'});
  const body=await readJSONBody(request) as Record<string,unknown>;if(!body||Array.isArray(body))return reply(invalid);
  if(body.action==='request'&&Object.keys(body).length===1&&delivery?.kind==='email')return reply(await run('request',{request,delivery,signal:request.signal,startedAt}));
  if(body.action==='finish'&&Object.keys(body).every(k=>['action','otp','newPassword'].includes(k))&&typeof body.otp==='string'&&/^[A-Za-z0-9_-]{20,256}$/.test(body.otp)&&typeof body.newPassword==='string'&&body.newPassword.length>=12&&body.newPassword.length<=128)return reply(await run('finish',{request,otp:body.otp,newPassword:body.newPassword,signal:request.signal,startedAt}));
  return reply({status:404,message:'无此操作。'});
 }catch{return reply(unknown);}};
}
/** Existing email-only adapter; no operator delivery is routed through HTTP. */
export function ownerEmailReset(config:PlatformConfig,database:BetterAuthOptions['database'],options:Options&{delivery:OwnerRecoveryDelivery}){const delivery:Delivery={kind:'email',...options.delivery};if(options.enabled)validateDelivery(delivery);return webGateway(config,database,options,delivery);}
/** Public boundary: finish only; no issuer or recipient is accepted. */
export function ownerRecoveryFinishOnly(config:PlatformConfig,database:BetterAuthOptions['database'],options:Options){return webGateway(config,database,options);}
/** Private caller only: its transport must independently authenticate the operator. */
export function ownerOperatorRecovery(config:PlatformConfig,database:BetterAuthOptions['database'],options:Options&{delivery:OperatorDelivery}){const run=recoveryCore(config,database,options);return async(signal?:AbortSignal):Promise<{status:'issued'|'disabled'|'unconfirmed'}>=>{if(options.enabled!==true)return{status:'disabled'};if(options.delivery.kind!=='trusted-operator'||'recipient' in options.delivery||typeof options.delivery.send!=='function')return{status:'unconfirmed'};const result=await run('request',{delivery:options.delivery,signal,startedAt:Date.now()});return{status:result.status===200?'issued':'unconfirmed'};};}
