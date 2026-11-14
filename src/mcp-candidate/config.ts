import {object} from '../platform/domain.ts';
/** Host-owned configuration only. No tool, business record or downloaded documentation supplies this. */
export type McpRuntimeConfig=Readonly<{origin:string}>;
export type CredentialProvider=()=>Promise<string|null>;
export type McpRuntimeOptions=McpRuntimeConfig&Readonly<{
 /** Trusted host adoption only; omitted on existing hosts. Never read from tool inputs. */
 fileHandoff?:'file-handoff-v1';
 credentialProvider?:CredentialProvider;
 /** Explicit trusted transport format; syntax is never an authorization decision. */
 credentialFormat?:'api-key'|'business-oauth-jwt';
 nativeRequest?:(path:string,method:string,encoded?:string,key?:string)=>Promise<{status:number;data:Record<string,unknown>;credentialFingerprint:string}>;
 durable?:import('./native-store.mjs').DurableStore;
 /** Optional trusted-code wrapper for the existing documentation updater; never remote executable code. */
 beforeUse?:()=>Promise<void>;
}>;
export function parseMcpRuntimeConfig(input:unknown):McpRuntimeConfig {
 try{
  const value=object(input,['origin']);if(typeof value.origin!=='string')throw Error();
  const url=new URL(value.origin);
  if(url.protocol!=='https:'||url.username||url.password||url.origin!==value.origin)throw Error();
  return Object.freeze({origin:url.origin});
 }catch{throw Error('MCP_CONFIG_INVALID');}
}
