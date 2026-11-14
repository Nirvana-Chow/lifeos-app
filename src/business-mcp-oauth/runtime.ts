import {requireMcpAuth} from '@better-auth/mcp';
import {verifyOAuthQueryParams} from '@better-auth/oauth-provider';
import type {PlatformAuth} from '../platform/auth.ts';
import {readVerifiedOwnerSession} from '../platform/auth.ts';
import {getPlatformBusinessOAuthContext} from '../platform/runtime.ts';
import {getAgentBusinessGrantReader} from '../agent-api/runtime.ts';
import {intersectOAuthGrant,tokenIdentity,validateBusinessClaims,type BusinessAccessClaims,type OriginalGrant,type OAuthGrant} from './ledger.ts';
import {configuredOAuthGrantAvailable,readBusinessOAuthConfig,type BusinessOAuthConfig} from './boundary.ts';
import {createBusinessOAuthHttp} from './http.ts';
import {verifyBusinessOAuthPool} from './readiness.ts';
import {sameOAuthFence,type OAuthGrantFence} from './contracts.ts';
type Reader=(id:string)=>Promise<OriginalGrant|null>;
async function verifyToken(auth:PlatformAuth,config:BusinessOAuthConfig,ownerId:string,token:string):Promise<BusinessAccessClaims|null>{
 let result:BusinessAccessClaims|null=null;
 try{await requireMcpAuth(auth,(_request,claims)=>{result=validateBusinessClaims(claims,config,ownerId);return new Response(null,{status:204});},{resource:config.resource,issuer:config.issuer})(new Request(config.resource,{headers:{authorization:'Bearer '+token}}));}catch{return null;}
 return result;
}
export async function resolveBusinessOAuthToken(token:string,readGrant:Reader):Promise<OAuthGrant|null>{
 try{const context=await getPlatformBusinessOAuthContext();if(!context)return null;
  const claims=await verifyToken(context.auth,context.config,context.personal.ownerId,token);if(!claims)return null;
  const state=await context.ledger.read(tokenIdentity(token));if(!state||state.oauthFence.expiresAt!==claims.exp)return null;
  return intersectOAuthGrant(state,await readGrant(state.grantId));
 }catch{return null;}
}
export async function readCurrentBusinessOAuthGrant(grantId:string,fence:OAuthGrantFence,readGrant:Reader):Promise<OAuthGrant|null>{
 try{const context=await getPlatformBusinessOAuthContext();if(!context)return null;const state=await context.ledger.read(fence.tokenId);
  if(!state||state.grantId!==grantId||!sameOAuthFence(state.oauthFence,fence))return null;
  return intersectOAuthGrant(state,await readGrant(grantId));
 }catch{return null;}
}
const unavailable=()=>Response.json({error:'BUSINESS_MCP_OAUTH_UNAVAILABLE'},{status:503,headers:{'Cache-Control':'private, no-store'}});
export async function handleBusinessOAuthRequest(request:Request):Promise<Response>{
 try{
  if(!readBusinessOAuthConfig(process.env,'https://lifeos.nirvanachow.com'))return Response.json({error:'NOT_FOUND'},{status:404});
  const context=await getPlatformBusinessOAuthContext();if(!context)return unavailable();
  const readGrant=await getAgentBusinessGrantReader();if(!readGrant)return unavailable();
  const assertReady=async()=>{
   await verifyBusinessOAuthPool(context.pool,context.config,{ownerId:context.personal.ownerId,ownerEmail:context.platform.ownerEmail,spaceId:context.personal.spaceId});
   const grant=await readGrant(context.config.grantId);if(!configuredOAuthGrantAvailable(context.config,grant,context.personal))throw Error('OAUTH_CURRENT_GRANT_UNAVAILABLE');
  };
  return createBusinessOAuthHttp({origin:context.platform.baseURL,config:context.config,assertReady,owner:headers=>readVerifiedOwnerSession(context.readAuth,context.platform,headers),handler:r=>context.auth.handler(r),verifyQuery:query=>verifyOAuthQueryParams(query,context.platform.secret),verifyToken:token=>verifyToken(context.auth,context.config,context.personal.ownerId,token),ledger:context.ledger})(request);
 }catch{return unavailable();}
}
