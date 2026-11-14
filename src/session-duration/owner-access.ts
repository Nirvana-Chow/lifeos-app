import {readOwnerMfaState,readVerifiedOwnerSession,type PlatformAuth} from '../platform/auth.ts';
import type {PlatformConfig} from '../platform/config.ts';
import {assertLocalRequest,readJSONBody} from '../platform/request-boundary.ts';
import {PlatformError} from '../platform/domain.ts';
import {storedSessionDuration} from './policy.ts';
const path='/api/platform/auth/device-sessions';
/** Website owner only. Native bearer tokens never leave this server-side projection. */
export function ownerDeviceSessions(options:{auth:PlatformAuth;readAuth:PlatformAuth;config:PlatformConfig;withOwnerLock:<T>(run:()=>Promise<T>)=>Promise<T>}){
 const headers={'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
 const error=(status:number,code:string)=>Response.json({error:{code}},{status,headers});
 return async(request:Request):Promise<Response>=>{try{
  const url=new URL(request.url);if(url.pathname!==path||url.search||!['GET','POST'].includes(request.method))return error(404,'NOT_FOUND');
  assertLocalRequest(request,options.config.baseURL);if(request.headers.has('authorization'))return error(401,'AUTH_REQUIRED');
  if(request.method==='POST'&&request.headers.get('origin')!==options.config.baseURL)return error(403,'ORIGIN_DENIED');
  const nativeHeaders=new Headers(request.headers);nativeHeaders.set('x-platform-client','127.0.0.1');
  const list=async()=>{
   if((await readOwnerMfaState(options.readAuth,options.config,nativeHeaders)).kind!=='ready')return null;
   return options.readAuth.api.listSessions({headers:nativeHeaders});
  };
  if(request.method==='GET'){
   const sessions=await list();if(!sessions)return error(401,'AUTH_REQUIRED');
   const current=await options.readAuth.api.getSession({headers:nativeHeaders});
   return Response.json({sessions:sessions.slice(0,50).map(session=>({id:session.id,current:session.id===current?.session.id,createdAt:session.createdAt,expiresAt:session.expiresAt,userAgent:(session.userAgent??'').slice(0,160),duration:storedSessionDuration(session as unknown as Record<string,unknown>)})),truncated:sessions.length>50},{headers});
  }
  const body=await readJSONBody(request);if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||!('id'in body)||typeof body.id!=='string'||!/^[-_A-Za-z0-9]{1,128}$/.test(body.id))return error(400,'INVALID_REQUEST');
  return await options.withOwnerLock(async()=>{
   const current=await readVerifiedOwnerSession(options.readAuth,options.config,nativeHeaders);
   if(!current)return error(403,'REAUTH_REQUIRED');
   const sessions=await list();if(!sessions)return error(401,'AUTH_REQUIRED');
   const target=sessions.find(session=>session.id===body.id);if(!target)return error(404,'NOT_FOUND');
   const self=target.id===current.sessionRef;let signedOut:Response|undefined;
   if(self){nativeHeaders.set('content-type','application/json');nativeHeaders.delete('content-length');signedOut=await options.auth.handler(new Request(options.config.baseURL+'/api/platform/auth/sign-out',{method:'POST',headers:nativeHeaders,body:'{}'}));if(!signedOut.ok)return error(503,'REVOCATION_UNKNOWN');}
   else await options.auth.api.revokeSession({headers:nativeHeaders,body:{token:target.token}});
   if(await(await options.auth.$context).internalAdapter.findSession(target.token))return error(503,'REVOCATION_UNKNOWN');
   const response=Response.json({revoked:true,signedOut:self},{headers});for(const cookie of signedOut?.headers.getSetCookie()??[])response.headers.append('set-cookie',cookie);return response;
  });
 }catch(e){return e instanceof PlatformError?error(e.status,e.code):error(503,'DEVICE_SESSIONS_UNAVAILABLE');}};
}
