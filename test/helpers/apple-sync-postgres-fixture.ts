import assert from 'node:assert/strict';
import type {Pool,PoolClient} from 'pg';
import {acceptancePool,validateAcceptanceEnvironment} from './platform-pg.ts';
import {verifyAppleSyncPool} from '../../src/apple-sync-candidate/postgres.ts';
import type {SqlPool} from '../../src/platform/postgres.ts';
/** Public synthetic CI fixture string; never discovers credentials or accepts arbitrary targets. */
export const appleSyncFixtureTarget='postgresql://lifeos_platform_candidate_runtime:fixture-ci-runtime-never-live@127.0.0.1:55432/lifeos_platform_test_local';
export function readAppleSyncAcceptance(env:Record<string,string|undefined>,args:readonly string[]){
 if(env.RUN_APPLE_SYNC_POSTGRES_TESTS!=='1'||env.LIFEOS_PLATFORM_TEST_APPROVAL!=='approved-isolated-fixtures'||env.LIFEOS_PLATFORM_TEST_DATABASE_URL!==appleSyncFixtureTarget)throw Error('Explicit exact synthetic Apple sync fixture required');
 return validateAcceptanceEnvironment(env,args);
}
/** No DDL, bootstrapping, grants or cleanup. Setup must apply approved migrations first. */
export async function openAppleSyncFixture(env:Record<string,string|undefined>,args:readonly string[]){
 const config=readAppleSyncAcceptance(env,args),pool=acceptancePool(config.databaseURL);
 try{
  const target=(await pool.query("SELECT current_database() AS database,current_user AS role,current_setting('server_version_num') AS version")).rows[0];
  assert.deepEqual(target,{database:'lifeos_platform_test_local',role:'lifeos_platform_candidate_runtime',version:'170011'},'Exact PostgreSQL 17.11 synthetic runtime required');
  await verifyAppleSyncPool(pool as SqlPool);
  const identities=(await pool.query('SELECT id,name,email FROM lifeos_platform.platform_user ORDER BY id')).rows;
  assert.deepEqual(identities,[{id:'fixture-owner-a',name:'Synthetic owner A',email:'fixture@example.invalid'},{id:'fixture-owner-b',name:'Synthetic owner B',email:'other@example.invalid'}],'Existing exact synthetic owners required; no real identities accepted');
  return{config,pool};
 }catch(error){await pool.end();throw error;}
}
export async function fixtureOwner<T>(pool:Pool,owner:string,fn:(client:PoolClient)=>Promise<T>):Promise<T>{
 if(!['fixture-owner-a','fixture-owner-b'].includes(owner))throw Error('Synthetic fixture owner required');
 const client=await pool.connect();try{await client.query('BEGIN');await client.query("SELECT set_config('lifeos.owner_id',$1,true)",[owner]);const value=await fn(client);await client.query('COMMIT');return value;}catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}
}
export type SqlTrace={pid:number;sql:string};
export function traceFixturePool(pool:Pool){
 const calls:SqlTrace[]=[];const connected=deferred<number>();
 const traced:SqlPool={connect:async()=>{const client=await pool.connect();const pid=Number((await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);connected.resolve(pid);return{query:async(sql,values)=>{calls.push({pid,sql});const result=await client.query(sql,values);return{rows:result.rows,rowCount:result.rowCount};},release:()=>client.release()};}};
 return{pool:traced,calls,connected:connected.promise};
}
export function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return{promise,resolve};}
export async function bounded<T>(promise:Promise<T>,milliseconds=2000):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Synthetic fixture synchronization timed out')),milliseconds);})]);}finally{clearTimeout(timer);}}
/** Query the actual backend wait state; elapsed sleep alone is never blocking evidence. */
export async function requireAdvisoryWait(pool:Pool,pid:number):Promise<void>{
 const deadline=Date.now()+2000;
 while(Date.now()<deadline){const row=(await pool.query('SELECT wait_event_type AS kind,wait_event AS event FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0];if(row?.kind==='Lock'&&row.event==='advisory')return;await new Promise(resolve=>setTimeout(resolve,25));}
 throw Error('Expected actual PostgreSQL advisory lock wait was not observed');
}

import {randomUUID} from 'node:crypto';
import {canonicalDigest} from '../../src/apple-sync-candidate/domain.ts';
import type {ActiveDelivery,DeliveryCommandArchive,SyncPrincipal} from '../../src/apple-sync-candidate/store-contracts.ts';
import type {JsonValue} from '../../src/apple-sync-candidate/contracts.ts';
/** Explicit synthetic protocol evidence; no native target or inferred execution. */
export function issuedDeliveryFixture(p:SyncPrincipal,entry:{id:string;source:{id:string};revision:number},version='1',cursor='1'):ActiveDelivery{
 const fields={title:{kind:'known' as const,value:'Synthetic delivery only'}},intent={mutationId:'fixture-delivery-'+randomUUID(),cursor,kind:'reminder' as const,operation:'create' as const,entityId:entry.id,sourceId:entry.source.id,revision:entry.revision,target:null,expectedNativeHash:null,patch:fields,expectedFields:fields,scope:'single' as const};
 return{format:'lifeos.apple-sync.delivery.v1',version,attemptId:randomUUID(),binding:{ownerId:p.ownerId,spaceId:p.spaceId,bridgeId:p.bridgeId,identityEpoch:p.identityEpoch},phase:'issued',cursor,canonicalRevision:entry.revision,intent,intentHash:canonicalDigest(intent),preparedMapping:null,claim:null,receipt:null,retirement:null};
}
export function deliveryArchiveFixture(delivery:ActiveDelivery):JsonValue{
 const operations={issued:'prepare',claimed:'claim','readback-verified':'receipt',acknowledged:'ack','retired-unapplied':'retire'} as const;
 const archive:DeliveryCommandArchive={format:'lifeos.apple-sync.delivery-command.v1',operation:operations[delivery.phase],delivery:structuredClone(delivery),response:{synthetic:true}};
 return archive as unknown as JsonValue;
}
export function retiredDeliveryFixture(issued:ActiveDelivery,outcome:'reconciled'|'conflict'='reconciled'):ActiveDelivery{
 return{...structuredClone(issued),version:String(BigInt(issued.version)+1n),phase:'retired-unapplied',retirement:{commandKey:'fixture-retirement-'+randomUUID(),reason:'native-precondition-changed',observation:{identity:{storeEpoch:'fixture-store',sourceId:'fixture-account',containerId:'fixture-container',itemId:'fixture-item',externalId:null,aliases:[],seriesId:null,originalOccurrenceDate:null},fields:issued.intent.expectedFields},outcome,evidence:{synthetic:true}}};
}
