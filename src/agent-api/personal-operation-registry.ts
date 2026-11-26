import type {AgentScope} from './scopes.ts';

export const personalRecordTypes=['journal','calendar','health','person','finance','media','career','portfolio','cooking','article'] as const;
export type AgentRecordType=typeof personalRecordTypes[number];
export type BusinessScope=`${AgentRecordType|'feedback'|'storage-review'|'file-handoff'|'learning'}:${'read'|'write'}`;
export type OperationScope=AgentScope|BusinessScope;
const title=(type:string)=>type[0].toUpperCase()+type.slice(1);
/** Only reviewed server code supplies these IDs, scopes and paths. */
const recordExposure=(type:AgentRecordType)=>type==='article'?'native' as const:'business-json' as const;
export const personalRecordOperations=personalRecordTypes.flatMap(type=>[
 {id:`snapshot${title(type)}`,method:'GET',path:`/v1/records/${type}/snapshot`,module:type,policyClass:'personal-business-data',mcpExposure:recordExposure(type),requiredScopes:[`${type}:read`] as readonly OperationScope[],description:`Read the complete current ${type} snapshot with source identities, fields and revisions, or fail without a partial inventory.`},
 {id:`get${title(type)}`,method:'GET',path:`/v1/records/${type}/{id}`,module:type,policyClass:'personal-business-data',mcpExposure:recordExposure(type),requiredScopes:[`${type}:read`] as readonly OperationScope[],description:`Read one owner ${type} record with complete fields and its current revision.`},
 {id:`create${title(type)}`,method:'POST',path:`/v1/records/${type}`,module:type,policyClass:'personal-business-data',mcpExposure:recordExposure(type),requiredScopes:[`${type}:read`,`${type}:write`] as readonly OperationScope[],description:`Create one ${type} record through the native owner writer with complete fields and an idempotency key.`},
 {id:`update${title(type)}`,method:'PATCH',path:`/v1/records/${type}/{id}`,module:type,policyClass:'personal-business-data',mcpExposure:recordExposure(type),requiredScopes:[`${type}:read`,`${type}:write`] as readonly OperationScope[],description:`Update one ${type} record with complete fields, expectedRevision and an idempotency key; reread the same ID after saving.`},
]);
/** Article is excluded from inherited policy authorization and uses its own fence. */
export function requiresExplicitArticlePermission(id:string|undefined,scopes:readonly string[]):boolean{
 return scopes.some(scope=>scope.startsWith('article:'))||personalRecordOperations.some(op=>op.module==='article'&&op.id===id);
}

export const feedbackOperations=[
 {id:'snapshotFeedback',method:'GET',path:'/v1/feedback/snapshot',module:'feedback',policyClass:'personal-business-data',mcpExposure:'business-json' as const,requiredScopes:['feedback:read'] as readonly OperationScope[],description:'Read the complete owner feedback snapshot with explicit source channels and revisions.'},
 {id:'getFeedback',method:'GET',path:'/v1/feedback/{id}',module:'feedback',policyClass:'personal-business-data',mcpExposure:'business-json' as const,requiredScopes:['feedback:read'] as readonly OperationScope[],description:'Read one owner feedback record to verify the result and its revision.'},
 {id:'createFeedback',method:'POST',path:'/v1/feedback',module:'feedback',policyClass:'personal-business-data',mcpExposure:'business-json' as const,requiredScopes:['feedback:read','feedback:write'] as readonly OperationScope[],description:'Create feedback with the server-owned agent-feedback channel and an idempotency key; this does not approve or convert a requirement.'},
] as const;

export const learningOperations=[
 {id:'snapshotLearningCards',method:'GET',path:'/v1/learning/cards',description:'List current vocabulary cards with durable review history and due times.',requiredScopes:['learning:read']},
 {id:'getLearningCard',method:'GET',path:'/v1/learning/cards/{id}',description:'Read one vocabulary card and its latest verified review projection.',requiredScopes:['learning:read']},
 {id:'getLearningReview',method:'GET',path:'/v1/learning/cards/{id}/reviews/{reviewId}',description:'Read an exact independent review event and its card projection.',requiredScopes:['learning:read']},
 {id:'createLearningCard',method:'POST',path:'/v1/learning/cards',description:'Create one explicitly confirmed vocabulary card using an idempotency key.',requiredScopes:['learning:read','learning:write']},
 {id:'appendLearningReview',method:'POST',path:'/v1/learning/cards/{id}/reviews',description:'Append one explicitly confirmed rating against the current revision and previous event; retain the original request and key for retry.',requiredScopes:['learning:read','learning:write']},
].map(op=>({...op,requiredScopes:op.requiredScopes as readonly OperationScope[],module:'learning' as const,
 policyClass:'personal-business-data',mcpExposure:'native' as const}));

export function requiresExplicitLearningPermission(id:string|undefined,scopes:readonly string[]):boolean{
 return scopes.some(scope=>scope.startsWith('learning:'))||learningOperations.some(op=>op.id===id);
}
