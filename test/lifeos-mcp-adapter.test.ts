import assert from 'node:assert/strict';
import test from 'node:test';
import {agentOperations} from '../src/agent-api/capabilities.ts';
import {parseArguments} from '../src/mcp-candidate/schemas.ts';
import {LifeOSApiClient} from '../src/mcp-candidate/client.ts';
const secret='synthetic-injected-credential';
const operation=(id:string)=>agentOperations.find(op=>op.id===id)!;
const requirement={title:'Synthetic requirement',body:'Purpose',phaseId:'now',priority:'P1',plannedStartOn:null,plannedEndOn:null,workflow:{state:'planned',purpose:'record',nextStep:'review'}};
// A wrong legacy UUID-only binding or omitted baseline/workflow would break the actual owner API contract.
test('requirements accept stable LO identity, public revision zero and exact baseline-bound body',()=>{
 const binding={baselineVersion:'synthetic-v1',itemVersion:1,digest:'a'.repeat(64)};
 const args={id:'LO-REQ-001',expectedRevision:0,baselineBinding:binding,fields:requirement,idempotencyKey:'synthetic-req-update'};
 const result=parseArguments(operation('updateRequirement'),args);
 assert.deepEqual(result,{path:'/v1/requirements/LO-REQ-001',body:{expectedRevision:0,baselineBinding:binding,fields:requirement},key:'synthetic-req-update'});
});
// The same record wire shape must reach the native writer, never organization normalization.
test('journal and finance use their existing complete native schemas',()=>{
 for(const [id,fields] of [
  ['createJournal',{title:'Synthetic journal',text:'Body',occurredOn:null,personal:null}],
  ['createFinance',{kind:'expense',amountMinor:123,currency:'CNY',occurredOn:'2026-11-05',category:null,fromAccountRef:null,toAccountRef:null,originalEntryId:null,notes:'Synthetic'}],
  ['createFeedback',{title:'Synthetic feedback',text:'Feedback',sourceLabel:null}],
 ] as const){const out=parseArguments(operation(id),{fields,idempotencyKey:'synthetic-'+id});assert.deepEqual(out.body,{fields});}
});
// A remote response URL must never turn the fixed origin into an arbitrary resource.
test('rejects off-origin responses and stops at v2 denial without downgrade',async()=>{
 let calls=0;
 const moved=new LifeOSApiClient({origin:'https://fixture.invalid',credentialProvider:async()=>secret},async()=>{calls++;const r=Response.json({apiVersion:'2',operations:agentOperations});Object.defineProperty(r,'url',{value:'https://evil.invalid/api/platform/agent/v2/capabilities'});return r;});
 await assert.rejects(moved.discover(),/API_ORIGIN_REJECTED/);assert.equal(calls,1);
 for(const status of [401,403,404]){calls=0;const c=new LifeOSApiClient({origin:'https://fixture.invalid',credentialProvider:async()=>secret},async()=>{calls++;return Response.json({error:'DENIED'},{status});});await assert.rejects(c.discover());assert.equal(calls,1);}
});
// A write may have committed before the connection is lost. Only its exact frozen command can be retried.
test('unknown writes retain exact original bytes, independently GET and stop retry after revocation',async()=>{
 let lost=true,revoked=false;const writes:{body:string;key:string|null}[]=[];const reads:string[]=[];
 let entry={id:'00000000-0000-4000-8000-000000000001',sourceId:'00000000-0000-4000-8000-000000000002',revision:1,fields:{title:'Synthetic',notes:'',dueOn:null,status:'open',personal:null}};
 const client=new LifeOSApiClient({origin:'https://fixture.invalid',credentialProvider:async()=>secret},async(url,init)=>{
  const path=new URL(String(url)).pathname;
  if(revoked)return Response.json({error:'ACCESS_DENIED'},{status:403});
  if(path.endsWith('/v2/capabilities'))return Response.json({apiVersion:'2',operations:agentOperations});
  if(init?.method==='POST'){writes.push({body:String(init.body),key:new Headers(init.headers).get('idempotency-key')});entry={...entry,fields:{...JSON.parse(String(init.body)).fields,personal:null}};if(lost){lost=false;throw Error(secret);}return Response.json({entry,duplicate:true});}
  reads.push(path);return Response.json(entry);
 });
 const args={fields:{title:'Synthetic',notes:'',dueOn:null,status:'open'},idempotencyKey:'synthetic-exact-retry'};
 const result=await client.execute('createTodo',args);assert.equal(result.outcome,'unknown');
 assert.equal(JSON.stringify(result).includes(secret),false);assert.equal(reads.length,0);assert.equal(result.readback,undefined);
 assert.ok(result.recovery?.requestId);args.fields.title='Mutated by caller';
 const retry=await client.retry(result.recovery.requestId);assert.equal(retry.ok,true);assert.equal(retry.verification?.verified,true);assert.ok(reads.includes('/api/platform/agent/v1/todos/'+entry.id));assert.equal(writes.length,2);assert.deepEqual(writes[1],writes[0]);
 const another=await client.execute('createTodo',{...args,idempotencyKey:'synthetic-other-key'});assert.equal(another.ok,true);
 lost=true;const unknown=await client.execute('createTodo',{...args,idempotencyKey:'synthetic-revocation'});assert.equal(unknown.outcome,'unknown');
 revoked=true;const denied=await client.retry(unknown.recovery!.requestId);assert.equal(denied.status,403);assert.equal(writes.length,4);assert.equal(denied.outcome,'unknown');
});
test('current catalog rejects duplicate, altered scopes, protected and unsupported operations',async()=>{
 const list=operation('listTodos');const client=new LifeOSApiClient({origin:'https://fixture.invalid',credentialProvider:async()=>secret},async()=>Response.json({apiVersion:'2',operations:[list,list,{...operation('createTodo'),requiredScopes:['todo:read']},{id:'approveTodoClassification',method:'POST',path:'/v1/todo-classifications/approve',requiredScopes:['todo:read']},{id:'rotateKey',method:'POST',path:'/v1/keys',requiredScopes:['key:write']},{id:'futureUnreviewed',method:'GET',path:'/v1/records/future/snapshot',requiredScopes:['future:read']}]}));
 await assert.rejects(client.discover(),/API_CATALOG_INVALID/);assert.equal((await client.execute('rotateKey',{})).status,403);assert.equal((await client.execute('futureUnreviewed',{})).status,403);
});
test('trusted before-use runs before discovery; failed or missing provider causes no API request',async()=>{
 const calls:string[]=[];let deny=false;
 const client=new LifeOSApiClient({origin:'https://fixture.invalid',beforeUse:async()=>{calls.push('update');if(deny)throw Error(secret);},credentialProvider:async()=>{calls.push('credential');return secret;}},async()=>{calls.push('http');return Response.json({apiVersion:'2',operations:[operation('listTodos')]});});
 await client.discover();assert.deepEqual(calls,['update','credential','http']);deny=true;const fail=await client.execute('listTodos',{});assert.deepEqual(fail,{ok:false,status:0,error:'MCP_BEFORE_USE_FAILED'});assert.deepEqual(calls,['update','credential','http','update']);
 let network=0;const closed=new LifeOSApiClient({origin:'https://fixture.invalid',credentialProvider:async()=>null},async()=>{network++;throw Error('must not fetch');});assert.equal((await closed.execute('listTodos',{})).status,401);assert.equal(network,0);
});
test('server echo of the credential, including JSON escapes, never reaches data or error output',async()=>{
 for(const raw of [JSON.stringify({error:secret}),'{"error":"'+Array.from(secret).map(c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')).join('')+'"}']){
  const client=new LifeOSApiClient({origin:'https://fixture.invalid',credentialProvider:async()=>secret},async()=>new Response(raw,{status:503}));const value=await client.execute('listTodos',{});assert.equal(JSON.stringify(value).includes(secret),false);assert.equal(value.error,'API_RESPONSE_INVALID');
 }
});
test('401 and 403 write responses stop even with malformed JSON; no readback or downgraded probe follows',async()=>{
 for(const status of [401,403]){let calls=0;const client=new LifeOSApiClient({origin:'https://fixture.invalid',credentialProvider:async()=>secret},async()=>++calls===1?Response.json({apiVersion:'2',operations:agentOperations}):new Response('{broken',{status}));const result=await client.execute('createTodo',{fields:{title:'Synthetic'},idempotencyKey:'synthetic-auth-stop'});assert.equal(result.status,status);assert.equal(result.outcome,undefined);assert.equal(calls,2);}
});
