import {agentOperations} from '../agent-api/capabilities.ts';
import {isBusinessMcpOperation} from '../mcp-http/business-policy.ts';
export const businessMcpResource='https://lifeos.nirvanachow.com/api/platform/mcp';
export type BusinessOAuthConfig=Readonly<{resource:string;issuer:string;grantId:string;scopes:readonly string[]}>;
/** Classification plans do not yet persist OAuth producer provenance (A2.3/11.1). */
export function isOAuthBusinessOperation(id:string):boolean{return isBusinessMcpOperation(id)&&id!=='previewTodoClassification';}
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
 if(!scopes.length||new Set(scopes).size!==scopes.length||scopes.some(scope=>scope!=='offline_access'&&!supported.has(scope as never))||scopes.every(scope=>scope==='offline_access')||scopes.some(scope=>scope.endsWith(':write')&&!scopes.includes(scope.replace(/:write$/,':read'))))return fail();
 return Object.freeze({resource:businessMcpResource,issuer:origin+'/api/platform/auth',grantId,scopes:Object.freeze(scopes)});
}
