import assert from 'node:assert/strict';
import test from 'node:test';
import type {SqlClient} from '../src/platform/postgres.ts';
import {FileHandoffError,stageDigest,type FileHandoffActor,type StageFileInput} from '../src/file-handoff/contracts.ts';
const actor:FileHandoffActor={ownerId:'synthetic-owner',spaceId:'synthetic-space',authorityRef:'synthetic-grant'};
const input:StageFileInput={file:{download_url:'https://synthetic.invalid/file',file_id:'file_synthetic'},requirementId:'LO-FILES-001',retention:{kind:'retained'}};
async function implementation(){const module=await import('../src/file-handoff/postgres.ts').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return null;throw error;});assert.ok(module,'the actual PostgreSQL metadata adapter must exist');return module;}
test('metadata remains closed and rejects foreign bindings before opening a database connection',async()=>{
 const {PostgresFileHandoffs}=await implementation();let connections=0;
 const pool={connect:async()=>{connections++;throw Error('not allowed');}},authority={authorize:async()=>{},readTarget:async()=>null};
 const options={ownerId:actor.ownerId,spaceId:actor.spaceId};
 await assert.rejects(new PostgresFileHandoffs(pool,options,authority).reserve(actor,input,'synthetic-closed'),{code:'FILE_HANDOFF_DISABLED'});
 await assert.rejects(new PostgresFileHandoffs(pool,{...options,enabled:true},authority).reserve({...actor,spaceId:'other-space'},input,'synthetic-foreign'),{code:'FILE_ACCESS_DENIED'});assert.equal(connections,0);
});
test('database connection failure exposes only the bounded metadata error',async()=>{
 const {PostgresFileHandoffs}=await implementation();
 const store=new PostgresFileHandoffs({connect:async()=>{throw Error('synthetic-private-database-endpoint');}},{enabled:true,ownerId:actor.ownerId,spaceId:actor.spaceId},{authorize:async()=>{},readTarget:async()=>null});
 await assert.rejects(store.reserve(actor,input,'synthetic-db-unavailable'),(error:any)=>{assert.equal(error.code,'FILE_METADATA_UNAVAILABLE');assert.equal(error.message.includes('synthetic-private-database-endpoint'),false);return true;});
});
test('revoked authority is fenced on the original transaction before metadata reads or writes',async()=>{
 const {PostgresFileHandoffs}=await implementation(),calls:string[]=[];
 const client:SqlClient={query:async sql=>{calls.push(sql);return{rows:[],rowCount:0};},release:()=>{calls.push('RELEASE');}};
 const store=new PostgresFileHandoffs({connect:async()=>client},{enabled:true,ownerId:actor.ownerId,spaceId:actor.spaceId},{authorize:async seen=>{assert.equal(seen,client);calls.push('AUTHORITY');throw new FileHandoffError(403,'FILE_ACCESS_DENIED');},readTarget:async()=>{throw Error('must not read targets');}});
 await assert.rejects(store.reserve(actor,input,'synthetic-revoked'),{code:'FILE_ACCESS_DENIED'});
 assert.equal(calls[0],'BEGIN');assert.equal(calls[2],'AUTHORITY');assert.deepEqual(calls.slice(-2),['ROLLBACK','RELEASE']);assert.equal(calls.some(sql=>/INSERT|UPDATE|FROM lifeos_platform/.test(sql)),false);
});
test('arbitrary requirement text is never accepted as a verified target and cannot create a file row',async()=>{
 const {PostgresFileHandoffs}=await implementation(),calls:string[]=[];
 const client:SqlClient={query:async sql=>{calls.push(sql);return{rows:[],rowCount:0};},release:()=>{}};
 const store=new PostgresFileHandoffs({connect:async()=>client},{enabled:true,ownerId:actor.ownerId,spaceId:actor.spaceId},{authorize:async()=>{},readTarget:async(seen,a,id)=>{assert.equal(seen,client);assert.deepEqual(a,actor);assert.equal(id,'LO-FILES-001');return null;}});
 await assert.rejects(store.reserve(actor,input,'synthetic-target'),{code:'FILE_TARGET_UNAVAILABLE'});assert.equal(calls.some(sql=>/^\s*(?:INSERT|UPDATE)\b/.test(sql)),false);assert.equal(calls.at(-1),'ROLLBACK');
});
test('an expired unconfirmed transfer is unknown rather than silently replacing potentially persisted original bytes',async()=>{
 const {PostgresFileHandoffs}=await implementation(),calls:string[]=[];
 const id='00000000-0000-4000-8000-000000000001',token='00000000-0000-4000-8000-000000000002',sourceId='00000000-0000-4000-8000-000000000003';
 const target={id:input.requirementId,sourceId,revision:1},row={id,revision:1,state:'pending',source_file_id:input.file.file_id,name:'ChatGPT-file.bin',mime_type:'application/octet-stream',target,retention:input.retention,sha256:null,byte_length:null,blob_key:null,created_at:new Date(),received_at:null,acknowledgments:{},lease_live:false,transfer_token:token as string|null};
 const prior={action:'stage',intent_digest:stageDigest(input),file_id:id,response:null};
 const client:SqlClient={query:async sql=>{calls.push(sql);return{rows:sql.startsWith('SELECT * FROM lifeos_platform.file_handoff_command')?[prior]:sql.startsWith('SELECT *,lease_until')?[row]:[],rowCount:0};},release:()=>{}};
 const store=new PostgresFileHandoffs({connect:async()=>client},{enabled:true,ownerId:actor.ownerId,spaceId:actor.spaceId},{authorize:async()=>{},readTarget:async()=>target});
 await assert.rejects(store.reserve(actor,input,'synthetic-unknown-transfer'),{code:'FILE_HANDOFF_OUTCOME_UNKNOWN'});assert.equal(calls.some(sql=>/^\s*(INSERT|UPDATE)\b/.test(sql)),false);
 // A released attempt explicitly confirmed that no completed blob was returned.
 row.transfer_token=null;calls.length=0;const retry=await store.reserve(actor,input,'synthetic-unknown-transfer');
 assert.equal(retry.duplicate,false);assert.ok(retry.token);assert.notEqual(retry.token,token);assert.equal(calls.filter(sql=>sql.startsWith('UPDATE lifeos_platform.file_handoff SET transfer_token')).length,1);
});
test('a verified hexadecimal blob reaches current authority while a forged checksum is rejected before SQL',async()=>{
 const {PostgresFileHandoffs}=await implementation();let connections=0;
 const client:SqlClient={query:async()=>({rows:[],rowCount:0}),release:()=>{}};
 const store=new PostgresFileHandoffs({connect:async()=>{connections++;return client;}},{enabled:true,ownerId:actor.ownerId,spaceId:actor.spaceId},{authorize:async()=>{throw new FileHandoffError(403,'FILE_ACCESS_DENIED');},readTarget:async()=>null});
 const id='00000000-0000-4000-8000-000000000001',token='00000000-0000-4000-8000-000000000002',blob={key:id+'.'+token+'.blob',sha256:'a'.repeat(64),bytes:12};
 await assert.rejects(store.publish(actor,id,token,blob),{code:'FILE_ACCESS_DENIED'});assert.equal(connections,1);
 await assert.rejects(store.publish(actor,id,token,{...blob,sha256:'z'.repeat(64)}),{code:'FILE_BLOB_INVALID'});assert.equal(connections,1);
});
test('acknowledgment requires a trusted consumer, current revision and exact independently computed bytes/checksum',async()=>{
 const {PostgresFileHandoffs}=await implementation(),calls:string[]=[];
 const id='00000000-0000-4000-8000-000000000001',sourceId='00000000-0000-4000-8000-000000000002';
 const target={id:'LO-FILES-001',sourceId,revision:1},row={id,revision:2,state:'ready',source_file_id:'file_synthetic',name:'original.txt',mime_type:'text/plain',target,retention:{kind:'retained'},sha256:'a'.repeat(64),byte_length:'12',created_at:new Date(),received_at:new Date(),acknowledgments:{},blob_key:id+'.'+sourceId+'.blob'};
 const client:SqlClient={query:async sql=>{calls.push(sql);return{rows:sql.startsWith('SELECT *,lease_until')?[structuredClone(row)]:[],rowCount:0};},release:()=>{}};
 const store=new PostgresFileHandoffs({connect:async()=>client},{enabled:true,ownerId:actor.ownerId,spaceId:actor.spaceId},{authorize:async()=>{},readTarget:async()=>target});
 const ack={id,expectedRevision:2,sha256:'a'.repeat(64),bytes:12};
 await assert.rejects(store.acknowledge(actor,ack,'synthetic-no-consumer'),{code:'FILE_CONSUMER_REQUIRED'});assert.equal(calls.length,0);
 await assert.rejects(store.acknowledge({...actor,consumer:'website'},{...ack,expectedRevision:1},'synthetic-stale-ack'),{code:'FILE_REVISION_CONFLICT'});
 await assert.rejects(store.acknowledge({...actor,consumer:'codex'},{...ack,bytes:11},'synthetic-wrong-bytes'),{code:'FILE_ACK_MISMATCH'});
 await assert.rejects(store.acknowledge({...actor,consumer:'codex'},{...ack,sha256:'b'.repeat(64)},'synthetic-wrong-sha'),{code:'FILE_ACK_MISMATCH'});
 assert.equal(calls.some(sql=>/^\s*(INSERT|UPDATE)\b/.test(sql)),false);
});
