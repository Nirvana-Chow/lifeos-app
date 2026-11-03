export const agentApiVersion = '1';

export const agentOperations = [
  {id: 'discover', method: 'GET', path: '/v1/capabilities', scope: 'todo:read', description: 'Discover operations permitted for the current grant.'},
  {id: 'listTodos', method: 'GET', path: '/v1/todos', scope: 'todo:read', description: 'Read a bounded list of todo summaries.'},
  {id: 'getTodo', method: 'GET', path: '/v1/todos/{id}', scope: 'todo:read', description: 'Read a todo and its current revision.'},
  {id: 'createTodo', method: 'POST', path: '/v1/todos', scope: 'todo:write', description: 'Create one todo with an idempotency key.'},
  {id: 'updateTodo', method: 'PATCH', path: '/v1/todos/{id}', scope: 'todo:write', description: 'Update one todo with its expected revision and an idempotency key.'},
] as const;

export type AgentScope = typeof agentOperations[number]['scope'];
