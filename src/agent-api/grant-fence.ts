import type {Transaction} from '../platform/contracts.ts';
import {PlatformError} from '../platform/domain.ts';
import {normalizeAgentScopes} from './scopes.ts';
import type {OperationScope} from './personal-operation-registry.ts';
import {agentOperations} from './capabilities.ts';
import {policyAuthorizationScopes} from './business-policy.ts';

export type AgentGrantBinding = Readonly<{grantId:string;ownerId:string;spaceId:string;businessDataPolicy?:'all-personal-business-v1';operationId?:string}>;
export type AgentWriteGrant = AgentGrantBinding;

/** A producer may require only read scopes. Never invent write authority for a preview. */
export async function assertAgentGrant(tx:Transaction,grant:AgentGrantBinding,requiredScopes:readonly OperationScope[],operationId?:string):Promise<void>{
  let scopes:readonly OperationScope[];
  let operationScopes:readonly OperationScope[]|undefined;
  if(grant.businessDataPolicy){
    const operation=agentOperations.find(entry=>entry.id===operationId);
    const expected=operation&&policyAuthorizationScopes(operation);
    if(grant.businessDataPolicy!=='all-personal-business-v1'||!operation||!expected||expected.length!==requiredScopes.length||expected.some(scope=>!requiredScopes.includes(scope as OperationScope)))
      throw new PlatformError(403,'GRANT_OPERATION_INVALID','授权操作无效。');
    scopes=expected as readonly OperationScope[];
    operationScopes=operation.requiredScopes;
  }else{
    try{scopes=normalizeAgentScopes(requiredScopes);}catch{throw new PlatformError(403,'GRANT_SCOPES_INVALID','授权范围无效。');}
  }
  if(!tx.lockAgentGrant)throw new PlatformError(503,'AGENT_WRITE_FENCE_UNAVAILABLE','业务授权检查暂不可用。');
  if(!await tx.lockAgentGrant(grant.businessDataPolicy?{...grant,operationId}:grant,operationScopes??scopes))throw new PlatformError(403,'WRITE_GRANT_REVOKED','业务授权已失效。');
}

/** Only the legacy todo writer can use the pre-business migration fence. */
export async function assertAgentTodoWriteGrant(tx:Transaction,grant:AgentWriteGrant,operationId?:string):Promise<void>{
  if(tx.lockAgentGrant)return assertAgentGrant(tx,grant,['todo:read','todo:write'],operationId);
  if(grant.businessDataPolicy)throw new PlatformError(503,'AGENT_WRITE_FENCE_UNAVAILABLE','业务授权检查暂不可用。');
  if(!tx.lockAgentTodoWriteGrant)throw new PlatformError(503,'AGENT_WRITE_FENCE_UNAVAILABLE','待办写入授权检查暂不可用。');
  if(!await tx.lockAgentTodoWriteGrant(grant))throw new PlatformError(403,'WRITE_GRANT_REVOKED','待办写入授权已失效。');
}
