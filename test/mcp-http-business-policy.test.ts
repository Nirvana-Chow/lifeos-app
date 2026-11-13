import assert from 'node:assert/strict';
import test from 'node:test';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {agentOperations,agentEventTransports} from '../src/agent-api/capabilities.ts';
import {HttpBusinessClient,inProcessApiFetch} from '../src/mcp-http/business-client.ts';
import {createMcpHttpHandler} from '../src/mcp-http/handler.ts';

const origin='https://lifeos.nirvanachow.com',mount='/api/platform/agent',token='synthetic-business-policy';
const id='00000000-0000-4000-8000-000000000001',sourceId='00000000-0000-4000-8000-000000000002';
const lease={id:'00000000-0000-4000-8000-000000000003',requirementId:id,sourceId,revision:1,workDigest:'a'.repeat(64),holderId:'synthetic-holder',grantId:'synthetic-grant',fence:1,expiresAt:2000000000000};
const requirementFields={title:'Synthetic business-only requirement',body:'Not an execution request',phaseId:'p1',priority:'P2',plannedStartOn:null,plannedEndOn:null};
const executionCalls=[
 {label:'claim',operationId:'claimRequirementExecution',args:{requirementId:id,workDigest:lease.workDigest,holderId:lease.holderId,idempotencyKey:'synthetic-denied-claim'}},
 {label:'admit',operationId:'claimRequirementExecution',args:{action:'admit',requirementId:id,sourceId,expectedRevision:1,workDigest:lease.workDigest,idempotencyKey:'synthetic-denied-admit'}},
 {label:'renew',operationId:'updateRequirementExecution',args:{id:lease.id,action:'renew',lease,idempotencyKey:'synthetic-denied-renew'}},
 {label:'progress',operationId:'updateRequirementExecution',args:{id:lease.id,action:'progress',lease,input:{fields:requirementFields,expectedRevision:1,baselineBinding:null},idempotencyKey:'synthetic-denied-progress'}},
];
const allowedIds=[
 'listTodos','snapshotTodos','getTodo','createTodo','updateTodo',
 'snapshotOrganization','getOrganization','createOrganization','updateOrganization',
 'snapshotRequirements','getRequirement','createRequirement','updateRequirement',
 'snapshotStorageReviews','getStorageReview','createStorageReview','updateStorageReviewChecklist','updateStorageReviewDecision',
 'snapshotFeedback','getFeedback','createFeedback',
 'snapshotJournal','getJournal','createJournal','updateJournal',
 'snapshotCalendar','getCalendar','createCalendar','updateCalendar',
 'snapshotHealth','getHealth','createHealth','updateHealth',
 'snapshotPerson','getPerson','createPerson','updatePerson',
 'snapshotFinance','getFinance','createFinance','updateFinance',
 'snapshotMedia','getMedia','createMedia','updateMedia',
 'snapshotCareer','getCareer','createCareer','updateCareer',
 'snapshotPortfolio','getPortfolio','createPortfolio','updatePortfolio',
 'snapshotCooking','getCooking','createCooking','updateCooking',
 'previewTodoClassification',
];

function broadCatalog(){
 let requests=0,engineRequests=0;
 const requirement=agentOperations.find(operation=>operation.id==='createRequirement')!;
 const dispatch=async(request:Request)=>{
  requests++;
  const path=new URL(request.url).pathname;
  if(path===mount+'/v2/capabilities'){
   assert.equal(request.method,'GET');
   // The real API can advertise separately authorized execution with the same
   // requirements scopes/policyClass. Future descriptors are untrusted data.
   return Response.json({apiVersion:'2',operations:[...agentOperations,
    ...['launchCodingAgent','deployProduction','manageApiKeys','unreviewedBusinessWrite'].map(id=>({...requirement,id})),
   ],eventTransports:agentEventTransports});
  }
  assert.ok(path.startsWith(mount+'/v1/requirement-events/'),path);
  engineRequests++;
  return Response.json({error:'SYNTHETIC_ENGINE_REACHED'},{status:503});
 };
 return{dispatch,requests:()=>requests,engineRequests:()=>engineRequests};
}

test('business discovery excludes execution and transport authority from a broad reviewed API catalog',async()=>{
 const f=broadCatalog(),client=new HttpBusinessClient(origin,token,f.dispatch,new AbortController().signal);
 const catalog=await client.discover();
 assert.deepEqual(catalog.operations.map(operation=>operation.id).sort(),[...allowedIds].sort());
 assert.equal('eventTransports'in catalog,false);
 assert.equal(f.engineRequests(),0);
});

for(const {label,operationId,args} of executionCalls)test(`business MCP rejects ${label} before any API discovery or execution dispatch`,async()=>{
 const f=broadCatalog(),client=new HttpBusinessClient(origin,token,f.dispatch,new AbortController().signal);
 const result=await client.execute(operationId,args);
 assert.equal(f.engineRequests(),0,'an engineering operation must never reach the dispatcher');
 assert.deepEqual(result,{ok:false,status:403,error:'OPERATION_UNAVAILABLE'});
 assert.equal(f.requests(),0,'a denied operation needs neither discovery nor an execution request');
});

for(const operationId of ['commitTodoClassification','streamRequirementEvents','launchCodingAgent','deployProduction','manageApiKeys','unreviewedBusinessWrite'])test(`business MCP leaves ${operationId} unavailable without dispatch`,async()=>{
 const f=broadCatalog(),client=new HttpBusinessClient(origin,token,f.dispatch,new AbortController().signal);
 const result=await client.execute(operationId,{});
 assert.deepEqual(result,{ok:false,status:403,error:'OPERATION_UNAVAILABLE'});
 assert.equal(f.requests(),0);
});

test('official HTTP tools and raw calls share the business policy even when execution scopes overlap',async t=>{
 const f=broadCatalog(),handler=createMcpHttpHandler({enabled:true,origin,dispatch:f.dispatch});
 const client=new Client({name:'synthetic-business-policy-client',version:'1'},{versionNegotiation:{mode:{pin:'2026-07-28'}}});
 await client.connect(new StreamableHTTPClientTransport(new URL(origin+'/api/platform/mcp'),{requestInit:{headers:{authorization:'Bearer '+token}},fetch:async(input,init)=>{
  const request=new Request(input,init);request.headers.set('host',new URL(origin).host);return handler(request);
 }}));
 t.after(()=>client.close());
 const tools=await client.listTools();
 const branches=(tools.tools.find(tool=>tool.name==='lifeos_call')!.inputSchema as any).oneOf;
 assert.deepEqual(branches.map((branch:any)=>branch.properties.operationId.const).sort(),[...allowedIds].sort());
 const selected=await client.callTool({name:'lifeos_discover',arguments:{operationId:'claimRequirementExecution'}});
 assert.deepEqual(selected.structuredContent,{ok:false,status:403,error:'OPERATION_UNAVAILABLE'});
 for(const {operationId,args} of executionCalls){
  const result=await client.callTool({name:'lifeos_call',arguments:{operationId,arguments:args}});
  assert.deepEqual(result.structuredContent,{ok:false,status:403,error:'OPERATION_UNAVAILABLE'});
 }
 assert.equal(f.engineRequests(),0);
});

const deniedRoutes=[
 ['POST','/v1/requirement-events/claims'],['PATCH','/v1/requirement-events/claims/'+lease.id],['GET','/v1/requirement-events/stream'],
 ['POST','/v1/todo-classifications/commit'],['POST','/v1/coding-agents/launch'],['POST','/v1/deployments'],
 ['GET','/v1/account/api-keys'],['POST','/v1/auth/sign-out'],['GET','/v1/capabilities'],
 ['POST','/v2/capabilities'],['GET','/v1/organization/account/'+id],['GET','/v1/records/unreviewed/snapshot'],
] as const;
for(const [method,path] of deniedRoutes)test(`the in-process business route boundary rejects ${method} ${path} before dispatch`,async()=>{
 let dispatched=0;
 const transport=inProcessApiFetch(origin,token,async()=>{dispatched++;return Response.json({});},new AbortController().signal);
 await assert.rejects(transport(origin+mount+path,{method,headers:{authorization:'Bearer '+token}}),/API_TARGET_REJECTED/);
 assert.equal(dispatched,0);
});

test('the route boundary retains reviewed business methods, record types, original IDs and internal v2 discovery',async()=>{
 const routes=[
  ['GET','/v2/capabilities'],['GET','/v1/todos'],['GET','/v1/todos/snapshot'],['GET','/v1/todos/'+id],['POST','/v1/todos'],['PATCH','/v1/todos/'+id],
  ['GET','/v1/organization/snapshot'],['GET','/v1/organization/project/'+id],['POST','/v1/organization/domain'],['PATCH','/v1/organization/topic/'+id],
  ['GET','/v1/requirements/snapshot'],['GET','/v1/requirements/LO-AGENT-001'],['POST','/v1/requirements'],['PATCH','/v1/requirements/'+id],
  ['GET','/v1/storage-reviews/snapshot'],['GET','/v1/storage-reviews/'+id],['POST','/v1/storage-reviews'],['PATCH','/v1/storage-reviews/'+id+'/checklist'],['PATCH','/v1/storage-reviews/'+id+'/decisions'],
  ['GET','/v1/feedback/snapshot'],['GET','/v1/feedback/'+id],['POST','/v1/feedback'],['POST','/v1/todo-classifications/preview'],
  ...['journal','calendar','health','person','finance','media','career','portfolio','cooking'].flatMap(type=>[
   ['GET',`/v1/records/${type}/snapshot`],['GET',`/v1/records/${type}/${id}`],['POST',`/v1/records/${type}`],['PATCH',`/v1/records/${type}/${id}`],
  ]),
 ];
 const dispatched:string[]=[];
 const transport=inProcessApiFetch(origin,token,async request=>{dispatched.push(request.method+' '+new URL(request.url).pathname.slice(mount.length));return Response.json({});},new AbortController().signal);
 for(const [method,path] of routes)assert.equal((await transport(origin+mount+path,{method,headers:{authorization:'Bearer '+token}})).status,200);
 assert.deepEqual(dispatched,routes.map(([method,path])=>method+' '+path));
});
