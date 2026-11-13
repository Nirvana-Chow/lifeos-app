import type {PlatformAuth,readVerifiedOwnerSession} from '../platform/auth.ts';
import type {PlatformConfig} from '../platform/config.ts';
import type {BusinessOAuthConfig} from './boundary.ts';
import {PlatformError} from '../platform/domain.ts';
import {assertLocalRequest,readJSONBody} from '../platform/request-boundary.ts';
import {OwnerRecoveryBusy} from '../personal-candidate/owner-recovery-lock.ts';
import {managedChatGptClientId,managedClientPath,parseManagedClientCommand,type ManagedClientState,type ManagedClientSetup} from './managed-client-contract.ts';
import {ManagedClientConflict,ManagedClientUnknown,readManagedClient,registerManagedClient} from './managed-client.ts';
export type ManagedClientHttpOptions={auth:PlatformAuth;platform:PlatformConfig;config:BusinessOAuthConfig;owner:(headers:Headers)=>ReturnType<typeof readVerifiedOwnerSession>;assertReady:()=>Promise<void>;withOwnerLock:<T>(run:()=>Promise<T>)=>Promise<T>};
const privateHeaders={'Cache-Control':'private, no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff'};
const failure=(status:number,code:string)=>Response.json({error:{code}},{status,headers:privateHeaders});
function setup(config:BusinessOAuthConfig,state:ManagedClientState):ManagedClientSetup{return{clientId:managedChatGptClientId,authorizationEndpoint:config.issuer+'/oauth2/authorize',tokenEndpoint:config.issuer+'/oauth2/token',resource:config.resource,scopes:[...config.scopes],tokenEndpointAuthMethod:'none',codeChallengeMethod:'S256',...state};}
export function createManagedClientHandler(options:ManagedClientHttpOptions){return async(request:Request):Promise<Response>=>{
 const url=new URL(request.url);
 if(url.pathname!==managedClientPath||url.search)return failure(404,'NOT_FOUND');
 if(!['GET','POST'].includes(request.method))return failure(405,'METHOD_NOT_ALLOWED');
 try{
  assertLocalRequest(request,options.platform.baseURL);
  if((request.method==='POST'&&request.headers.get('origin')!==options.platform.baseURL)||(request.headers.has('origin')&&request.headers.get('origin')!==options.platform.baseURL))return failure(403,'ORIGIN_DENIED');
  const cookie=request.headers.get('cookie');
  if(request.headers.has('authorization')||!cookie||cookie.length>8192)return failure(401,'AUTH_REQUIRED');
  const headers=new Headers({cookie,host:new URL(options.platform.baseURL).host,origin:options.platform.baseURL,'x-platform-client':'127.0.0.1'});
  const command=request.method==='POST'?parseManagedClientCommand(await readJSONBody(request)):null;
  if(request.method==='POST'&&!command)return failure(400,'INVALID_MANAGED_CLIENT_REQUEST');
  return await options.withOwnerLock(async()=>{
   if(!await options.owner(headers))return failure(401,'AUTH_REQUIRED');
   await options.assertReady();
   const result=command?await registerManagedClient(options.auth,options.config,options.platform.ownerId,headers,command):{created:false,state:await readManagedClient(options.auth,options.config,options.platform.ownerId)};
   if(!await options.owner(headers))return failure(401,'AUTH_REQUIRED');
   await options.assertReady();
   return Response.json({configuration:setup(options.config,result.state),...(command?{verified:true,duplicate:!result.created}:{})},{status:command&&result.created?201:200,headers:privateHeaders});
  });
 }catch(error){
  if(error instanceof PlatformError)return failure(error.status,error.code);
  if(error instanceof OwnerRecoveryBusy)return failure(409,'OWNER_ACCOUNT_BUSY');
  if(error instanceof ManagedClientConflict)return failure(409,'MANAGED_CLIENT_CONFLICT');
  return failure(503,error instanceof ManagedClientUnknown?'MANAGED_CLIENT_UNKNOWN':'MANAGED_CLIENT_UNAVAILABLE');
 }
};}
