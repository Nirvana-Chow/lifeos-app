import type {AgentScope} from './scopes.ts';
export type {AgentScope} from './scopes.ts';
export const agentApiVersion = '1';

export const agentOperations = [
  {id:'previewTodoClassification',method:'POST',path:'/v1/todo-classifications/preview',module:'classification',requiredScopes:['todo:read','organization:read'] as readonly AgentScope[],description:'Preview one immutable classification of 1 to 100 todos without business writes; owner review is required.'},
  {id:'commitTodoClassification',method:'POST',path:'/v1/todo-classifications/commit',module:'classification',requiredScopes:['todo:read','todo:write','organization:read'] as readonly AgentScope[],description:'Atomically commit an owner-approved plan with its digest and an idempotency key; preserve the same key and body for unknown-result recovery.'},
  {id:'discoverV2', method:'GET', path:'/v2/capabilities', module:'catalog', requiredScopes:[] as readonly AgentScope[], description:'Discover operations permitted for the current grant.'},
  {id: 'discover', method: 'GET', path: '/v1/capabilities', scope: 'todo:read', module: 'todo', requiredScopes: ['todo:read'] as readonly AgentScope[], description: 'Discover operations permitted for the current grant.'},
  {id: 'listTodos', method: 'GET', path: '/v1/todos', scope: 'todo:read', module: 'todo', requiredScopes: ['todo:read'] as readonly AgentScope[], description: 'Read a bounded list of todo summaries.'},
  {id: 'snapshotTodos', method: 'GET', path: '/v1/todos/snapshot', scope: 'todo:read', module: 'todo', requiredScopes: ['todo:read'] as readonly AgentScope[], description: 'Read the complete current todo snapshot with fields and revisions, or fail if complete coverage cannot be verified.'},
  {id: 'getTodo', method: 'GET', path: '/v1/todos/{id}', scope: 'todo:read', module: 'todo', requiredScopes: ['todo:read'] as readonly AgentScope[], description: 'Read a todo and its current revision.'},
  {id: 'createTodo', method: 'POST', path: '/v1/todos', scope: 'todo:write', module: 'todo', requiredScopes: ['todo:write'] as readonly AgentScope[], description: 'Create one todo with an idempotency key.'},
  {id: 'updateTodo', method: 'PATCH', path: '/v1/todos/{id}', scope: 'todo:write', module: 'todo', requiredScopes: ['todo:write'] as readonly AgentScope[], description: 'Update one todo with its expected revision and an idempotency key.'},
  {id:'snapshotOrganization',method:'GET',path:'/v1/organization/snapshot',module:'organization',requiredScopes:['organization:read'] as readonly AgentScope[],description:'Read the complete current project, domain and topic snapshot with source IDs and revisions, or fail without returning a partial inventory.'},
  {id:'getOrganization',method:'GET',path:'/v1/organization/{type}/{id}',module:'organization',requiredScopes:['organization:read'] as readonly AgentScope[],description:'Read one project, domain or topic with complete fields and its current revision.'},
  {id:'createOrganization',method:'POST',path:'/v1/organization/{type}',module:'organization',requiredScopes:['organization:read','organization:write'] as readonly AgentScope[],description:'Create one project, domain or topic with fields and an idempotency key; identical names remain independent records.'},
  {id:'updateOrganization',method:'PATCH',path:'/v1/organization/{type}/{id}',module:'organization',requiredScopes:['organization:read','organization:write'] as readonly AgentScope[],description:'Update one project, domain or topic with expectedRevision, all four fields (title, text, occurredOn, personal) and an idempotency key.'},
] as const;
