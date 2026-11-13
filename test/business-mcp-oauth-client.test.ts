import test from 'node:test';import assert from 'node:assert/strict';
import {LifeOSApiClient}from'../src/mcp-candidate/client.ts';import {HttpBusinessClient}from'../src/mcp-http/business-client.ts';
import {createAgentHandler}from'../src/agent-api/http.ts';import {MemoryPort}from'./helpers/platform.ts';
const origin='https://lifeos.nirvanachow.com',jwt='synthetic.signed.token';
test('the shared client defaults to the original API key grammar and explicit OAuth rejects malformed/oversized tokens without sending',async()=>{
 for(const [format,tokens]of [[undefined,[jwt,'x'.repeat(257)]],['business-oauth-jwt',['a..b','a.b.c.d','a.b.c=','x'.repeat(8192)+'.b.c']]] as const){
  for(const token of tokens){let sent=0;const client=new LifeOSApiClient({origin,credentialFormat:format,credentialProvider:async()=>token},async()=>{sent++;return Response.json({});});await assert.rejects(client.discover());assert.equal(sent,0);}
 }
});
test('the actual HTTP business client carries explicit OAuth through native discovery, CRUD, receipt/readback and current revocation',async()=>{
 const repository=new MemoryPort(),tx=repository.transaction.bind(repository);let active=true;
 repository.transaction=(owner,key,run)=>tx(owner,key,transaction=>run({...transaction,lockOAuthAgentGrant:async()=>active}));repository.readCurrentSnapshot=async()=>structuredClone([...repository.rows.values()]);
 const grant={grantId:'grant',ownerId:'owner',spaceId:'space',scopes:['todo:read','todo:write'] as const,allowedOperationIds:['listTodos','snapshotTodos','getTodo','createTodo','updateTodo'],oauthFence:{tokenId:'a'.repeat(64),bindingId:'binding',bindingRevision:1,expiresAt:2000000000}};
 const handler=createAgentHandler({enabled:true,mountPath:'/api/platform/agent',fenceWrites:true,config:{ownerId:'owner',spaceId:'space',ownerEmail:'fixture@example.invalid',baseURL:origin,databaseName:'fixture',approval:'personal-manual-v1',allowedTypes:['todo']},repository,verify:async token=>active&&token===jwt?grant:null,readCurrentGrant:async()=>active?grant:null,operationAvailable:()=>true,assertWritable:async()=>{}});
 const client=new HttpBusinessClient(origin,jwt,handler,new AbortController().signal);
 assert.equal((await client.discover()).operations.some(op=>op.id==='createTodo'),true);
 const fields={title:'Synthetic OAuth client task',notes:'',dueOn:null,status:'open'},created=await client.execute('createTodo',{fields,idempotencyKey:'oauth-client-create'});assert.equal(created.ok,true,JSON.stringify({status:created.status,error:created.error,outcome:created.outcome}));assert.equal(created.verification?.verified,true);
 const entry=(created.data as {entry:{id:string;revision:number}}).entry;
 const updated=await client.execute('updateTodo',{id:entry.id,expectedRevision:entry.revision,fields:{...fields,title:'Updated OAuth client task',personal:null},idempotencyKey:'oauth-client-update'});assert.equal(updated.ok,true,JSON.stringify({status:updated.status,error:updated.error,outcome:updated.outcome}));assert.equal(updated.verification?.verified,true);
 active=false;await assert.rejects(client.discover());assert.equal((await client.execute('createTodo',{fields,idempotencyKey:'oauth-client-revoked'})).ok,false);
});
