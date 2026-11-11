import type {OperationScope} from '../agent-api/personal-operation-registry.ts';
const read=['requirements:read'] as readonly OperationScope[],write=['requirements:read','requirements:write'] as readonly OperationScope[];
export const requirementEventOperations=[
 {id:'claimRequirementExecution',method:'POST',path:'/v1/requirement-events/claims',module:'requirements',policyClass:'personal-business-data',requiredScopes:write,description:'Explicitly admit an existing ordinary owner ticket with source/revision/work CAS, or claim ready work with a bounded fenced lease; independently GET its requirement execution projection.'},
 {id:'updateRequirementExecution',method:'PATCH',path:'/v1/requirement-events/claims/{id}',module:'requirements',policyClass:'personal-business-data',requiredScopes:write,description:'Renew an existing lease or write fenced progress through the original requirement writer. Preserve original body/key for unknown outcomes and independently GET the current requirement.'},
] as const;
export const requirementEventTransports=[{id:'streamRequirementEvents',method:'GET',path:'/v1/requirement-events/stream',module:'requirements',transport:'sse',policyClass:'personal-business-data',requiredScopes:read,description:'Read bounded requirement-work SSE metadata using Last-Event-ID; native transport only, never a JSON lifeos_call.'}] as const;
export const isRequirementEventOperation=(id:string)=>requirementEventOperations.some(operation=>operation.id===id);
