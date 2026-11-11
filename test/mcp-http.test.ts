import assert from 'node:assert/strict';
import test from 'node:test';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {createAgentHandler} from '../src/agent-api/http.ts';
import {MemoryPort} from './helpers/platform.ts';
import {createMcpHttpHandler} from '../src/mcp-http/handler.ts';
import {handleMcpHttpRequest} from '../src/mcp-http/runtime.ts';
import {HttpBusinessClient,inProcessApiFetch} from '../src/mcp-http/business-client.ts';

const origin='https://lifeos.nirvanachow.com',endpoint=origin+'/api/platform/mcp';
const secret='synthetic-mcp-http-writer',reader='synthetic-mcp-http-reader',foreign='synthetic-mcp-http-foreign';
const fields={title:'Synthetic HTTP MCP task',notes:'',dueOn:null,status:'open'};

function fixture(){
 const repository=new MemoryPort();repository.readCurrentSnapshot=async()=>structuredClone([...repository.rows.values()]);
 const transaction=repository.transaction.bind(repository);
 repository.transaction=(owner,key,run)=>transaction(owner,key,tx=>run({...tx,lockRecordIdentity:async()=>{},lockAgentGrant:async()=>true}));
 let revoked=false,writable=true,scopesReduced=false,loseNextWrite=false,failReadback=false,redirect=false,echo=false,revokeBeforeWrite=false;
 const requests:{method:string;path:string;authorization:string|null;cookie:string|null;key:string|null}[]=[];
 const grant=(key:string)=>key===secret?{grantId:'synthetic-writer',ownerId:'synthetic-owner',spaceId:'synthetic-space',scopes:scopesReduced?['todo:read','requirements:read'] as const:['todo:read','todo:write','requirements:read','requirements:write'] as const}:key===reader?{grantId:'synthetic-reader',ownerId:'synthetic-owner',spaceId:'synthetic-space',scopes:['todo:read'] as const}:key===foreign?{grantId:'synthetic-foreign',ownerId:'other-owner',spaceId:'other-space',scopes:['todo:read','todo:write'] as const}:null;
 const api=createAgentHandler({enabled:true,mountPath:'/api/platform/agent',fenceWrites:true,modules:{organization:false,classification:false,requirements:true},repository,
  config:{ownerId:'synthetic-owner',spaceId:'synthetic-space',ownerEmail:'fixture@example.invalid',databaseName:'fixture',approval:'personal-manual-v1',allowedTypes:['todo','journal'],requirementsEnabled:true,baseURL:origin},
  verify:async key=>revoked?null:grant(key),readCurrentGrant:async id=>revoked?null:[grant(secret),grant(reader),grant(foreign)].find(value=>value?.grantId===id)??null,
  operationAvailable:id=>writable||!['createTodo','updateTodo','createRequirement','updateRequirement'].includes(id),assertWritable:async()=>{}});
 const dispatch=async(request:Request)=>{
  const path=new URL(request.url).pathname;
  requests.push({method:request.method,path,authorization:request.headers.get('authorization'),cookie:request.headers.get('cookie'),key:request.headers.get('idempotency-key')});
  if(redirect)return new Response(null,{status:302,headers:{location:'https://evil.invalid/stolen'}});
  if(echo)return Response.json({error:secret});
  if(failReadback&&request.method==='GET'&&/\/todos\/[a-f0-9-]{36}$/.test(path))return Response.json({error:'READ_UNAVAILABLE'},{status:503});
  if(revokeBeforeWrite&&request.method!=='GET')revoked=true;
  const response=await api(request);
  if(loseNextWrite&&request.method!=='GET'){loseNextWrite=false;throw Error('synthetic transport lost after commit '+secret);}
  return response;
 };
 const handler=()=>createMcpHttpHandler({enabled:true,origin,dispatch});
 return{repository,requests,handler,dispatch,set:(value:Partial<{revoked:boolean;writable:boolean;scopesReduced:boolean;loseNextWrite:boolean;failReadback:boolean;redirect:boolean;echo:boolean;revokeBeforeWrite:boolean}>)=>{
  ({revoked=revoked,writable=writable,scopesReduced=scopesReduced,loseNextWrite=loseNextWrite,failReadback=failReadback,redirect=redirect,echo=echo,revokeBeforeWrite=revokeBeforeWrite}=value);
 }};
}

async function connect(f:ReturnType<typeof fixture>,key=secret,modern=true){
 const transport=new StreamableHTTPClientTransport(new URL(endpoint),{requestInit:{headers:{authorization:'Bearer '+key}},fetch:async(input,init)=>{
  const request=new Request(input,init);request.headers.set('host',new URL(request.url).host);return f.handler()(request);
 }});
 const client=new Client({name:'synthetic-http-mcp-client',version:'1'},{versionNegotiation:{mode:modern?{pin:'2026-07-28'}:'legacy'}});
 await client.connect(transport);return client;
}
const call=(client:Client,operationId:string,args:Record<string,unknown>)=>client.callTool({name:'lifeos_call',arguments:{operationId,arguments:args}});

test('production runtime closes before reading platform configuration without exact activation',async()=>{
 const prior=process.env.LIFEOS_MCP_HTTP;
 try{
  delete process.env.LIFEOS_MCP_HTTP;
  assert.equal((await handleMcpHttpRequest(new Request(endpoint,{method:'POST'}))).status,404);
  process.env.LIFEOS_MCP_HTTP='1';
  assert.equal((await handleMcpHttpRequest(new Request(endpoint,{method:'POST'}))).status,404);
 }finally{if(prior===undefined)delete process.env.LIFEOS_MCP_HTTP;else process.env.LIFEOS_MCP_HTTP=prior;}
});

test('in-process transport retains both caller cancellation and the existing API timeout signal',async()=>{
 let dispatched=0,received:AbortSignal|undefined;
 const outer=new AbortController(),inner=new AbortController();
 const transport=inProcessApiFetch(origin,secret,async request=>{dispatched++;received=request.signal;return Response.json({});},outer.signal);
 const input=origin+'/api/platform/agent/v2/capabilities',headers={authorization:'Bearer '+secret};
 await assert.rejects(transport(input,{headers,signal:AbortSignal.abort()}));
 assert.equal(dispatched,0);
 await transport(input,{headers,signal:inner.signal});assert.equal(received?.aborted,false);
 inner.abort();assert.equal(received?.aborted,true);
 outer.abort();await assert.rejects(transport(input,{headers}));assert.equal(dispatched,1);
});

test('an in-flight dispatcher cannot keep the caller waiting after its timeout signal aborts',{timeout:1000},async()=>{
 const controller=new AbortController(),started=Promise.withResolvers<void>();
 const transport=inProcessApiFetch(origin,secret,async()=>{started.resolve();return new Promise<Response>(()=>{});},new AbortController().signal);
 const waiting=transport(origin+'/api/platform/agent/v2/capabilities',{headers:{authorization:'Bearer '+secret},signal:controller.signal});
 await started.promise;controller.abort();await assert.rejects(waiting);
});

test('cancellation after a writer commits preserves unknown outcome and the original key for durable recovery',{timeout:1000},async()=>{
 const f=fixture(),committed=Promise.withResolvers<void>(),release=Promise.withResolvers<void>(),outer=new AbortController();
 const args={fields,idempotencyKey:'synthetic-aborted-write'};
 // Use the same actual API writer; pause only delivery of its already committed response.
 let pause=true;
 const repository=f.repository;
 const dispatch=async(request:Request)=>{const response=await f.dispatch(request);if(pause&&request.method==='POST'){committed.resolve();await release.promise;}return response;};
 const client=new HttpBusinessClient(origin,secret,dispatch,outer.signal);
 const pending=client.execute('createTodo',args);await committed.promise;outer.abort();
 const result=await pending;
 assert.equal(result.outcome,'unknown');assert.equal(result.retry?.idempotencyKey,args.idempotencyKey);assert.equal(repository.rows.size,1);
 release.resolve();pause=false;
 const replay=await new HttpBusinessClient(origin,secret,dispatch,new AbortController().signal).execute('createTodo',args);
 assert.equal(replay.ok,true);assert.equal(replay.data?.duplicate,true);assert.equal(replay.verification?.verified,true);assert.equal(repository.rows.size,1);
});

test('HTTP MCP remains default closed and rejects edge/auth input before business dispatch',async()=>{
 let dispatched=0;const dispatch=async()=>{dispatched++;return Response.json({});};
 const disabled=createMcpHttpHandler({origin,dispatch});
 assert.equal((await disabled(new Request(endpoint,{method:'POST'}))).status,404);
 assert.equal(dispatched,0);
 const handler=createMcpHttpHandler({enabled:true,origin,dispatch});
 const request=(url=endpoint,headers:Record<string,string>={})=>new Request(url,{method:'POST',headers:{host:'lifeos.nirvanachow.com','content-type':'application/json',authorization:'Bearer '+secret,...headers},body:'{}'});
 for(const input of [request('https://evil.invalid/api/platform/mcp'),request(endpoint+'?url=https://evil.invalid'),request(endpoint+'#not-an-endpoint'),request(endpoint+'/extra'),request(endpoint,{host:'evil.invalid'}),request(endpoint,{origin:'https://evil.invalid'}),request(endpoint,{'x-forwarded-host':'evil.invalid'}),request(endpoint,{forwarded:'host=evil.invalid'})])assert.ok([403,404].includes((await handler(input)).status));
 for(const authorization of ['', 'Basic '+secret,'Bearer '+secret+', Bearer '+reader])assert.equal((await handler(request(endpoint,{authorization,cookie:'synthetic-owner-session'}))).status,401);
 assert.equal((await handler(new Request(endpoint,{method:'GET',headers:{host:'lifeos.nirvanachow.com'}}))).status,405);
 assert.equal(dispatched,0);
});

test('authentication denial and API unavailability remain distinct without exposing verifier details',async()=>{
 const f=fixture();
 const request=(key:string)=>new Request(endpoint,{method:'POST',headers:{host:'lifeos.nirvanachow.com',authorization:'Bearer '+key,'content-type':'application/json'},body:'{}'});
 assert.equal((await f.handler()(request(foreign))).status,403);
 const unavailable=createMcpHttpHandler({enabled:true,origin,dispatch:async()=>Response.json({error:'synthetic database unavailable'},{status:503})});
 const response=await unavailable(request(secret));assert.equal(response.status,503);assert.equal((await response.text()).includes('synthetic database'),false);
});

test('SDK rejects invalid content and oversized bodies and endpoint never forwards browser cookies',async()=>{
 const f=fixture();
 const request=(body:string,contentType='application/json')=>new Request(endpoint,{method:'POST',headers:{host:'lifeos.nirvanachow.com',authorization:'Bearer '+secret,cookie:'synthetic-owner-session','content-type':contentType,accept:'application/json, text/event-stream'},body});
 assert.equal((await f.handler()(request('{}','text/plain'))).status,415);
 assert.equal((await f.handler()(request('x'.repeat(131073)))).status,413);
 const response=await f.handler()(request(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}})));
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
 assert.equal(response.headers.has('mcp-session-id'),false);assert.equal((await response.text()).includes(secret),false);
 assert.ok(f.requests.every(value=>value.cookie===null));assert.equal(f.repository.rows.size,0);
});

for(const modern of [true,false])test(`official ${modern?'2026':'2025'} HTTP client uses current API writer and independent readback`,async()=>{
 const f=fixture(),client=await connect(f,secret,modern);
 try{
  assert.equal(client.getNegotiatedProtocolVersion(),modern?'2026-07-28':'2025-11-25');
  assert.deepEqual((await client.listTools()).tools.map(tool=>tool.name),['lifeos_discover','lifeos_call']);
  const discovered=await client.callTool({name:'lifeos_discover',arguments:{}}),catalog=discovered.structuredContent as any;
  assert.ok(catalog.operations.some((op:any)=>op.id==='createRequirement'));
  assert.equal(catalog.operations.some((op:any)=>op.id==='commitTodoClassification'),false);
  const created=(await call(client,'createTodo',{fields,idempotencyKey:'synthetic-http-create'})).structuredContent as any;
  assert.equal(created.ok,true,JSON.stringify(created));assert.equal(created.verification.state,'VERIFIED');
  assert.equal(created.readback.data.id,created.data.entry.id);assert.equal(f.repository.rows.size,1);
  const updated=(await call(client,'updateTodo',{id:created.data.entry.id,expectedRevision:1,fields:{...fields,status:'done',personal:null},idempotencyKey:'synthetic-http-update'})).structuredContent as any;
  assert.equal(updated.verification.verified,true,JSON.stringify(updated));assert.equal(updated.data.entry.revision,2);
  const requirement=(await call(client,'createRequirement',{fields:{title:'Synthetic requirement',body:'Purpose',phaseId:'business',priority:'P1',plannedStartOn:null,plannedEndOn:null},idempotencyKey:'synthetic-http-requirement'})).structuredContent as any;
  assert.equal(requirement.verification.verified,true,JSON.stringify(requirement));
  assert.ok(f.requests.every(request=>request.path.startsWith('/api/platform/agent/')&&request.authorization==='Bearer '+secret&&request.cookie===null));
  assert.equal(f.requests.find(request=>request.method==='POST')?.key,'synthetic-http-create');
 }finally{await client.close();}
});

test('lost write recovers the exact durable API command after a new HTTP handler and keeps later revision separate',async()=>{
 const f=fixture();let client=await connect(f);
 try{
  const created=(await call(client,'createTodo',{fields,idempotencyKey:'synthetic-recovery-create'})).structuredContent as any;
  const id=created.data.entry.id,args={id,expectedRevision:1,fields:{...fields,status:'done',personal:null},idempotencyKey:'synthetic-recovery-update'};
  f.set({loseNextWrite:true});
  const unknown=(await call(client,'updateTodo',args)).structuredContent as any;
  assert.equal(unknown.outcome,'unknown');assert.equal(unknown.retry.idempotencyKey,args.idempotencyKey);
  assert.equal('recovery' in unknown,false);assert.equal(JSON.stringify(unknown).includes(secret),false);
  assert.equal(f.repository.rows.get(id)?.revision,2);
  await client.close();client=await connect(f);
  const recovered=(await call(client,'updateTodo',args)).structuredContent as any;
  assert.equal(recovered.ok,true,JSON.stringify(recovered));assert.equal(recovered.data.duplicate,true);assert.equal(recovered.verification.state,'VERIFIED');
  assert.equal(f.repository.rows.get(id)?.revision,2);
  await call(client,'updateTodo',{...args,expectedRevision:2,fields:{...fields,status:'open',personal:null},idempotencyKey:'synthetic-later-update'});
  const later=(await call(client,'updateTodo',args)).structuredContent as any;
  assert.equal(later.ok,true);assert.equal(later.data.entry.revision,2);assert.equal(later.verification.state,'LATER_REVISION');assert.equal(later.readback.data.revision,3);
  const changed=(await call(client,'updateTodo',{...args,fields:{...fields,title:'Different',personal:null}})).structuredContent as any;
  assert.equal(changed.ok,false);assert.equal(f.repository.rows.get(id)?.revision,3);
 }finally{await client.close();}
});

test('lost POST creation replays one durable API receipt after reconnecting without duplicating the record',async()=>{
 const f=fixture(),args={fields,idempotencyKey:'synthetic-lost-post-create'};let client=await connect(f);
 try{
  f.set({loseNextWrite:true});
  const unknown=(await call(client,'createTodo',args)).structuredContent as any;
  assert.equal(unknown.outcome,'unknown');assert.equal(unknown.retry.idempotencyKey,args.idempotencyKey);assert.equal(f.repository.rows.size,1);
  await client.close();client=await connect(f);
  const replay=(await call(client,'createTodo',args)).structuredContent as any;
  assert.equal(replay.data.duplicate,true);assert.equal(replay.verification.verified,true);assert.equal(replay.data.entry.revision,1);assert.equal(f.repository.rows.size,1);
 }finally{await client.close();}
});

test('separate keys, foreign owner, revoked grant and module closure cannot reuse another request authority',async()=>{
 const f=fixture(),writerClient=await connect(f),readerClient=await connect(f,reader);
 try{
  const denied=(await call(readerClient,'createTodo',{fields,idempotencyKey:'synthetic-cross-key'})).structuredContent as any;
  assert.equal(denied.ok,false);assert.equal(f.repository.rows.size,0);
  assert.equal(JSON.stringify(await readerClient.listTools()).includes('createTodo'),false);
  await assert.rejects(connect(f,foreign));
  f.set({scopesReduced:true});assert.equal(JSON.stringify(await writerClient.listTools()).includes('createTodo'),false);
  const reduced=(await call(writerClient,'createTodo',{fields,idempotencyKey:'synthetic-reduced-grant'})).structuredContent as any;
  assert.equal(reduced.ok,false);assert.equal(f.repository.rows.size,0);f.set({scopesReduced:false});
  f.set({writable:false});assert.equal(JSON.stringify(await writerClient.listTools()).includes('createTodo'),false);
  f.set({writable:true,revokeBeforeWrite:true});
  const revoked=(await call(writerClient,'createTodo',{fields,idempotencyKey:'synthetic-race-revoke'})).structuredContent as any;
  assert.equal(revoked.ok,false);assert.equal(f.repository.rows.size,0);
  await assert.rejects(writerClient.listTools());
 }finally{await writerClient.close();await readerClient.close();}
});

test('unknown tools, authority arguments, redirects and secret echoes are rejected without credential leakage',async()=>{
 const f=fixture(),client=await connect(f);
 try{
  const unsupported=(await call(client,'manageApiKeys',{})).structuredContent as any;
  assert.equal(unsupported.status,403);assert.equal(unsupported.error,'OPERATION_UNAVAILABLE');
  for(const argumentsValue of [{host:'https://evil.invalid'},{headers:{authorization:secret}},{ownerId:'other-owner'},{path:'/account/api-keys'}]){
   const value=await call(client,'snapshotTodos',argumentsValue);assert.equal(value.isError,true);assert.equal(JSON.stringify(value).includes(secret),false);
  }
  assert.equal((await client.callTool({name:'lifeos_retry',arguments:{requestId:'11111111-1111-4111-8111-111111111111'}})).isError,true);
  f.set({redirect:true});await assert.rejects(client.listTools());
  f.set({redirect:false,echo:true});await assert.rejects(client.listTools());
  assert.equal(f.repository.rows.size,0);
 }finally{await client.close();}
});

test('committed receipt remains distinct when independent readback becomes unavailable',async()=>{
 const f=fixture(),client=await connect(f);
 try{f.set({failReadback:true});const result=(await call(client,'createTodo',{fields,idempotencyKey:'synthetic-readback-unavailable'})).structuredContent as any;
  assert.equal(result.ok,true);assert.equal(result.data.entry.revision,1);assert.equal(result.readback.ok,false);assert.equal(result.verification.verified,false);assert.equal(result.verification.state,'READBACK_UNAVAILABLE');
 }finally{await client.close();}
});
