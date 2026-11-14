import {agentOperations,oauthBusinessMcpOperations,policyOAuthBusinessMcpOperations} from '../agent-api/capabilities.ts';
import {isBusinessMcpOperation} from '../mcp-http/business-policy.ts';
import {allPersonalBusinessPolicy,policyAuthorizationScopes} from '../agent-api/business-policy.ts';
export const businessMcpResource='https://lifeos.nirvanachow.com/api/platform/mcp';
export const allPersonalBusinessOAuthScope='personal-business:all' as const;
/** Full policy is explicit. Ordinary narrow scopes cannot be mixed into it. */
export function fullBusinessOAuthScopes(scopes:readonly string[]):boolean{
 return scopes.includes(allPersonalBusinessOAuthScope)&&new Set(scopes).size===scopes.length&&scopes.every(scope=>[allPersonalBusinessOAuthScope,'offline_access','file-handoff:read','file-handoff:write'].includes(scope))&&(!scopes.includes('file-handoff:write')||scopes.includes('file-handoff:read'));
}
export type BusinessOAuthConfig=Readonly<{resource:string;issuer:string;grantId:string;scopes:readonly string[]}>;
type ConfiguredGrant=Readonly<{grantId:string;ownerId:string;spaceId:string;scopes:readonly string[];businessDataPolicy?:string;allowedOperationIds?:readonly string[];fileHandoff?:Readonly<{scopes:readonly string[]}>}>;
export function configuredOAuthGrantAvailable(config:BusinessOAuthConfig,grant:ConfiguredGrant|null,owner:{ownerId:string;spaceId:string}):boolean{
 if(!grant||grant.grantId!==config.grantId||grant.ownerId!==owner.ownerId||grant.spaceId!==owner.spaceId)return false;
 if(!config.scopes.includes(allPersonalBusinessOAuthScope))return config.scopes.every(scope=>scope==='offline_access'||grant.scopes.includes(scope));
 if(!fullBusinessOAuthScopes(config.scopes)||grant.businessDataPolicy!==allPersonalBusinessPolicy||!Array.isArray(grant.allowedOperationIds))return false;
 const files=config.scopes.filter(scope=>scope.startsWith('file-handoff:'));
 if(files.some(scope=>!grant.scopes.includes(scope)||!grant.fileHandoff?.scopes.includes(scope)))return false;
 if(files.includes('file-handoff:read')&&!grant.allowedOperationIds.includes('getFileHandoff')||files.includes('file-handoff:write')&&!grant.allowedOperationIds.includes('stageFileHandoff'))return false;
 return agentOperations.some(operation=>isOAuthBusinessOperation(operation.id,true)&&grant.allowedOperationIds!.includes(operation.id)&&policyAuthorizationScopes(operation)?.every(scope=>grant.scopes.includes(scope)))||files.length>0;
}
/** Legacy narrow configurations retain their old catalog/schema requirements. */
export function isOAuthBusinessOperation(id:string,producerBinding=false):boolean{return(producerBinding?policyOAuthBusinessMcpOperations:oauthBusinessMcpOperations).some(operation=>operation.id===id);}
/** API keys retain their exact old grammar; OAuth is a separate bounded format. */
export function readBusinessBearer(header:string|null):string|null{
 const key=/^Bearer ([A-Za-z0-9_-]{1,256})$/.exec(header??'')?.[1];if(key)return key;
 if(!header||header.length>8199)return null;
 return /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(header)?.[1]??null;
}
export function readBusinessOAuthConfig(env:Record<string,string|undefined>,origin:string):BusinessOAuthConfig|null{
 if(env.LIFEOS_BUSINESS_MCP_OAUTH===undefined||env.LIFEOS_BUSINESS_MCP_OAUTH==='')return null;
 const fail=():never=>{throw Error('BUSINESS_MCP_OAUTH_CONFIG_INVALID');};
 if(env.LIFEOS_BUSINESS_MCP_OAUTH!=='business-mcp-oauth-v1'||origin+'/api/platform/mcp'!==businessMcpResource)return fail();
 const grantId=env.LIFEOS_BUSINESS_MCP_GRANT_ID,raw=env.LIFEOS_BUSINESS_MCP_SCOPES;
 if(!grantId||!/^[A-Za-z0-9_-]{1,128}$/.test(grantId)||!raw||raw.length>2048)return fail();
 const scopes=raw.split(' '),supported=new Set(agentOperations.filter(operation=>isBusinessMcpOperation(operation.id)).flatMap(operation=>[...operation.requiredScopes]));
 if(scopes.some(scope=>scope.startsWith('file-handoff:'))&&env.LIFEOS_FILE_HANDOFF!=='file-handoff-v1')return fail();
 if(!scopes.length||new Set(scopes).size!==scopes.length||scopes.includes(allPersonalBusinessOAuthScope)&&!fullBusinessOAuthScopes(scopes)||scopes.some(scope=>scope!==allPersonalBusinessOAuthScope&&scope!=='offline_access'&&!supported.has(scope as never))||scopes.every(scope=>scope==='offline_access')||scopes.some(scope=>scope.endsWith(':write')&&!scopes.includes(scope.replace(/:write$/,':read'))))return fail();
 return Object.freeze({resource:businessMcpResource,issuer:origin+'/api/platform/auth',grantId,scopes:Object.freeze(scopes)});
}
