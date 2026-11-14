import type {PlatformAuth} from '../platform/auth.ts';
import type {BusinessOAuthConfig} from './boundary.ts';
import {managedChatGptClientId,managedClientName,managedClientVersion,parseManagedClientCommand,type ManagedClientCommand,type ManagedClientState} from './managed-client-contract.ts';
export class ManagedClientConflict extends Error{constructor(){super('MANAGED_CLIENT_CONFLICT');}}
export class ManagedClientUnknown extends Error{constructor(){super('MANAGED_CLIENT_UNKNOWN');}}
const selected=['clientId','clientDiscoveryId','userId','referenceId','name','disabled','skipConsent','requirePKCE','tokenEndpointAuthMethod','scopes','grantTypes','responseTypes','applicationType','clientCredentialsScopes','redirectUris','metadata','enableEndSession','subjectType','dpopBoundAccessTokens','uri','icon','contacts','tos','policy','softwareId','softwareVersion','softwareStatement','postLogoutRedirectUris','backchannelLogoutUri','backchannelLogoutSessionRequired','jwksUri'];
const same=(a:unknown,b:readonly string[])=>Array.isArray(a)&&a.length===b.length&&a.every(v=>typeof v==='string')&&JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
const absent=(value:unknown)=>value===undefined||value===null;
export async function readManagedClient(auth:PlatformAuth,config:BusinessOAuthConfig,ownerId:string):Promise<ManagedClientState>{
 const {adapter}=await auth.$context;
 // No provider getClient call: a missing HTTPS ID must never trigger CIMD discovery.
 const row=await adapter.findOne<Record<string,unknown>>({model:'platform_oauth_client',where:[{field:'clientId',value:managedChatGptClientId}],select:[...selected]});
 if(!row)return{registered:false};
 const metadata=row.metadata as Record<string,unknown>|null;
 const command=parseManagedClientCommand({callback:Array.isArray(row.redirectUris)&&row.redirectUris.length===1?row.redirectUris[0]:null,commandId:metadata?.command_id});
 const noExtra=['referenceId','uri','icon','contacts','tos','policy','softwareId','softwareVersion','softwareStatement','postLogoutRedirectUris','backchannelLogoutUri','backchannelLogoutSessionRequired','jwksUri'].every(key=>absent(row[key]));
 if(!command||!metadata||typeof metadata!=='object'||Array.isArray(metadata)||Object.keys(metadata).length!==2||metadata.lifeos_managed_client!==managedClientVersion||row.clientId!==managedChatGptClientId||row.clientDiscoveryId!==null||row.userId!==ownerId||row.name!==managedClientName||row.disabled!==false||row.skipConsent!==false||row.requirePKCE!==true||row.tokenEndpointAuthMethod!=='none'||row.applicationType!=='web'||row.enableEndSession!==false||!absent(row.subjectType)&&row.subjectType!=='public'||!absent(row.dpopBoundAccessTokens)&&row.dpopBoundAccessTokens!==false||!same(row.scopes,config.scopes)||!same(row.grantTypes,['authorization_code','refresh_token'])||!same(row.responseTypes,['code'])||!same(row.clientCredentialsScopes,[])||!noExtra)throw new ManagedClientConflict();
 const links=await adapter.findMany<{clientId:string;resourceId:string}>({model:'platform_oauth_client_resource',where:[{field:'clientId',value:managedChatGptClientId}],select:['clientId','resourceId'],limit:2});
 if(links.length!==1||links[0].clientId!==managedChatGptClientId||links[0].resourceId!==config.resource)throw new ManagedClientConflict();
 return{registered:true,...command};
}
export async function registerManagedClient(auth:PlatformAuth,config:BusinessOAuthConfig,ownerId:string,headers:Headers,command:ManagedClientCommand):Promise<{created:boolean;state:ManagedClientState}>{
 const matches=(state:ManagedClientState)=>state.registered&&state.callback===command.callback&&state.commandId===command.commandId;
 const before=await readManagedClient(auth,config,ownerId);
 if(before.registered){if(!matches(before))throw new ManagedClientConflict();return{created:false,state:before};}
 let created=true;
 try{
  // The SDK owns registration and resource linking in its original transaction.
  // Its raw response is deliberately discarded rather than serialized or logged.
  await auth.api.adminCreateOAuthClient({headers,body:{client_name:managedClientName,redirect_uris:[command.callback],scope:config.scopes.join(' '),token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code'],application_type:'web',require_pkce:true,skip_consent:false,enable_end_session:false,subject_type:'public',resources:[config.resource],metadata:{lifeos_managed_client:managedClientVersion,command_id:command.commandId}}});
 }catch{created=false;}
 let current:ManagedClientState;
 try{current=await readManagedClient(auth,config,ownerId);}catch(error){if(error instanceof ManagedClientConflict)throw error;throw new ManagedClientUnknown();}
 if(!current.registered)throw new ManagedClientUnknown();
 if(!matches(current))throw new ManagedClientConflict();
 return{created,state:current};
}
