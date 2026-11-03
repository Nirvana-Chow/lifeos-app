import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AppleSyncService} from '../src/apple-sync-candidate/service.ts';
import {ManualSyncBridge,nativeSnapshotHash,type BridgeServerPort,type NativeAdapter,type NativeSnapshot} from '../src/apple-sync-candidate/bridge.ts';
import {SyncJournal} from '../src/apple-sync-candidate/journal.ts';
import {PersonalService} from '../src/personal-candidate/service.ts';
import {SyncMemory,syntheticPersonalConfig as config,syntheticPrincipal as principal,syntheticCapabilities as capabilities,syntheticNativeIdentity as identity,syntheticTodoFields as fields} from './helpers/apple-sync-memory.ts';
import type {ActiveDelivery} from '../src/apple-sync-candidate/store-contracts.ts';

/** Real service/business validation + synthetic storage/native ports. Every
 * outbox notification below is explicitly manually seeded; this is NOT PG or
 * capture evidence, and performs no Apple, credential or network operation. */
function fixture(){
 const repository=new SyncMemory(),business=new PersonalService(repository.platform,config),service=new AppleSyncService({repository,personal:config,assertWritable:async()=>{},now:()=>new Date('2026-11-03T00:00:00Z')});
 const directory=mkdtempSync(join(tmpdir(),'lifeos-synthetic-delivery-loop-'));let held=true,native:NativeSnapshot|null=null,saves=0;
 const saved:NativeSnapshot[]=[],lost=new Set<string>(),calls:{operation:string;key:string;body:unknown}[]=[];
 const assertWriter=()=>{if(!held)throw Error('synthetic original writer lost');};
 const {scopes:_,...owner}=principal;const journal=SyncJournal.open(directory,{...owner,storeEpoch:identity.storeEpoch},{create:true,assertWriter});
 const dispatch=async(operation:string,body:Record<string,unknown>,key:string):Promise<any>=>{calls.push({operation,key,body:structuredClone(body)});const response=await service.dispatch(principal,operation,{fence:repository.lease.fence,...body},key);if(lost.delete(operation))throw Error('synthetic lost '+operation+' reply');return response;};
 const server:BridgeServerPort={assertLease:async()=>{await repository.transaction(principal,'synthetic-transport-check',tx=>tx.requireLease(repository.lease.fence,'2026-11-03T00:00:00.000Z'));},claim:(key,body)=>dispatch('claim',body,key),authorizeSave:body=>dispatch('authorize-save',body,'synthetic-fresh-authorize'),retire:(key,body)=>dispatch('retire',body,key),receipt:(key,body)=>dispatch('receipt',body,key),acknowledge:(key,body)=>dispatch('ack',body,key)};
 const adapter:NativeAdapter={capabilities:async()=>capabilities,snapshot:async()=>structuredClone(native),resolveIntent:async()=>native?{status:'found',snapshot:structuredClone(native)}:{status:'not-found'},apply:async(intent,guards)=>{assertWriter();await guards.assertLease();await guards.assertClaim();if(intent.operation==='create'){assert.equal(native,null);native={identity,fields:structuredClone(intent.patch)};}else{assert.ok(native);assert.equal(nativeSnapshotHash(native!),intent.expectedNativeHash);native={identity,fields:{...native!.fields,...structuredClone(intent.patch)}};}saves++;saved.push(structuredClone(native));}};
 const bridge=new ManualSyncBridge({journal,native:adapter,server,assertWriter,manualWriteEnabled:true});
 const seed=(id:string,cursor:string)=>{const row=repository.platform.rows.get(id)!;repository.outbox.push({cursor,kind:'todo',entityId:row.id,sourceId:row.source.id,revision:row.revision,commandKey:'manual-fixture-notification-'+cursor,snapshot:structuredClone(row)});};
 const prepare=async(cursor:string,key='synthetic-prepare-'+cursor):Promise<ActiveDelivery>=>(await dispatch('prepare',{cursor,expectedDeliveryVersion:repository.delivery?.version??null},key)).delivery;
 return{repository,business,service,journal,bridge,server,adapter,dispatch,prepare,seed,calls,saved,lost,get saves(){return saves;},get snapshot(){return native;},phone:(value:NativeSnapshot)=>{native=structuredClone(value);},loseWriter:()=>{held=false;},close:()=>rmSync(directory,{recursive:true,force:true})};
}
async function initial(f:ReturnType<typeof fixture>){const entry=(await f.business.mutate(principal.ownerId,'todo',null,{spaceId:config.spaceId,confirmed:true,fields:{title:'A',notes:'N0',dueOn:null,status:'open'}},'synthetic-website-create')).entry;f.seed(entry.id,'1');assert.equal((await f.bridge.execute(await f.prepare('1'))).phase,'acknowledged');return entry;}

test('actual service and bridge preserve accepted N1 across old B/N0 notification and later canonical revision at ACK',async()=>{
 const f=fixture();try{const entry=await initial(f),mapping=[...f.repository.mappings.values()][0];
  await f.business.mutate(principal.ownerId,'todo',entry.id,{spaceId:config.spaceId,confirmed:true,expectedRevision:1,fields:{title:'B',notes:'N0',dueOn:null,status:'open'}},'synthetic-website-B');f.seed(entry.id,'2');
  f.phone({identity,fields:fields('A','N1')});const observed=await f.dispatch('observation',{kind:'todo',mappingId:mapping.id,entityId:entry.id,sourceId:entry.source.id,expectedRevision:2,identity,fields:fields('A','N1'),capabilities},'synthetic-phone-N1');assert.equal(observed.status,'applied');f.seed(entry.id,'3');
  const d=await f.prepare('2');assert.equal(d.canonicalRevision,3);assert.deepEqual(d.intent.expectedFields,fields('B','N1'));assert.deepEqual(d.intent.patch,{title:{kind:'known',value:'B'}});
  const frozen=structuredClone(d);await f.business.mutate(principal.ownerId,'todo',entry.id,{spaceId:config.spaceId,confirmed:true,expectedRevision:3,fields:{title:'C',notes:'N1',dueOn:null,status:'open'}},'synthetic-website-C');f.seed(entry.id,'4');
  assert.equal((await f.bridge.execute(d)).phase,'acknowledged');assert.deepEqual(d,frozen);assert.deepEqual(f.snapshot!.fields,fields('B','N1'));assert.equal(f.repository.lease.ackCursor,'2');assert.deepEqual(f.repository.mappings.get(mapping.id)!.baseline,fields('B','N1'));assert.equal(f.repository.platform.rows.get(entry.id)!.revision,4);assert.equal((f.repository.platform.rows.get(entry.id)!.draft as any).title,'C');
  assert.equal((await f.bridge.execute(await f.prepare('3'))).phase,'acknowledged');const beforeNoop=f.saves,d4=await f.prepare('4');assert.deepEqual(d4.intent.patch,{});assert.equal((await f.bridge.execute(d4)).phase,'acknowledged');assert.equal(f.saves,beforeNoop);assert.equal(f.repository.lease.ackCursor,'4');assert.deepEqual(f.snapshot!.fields,fields('C','N1'));assert.deepEqual(f.saved.slice(1).map(s=>s.fields.notes),[{kind:'known',value:'N1'},{kind:'known',value:'N1'}]);
 }finally{f.close();}
});

test('actual service reply loss replays exact prepare claim receipt and ACK commands without a second save',async()=>{
 const f=fixture();try{const entry=(await f.business.mutate(principal.ownerId,'todo',null,{spaceId:config.spaceId,confirmed:true,fields:{title:'A',notes:'N0',dueOn:null,status:'open'}},'synthetic-website-create')).entry;f.seed(entry.id,'1');
  const prepareBody={cursor:'1',expectedDeliveryVersion:null};f.lost.add('prepare');await assert.rejects(f.dispatch('prepare',prepareBody,'stable-prepare-loss'));const d=(await f.dispatch('prepare',prepareBody,'stable-prepare-loss')).delivery as ActiveDelivery;assert.deepEqual(f.repository.delivery,d);
  f.lost.add('claim');assert.equal((await f.bridge.execute(d)).phase,'claim-pending');assert.equal(f.saves,0);f.lost.add('receipt');assert.equal((await f.bridge.execute(d)).phase,'native-verified');assert.equal(f.saves,1);assert.equal(f.journal.list()[0].serverReceipt,null);f.lost.add('ack');assert.equal((await f.bridge.execute(d)).phase,'native-verified');assert.ok(f.journal.list()[0].serverReceipt);assert.equal(f.repository.lease.ackCursor,'1');assert.equal((await f.bridge.execute(d)).phase,'acknowledged');assert.equal(f.saves,1);
  for(const operation of ['prepare','claim','receipt','ack']){const retries=f.calls.filter(c=>c.operation===operation);assert.equal(retries.length,2);assert.deepEqual(retries[0],retries[1]);}
 }finally{f.close();}
});

test('actual service issued retirement merges phone N1 and separately prepares only title B without changing old intent',async()=>{
 const f=fixture();try{const entry=await initial(f);await f.business.mutate(principal.ownerId,'todo',entry.id,{spaceId:config.spaceId,confirmed:true,expectedRevision:1,fields:{title:'B',notes:'N0',dueOn:null,status:'open'}},'synthetic-before-retire');f.seed(entry.id,'2');const d=await f.prepare('2'),frozen=structuredClone(d);
  f.phone({identity,fields:fields('A','N1')});f.lost.add('retire');const pending=await f.bridge.execute(d);assert.equal(pending.phase,'retiring');assert.equal(f.saves,1);assert.equal((await f.bridge.execute(d)).phase,'retired');assert.equal(f.repository.lease.ackCursor,'1');assert.deepEqual(d,frozen);
  const next=await f.prepare('2','synthetic-after-retire');assert.notEqual(next.attemptId,d.attemptId);assert.notEqual(next.intent.mutationId,d.intent.mutationId);assert.deepEqual(next.intent.patch,{title:{kind:'known',value:'B'}});assert.equal((await f.bridge.execute(next)).phase,'acknowledged');assert.deepEqual(f.snapshot!.fields,fields('B','N1'));assert.equal(f.saves,2);assert.equal(f.journal.list().find(r=>r.intent.mutationId===d.intent.mutationId)!.phase,'retired');const retries=f.calls.filter(c=>c.operation==='retire');assert.equal(retries.length,2);assert.deepEqual(retries[0],retries[1]);
 }finally{f.close();}
});

test('actual service resolves possibly applied create under a newer transport fence without granting another save',async()=>{
 const f=fixture();try{const entry=(await f.business.mutate(principal.ownerId,'todo',null,{spaceId:config.spaceId,confirmed:true,fields:{title:'A',notes:'N0',dueOn:null,status:'open'}},'synthetic-website-create')).entry;f.seed(entry.id,'1');const d=await f.prepare('1'),apply=f.adapter.apply,resolve=f.adapter.resolveIntent;
  f.adapter.apply=async(...args)=>{await apply(...args);throw Error('synthetic native save succeeded but reply lost');};assert.equal((await f.bridge.execute(d)).phase,'unknown');assert.equal(f.saves,1);assert.equal(f.repository.lease.ackCursor,'0');const claim=f.journal.list()[0].claim!;assert.equal(claim.executionFence,'1');f.repository.lease.fence='2';
  f.adapter.resolveIntent=async()=>({status:'not-found'});assert.equal((await f.bridge.execute(d)).phase,'unknown');assert.equal(f.saves,1);assert.equal(f.repository.delivery!.phase,'claimed');f.adapter.resolveIntent=resolve;assert.equal((await f.bridge.execute(d)).phase,'acknowledged');assert.equal(f.saves,1);assert.equal(f.repository.lease.ackCursor,'1');assert.equal(f.repository.delivery!.claim!.executionFence,'1');assert.equal(f.calls.filter(c=>c.operation==='claim').length,1);
 }finally{f.close();}
});

test('actual historical claim reply on renewed fence cannot authorize the first native save',async()=>{
 const f=fixture();try{const entry=(await f.business.mutate(principal.ownerId,'todo',null,{spaceId:config.spaceId,confirmed:true,fields:{title:'A',notes:'N0',dueOn:null,status:'open'}},'synthetic-website-create')).entry;f.seed(entry.id,'1');const d=await f.prepare('1');f.lost.add('claim');assert.equal((await f.bridge.execute(d)).phase,'claim-pending');assert.equal(f.saves,0);f.repository.lease.fence='2';const blocked=await f.bridge.execute(d);assert.equal(blocked.phase,'blocked');assert.equal(blocked.reason,'claim-authority');assert.equal(blocked.claim!.executionFence,'1');assert.equal(f.saves,0);assert.equal(f.repository.lease.ackCursor,'0');assert.equal(f.calls.filter(c=>c.operation==='retire').length,0);assert.equal((await f.bridge.execute(d)).phase,'blocked');assert.equal(f.saves,0);
 }finally{f.close();}
});
