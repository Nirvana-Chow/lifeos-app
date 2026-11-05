import {emptyPersonPersonal} from '../src/personal-people/model.ts';
import {emptyHealthFields} from '../src/personal-health/presentation.ts';
import {calendarFields} from './helpers/personal-calendar-port.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentHandler} from '../src/agent-api/http.ts';
import {MemoryPort} from './helpers/platform.ts';
import {agentOperations} from '../src/agent-api/capabilities.ts';
import {AuthorityService} from '../src/agent-authority/service.ts';
import {assertAgentGrant} from '../src/agent-api/grant-fence.ts';
import type {Transaction} from '../src/platform/contracts.ts';

const config={ownerId:'records-owner',ownerEmail:'fixture@example.test',spaceId:'records-space',databaseName:'fixture',baseURL:'https://records.example.test',approval:'personal-manual-v1',allowedTypes:['todo','journal','project','domain','topic'],calendarEnabled:true,healthEnabled:true,peopleEnabled:true,financeEnabled:true,requirementsEnabled:true,requirementSupportEnabled:true} as const;
const fields={title:'Synthetic journal',text:'Explicit synthetic text',occurredOn:'2030-11-05',personal:null};
const ids=['snapshotJournal','getJournal','createJournal','updateJournal'];
function fixture({enabled=true,ready=true,policy=true}={}){
 const repo=new MemoryPort(),native=repo.transaction.bind(repo);let current=true,denyFenceAt='',duringRead=false;
 repo.readCurrentSnapshot=async owner=>{const rows=structuredClone([...repo.rows.values()].filter(r=>r.ownerId===owner));if(duringRead)current=false;return rows;};
 repo.transaction=(owner,key,fn)=>native(owner,key,tx=>fn({...tx,lockRecordIdentity:async()=>{},lockAgentGrant:async(binding,scopes)=>{assert.equal(binding.businessDataPolicy,'all-personal-business-v1');assert.ok(binding.operationId);const domain=binding.operationId!.includes('Feedback')?'feedback':binding.operationId!.includes('Finance')?'finance':binding.operationId!.includes('Calendar')?'calendar':binding.operationId!.includes('Health')?'health':binding.operationId!.includes('Person')?'person':'journal';assert.deepEqual(scopes,[domain+':read',domain+':write']);return current;},receipt:async()=>{const result=await tx.receipt();if(denyFenceAt==='receipt')current=false;return result;},write:async(...args)=>{await tx.write(...args);if(denyFenceAt==='write')current=false;},saveReceipt:async value=>{await tx.saveReceipt(value);if(denyFenceAt==='saveReceipt')current=false;}}));
 const scopes=policy?['journal:read','journal:write','calendar:read','calendar:write','health:read','health:write','person:read','person:write','finance:read','finance:write','feedback:read','feedback:write']:['todo:read','todo:write'];
 const grant={grantId:'records-grant',ownerId:config.ownerId,spaceId:config.spaceId,scopes,...(policy?{businessDataPolicy:'all-personal-business-v1',allowedOperationIds:[...ids,...['Calendar','Health','Person','Finance'].flatMap(type=>['snapshot','get','create','update'].map(action=>action+type)),'snapshotFeedback','getFeedback','createFeedback']}:{})};
 const handler=createAgentHandler({config,repository:repo,enabled:true,modules:{organization:false,classification:false,personalRecords:enabled,businessDataPolicy:policy},fenceWrites:true,verify:async()=>grant,readCurrentGrant:async()=>current?grant:null,operationAvailable:()=>ready,assertWritable:async()=>{}} as unknown as Parameters<typeof createAgentHandler>[0]);
 const send=async(path:string,method='GET',body?:unknown,key=crypto.randomUUID())=>{const response=await handler(new Request(config.baseURL+path,{method,headers:{host:'records.example.test',authorization:'Bearer synthetic-key','idempotency-key':key,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}));return{status:response.status,body:await response.json()};};
 return{repo,send,revoke:()=>{current=false;},denyAt:(stage:string)=>{denyFenceAt=stage;},revokeDuringRead:()=>{duringRead=true;}};
}
test('explicit policy and closed module/readiness govern new record operations without changing the legacy catalog',async()=>{
 for(const [options,want] of [[{},4],[{enabled:false},0],[{ready:false},0],[{policy:false},0]] as const){const {send,repo}=fixture(options);const catalog=await send('/v2/capabilities');assert.equal(catalog.status,200);assert.equal(catalog.body.operations.filter((x:{id:string})=>ids.includes(x.id)).length,want);assert.equal(repo.rows.size,0);}
 const legacy=fixture({policy:false});assert.equal((await legacy.send('/v1/capabilities')).body.operations.length,6);assert.equal((await legacy.send('/v1/records/journal/snapshot')).status,404);
});
test('journal HTTP uses native CAS, full fields, source identity, readback and exact idempotent replay',async()=>{
 const {repo,send}=fixture();const create=()=>send('/v1/records/journal','POST',{fields},'synthetic-journal-create');
 const first=await create();assert.equal(first.status,201);const id=first.body.entry.id;assert.equal(first.body.entry.type,'journal');assert.equal(first.body.entry.fields.personal,null);
 assert.equal((await create()).body.duplicate,true);assert.equal(repo.rows.size,1);
 const edited=await send('/v1/records/journal/'+id,'PATCH',{fields:{...fields,text:'Updated synthetic text'},expectedRevision:1});assert.equal(edited.status,200);assert.equal(edited.body.entry.revision,2);assert.equal(edited.body.entry.sourceId,first.body.entry.sourceId);
 assert.equal((await send('/v1/records/journal/'+id)).body.entry.fields.text,'Updated synthetic text');assert.equal((await send('/v1/records/journal/snapshot')).body.total,1);
 assert.equal((await send('/v1/records/journal/'+id,'PATCH',{fields,expectedRevision:1})).status,409);
 for(const extra of ['ownerId','spaceId','source','confirmed','actor'])assert.equal((await send('/v1/records/journal','POST',{fields,[extra]:'forged'})).status,400);
 for(const omit of ['title','text','occurredOn','personal']){const partial:Record<string,unknown>={...fields};delete partial[omit];assert.equal((await send('/v1/records/journal/'+id,'PATCH',{fields:partial,expectedRevision:2})).status,400);}
 assert.equal((await send('/v1/records/journal/snapshot?owner=foreign')).status,404);
 const row=repo.rows.get(id)!;repo.rows.set(id,{...row,ownerId:'foreign-owner'});assert.equal((await send('/v1/records/journal/'+id)).status,404);
});
test('feedback Agent writes have explicit channel, dedicated scopes and independent result reads',async()=>{
 const {send}=fixture(),first=await send('/v1/feedback','POST',{fields:{text:'Synthetic feedback',sourceLabel:'Internal verification'}},'synthetic-feedback-create');assert.equal(first.status,201);
 assert.equal(first.body.entry.source.channel,'agent-feedback');assert.equal((await send('/v1/feedback/'+first.body.entry.id)).body.entry.text,'Synthetic feedback');assert.equal((await send('/v1/feedback/snapshot')).body.total,1);
});
test('new record reads and write receipts fail closed on current authority revocation, including transaction stages',async()=>{
 const reader=fixture();reader.revokeDuringRead();assert.equal((await reader.send('/v1/records/journal/snapshot')).status,403);
 for(const stage of ['receipt','write','saveReceipt']){const {send,repo,denyAt}=fixture();denyAt(stage);const result=await send('/v1/records/journal','POST',{fields});assert.equal(result.status,403);assert.equal(repo.rows.size,0);assert.equal(repo.receipts.size,0);}
 const replay=fixture();await replay.send('/v1/records/journal','POST',{fields},'synthetic-before-revoke');replay.revoke();assert.equal((await replay.send('/v1/records/journal','POST',{fields},'synthetic-before-revoke')).status,403);
});
test('policy actor rejects unregistered scopes and legacy actors never acquire new record authority',async()=>{
 const base={ownerId:'owner',spaceId:'space',grantId:'grant',scopes:['journal:read'],businessDataPolicy:'all-personal-business-v1',allowedOperationIds:['snapshotJournal']} as const;
 const authority=(grant:unknown)=>new AuthorityService({ownerId:'owner',spaceId:'space',verifyOwner:async()=>null,verifyAgent:async()=>grant,readCurrentAgent:async()=>grant} as ConstructorParameters<typeof AuthorityService>[0]);
 assert.ok(await authority(base).resolveAgentActor('synthetic'));
 for(const change of [{scopes:['mystery:read']},{scopes:['journal:read','journal:read']},{allowedOperationIds:['notRegistered']},{businessDataPolicy:undefined}])assert.equal(await authority({...base,...change}).resolveAgentActor('synthetic'),null);
 let called=false;const tx={lockAgentGrant:async()=>{called=true;return true;}} as unknown as Transaction;
 await assertAgentGrant(tx,base,['journal:read'],'snapshotJournal');assert.equal(called,true);called=false;
 await assert.rejects(assertAgentGrant(tx,{...base,businessDataPolicy:undefined},['journal:read'],'snapshotJournal'),{code:'GRANT_SCOPES_INVALID'});assert.equal(called,false);
 assert.equal(agentOperations.find(op=>op.id==='createTodo')!.requiredScopes.join(','),'todo:write');
});

test('calendar, health and person record HTTP operations persist their native validated fields and preserve source identity',async()=>{
 const {send}=fixture();
 const examples=[['calendar',calendarFields],['health',{...emptyHealthFields('body','Asia/Shanghai'),title:'Synthetic body'}],['person',{title:'Synthetic contact',text:'',occurredOn:null,personal:emptyPersonPersonal()}]] as const;
 for(const [type,fields] of examples){
  const first=await send('/v1/records/'+type,'POST',{fields});assert.equal(first.status,201,type);assert.equal(first.body.entry.type,type);
  const path='/v1/records/'+type+'/'+first.body.entry.id,edited=await send(path,'PATCH',{fields:{...first.body.entry.fields,title:'Revised synthetic record'},expectedRevision:1});assert.equal(edited.status,200,type);assert.equal(edited.body.entry.revision,2);assert.equal(edited.body.entry.sourceId,first.body.entry.sourceId);
  assert.equal((await send(path)).body.entry.fields.title,'Revised synthetic record');assert.equal((await send('/v1/records/'+type+'/snapshot')).body.total,1);
 }
});
test('personal Agent module flags and per-operation readiness remain separate from the original allowed types',async()=>{
 const {readAgentBusinessModules}=await import('../src/agent-api/config.ts'),{agentOperationAvailable}=await import('../src/agent-api/runtime.ts');
 const env={LIFEOS_AGENT_ALL_BUSINESS_DATA:'all-personal-business-v1',LIFEOS_AGENT_PERSONAL_RECORDS:'personal-records-v1'};
 assert.equal(readAgentBusinessModules({},config).personalRecords,undefined);assert.throws(()=>readAgentBusinessModules({...env,LIFEOS_AGENT_PERSONAL_RECORDS:'1'},config));assert.throws(()=>readAgentBusinessModules({LIFEOS_AGENT_PERSONAL_RECORDS:'personal-records-v1'},config));
 const modules=readAgentBusinessModules(env,config);
 for(const id of ['snapshotJournal','getCalendar','createHealth','updatePerson','snapshotFeedback'])assert.equal(agentOperationAvailable(id,config,false,modules),false,id);
 assert.equal(agentOperationAvailable('snapshotJournal',config,true,modules),true);assert.equal(agentOperationAvailable('getCalendar',{...config,calendarEnabled:undefined},true,modules),false);assert.equal(agentOperationAvailable('snapshotFeedback',{...config,requirementSupportEnabled:undefined},true,modules),false);
});

test('finance Agent operations reuse the native scoped writer and preserve minor units, refund semantics and unknown balances',async()=>{
 const {send,repo}=fixture(),fields={kind:'expense',amountMinor:1234,currency:'CNY',occurredOn:'2030-11-05',category:'Synthetic food',fromAccountRef:'cash',toAccountRef:null,originalEntryId:null,notes:'Explicit synthetic finance'};
 const first=await send('/v1/records/finance','POST',{fields},'synthetic-finance-create');assert.equal(first.status,201);const id=first.body.entry.id;assert.equal(first.body.entry.sourceId,repo.rows.get(id)!.source.id);
 assert.equal((await send('/v1/records/finance','POST',{fields},'synthetic-finance-create')).body.duplicate,true);
 const path='/v1/records/finance/'+id,edited=await send(path,'PATCH',{fields:{...fields,notes:'Edited'},expectedRevision:1});assert.equal(edited.status,200);assert.equal(edited.body.entry.revision,2);assert.equal((await send(path)).body.entry.fields.amountMinor,1234);
 assert.equal((await send('/v1/records/finance','POST',{fields:{...fields,kind:'refund',amountMinor:234,fromAccountRef:null,toAccountRef:'cash',originalEntryId:id}})).status,201);
 const snapshot=await send('/v1/records/finance/snapshot');assert.equal(snapshot.body.total,2);assert.equal(snapshot.body.items.length,2);assert.equal(snapshot.body.summary.netExpenseMinor,'1000');assert.equal(snapshot.body.summary.accountBalanceMinor,null);assert.equal(snapshot.body.coverage.externalLedgerConnected,false);
 assert.equal((await send(path,'PATCH',{fields,expectedRevision:1})).status,409);
 for(const omit of Object.keys(fields)){const partial:Record<string,unknown>={...fields};delete partial[omit];assert.equal((await send(path,'PATCH',{fields:partial,expectedRevision:2})).status,400);}
});

test('policy resolution derives record scopes from exact enabled server operations without changing raw legacy permissions',async()=>{
 const {readCurrentAgentGrant}=await import('../src/agent-api/runtime.ts');
 const row={id:'synthetic-policy-grant',referenceId:config.ownerId,metadata:{spaceId:config.spaceId,businessDataPolicy:'all-personal-business-v1'},permissions:{todo:['read']},enabled:true,expiresAt:new Date(Date.now()+60000)};
 const pool={query:async()=>({rows:[row]})};
 const options=async()=>({ownerId:config.ownerId,spaceId:config.spaceId,policyEnabled:true,registry:agentOperations,operationAvailable:(id:string)=>id==='getJournal'});
 const grant=await readCurrentAgentGrant(pool,row.id,options);assert.deepEqual(grant?.scopes,['journal:read']);assert.deepEqual(grant?.allowedOperationIds,['getJournal']);assert.deepEqual(row.permissions,{todo:['read']});
 assert.equal(await readCurrentAgentGrant(pool,row.id,async()=>({...await options(),policyEnabled:false})),null);
 row.metadata={spaceId:config.spaceId} as typeof row.metadata;assert.deepEqual((await readCurrentAgentGrant(pool,row.id,options))?.scopes,['todo:read']);
});
test('policy catalog rejects a registered record operation with changed scopes or an unknown operation',async()=>{
 const {readBusinessPolicyCatalog}=await import('../src/agent-api/business-policy-postgres.ts');
 for(const operation of [{id:'getJournal',requiredScopes:['journal:read'],enabled:true},{id:'getJournal',requiredScopes:['todo:read'],enabled:true},{id:'notRegistered',requiredScopes:['journal:read'],enabled:true}]){
  let query=0;const pool={query:async()=>({rows:++query===1?[{functions_safe:true,registry_safe:true}]:[{catalog:{version:'all-personal-business-v1',enabled:true,operations:[operation]}}]})};
  if(operation.id==='getJournal'&&operation.requiredScopes[0]==='journal:read')assert.equal((await readBusinessPolicyCatalog(pool)).operations[0].id,'getJournal');else await assert.rejects(readBusinessPolicyCatalog(pool));
 }
 const missing=fixture();missing.repo.readCurrentSnapshot=undefined;const catalog=await missing.send('/v2/capabilities');assert.equal(catalog.body.operations.some((op:{id:string})=>op.id==='snapshotJournal'),false);
});
