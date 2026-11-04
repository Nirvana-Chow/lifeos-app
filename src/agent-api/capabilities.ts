import type {AgentScope} from './scopes.ts';
export type {AgentScope} from './scopes.ts';
export const agentApiVersion = '1';

export const agentOperations = [
  {id:'discoverV2', method:'GET', path:'/v2/capabilities', module:'catalog', requiredScopes:[] as readonly AgentScope[], description:'Discover operations permitted for the current grant.'},
  {id: 'discover', method: 'GET', path: '/v1/capabilities', scope: 'todo:read', module: 'todo', requiredScopes: ['todo:read'] as readonly AgentScope[], description: 'Discover operations permitted for the current grant.'},
  {id: 'listTodos', method: 'GET', path: '/v1/todos', scope: 'todo:read', module: 'todo', requiredScopes: ['todo:read'] as readonly AgentScope[], description: 'Read a bounded list of todo summaries.'},
  {id: 'snapshotTodos', method: 'GET', path: '/v1/todos/snapshot', scope: 'todo:read', module: 'todo', requiredScopes: ['todo:read'] as readonly AgentScope[], description: 'Read the complete current todo snapshot with fields and revisions, or fail if complete coverage cannot be verified.'},
  {id: 'getTodo', method: 'GET', path: '/v1/todos/{id}', scope: 'todo:read', module: 'todo', requiredScopes: ['todo:read'] as readonly AgentScope[], description: 'Read a todo and its current revision.'},
  {id: 'createTodo', method: 'POST', path: '/v1/todos', scope: 'todo:write', module: 'todo', requiredScopes: ['todo:write'] as readonly AgentScope[], description: 'Create one todo with an idempotency key.'},
  {id: 'updateTodo', method: 'PATCH', path: '/v1/todos/{id}', scope: 'todo:write', module: 'todo', requiredScopes: ['todo:write'] as readonly AgentScope[], description: 'Update one todo with its expected revision and an idempotency key.'},
] as const;
