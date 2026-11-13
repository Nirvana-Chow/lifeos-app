import {getPlatformBusinessOAuthContext} from '../platform/runtime.ts';
import {readVerifiedOwnerSession} from '../platform/auth.ts';
import {ownerRecoveryLock} from '../personal-candidate/owner-recovery-lock.ts';
import {readBusinessOAuthConfig} from './boundary.ts';
import {verifyBusinessOAuthPool} from './readiness.ts';
import {createManagedClientHandler} from './managed-client-http.ts';
export async function handleManagedClientRequest(request:Request):Promise<Response>{
 const error=(status:number,code:string)=>Response.json({error:{code}},{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff'}});
 try{
  if(!readBusinessOAuthConfig(process.env,'https://lifeos.nirvanachow.com'))return error(404,'NOT_FOUND');
  const context=await getPlatformBusinessOAuthContext();if(!context)return error(503,'MANAGED_CLIENT_UNAVAILABLE');
  return createManagedClientHandler({auth:context.auth,platform:context.platform,config:context.config,owner:headers=>readVerifiedOwnerSession(context.readAuth,context.platform,headers),withOwnerLock:ownerRecoveryLock(context.pool,context.platform.ownerId),assertReady:()=>verifyBusinessOAuthPool(context.pool,context.config,{ownerId:context.personal.ownerId,ownerEmail:context.platform.ownerEmail,spaceId:context.personal.spaceId})})(request);
 }catch{return error(503,'MANAGED_CLIENT_UNAVAILABLE');}
}
