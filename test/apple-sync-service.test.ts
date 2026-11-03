import test from 'node:test';
import assert from 'node:assert/strict';
import {AppleSyncService} from '../src/apple-sync-candidate/service.ts';
import {canonicalDigest} from '../src/apple-sync-candidate/domain.ts';
import {PersonalService} from '../src/personal-candidate/service.ts';
import {CalendarService} from '../src/calendar-candidate/service.ts';
import {SyncMemory,syntheticPersonalConfig as config,syntheticPrincipal as principal,syntheticCapabilities as capabilities,syntheticNativeIdentity as identity,syntheticTodoFields as fields} from './helpers/apple-sync-memory.ts';
import type {SyncPrincipal,ActiveDelivery} from '../src/apple-sync-candidate/store-contracts.ts';
import type {FieldObservations} from '../src/apple-sync-candidate/contracts.ts';
const fixture=(write=true)=>{const repository=new SyncMemory();const service=new AppleSyncService({repository,personal:config,...(write?{assertWritable:async()=>{}}:{}),now:()=>new Date('2026-11-03T00:00:00Z')});return {repository,service};};
const input=()=>({fence:'1',kind:'todo',mappingId:null,entityId:null,sourceId:null,expectedRevision:null,identity,fields:fields(),capabilities});
const dispatch=(service:AppleSyncService,operation:string,body:unknown,key='synthetic-command-01',p=principal)=>service.dispatch(p,operation,body,key) as Promise<any>;
type Fixture=ReturnType<typeof fixture>;
function enqueue(f:Fixture,id:string,cursor:string){const row=f.repository.platform.rows.get(id)!;f.repository.outbox.push({cursor,kind:'todo',entityId:row.id,sourceId:row.source.id,revision:row.revision,commandKey:'synthetic-outbox-'+cursor,snapshot:structuredClone(row)});}
async function prepared(f:Fixture,cursor=f.repository.outbox.find(o=>BigInt(o.cursor)>BigInt(f.repository.lease.ackCursor))!.cursor,key='prepare-fixture-'+cursor):Promise<ActiveDelivery>{return (await dispatch(f.service,'prepare',{fence:f.repository.lease.fence,cursor,expectedDeliveryVersion:f.repository.delivery?.version??null},key)).delivery;}
async function claim(f:Fixture,d:ActiveDelivery,key='claim-fixture-'+d.attemptId){return (await dispatch(f.service,'claim',{fence:f.repository.lease.fence,attemptId:d.attemptId,intentHash:d.intentHash,expectedDeliveryVersion:d.version},key)).claim;}
function receiptBody(f:Fixture,d:ActiveDelivery,c:any,nativeFields=d.intent.expectedFields){return{fence:f.repository.lease.fence,attemptId:d.attemptId,intentHash:d.intentHash,expectedDeliveryVersion:c.claimVersion,claimId:c.claimId,proof:{mutationId:d.intent.mutationId,intentHash:d.intentHash,identity,fields:nativeFields},capabilities};}
async function finish(f:Fixture,d:ActiveDelivery,c:any,key='receipt-fixture-'+d.attemptId){const response=await dispatch(f.service,'receipt',receiptBody(f,d,c),key);const ack=await dispatch(f.service,'ack',{fence:f.repository.lease.fence,receiptKey:key,attemptId:d.attemptId,acknowledgement:response.acknowledgement},'ack-fixture-'+d.attemptId);return{...response,ack};}
async function nativeTodo(){const f=fixture(),result=await dispatch(f.service,'observation',input());enqueue(f,result.entityId,'1');return {...f,result};}
test('default write guard and foreign principal reject before mutation',async()=>{
 const {service,repository}=fixture(false);await assert.rejects(dispatch(service,'observation',input()),{code:'SYNC_WRITES_LOCKED'});assert.equal(repository.platform.rows.size,0);
 await assert.rejects(dispatch(service,'capabilities',{},'synthetic-read-01',{...principal,ownerId:'foreign-owner'}),{code:'SYNC_PRINCIPAL_DENIED'});
 await assert.rejects(dispatch(service,'capabilities',{},'synthetic-read-02',{...principal,bridgeId:undefined} as unknown as SyncPrincipal),{code:'SYNC_PRINCIPAL_DENIED'});
});
test('native create reuses business service; replay does not create again; receipt failure rolls back history',async()=>{
 const {service,repository}=fixture();const result=await dispatch(service,'observation',input());assert.equal(result.status,'applied');assert.equal(repository.platform.rows.size,1);assert.equal(repository.platform.historyRows.length,1);
 assert.deepEqual(await dispatch(service,'observation',input()),result);assert.equal(repository.platform.rows.size,1);
 await assert.rejects(dispatch(service,'observation',{...input(),fields:fields('Different')}),{code:'SYNC_COMMAND_CONFLICT'});
 repository.failReceipt=true;await assert.rejects(dispatch(service,'observation',{...input(),identity:{...identity,itemId:'native-two'}},'synthetic-command-02'));assert.equal(repository.platform.rows.size,1);assert.equal(repository.platform.historyRows.length,1);
});
test('different commands for one native identity cannot create duplicates or bind another entity',async()=>{
 const {service,repository}=fixture();const first=await dispatch(service,'observation',input());const second=await dispatch(service,'observation',input(),'synthetic-another-key');assert.equal(second.entityId,first.entityId);assert.equal(repository.platform.rows.size,1);assert.equal(repository.mappings.size,1);
 const other=await dispatch(service,'observation',{...input(),identity:{...identity,itemId:'other-native'}},'synthetic-other-native');const m=repository.mappings.get(other.mappingId)!;
 await assert.rejects(dispatch(service,'observation',{...input(),entityId:m.entityId,sourceId:m.sourceId,expectedRevision:1},'synthetic-rebind-key'),{code:'SYNC_MAPPING_BINDING'});
});
test('same-item identity churn cannot be accepted as a new native object or overwrite evidence',async()=>{
 const {service,repository}=fixture();await dispatch(service,'observation',input());await assert.rejects(dispatch(service,'observation',{...input(),identity:{...identity,externalId:'changed-external'}},'synthetic-churn-key'),{code:'SYNC_MAPPING_BINDING'});assert.equal(repository.platform.rows.size,1);
});
test('merge applies independent native notes, preserves server title, and retains same-field conflicts',async()=>{
 const {service,repository}=fixture();const created=await dispatch(service,'observation',input());let m=repository.mappings.get(created.mappingId)!;m.baseline=fields();repository.mappings.set(m.id,m);
 const original=repository.platform.rows.get(m.entityId)!;await new PersonalService(repository.platform,config).mutate(principal.ownerId,'todo',original.id,{spaceId:config.spaceId,confirmed:true,expectedRevision:1,fields:{...original.draft,title:'Website title'}},'website-change-01');
 const observed={...input(),mappingId:m.id,entityId:m.entityId,sourceId:m.sourceId,expectedRevision:2,fields:fields('Synthetic title','Phone notes')};
 const result=await dispatch(service,'observation',observed,'synthetic-command-02');assert.equal(result.status,'applied');assert.equal((repository.platform.rows.get(m.entityId)!.draft as any).title,'Website title');assert.equal((repository.platform.rows.get(m.entityId)!.draft as any).notes,'Phone notes');assert.deepEqual(repository.mappings.get(m.id)!.baseline,fields());
 const conflict=await dispatch(service,'observation',{...observed,expectedRevision:3,fields:fields('Phone title','Phone notes')},'synthetic-command-03');assert.equal(conflict.status,'conflict');assert.ok(repository.conflicts.length);assert.equal((repository.platform.rows.get(m.entityId)!.draft as any).title,'Website title');
});
test('unknown and unsupported evidence is retained, never normalized into null or silently written',async()=>{
 const {service,repository}=fixture();const raw={...fields(),dueOn:{kind:'unavailable',reason:'native date components unavailable'},recurrence:{kind:'known',value:{frequency:'weekly'}}};
 const result=await dispatch(service,'observation',{...input(),fields:raw});assert.equal(result.status,'conflict');assert.equal(repository.platform.rows.size,0);assert.equal(repository.conflicts.length,1);assert.ok(JSON.stringify(repository.conflicts[0].evidence).includes('weekly'));assert.ok(JSON.stringify(repository.conflicts[0].evidence).includes('unavailable'));
});
test('complete and reopen use business CAS without advancing unacknowledged baseline',async()=>{
 const {service,repository}=fixture();const r=await dispatch(service,'observation',input());const m=repository.mappings.get(r.mappingId)!;m.baseline=fields();
 for(const [revision,status]of [[1,'done'],[2,'open']] as const){const current=repository.mappings.get(m.id)!;current.baseline=fields('Synthetic title','Synthetic notes',revision===1?'open':'done');const result=await dispatch(service,'observation',{...input(),mappingId:m.id,entityId:m.entityId,sourceId:m.sourceId,expectedRevision:revision,fields:fields('Synthetic title','Synthetic notes',status)},'synthetic-status-'+revision);assert.equal(result.status,'applied');assert.equal((repository.platform.rows.get(m.entityId)!.draft as any).status,status);}
 await assert.rejects(dispatch(service,'observation',{...input(),mappingId:m.id,entityId:m.entityId,sourceId:m.sourceId,expectedRevision:1},'synthetic-stale-rev'),{code:'REVISION_CONFLICT'});
});
test('calendar observations reuse CalendarService and refuse cancelled state as deletion',async()=>{
 const {service,repository}=fixture();const eventFields:FieldObservations={title:{kind:'known',value:'Synthetic event'},notes:{kind:'known',value:''},schedule:{kind:'known',value:{kind:'all-day',startDate:'2026-11-03',endDate:'2026-11-04'}},status:{kind:'known',value:'planned'}};
 const result=await dispatch(service,'observation',{...input(),kind:'calendar',fields:eventFields});assert.equal(result.status,'applied');assert.equal(repository.calendar.rows.size,1);assert.equal((await new CalendarService(repository.calendar).get(config.ownerId,result.entityId)).title,'Synthetic event');
 const m=repository.mappings.get(result.mappingId)!;m.baseline=eventFields;
 const blocked=await dispatch(service,'observation',{...input(),kind:'calendar',mappingId:m.id,entityId:m.entityId,sourceId:m.sourceId,expectedRevision:1,fields:{...eventFields,status:{kind:'known',value:'cancelled'}}},'synthetic-cancelled-01');assert.equal(blocked.status,'conflict');assert.equal(repository.calendar.rows.size,1);
});
test('a native planned event does not reopen a cancelled LifeOS event or emit an empty calendar patch',async()=>{
 const {service,repository}=fixture(),eventFields:FieldObservations={title:{kind:'known',value:'Synthetic terminal event'},notes:{kind:'known',value:''},schedule:{kind:'known',value:{kind:'all-day',startDate:'2026-11-03',endDate:'2026-11-04'}},status:{kind:'known',value:'planned'}};
 const result=await dispatch(service,'observation',{...input(),kind:'calendar',fields:eventFields}),m=repository.mappings.get(result.mappingId)!;m.baseline={...eventFields,status:{kind:'known',value:'cancelled'}};
 await new CalendarService(repository.calendar).cancel(principal.ownerId,m.entityId,{expectedRevision:1},'synthetic-web-cancel');
 const r=await dispatch(service,'observation',{...input(),kind:'calendar',mappingId:m.id,entityId:m.entityId,sourceId:m.sourceId,expectedRevision:2,fields:eventFields},'synthetic-native-reopen');assert.equal(r.status,'conflict');assert.equal(repository.calendar.rows.get(m.entityId)!.status,'cancelled');assert.equal(repository.conflicts.length,1);
});
test('lost observation response can replay under a new live fence but not changed payload or stale identity',async()=>{
 const {service,repository}=fixture(),original=input(),result=await dispatch(service,'observation',original,'synthetic-lost-observation');
 repository.lease.fence='2';const renewed=await dispatch(service,'lease',{ttlSeconds:60},'synthetic-reclaim-observation');assert.equal(renewed.fence,'2');
 assert.deepEqual(await dispatch(service,'observation',{...original,fence:'2'},'synthetic-lost-observation'),result);assert.equal(repository.platform.rows.size,1);assert.equal(repository.platform.historyRows.length,1);
 await assert.rejects(dispatch(service,'observation',{...original,fence:'2',fields:fields('Changed retry')},'synthetic-lost-observation'),{code:'SYNC_COMMAND_CONFLICT'});
 await assert.rejects(dispatch(service,'observation',original,'synthetic-lost-observation'),{code:'SYNC_LEASE_STALE'});
 for(const other of [{...principal,bridgeId:'other-device'},{...principal,identityEpoch:'epoch-two'}])await assert.rejects(dispatch(service,'observation',{...original,fence:'2'},'synthetic-lost-observation',other),{code:'SYNC_LEASE_STALE'});
});
test('pull is metadata-only and write-authorized prepare persists an immutable current-canonical delivery before replying',async()=>{
 const f=await nativeTodo(),p=await dispatch(f.service,'pull',{fence:'1',after:'0',limit:100});assert.equal(p.items.length,1);assert.deepEqual(Object.keys(p.items[0]).sort(),['cursor','entityId','kind','revision','sourceId']);assert.equal(p.delivery,null);assert.equal(f.repository.delivery,null);
 const d=await prepared(f);assert.deepEqual(f.repository.delivery,d);assert.equal(d.intent.revision,1);assert.deepEqual(d.intent.expectedFields,fields());const archive=[...f.repository.receipts.values()].find(r=>(r.result as any).operation==='prepare')!.result as any;assert.deepEqual(archive.delivery,d);assert.deepEqual(archive.response,{delivery:d});assert.equal('format'in (await dispatch(f.service,'prepare',{fence:'1',cursor:'1',expectedDeliveryVersion:null},'prepare-fixture-1')),false);
 const ro={...principal,scopes:['sync:read'] as const};for(const operation of ['prepare','claim','retire','receipt','ack','authorize-save'])await assert.rejects(dispatch(f.service,operation,{},'readonly-operation',ro),{code:'SYNC_PRINCIPAL_DENIED'});
});
test('prepare freezes current B/N1 from an older B/N0 notification; ACK cannot overwrite a later revision4',async()=>{
 const f=await nativeTodo();let d=await prepared(f),c=await claim(f,d);await finish(f,d,c);
 const mapping=[...f.repository.mappings.values()][0],business=new PersonalService(f.repository.platform,config),initial=f.repository.platform.rows.get(mapping.entityId)!;
 await business.mutate(principal.ownerId,'todo',initial.id,{spaceId:config.spaceId,confirmed:true,expectedRevision:1,fields:{...initial.draft,title:'Website B'}},'website-title-B');enqueue(f,initial.id,'2');
 await dispatch(f.service,'observation',{...input(),mappingId:mapping.id,entityId:initial.id,sourceId:initial.source.id,expectedRevision:2,fields:fields('Synthetic title','Phone N1')},'phone-notes-N1');enqueue(f,initial.id,'3');
 d=await prepared(f,'2');assert.equal(d.canonicalRevision,3);assert.equal(d.cursor,'2');assert.deepEqual(d.intent.expectedFields,fields('Website B','Phone N1'));assert.deepEqual(d.intent.patch,{title:{kind:'known',value:'Website B'}});const repeated=await dispatch(f.service,'prepare',{fence:'1',cursor:'2',expectedDeliveryVersion:d.version},'prepare-repeat-newkey');assert.equal(repeated.delivery.intentHash,d.intentHash);
 const before=f.repository.platform.rows.get(initial.id)!;await business.mutate(principal.ownerId,'todo',initial.id,{spaceId:config.spaceId,confirmed:true,expectedRevision:3,fields:{...before.draft,title:'Website revision4'}},'website-revision4');enqueue(f,initial.id,'4');c=await claim(f,d);await finish(f,d,c);
 assert.equal(f.repository.platform.rows.get(initial.id)!.revision,4);assert.equal((f.repository.platform.rows.get(initial.id)!.draft as any).title,'Website revision4');assert.deepEqual(f.repository.mappings.get(mapping.id)!.baseline,fields('Website B','Phone N1'));assert.equal(f.repository.lease.ackCursor,'2');
 const next=await prepared(f,'3');assert.equal(next.canonicalRevision,4);assert.deepEqual(next.intent.expectedFields,fields('Website revision4','Phone N1'));
});
test('retirement merges preclaim phone edit atomically and a separate prepare uses a new attempt without notes regression',async()=>{
 const f=await nativeTodo();let d=await prepared(f),c=await claim(f,d);await finish(f,d,c);const mapping=[...f.repository.mappings.values()][0],old=f.repository.platform.rows.get(mapping.entityId)!;
 await new PersonalService(f.repository.platform,config).mutate(principal.ownerId,'todo',old.id,{spaceId:config.spaceId,confirmed:true,expectedRevision:1,fields:{...old.draft,title:'Website B'}},'website-before-retire');enqueue(f,old.id,'2');d=await prepared(f,'2');
 const observation={identity,fields:fields('Synthetic title','Phone N1'),capabilities},body={fence:'1',attemptId:d.attemptId,intentHash:d.intentHash,expectedDeliveryVersion:d.version,observation};
 await assert.rejects(dispatch(f.service,'observation',{...input(),mappingId:mapping.id,entityId:old.id,sourceId:old.source.id,expectedRevision:2,fields:observation.fields},'phone-after-issued'),{code:'SYNC_DELIVERY_ACTIVE'});
 f.repository.failDelivery=true;await assert.rejects(dispatch(f.service,'retire',body,'retire-atomic-key'));assert.equal(f.repository.platform.rows.get(old.id)!.revision,2);assert.equal(f.repository.delivery!.phase,'issued');f.repository.failDelivery=false;
 const result=await dispatch(f.service,'retire',body,'retire-atomic-key');assert.equal(result.delivery.phase,'retired-unapplied');assert.equal(result.reconciliation.status,'applied');assert.equal(f.repository.lease.ackCursor,'1');assert.equal((f.repository.platform.rows.get(old.id)!.draft as any).notes,'Phone N1');
 const next=await prepared(f,'2','prepare-after-retire');assert.notEqual(next.attemptId,d.attemptId);assert.notEqual(next.intent.mutationId,d.intent.mutationId);assert.ok(BigInt(next.version)>BigInt(d.version));assert.deepEqual(next.intent.patch,{title:{kind:'known',value:'Website B'}});assert.deepEqual(next.intent.expectedFields,fields('Website B','Phone N1'));
 assert.deepEqual((await dispatch(f.service,'retire',body,'retire-atomic-key')).delivery,result.delivery);assert.equal(f.repository.delivery!.attemptId,next.attemptId);
});
test('claim and retire serialize, claimed uncertainty cannot retire and historical claim cannot renew save authority',async()=>{
 const f=await nativeTodo(),d=await prepared(f),claimBody={fence:'1',attemptId:d.attemptId,intentHash:d.intentHash,expectedDeliveryVersion:d.version},retireBody={...claimBody,observation:{identity,fields:fields(),capabilities}};
 const outcomes=await Promise.allSettled([dispatch(f.service,'claim',claimBody,'claim-racing'),dispatch(f.service,'retire',retireBody,'retire-racing')]);assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.repository.delivery!.phase,'claimed');const c=(outcomes[0] as PromiseFulfilledResult<any>).value.claim;
 const auth={fence:'1',attemptId:d.attemptId,intentHash:d.intentHash,claimId:c.claimId,claimVersion:c.claimVersion,executionFence:c.executionFence};assert.equal((await dispatch(f.service,'authorize-save',auth,'fresh-authorization')).authorized,true);
 await assert.rejects(dispatch(f.service,'retire',{...retireBody,expectedDeliveryVersion:c.claimVersion},'retire-after-claim'));
 f.repository.lease.fence='2';assert.deepEqual((await dispatch(f.service,'claim',{...claimBody,fence:'2'},'claim-racing')).claim,c);await assert.rejects(dispatch(f.service,'authorize-save',{...auth,fence:'2'},'fresh-authorization'),{code:'SYNC_DELIVERY_AUTHORITY'});
 await assert.rejects(dispatch(f.service,'lease',{ttlSeconds:60},'new-device',{...principal,identityEpoch:'new-epoch'}));
});
test('readback receipt binds exact delivery proof and mapping; unknown proof or forged ACK never advances cursor',async()=>{
 const f=await nativeTodo(),d=await prepared(f),c=await claim(f,d),body=receiptBody(f,d,c),m=[...f.repository.mappings.values()][0];
 await assert.rejects(dispatch(f.service,'receipt',{...body,proof:{...body.proof,fields:{...fields(),notes:{kind:'unavailable',reason:'not read'}}}},'unknown-readback'));
 await assert.rejects(dispatch(f.service,'receipt',{...body,proof:{...body.proof,fields:fields('Wrong')}},'wrong-readback'));assert.equal(f.repository.lease.ackCursor,'0');assert.deepEqual(f.repository.mappings.get(m.id)!.baseline,{});
 const response=await dispatch(f.service,'receipt',body,'exact-readback'),ack={fence:'1',receiptKey:'exact-readback',attemptId:d.attemptId,acknowledgement:response.acknowledgement};assert.equal(response.receipt.nativeHash,canonicalDigest(body.proof));assert.equal(f.repository.lease.ackCursor,'0');
 await assert.rejects(dispatch(f.service,'ack',{...ack,acknowledgement:{...ack.acknowledgement,cursor:'2'}},'forged-ack'));f.repository.mappings.get(m.id)!.version++;await assert.rejects(dispatch(f.service,'ack',ack,'stale-mapping-ack'));f.repository.mappings.get(m.id)!.version--;
 const result=await dispatch(f.service,'ack',ack,'exact-ack');assert.deepEqual(result.acknowledgement,response.acknowledgement);assert.equal(f.repository.lease.ackCursor,'1');assert.deepEqual(f.repository.mappings.get(m.id)!.baseline,fields());assert.deepEqual(await dispatch(f.service,'ack',ack,'exact-ack'),result);
 await assert.rejects(dispatch(f.service,'observation',{...input(),entityId:m.entityId,mappingId:m.id,sourceId:'11111111-1111-4111-a111-111111111111',expectedRevision:1},'wrong-source-after-ack'),{code:'SYNC_MAPPING_BINDING'});
});
test('two queued revisions create once then update with a no-op, retaining stable attempt hashes',async()=>{
 const f=fixture(),business=new PersonalService(f.repository.platform,config),first=(await business.mutate(principal.ownerId,'todo',null,{spaceId:config.spaceId,confirmed:true,fields:{title:'revision1',notes:'',dueOn:null,status:'open'}},'website-create')).entry;enqueue(f,first.id,'1');await business.mutate(principal.ownerId,'todo',first.id,{spaceId:config.spaceId,confirmed:true,expectedRevision:1,fields:{title:'revision2',notes:'',dueOn:null,status:'open'}},'website-update');enqueue(f,first.id,'2');
 const native=new Map<string,FieldObservations>(),operations:string[]=[];for(const cursor of ['1','2']){const d=await prepared(f,cursor),c=await claim(f,d);operations.push(d.intent.operation);if(d.intent.operation==='create'){assert.equal(native.size,0);native.set(identity.itemId,d.intent.expectedFields);}else{assert.equal(d.intent.expectedNativeHash,canonicalDigest({identity,fields:native.get(identity.itemId)!}));assert.deepEqual(d.intent.patch,{});native.set(identity.itemId,{...native.get(identity.itemId),...d.intent.patch});}const before=d.intentHash;await finish(f,d,c);assert.equal((await dispatch(f.service,'prepare',{fence:'1',cursor,expectedDeliveryVersion:cursor==='1'?null:'4'},'prepare-fixture-'+cursor)).delivery.intentHash,before);}
 assert.deepEqual(operations,['create','update']);assert.equal(native.size,1);assert.equal(f.repository.mappings.size,1);assert.equal(f.repository.lease.ackCursor,'2');assert.deepEqual(native.get(identity.itemId)!.title,{kind:'known',value:'revision2'});
});
test('lost prepare claim receipt and ACK replies recover historical results across fence renewal without restoring active slots',async()=>{
 const f=await nativeTodo(),prepareBody={fence:'1',cursor:'1',expectedDeliveryVersion:null},d=await prepared(f),claimBody={fence:'1',attemptId:d.attemptId,intentHash:d.intentHash,expectedDeliveryVersion:d.version},c=await claim(f,d),body=receiptBody(f,d,c),response=await dispatch(f.service,'receipt',body,'lost-receipt');const version=f.repository.delivery!.version;
 f.repository.lease.fence='2';assert.deepEqual((await dispatch(f.service,'prepare',{...prepareBody,fence:'2'},'prepare-fixture-1')).delivery,d);assert.deepEqual((await dispatch(f.service,'claim',{...claimBody,fence:'2'},'claim-fixture-'+d.attemptId)).claim,c);assert.deepEqual(await dispatch(f.service,'receipt',{...body,fence:'2'},'lost-receipt'),response);assert.equal(f.repository.delivery!.version,version);
 await assert.rejects(dispatch(f.service,'receipt',{...body,fence:'2',proof:{...body.proof,fields:fields('Changed')}},'lost-receipt'),{code:'SYNC_COMMAND_CONFLICT'});await assert.rejects(dispatch(f.service,'receipt',body,'lost-receipt'),{code:'SYNC_LEASE_STALE'});
 for(const other of [{...principal,bridgeId:'other-device'},{...principal,identityEpoch:'epoch-two'}])await assert.rejects(dispatch(f.service,'receipt',{...body,fence:'2'},'lost-receipt',other));
 const ack={fence:'2',receiptKey:'lost-receipt',attemptId:d.attemptId,acknowledgement:response.acknowledgement},result=await dispatch(f.service,'ack',ack,'lost-ack');assert.deepEqual(await dispatch(f.service,'ack',ack,'lost-ack'),result);assert.equal(f.repository.delivery!.phase,'acknowledged');
 assert.deepEqual((await dispatch(f.service,'prepare',{...prepareBody,fence:'2'},'prepare-fixture-1')).delivery,d);assert.equal(f.repository.delivery!.phase,'acknowledged');
});
for(const change of ['noop','changed'] as const)test('pending readback blocks '+change+' observation and another receipt key until original ACK',async()=>{
 const f=await nativeTodo(),m=[...f.repository.mappings.values()][0],d=await prepared(f),c=await claim(f,d),body=receiptBody(f,d,c),response=await dispatch(f.service,'receipt',body,'pending-receipt'),pending=structuredClone(f.repository.mappings.get(m.id)),count=f.repository.platform.historyRows.length;
 const observation={...input(),mappingId:m.id,entityId:m.entityId,sourceId:m.sourceId,expectedRevision:1,fields:fields(change==='noop'?'Synthetic title':'Queued title')};for(const operation of ['preview','observation'])await assert.rejects(dispatch(f.service,operation,observation,'queued-'+operation),{code:'SYNC_PENDING_ACK'});await assert.rejects(dispatch(f.service,'observation',input(),'queued-unbound'),{code:'SYNC_PENDING_ACK'});await assert.rejects(dispatch(f.service,'receipt',body,'other-receipt-key'),{code:'SYNC_PENDING_ACK'});
 assert.deepEqual(f.repository.mappings.get(m.id),pending);assert.equal(f.repository.platform.historyRows.length,count);assert.deepEqual(await dispatch(f.service,'observation',input()),f.result);assert.deepEqual(await dispatch(f.service,'receipt',body,'pending-receipt'),response);
 await dispatch(f.service,'ack',{fence:'1',receiptKey:'pending-receipt',attemptId:d.attemptId,acknowledgement:response.acknowledgement},'pending-ack');assert.equal((await dispatch(f.service,'observation',observation,'queued-observation')).status,'applied');assert.equal((f.repository.platform.rows.get(m.entityId)!.draft as any).title,change==='noop'?'Synthetic title':'Queued title');
});
test('unknown retirement evidence stays conflict and cannot prepare a replacement; oversized prepare leaves no delivery archive',async()=>{
 const f=await nativeTodo(),d=await prepared(f);const r=await dispatch(f.service,'retire',{fence:'1',attemptId:d.attemptId,intentHash:d.intentHash,expectedDeliveryVersion:d.version,observation:{identity,fields:{...fields(),notes:{kind:'unavailable',reason:'not read'}},capabilities}},'retire-unknown');assert.equal(r.delivery.retirement.outcome,'conflict');assert.equal(r.delivery.retirement.observation.fields.notes.kind,'unavailable');await assert.rejects(prepared(f,'1','prepare-conflict-retry'));
 const large=await nativeTodo(),row=large.repository.platform.rows.get(large.result.entityId)!;await new PersonalService(large.repository.platform,config).mutate(principal.ownerId,'todo',row.id,{spaceId:config.spaceId,confirmed:true,expectedRevision:1,fields:{...row.draft,notes:'中'.repeat(12000)}},'oversized-business-note');await assert.rejects(prepared(large));assert.equal(large.repository.delivery,null);
});
test('retirement rejects a changed prepared mapping before accepting observation business writes',async()=>{
 const f=await nativeTodo(),d=await prepared(f),mapping=f.repository.mappings.get(d.preparedMapping!.id)!;mapping.version++;
 const before=structuredClone(f.repository.platform.rows.get(d.intent.entityId)),body={fence:'1',attemptId:d.attemptId,intentHash:d.intentHash,expectedDeliveryVersion:d.version,observation:{identity,fields:fields('Changed phone title'),capabilities}};
 await assert.rejects(dispatch(f.service,'retire',body,'retire-stale-mapping'),{code:'SYNC_MAPPING_BINDING'});assert.deepEqual(f.repository.platform.rows.get(d.intent.entityId),before);assert.equal(f.repository.delivery!.phase,'issued');
});
