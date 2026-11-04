import type {Transaction} from '../platform/contracts.ts';
import {PlatformError} from '../platform/domain.ts';
import {normalizeAgentScopes,type AgentScope} from './scopes.ts';

export type AgentGrantBinding = Readonly<{grantId:string;ownerId:string;spaceId:string}>;
export type AgentWriteGrant = AgentGrantBinding;

/** A producer may require only read scopes. Never invent write authority for a preview. */
export async function assertAgentGrant(tx:Transaction,grant:AgentGrantBinding,requiredScopes:readonly AgentScope[]):Promise<void>{
  let scopes:readonly AgentScope[];
  try{scopes=normalizeAgentScopes(requiredScopes);}catch{throw new PlatformError(403,'GRANT_SCOPES_INVALID','授权范围无效。');}
  if(!tx.lockAgentGrant)throw new PlatformError(503,'AGENT_WRITE_FENCE_UNAVAILABLE','业务授权检查暂不可用。');
  if(!await tx.lockAgentGrant(grant,scopes))throw new PlatformError(403,'WRITE_GRANT_REVOKED','业务授权已失效。');
}

/** Only the legacy todo writer can use the pre-business migration fence. */
export async function assertAgentTodoWriteGrant(tx:Transaction,grant:AgentWriteGrant):Promise<void>{
  if(tx.lockAgentGrant)return assertAgentGrant(tx,grant,['todo:read','todo:write']);
  if(!tx.lockAgentTodoWriteGrant)throw new PlatformError(503,'AGENT_WRITE_FENCE_UNAVAILABLE','待办写入授权检查暂不可用。');
  if(!await tx.lockAgentTodoWriteGrant(grant))throw new PlatformError(403,'WRITE_GRANT_REVOKED','待办写入授权已失效。');
}
