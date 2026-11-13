import {readBusinessBearer} from '../business-mcp-oauth/boundary.ts';
import type {OAuthGrantFence} from '../business-mcp-oauth/contracts.ts';
import {createRequirementEventHandler,type NotificationWait} from '../requirement-events/http.ts';
import {isRequirementEventOperation} from '../requirement-events/operations.ts';
import type {RequirementEventService} from '../requirement-events/service.ts';
import {RequirementAdmissionService} from '../requirement-events/admission.ts';
import {handleStorageReviewAgent} from '../storage-review/agent.ts';
import {PersonalFinanceService} from '../personal-finance/service.ts';
import {financeKeys} from '../platform/domain.ts';
import type {OperationScope,AgentRecordType} from './personal-operation-registry.ts';
import {isRecordModule,personalRecordModuleEnabled,completeRecordFields,personalRecordDetail,personalRecordSnapshot,fencedRecordRepository} from './personal-records.ts';
import {ClassificationService,createClassificationAdapter} from '../personal-candidate/classification-service.ts';
import type {PlatformRepository, PublicEntry} from '../platform/contracts.ts';
import {object, PlatformError, todoKeys, todoRequiredKeys} from '../platform/domain.ts';
import {assertLocalRequest, readJSONBody} from '../platform/request-boundary.ts';
import type {PersonalConfig} from '../personal-candidate/config.ts';
import {PersonalService, personalEntryType} from '../personal-candidate/service.ts';
import {assertAgentGrant,assertAgentTodoWriteGrant} from './grant-fence.ts';
import {agentApiVersion, agentOperations,agentEventTransports,agentCapabilityOperations} from './capabilities.ts';
import {AuthorityService} from '../agent-authority/service.ts';
import {AgentRateLimitError} from './rate-limit.ts';

import type {AgentModules} from './config.ts';
import type {OrganizationType} from '../personal-candidate/business.ts';
import {organizationDetail,organizationSnapshot,completeOrganizationFields} from './organization.ts';

type Grant = Readonly<{grantId: string; ownerId: string; spaceId: string; scopes: readonly OperationScope[];businessDataPolicy?:'all-personal-business-v1';allowedOperationIds?:readonly string[];oauthFence?:OAuthGrantFence}>;
type Options = {
  enabled?: boolean;
  modules?: AgentModules;
  mountPath?: '/api/platform/agent';
  fenceWrites?: boolean;
  config: PersonalConfig;
  repository: PlatformRepository;
  verify: (key: string) => Promise<Grant | null>;
  readCurrentGrant?: (grantId: string,oauthFence?:OAuthGrantFence) => Promise<Grant | null>;
  operationAvailable?: (operationId: string) => boolean | Promise<boolean>;
  assertWritable: (grant: Grant) => Promise<void>;
  classification?: (authority:AuthorityService)=>ClassificationService;
  requirementEvents?:{service:RequirementEventService;ready:()=>Promise<boolean>;openNotifications:()=>Promise<NotificationWait>};
};

function respondBase(status: number, body: unknown, retryAfterSeconds?:number) {
  return Response.json(body, {status, headers: {
    'Cache-Control': 'private, no-store',
    Vary: 'Authorization',
    'X-Content-Type-Options': 'nosniff',
    ...(status===429&&retryAfterSeconds!==undefined?{'Retry-After':String(retryAfterSeconds)}:{}),
  }});
}

function detail(entry: PublicEntry) {
  if (!('status' in entry.draft)) throw Error('Unexpected todo projection');
  return {id: entry.id, sourceId: entry.source.id, revision: entry.revision,
    fields: {...entry.draft, personal: entry.draft.personal ?? null}};
}

function updateFields(value: unknown) {
  const fields = object(value, todoKeys);
  if (todoRequiredKeys.some(key => !Object.hasOwn(fields, key)))
    throw new PlatformError(400, 'COMPLETE_TODO_REQUIRED', '更新需要完整待办字段。');
  if (fields.personal === null) delete fields.personal;
  return fields;
}

/** A host must supply verified grants and a write guard. Mounted writes require a PostgreSQL fence. */
export function createAgentHandler(options: Options) {
  const config = Object.freeze(structuredClone(options.config));
  const modules=Object.freeze({...options.modules});
  const service = new PersonalService(options.repository, config);
  const admission=new RequirementAdmissionService(options.repository,service.requirements);
  const available = async (id:string) => {
    if (id === 'discover' || id === 'discoverV2') return true;
    const operation = agentCapabilityOperations.find(entry => entry.id === id);
    if(isRequirementEventOperation(id)||id==='streamRequirementEvents'){if(!modules.requirementEvents||!options.requirementEvents)return false;try{if(!await options.requirementEvents.ready())return false;}catch{return false;}}
    if(operation?.module==='storageReview'&&(!modules.storageReview||!modules.businessDataPolicy||options.fenceWrites!==true))return false;
    if(operation&&isRecordModule(operation.module)&&operation.id.startsWith('snapshot')&&!options.repository.readCurrentSnapshot)return false;
    if(operation&&isRecordModule(operation.module)&&(!personalRecordModuleEnabled(operation.module,config,modules as AgentModules)||options.fenceWrites!==true))return false;
    if (operation?.module === 'classification' && (!modules.classification || !modules.organization || !options.classification || options.fenceWrites !== true)) return false;
    if (operation?.module === 'requirements' && (!modules.requirements || !config.requirementsEnabled || operation.method !== 'GET' && options.fenceWrites !== true)) return false;
    if (operation?.module === 'organization' && (!modules.organization || operation.method !== 'GET' && options.fenceWrites !== true)) return false;
    if (!operation || options.mountPath && operation.method !== 'GET' && options.fenceWrites !== true) return false;
    try {return await options.operationAvailable?.(id) === true;} catch {return false;}
  };
  return async (request: Request): Promise<Response> => {
    let currentOAuth:(()=>Promise<void>)|undefined;
    const respond=async(status:number,body:unknown,retryAfterSeconds?:number):Promise<Response>=>{
      if(status>=200&&status<300&&request.method==='GET'&&currentOAuth)try{await currentOAuth();}catch{return respondBase(403,{error:'ACCESS_DENIED'});}
      return respondBase(status,body,retryAfterSeconds);
    };
    const path = new URL(request.url);
    const mount = options.mountPath ?? '';
    const route = path.pathname.startsWith(mount + '/') ? path.pathname.slice(mount.length) : '';
    const storageRoute=/^\/v1\/storage-reviews\/([a-f0-9-]{36})(?:\/(checklist|decisions))?$/.exec(route);
    const executionRoute=/^\/v1\/requirement-events\/claims\/([a-f0-9-]{36})$/.exec(route);
    const personalRoute=/^\/v1\/records\/(journal|calendar|health|person|finance|media|career|portfolio|cooking)(?:\/(snapshot|[a-f0-9-]{36}))?$/.exec(route);
    const personalType=personalRoute?.[1] as AgentRecordType|undefined,personalId=personalRoute?.[2]&&personalRoute[2]!=='snapshot'?personalRoute[2]:undefined;
    const feedbackRoute=/^\/v1\/feedback(?:\/(snapshot|[a-f0-9-]{36}))?$/.exec(route),feedbackId=feedbackRoute?.[1]&&feedbackRoute[1]!=='snapshot'?feedbackRoute[1]:undefined;
    const recordId = /^\/v1\/todos\/([a-f0-9-]{36})$/.exec(route)?.[1];
    const requirementRoute=/^\/v1\/requirements\/(LO-[A-Z]+-\d{3}|[a-f0-9-]{36})$/.exec(route);
    const requirementId=requirementRoute?.[1];
    const organizationRoute=/^\/v1\/organization\/(project|domain|topic)(?:\/([a-f0-9-]{36}))?$/.exec(route);
    const organizationType=organizationRoute?.[1] as OrganizationType|undefined;
    const organizationId=organizationRoute?.[2];
    const template=executionRoute?'/v1/requirement-events/claims/{id}':storageRoute?'/v1/storage-reviews/{id}'+(storageRoute[2]?'/'+storageRoute[2]:''):personalRoute?personalId?`/v1/records/${personalType}/{id}`:route:feedbackRoute?feedbackId?'/v1/feedback/{id}':route:requirementId?'/v1/requirements/{id}':organizationRoute ? organizationId ? '/v1/organization/{type}/{id}' : '/v1/organization/{type}' : recordId ? '/v1/todos/{id}' : route;
    const operation = agentCapabilityOperations.find(entry => entry.method === request.method && entry.path === template);
    if (options.enabled !== true || !operation || operation.module==='storageReview'&&(!modules.storageReview||!modules.businessDataPolicy)||(isRequirementEventOperation(operation.id)||operation.id==='streamRequirementEvents')&&!modules.requirementEvents|| isRecordModule(operation.module)&&!personalRecordModuleEnabled(operation.module,config,modules as AgentModules) || operation.module === 'todo' && !config.allowedTypes.includes('todo') || operation.module === 'organization' && !modules.organization || operation.module === 'requirements' && (!modules.requirements||!config.requirementsEnabled) || path.search) return respond(404, {error: 'NOT_FOUND'});
    try {
      assertLocalRequest(request, config.baseURL);
      const token = readBusinessBearer(request.headers.get('authorization'));
      if (!token) return respond(401, {error: 'AUTH_REQUIRED'});
      const grant = await options.verify(token);
      if (!grant) return respond(401, {error: 'AUTH_REQUIRED'});
      if (grant.ownerId !== config.ownerId || grant.spaceId !== config.spaceId) return respond(403, {error: 'ACCESS_DENIED'});
      const authority = new AuthorityService({ownerId:config.ownerId, spaceId:config.spaceId, verifyOwner:async () => null,
        verifyAgent:async () => grant, readCurrentAgent:options.readCurrentGrant});
      const actor = await authority.resolveAgentActor(token);
      if (!actor) return respond(403, {error:'ACCESS_DENIED'});
      try {await authority.assertCurrentAuthority(actor, operation.id);} catch {return respond(403, {error:'ACCESS_DENIED'});}
      if(actor.oauthFence)currentOAuth=async()=>{await authority.assertCurrentAuthority(actor,operation.id);};
      if (operation.id === 'discoverV2') {
        const permitted = agentOperations.filter(entry => entry.requiredScopes.every(scope => actor.scopes.includes(scope)) && (!actor.businessDataPolicy&&!actor.oauthFence || entry.module==='catalog' || actor.allowedOperationIds?.includes(entry.id)));
        const readiness = await Promise.all(permitted.map(entry => available(entry.id)));
        return respond(200, {apiVersion:'2', ...(actor.businessDataPolicy?{authorization:{businessDataPolicy:actor.businessDataPolicy,scopes:actor.scopes}}:{}), operations:permitted.filter((_, index) => readiness[index]),eventTransports:(await Promise.all(agentEventTransports.map(async transport=>transport.requiredScopes.every(scope=>actor.scopes.includes(scope))&&(!actor.businessDataPolicy&&!actor.oauthFence||actor.allowedOperationIds?.includes(transport.id))&&await available(transport.id)?transport:null))).filter(transport=>transport!==null)});
      }
      if (operation.id === 'discover') {
        return respond(200, {apiVersion: agentApiVersion,
          operations: agentOperations.filter(entry => 'scope' in entry && entry.requiredScopes.every(scope => actor.scopes.includes(scope)) && (!actor.businessDataPolicy&&!actor.oauthFence || entry.id==='discover' || actor.allowedOperationIds?.includes(entry.id))).map(({id,method,path,description,...rest}) => ({id,method,path,scope:'scope' in rest ? rest.scope : undefined,description}))});
      }
      if (!await available(operation.id)) return respond(503, {error:'AGENT_OPERATION_UNAVAILABLE'});
      if(isRequirementEventOperation(operation.id)||operation.id==='streamRequirementEvents'){
        // Policy-aware readCurrentGrant also computes metadata readiness using
        // the business pool. Inside a held writer transaction, current grant
        // authority is enforced by its same-connection SQL fence instead.
        const adapter=options.requirementEvents!,mutationGuard=async()=>{if(request.signal.aborted)throw new PlatformError(499,'REQUEST_CANCELLED','已取消。');if(operation.method!=='GET')await options.assertWritable(grant);};
        return createRequirementEventHandler({enabled:true,origin:config.baseURL,events:adapter.service,requirements:service.requirements,admission,openNotifications:adapter.openNotifications,authorize:async()=>({actor,mutationGuard,current:async()=>{await mutationGuard();await authority.assertCurrentAuthority(actor,operation.id);if(!await available(operation.id))throw new PlatformError(503,'AGENT_OPERATION_UNAVAILABLE','操作尚未就绪。');}})})(request);
      }
      if(operation.module==='storageReview')return await handleStorageReviewAgent(request,{operation,recordId:storageRoute?.[1],actor,authority,repository:options.repository,config,currentReady:()=>available(operation.id),assertWritable:()=>options.assertWritable(grant)});
      if(isRecordModule(operation.module)){
        if(actor.businessDataPolicy!=='all-personal-business-v1')return respond(403,{error:'ACCESS_DENIED'});
        const current=async()=>{try{await authority.assertCurrentAuthority(actor,operation.id);}catch{throw new PlatformError(403,'ACCESS_DENIED','授权已变化。');}if(!await available(operation.id))throw new PlatformError(503,'AGENT_OPERATION_UNAVAILABLE','操作暂不可用。');};
        const read=async<T>(run:()=>Promise<T>)=>{await current();const result=await run();await current();return result;};
        const guard=async()=>{if(request.signal.aborted)throw new PlatformError(499,'REQUEST_CANCELLED','已取消。');await current();await options.assertWritable(grant);};
        const txGuard=(tx:import('../platform/contracts.ts').Transaction)=>assertAgentGrant(tx,actor,operation.requiredScopes,operation.id);
        const records=new PersonalService(fencedRecordRepository(options.repository,txGuard),config);
        if(operation.module==='feedback'){
          if(operation.id==='snapshotFeedback')return respond(200,await read(()=>records.requirementSupport.snapshot(actor.ownerId)));
          if(operation.id==='getFeedback')return respond(200,{entry:await read(()=>records.requirementSupport.feedback(actor.ownerId,feedbackId!))});
          const input=object(await readJSONBody(request),['fields']);
          const result=await records.requirementSupport.createFeedback(actor.ownerId,{...input,spaceId:actor.spaceId,confirmed:true},request.headers.get('idempotency-key')??'',guard,txGuard,'agent-feedback');
          return respond(result.duplicate?200:201,result);
        }
        if(personalType==='finance'){
          const finance=new PersonalFinanceService(options.repository,{ownerId:actor.ownerId,spaceId:actor.spaceId,enabled:config.financeEnabled,writable:true});
          const entry=(value:Awaited<ReturnType<PersonalFinanceService['get']>>)=>({type:'finance',id:value.id,sourceId:value.source.id,revision:value.revision,fields:value.fields});
          if(operation.method==='GET'){
            if(personalId)return respond(200,{entry:entry(await read(()=>finance.get(actor.ownerId,personalId)))});
            const snapshot=await read(()=>finance.snapshot(actor.ownerId));const{entries,...rest}=snapshot;
            return respond(200,{...rest,scope:'full-current-finance-snapshot',items:entries.map(entry),truncated:false});
          }
          const updating=operation.method==='PATCH',input=object(await readJSONBody(request),updating?['fields','expectedRevision']:['fields']),fields=object(input.fields,financeKeys);
          if(financeKeys.some(key=>!Object.hasOwn(fields,key)))throw new PlatformError(400,'COMPLETE_RECORD_REQUIRED','保存需要完整财务字段。');
          const result=await finance.mutate(actor.ownerId,personalId??null,{...input,fields,spaceId:actor.spaceId,confirmed:true},request.headers.get('idempotency-key')??'',{assertActor:guard,transactionGuard:txGuard});
          return respond(!updating&&!result.duplicate?201:200,{entry:entry(result.entry),duplicate:result.duplicate});
        }
        if(!personalType)return respond(404,{error:'NOT_FOUND'});
        if(operation.method==='GET')return respond(200,personalId?{entry:await read(async()=>personalRecordDetail(await records.get(actor.ownerId,personalType,personalId),actor.spaceId))}:await read(()=>personalRecordSnapshot(records,actor.ownerId,personalType)));
        const updating=operation.method==='PATCH',input=object(await readJSONBody(request),updating?['fields','expectedRevision']:['fields']);
        const result=await records.mutate(actor.ownerId,personalType,personalId??null,{...input,fields:completeRecordFields(input.fields,personalType),spaceId:actor.spaceId,confirmed:true},request.headers.get('idempotency-key')??'',guard,txGuard);
        return respond(!updating&&!result.duplicate?201:200,{entry:personalRecordDetail(result.entry,actor.spaceId),duplicate:result.duplicate});
      }
      if(operation.module==='requirements'){
        const requirements=service.requirements;
        if(operation.id==='snapshotRequirements')return respond(200,await requirements.snapshot(actor.ownerId));
        if(operation.id==='getRequirement'){
          const current=()=>authority.assertCurrentAuthority(actor,operation.id);
          const result=modules.requirementEvents&&options.requirementEvents&&await available('streamRequirementEvents')?await admission.read(actor,requirementId!,current):{entry:await requirements.get(actor.ownerId,requirementId!)};
          await current();return respond(200,result);
        }
        const updating=operation.id==='updateRequirement',input=object(await readJSONBody(request),updating?['fields','expectedRevision','baselineBinding']:['fields']);
        const result=await requirements.mutate(actor.ownerId,requirementId??null,{...input,spaceId:actor.spaceId,confirmed:true},request.headers.get('idempotency-key')??'',async()=>{
          if(request.signal.aborted)throw new PlatformError(499,'REQUEST_CANCELLED','已取消。');await options.assertWritable(grant);
        },tx=>assertAgentGrant(tx,actor,operation.requiredScopes,operation.id));
        return respond(!updating&&!result.duplicate?201:200,result);
      }
      if (operation.module === 'classification') {
        if(!options.classification)return respond(503,{error:'AGENT_OPERATION_UNAVAILABLE'});
        const adapter=createClassificationAdapter(options.classification(authority)),input=await readJSONBody(request);
        if(request.signal.aborted)throw new PlatformError(499,'REQUEST_CANCELLED','已取消。');
        return respond(200,operation.id==='previewTodoClassification'?await adapter.preview(actor,input):await adapter.commit(actor,input,request.headers.get('idempotency-key')??''));
      }
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
          },tx=>assertAgentGrant(tx,actor,operation.requiredScopes,operation.id));
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
        return respond(404, {error: 'NOT_FOUND'});
      }

      if (options.mountPath && options.fenceWrites !== true) return respond(503, {error: 'AGENT_WRITE_FENCE_UNAVAILABLE'});
      const input = object(await readJSONBody(request), operation.id === 'updateTodo' ? ['fields', 'expectedRevision'] : ['fields']);
      const result = await service.mutate(grant.ownerId, 'todo', recordId ?? null,
        {...input, ...(operation.id === 'updateTodo' ? {fields: updateFields(input.fields)} : {}), spaceId: config.spaceId, confirmed: true}, request.headers.get('idempotency-key') ?? '',
        async () => {
          if (request.signal.aborted) throw new PlatformError(499, 'REQUEST_CANCELLED', '已取消。');
          await options.assertWritable(grant);
        }, options.fenceWrites ? tx => assertAgentTodoWriteGrant(tx, grant,operation.id) : undefined);
      return respond(operation.id === 'createTodo' && !result.duplicate ? 201 : 200,
        {entry: detail(result.entry), duplicate: result.duplicate});
    } catch (error) {
      return error instanceof PlatformError
        ? respond(error.status, {error: error.code},error instanceof AgentRateLimitError?error.retryAfterSeconds:undefined)
        : respond(503, {error: 'AGENT_API_UNAVAILABLE'});
    }
  };
}
