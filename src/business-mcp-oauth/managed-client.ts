import {randomUUID} from 'node:crypto';
import type {PlatformAuth} from '../platform/auth.ts';
import {oauthConsentReference} from './provider.ts';
import type {BusinessOAuthConfig} from './boundary.ts';
import {isManagedClientReplacement,managedChatGptClientId,managedClientName,managedClientVersion,validManagedCommandId,parseManagedClientWriteCommand,type ManagedClientCommand,type ManagedClientState,type ManagedClientReplaceCommand,type ManagedClientWriteCommand} from './managed-client-contract.ts';
export class ManagedClientConflict extends Error{constructor(){super('MANAGED_CLIENT_CONFLICT');}}
export class ManagedClientUnknown extends Error{constructor(){super('MANAGED_CLIENT_UNKNOWN');}}
const selected=['clientId','clientDiscoveryId','userId','referenceId','name','disabled','skipConsent','requirePKCE','tokenEndpointAuthMethod','scopes','grantTypes','responseTypes','applicationType','clientCredentialsScopes','redirectUris','metadata','enableEndSession','subjectType','dpopBoundAccessTokens','uri','icon','contacts','tos','policy','softwareId','softwareVersion','softwareStatement','postLogoutRedirectUris','backchannelLogoutUri','backchannelLogoutSessionRequired','jwksUri'];
const same=(a:unknown,b:readonly string[])=>Array.isArray(a)&&a.length===b.length&&a.every(v=>typeof v==='string')&&JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
const absent=(value:unknown)=>value===undefined||value===null;
type Registration=ManagedClientWriteCommand&{credentialGeneration?:string};
async function readRegistration(auth:PlatformAuth,config:BusinessOAuthConfig,ownerId:string):Promise<Registration|null>{
 const {adapter}=await auth.$context;
 // No provider getClient call: a missing HTTPS ID must never trigger CIMD discovery.
 const row=await adapter.findOne<Record<string,unknown>>({model:'platform_oauth_client',where:[{field:'clientId',value:managedChatGptClientId}],select:[...selected]});
 if(!row)return null;
 const metadata=row.metadata as Record<string,unknown>|null;
 const hasPrevious=!!metadata&&Object.hasOwn(metadata,'previous_revision');
 const generation=metadata?.credential_generation;
 if(hasPrevious&&!validManagedCommandId(generation))throw new ManagedClientConflict();
 const command=parseManagedClientWriteCommand({callback:Array.isArray(row.redirectUris)&&row.redirectUris.length===1?row.redirectUris[0]:null,commandId:metadata?.command_id,...(hasPrevious?{expectedRevision:metadata?.previous_revision}:{})});
 const noExtra=['referenceId','uri','icon','contacts','tos','policy','softwareId','softwareVersion','softwareStatement','postLogoutRedirectUris','backchannelLogoutUri','backchannelLogoutSessionRequired','jwksUri'].every(key=>absent(row[key]));
 if(!command||!metadata||typeof metadata!=='object'||Array.isArray(metadata)||Object.keys(metadata).length!==(hasPrevious?4:2)||metadata.lifeos_managed_client!==managedClientVersion||row.clientId!==managedChatGptClientId||row.clientDiscoveryId!==null||row.userId!==ownerId||row.name!==managedClientName||row.disabled!==false||row.skipConsent!==false||row.requirePKCE!==true||row.tokenEndpointAuthMethod!=='none'||row.applicationType!=='web'||row.enableEndSession!==false||!absent(row.subjectType)&&row.subjectType!=='public'||!absent(row.dpopBoundAccessTokens)&&row.dpopBoundAccessTokens!==false||!same(row.scopes,config.scopes)||!same(row.grantTypes,['authorization_code','refresh_token'])||!same(row.responseTypes,['code'])||!same(row.clientCredentialsScopes,[])||!noExtra)throw new ManagedClientConflict();
 const links=await adapter.findMany<{clientId:string;resourceId:string}>({model:'platform_oauth_client_resource',where:[{field:'clientId',value:managedChatGptClientId}],select:['clientId','resourceId'],limit:2});
 if(links.length!==1||links[0].clientId!==managedChatGptClientId||links[0].resourceId!==config.resource)throw new ManagedClientConflict();
 return hasPrevious?{...command,credentialGeneration:generation as string}:command;
}
async function readAfterWrite(auth:PlatformAuth,config:BusinessOAuthConfig,ownerId:string){
 try{return await readRegistration(auth,config,ownerId);}
 catch(error){if(error instanceof ManagedClientConflict)throw error;throw new ManagedClientUnknown();}
}
function project(command:Registration|null):ManagedClientState{
 return command?{registered:true,callback:command.callback,commandId:command.commandId,...(command.credentialGeneration?{revision:command.credentialGeneration}:{})}:{registered:false};
}
export async function readManagedClient(auth:PlatformAuth,config:BusinessOAuthConfig,ownerId:string):Promise<ManagedClientState>{
 return project(await readRegistration(auth,config,ownerId));
}
function metadataFor(command:Registration){
 return {lifeos_managed_client:managedClientVersion,command_id:command.commandId,...(isManagedClientReplacement(command)?{previous_revision:command.expectedRevision,credential_generation:command.credentialGeneration}:{})};
}
export async function readManagedCredentialRegistration(auth:PlatformAuth,config:BusinessOAuthConfig,ownerId:string){
 const saved=await readRegistration(auth,config,ownerId);
 return saved?{callback:saved.callback,generation:saved.credentialGeneration??null}:null;
}
export async function registerManagedClient(auth:PlatformAuth,config:BusinessOAuthConfig,ownerId:string,headers:Headers,command:ManagedClientCommand):Promise<{created:boolean;state:ManagedClientState}>{
 const matches=(saved:ManagedClientWriteCommand)=>!isManagedClientReplacement(saved)&&saved.callback===command.callback&&saved.commandId===command.commandId;
 const before=await readRegistration(auth,config,ownerId);
 if(before){if(!matches(before))throw new ManagedClientConflict();return{created:false,state:project(before)};}
 let created=true;
 try{
  // The SDK owns registration and resource linking in its original transaction.
  // Its raw response is deliberately discarded rather than serialized or logged.
  await auth.api.adminCreateOAuthClient({headers,body:{client_name:managedClientName,redirect_uris:[command.callback],scope:config.scopes.join(' '),token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code'],application_type:'web',require_pkce:true,skip_consent:false,enable_end_session:false,subject_type:'public',resources:[config.resource],metadata:metadataFor(command)}});
 }catch{created=false;}
 const current=await readAfterWrite(auth,config,ownerId);
 if(!current)throw new ManagedClientUnknown();
 if(!matches(current))throw new ManagedClientConflict();
 return{created,state:project(current)};
}

export async function replaceManagedClient(auth:PlatformAuth,config:BusinessOAuthConfig,ownerId:string,command:ManagedClientReplaceCommand){
 const matches=(saved:ManagedClientWriteCommand|null)=>saved&&isManagedClientReplacement(saved)&&saved.expectedRevision===command.expectedRevision&&saved.commandId===command.commandId&&saved.callback===command.callback;
 const before=await readRegistration(auth,config,ownerId);
 if(matches(before))return{duplicate:true,state:project(before)};
 if(!before||(before.credentialGeneration??before.commandId)!==command.expectedRevision||before.callback===command.callback)throw new ManagedClientConflict();

 const {adapter}=await auth.$context;
 let applied=false;
 try{
  // The original managed metadata is a JSON column. Its exact value is the
  // compare-and-swap predicate; the existing database trigger invalidates bindings.
  applied=await adapter.transaction(async transaction=>{
   const client=[{field:'clientId',value:managedChatGptClientId},{field:'userId',value:ownerId}];
   const count=await transaction.updateMany({model:'platform_oauth_client',where:[
    ...client,{field:'clientDiscoveryId',value:null},{field:'disabled',value:false},
    {field:'metadata',value:JSON.stringify(metadataFor(before))},
   ],update:{redirectUris:[command.callback],metadata:metadataFor({...command,credentialGeneration:randomUUID()})}});
   if(count!==1)return false;
   // A normal reconnect must prompt even when the caller omits the optional prompt parameter.
   await transaction.deleteMany({model:'platform_oauth_consent',where:[...client,{field:'referenceId',value:oauthConsentReference}]});
   return true;
  });
 }catch{/* A committed change can lose its response. Always reconcile by reading the fixed record. */}
 const saved=await readAfterWrite(auth,config,ownerId);
 if(matches(saved))return{duplicate:!applied,state:project(saved)};
 if(saved&&(saved.credentialGeneration??saved.commandId)!==(before.credentialGeneration??before.commandId))throw new ManagedClientConflict();
 throw new ManagedClientUnknown();
}
