import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {PassThrough} from 'node:stream';
import {Client} from '@modelcontextprotocol/client';
import {StdioServerTransport,serveStdio} from '@modelcontextprotocol/server/stdio';
import {AjvJsonSchemaValidator} from '@modelcontextprotocol/client/validators/ajv';
import {createAgentHandler} from '../src/agent-api/http.ts';
import {createMcpHttpHandler} from '../src/mcp-http/handler.ts';
import {DurableStore} from '../src/mcp-candidate/native-store.mjs';
import {DurableMcpClient} from '../src/mcp-server-host-candidate/client.ts';
import {createMcpChannel,type BrokerPort} from '../src/mcp-server-host-candidate/channel.ts';
import {localDefinitions} from '../src/mcp-server-host-candidate/contracts.ts';
import {createDurableServer} from '../src/mcp-server-host-candidate/stdio.ts';
import {MemoryPort} from './helpers/platform.ts';

const origin='https://lifeos.nirvanachow.com',fingerprint='d'.repeat(64),token='synthetic-durable-protocol-key';
const todoFields={title:'Synthetic durable task',notes:'',dueOn:null,status:'open'};
const checklist={schema:1,revision:'synthetic-durable-checklist',context:{summary:'Synthetic only'},items:[{id:'S-1',title:'Synthetic file',body:'',question:'Keep?',group:'Synthetic',kind:'file',status:'pending'}]};
type Value=Record<string,any>;
const validator=new AjvJsonSchemaValidator();
function matches(schema:Value,value:unknown){const checked=validator.getValidator(schema)(value);assert.equal(checked.valid,true,checked.errorMessage);}
// Construct synthetic inputs from the same public structures available to an ordinary client.
function fromSchema(schema:Value):any{
 if(schema.const!==undefined)return schema.const;
 if(schema.enum)return schema.enum[0];
 const alternatives=schema.oneOf??schema.anyOf;
 if(alternatives)return fromSchema(alternatives.find((s:Value)=>s.type==='null')??alternatives[0]);
 if(schema.examples?.length)return schema.examples[0];
 if(schema.type==='null')return null;
 if(schema.type==='object')return Object.fromEntries((schema.required??[]).map((key:string)=>[key,fromSchema(schema.properties[key])]));
 if(schema.type==='array')return Array.from({length:schema.minItems??0},()=>fromSchema(schema.items));
 if(schema.type==='integer'||schema.type==='number')return schema.minimum??1;
 if(schema.type==='boolean')return true;
 assert.equal(schema.type,'string');return 'Synthetic';
}
function fixture(){
 const directory=mkdtempSync(join(tmpdir(),'lifeos-durable-protocol-')),repository=new MemoryPort();
 repository.readCurrentSnapshot=async()=>structuredClone([...repository.rows.values()]);
 const state={revoked:false,expired:false,readOnly:false,foreign:false,changedFingerprint:false,fenced:true,loseWrite:false,cancelAfterCommit:false,failLocalGet:false,extra:false,drift:false,enabled:true};
 const transaction=repository.transaction.bind(repository);
 repository.transaction=(owner,key,run)=>transaction(owner,key,tx=>run({...tx,lockRecordIdentity:async()=>{},lockAgentGrant:async()=>state.fenced&&!state.revoked&&!state.expired}));
 const grant=()=>({grantId:'synthetic-grant',ownerId:state.foreign?'other-owner':'synthetic-owner',spaceId:state.foreign?'other-space':'synthetic-space',businessDataPolicy:'all-personal-business-v1' as const,allowedOperationIds:localDefinitions.filter(op=>!state.readOnly||op.method==='GET').map(op=>op.id),scopes:[...new Set(localDefinitions.filter(op=>!state.readOnly||op.method==='GET').flatMap(op=>op.requiredScopes))]});
 const api=createAgentHandler({enabled:true,mountPath:'/api/platform/agent',fenceWrites:true,modules:{organization:true,classification:false,personalRecords:true,businessDataPolicy:true,requirements:true,storageReview:true},repository,
  config:{ownerId:'synthetic-owner',spaceId:'synthetic-space',ownerEmail:'fixture@example.invalid',databaseName:'fixture',approval:'personal-manual-v1',allowedTypes:['todo','journal','project','domain','topic'],requirementsEnabled:true,requirementSupportEnabled:true,calendarEnabled:true,healthEnabled:true,peopleEnabled:true,financeEnabled:true,mediaEnabled:true,careerEnabled:true,portfolioEnabled:true,baseURL:origin},
  verify:async key=>key===token&&!state.revoked&&!state.expired?grant():null,readCurrentGrant:async()=>state.revoked||state.expired?null:grant(),operationAvailable:()=>state.enabled,assertWritable:async()=>{}});
 const apiRequests:{method:string;path:string;body:string;key:string|null}[]=[],envelopes:string[]=[];
 let beforeBusiness:(()=>void)|undefined;
 const dispatch=async(request:Request)=>{
  const path=new URL(request.url).pathname;
  assert.equal(request.headers.get('authorization'),'Bearer '+token);assert.equal(request.headers.get('cookie'),null);
  apiRequests.push({method:request.method,path,body:request.method==='GET'?'':await request.clone().text(),key:request.headers.get('idempotency-key')});
  const response=await api(request);
  if(state.loseWrite&&request.method!=='GET'){state.loseWrite=false;throw Error('synthetic lost API response after commit');}
  return response;
 };
 const port:BrokerPort={beforeUse:async()=>{},fingerprint:async()=>state.changedFingerprint?'e'.repeat(64):fingerprint,request:async(envelope)=>{
  envelopes.push(envelope.encoded);const rpc=JSON.parse(envelope.encoded);
  const business=rpc.params?.name==='lifeos_call';
  if(business&&beforeBusiness){const action=beforeBusiness;beforeBusiness=undefined;action();}
  if(state.failLocalGet&&business&&rpc.params.arguments.operationId.startsWith('get'))throw Error('synthetic local readback unavailable');
  const controller=new AbortController();
  // Simulate actual HTTP caller cancellation at the commit/response boundary.
  const handler=createMcpHttpHandler({enabled:true,origin,dispatch:async request=>{const result=await dispatch(request);if(state.cancelAfterCommit&&request.method!=='GET'){state.cancelAfterCommit=false;controller.abort();}return result;}});
  const response=await handler(new Request(origin+envelope.path,{method:envelope.method,headers:{host:'lifeos.nirvanachow.com',authorization:'Bearer '+token,'content-type':'application/json','mcp-protocol-version':'2026-07-28','mcp-method':rpc.method,...(rpc.params?.name?{'mcp-name':rpc.params.name}:{}),accept:'application/json, text/event-stream'},body:envelope.encoded,signal:controller.signal}));
  const data=await response.json();
  if(rpc.params?.name==='lifeos_discover'&&data.result?.structuredContent?.operations){
   if(state.extra)data.result.structuredContent.operations.push({...structuredClone(localDefinitions[0]),id:'futureUnreviewed',module:'future',path:'/v1/future'});
   if(state.drift)data.result.structuredContent.operations[0].inputSchema={type:'object',additionalProperties:true};
  }
  return{status:response.status,data,credentialFingerprint:fingerprint};
 }};
 const connect=async(modern=true)=>{
  const durable=new DurableMcpClient({channel:createMcpChannel(port),store:new DurableStore(directory,fingerprint)});
  const input=new PassThrough(),output=new PassThrough();
  // Both ends use the official SDK newline codec and stdio transport, over isolated pipes.
  const handle=serveStdio(()=>createDurableServer({client:durable}),{transport:new StdioServerTransport(input,output)});
  const client=new Client({name:'synthetic-durable-stdio',version:'1'},{versionNegotiation:{mode:modern?{pin:'2026-07-28'}:'legacy'}});
  await client.connect(new StdioServerTransport(output,input));
  return{client,close:async()=>{await client.close();await handle.close();input.destroy();output.destroy();}};
 };
 return{state,repository,apiRequests,envelopes,connect,beforeBusiness:(action:()=>void)=>{beforeBusiness=action;},close:()=>rmSync(directory,{recursive:true,force:true})};
}
const call=async(client:Client,operationId:string,args:Value)=>(await client.callTool({name:'lifeos_call',arguments:{operationId,arguments:args}})).structuredContent as Value;
const discover=async(client:Client,args:Value={})=>(await client.callTool({name:'lifeos_discover',arguments:args})).structuredContent as Value;
const create=(client:Client,key='synthetic-protocol-create')=>call(client,'createTodo',{fields:todoFields,idempotencyKey:key});
const writes=(f:ReturnType<typeof fixture>)=>f.apiRequests.filter(r=>r.method!=='GET');

for(const modern of [true,false])test(`official ${modern?'modern':'legacy'} synthetic stdio rebuilds exactly two tools and fresh full/index/operation discovery`,async()=>{
 const f=fixture(),connection=await f.connect(modern);try{
  const {client}=connection;assert.equal(client.getNegotiatedProtocolVersion(),modern?'2026-07-28':'2025-11-25');
  f.state.extra=true;
  const tools=(await client.listTools()).tools;assert.deepEqual(tools.map(t=>t.name),['lifeos_discover','lifeos_call']);
  const full=await discover(client);assert.equal(full.operations.length,53);assert.deepEqual(full.operations,localDefinitions);
  assert.equal(JSON.stringify(tools).includes('futureUnreviewed'),false);assert.equal(JSON.stringify(tools).includes('lifeos_retry'),false);
  assert.deepEqual(await discover(client,{view:'index'}),{apiVersion:'2',view:'index',operations:localDefinitions.map(({id,module,method,description})=>({id,module,method,description}))});
  assert.deepEqual(await discover(client,{operationId:'createTodo'}),{apiVersion:'2',operation:localDefinitions.find(o=>o.id==='createTodo')});
  const count=f.envelopes.length;
  for(const input of [{operationId:'createTodo',arguments:{...todoFields}},{operationId:'getTodo',arguments:{id:'https://evil.invalid'}},{operationId:'listTodos',arguments:{},requestId:'injected'}])assert.equal((await client.callTool({name:'lifeos_call',arguments:input})).isError,true);
  for(const args of [{view:'full'},{view:'index',operationId:'getTodo'},{host:'https://evil.invalid'}])assert.equal((await client.callTool({name:'lifeos_discover',arguments:args})).isError,true);
  assert.equal(f.envelopes.length,count);
  assert.equal((await client.callTool({name:'lifeos_retry',arguments:{requestId:'synthetic'}})).isError,true);
  assert.equal((await call(client,'futureUnreviewed',{})).ok,false);
  f.state.readOnly=true;assert.equal(JSON.stringify(await client.listTools()).includes('createTodo'),false);
  assert.equal((await discover(client,{operationId:'createTodo'})).ok,false);
  f.state.enabled=false;assert.deepEqual((await client.listTools()).tools.map(t=>t.name),['lifeos_discover']);
  f.state.enabled=true;f.state.drift=true;await assert.rejects(client.listTools(),/API_DISCOVERY_UNAVAILABLE/);
  assert.equal((await discover(client)).ok,false);assert.equal(writes(f).length,0);
 }finally{await connection.close();f.close();}
});

test('all twelve business families use true API create/get/update receipts and server plus local GET boundaries',async()=>{
 const f=fixture(),c=await f.connect();try{
  const tools=(await c.client.listTools()).tools,callSchema=tools.find(t=>t.name==='lifeos_call')!.inputSchema;
  const catalog=await discover(c.client),saved:Value={};
  for(const suffix of ['Todo','Journal','Calendar','Health','Person','Finance','Media','Career','Portfolio','Feedback','Requirement','Organization']){
   const descriptor=catalog.operations.find((op:Value)=>op.id==='create'+suffix),args=fromSchema(descriptor.inputSchema);args.idempotencyKey='synthetic-protocol-'+suffix;
   matches(descriptor.inputSchema,args);matches(callSchema,{operationId:descriptor.id,arguments:args});
   const start=f.apiRequests.length,created=await call(c.client,descriptor.id,args);
   assert.equal(created.ok,true,suffix+JSON.stringify(created));assert.equal(created.verification.verified,true,suffix);assert.equal(created.serverVerification.verified,true,suffix);
   assert.equal(created.serverReadback.ok,true);assert.equal(created.readback.ok,true);const entry=created.data.entry;saved[suffix]=entry;
   const readId='get'+suffix,readArgs={id:entry.id,...(args.type?{type:args.type}:{})};
   const readEnvelopes=f.envelopes.map(e=>JSON.parse(e)).filter(r=>r.params.name==='lifeos_call'&&r.params.arguments.operationId===readId);
   assert.ok(readEnvelopes.length>=1,'local GET is a separate broker envelope');
   assert.equal(f.apiRequests.slice(start).filter(r=>r.method==='GET'&&r.path.endsWith('/'+entry.id)).length,2,'server and local readbacks are separate API GETs');
   assert.equal((await call(c.client,readId,readArgs)).ok,true);
   const before=writes(f).length,replay=await call(c.client,descriptor.id,args);assert.equal(replay.ok,true);assert.equal(writes(f).length,before,'settled original call must not send another write');
   if(suffix==='Feedback')continue;
   const fields={...entry.fields,[suffix==='Finance'?'notes':'title']:'Synthetic revised'};
   if(suffix==='Todo')fields.personal=null;
   const next={...readArgs,expectedRevision:1,fields,idempotencyKey:'synthetic-protocol-update-'+suffix,...(suffix==='Requirement'?{baselineBinding:entry.baselineBinding}:{})};
   const updated=await call(c.client,'update'+suffix,next);assert.equal(updated.ok,true,suffix+JSON.stringify(updated));assert.equal(updated.verification.verified,true,suffix);assert.equal(updated.data.entry.revision,2);
   const stale=await call(c.client,'update'+suffix,{...next,idempotencyKey:'synthetic-stale-'+suffix});assert.equal(stale.status,409,suffix);
  }
  assert.equal(f.repository.rows.size,12);assert.equal(JSON.stringify(saved).includes(token),false);
 }finally{await c.close();f.close();}
});

test('storage review no-op and checklist use actual API semantics without a fabricated revision',async()=>{
 const f=fixture(),c=await f.connect();try{
  const created=await call(c.client,'createStorageReview',{fields:{checklist},idempotencyKey:'synthetic-storage-create'});assert.equal(created.ok,true,JSON.stringify(created));
  const id=created.data.entry.id,args={id,expectedRevision:1,fields:{checklistRevision:checklist.revision,itemId:'S-1',decision:'keep'},idempotencyKey:'synthetic-storage-choose'};
  const chosen=await call(c.client,'updateStorageReviewDecision',args);assert.equal(chosen.verification.verified,true,JSON.stringify(chosen));
  const noop=await call(c.client,'updateStorageReviewDecision',{...args,expectedRevision:2,idempotencyKey:'synthetic-storage-noop'});assert.equal(noop.ok,true,JSON.stringify(noop));assert.equal(noop.data.entry.revision,2);assert.equal(noop.verification.verified,true);
  const updated=await call(c.client,'updateStorageReviewChecklist',{id,expectedRevision:2,fields:{checklist:{...checklist,revision:'synthetic-next'}},idempotencyKey:'synthetic-storage-checklist'});assert.equal(updated.verification.verified,true,JSON.stringify(updated));assert.equal(updated.data.entry.revision,3);assert.equal(f.repository.historyRows.length,3);
 }finally{await c.close();f.close();}
});

test('requirements baseline overlay and omitted workflow survive the real durable protocol',async()=>{
 const f=fixture(),c=await f.connect();try{
  const fields={title:'Synthetic requirement',body:'Purpose',phaseId:'business',priority:'P1',plannedStartOn:null,plannedEndOn:null,workflow:{state:'planned',purpose:'Record',nextStep:'Review'}};
  const created=await call(c.client,'createRequirement',{fields,idempotencyKey:'synthetic-req-create'});assert.equal(created.ok,true,JSON.stringify(created));
  const entry=created.data.entry,{workflow,...rest}=fields;
  const updated=await call(c.client,'updateRequirement',{id:entry.id,expectedRevision:1,baselineBinding:entry.baselineBinding,fields:rest,idempotencyKey:'synthetic-req-omit'});assert.equal(updated.verification.verified,true,JSON.stringify(updated));assert.deepEqual(updated.data.entry.fields.workflow,workflow);
  const snapshot=await call(c.client,'snapshotRequirements',{}),baseline=snapshot.data.items.find((e:Value)=>e.id.startsWith('LO-')&&e.revision===0);assert.ok(baseline);
  const wrong=await call(c.client,'updateRequirement',{id:baseline.id,expectedRevision:0,baselineBinding:null,fields:baseline.fields,idempotencyKey:'synthetic-req-wrong-binding'});assert.equal(wrong.status,409);assert.equal(wrong.error,'REQUIREMENT_BASELINE_CONFLICT');
  const overlay=await call(c.client,'updateRequirement',{id:baseline.id,expectedRevision:0,baselineBinding:baseline.baselineBinding,fields:{...baseline.fields,title:'Synthetic overlay'},idempotencyKey:'synthetic-req-overlay'});assert.equal(overlay.verification.verified,true,JSON.stringify(overlay));assert.equal(overlay.data.entry.revision,1);
 }finally{await c.close();f.close();}
});

for(const denial of ['revoked','expired','readOnly','foreign','changedFingerprint','fenced'] as const)test(`fresh API authority rejects ${denial} after discovery and blocks identical unknown recovery`,async()=>{
 const f=fixture();let c=await f.connect();try{
  const args={fields:todoFields,idempotencyKey:'synthetic-unknown-'+denial};
  f.state.loseWrite=true;const unknown=await call(c.client,'createTodo',args);assert.equal(unknown.outcome,'unknown',JSON.stringify(unknown));assert.equal(f.repository.rows.size,1);
  await c.close();c=await f.connect();await discover(c.client);
  if(denial==='changedFingerprint')f.state.changedFingerprint=true;
  else f.beforeBusiness(()=>{if(denial==='fenced')f.state.fenced=false;else f.state[denial]=true;});
  const before=f.repository.historyRows.length,recovered=await call(c.client,'createTodo',args);assert.equal(recovered.ok,false,denial+JSON.stringify(recovered));assert.equal(f.repository.historyRows.length,before);
  assert.ok(writes(f).every(write=>write.key===args.idempotencyKey));
 }finally{await c.close();f.close();}
});

for(const cancel of [false,true])test(`${cancel?'cancelled':'lost'} committed HTTP write restores original envelope and key, then settled recovery writes zero`,async()=>{
 const f=fixture();let c=await f.connect();try{
  const args={fields:todoFields,idempotencyKey:'synthetic-committed-'+cancel};if(cancel)f.state.cancelAfterCommit=true;else f.state.loseWrite=true;
  const unknown=await call(c.client,'createTodo',args);assert.equal(unknown.outcome,'unknown',JSON.stringify(unknown));assert.equal(f.repository.rows.size,1);assert.ok(unknown.recovery.requestId);
  const original=f.envelopes.find(e=>JSON.parse(e).params?.arguments?.operationId==='createTodo');
  await c.close();c=await f.connect();
  const changed=await call(c.client,'createTodo',{...args,fields:{...todoFields,title:'Different command'}});assert.equal(changed.error,'ORIGINAL_COMMAND_REQUIRED');
  const recovered=await call(c.client,'createTodo',args);assert.equal(recovered.ok,true,JSON.stringify(recovered));assert.equal(recovered.data.duplicate,true);assert.equal(recovered.verification.verified,true);assert.equal(f.repository.historyRows.length,1);
  const commands=f.envelopes.filter(e=>JSON.parse(e).params?.arguments?.operationId==='createTodo');assert.deepEqual(commands,[original,original]);
  const before=writes(f).length;await call(c.client,'createTodo',args);assert.equal(writes(f).length,before);
 }finally{await c.close();f.close();}
});

test('server receipt with unavailable local GET remains confirmed and later revision is independent',async()=>{
 const f=fixture(),c=await f.connect();try{
  f.state.failLocalGet=true;const created=await create(c.client);assert.equal(created.ok,true,JSON.stringify(created));assert.equal(created.serverVerification.verified,true);assert.equal(created.verification.state,'READBACK_UNAVAILABLE');assert.equal(created.outcome,undefined);
  f.state.failLocalGet=false;const entry=created.data.entry;
  const later=await call(c.client,'updateTodo',{id:entry.id,expectedRevision:1,fields:{...todoFields,status:'done',personal:null},idempotencyKey:'synthetic-later'});assert.equal(later.ok,true,JSON.stringify(later));
  const before=writes(f).length,replay=await create(c.client);assert.equal(replay.data.entry.revision,1);assert.equal(replay.readback.data.revision,2);assert.equal(replay.verification.state,'LATER_REVISION');assert.equal(writes(f).length,before);
 }finally{await c.close();f.close();}
});

test('closed entry ignores secret-like environment and attempts no credential, directory, process or network access',()=>{
 const directory=mkdtempSync(join(tmpdir(),'lifeos-closed-guard-'));
 try{
  const guard=join(directory,'guard.cjs');
  // Permit only Node's own source-loading reads. Any runtime facility use fails loudly.
  writeFileSync(guard,"const fs=require('node:fs');const entry=process.argv[1];for(const key of ['readFileSync','openSync']){const original=fs[key];fs[key]=function(path,...args){if((path instanceof URL?require('node:url').fileURLToPath(path):String(path))!==entry)throw Error('FORBIDDEN_RUNTIME_READ');return original.call(this,path,...args)}};for(const key of ['readFile','readdir','readdirSync','mkdir','mkdirSync'])fs[key]=()=>{throw Error('FORBIDDEN_RUNTIME_IO')};for(const key of ['readFile','readdir','open'])fs.promises[key]=()=>{throw Error('FORBIDDEN_RUNTIME_IO')};require('node:module').syncBuiltinESMExports();for(const name of ['http','https','net','tls','child_process']){const m=require('node:'+name);for(const key of ['request','get','connect','createConnection','spawn','exec','execFile','execFileSync'])if(key in m)m[key]=()=>{throw Error('FORBIDDEN_RUNTIME_ACCESS')}};global.fetch=()=>{throw Error('FORBIDDEN_RUNTIME_FETCH')};");
  for(const env of [{},{LIFEOS_MCP_KEY:token,LIFEOS_MCP_STORE:'/nonexistent/private-store',LIFEOS_MCP_BROKER:'/nonexistent/broker',LIFEOS_MCP_ORIGIN:'https://evil.invalid'}]){
   const child=spawnSync(process.execPath,['--require',guard,resolve('scripts/lifeos-server-mcp-durable.ts')],{env:{NODE_ENV:'test',PATH:process.env.PATH,...env},encoding:'utf8'});
   assert.equal(child.status,1,child.stderr);assert.equal(child.stdout,'');assert.equal(child.stderr,'MCP_DURABLE_RUNTIME_NOT_ADOPTED\n');
  }
 }finally{rmSync(directory,{recursive:true,force:true});}
});
