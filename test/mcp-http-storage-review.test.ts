import assert from 'node:assert/strict';
import test from 'node:test';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {AjvJsonSchemaValidator} from '@modelcontextprotocol/client/validators/ajv';
import {createAgentHandler} from '../src/agent-api/http.ts';
import {storageReviewOperations} from '../src/storage-review/operations.ts';
import {StorageReviewService} from '../src/storage-review/service.ts';
import {createMcpHttpHandler} from '../src/mcp-http/handler.ts';
import {MemoryPort} from './helpers/platform.ts';

const origin='https://lifeos.nirvanachow.com',endpoint=origin+'/api/platform/mcp';
const ownerId='synthetic-http-review-owner',spaceId='synthetic-http-review-space';
const writer='synthetic-http-review-policy',legacy='synthetic-http-review-legacy';
const checklist={schema:1,revision:'synthetic-http-review-1',context:{summary:'Synthetic protocol qualification only'},items:[
 {id:'S-1',title:'Synthetic document',body:'No real paths',question:'Keep?',group:'Synthetic',kind:'file',status:'pending'},
 {id:'S-2',title:'Protected example',body:'',question:'',group:'Synthetic',kind:'folder',status:'protected'},
]};
type CallResult={ok:boolean;status:number;outcome?:string;retry?:{operationId:string;idempotencyKey:string;requireSameArguments:boolean};data?:any;readback?:any;verification?:any;error?:string};
const validator=new AjvJsonSchemaValidator();
function assertSchema(schema:Record<string,any>,value:unknown){const result=validator.getValidator(schema)(value);assert.equal(result.valid,true,result.errorMessage);}

function fixture(){
 const repository=new MemoryPort(),transaction=repository.transaction.bind(repository);
 repository.readCurrentSnapshot=async()=>structuredClone([...repository.rows.values()]);
 let revoked=false,readOnly=false,enabled=true,loseMethod:string|null=null,failReadback=false,fenced=true;
 repository.transaction=(owner,key,run)=>transaction(owner,key,tx=>run({...tx,lockRecordIdentity:async()=>{},lockAgentGrant:async()=>fenced&&!revoked}));
 const config={ownerId,spaceId,baseURL:origin,ownerEmail:'fixture@example.invalid',databaseName:'fixture',approval:'personal-manual-v1',allowedTypes:['todo','journal']} as const;
 const grant=(token:string)=>token===writer?{grantId:'synthetic-http-review-grant',ownerId,spaceId,businessDataPolicy:'all-personal-business-v1' as const,
  allowedOperationIds:storageReviewOperations.filter(op=>!readOnly||op.method==='GET').map(op=>op.id),scopes:[...new Set(storageReviewOperations.filter(op=>!readOnly||op.method==='GET').flatMap(op=>op.requiredScopes))]}:
  token===legacy?{grantId:'synthetic-http-review-legacy-grant',ownerId,spaceId,scopes:['todo:read'] as const}:null;
 const api=createAgentHandler({enabled:true,mountPath:'/api/platform/agent',fenceWrites:true,modules:{organization:false,classification:false,businessDataPolicy:true,storageReview:true},repository,config,
  verify:async token=>revoked?null:grant(token),readCurrentGrant:async id=>revoked?null:id==='synthetic-http-review-grant'?grant(writer):id==='synthetic-http-review-legacy-grant'?grant(legacy):null,
  operationAvailable:()=>enabled,assertWritable:async()=>{}});
 const requests:{method:string;path:string;body:string;key:string|null;authorization:string|null;cookie:string|null}[]=[];
 const dispatch=async(request:Request)=>{
  const path=new URL(request.url).pathname;
  requests.push({method:request.method,path,body:request.method==='GET'?'':await request.clone().text(),key:request.headers.get('idempotency-key'),authorization:request.headers.get('authorization'),cookie:request.headers.get('cookie')});
  if(failReadback&&request.method==='GET'&&/\/storage-reviews\/[a-f0-9-]{36}$/.test(path))return Response.json({error:'READ_UNAVAILABLE'},{status:503});
  const response=await api(request);
  if(loseMethod===request.method&&request.method!=='GET'){loseMethod=null;throw Error('Synthetic response lost after commit');}
  return response;
 };
 return{repository,requests,owner:new StorageReviewService(repository,config),handler:()=>createMcpHttpHandler({enabled:true,origin,dispatch}),
  set:(value:Partial<{revoked:boolean;readOnly:boolean;enabled:boolean;loseMethod:string|null;failReadback:boolean;fenced:boolean}>)=>{
   ({revoked=revoked,readOnly=readOnly,enabled=enabled,loseMethod=loseMethod,failReadback=failReadback,fenced=fenced}=value);
  }};
}
async function connect(f:ReturnType<typeof fixture>,token=writer,modern=true){
 const transport=new StreamableHTTPClientTransport(new URL(endpoint),{requestInit:{headers:{authorization:'Bearer '+token,cookie:'synthetic-owner-cookie-must-not-forward'}},fetch:async(input,init)=>{
  const request=new Request(input,init);request.headers.set('host',new URL(request.url).host);return f.handler()(request);
 }});
 const client=new Client({name:'synthetic-storage-http-mcp',version:'1'},{versionNegotiation:{mode:modern?{pin:'2026-07-28'}:'legacy'}});
 await client.connect(transport);return client;
}
const call=async(client:Client,operationId:string,args:Record<string,unknown>):Promise<CallResult>=>(await client.callTool({name:'lifeos_call',arguments:{operationId,arguments:args}})).structuredContent as unknown as CallResult;
const create=(client:Client,key='synthetic-http-review-create')=>call(client,'createStorageReview',{fields:{checklist},idempotencyKey:key});
const choose=(client:Client,id:string,expectedRevision:number,decision:string,key:string)=>call(client,'updateStorageReviewDecision',{id,expectedRevision,fields:{checklistRevision:checklist.revision,itemId:'S-1',decision},idempotencyKey:key});

for(const modern of [true,false])test(`official ${modern?'2026':'2025'} HTTP MCP projects all five storage operations through the native owner writer`,async()=>{
 const f=fixture(),client=await connect(f,writer,modern);
 try{
  assert.equal(client.getNegotiatedProtocolVersion(),modern?'2026-07-28':'2025-11-25');
  const tools=(await client.listTools()).tools;assert.deepEqual(tools.map(tool=>tool.name),['lifeos_discover','lifeos_call']);
  const catalog=(await client.callTool({name:'lifeos_discover',arguments:{}})).structuredContent as any;
  assert.equal(catalog.operations.length,5);
  assert.deepEqual(catalog.operations.map((op:any)=>op.id),storageReviewOperations.map(op=>op.id));
  for(const op of catalog.operations){assert.equal(op.inputSchema.additionalProperties,false);assert.equal(typeof op.inputSchema.properties,'object');}
  const invoke=(operationId:string,args:Record<string,unknown>)=>{
   assertSchema(catalog.operations.find((op:any)=>op.id===operationId).inputSchema,args);
   assertSchema(tools.find(tool=>tool.name==='lifeos_call')!.inputSchema,{operationId,arguments:args});
   return call(client,operationId,args);
  };
  const created=await invoke('createStorageReview',{fields:{checklist},idempotencyKey:'synthetic-http-review-create'});assert.equal(created.verification?.state,'VERIFIED',JSON.stringify(created));
  const {id,sourceId}=created.data.entry;
  const snapshot=await invoke('snapshotStorageReviews',{});assert.equal(snapshot.data.truncated,false);assert.deepEqual(snapshot.data.items,[created.data.entry]);
  assert.deepEqual((await invoke('getStorageReview',{id})).data.entry,created.data.entry);
  const args={id,expectedRevision:1,fields:{checklistRevision:checklist.revision,itemId:'S-1',decision:'keep'},idempotencyKey:'synthetic-http-review-keep'};
  const choice=await invoke('updateStorageReviewDecision',args);assert.equal(choice.verification?.verified,true,JSON.stringify(choice));assert.equal(choice.data.entry.revision,2);
  const noop=await invoke('updateStorageReviewDecision',{...args,expectedRevision:2,idempotencyKey:'synthetic-http-review-noop'});assert.equal(noop.verification?.verified,true);assert.equal(noop.data.entry.revision,2);
  const next={...checklist,revision:'synthetic-http-review-2'};
  const updated=await invoke('updateStorageReviewChecklist',{id,expectedRevision:2,fields:{checklist:next},idempotencyKey:'synthetic-http-review-checklist'});
  assert.equal(updated.verification?.verified,true,JSON.stringify(updated));assert.equal(updated.data.entry.revision,3);assert.equal(updated.data.entry.sourceId,sourceId);assert.deepEqual(updated.data.entry.fields.decisions,[{id:'S-1',decision:'keep'}]);
  const owner=await f.owner.getEntry(ownerId,id);assert.deepEqual(owner,updated.data.entry);assert.equal(f.repository.historyRows.length,3);
  const protectedChoice=await call(client,'updateStorageReviewDecision',{id,expectedRevision:3,fields:{checklistRevision:next.revision,itemId:'S-2',decision:'trash'},idempotencyKey:'synthetic-http-review-protected'});
  assert.equal(protectedChoice.ok,false);assert.equal(protectedChoice.status,409);assert.equal(f.repository.historyRows.length,3);
  assert.ok(f.requests.every(request=>request.authorization==='Bearer '+writer&&request.cookie===null&&request.path.startsWith('/api/platform/agent/')));
  assert.equal(JSON.stringify(updated).includes(writer),false);
 }finally{await client.close();}
});

test('lost storage POST replays the original body and key after reconnecting and separates a later owner choice',async()=>{
 const f=fixture(),args={fields:{checklist},idempotencyKey:'synthetic-http-review-lost-post'};let client=await connect(f);
 try{
  f.set({loseMethod:'POST'});const unknown=await call(client,'createStorageReview',args);
  assert.equal(unknown.outcome,'unknown');assert.deepEqual(unknown.retry,{operationId:'createStorageReview',idempotencyKey:args.idempotencyKey,requireSameArguments:true});assert.equal('recovery'in unknown,false);
  const saved=await f.owner.getEntry(ownerId);assert.ok(saved);assert.equal(saved.revision,1);
  await f.owner.saveDecision(ownerId,{expectedRevision:1,checklistRevision:checklist.revision,id:'S-1',decision:'keep'},'synthetic-owner-after-lost-post');
  await client.close();client=await connect(f);
  const replay=await call(client,'createStorageReview',args);assert.equal(replay.ok,true,JSON.stringify(replay));assert.equal(replay.data.duplicate,true);assert.equal(replay.data.entry.revision,1);assert.deepEqual(replay.data.entry.fields.decisions,[]);
  assert.equal(replay.verification.state,'LATER_REVISION');assert.equal(replay.verification.verified,false);assert.equal(replay.readback.data.entry.revision,2);assert.deepEqual(replay.readback.data.entry.fields.decisions,[{id:'S-1',decision:'keep'}]);
  const posts=f.requests.filter(request=>request.method==='POST'&&request.path.endsWith('/storage-reviews'));assert.equal(posts.length,2);assert.equal(posts[0]!.key,posts[1]!.key);assert.equal(posts[0]!.body,posts[1]!.body);assert.equal(f.repository.rows.size,1);assert.equal(f.repository.historyRows.length,2);
 }finally{await client.close();}
});

for(const operationId of ['updateStorageReviewDecision','updateStorageReviewChecklist'])test(`lost ${operationId} preserves its historical receipt after a later owner decision`,async()=>{
 const f=fixture();let client=await connect(f);
 try{
  const created=await create(client),id=created.data.entry.id;
  const checklistUpdate=operationId==='updateStorageReviewChecklist';
  if(checklistUpdate)assert.equal((await choose(client,id,1,'keep','synthetic-http-review-before-checklist')).ok,true);
  const revision=checklistUpdate?2:1,next={...checklist,revision:'synthetic-http-review-next'};
  const fields=checklistUpdate?{checklist:next}:{checklistRevision:checklist.revision,itemId:'S-1',decision:'keep'};
  const args={id,expectedRevision:revision,fields,idempotencyKey:'synthetic-http-review-lost-'+operationId};
  f.set({loseMethod:'PATCH'});const unknown=await call(client,operationId,args);assert.equal(unknown.outcome,'unknown');assert.equal(unknown.retry?.idempotencyKey,args.idempotencyKey);assert.equal('recovery'in unknown,false);
  const committed=await f.owner.getEntry(ownerId,id);assert.equal(committed?.revision,revision+1);
  await f.owner.saveDecision(ownerId,{expectedRevision:revision+1,checklistRevision:checklistUpdate?next.revision:checklist.revision,id:'S-1',decision:'defer'},'synthetic-owner-later-'+operationId);
  await client.close();client=await connect(f);
  const replay=await call(client,operationId,args);assert.equal(replay.ok,true,JSON.stringify(replay));assert.equal(replay.data.duplicate,true);assert.equal(replay.data.entry.revision,revision+1);assert.deepEqual(replay.data.entry.fields.decisions,[{id:'S-1',decision:'keep'}]);
  assert.equal(replay.verification.state,'LATER_REVISION');assert.equal(replay.verification.verified,false);assert.equal(replay.readback.data.entry.revision,revision+2);assert.deepEqual(replay.readback.data.entry.fields.decisions,[{id:'S-1',decision:'defer'}]);
  const patches=f.requests.filter(request=>request.method==='PATCH'&&request.key===args.idempotencyKey);assert.equal(patches.length,2);assert.equal(patches[0]!.body,patches[1]!.body);
  const changed=await call(client,operationId,{...args,fields:checklistUpdate?{checklist:{...next,context:{summary:'Changed original payload'}}}:{...fields,decision:'trash'}});
  assert.equal(changed.ok,false);assert.equal(changed.status,409);assert.equal((await f.owner.getEntry(ownerId,id))?.revision,revision+2);assert.equal(f.repository.historyRows.length,revision+2);
 }finally{await client.close();}
});

test('storage HTTP MCP refreshes scope and readiness and cannot use an old key or a revoked transaction fence',async()=>{
 const f=fixture(),client=await connect(f),legacyClient=await connect(f,legacy);
 try{
  const oldCatalog=(await legacyClient.callTool({name:'lifeos_discover',arguments:{}})).structuredContent as any;
  assert.equal(oldCatalog.operations.some((op:any)=>op.module==='storageReview'),false);assert.equal((await create(legacyClient,'synthetic-http-review-old-key')).ok,false);
  f.set({readOnly:true});const readCatalog=(await client.callTool({name:'lifeos_discover',arguments:{}})).structuredContent as any;
  assert.deepEqual(readCatalog.operations.map((op:any)=>op.id),['snapshotStorageReviews','getStorageReview']);assert.equal((await create(client)).ok,false);
  f.set({readOnly:false,fenced:false});assert.equal((await create(client)).ok,false);assert.equal(f.repository.rows.size,0);
  f.set({fenced:true,enabled:false});assert.deepEqual((await client.listTools()).tools.map(tool=>tool.name),['lifeos_discover']);assert.equal((await create(client)).ok,false);
  f.set({enabled:true,revoked:true});await assert.rejects(client.listTools());assert.equal(f.repository.rows.size,0);
 }finally{await client.close();await legacyClient.close();}
});

test('a confirmed storage receipt with failed independent GET is not an unknown write or verified current state',async()=>{
 const f=fixture(),client=await connect(f);
 try{
  f.set({failReadback:true});const created=await create(client);
  assert.equal(created.ok,true,JSON.stringify(created));assert.equal(created.outcome,undefined);assert.equal(created.data.entry.revision,1);assert.equal(created.readback.ok,false);assert.equal(created.verification.state,'READBACK_UNAVAILABLE');assert.equal(created.verification.verified,false);
  f.set({failReadback:false});const replay=await create(client);assert.equal(replay.data.duplicate,true);assert.equal(replay.verification.verified,true);assert.equal(f.repository.historyRows.length,1);
 }finally{await client.close();}
});
