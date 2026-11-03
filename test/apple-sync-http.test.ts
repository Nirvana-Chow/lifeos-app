import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppleSyncHandler} from '../src/apple-sync-candidate/http.ts';
import {AppleSyncService} from '../src/apple-sync-candidate/service.ts';
import type {SyncPrincipal} from '../src/apple-sync-candidate/store-contracts.ts';
import {SyncMemory,syntheticPersonalConfig,syntheticNativeIdentity,syntheticTodoFields,syntheticCapabilities} from './helpers/apple-sync-memory.ts';
const baseURL='https://lifeos.example.invalid',p:SyncPrincipal={ownerId:'synthetic-owner',spaceId:'synthetic-space',bridgeId:'synthetic-mac',identityEpoch:'epoch-one',scopes:['sync:read','sync:write']};
let transactions=0;
const service=new AppleSyncService({repository:{transaction:async()=>{transactions++;throw Error('private-database-path-and-content');}},personal:{ownerId:p.ownerId,ownerEmail:'owner@example.invalid',spaceId:p.spaceId,databaseName:'lifeos_platform_test_local',allowedTypes:['todo'],approval:'personal-manual-v1',baseURL}});
const request=(operation='capabilities',body:unknown={},headers:Record<string,string>={},method='POST')=>new Request(baseURL+'/api/platform/personal/apple-sync/'+operation,{method,headers:{host:'lifeos.example.invalid','content-type':'application/json','idempotency-key':'synthetic-http-01',...headers},...(method==='GET'?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
test('closed default or absent trusted principal provider cannot call storage',async()=>{
 transactions=0;for(const options of [{},{enabled:true},{enabled:true,principalReader:async()=>null}]){const response=await createAppleSyncHandler({baseURL,service,...options})(request());assert.equal(response.status,503);assert.match(response.headers.get('cache-control')! ,/no-store/);}assert.equal(transactions,0);
});
test('trusted scoped device can read capabilities; cookies, cross-origin and identity injection reject',async()=>{
 const handler=createAppleSyncHandler({baseURL,service,enabled:true,principalReader:async()=>p});
 assert.equal((await handler(request())).status,200);
 for(const headers of [{cookie:'session=synthetic'},{origin:'https://foreign.invalid'},{host:'foreign.invalid'}] as Record<string,string>[])assert.equal((await handler(request('capabilities',{},headers))).status,403);
 assert.equal((await handler(request('capabilities',{ownerId:p.ownerId}))).status,400);
 assert.equal((await createAppleSyncHandler({baseURL,service,enabled:true,principalReader:async()=>({...p,ownerId:'other-owner'})})(request())).status,403);
});
test('body limits, duplicate keys, queries and arbitrary execution keys fail closed',async()=>{
 const handler=createAppleSyncHandler({baseURL,service,enabled:true,principalReader:async()=>p});
 for(const body of ['{"ttlSeconds":5,"ttlSeconds":6}',{sql:'SELECT private'},'{"x":'])assert.equal((await handler(request('lease',body))).status,400);
 assert.equal((await handler(request('lease',{ttlSeconds:5,padding:'x'.repeat(140000)}))).status,413);
 assert.equal((await handler(request('capabilities?owner=other'))).status,400);
 assert.equal((await handler(request('command',{command:'rm'}))).status,404);
 assert.equal((await handler(request('capabilities',{}, {},'GET'))).status,405);
});
test('read-only identity and absent independent business permit cannot lease; failures reveal no private message',async()=>{
 const handler=createAppleSyncHandler({baseURL,service,enabled:true,principalReader:async()=>p});const response=await handler(request('lease',{ttlSeconds:10}));assert.equal(response.status,503);assert.equal((await response.json()).error.code,'SYNC_WRITES_LOCKED');
 assert.equal((await createAppleSyncHandler({baseURL,service,enabled:true,principalReader:async()=>({...p,scopes:['sync:read']})})(request('lease',{ttlSeconds:10}))).status,403);
 const bad=createAppleSyncHandler({baseURL,service,enabled:true,principalReader:async()=>{throw Error('private-credential-value');}});const failed=await bad(request());assert.equal(failed.status,503);assert.ok(!(await failed.text()).includes('private-credential-value'));
});
test('HTTP delivery pipeline exposes only frozen envelopes and requires a fresh save authorization',async()=>{
 const repository=new SyncMemory();let writable=true;
 const actual=new AppleSyncService({repository,personal:syntheticPersonalConfig,assertWritable:async()=>{if(!writable)throw Error('private revoked permit');},now:()=>new Date('2026-11-03T00:00:00Z')});
 const handler=createAppleSyncHandler({baseURL,service:actual,enabled:true,principalReader:async()=>p});
 const call=async(operation:string,body:unknown,key:string)=>{const r=await handler(request(operation,body,{'idempotency-key':key}));assert.equal(r.status,200);return r.json();};
 const observed=await call('observation',{fence:'1',kind:'todo',mappingId:null,entityId:null,sourceId:null,expectedRevision:null,identity:syntheticNativeIdentity,fields:syntheticTodoFields(),capabilities:syntheticCapabilities},'http-observation');
 // Deliberately manual synthetic outbox; this does not test PG capture.
 const row=repository.platform.rows.get(observed.entityId)!;repository.outbox.push({cursor:'1',kind:'todo',entityId:row.id,sourceId:row.source.id,revision:row.revision,commandKey:'http-outbox-seed',snapshot:structuredClone(row)});
 const pulled=await call('pull',{fence:'1',after:'0',limit:5},'http-pull');assert.equal('snapshot'in pulled.items[0],false);assert.equal('intent'in pulled.items[0],false);
 const prepare={fence:'1',cursor:'1',expectedDeliveryVersion:null},prepared=await call('prepare',prepare,'http-prepare'),d=prepared.delivery;assert.deepEqual(Object.keys(prepared),['delivery']);
 const claimed=await call('claim',{fence:'1',attemptId:d.attemptId,intentHash:d.intentHash,expectedDeliveryVersion:d.version},'http-claim'),c=claimed.claim;
 const auth={fence:'1',attemptId:d.attemptId,intentHash:d.intentHash,claimId:c.claimId,claimVersion:c.claimVersion,executionFence:c.executionFence};assert.equal((await call('authorize-save',auth,'http-authorize')).authorized,true);
 writable=false;assert.equal((await handler(request('authorize-save',auth,{'idempotency-key':'http-authorize'}))).status,503);assert.equal((await handler(request('prepare',prepare,{'idempotency-key':'http-prepare'}))).status,503);writable=true;
 const proof={mutationId:d.intent.mutationId,intentHash:d.intentHash,identity:syntheticNativeIdentity,fields:d.intent.expectedFields};
 const verified=await call('receipt',{fence:'1',attemptId:d.attemptId,intentHash:d.intentHash,expectedDeliveryVersion:c.claimVersion,claimId:c.claimId,proof,capabilities:syntheticCapabilities},'http-receipt');assert.deepEqual(Object.keys(verified).sort(),['acknowledgement','receipt']);assert.equal('format'in verified,false);
 const ack=await call('ack',{fence:'1',attemptId:d.attemptId,receiptKey:'http-receipt',acknowledgement:verified.acknowledgement},'http-ack');assert.deepEqual(ack,{acknowledgement:verified.acknowledgement});assert.deepEqual(await call('prepare',prepare,'http-prepare'),prepared);assert.equal(repository.delivery!.phase,'acknowledged');
 for(const operation of ['prepare','claim','authorize-save','retire','receipt','ack']){const ro=createAppleSyncHandler({baseURL,service:actual,enabled:true,principalReader:async()=>({...p,scopes:['sync:read']})});assert.equal((await ro(request(operation,{}))).status,403);}
});
