import {createHash} from 'node:crypto';
import {agentOperations} from '../agent-api/capabilities.ts';
import type {OperationScope} from '../agent-api/personal-operation-registry.ts';
import type {SqlPool} from '../platform/postgres.ts';
import {allPersonalBusinessOAuthScope,fullBusinessOAuthScopes,isOAuthBusinessOperation,type BusinessOAuthConfig} from './boundary.ts';
import {allPersonalBusinessPolicy,policyAuthorizationScopes} from '../agent-api/business-policy.ts';
import type {OAuthGrantFence} from './contracts.ts';
import type {FilePermission} from '../file-handoff/authorization.ts';
import {isOAuthProducerRevision} from '../personal-candidate/classification-oauth.ts';

export type BusinessAccessClaims=Readonly<{iss:string;aud:string;sub:string;azp:string;client_id:string;sid?:string|null;iat:number;exp:number;scope:string}>;
export type OriginalGrant=Readonly<{grantId:string;ownerId:string;spaceId:string;scopes:readonly OperationScope[];authorizationRevision?:string;businessDataPolicy?:'all-personal-business-v1';allowedOperationIds?:readonly string[];fileHandoff?:FilePermission}>;
export type OAuthState=Readonly<{grantId:string;ownerId:string;spaceId:string;scopes:readonly string[];oauthFence:OAuthGrantFence;producerAuthorizationRevision?:string}>;
export type OAuthGrant=OriginalGrant&Readonly<{allowedOperationIds:readonly string[];oauthFence:OAuthGrantFence}>;
export function tokenIdentity(token:string):string{return createHash('sha256').update(token).digest('hex');}
/** Called only after the official verifier. Structural checks add local authority constraints. */
export function validateBusinessClaims(value:unknown,config:BusinessOAuthConfig,ownerId:string,now=Math.floor(Date.now()/1000)):BusinessAccessClaims|null{
 if(!value||typeof value!=='object')return null;const v=value as Record<string,unknown>;
 if(v.iss!==config.issuer||v.aud!==config.resource||v.sub!==ownerId||typeof v.azp!=='string'||!v.azp||v.azp.length>2048||v.client_id!==v.azp||v.sid!==undefined&&v.sid!==null&&(typeof v.sid!=='string'||!v.sid||v.sid.length>128)||!Number.isSafeInteger(v.iat)||!Number.isSafeInteger(v.exp)||(v.iat as number)>now+30||(v.exp as number)<=now||(v.exp as number)<=(v.iat as number)||(v.exp as number)-(v.iat as number)>3600||typeof v.scope!=='string'||v.scope.length>2048||v.cnf!==undefined)return null;
 const scopes=v.scope.split(' ');
 if(new Set(scopes).size!==scopes.length||scopes.some(scope=>!config.scopes.includes(scope))||!scopes.some(scope=>scope!=='offline_access')||scopes.some(scope=>scope.endsWith(':write')&&!scopes.includes(scope.replace(/:write$/,':read'))))return null;
 return value as BusinessAccessClaims;
}
export function intersectOAuthGrant(state:OAuthState,grant:OriginalGrant|null):OAuthGrant|null{
 if(!grant||grant.grantId!==state.grantId||grant.ownerId!==state.ownerId||grant.spaceId!==state.spaceId)return null;
 if(state.oauthFence.policy!==undefined&&state.oauthFence.policy!==allPersonalBusinessPolicy||state.scopes.includes(allPersonalBusinessOAuthScope)!==(state.oauthFence.policy===allPersonalBusinessPolicy))return null;
 if(state.scopes.includes(allPersonalBusinessOAuthScope)){
  if(!fullBusinessOAuthScopes(state.scopes)||state.oauthFence.policy!==allPersonalBusinessPolicy||grant.businessDataPolicy!==allPersonalBusinessPolicy||!Array.isArray(grant.allowedOperationIds))return null;
  if(!isOAuthProducerRevision(state.producerAuthorizationRevision))return null;
  const business=agentOperations.filter(operation=>isOAuthBusinessOperation(operation.id,true)&&grant.allowedOperationIds!.includes(operation.id)&&policyAuthorizationScopes(operation)?.every(scope=>grant.scopes.includes(scope as OperationScope)));
  const fileScopes=grant.fileHandoff?grant.fileHandoff.scopes.filter(scope=>state.scopes.includes(scope)&&grant.scopes.includes(scope)):[];
  const files=fileScopes.length?agentOperations.filter(operation=>isOAuthBusinessOperation(operation.id)&&operation.module==='fileHandoff'&&grant.allowedOperationIds!.includes(operation.id)&&operation.requiredScopes.every(scope=>fileScopes.includes(scope as FilePermission['scopes'][number]))):[];
  const scopes=[...new Set([...business.flatMap(operation=>policyAuthorizationScopes(operation)!),...fileScopes])].sort() as OperationScope[];
  const allowedOperationIds=[...business,...files].map(operation=>operation.id);
  if(!scopes.length||!allowedOperationIds.length)return null;
  const{fileHandoff,...base}=grant;
  return Object.freeze({...base,authorizationRevision:state.producerAuthorizationRevision,...(fileHandoff&&fileScopes.length?{fileHandoff:{...fileHandoff,scopes:fileScopes}}:{}),scopes:Object.freeze(scopes),allowedOperationIds:Object.freeze(allowedOperationIds),oauthFence:Object.freeze({...state.oauthFence})});
 }
 const scopes=grant.scopes.filter(scope=>state.scopes.includes(scope)).sort();
 if(!scopes.length||scopes.some(scope=>scope.endsWith(':write')&&!scopes.includes(scope.replace(/:write$/,':read') as OperationScope)))return null;
 const allowedOperationIds=agentOperations.filter(operation=>isOAuthBusinessOperation(operation.id)&&operation.requiredScopes.every(scope=>scopes.includes(scope as OperationScope))&&(!grant.businessDataPolicy||grant.allowedOperationIds?.includes(operation.id))).map(operation=>operation.id);
 if(!allowedOperationIds.length)return null;
 const fileScopes=scopes.filter(scope=>scope.startsWith('file-handoff:')) as FilePermission['scopes'];
 const{fileHandoff,...base}=grant;
 return Object.freeze({...base,...(fileHandoff&&fileScopes.length?{fileHandoff:{...fileHandoff,scopes:fileScopes}}:{}),scopes:Object.freeze(scopes),allowedOperationIds:Object.freeze(allowedOperationIds),oauthFence:Object.freeze({...state.oauthFence})});
}
function parseState(value:unknown):OAuthState|null{
 if(!value||typeof value!=='object')return null;const v=value as Record<string,unknown>,f=v.oauthFence as Record<string,unknown>|undefined;
 if(typeof v.grantId!=='string'||typeof v.ownerId!=='string'||typeof v.spaceId!=='string'||!Array.isArray(v.scopes)||v.scopes.some(s=>typeof s!=='string')||!f||typeof f.tokenId!=='string'||!/^[a-f0-9]{64}$/.test(f.tokenId)||typeof f.bindingId!=='string'||!Number.isSafeInteger(f.bindingRevision)||!Number.isSafeInteger(f.expiresAt))return null;
 if(f.policy!==undefined&&f.policy!==allPersonalBusinessPolicy||v.scopes.includes(allPersonalBusinessOAuthScope)!==(f.policy===allPersonalBusinessPolicy)||v.scopes.includes(allPersonalBusinessOAuthScope)&&(!fullBusinessOAuthScopes(v.scopes as string[])||!isOAuthProducerRevision(v.producerAuthorizationRevision)))return null;
 return v as OAuthState;
}
export class BusinessOAuthLedger{
 private readonly pool:SqlPool;readonly config:BusinessOAuthConfig;readonly ownerId:string;readonly spaceId:string;
 constructor(pool:SqlPool,config:BusinessOAuthConfig,ownerId:string,spaceId:string){this.pool=pool;this.config=config;this.ownerId=ownerId;this.spaceId=spaceId;}
 private async query(sql:string,values:unknown[]):Promise<unknown>{const client=await this.pool.connect();try{return(await client.query(sql,values)).rows[0]?.value;}finally{client.release();}}
 async register(token:string,claims:BusinessAccessClaims,grantType:'authorization_code'|'refresh_token'):Promise<OAuthState|null>{
  const fn=this.config.scopes.includes(allPersonalBusinessOAuthScope)?'register_policy_oauth_business_token':this.config.scopes.some(scope=>scope.startsWith('file-handoff:'))?'register_file_handoff_oauth_token':'register_oauth_business_token';
  const value=await this.query(`SELECT lifeos_agent.${fn}($1,$2,$3,$4,$5::jsonb,$6) AS value`,[this.config.grantId,this.ownerId,this.spaceId,tokenIdentity(token),JSON.stringify(claims),grantType]);return parseState(value);
 }
 async read(tokenId:string):Promise<OAuthState|null>{if(!/^[a-f0-9]{64}$/.test(tokenId))return null;const fn=this.config.scopes.includes(allPersonalBusinessOAuthScope)?'read_policy_oauth_business_token':'read_oauth_business_token';return parseState(await this.query(`SELECT lifeos_agent.${fn}($1,$2,$3) AS value`,[tokenId,this.ownerId,this.spaceId]));}
 async approve(sessionId:string,clientId:string,scopes:readonly string[]):Promise<void>{
  const fn=this.config.scopes.includes(allPersonalBusinessOAuthScope)?'approve_policy_oauth_business_binding':this.config.scopes.some(scope=>scope.startsWith('file-handoff:'))?'approve_file_handoff_oauth_binding':'approve_oauth_business_binding';
  if(await this.query(`SELECT lifeos_agent.${fn}($1,$2,$3,$4,$5,$6::text[]) AS value`,[sessionId,this.config.grantId,this.ownerId,this.spaceId,clientId,scopes])!==true)throw Error('OAUTH_CONSENT_BINDING_DENIED');
 }
 async revoke(token:string,claims:BusinessAccessClaims,providerAuthenticated=false):Promise<void>{
  if(!providerAuthenticated)throw Error('OAUTH_CLIENT_AUTHENTICATION_REQUIRED');
  if(await this.query('SELECT lifeos_agent.revoke_oauth_business_token($1,$2,$3) AS value',[tokenIdentity(token),claims.sub,claims.azp])!==true)throw Error('OAUTH_REVOKE_DENIED');
 }
}
