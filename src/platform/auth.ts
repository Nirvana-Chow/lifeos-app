import{betterAuth,type BetterAuthOptions}from'better-auth';import{twoFactor}from'better-auth/plugins/two-factor';import type{PlatformConfig}from'./config.ts';import type{Principal}from'./contracts.ts';import{PlatformError}from'./domain.ts';import{assertLocalRequest,readJSONBody}from'./request-boundary.ts';
import {sessionDurationFields,freshAuthentication,parseSessionDuration} from '../session-duration/policy.ts';
import {sessionDurationPlugin,sessionDurationPluginId,creationSessionDuration} from '../session-duration/native.ts';
import {businessOAuthPlugins} from '../business-mcp-oauth/provider.ts';import type {BusinessOAuthConfig} from '../business-mcp-oauth/boundary.ts';
export function createPlatformAuth(config:PlatformConfig,database:BetterAuthOptions['database'],security:{sessionDuration?:boolean;businessOAuth?:BusinessOAuthConfig;requireMfa?:boolean;assertSessionWrite?:()=>Promise<void>;disableSessionRefresh?:boolean;readOnlySessions?:boolean;forceSecureCookies?:boolean;ownerRecoveryPending?:boolean;ownerPasswordResetDelivery?:(data:{userId:string;email:string;token:string})=>Promise<void>}={}){
 const sessionWriteAllowed=async()=>{if(security.readOnlySessions)return false;try{await security.assertSessionWrite?.();return true;}catch{return false;}};
 return betterAuth({appName:'LifeOS isolated platform candidate',baseURL:config.baseURL,basePath:'/api/platform/auth',secret:config.secret,database,trustedOrigins:[config.baseURL],logger:{disabled:true},telemetry:{enabled:false},
  emailAndPassword:{enabled:true,disableSignUp:true,minPasswordLength:12,...(security.ownerPasswordResetDelivery?{resetPasswordTokenExpiresIn:600,revokeSessionsOnPasswordReset:true,sendResetPassword:async(data:{user:{id:string;email:string};token:string})=>{if(data.user.id!==config.ownerId||data.user.email.toLowerCase()!==config.ownerEmail.toLowerCase())throw Error('OWNER_RESET_DENIED');await security.ownerPasswordResetDelivery!({userId:data.user.id,email:data.user.email,token:data.token});}}:{})},
  rateLimit:{enabled:security.readOnlySessions!==true,storage:'database',modelName:'platform_rate_limit',window:60,max:3,customRules:{'/sign-in/email':{window:60,max:3}}},
  disabledPaths:security.businessOAuth?['/token']:[],
  plugins:[...(security.sessionDuration?[sessionDurationPlugin(security.readOnlySessions)]:[]),...(security.requireMfa?[twoFactor({issuer:'LifeOS',twoFactorTable:'platform_two_factor',skipVerificationOnEnable:false})]:[]),...(security.businessOAuth&&!security.readOnlySessions?businessOAuthPlugins(config,security.businessOAuth):[])],
  user:{modelName:'platform_user'},account:{modelName:'platform_account'},verification:{modelName:'platform_verification',...(security.ownerPasswordResetDelivery?{storeIdentifier:'hashed' as const}:{})},
  session:{...((security.requireMfa||security.sessionDuration)?{additionalFields:{...(security.sessionDuration?sessionDurationFields:{}),...(security.requireMfa?{mfaVerified:{type:'boolean' as const,required:true,defaultValue:false,input:false as const}}:{})}}:{}),...(security.sessionDuration?{deferSessionRefresh:true}:{}),...(security.disableSessionRefresh?{disableSessionRefresh:true}:{}),modelName:'platform_session',expiresIn:config.sessionSeconds,updateAge:300,cookieCache:{enabled:false},storeSessionInDatabase:true},
  advanced:{ipAddress:{ipAddressHeaders:['x-platform-client']},cookiePrefix:'lifeos-platform-candidate',trustedProxyHeaders:false,useSecureCookies:security.forceSecureCookies??new URL(config.baseURL).protocol==='https:',defaultCookieAttributes:{httpOnly:true,sameSite:'strict'}},
  databaseHooks:{...(security.ownerRecoveryPending?{verification:{create:{before:async(verification,context)=>context?.path==='/request-password-reset'&&verification.value===config.ownerId?{data:{expiresAt:new Date(0)}}:false}}}:{}),user:{create:{before:async()=>false}},session:{update:{before:async()=>await sessionWriteAllowed()?undefined:false},delete:{before:async()=>security.readOnlySessions?false:undefined},create:{before:async(session,context)=>{
   if(security.readOnlySessions||session.userId!==config.ownerId||!context)return false;
   const user=await context.context.internalAdapter.findUserById(session.userId);
   if(!user||user.email.toLowerCase()!==config.ownerEmail)return false;
   if(!await sessionWriteAllowed())return false;
   const duration=security.sessionDuration?creationSessionDuration(context.context):null;
   return{data:{...session,...(duration?{sessionDurationMode:duration.mode,sessionDurationSeconds:duration.seconds}:{}),expiresAt:duration?new Date(new Date(session.createdAt).valueOf()+duration.seconds*1000):new Date(Math.min(new Date(session.expiresAt).valueOf(),Date.now()+config.sessionSeconds*1000)),...(security.requireMfa?{mfaVerified:context.path==='/two-factor/verify-totp'||context.path==='/two-factor/verify-backup-code'}:{})}};
  }}}},
 });
}
export type PlatformAuth=ReturnType<typeof createPlatformAuth>;
export type OwnerMfaState=
 |{kind:'anonymous'}|{kind:'enroll';step:'start'|'verify'}|{kind:'incomplete'}|{kind:'relogin'}|{kind:'ready';principal:Principal}|{kind:'unavailable'};
type InternalMfaState=Exclude<OwnerMfaState,{kind:'ready'}>|{kind:'ready';principal:Principal;sessionRef:string;authenticatedAt?:Date};
async function inspectOwnerMfaState(auth:PlatformAuth,config:PlatformConfig,headers:Headers):Promise<InternalMfaState>{
 try{
  if(!auth.options?.plugins?.some(plugin=>plugin.id==='two-factor'))return{kind:'unavailable'};
  const value=await auth.api.getSession({headers});
  if(!value||value.user.id!==config.ownerId||value.user.email.toLowerCase()!==config.ownerEmail.toLowerCase())return{kind:'anonymous'};
  const context=await auth.$context,factors=await context.adapter.findMany<{verified?:boolean}>({model:'twoFactor',where:[{field:'userId',value:config.ownerId}],select:['verified'],limit:2});
  if(factors.length>1)return{kind:'unavailable'};
  const enabled=('twoFactorEnabled'in value.user&&value.user.twoFactorEnabled===true),factor=factors[0];
  if(!enabled){if(!factor)return{kind:'enroll',step:'start'};return factor.verified===false?{kind:'enroll',step:'verify'}:{kind:'unavailable'};}
  if(!factor)return{kind:'unavailable'};
  if(factor.verified===false)return{kind:'incomplete'};
  if(factor.verified!==true)return{kind:'unavailable'};
  return ('mfaVerified'in value.session&&value.session.mfaVerified===true&&typeof value.session.id==='string'&&value.session.id.length>0)?{kind:'ready',principal:{userId:value.user.id,email:value.user.email},sessionRef:value.session.id,...(auth.options.plugins?.some(plugin=>plugin.id===sessionDurationPluginId)?{authenticatedAt:value.session.createdAt}:{})}:{kind:'relogin'};
 }catch{return{kind:'unavailable'};}
}
export async function readOwnerMfaState(auth:PlatformAuth,config:PlatformConfig,headers:Headers):Promise<OwnerMfaState>{
 const state=await inspectOwnerMfaState(auth,config,headers);
 return state.kind==='ready'?{kind:'ready',principal:state.principal}:state;
}
export async function readVerifiedOwnerSession(auth:PlatformAuth,config:PlatformConfig,headers:Headers):Promise<{principal:Principal;sessionRef:string}|null>{
 const state=await inspectOwnerMfaState(auth,config,headers);
 return state.kind==='ready'&&(!auth.options.plugins?.some(plugin=>plugin.id===sessionDurationPluginId)||freshAuthentication(state.authenticatedAt))?{principal:state.principal,sessionRef:state.sessionRef}:null;
}
export async function readOwnerPrincipal(auth:PlatformAuth,config:PlatformConfig,headers:Headers):Promise<Principal|null>{
 if(auth.options?.plugins?.some(plugin=>plugin.id==='two-factor')){const state=await readOwnerMfaState(auth,config,headers);return state.kind==='ready'?state.principal:null;}
 try{const session=await auth.api.getSession({headers});if(!session||session.user.id!==config.ownerId||session.user.email.toLowerCase()!==config.ownerEmail.toLowerCase())return null;return{userId:session.user.id,email:session.user.email};}catch{return null;}
}
type AuthGuards={sessionDuration?:boolean;assertWrite?:()=>Promise<void>;ownerLoginAlias?:'owner';requireMfa?:boolean;readMfaState?:(headers:Headers)=>Promise<OwnerMfaState>;withOwnerLock?:<T>(run:()=>Promise<T>)=>Promise<T>;trustedDeviceCookieNames?:string[];sessionCookieNames?:string[];twoFactorCookieNames?:string[]};
export async function authRequest(request:Request,config:PlatformConfig,handler:(request:Request)=>Promise<Response>,guards:AuthGuards={}):Promise<Response>{
 const privateHeaders={'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
 const json=(status:number,code:string,message:string)=>Response.json({error:{code,message}},{status,headers:privateHeaders});
 try{
  const path=new URL(request.url).pathname,mfa=guards.requireMfa===true;
  const methods=new Map([['/api/platform/auth/get-session','GET'],['/api/platform/auth/sign-in/email','POST'],['/api/platform/auth/sign-out','POST']]);
  if(mfa)for(const name of ['enable','verify-totp','verify-backup-code'])methods.set('/api/platform/auth/two-factor/'+name,'POST');
  if(guards.sessionDuration&&path==='/api/platform/auth/get-session'&&request.method==='POST')methods.set(path,'POST');
  const method=methods.get(path);
  if(!method)return json(404,'NOT_FOUND','此身份操作未开放。');if(request.method!==method)return json(405,'METHOD_NOT_ALLOWED','此身份操作不支持该方法。');
  if(mfa&&(!guards.readMfaState||!guards.withOwnerLock||!guards.trustedDeviceCookieNames?.length||!guards.sessionCookieNames?.length||!guards.twoFactorCookieNames?.length))return json(503,'AUTH_UNAVAILABLE','身份服务暂不可用。');
  assertLocalRequest(request,config.baseURL);if(method==='POST'&&request.headers.get('origin')!==config.baseURL)throw new PlatformError(403,'ORIGIN_DENIED','写入需要相同来源。');
  const headers=new Headers(request.headers),receivedTrustedDeviceCookies=new Set<string>();headers.set('x-platform-client','127.0.0.1');
  if(mfa){const trusted=new Set(guards.trustedDeviceCookieNames);headers.set('cookie',(headers.get('cookie')??'').split(';').map(value=>value.trim()).filter(value=>{if(!value)return false;const name=value.slice(0,value.indexOf('=')).trim();if(!trusted.has(name))return true;receivedTrustedDeviceCookies.add(name);return false;}).join('; '));}
  if(method==='POST'&&path!=='/api/platform/auth/sign-out')await guards.assertWrite?.();
  let input=method==='POST'?await readJSONBody(request):undefined;
  const isFactor=path.startsWith('/api/platform/auth/two-factor/'),isRefresh=guards.sessionDuration&&path==='/api/platform/auth/get-session'&&method==='POST';
  if(input&&typeof input==='object'&&'sessionDuration'in input){if(!guards.sessionDuration||!(path.endsWith('/sign-in/email')||path.endsWith('/verify-totp')||path.endsWith('/verify-backup-code')))return json(400,'INVALID_REQUEST','登录时长选择尚未启用。');try{parseSessionDuration((input as Record<string,unknown>).sessionDuration);}catch{return json(400,'INVALID_SESSION_DURATION','登录时长无效，请重新选择。');}}
  if(isRefresh&&(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length||request.headers.has('authorization')))return json(400,'INVALID_REQUEST','会话请求无效。');
  if(mfa&&isFactor){
   if(!input||typeof input!=='object'||Array.isArray(input))return json(400,'INVALID_REQUEST','身份请求无效。');
   const data=input as Record<string,unknown>,enable=path.endsWith('/enable'),allowed=enable?['password','method']:['code','trustDevice',...(guards.sessionDuration?['sessionDuration']:[])];
   if(Object.keys(data).some(key=>!allowed.includes(key))||(enable?(typeof data.password!=='string'||(data.method!==undefined&&data.method!=='totp')):(typeof data.code!=='string'||(data.trustDevice!==undefined&&data.trustDevice!==false))))return json(400,'INVALID_REQUEST','身份请求无效。');
  }
  if(method==='POST'&&path==='/api/platform/auth/sign-in/email'&&guards.ownerLoginAlias==='owner'){if(!input||typeof input!=='object'||Array.isArray(input))return json(400,'INVALID_REQUEST','登录请求无效。');const data=input as Record<string,unknown>;if(data.email!=='owner'&&data.email!==config.ownerEmail)return json(401,'INVALID_CREDENTIALS','登录未通过，请核对账号和密码。');input={...data,email:config.ownerEmail};}
  headers.delete('content-length');const body=method==='POST'?JSON.stringify(input):undefined;
  const run=async()=>{
   if(mfa&&isRefresh&&(await guards.readMfaState!(headers)).kind!=='ready')return json(401,'MFA_STATE_DENIED','请重新登录后完成身份验证。');
   if(mfa&&isFactor){
    const state=await guards.readMfaState!(headers);
    if(state.kind==='unavailable')return json(503,'AUTH_UNAVAILABLE','身份服务暂不可用。');
    const names=new Set((headers.get('cookie')??'').split(';').map(value=>value.trim().split('=')[0]));
    const challenge=state.kind==='anonymous'&&!guards.sessionCookieNames!.some(name=>names.has(name))&&guards.twoFactorCookieNames!.some(name=>names.has(name));
    const allowed=path.endsWith('/enable')?state.kind==='enroll':path.endsWith('/verify-backup-code')?challenge:challenge||state.kind==='enroll'||state.kind==='incomplete';
    if(!allowed)return json(401,'MFA_STATE_DENIED','请重新登录后完成身份验证。');
   }
   if(method==='POST'&&path!=='/api/platform/auth/sign-out')await guards.assertWrite?.();
   const response=await handler(new Request(new URL(path,config.baseURL),{method,headers,body}));
   if(!mfa){response.headers.set('Cache-Control','private, no-store');return response;}
   const projectedHeaders=new Headers(response.headers),setCookies=response.headers.getSetCookie();projectedHeaders.delete('set-cookie');
   for(const cookie of setCookies)projectedHeaders.append('set-cookie',cookie);
   for(const name of receivedTrustedDeviceCookies)projectedHeaders.append('set-cookie',name+'=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict'+(name.startsWith('__Secure-')||new URL(config.baseURL).protocol==='https:'?'; Secure':''));
   for(const[key,value]of Object.entries(privateHeaders))projectedHeaders.set(key,value);
   let projectedBody=await response.text();
   if(response.headers.get('content-type')?.includes('application/json')){const data=JSON.parse(projectedBody);if(data&&typeof data==='object'){delete data.token;if(data.session&&typeof data.session==='object')delete data.session.token;}projectedBody=JSON.stringify(data);projectedHeaders.delete('content-length');}
   return new Response(projectedBody,{status:response.status,statusText:response.statusText,headers:projectedHeaders});
  };
  return mfa&&(isFactor||isRefresh)?await guards.withOwnerLock!(run):await run();
 }catch(e){return e instanceof PlatformError?json(e.status,e.code,e.message):json(503,'AUTH_UNAVAILABLE','身份服务暂不可用。');}
}
