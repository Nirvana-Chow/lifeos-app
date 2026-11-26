import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {createAgentHandler} from '../src/agent-api/http.ts';
import {handlePersonalRequest} from '../src/personal-candidate/http.ts';
import {PersonalService} from '../src/personal-candidate/service.ts';
import type {PersonalConfig} from '../src/personal-candidate/config.ts';
import {searchRow} from '../src/personal-search/model.ts';
import {DraftService} from '../src/platform/service.ts';
import {captureLabels,pinnedInboxOrigin,todoCapture} from '../src/todo-provenance/domain.ts';
import {TasksClient} from '../src/tasks-workbench/client.ts';
import {MemoryPort} from './helpers/platform.ts';

test('real HTTP owner and Agent routes preserve independent channel, expression, source and revisions',async t=>{
 const repo=new MemoryPort();repo.readCurrentSnapshot=async owner=>[...repo.rows.values()].filter(row=>row.ownerId===owner);
 const ownerId='synthetic-source-owner',spaceId='synthetic-source-space';
 let baseURL:string, owner:PersonalService, agent:ReturnType<typeof createAgentHandler>;
 const server=createServer(async (incoming,outgoing)=>{
  try{
   const chunks:Buffer[]=[];for await(const chunk of incoming)chunks.push(chunk);
   const request=new Request(baseURL+incoming.url,{method:incoming.method,headers:incoming.headers as Record<string,string>,
    ...(!['GET','HEAD'].includes(incoming.method!)?{body:Buffer.concat(chunks)}:{})});
   let response:Response;
   if(incoming.url?.startsWith('/api/platform/agent/'))response=await agent(request);
   else if(request.headers.get('x-synthetic-owner')!=='yes')response=Response.json({error:'DENIED'},{status:403});
   else response=(await handlePersonalRequest(request,ownerId,baseURL,owner,{assertOwner:async()=>{},assertWritable:async()=>{}}))!;
   outgoing.writeHead(response.status,Object.fromEntries(response.headers));outgoing.end(Buffer.from(await response.arrayBuffer()));
  }catch(error){
   const problem=error as {status?:number;code?:string};outgoing.writeHead(problem.status??500,{'content-type':'application/json'});
   outgoing.end(JSON.stringify({error:problem.code}));
  }
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.close();await once(server,'close');});
 baseURL='http://127.0.0.1:'+(server.address() as AddressInfo).port;
 const config:PersonalConfig={ownerId,spaceId,baseURL,ownerEmail:'synthetic@example.test',approval:'personal-manual-v1',
  databaseName:'lifeos_platform_test_local',allowedTypes:['todo']};
 owner=new PersonalService(repo,config);
 const credential={grantId:'fixture-grant',ownerId,spaceId,scopes:['todo:read','todo:write'] as const};
 agent=createAgentHandler({config,repository:repo,enabled:true,mountPath:'/api/platform/agent',fenceWrites:true,
  operationAvailable:()=>true,assertWritable:async()=>{},readCurrentGrant:async id=>id===credential.grantId?credential:null,
  verify:async token=>token==='synthetic-exact'?credential:token==='synthetic-other'?{...credential,spaceId:'other-source-space'}:null});
 // Use the existing synthetic transaction fence, not an expanded production grant.
 const transaction=repo.transaction.bind(repo);
 repo.transaction=(id,key,run)=>transaction(id,key,tx=>run({...tx,lockAgentTodoWriteGrant:async()=>true}));
 const fields={title:'相同来源测试',notes:'这段文字听起来像口述，但只是同一段内容。',dueOn:null,status:'open'};
 const body={spaceId,confirmed:true,fields};
 const old=await owner.mutate(ownerId,'todo',null,body,'source-legacy-command');
 const webPath='/api/platform/personal/todo',agentPath='/api/platform/agent/v1/todos';
 const send=(path:string,value?:unknown,key='provenance-unused-key',method=value?'POST':'GET',actor='synthetic-exact')=>
  fetch(baseURL+path,{method,headers:{origin:baseURL,'x-synthetic-owner':actor==='synthetic-other'?'no':'yes',
   authorization:'Bearer '+actor,'content-type':'application/json','idempotency-key':key},...(value?{body:JSON.stringify(value)}:{})});
 assert.deepEqual(captureLabels(old.entry.source.original),{channel:'未知',expression:'未知'});
 assert.match(searchRow(old.entry,spaceId,'测试').sourceLabel,/渠道 未知 · 表达 未知/);
 assert.deepEqual((await (await send(webPath,body,'source-legacy-command')).json()).entry,old.entry);
 const web=await send(webPath,{...body,expression:'spoken'},'source-web-command-001');
 assert.equal(web.status,201);
 const created=await web.json();
 const native=await send(agentPath,{fields,expression:'written'},'source-agent-command-01');
 assert.equal(native.status,201);
 const made=await native.json();
 assert.deepEqual(todoCapture(created.entry.source.original),{version:1,channel:'owner-web',expression:'spoken'});
 assert.deepEqual(made.entry.provenance,{version:1,channel:'agent-api',expression:'written'});
 assert.equal(made.entry.fields.notes,created.entry.draft.notes);
 const unknown=await (await send(webPath,body,'source-web-no-expression')).json();
 assert.deepEqual(todoCapture(unknown.entry.source.original),{version:1,channel:'owner-web',expression:null});
 assert.equal((await send(agentPath,{fields,expression:'spoken'},'source-web-command-001')).status,409);
 assert.equal((await send(webPath,{...body,expression:'written'},'source-web-command-001')).status,409);
 assert.equal((await send(webPath,{...body,channel:'agent-api'},'source-forged-channel')).status,400);
 assert.equal((await send(agentPath,{fields,channel:'owner-web'},'source-forged-agent')).status,400);
 assert.equal((await send(webPath+'/'+created.entry.id,{...body,expression:'written',expectedRevision:1},'source-patch-expression','PATCH')).status,400);
 const updated=await (await send(webPath+'/'+created.entry.id,{...body,expectedRevision:1,fields:{...fields,notes:'修订内容'}},'source-edit-command','PATCH')).json();
 assert.deepEqual(updated.entry.source,created.entry.source);
 assert.deepEqual((await (await send(webPath,{...body,expression:'spoken'},'source-web-command-001')).json()).entry,created.entry);
 const history=(await (await send(webPath+'/'+created.entry.id+'/history')).json()).items;
 assert.deepEqual(history.map((row:{revision:number})=>row.revision),[2,1]);
 assert.equal(history[1].draft.notes,fields.notes);
 assert.ok(history.every((row:typeof created.entry)=>JSON.stringify(row.source)===JSON.stringify(created.entry.source)));
 assert.equal((await send(agentPath+'/'+made.entry.id,undefined,'ignored-alternate-key','GET','synthetic-other')).status,403);
 assert.equal((await send(webPath+'/'+created.entry.id,undefined,'ignored-alternate-key','GET','synthetic-other')).status,403);
 const foreign=new PersonalService(repo,{...config,spaceId:'other-source-space'});
 await assert.rejects(foreign.get(ownerId,'todo',created.entry.id),{status:404});
 assert.deepEqual((await (await send(agentPath+'/'+made.entry.id)).json()).provenance,made.entry.provenance);
 const capabilities=await (await send('/api/platform/agent/v2/capabilities')).json();
 assert.match(capabilities.operations.find((op:{id:string})=>op.id==='createTodo').description,/explicit expression/);
});

test('derived tasks resolve only the original inbox ID, source and pinned revision',async()=>{
 const repo=new MemoryPort(),service=new DraftService(repo),owner='source-fixture-owner';
 const inbox=await service.mutate(owner,'inbox',null,{title:'原始材料',text:'初始原件正文',occurredOn:null,disposition:'pending'},'source-inbox-command');
 const derived=await service.createTodoFromInbox(owner,inbox.entry.id,{expectedRevision:1},'source-derived-command');
 const pin=pinnedInboxOrigin(derived.entry.source.original,derived.entry.inboxId)!;
 assert.deepEqual(pin,{id:inbox.entry.id,sourceId:inbox.entry.source.id,revision:1});
 assert.deepEqual(captureLabels(derived.entry.source.original),{channel:'未知',expression:'未知'});
 const history=await service.history(owner,'inbox',inbox.entry.id);
 const client=new TasksClient(async input=>{
  assert.equal(input,'/api/platform/inbox/'+inbox.entry.id+'/history');
  return Response.json({history});
 });
 assert.equal(await client.originalInbox(pin),'初始原件正文');
 await assert.rejects(client.originalInbox({...pin,sourceId:derived.entry.source.id}));
 const retry=await service.createTodoFromInbox(owner,inbox.entry.id,{expectedRevision:1},'source-derived-command');
 assert.deepEqual(retry.entry.source,derived.entry.source);
});
