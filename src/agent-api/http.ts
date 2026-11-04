import type {PlatformRepository, PublicEntry} from '../platform/contracts.ts';
import {object, PlatformError, todoKeys} from '../platform/domain.ts';
import {assertLocalRequest, readJSONBody} from '../platform/request-boundary.ts';
import type {PersonalConfig} from '../personal-candidate/config.ts';
import {PersonalService, personalEntryType} from '../personal-candidate/service.ts';
import {assertAgentTodoWriteGrant} from './grant-fence.ts';
import {agentApiVersion, agentOperations, type AgentScope} from './capabilities.ts';

type Grant = Readonly<{grantId: string; ownerId: string; spaceId: string; scopes: readonly AgentScope[]}>;
type Options = {
  enabled?: boolean;
  mountPath?: '/api/platform/agent';
  fenceWrites?: boolean;
  config: PersonalConfig;
  repository: PlatformRepository;
  verify: (key: string) => Promise<Grant | null>;
  assertWritable: (grant: Grant) => Promise<void>;
};

function respond(status: number, body: unknown) {
  return Response.json(body, {status, headers: {
    'Cache-Control': 'private, no-store',
    Vary: 'Authorization',
    'X-Content-Type-Options': 'nosniff',
  }});
}

function detail(entry: PublicEntry) {
  if (!('status' in entry.draft)) throw Error('Unexpected todo projection');
  return {id: entry.id, sourceId: entry.source.id, revision: entry.revision,
    fields: {...entry.draft, personal: entry.draft.personal ?? null}};
}

function updateFields(value: unknown) {
  const fields = object(value, todoKeys);
  if (todoKeys.some(key => !Object.hasOwn(fields, key)))
    throw new PlatformError(400, 'COMPLETE_TODO_REQUIRED', '更新需要完整待办字段。');
  if (fields.personal === null) delete fields.personal;
  return fields;
}

/** A host must supply verified grants and a write guard. Mounted writes require a PostgreSQL fence. */
export function createAgentHandler(options: Options) {
  const config = Object.freeze(structuredClone(options.config));
  const service = new PersonalService(options.repository, config);
  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url);
    const mount = options.mountPath ?? '';
    const route = path.pathname.startsWith(mount + '/') ? path.pathname.slice(mount.length) : '';
    const recordId = /^\/v1\/todos\/([a-f0-9-]{36})$/.exec(route)?.[1];
    const operation = agentOperations.find(entry =>
      entry.method === request.method && entry.path === (recordId ? '/v1/todos/{id}' : route));
    if (options.enabled !== true || !config.allowedTypes.includes('todo') || !operation || path.search) return respond(404, {error: 'NOT_FOUND'});
    try {
      assertLocalRequest(request, config.baseURL);
      const token = /^Bearer ([A-Za-z0-9_-]{1,256})$/.exec(request.headers.get('authorization') ?? '')?.[1];
      if (!token) return respond(401, {error: 'AUTH_REQUIRED'});
      const grant = await options.verify(token);
      if (!grant) return respond(401, {error: 'AUTH_REQUIRED'});
      if (grant.ownerId !== config.ownerId || grant.spaceId !== config.spaceId || !grant.scopes.includes(operation.scope))
        return respond(403, {error: 'ACCESS_DENIED'});
      if (operation.id === 'discover') {
        return respond(200, {apiVersion: agentApiVersion,
          operations: agentOperations.filter(entry => grant.scopes.includes(entry.scope))});
      }
      if (operation.id === 'listTodos') {
        const page = await service.list(grant.ownerId, 'todo');
        return respond(200, {items: page.items.map(entry => {
          const fields = entry.draft;
          if (!('status' in fields)) throw Error('Unexpected todo projection');
          return {id: entry.id, revision: entry.revision, title: fields.title, status: fields.status};
        }), truncated: page.truncated});
      }
      if (operation.id === 'getTodo') {
        if (!recordId) return respond(404, {error: 'NOT_FOUND'});
        return respond(200, detail(await service.get(grant.ownerId, 'todo', recordId)));
      }
      if (operation.id === 'snapshotTodos') {
        const items = (await service.currentSnapshot(grant.ownerId))
          .filter(entry => personalEntryType(entry, config.spaceId) === 'todo').map(detail);
        return respond(200, {scope: 'full-current-todo-snapshot', items, total: items.length,
          truncated: false, observedAt: new Date().toISOString()});
      }
      if (operation.id !== 'createTodo' && operation.id !== 'updateTodo') {
        const unimplemented: never = operation;
        void unimplemented;
        return respond(404, {error: 'NOT_FOUND'});
      }

      if (options.mountPath && options.fenceWrites !== true) return respond(503, {error: 'AGENT_WRITE_FENCE_UNAVAILABLE'});
      const input = object(await readJSONBody(request), operation.id === 'updateTodo' ? ['fields', 'expectedRevision'] : ['fields']);
      const result = await service.mutate(grant.ownerId, 'todo', recordId ?? null,
        {...input, ...(operation.id === 'updateTodo' ? {fields: updateFields(input.fields)} : {}), spaceId: config.spaceId, confirmed: true}, request.headers.get('idempotency-key') ?? '',
        async () => {
          if (request.signal.aborted) throw new PlatformError(499, 'REQUEST_CANCELLED', '已取消。');
          await options.assertWritable(grant);
        }, options.fenceWrites ? tx => assertAgentTodoWriteGrant(tx, grant) : undefined);
      return respond(operation.id === 'createTodo' && !result.duplicate ? 201 : 200,
        {entry: detail(result.entry), duplicate: result.duplicate});
    } catch (error) {
      return error instanceof PlatformError
        ? respond(error.status, {error: error.code})
        : respond(503, {error: 'AGENT_API_UNAVAILABLE'});
    }
  };
}
