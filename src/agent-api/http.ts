import type {PlatformRepository, PublicEntry} from '../platform/contracts.ts';
import {object, PlatformError, todoKeys} from '../platform/domain.ts';
import {assertLocalRequest, readJSONBody} from '../platform/request-boundary.ts';
import type {PersonalConfig} from '../personal-candidate/config.ts';
import {PersonalService, personalEntryType} from '../personal-candidate/service.ts';
import {assertAgentGrant,assertAgentTodoWriteGrant} from './grant-fence.ts';
import {agentApiVersion, agentOperations, type AgentScope} from './capabilities.ts';
import {AuthorityService} from '../agent-authority/service.ts';

import type {AgentModules} from './config.ts';
import type {OrganizationType} from '../personal-candidate/business.ts';
import {organizationDetail,organizationSnapshot,completeOrganizationFields} from './organization.ts';

type Grant = Readonly<{grantId: string; ownerId: string; spaceId: string; scopes: readonly AgentScope[]}>;
type Options = {
  enabled?: boolean;
  modules?: AgentModules;
  mountPath?: '/api/platform/agent';
  fenceWrites?: boolean;
  config: PersonalConfig;
  repository: PlatformRepository;
  verify: (key: string) => Promise<Grant | null>;
  readCurrentGrant?: (grantId: string) => Promise<Grant | null>;
  operationAvailable?: (operationId: string) => boolean | Promise<boolean>;
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
  const modules=Object.freeze({...options.modules});
  const service = new PersonalService(options.repository, config);
  const available = async (id:string) => {
    if (id === 'discover' || id === 'discoverV2') return true;
    const operation = agentOperations.find(entry => entry.id === id);
    if (operation?.module === 'organization' && (!modules.organization || operation.method !== 'GET' && options.fenceWrites !== true)) return false;
    if (!operation || options.mountPath && operation.method !== 'GET' && options.fenceWrites !== true) return false;
    try {return await options.operationAvailable?.(id) === true;} catch {return false;}
  };
  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url);
    const mount = options.mountPath ?? '';
    const route = path.pathname.startsWith(mount + '/') ? path.pathname.slice(mount.length) : '';
    const recordId = /^\/v1\/todos\/([a-f0-9-]{36})$/.exec(route)?.[1];
    const organizationRoute=/^\/v1\/organization\/(project|domain|topic)(?:\/([a-f0-9-]{36}))?$/.exec(route);
    const organizationType=organizationRoute?.[1] as OrganizationType|undefined;
    const organizationId=organizationRoute?.[2];
    const template=organizationRoute ? organizationId ? '/v1/organization/{type}/{id}' : '/v1/organization/{type}' : recordId ? '/v1/todos/{id}' : route;
    const operation = agentOperations.find(entry => entry.method === request.method && entry.path === template);
    if (options.enabled !== true || !operation || operation.module === 'todo' && !config.allowedTypes.includes('todo') || operation.module === 'organization' && !modules.organization || path.search) return respond(404, {error: 'NOT_FOUND'});
    try {
      assertLocalRequest(request, config.baseURL);
      const token = /^Bearer ([A-Za-z0-9_-]{1,256})$/.exec(request.headers.get('authorization') ?? '')?.[1];
      if (!token) return respond(401, {error: 'AUTH_REQUIRED'});
      const grant = await options.verify(token);
      if (!grant) return respond(401, {error: 'AUTH_REQUIRED'});
      if (grant.ownerId !== config.ownerId || grant.spaceId !== config.spaceId) return respond(403, {error: 'ACCESS_DENIED'});
      const authority = new AuthorityService({ownerId:config.ownerId, spaceId:config.spaceId, verifyOwner:async () => null,
        verifyAgent:async () => grant, readCurrentAgent:options.readCurrentGrant});
      const actor = await authority.resolveAgentActor(token);
      if (!actor) return respond(403, {error:'ACCESS_DENIED'});
      try {await authority.assertCurrentAuthority(actor, operation.id);} catch {return respond(403, {error:'ACCESS_DENIED'});}
      if (operation.id === 'discoverV2') {
        const permitted = agentOperations.filter(entry => entry.requiredScopes.every(scope => actor.scopes.includes(scope)));
        const readiness = await Promise.all(permitted.map(entry => available(entry.id)));
        return respond(200, {apiVersion:'2', operations:permitted.filter((_, index) => readiness[index])});
      }
      if (operation.id === 'discover') {
        return respond(200, {apiVersion: agentApiVersion,
          operations: agentOperations.filter(entry => 'scope' in entry && entry.requiredScopes.every(scope => actor.scopes.includes(scope))).map(({id,method,path,description,...rest}) => ({id,method,path,scope:'scope' in rest ? rest.scope : undefined,description}))});
      }
      if (!await available(operation.id)) return respond(503, {error:'AGENT_OPERATION_UNAVAILABLE'});
      if (operation.module === 'organization') {
        if (operation.id === 'snapshotOrganization') return respond(200,await organizationSnapshot(service,actor.ownerId));
        if (!organizationType) return respond(404,{error:'NOT_FOUND'});
        if (operation.id === 'getOrganization') {
          if (!organizationId) return respond(404,{error:'NOT_FOUND'});
          return respond(200,organizationDetail(await service.get(actor.ownerId,organizationType,organizationId),actor.spaceId));
        }
        const updating=operation.id === 'updateOrganization';
        const input=object(await readJSONBody(request),updating?['fields','expectedRevision']:['fields']);
        const result=await service.mutate(actor.ownerId,organizationType,organizationId??null,
          {...input,...(updating?{fields:completeOrganizationFields(input.fields)}:{}),spaceId:actor.spaceId,confirmed:true},request.headers.get('idempotency-key')??'',
          async()=>{
            if(request.signal.aborted)throw new PlatformError(499,'REQUEST_CANCELLED','已取消。');
            await options.assertWritable(grant);
          },tx=>assertAgentGrant(tx,actor,operation.requiredScopes));
        return respond(!updating&&!result.duplicate?201:200,{entry:organizationDetail(result.entry,actor.spaceId),duplicate:result.duplicate});
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
