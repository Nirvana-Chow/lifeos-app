import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentHandler} from '../src/agent-api/http.ts';
import {agentOperations} from '../src/agent-api/capabilities.ts';
import {MemoryPort} from './helpers/platform.ts';
import {LifeOSApiClient} from '../src/mcp-candidate/client.ts';
import {readAgentBusinessModules} from '../src/agent-api/config.ts';
import {agentOperationAvailable} from '../src/agent-api/runtime.ts';
import {PersonalService} from '../src/personal-candidate/service.ts';

const origin='https://lifeos.nirvanachow.com',ownerId='synthetic-review-owner',spaceId='synthetic-review-space';
const ids=['snapshotStorageReviews','getStorageReview','createStorageReview','updateStorageReviewChecklist','updateStorageReviewDecision'];
const checklist={schema:1,revision:'synthetic-review-1',context:{summary:'Synthetic only'},items:[
 {id:'S-1',title:'Synthetic document',body:'No real paths',question:'Keep?',group:'Synthetic',kind:'file',status:'pending'},
 {id:'S-2',title:'Protected example',body:'',question:'',group:'Synthetic',kind:'folder',status:'protected'},
]};
function setup(){
 const repository=new MemoryPort(),transaction=repository.transaction.bind(repository);let revoked=false,fenced=true,enabled=true,foreign=false,readOnly=false;
 repository.readCurrentSnapshot=async()=>structuredClone([...repository.rows.values()]);
 repository.transaction=(owner,key,run)=>transaction(owner,key,tx=>run({...tx,lockRecordIdentity:async()=>{},lockAgentGrant:async()=>fenced&&!revoked}));
 const grant=(token:string)=>token==='synthetic-review-policy'?{grantId:'synthetic-review-grant',ownerId:foreign?'another-synthetic-owner':ownerId,spaceId,businessDataPolicy:'all-personal-business-v1' as const,
  allowedOperationIds:agentOperations.filter(op=>'policyClass'in op&&op.policyClass==='personal-business-data'&&(!readOnly||op.method==='GET')).map(op=>op.id),scopes:[...new Set(agentOperations.filter(op=>'policyClass'in op&&op.policyClass==='personal-business-data'&&(!readOnly||op.method==='GET')).flatMap(op=>op.requiredScopes))]}:
  token==='synthetic-review-legacy'?{grantId:'synthetic-legacy',ownerId,spaceId,scopes:['todo:read','todo:write'] as const}:null;
 const handler=createAgentHandler({enabled:true,mountPath:'/api/platform/agent',fenceWrites:true,modules:{organization:false,classification:false,businessDataPolicy:true,storageReview:true},repository,
  config:{ownerId,spaceId,baseURL:origin,ownerEmail:'fixture@example.invalid',databaseName:'fixture',approval:'personal-manual-v1',allowedTypes:['todo','journal']},
  verify:async token=>revoked?null:grant(token),readCurrentGrant:async id=>revoked?null:id==='synthetic-legacy'?grant('synthetic-review-legacy'):grant('synthetic-review-policy'),
  operationAvailable:()=>enabled,assertWritable:async()=>{}});
 const request=async(method:string,path:string,body?:unknown,key='synthetic-storage-command',token='synthetic-review-policy')=>handler(new Request(origin+'/api/platform/agent'+path,{method,headers:{host:new URL(origin).host,authorization:'Bearer '+token,'content-type':'application/json','idempotency-key':key},...(body===undefined?{}:{body:JSON.stringify(body)})}));
 const fetcher:typeof fetch=async(input,init)=>{const request=new Request(input,init);request.headers.set('host',new URL(request.url).host);return handler(request);};
 return{repository,request,fetcher,set:(v:{revoked?:boolean;fenced?:boolean;enabled?:boolean;foreign?:boolean;readOnly?:boolean})=>{revoked=v.revoked??revoked;fenced=v.fenced??fenced;enabled=v.enabled??enabled;foreign=v.foreign??foreign;readOnly=v.readOnly??readOnly;}};
}
test('storage Agent discovery is scoped and complete while old grants never gain review data',async()=>{
 const f=setup();const response=await f.request('GET','/v2/capabilities');assert.equal(response.status,200);
 const catalog=await response.json();assert.deepEqual(catalog.operations.filter((op:any)=>op.module==='storageReview').map((op:any)=>op.id),ids);
 assert.equal(catalog.operations.some((op:any)=>op.module==='fileHandoff'),false,'The original all-business grant excludes independent file authority');
 const legacy=await(await f.request('GET','/v2/capabilities',undefined,undefined,'synthetic-review-legacy')).json();assert.equal(legacy.operations.some((op:any)=>op.module==='storageReview'),false);
});

test('shared MCP contracts verify review receipts, no-op decisions and retained choices independently',async()=>{
 const f=setup(),client=new LifeOSApiClient({origin,credentialProvider:async()=> 'synthetic-review-policy'},f.fetcher);
 assert.deepEqual((await client.discover()).operations.filter(op=>op.module==='storageReview').map(op=>op.id),ids);
 const created=await client.execute('createStorageReview',{fields:{checklist},idempotencyKey:'synthetic-mcp-review-create'});
 assert.equal(created.verification?.verified,true,JSON.stringify(created));
 const id=(created.data as any).entry.id;
 const args={id,expectedRevision:1,fields:{checklistRevision:checklist.revision,itemId:'S-1',decision:'keep'},idempotencyKey:'synthetic-mcp-review-choice'};
 const choice=await client.execute('updateStorageReviewDecision',args);assert.equal(choice.verification?.verified,true,JSON.stringify(choice));
 const noop=await client.execute('updateStorageReviewDecision',{...args,expectedRevision:2,idempotencyKey:'synthetic-mcp-review-noop'});assert.equal(noop.verification?.verified,true,JSON.stringify(noop));assert.equal((noop.data as any).entry.revision,2);
 const next=await client.execute('updateStorageReviewChecklist',{id,expectedRevision:2,fields:{checklist:{...checklist,revision:'synthetic-review-2'}},idempotencyKey:'synthetic-mcp-review-next'});
 assert.equal(next.verification?.verified,true,JSON.stringify(next));assert.deepEqual((next.data as any).entry.fields.decisions,[{id:'S-1',decision:'keep'}]);
});
test('storage Agent shares owner decisions, preserves CAS/receipts and hides protected items',async()=>{
 const f=setup(),createdResponse=await f.request('POST','/v1/storage-reviews',{fields:{checklist}});assert.equal(createdResponse.status,201);
 const created=await createdResponse.json(),id=created.entry.id;assert.equal(created.entry.revision,1);assert.deepEqual(created.entry.fields.decisions,[]);
 const args={expectedRevision:1,fields:{checklistRevision:'synthetic-review-1',itemId:'S-1',decision:'keep'}};
 const saved=await(await f.request('PATCH',`/v1/storage-reviews/${id}/decisions`,args,'synthetic-storage-decision')).json();assert.equal(saved.entry.revision,2);assert.deepEqual(saved.entry.fields.decisions,[{id:'S-1',decision:'keep'}]);
 const replay=await(await f.request('PATCH',`/v1/storage-reviews/${id}/decisions`,args,'synthetic-storage-decision')).json();assert.equal(replay.duplicate,true);assert.equal(replay.entry.revision,2);
 assert.equal((await f.request('PATCH',`/v1/storage-reviews/${id}/decisions`,{...args,fields:{...args.fields,decision:'trash'}},'synthetic-storage-decision')).status,409);
 assert.equal((await f.request('PATCH',`/v1/storage-reviews/${id}/decisions`,{expectedRevision:2,fields:{checklistRevision:'synthetic-review-1',itemId:'S-2',decision:'trash'}},'synthetic-protected-decision')).status,409);
 const current=await(await f.request('GET',`/v1/storage-reviews/${id}`)).json();assert.deepEqual(current.entry,saved.entry);
 const snapshot=await(await f.request('GET','/v1/storage-reviews/snapshot')).json();assert.equal(snapshot.truncated,false);assert.deepEqual(snapshot.items,[saved.entry]);
 f.set({fenced:false});assert.equal((await f.request('PATCH',`/v1/storage-reviews/${id}/decisions`,{expectedRevision:2,fields:{...args.fields,decision:'defer'}},'synthetic-revoked-fence')).status,403);
 assert.equal(f.repository.historyRows.length,2);
 const audit=(f.repository.events[0] as any).raw.actor;assert.deepEqual(audit,{kind:'agent-grant',grantId:'synthetic-review-grant',operationId:'createStorageReview'});
 f.set({revoked:true});assert.equal((await f.request('GET',`/v1/storage-reviews/${id}`)).status,401);
});

test('review readiness is explicitly closed, old scopes and foreign owners cannot upload or read decisions',async()=>{
 const config={ownerId,spaceId,ownerEmail:'fixture@example.invalid',databaseName:'fixture',approval:'personal-manual-v1',allowedTypes:['todo','journal'],baseURL:origin} as const;
 assert.equal(agentOperationAvailable('getStorageReview',config,true,{organization:false,classification:false,businessDataPolicy:true}),false);
 assert.throws(()=>readAgentBusinessModules({LIFEOS_AGENT_STORAGE_REVIEW:'storage-review-v1'},config));
 const modules=readAgentBusinessModules({LIFEOS_AGENT_STORAGE_REVIEW:'storage-review-v1',LIFEOS_AGENT_ALL_BUSINESS_DATA:'all-personal-business-v1'},config);
 assert.equal(agentOperationAvailable('getStorageReview',config,true,modules),true);assert.equal(agentOperationAvailable('getStorageReview',config,false,modules),false);
 const f=setup();assert.equal((await f.request('POST','/v1/storage-reviews',{fields:{checklist}},undefined,'synthetic-review-legacy')).status,403);
 f.set({foreign:true});assert.equal((await f.request('GET','/v1/storage-reviews/snapshot')).status,403);
 f.set({foreign:false,enabled:false});assert.equal((await f.request('GET','/v1/storage-reviews/snapshot')).status,503);
 f.set({enabled:true,readOnly:true});assert.equal((await f.request('POST','/v1/storage-reviews',{fields:{checklist}})).status,403);
 assert.equal(f.repository.rows.size,0);
});

test('storage commands reject injected authority and ordinary inbox cannot disclose the tagged review',async()=>{
 const f=setup();
 for(const extra of [{ownerId:'other'},{source:{system:'owner'}},{actor:{kind:'owner-session'}}])assert.equal((await f.request('POST','/v1/storage-reviews',{fields:{checklist},...extra})).status,400);
 const created=await(await f.request('POST','/v1/storage-reviews',{fields:{checklist}})).json(),id=created.entry.id;
 const service=new PersonalService(f.repository,{ownerId,spaceId,ownerEmail:'fixture@example.invalid',databaseName:'fixture',approval:'personal-manual-v1',allowedTypes:['todo','journal'],baseURL:origin});
 await assert.rejects(service.get(ownerId,'journal',id));
 assert.equal((await f.request('GET','/v1/storage-reviews/00000000-0000-4000-8000-000000000001')).status,404);
 assert.equal((await f.request('DELETE',`/v1/storage-reviews/${id}`)).status,404);
});

test('a lost create response remains unknown and replays only its original payload and key',async()=>{
 const f=setup();let lost=true;
 const transport:typeof fetch=async(input,init)=>{const response=await f.fetcher(input,init);if(init?.method==='POST'&&String(input).endsWith('/storage-reviews')&&lost){lost=false;throw Error('synthetic lost response');}return response;};
 const client=new LifeOSApiClient({origin,credentialProvider:async()=> 'synthetic-review-policy'},transport);
 const args={fields:{checklist:structuredClone(checklist)},idempotencyKey:'synthetic-storage-lost-create'};
 const first=await client.execute('createStorageReview',args);assert.equal(first.outcome,'unknown');assert.ok(first.recovery?.requestId);assert.equal(f.repository.rows.size,1);
 args.fields.checklist.items[0].title='Changed after sending';
 const recovered=await client.retry(first.recovery.requestId);assert.equal(recovered.verification?.verified,true,JSON.stringify(recovered));assert.equal((recovered.data as any).duplicate,true);assert.equal((recovered.data as any).entry.fields.checklist.items[0].title,'Synthetic document');assert.equal(f.repository.historyRows.length,1);
 f.set({revoked:true});assert.equal((await client.execute('snapshotStorageReviews',{})).ok,false);
});

test('a lost decision response replays its historical receipt without claiming a later owner choice matches',async()=>{
 const f=setup(),created=await(await f.request('POST','/v1/storage-reviews',{fields:{checklist}})).json(),id=created.entry.id;let lost=true;
 const transport:typeof fetch=async(input,init)=>{const response=await f.fetcher(input,init);if(init?.method==='PATCH'&&String(input).endsWith('/decisions')&&lost){lost=false;throw Error('synthetic lost decision response');}return response;};
 const client=new LifeOSApiClient({origin,credentialProvider:async()=> 'synthetic-review-policy'},transport);
 const args={id,expectedRevision:1,fields:{checklistRevision:checklist.revision,itemId:'S-1',decision:'keep'},idempotencyKey:'synthetic-lost-decision'};
 const first=await client.execute('updateStorageReviewDecision',args);assert.equal(first.outcome,'unknown');assert.ok(first.recovery?.requestId);
 const later=await f.request('PATCH',`/v1/storage-reviews/${id}/decisions`,{expectedRevision:2,fields:{...args.fields,decision:'defer'}},'synthetic-later-choice');assert.equal(later.status,200);
 const recovered=await client.retry(first.recovery.requestId);assert.equal(recovered.ok,true,JSON.stringify(recovered));assert.equal(recovered.outcome,undefined);assert.equal((recovered.data as any).duplicate,true);assert.deepEqual((recovered.data as any).entry.fields.decisions,[{id:'S-1',decision:'keep'}]);
 assert.equal(recovered.verification?.verified,false);assert.equal(recovered.verification?.state,'LATER_REVISION');assert.deepEqual((recovered.readback?.data as any).entry.fields.decisions,[{id:'S-1',decision:'defer'}]);assert.equal(f.repository.historyRows.length,3);
});
