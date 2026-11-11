import test from 'node:test';
import assert from 'node:assert/strict';
import {PostgresPlatformRepository,type SqlClient} from '../src/platform/postgres.ts';
import {assertPostgresExecutionLease} from '../src/requirement-events/transaction.ts';
import {openRequirementNotifications} from '../src/requirement-events/notifications.ts';
import {EventEmitter} from 'node:events';
const binding={id:'11111111-1111-4111-8111-111111111111',sourceId:'22222222-2222-4222-8222-222222222222',spaceId:'synthetic-space',requirementId:'LO-REQ-001',holderId:'synthetic-mac',grantId:'synthetic-grant',fence:2,workDigest:'a'.repeat(64)};
test('lease fence obtains wall clock after the row lock, rejects expiry/reclaim, and never opens another connection',async()=>{
 const trace:string[]=[];let expired=false,fence=2;
 const client={query:async(sql:string)=>{trace.push(sql);if(sql.includes('FOR UPDATE')){expired=true;return{rows:[{lease_id:binding.id,lease_fence:fence,lease_holder:binding.holderId,lease_grant_id:binding.grantId,work_digest:binding.workDigest,source_id:binding.sourceId,dispatch_state:'running',lease_expires_at:'2026-01-01T00:00:01Z'}],rowCount:1};}return{rows:[{now:expired?'2026-01-01T00:00:02Z':'2026-01-01T00:00:00Z'}],rowCount:1};},release:()=>{throw Error('must not release caller transaction');}};
 await assert.rejects(assertPostgresExecutionLease(client,'synthetic-owner',binding),{code:'EXECUTION_LEASE_LOST'});assert.ok(trace.findIndex(x=>x.includes('FOR UPDATE'))<trace.findIndex(x=>x.includes('clock_timestamp')));
 fence=3;await assert.rejects(assertPostgresExecutionLease(client,'synthetic-owner',binding),{code:'EXECUTION_LEASE_LOST'});
});
test('original repository exposes the lease fence only behind an explicit opt-in and holds its owner transaction to commit',async()=>{
 const trace:string[]=[];let connections=0;
 const client:SqlClient={query:async(sql,values)=>{trace.push(sql);return{rows:sql.includes('FOR UPDATE')?[{lease_id:binding.id,lease_fence:binding.fence,lease_holder:binding.holderId,lease_grant_id:binding.grantId,work_digest:binding.workDigest,source_id:binding.sourceId,dispatch_state:'running',lease_expires_at:'2026-01-01T01:00:00Z'}]:[{now:'2026-01-01T00:00:00Z'}],rowCount:1};},release:()=>{trace.push('release');}};
 const pool={connect:async()=>{connections++;return client;}};
 await new PostgresPlatformRepository(pool).transaction('synthetic-owner','synthetic-key-001',async tx=>{assert.equal(tx.assertRequirementExecutionLease,undefined);});
 trace.length=0;connections=0;
 await new PostgresPlatformRepository(pool,false,false,undefined,true).transaction('synthetic-owner','synthetic-key-002',async tx=>{await tx.assertRequirementExecutionLease!(binding);assert.equal(trace.includes('COMMIT'),false);});
 assert.equal(connections,1);assert.ok(trace.indexOf('COMMIT')>trace.findIndex(x=>x.includes('FOR UPDATE')));assert.equal(trace.at(-1),'release');
});
test('NOTIFY is bounded/coalesced and notification cleanup releases the dedicated connection',async()=>{
 const client=new EventEmitter() as EventEmitter&SqlClient;let released=0;client.query=async()=>({rows:[],rowCount:0});client.release=()=>{released++;};
 const notifications=await openRequirementNotifications({connect:async()=>client});
 for(let i=0;i<1000;i++)client.emit('notification',{channel:'lifeos_requirement_events',payload:'ignored'});
 await notifications.wait(new AbortController().signal);assert.equal(released,0);await notifications.close();assert.equal(client.listenerCount('notification'),0);assert.equal(released,1);
});
