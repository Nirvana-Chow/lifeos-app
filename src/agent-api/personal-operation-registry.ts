import type {AgentScope} from './scopes.ts';

export const personalRecordTypes=['journal','calendar','health','person','finance','media','career','portfolio','cooking'] as const;
export type AgentRecordType=typeof personalRecordTypes[number];
export type BusinessScope=`${AgentRecordType|'feedback'}:${'read'|'write'}`;
export type OperationScope=AgentScope|BusinessScope;
const title=(type:string)=>type[0].toUpperCase()+type.slice(1);
/** Only reviewed server code supplies these IDs, scopes and paths. */
export const personalRecordOperations=personalRecordTypes.flatMap(type=>[
 {id:`snapshot${title(type)}`,method:'GET',path:`/v1/records/${type}/snapshot`,module:type,policyClass:'personal-business-data',requiredScopes:[`${type}:read`] as readonly OperationScope[],description:`Read the complete current ${type} snapshot with source identities, fields and revisions, or fail without a partial inventory.`},
 {id:`get${title(type)}`,method:'GET',path:`/v1/records/${type}/{id}`,module:type,policyClass:'personal-business-data',requiredScopes:[`${type}:read`] as readonly OperationScope[],description:`Read one owner ${type} record with complete fields and its current revision.`},
 {id:`create${title(type)}`,method:'POST',path:`/v1/records/${type}`,module:type,policyClass:'personal-business-data',requiredScopes:[`${type}:read`,`${type}:write`] as readonly OperationScope[],description:`Create one ${type} record through the native owner writer with complete fields and an idempotency key.`},
 {id:`update${title(type)}`,method:'PATCH',path:`/v1/records/${type}/{id}`,module:type,policyClass:'personal-business-data',requiredScopes:[`${type}:read`,`${type}:write`] as readonly OperationScope[],description:`Update one ${type} record with complete fields, expectedRevision and an idempotency key; reread the same ID after saving.`},
]);
export const feedbackOperations=[
 {id:'snapshotFeedback',method:'GET',path:'/v1/feedback/snapshot',module:'feedback',policyClass:'personal-business-data',requiredScopes:['feedback:read'] as readonly OperationScope[],description:'Read the complete owner feedback snapshot with explicit source channels and revisions.'},
 {id:'getFeedback',method:'GET',path:'/v1/feedback/{id}',module:'feedback',policyClass:'personal-business-data',requiredScopes:['feedback:read'] as readonly OperationScope[],description:'Read one owner feedback record to verify the result and its revision.'},
 {id:'createFeedback',method:'POST',path:'/v1/feedback',module:'feedback',policyClass:'personal-business-data',requiredScopes:['feedback:read','feedback:write'] as readonly OperationScope[],description:'Create feedback with the server-owned agent-feedback channel and an idempotency key; this does not approve or convert a requirement.'},
] as const;
