import assert from 'node:assert/strict';
import test from 'node:test';
import {createAgentHandler} from '../src/agent-api/http.ts';
import {MemoryPort} from './helpers/platform.ts';
import {agentOperations} from '../src/agent-api/capabilities.ts';
import {LifeOSApiClient} from '../src/mcp-candidate/client.ts';
import {parseMcpRuntimeConfig} from '../src/mcp-candidate/config.ts';
import {DurableStore} from '../src/mcp-candidate/native-store.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const origin='https://fixture.example.invalid';
const key='synthetic-secret-lure';
const fields={title:'Synthetic task',notes:'Preserve',dueOn:null,status:'open'};
function fixture(){
 const repository=new MemoryPort();
 let scopes: ('todo:read'|'todo:write')[]=['todo:read','todo:write'];
 let available=true;
 const grant=()=>({grantId:'fixture-grant',ownerId:'fixture-owner',spaceId:'fixture-space',scopes});
 const handler=createAgentHandler({enabled:true,config:{ownerId:'fixture-owner',ownerEmail:'fixture@example.invalid',spaceId:'fixture-space',baseURL:origin,databaseName:'fixture',allowedTypes:['todo'],approval:'personal-manual-v1'},repository,verify:async k=>k===key?grant():null,readCurrentGrant:async()=>grant(),operationAvailable:()=>available,assertWritable:async()=>{}});
 const requests:Request[]=[];
 const client=new LifeOSApiClient({origin,credentialProvider:async()=>key},async(input,init)=>{
  const request=new Request(input,init); requests.push(request);
  const url=new URL(request.url);url.pathname=url.pathname.replace('/api/platform/agent','');
  const forwarded=new Request(url,request);forwarded.headers.set("host",url.host);return handler(forwarded);
 });
 return{client,repository,requests,revoke:()=>{scopes=['todo:read'];},disable:()=>{available=false;}};
}
test('MCP uses existing authorized API for reads, writes and same-key replay',async()=>{
 const f=fixture();assert.ok((await f.client.discover()).operations.some(o=>o.id==='createTodo'));
 const args={fields,idempotencyKey:'fixture-create-0001'};
 const first=await f.client.execute('createTodo',args),second=await f.client.execute('createTodo',args);
 assert.equal(first.status,201);assert.equal(second.status,200);assert.equal(second.data?.duplicate,true);
 assert.equal(f.repository.rows.size,1);
 const read=await f.client.execute('listTodos',{});assert.equal(read.ok,true);
 assert.equal(f.requests.every(r=>r.headers.get('authorization')==='Bearer '+key&&r.redirect==='manual'&&r.credentials==='omit'),true);
});
test('each call rediscovers revoked scopes and disabled modules',async()=>{
 const f=fixture();await f.client.discover();f.revoke();
 assert.equal((await f.client.execute('createTodo',{fields,idempotencyKey:'fixture-denied-001'})).error,'OPERATION_UNAVAILABLE');
 assert.equal(f.repository.rows.size,0);f.disable();
 assert.equal((await f.client.execute('listTodos',{})).error,'OPERATION_UNAVAILABLE');
});
test('catalog cannot supply arbitrary routes, methods or new operations',async()=>{
 const client=new LifeOSApiClient({origin,credentialProvider:async()=>key},async()=>Response.json({apiVersion:'2',operations:[{...agentOperations.find(o=>o.id==='listTodos'),path:'https://evil.invalid'}, {id:'ownerApprove',method:'POST',path:'/approve'}]}));
 await assert.rejects(client.discover(),/API_CONTRACT_MISMATCH/);
 assert.equal((await client.execute('ownerApprove',{})).error,'OPERATION_UNAVAILABLE');
});
test('identity and raw URL injection fail before a business request',async()=>{
 const f=fixture();for(const args of [{ownerId:'foreign'},{url:'https://evil.invalid'},{key},{cookie:'x'}])assert.equal((await f.client.execute('listTodos',args)).ok,false);
 assert.equal(f.requests.filter(r=>new URL(r.url).pathname.endsWith('/todos')).length,0);
 assert.equal((await f.client.execute('getTodo',{id:'../../evil'})).ok,false);
});
test('v2 failures never downgrade or probe another catalog',async()=>{
 for(const status of [401,403,404,503]){let calls=0;const c=new LifeOSApiClient({origin,credentialProvider:async()=>key},async()=>{calls++;return Response.json({error:'AUTH_REQUIRED'},{status});});await assert.rejects(c.discover());assert.equal(calls,1);}
});
test('malformed and oversized responses fail wholly; write outcome remains unknown without retry',async()=>{
 for(const response of [()=>new Response(new Uint8Array([0xff])),()=>new Response('x'.repeat(8*1024*1024+1)),()=>new Response('{'),()=>{throw Error(key);}]){
  let calls=0;const c=new LifeOSApiClient({origin,credentialProvider:async()=>key},async()=>{calls++;return calls===1?Response.json({apiVersion:'2',operations:agentOperations}):response();});
  const result=await c.execute('createTodo',{fields,idempotencyKey:'fixture-unknown-01'});
  assert.equal(result.ok,false);assert.equal(result.outcome,'unknown');assert.equal(calls,2);assert.equal(result.readback,undefined);assert.equal(JSON.stringify(result).includes(key),false);
 }
});
test('configuration accepts an exact HTTPS origin without credential fields',()=>{
 assert.deepEqual(parseMcpRuntimeConfig({origin}),{origin});
 for(const value of [{origin:'http://fixture.invalid'},{origin:origin+'/'},{origin:origin+'/path'},{origin:'https://user:password@fixture.invalid'},{origin,key},{origin,ownerId:'foreign'},{}])assert.throws(()=>parseMcpRuntimeConfig(value));
});

test('classification preview stays read-only and approved commit preserves API receipt and replay',async()=>{
 const {fixture:classificationFixture}=await import('./helpers/classification-service-fixture.ts');
 const {ClassificationService}=await import('../src/personal-candidate/classification-service.ts');
 for(const write of [false,true]){
  const f=await classificationFixture(write),now=Date.now();f.setNow(now);
  const directory=mkdtempSync(join(tmpdir(),'lifeos-mcp-classification-'));
  try{
  const config={ownerId:f.owner.ownerId,spaceId:f.owner.spaceId,ownerEmail:'fixture@example.invalid',databaseName:'fixture',approval:'personal-manual-v1',baseURL:origin,allowedTypes:['todo','project','domain','topic']} as const;
  const grant={grantId:f.agent.grantId,ownerId:f.agent.ownerId,spaceId:f.agent.spaceId,scopes:f.agent.scopes,authorizationRevision:'a'.repeat(64)};
  let available=true,withdrawAfterDiscovery=false;
  const handler=createAgentHandler({enabled:true,mountPath:'/api/platform/agent',modules:{organization:true,classification:true},fenceWrites:true,config,repository:f.port,verify:async()=>grant,readCurrentGrant:async()=>grant,operationAvailable:()=>available,assertWritable:async()=>{},classification:authority=>new ClassificationService(f.port,config,{authority,assertReady:async()=>{},assertWritable:async()=>{},policyRevision:()=> 'policy-v1',now:()=>now})});
  const client=new LifeOSApiClient({origin,credentialProvider:async()=>key,durable:new DurableStore(directory,'a'.repeat(64))},async(input,init)=>{const r=new Request(input,init);r.headers.set('host',new URL(r.url).host);const response=await handler(r);if(withdrawAfterDiscovery)available=false;return response;});
  const preview=await client.execute('previewTodoClassification',{changes:f.changes});assert.equal(preview.status,200);
  assert.equal(f.port.classificationReceipts.size,0);assert.ok(f.todos.every(todo=>f.port.rows.get(todo.id)?.revision===1));
  const confirmation={planId:preview.data!.planId,digest:preview.data!.digest,confirmed:true};
  const args={...confirmation,idempotencyKey:'classification-command'};
  assert.equal((await client.execute('commitTodoClassification',args)).status,403);
  await f.service.approve(f.owner,confirmation);
  const attempted=await client.execute('commitTodoClassification',args);
  const committed=attempted.error==='RECOVERY_REQUIRED'?await client.retry(attempted.recovery!.requestId):attempted;
  if(write){assert.equal(committed.status,200,JSON.stringify(committed));assert.equal(committed.data?.duplicate,false);assert.equal(committed.verification?.verified,true);const repeat=await client.execute('commitTodoClassification',args);assert.equal(repeat.error,'RECOVERY_REQUIRED');const replay=await client.retry(repeat.recovery!.requestId);assert.deepEqual(replay.data?.entries,committed.data?.entries);assert.equal(replay.verification?.verified,true);assert.equal(f.port.classificationReceipts.size,1);}
  else{assert.equal(committed.status,403);assert.equal(f.port.classificationReceipts.size,0);}
  withdrawAfterDiscovery=true;const unavailable=await client.execute('previewTodoClassification',{changes:f.changes});assert.equal(unavailable.status,503);
  }finally{rmSync(directory,{recursive:true,force:true});}
 }
});

test('canonical parsers reject invalid bodies before sending a write',async()=>{
 const f=fixture();
 for(const args of [{fields:{...fields,title:'x'.repeat(241)},idempotencyKey:'valid-key-01'},{fields,idempotencyKey:'short'},{fields:{...fields,ownerId:'foreign'},idempotencyKey:'valid-key-01'},{fields:{...fields,notes:'x'.repeat(16384)},idempotencyKey:'valid-key-01',id:'injected'}])assert.equal((await f.client.execute('createTodo',args)).ok,false);
 assert.equal(f.repository.rows.size,0);assert.equal(f.requests.some(r=>r.method==='POST'),false);
});

test('canonical-valid classification exceeds the request byte cap only after its JSON wrapper',async()=>{
 const {decodeChanges}=await import('../src/personal-candidate/classification-contracts.ts');
 const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
 // 100 changes with 8 topics each occupy 106201 bytes. Another 228 references
 // add 24852 bytes; two ten-digit revisions add 18. The array is still valid,
 // but its 12-byte {changes:...} JSON wrapper crosses the HTTP request limit.
 const changes=Array.from({length:100},(_,i)=>({
  todo:{id:id(i+1),sourceId:id(i+101),expectedRevision:i<2?2147483647:1},before:null,
  after:{project:null,domain:null,topics:Array.from({length:i<19?20:8},(_,j)=>({id:id(j+200),sourceId:id(j+10200),revision:1}))},
 }));
 assert.equal(decodeChanges(changes).length,100);
 assert.equal(Buffer.byteLength(JSON.stringify(changes)),131071);
 assert.equal(Buffer.byteLength(JSON.stringify({changes})),131083);
 let businessRequests=0;
 const client=new LifeOSApiClient({origin,credentialProvider:async()=>key},async(input,init)=>{
  const request=new Request(input,init);
  if(request.method!=='GET'){businessRequests++;return Response.json({error:'UNEXPECTED_BUSINESS_REQUEST'},{status:500});}
  return Response.json({apiVersion:'2',operations:agentOperations});
 });
 assert.deepEqual(await client.execute('previewTodoClassification',{changes}),{ok:false,status:400,error:'REQUEST_TOO_LARGE'});
 assert.equal(businessRequests,0);
});

test('redirect is not followed, untrusted API errors cannot echo the configured credential',async()=>{
 let calls=0;const secret='SYNTHETIC_SECRET_LURE';
 const c=new LifeOSApiClient({origin,credentialProvider:async()=>secret},async()=>{calls++;return calls===1?Response.json({apiVersion:'2',operations:agentOperations}):Response.json({error:secret},{status:503});});
 const result=await c.execute('createTodo',{fields,idempotencyKey:'fixture-error-001'});assert.equal(JSON.stringify(result).includes(secret),false);assert.equal(result.outcome,'unknown');assert.equal(calls,2);assert.equal(result.readback,undefined);
 let redirects=0;const redirect=new LifeOSApiClient({origin,credentialProvider:async()=>key},async()=>{redirects++;return new Response(null,{status:302,headers:{location:'https://evil.invalid'}});});
 await assert.rejects(redirect.discover());assert.equal(redirects,1);
});
