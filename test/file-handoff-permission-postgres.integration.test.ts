import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {mkdtemp,realpath,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {setTimeout as delay} from 'node:timers/promises';
import {qualifyFileFixture,fileFixturePool,fileFixture as fixture} from './helpers/file-handoff-stage-pg.ts';
import {verifyFilePermissionPool,verifyFileHandoffPool} from '../src/file-handoff/readiness.ts';import {readCurrentAgentGrant} from '../src/agent-api/runtime.ts';import {AuthorityService} from '../src/agent-authority/service.ts';import {fileActor} from '../src/file-handoff/authorization.ts';
import {createFileHandoffRuntime} from '../src/file-handoff/runtime.ts';import {PostgresFileHandoffs} from '../src/file-handoff/postgres.ts';import {PrivateFileBlobs} from '../src/file-handoff/blob-store.ts';import {PinnedFileSource} from '../src/file-handoff/source.ts';import {FileHandoffService} from '../src/file-handoff/service.ts';import {FileHandoffError} from '../src/file-handoff/contracts.ts';
import {lockCurrentAgentGrant,readPlatformEntryOnClient,PostgresPlatformRepository,type SqlPool,type SqlClient} from '../src/platform/postgres.ts';import {RequirementsService} from '../src/requirements-candidate/service.ts';import {requirements} from '../src/platform/requirements.ts';import {fileHandoffOperations} from '../src/file-handoff/operations.ts';import {BusinessOAuthLedger,intersectOAuthGrant,type OriginalGrant} from '../src/business-mcp-oauth/ledger.ts';

async function waitBlocked(admin:ReturnType<typeof fileFixturePool>,pid:()=>number,blocker:number){const end=Date.now()+4000;while(Date.now()<end){if(pid()>0&&(await admin.query('SELECT $2::int=ANY(pg_blocking_pids($1)) AS blocked',[pid(),blocker])).rows[0].blocked)return;await delay(10);}assert.fail('Expected actual PostgreSQL current-permission lock barrier');}

test('OPT-IN fresh split-owner file permissions, native runtime and same-transaction OAuth/withdrawal fences',{
 skip:process.env.RUN_FILE_HANDOFF_POSTGRES_TESTS!=='1'&&'No separately approved fresh full file-permission PostgreSQL fixture',timeout:90000,
},async t=>{
 await qualifyFileFixture();const admin=fileFixturePool('admin',2),runtime=fileFixturePool('runtime',3),manager=fileFixturePool('manager',2),verifier=fileFixturePool('verifier',2);
 const directory=await realpath(await mkdtemp(join(tmpdir(),'lifeos-file-permissions-pg-'))),ownerId=fixture.ownerId,spaceId=fixture.spaceId,grantId=randomUUID(),sessionId=randomUUID(),sessionToken='synthetic-file-session-'+randomUUID(),scopes=['file-handoff:read','file-handoff:write'];
 const personal={ownerId,ownerEmail:fixture.email,spaceId,databaseName:'lifeos_platform_test_local',baseURL:'https://lifeos.nirvanachow.com',approval:'personal-manual-v1',allowedTypes:['todo','journal'],requirementsEnabled:true} as const;
 const original=async()=>await readCurrentAgentGrant(verifier,grantId,undefined,true) as OriginalGrant|null,fileConfig={directory,allowedOrigins:['https://synthetic-files.example.invalid'],maxBytes:128,maxReservedBytes:32768,timeoutMs:1000};
 try{
  await verifyFileHandoffPool(runtime as SqlPool);await verifyFilePermissionPool(manager as SqlPool,'lifeos_agent_key_manager');await verifyFilePermissionPool(verifier as SqlPool,'lifeos_agent_verifier');
  assert.equal((await admin.query('SELECT enabled FROM lifeos_agent.oauth_business_control')).rows[0].enabled,false,'Native files must work before independent OAuth activation');
  await assert.rejects(runtime.query('SELECT lifeos_agent.file_handoff_identity_ready($1,$2)',[ownerId,spaceId]),{code:'42501'});
  await t.test('native FK triggers coexist with the exact owned immutable-original guards; an additional user trigger is rejected',async()=>{
   const client=await admin.connect();try{
    await client.query('BEGIN');await client.query("CREATE FUNCTION file_handoff_fixture.extra_user_trigger() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW;END$$;CREATE TRIGGER unexpected_file_mutator BEFORE UPDATE ON lifeos_platform.file_handoff FOR EACH ROW EXECUTE FUNCTION file_handoff_fixture.extra_user_trigger()");
    await client.query('SET LOCAL ROLE lifeos_platform_candidate_runtime');
    const sameClient:SqlPool={connect:async()=>({query:(sql,values)=>client.query(sql,values),release:()=>{}})};
    await assert.rejects(verifyFileHandoffPool(sameClient),/FILE_METADATA_SCHEMA_UNAVAILABLE/);
   }finally{await client.query('ROLLBACK');client.release();}
   await verifyFileHandoffPool(runtime as SqlPool);
  });
  await admin.query('INSERT INTO lifeos_agent.apikey(id,"configId","referenceId",key,enabled,"createdAt","updatedAt","expiresAt",metadata,permissions) VALUES($1,\'default\',$2,$3,true,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval \'2 hours\',$4,$5)',[grantId,ownerId,'synthetic-unusable-key-digest',JSON.stringify({spaceId}),JSON.stringify({todo:['read']})]);
  await admin.query('INSERT INTO lifeos_platform.platform_session(id,token,"userId","expiresAt","mfaVerified") VALUES($1,$2,$3,clock_timestamp()+interval \'30 minutes\',true)',[sessionId,sessionToken,ownerId]);
  const grantDigest=(await admin.query('SELECT lifeos_agent.managed_grant_digest($1) AS value',[grantId])).rows[0].value;
  const set=async(revision:number,next:string[],client=manager)=>{const result=await client.query('SELECT lifeos_agent.set_file_handoff_permission($1,$2,$3,$4,$5::text[],$6) AS value',[sessionToken,grantId,grantDigest,revision,next,next.length?'codex':null]);return result.rows[0].value;};
  await t.test('old key/all-business permissions stay untouched and only current owner MFA plus double CAS adds file authority',async()=>{
   assert.equal((await original())?.fileHandoff,undefined);
   for(const pool of [runtime,verifier,manager]){await assert.rejects(pool.query('SELECT * FROM lifeos_agent.file_handoff_permission'),{code:'42501'});await assert.rejects(pool.query('SELECT * FROM lifeos_agent.file_handoff_permission_audit'),{code:'42501'});}
   await assert.rejects(manager.query('SELECT lifeos_agent.set_file_handoff_permission($1,$2,$3,0,$4::text[],NULL)',['not-a-browser-session',grantId,grantDigest,scopes]),{code:'LG401'});
   const first=await set(0,scopes);assert.equal(first.revision,1);assert.deepEqual((await original())!.fileHandoff?.scopes,scopes);assert.deepEqual((await readCurrentAgentGrant(verifier,grantId))!.scopes,['todo:read']);
   await assert.rejects(set(0,scopes),{code:'LG409'});await assert.rejects(manager.query('SELECT lifeos_agent.set_file_handoff_permission($1,$2,$3,1,$4::text[],NULL)',[sessionToken,grantId,'f'.repeat(64),scopes]),{code:'LG409'});
   assert.deepEqual((await admin.query('SELECT permissions::jsonb AS value FROM lifeos_agent.apikey WHERE id=$1',[grantId])).rows[0].value,{todo:['read']});
  });
  const authority=new AuthorityService({ownerId,spaceId,verifyOwner:async()=>({ownerId,spaceId,sessionRef:sessionId}),verifyAgent:async()=>original(),readCurrentAgent:async()=>original()}),trusted=(await authority.resolveAgentActor('synthetic-not-a-real-key'))!,actor=fileActor(trusted);
  const files=await createFileHandoffRuntime(runtime as SqlPool,personal,fileConfig,false,async()=>{}),agent=files.forAgent(trusted),owner=files.forOwner((await authority.resolveOwnerActor(new Headers()))!);
  const requirementsService=new RequirementsService(new PostgresPlatformRepository(runtime as SqlPool,true),personal),target=await requirementsService.mutate(ownerId,null,{spaceId,confirmed:true,fields:{title:'Synthetic permission target',body:'Synthetic only',phaseId:requirements().roadmap!.phases[0].id,priority:'P3',plannedStartOn:null,plannedEndOn:null}},randomUUID());
  const metadata=new PostgresFileHandoffs(runtime as SqlPool,{enabled:true,ownerId,spaceId,maxBytes:128,maxReservedBytes:32768},{authorize:async(client,a,operation)=>{
   // Exercise the original same-client authority primitive used by the runtime, never a self-reported actor scope.
   await client.query("SELECT pg_advisory_xact_lock(hashtextextended('lifeos-business-mcp-oauth-v1',0))");const required=fileHandoffOperations.find(op=>op.id===operation)!.requiredScopes;
   if(!await lockCurrentAgentGrant(client,a.ownerId,{...trusted,operationId:operation},required))throw new FileHandoffError(403,'FILE_ACCESS_DENIED');
  },readTarget:async(client,a,id)=>{const entry=await requirementsService.getInTransaction(a.ownerId,id,{get:(kind,key)=>readPlatformEntryOnClient(client,a.ownerId,kind,key,true)});return entry.sourceId?{id:entry.id,sourceId:entry.sourceId,revision:entry.revision}:null;}});
  let downloads=0;const source=new PinnedFileSource(fileConfig,{lookup:async()=>[{address:'8.8.8.8',family:4}],open:async()=>{downloads++;return{status:200,length:null,mimeType:'text/plain',encoding:null,body:(async function*(){yield Buffer.from('permission-fenced real synthetic bytes');})(),close:()=>{}};}}),service=new FileHandoffService({enabled:true,repository:metadata,source,blobs:new PrivateFileBlobs(fileConfig)});
  const input={file:{file_id:'file_synthetic_explicit_permission',download_url:'https://synthetic-files.example.invalid/original',file_name:'synthetic.txt',mime_type:'text/plain'},requirementId:target.entry.id,retention:{kind:'retained' as const}},key=randomUUID(),saved=await service.stage(actor,input,key);
  await t.test('original target updates preserve file command identity; native website/Codex independently read actual bytes and ACK with CAS',async()=>{
   const fields={...target.entry.fields,title:'Legally updated target'};await requirementsService.mutate(ownerId,target.entry.id,{spaceId,confirmed:true,expectedRevision:target.entry.revision,baselineBinding:null,fields},randomUUID());
   assert.equal((await service.stage(actor,input,key)).entry.id,saved.entry.id);assert.equal(downloads,1);
   assert.deepEqual((await agent.service.download(agent.actor,saved.entry.id)).bytes,Buffer.from('permission-fenced real synthetic bytes'));assert.deepEqual((await owner.service.download(owner.actor,saved.entry.id)).bytes,Buffer.from('permission-fenced real synthetic bytes'));
   const ack={id:saved.entry.id,expectedRevision:2,sha256:saved.entry.sha256!,bytes:saved.entry.bytes!},webKey=randomUUID(),codexKey=randomUUID();
   const web=await owner.service.acknowledge(owner.actor,ack,webKey);assert.equal(web.entry.acknowledgments.website?.sha256,saved.entry.sha256);
   await assert.rejects(agent.service.acknowledge(agent.actor,ack,codexKey),{code:'FILE_REVISION_CONFLICT'});const codex=await agent.service.acknowledge(agent.actor,{...ack,expectedRevision:3},randomUUID());assert.equal(codex.entry.revision,4);
   assert.equal((await owner.service.acknowledge(owner.actor,ack,webKey)).duplicate,true);assert.equal((await service.stage(actor,input,key)).entry.revision,2);
  });
  await t.test('withdrawal holds the original permission row and rejects an earlier writer after the actual SQL lock wait',async()=>{
   const hold=await manager.connect();let pid=0;const observed:SqlPool={connect:async()=>{const client=await runtime.connect();pid=(await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;return client;}};
   const racing=await createFileHandoffRuntime(observed,personal,fileConfig,false,async()=>{}),old=racing.forAgent(trusted);
   try{await hold.query('BEGIN');const blocker=(await hold.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;await set(1,['file-handoff:read'],hold as any);
    const write=old.service.acknowledge(old.actor,{id:saved.entry.id,expectedRevision:4,sha256:saved.entry.sha256!,bytes:saved.entry.bytes!},randomUUID());void write.catch(()=>{});await waitBlocked(admin,()=>pid,blocker);await hold.query('COMMIT');await assert.rejects(write,{code:'FILE_ACCESS_DENIED'});
   }finally{await hold.query('ROLLBACK').catch(()=>{});hold.release();}
   assert.equal((await owner.service.get(owner.actor,saved.entry.id)).entry.revision,4);await assert.rejects(agent.service.get(agent.actor,saved.entry.id),{code:'FILE_ACCESS_DENIED'});
   const current=(await authority.resolveAgentActor('synthetic-not-a-real-key'))!,readOnly=files.forAgent(current);assert.equal((await readOnly.service.get(readOnly.actor,saved.entry.id)).entry.id,saved.entry.id);
  });
  await t.test('file OAuth consent/token wrappers cannot survive current file revocation or claim a consumer identity',async()=>{
   await set(2,scopes);const clientId='https://synthetic-file-client.invalid/metadata',oauth={issuer:personal.baseURL+'/api/platform/auth',resource:personal.baseURL+'/api/platform/mcp',grantId,scopes:[...scopes,'offline_access']},ledger=new BusinessOAuthLedger(runtime as SqlPool,oauth,ownerId,spaceId);
   await admin.query('UPDATE lifeos_agent.oauth_business_control SET enabled=true,grant_id=$1,owner_email=$2,scopes=$3',[grantId,fixture.email,oauth.scopes]);
   await admin.query('INSERT INTO lifeos_platform.platform_oauth_client(id,"clientId",disabled,"skipConsent","tokenEndpointAuthMethod","redirectUris",scopes) VALUES($1,$2,false,false,\'none\',$3::jsonb,$4::jsonb)',[randomUUID(),clientId,JSON.stringify(['https://synthetic-file-client.invalid/callback']),JSON.stringify(oauth.scopes)]);
   await admin.query('INSERT INTO lifeos_platform.platform_oauth_consent(id,"clientId","userId","referenceId",resources,scopes,"createdAt","updatedAt") VALUES($1,$2,$3,\'lifeos-business-mcp-v1\',$4::jsonb,$5::jsonb,clock_timestamp(),clock_timestamp())',[randomUUID(),clientId,ownerId,JSON.stringify([oauth.resource]),JSON.stringify(oauth.scopes)]);
   await ledger.approve(sessionId,clientId,oauth.scopes);const now=Math.floor(Date.now()/1000),claims={iss:oauth.issuer,aud:oauth.resource,sub:ownerId,azp:clientId,client_id:clientId,sid:sessionId,iat:now,exp:now+300,scope:oauth.scopes.join(' ')};
   // Synthetic verified-claim seam; official signature/PKCE are qualified by the original OAuth suite, not this fixture.
   const state=await ledger.register('synthetic-file-token',claims,'authorization_code');assert.ok(state);const current=intersectOAuthGrant(state,(await original())!)!;assert.equal(fileActor(current).consumer,undefined);assert.deepEqual(current.allowedOperationIds,['stageFileHandoff','getFileHandoff']);
   const sameNamespace=fileActor(current).authorityRef;assert.equal(sameNamespace,actor.authorityRef);
   await set(3,[]);await assert.rejects(ledger.approve(sessionId,clientId,oauth.scopes),/DENIED/);assert.equal(await ledger.register('synthetic-file-refreshed-token',claims,'refresh_token'),null);
   const sql=await runtime.connect();try{await sql.query('BEGIN');assert.equal(await lockCurrentAgentGrant(sql as SqlClient,ownerId,{...current,operationId:'stageFileHandoff'},['file-handoff:read','file-handoff:write']),false);await sql.query('ROLLBACK');}finally{sql.release();}
   assert.equal((await owner.service.get(owner.actor,saved.entry.id)).entry.revision,4);
  });
  await t.test('MFA invalidation blocks website authority at the final SQL check and never changes the original',async()=>{
   await admin.query('UPDATE lifeos_platform.platform_session SET "mfaVerified"=false WHERE id=$1',[sessionId]);await assert.rejects(owner.service.get(owner.actor,saved.entry.id),{code:'FILE_ACCESS_DENIED'});
   await admin.query('UPDATE lifeos_platform.platform_session SET "mfaVerified"=true WHERE id=$1',[sessionId]);await set(4,scopes);const beforeLoss=(await authority.resolveAgentActor('synthetic-not-a-real-key'))!,delegated=files.forAgent(beforeLoss);
   await admin.query('UPDATE lifeos_platform.platform_two_factor SET verified=false WHERE "userId"=$1',[ownerId]);assert.equal((await original())?.fileHandoff,undefined);await assert.rejects(delegated.service.get(delegated.actor,saved.entry.id),{code:'FILE_ACCESS_DENIED'});
   assert.equal((await admin.query('SELECT revision FROM lifeos_platform.file_handoff WHERE id=$1',[saved.entry.id])).rows[0].revision,4);
  });
 }finally{await Promise.all([admin.end(),runtime.end(),manager.end(),verifier.end()]);await rm(directory,{recursive:true,force:true});}
});
