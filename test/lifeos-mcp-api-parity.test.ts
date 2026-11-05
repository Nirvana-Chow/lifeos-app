import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAgentHandler} from '../src/agent-api/http.ts';
import {agentOperations} from '../src/agent-api/capabilities.ts';
import {MemoryPort} from './helpers/platform.ts';
import {LifeOSApiClient} from '../src/mcp-candidate/client.ts';
import {DurableStore} from '../src/mcp-candidate/native-store.mjs';

const origin='https://lifeos.nirvanachow.com',fingerprint='d'.repeat(64);

// Exercise the public client/native-request seam against the real HTTP handler,
// not a host, credential store, live grant or production database.
test('native request seam verifies actual synthetic Agent projections and inherited optional fields',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'lifeos-mcp-handler-'));
 try{
  const repository=new MemoryPort();repository.readCurrentSnapshot=async()=>structuredClone([...repository.rows.values()]);
  const transaction=repository.transaction.bind(repository);
  repository.transaction=(owner,key,run)=>transaction(owner,key,tx=>run({...tx,lockRecordIdentity:async()=>{},lockAgentGrant:async()=>true}));
  const grant={grantId:'synthetic-grant',ownerId:'synthetic-owner',spaceId:'synthetic-space',scopes:[...new Set(agentOperations.flatMap(op=>op.requiredScopes))],businessDataPolicy:'all-personal-business-v1' as const,allowedOperationIds:agentOperations.filter(op=>op.module!=='catalog').map(op=>op.id)};
  const handler=createAgentHandler({enabled:true,mountPath:'/api/platform/agent',fenceWrites:true,modules:{organization:true,classification:false,personalRecords:true,businessDataPolicy:true,requirements:true},repository,
   config:{ownerId:grant.ownerId,spaceId:grant.spaceId,ownerEmail:'fixture@example.invalid',databaseName:'fixture',approval:'personal-manual-v1',allowedTypes:['todo','journal','project','domain','topic'],requirementsEnabled:true,requirementSupportEnabled:true,calendarEnabled:true,healthEnabled:true,peopleEnabled:true,financeEnabled:true,mediaEnabled:true,careerEnabled:true,portfolioEnabled:true,baseURL:origin},
   verify:async key=>key==='synthetic-fixture-provider'?grant:null,readCurrentGrant:async()=>grant,operationAvailable:()=>true,assertWritable:async()=>{}});
  const client=new LifeOSApiClient({origin,beforeUse:async()=>{},durable:new DurableStore(directory,fingerprint),nativeRequest:async(path,method,encoded,key)=>{
   const response=await handler(new Request(origin+'/api/platform/agent'+path,{method,headers:{host:'lifeos.nirvanachow.com',authorization:'Bearer synthetic-fixture-provider',...(encoded?{'content-type':'application/json'}:{}),...(key?{'idempotency-key':key}:{})},...(encoded?{body:encoded}:{})}));
   return{status:response.status,data:await response.json(),credentialFingerprint:fingerprint};
  }});
  const examples:[string,Record<string,unknown>][]=[
   ['createTodo',{title:' Synthetic todo ',notes:'',dueOn:null,status:'open',plannedStartOn:'2026-11-06',plannedEndOn:'2026-12-06'}],
   ['createJournal',{title:'Synthetic journal',text:'Body',occurredOn:null,personal:null}],
   ['createFinance',{kind:'expense',amountMinor:123,currency:'CNY',occurredOn:'2026-11-05',category:null,fromAccountRef:null,toAccountRef:null,originalEntryId:null,notes:'Synthetic'}],
   ['createFeedback',{title:'Synthetic feedback',text:'Feedback',sourceLabel:null}],
   ['createRequirement',{title:'Synthetic requirement',body:'Purpose',phaseId:'business',priority:'P1',plannedStartOn:null,plannedEndOn:null,workflow:{state:'planned',purpose:'Record',nextStep:'Review'}}],
  ];
  const saved:Record<string,any>={};
  for(const [operationId,fields] of examples){
   const result=await client.execute(operationId,{fields,idempotencyKey:'synthetic-parity-'+operationId});
   assert.equal(result.ok,true,operationId+JSON.stringify(result));assert.equal(result.verification?.verified,true,operationId+JSON.stringify(result));saved[operationId]=result.data!.entry;
  }
  const todo=saved.createTodo;
  const todoUpdated=await client.execute('updateTodo',{id:todo.id,expectedRevision:1,fields:{title:todo.fields.title,notes:'Edited',dueOn:null,status:'open',personal:null},idempotencyKey:'synthetic-preserve-todo'});
  assert.equal(todoUpdated.verification?.verified,true,JSON.stringify(todoUpdated));assert.equal((todoUpdated.data!.entry as any).fields.plannedStartOn,'2026-11-06');
  const req=saved.createRequirement,{workflow,...requiredFields}=req.fields;
  const reqUpdated=await client.execute('updateRequirement',{id:req.id,expectedRevision:1,baselineBinding:req.baselineBinding,fields:requiredFields,idempotencyKey:'synthetic-preserve-workflow'});
  assert.equal(reqUpdated.verification?.verified,true,JSON.stringify(reqUpdated));assert.deepEqual((reqUpdated.data!.entry as any).fields.workflow,workflow);
  const cleared=await client.execute('updateRequirement',{id:req.id,expectedRevision:2,baselineBinding:req.baselineBinding,fields:{...requiredFields,workflow:null},idempotencyKey:'synthetic-clear-workflow'});
  assert.equal(cleared.verification?.verified,true,JSON.stringify(cleared));assert.equal((cleared.data!.entry as any).fields.workflow,null);
  const snapshot=await client.execute('snapshotRequirements',{}),publicRow=(snapshot.data!.items as any[]).find(e=>e.id.startsWith('LO-')&&e.revision===0);assert.ok(publicRow);
  const overlay=await client.execute('updateRequirement',{id:publicRow.id,expectedRevision:0,baselineBinding:publicRow.baselineBinding,fields:{...publicRow.fields,title:'Synthetic first overlay'},idempotencyKey:'synthetic-first-public-overlay'});
  assert.equal(overlay.verification?.verified,true,JSON.stringify(overlay));assert.equal((overlay.data!.entry as any).revision,1);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
