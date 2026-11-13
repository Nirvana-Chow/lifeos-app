import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,mkdtemp,realpath,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {Pool} from 'pg';
import {PostgresFileHandoffs,type FileHandoffAuthority} from '../src/file-handoff/postgres.ts';
import {FileHandoffService} from '../src/file-handoff/service.ts';
import {PrivateFileBlobs} from '../src/file-handoff/blob-store.ts';
import {PinnedFileSource} from '../src/file-handoff/source.ts';
import {FileHandoffError,type FileHandoffActor,type StageFileInput} from '../src/file-handoff/contracts.ts';
import {PostgresPlatformRepository,verifyRestrictedPool,type SqlClient,type SqlPool} from '../src/platform/postgres.ts';
import {RequirementsService} from '../src/requirements-candidate/service.ts';
import {readPlatformEntryOnClient} from '../src/platform/postgres.ts';
import {qualifyFileFixture,fileFixtureSqlFiles} from './helpers/file-handoff-stage-pg.ts';
import {requirements} from '../src/platform/requirements.ts';

const ownerId='file-handoff-fixture-owner',spaceId='file-handoff-fixture-space';
const actor:FileHandoffActor={ownerId,spaceId,authorityRef:'synthetic-file-authority'};
const sqlFiles=fileFixtureSqlFiles;

// Separately prepared fresh target only. This runner never creates schemas, roles or grants.
test('OPT-IN fresh restricted PostgreSQL file bytes, receipts, fences, CAS and unknown outcomes',{
 skip:process.env.RUN_FILE_HANDOFF_POSTGRES_TESTS!=='1'&&'No separately approved fresh file-handoff PostgreSQL fixture',timeout:90000,
},async t=>{
 await qualifyFileFixture();const env=process.env;
 assert.equal(env.LIFEOS_FILE_HANDOFF_TEST_APPROVAL,'approved-isolated-file-handoff-v2');assert.ok(process.execArgv.includes('--test-isolation=none'));assert.notEqual(env.CI,'true');assert.notEqual(env.GITHUB_ACTIONS,'true');
 assert.match(env.LIFEOS_FILE_HANDOFF_FIXTURE_ID??'',/^file-handoff-v2-[a-z0-9-]{8,80}$/);
 assert.match(env.LIFEOS_FILE_HANDOFF_CONTAINER_ID??'',/^[a-f0-9]{12,64}$/);assert.match(env.LIFEOS_FILE_HANDOFF_IMAGE_ID??'',/^sha256:[a-f0-9]{64}$/);assert.ok(env.LIFEOS_FILE_HANDOFF_FORWARD_SESSION);
 const sourceSha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();assert.equal(env.LIFEOS_FILE_HANDOFF_SOURCE_SHA,sourceSha);
 execFileSync('git',['diff','--quiet','HEAD','--','src/file-handoff','db/0022_file_handoff.proposed.sql','test/file-handoff*.test.ts']);
 const url=new URL(env.LIFEOS_FILE_HANDOFF_TEST_DATABASE_URL!),adminUrl=new URL(env.LIFEOS_FILE_HANDOFF_TEST_ADMIN_URL!);
 assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55452');assert.equal(url.username,'lifeos_platform_candidate_runtime');assert.match(url.pathname,/^\/lifeos_platform_test_[a-z0-9_]+$/);assert.equal(url.search,'');
 assert.equal(adminUrl.hostname,url.hostname);assert.equal(adminUrl.port,url.port);assert.equal(adminUrl.pathname,url.pathname);assert.equal(adminUrl.username,'postgres');assert.equal(adminUrl.search,'');
 const open=(connectionString=url.href,max=4)=>new Pool({connectionString,max,connectionTimeoutMillis:2000,statement_timeout:10000,lock_timeout:5000,idle_in_transaction_session_timeout:15000,options:'-c search_path=pg_catalog,lifeos_platform'});
 const pool=open(),admin=open(adminUrl.href,1);let reopened:Pool|undefined;
 const directory=await realpath(await mkdtemp(join(tmpdir(),'lifeos-synthetic-file-pg-')));
 try{
  await verifyRestrictedPool(pool as SqlPool);
  const identity=(await admin.query("SELECT current_setting('server_version_num') AS version,current_setting('data_directory') AS data,current_database() AS database,current_user AS role,inet_server_port() AS port,host(inet_server_addr()) AS address")).rows[0];
  assert.match(identity.address,/^(?:10\.|172\.(?:1[6-9]|2[0-9]|3[01])\.|192\.168\.)/);
  assert.deepEqual({...identity,address:'docker-private'},{version:'170011',data:'/var/lib/postgresql/data',database:url.pathname.slice(1),role:'postgres',port:5432,address:'docker-private'});
  const sourceDigest=createHash('sha256').update(JSON.stringify(await Promise.all(sqlFiles.map(async name=>({name,text:await readFile('db/'+name,'utf8')}))))).digest('hex');
  assert.deepEqual((await admin.query('SELECT fixture_id,source_digest,source_sha,lock_digest,container_id,image_id FROM file_handoff_fixture.identity')).rows,[{fixture_id:env.LIFEOS_FILE_HANDOFF_FIXTURE_ID,source_digest:sourceDigest,source_sha:sourceSha,lock_digest:createHash('sha256').update(await readFile('package-lock.json')).digest('hex'),container_id:env.LIFEOS_FILE_HANDOFF_CONTAINER_ID,image_id:env.LIFEOS_FILE_HANDOFF_IMAGE_ID}]);
  const tables=['file_handoff','file_handoff_command'];
  for(const name of tables){
   const acl=(await pool.query(`SELECT relrowsecurity AS rls,relforcerowsecurity AS forced,has_table_privilege(current_user,oid,'SELECT') AND has_table_privilege(current_user,oid,'INSERT') AND has_table_privilege(current_user,oid,'UPDATE') AS required,has_table_privilege(current_user,oid,'DELETE,TRUNCATE,REFERENCES,TRIGGER') AS excessive FROM pg_class WHERE oid=$1::regclass`,['lifeos_platform.'+name])).rows;
   assert.deepEqual(acl,[{rls:true,forced:true,required:true,excessive:false}]);assert.equal((await pool.query('SELECT * FROM lifeos_platform.'+name)).rowCount,0);
  }
  const personal={ownerId,ownerEmail:'file-handoff@example.test',spaceId,databaseName:url.pathname.slice(1),baseURL:'https://file-handoff.example.test',approval:'personal-manual-v1',allowedTypes:['todo','journal','project','domain','topic'],requirementsEnabled:true} as const;
  const native=new RequirementsService(new PostgresPlatformRepository(pool as SqlPool,true),personal);
  const created=await native.mutate(ownerId,null,{spaceId,confirmed:true,fields:{title:'Synthetic file target',body:'Synthetic PostgreSQL file handoff only',phaseId:requirements().roadmap!.phases[0].id,priority:'P3',plannedStartOn:null,plannedEndOn:null}},randomUUID());
  const targetId=created.entry.id;
  const authority:FileHandoffAuthority={
   // Isolated synthetic SQL authority port, not the shared OAuth/current-grant integration.
   authorize:async(client,a,operation)=>{
    const row=(await client.query('SELECT enabled,operations FROM file_handoff_fixture.authority WHERE owner_id=$1 AND space_id=$2 AND id=$3 FOR SHARE',[a.ownerId,a.spaceId,a.authorityRef])).rows[0];
    if(!row||row.enabled!==true||!Array.isArray(row.operations)||!row.operations.includes(operation))throw new FileHandoffError(403,'FILE_ACCESS_DENIED');
   },
   readTarget:async(client,a,id)=>{
    const tx={get:(kind:Parameters<typeof readPlatformEntryOnClient>[2],recordId:string)=>readPlatformEntryOnClient(client,a.ownerId,kind,recordId,true)};
    try{const value=await native.getInTransaction(a.ownerId,id,tx);return value.sourceId?{id:value.id,sourceId:value.sourceId,revision:value.revision}:null;}catch{return null;}
   },
  };
  let downloads=0;
  const source=new PinnedFileSource({allowedOrigins:['https://synthetic-files.example.invalid'],maxBytes:128,timeoutMs:1000},{lookup:async()=>[{address:'8.8.8.8',family:4}],open:async()=>{downloads++;return{status:200,length:null,mimeType:'text/plain',encoding:null,body:(async function*(){yield Buffer.from('real PostgreSQL-linked synthetic file\n');})(),close:()=>{}};}});
  const blobs=new PrivateFileBlobs({directory,maxBytes:128}),options={enabled:true,ownerId,spaceId,maxBytes:128,maxReservedBytes:32768},repository=new PostgresFileHandoffs(pool as SqlPool,options,authority),service=new FileHandoffService({enabled:true,repository,source,blobs});
  const input:StageFileInput={file:{download_url:'https://synthetic-files.example.invalid/file?signature=synthetic',file_id:'file_synthetic_pg',file_name:'synthetic.txt',mime_type:'text/plain'},requirementId:targetId,retention:{kind:'retained'}};
  await t.test('real bytes persist once under concurrent original command and fresh pool reads the same receipt',async()=>{
   const key=randomUUID(),results=await Promise.allSettled([service.stage(actor,input,key),service.stage(actor,input,key)]);
   assert.ok(results.some(result=>result.status==='fulfilled'));for(const result of results)if(result.status==='rejected')assert.equal(result.reason.code,'FILE_TRANSFER_BUSY');
   const saved=await service.stage(actor,input,key);assert.equal(saved.duplicate,true);assert.equal(downloads,1);
   assert.deepEqual((await service.download(actor,saved.entry.id)).bytes,Buffer.from('real PostgreSQL-linked synthetic file\n'));
   reopened=open();const reload=new PostgresFileHandoffs(reopened as SqlPool,options,authority);assert.equal((await reload.get(actor,saved.entry.id)).sha256,saved.entry.sha256);
   await assert.rejects(service.stage(actor,{...input,file:{...input.file,file_name:'changed.txt'}},key),{code:'FILE_COMMAND_CONFLICT'});
   const ack={id:saved.entry.id,expectedRevision:saved.entry.revision,sha256:saved.entry.sha256!,bytes:saved.entry.bytes!},webKey=randomUUID(),codexKey=randomUUID();
   const acked=await Promise.allSettled([service.acknowledge({...actor,consumer:'website'},ack,webKey),service.acknowledge({...actor,consumer:'codex'},ack,codexKey)]);
   assert.equal(acked.filter(result=>result.status==='fulfilled').length,1);assert.equal((acked.find(result=>result.status==='rejected') as PromiseRejectedResult).reason.code,'FILE_REVISION_CONFLICT');
   const current=(await service.get(actor,saved.entry.id)).entry,failedConsumer=acked[0].status==='rejected'?'website':'codex',retryKey=failedConsumer==='website'?webKey:codexKey;
   // A rejected CAS creates no receipt; retry that same key with the current revision.
   await service.acknowledge({...actor,consumer:failedConsumer},{...ack,expectedRevision:current.revision},retryKey);
   const final=(await service.get(actor,saved.entry.id)).entry;assert.equal(final.revision,4);assert.deepEqual(Object.keys(final.acknowledgments).sort(),['codex','website']);
   assert.equal((await service.stage(actor,input,key)).entry.revision,2);
   const winner=acked[0].status==='fulfilled'?'website':'codex',winnerKey=winner==='website'?webKey:codexKey;
   const historical=await service.acknowledge({...actor,consumer:winner},ack,winnerKey);assert.equal(historical.duplicate,true);assert.equal(historical.entry.revision,3);
   const c=await pool.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('lifeos.file_owner',$1,true),set_config('lifeos.file_space',$2,true)",[ownerId,spaceId]);
    await assert.rejects(c.query("UPDATE lifeos_platform.file_handoff SET sha256=$2 WHERE id=$1::uuid",[saved.entry.id,'b'.repeat(64)]),/immutable/);await c.query('ROLLBACK');
   }finally{c.release();}
  });
  await t.test('lost committed publication returns unknown and the original key recovers without refetch',async()=>{
   let lose=true;
   const lossy:SqlPool={connect:async()=>{const client=await pool.connect();let publishes=false;return{query:async(sql,values)=>{if(sql.startsWith("UPDATE lifeos_platform.file_handoff SET state='ready'"))publishes=true;const result=await client.query(sql,values);if(sql==='COMMIT'&&publishes&&lose){lose=false;throw Error('synthetic lost committed receipt');}return result;},release:()=>client.release()};}};
   const lost=new FileHandoffService({enabled:true,repository:new PostgresFileHandoffs(lossy,options,authority),source,blobs}),key=randomUUID(),before=downloads;
   await assert.rejects(lost.stage(actor,input,key),{code:'FILE_HANDOFF_OUTCOME_UNKNOWN'});
   const recovered=await service.stage(actor,{...input,file:{...input.file,download_url:'https://synthetic-files.example.invalid/refreshed'}},key);assert.equal(recovered.duplicate,true);assert.equal(downloads,before+1);assert.equal((await service.get(actor,recovered.entry.id)).entry.sha256,recovered.entry.sha256);
  });
  await t.test('revocation, unverified targets and expired unconfirmed leases cannot publish or replace an original',async()=>{
   await assert.rejects(service.stage(actor,{...input,requirementId:randomUUID()},randomUUID()),{code:'FILE_TARGET_UNAVAILABLE'});
   await assert.rejects(service.stage({...actor,spaceId:'foreign-space'},input,randomUUID()),{code:'FILE_ACCESS_DENIED'});
   const key=randomUUID(),claim=await repository.reserve(actor,input,key);assert.ok(claim.token);
   const original=Buffer.from('unconfirmed unique original'),blob=await blobs.put(claim.entry.id,claim.token!,(async function*(){yield original;})());
   await admin.query('UPDATE file_handoff_fixture.authority SET enabled=false WHERE id=$1',[actor.authorityRef]);
   await assert.rejects(repository.publish(actor,claim.entry.id,claim.token!,blob),{code:'FILE_ACCESS_DENIED'});await assert.rejects(service.get(actor,claim.entry.id),{code:'FILE_ACCESS_DENIED'});
   await admin.query('UPDATE file_handoff_fixture.authority SET enabled=true WHERE id=$1',[actor.authorityRef]);await admin.query("UPDATE lifeos_platform.file_handoff SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1::uuid",[claim.entry.id]);
   const before=downloads,reconciled=await service.stage(actor,input,key);assert.equal(reconciled.entry.id,claim.entry.id);assert.equal(downloads,before);assert.deepEqual(await blobs.read(blob),original);assert.equal((await service.get(actor,claim.entry.id)).entry.state,'ready');
   await assert.rejects(repository.publish(actor,claim.entry.id,claim.token!,blob),{code:'FILE_TRANSFER_LEASE_LOST'});
   const missingKey=randomUUID(),missing=await repository.reserve(actor,input,missingKey);await admin.query("UPDATE lifeos_platform.file_handoff SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1::uuid",[missing.entry.id]);
   await assert.rejects(service.stage(actor,input,missingKey),(error:any)=>{assert.equal(error.code,'FILE_HANDOFF_OUTCOME_UNKNOWN');assert.equal(error.handoffId,missing.entry.id);return true;});assert.equal(downloads,before);assert.equal((await service.get(actor,missing.entry.id)).entry.state,'pending');
  });
  for(const name of tables){assert.equal((await pool.query('SELECT * FROM lifeos_platform.'+name)).rowCount,0);await assert.rejects(pool.query('DELETE FROM lifeos_platform.'+name),{code:'42501'});}
  assert.equal((await readdir(directory)).some(name=>name.startsWith('.tmp-')),false);
  t.diagnostic('Actual isolated PostgreSQL + synthetic bytes verified; shared OAuth/HTTP/MCP/real-file acceptance remains separate.');
 }finally{await Promise.all([pool.end(),admin.end(),reopened?.end()]);await rm(directory,{recursive:true,force:true});}
});
