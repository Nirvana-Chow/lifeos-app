import {isHTTPSOrigin, type PlatformConfig} from '../platform/config.ts';
import type {PersonalConfig} from '../personal-candidate/config.ts';
import {readBusinessOAuthConfig} from '../business-mcp-oauth/boundary.ts';

const businessOAuthRuntimeKeys=['LIFEOS_BUSINESS_MCP_OAUTH','LIFEOS_BUSINESS_MCP_GRANT_ID','LIFEOS_BUSINESS_MCP_SCOPES'] as const;

export const agentRuntimeKeys = [
  'LIFEOS_AGENT_API_ENABLED',
  'LIFEOS_AGENT_API_DATABASE_URL',
  'LIFEOS_AGENT_API_SECRET',
  'LIFEOS_AGENT_ORGANIZATION',
  'LIFEOS_AGENT_REQUIREMENTS',
  'LIFEOS_AGENT_CLASSIFICATION',
  'LIFEOS_AGENT_ALL_BUSINESS_DATA',
  'LIFEOS_AGENT_PERSONAL_RECORDS',
  'LIFEOS_AGENT_STORAGE_REVIEW',
  'LIFEOS_AGENT_REQUIREMENT_EVENTS',
  'LIFEOS_MCP_HTTP',
  ...businessOAuthRuntimeKeys,
] as const;

export const agentVerifierRole = 'lifeos_agent_verifier';
export const agentMcpHttpTransport = 'streamable-http-v1' as const;

/** One versioned transport codec for protected startup and the HTTP boundary.
 * A parsed transport is not Agent authority; the complete binding below and
 * the existing live API dispatcher remain required. */
export function readAgentMcpHttpTransport(env:Record<string,string|undefined>):typeof agentMcpHttpTransport|null {
  const transport=env.LIFEOS_MCP_HTTP;
  if(transport===undefined)return null;
  if(transport!==agentMcpHttpTransport)throw Error('Agent runtime configuration unavailable');
  return transport;
}

export function readAgentRuntimeConfig(
  env: Record<string, string | undefined>,
  platform: PlatformConfig,
  personal: PersonalConfig | null,
): Readonly<{databaseURL: string; secret: string}> | null {
  if (agentRuntimeKeys.every(key => env[key] === undefined)) return null;

  const invalid = (): never => { throw Error('Agent runtime configuration unavailable'); };
  const mcpTransport=readAgentMcpHttpTransport(env);
  const databaseURL = env.LIFEOS_AGENT_API_DATABASE_URL;
  const secret = env.LIFEOS_AGENT_API_SECRET;
  if (env.LIFEOS_AGENT_API_ENABLED !== '1' || !personal || personal.transport === 'ssh-loopback' ||
      !personal.allowedTypes.includes('todo') || !databaseURL || !secret ||
      Buffer.byteLength(secret) < 32 || Buffer.byteLength(secret) > 512 || secret === platform.secret) return invalid();

  try {
    const database = new URL(databaseURL);
    const business = new URL(platform.databaseURL);
    if (!isHTTPSOrigin(new URL(platform.baseURL)) || !['postgres:', 'postgresql:'].includes(database.protocol) ||
        database.hostname !== '127.0.0.1' || database.port !== business.port ||
        database.pathname !== business.pathname || database.pathname !== '/' + personal.databaseName ||
        database.username !== agentVerifierRole || !database.password || database.search || database.hash) return invalid();
  } catch {
    return invalid();
  }
  if(businessOAuthRuntimeKeys.some(key=>env[key]!==undefined)){
    try{if(mcpTransport!==agentMcpHttpTransport||!readBusinessOAuthConfig(env,platform.baseURL))return invalid();}
    catch{return invalid();}
  }
  return Object.freeze({databaseURL, secret});
}

export type AgentModules = Readonly<{organization:boolean;classification:boolean;requirements?:boolean;businessDataPolicy?:boolean;personalRecords?:boolean;storageReview?:boolean;requirementEvents?:boolean}>;
export function readAgentBusinessModules(env: Record<string,string|undefined>, personal: PersonalConfig|null): AgentModules {
  const events=env.LIFEOS_AGENT_REQUIREMENT_EVENTS;
  if(events!==undefined&&(events!=='requirement-events-v1'||env.LIFEOS_AGENT_REQUIREMENTS!=='requirements-v1'||personal?.requirementsEnabled!==true))throw Error('Agent requirement events configuration unavailable');
  const review=env.LIFEOS_AGENT_STORAGE_REVIEW;
  if(review!==undefined&&(review!=='storage-review-v1'||!personal||env.LIFEOS_AGENT_ALL_BUSINESS_DATA!=='all-personal-business-v1'))throw Error('Agent storage review configuration unavailable');
  const records=env.LIFEOS_AGENT_PERSONAL_RECORDS;
  if(records!==undefined&&(records!=='personal-records-v1'||!personal||env.LIFEOS_AGENT_ALL_BUSINESS_DATA!=='all-personal-business-v1'))throw Error('Agent personal records configuration unavailable');
  const policy=env.LIFEOS_AGENT_ALL_BUSINESS_DATA;
  if(policy!==undefined&&policy!=='all-personal-business-v1'||policy&&!personal)throw Error('Agent business policy configuration unavailable');
  const requirement=env.LIFEOS_AGENT_REQUIREMENTS;if(requirement!==undefined&&requirement!=='requirements-v1'||requirement&&personal?.requirementsEnabled!==true)throw Error('Agent requirements configuration unavailable');
  const org = env.LIFEOS_AGENT_ORGANIZATION; const classification = env.LIFEOS_AGENT_CLASSIFICATION;
  if (org !== undefined && org !== 'organization-v1' || classification !== undefined && classification !== 'todo-classification-v1' || classification && !org || org && !personal) throw Error('Agent business configuration unavailable');
  return Object.freeze({...(events?{requirementEvents:true}:{}),...(review?{storageReview:true}:{}),...(records?{personalRecords:true}:{}),...(policy?{businessDataPolicy:true}:{}),...(requirement?{requirements:true}:{}),organization:org === 'organization-v1',classification:classification === 'todo-classification-v1'});
}
