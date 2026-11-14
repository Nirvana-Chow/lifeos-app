import {PostgresPlatformRepository,lockCurrentAgentGrant,readPlatformEntryOnClient,type SqlPool,type SqlClient} from '../platform/postgres.ts';
import {RequirementsService} from '../requirements-candidate/service.ts';
import type {PersonalConfig} from '../personal-candidate/config.ts';
import type {TrustedAgentActor,TrustedOwnerActor} from '../agent-authority/contracts.ts';
import {ownerMaintenanceKey} from '../deployment-candidate/owner-maintenance-key.ts';
import {PlatformError} from '../platform/domain.ts';
import {FileHandoffError,fail,sha256,type FileHandoffActor,type FileOperation} from './contracts.ts';
import {fileActor} from './authorization.ts';
import {PostgresFileHandoffs,type FileHandoffAuthority} from './postgres.ts';
import {PrivateFileBlobs} from './blob-store.ts';
import {PinnedFileSource} from './source.ts';
import {FileHandoffService} from './service.ts';
import {fileHandoffOperations} from './operations.ts';
import {verifyFileHandoffPool} from './readiness.ts';
import type {readFileHandoffConfig} from './config.ts';

export type FileSession={actor:FileHandoffActor;service:FileHandoffService};
export async function createFileHandoffRuntime(pool:SqlPool,personal:PersonalConfig,config:NonNullable<ReturnType<typeof readFileHandoffConfig>>,policyEnabled=false,assertWritable:()=>Promise<void>=async()=>fail(503,'FILE_WRITES_LOCKED')){
 await verifyFileHandoffPool(pool);
 const blobs=new PrivateFileBlobs(config);await blobs.checkReady();const source=new PinnedFileSource(config);
 const requirements=new RequirementsService(new PostgresPlatformRepository(pool,true),personal);
 const beginAuthority=async(client:SqlClient)=>{
  await client.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))',[ownerMaintenanceKey(personal.ownerId)]);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('lifeos-business-mcp-oauth-v1',0))");
 };
 const readTarget:FileHandoffAuthority['readTarget']=async(client,actor,id)=>{
  try{const entry=await requirements.getInTransaction(actor.ownerId,id,{get:(kind,recordId)=>readPlatformEntryOnClient(client,actor.ownerId,kind,recordId,true)});return entry.sourceId?{id:entry.id,sourceId:entry.sourceId,revision:entry.revision}:null;}
  catch(error){if(error instanceof PlatformError&&error.status===404)return null;throw error;}
 };
 const session=(actor:FileHandoffActor,authorize:FileHandoffAuthority['authorize']):FileSession=>({actor,service:new FileHandoffService({enabled:true,blobs,source,repository:new PostgresFileHandoffs(pool,{enabled:true,ownerId:personal.ownerId,spaceId:personal.spaceId,maxBytes:config.maxBytes,maxReservedBytes:config.maxReservedBytes},{authorize,readTarget})})});
 const bound=(actor:FileHandoffActor)=>{if(actor.ownerId!==personal.ownerId||actor.spaceId!==personal.spaceId)fail(403,'FILE_ACCESS_DENIED');};
 return{
  ready:async()=>{await verifyFileHandoffPool(pool);await blobs.checkReady();return true;},
  forAgent(grant:TrustedAgentActor):FileSession{
   const actor=fileActor(grant);bound(actor);
   return session(actor,async(client,seen,operation:FileOperation)=>{
    if(seen!==actor)fail(403,'FILE_ACCESS_DENIED');await beginAuthority(client);if(['stageFileHandoff','acknowledgeFileHandoff'].includes(operation))await assertWritable();
    const required=fileHandoffOperations.find(entry=>entry.id===operation)!.requiredScopes;
    if(!await lockCurrentAgentGrant(client,actor.ownerId,{...grant,operationId:operation},required,policyEnabled))throw new FileHandoffError(403,'FILE_ACCESS_DENIED');
   });
  },
  forOwner(owner:TrustedOwnerActor):FileSession{
   const actor:FileHandoffActor=Object.freeze({ownerId:owner.ownerId,spaceId:owner.spaceId,authorityRef:'owner:'+sha256(JSON.stringify([owner.ownerId,owner.spaceId])),consumer:'website'});bound(actor);
   return session(actor,async(client,seen,operation)=>{
    if(seen!==actor)fail(403,'FILE_ACCESS_DENIED');await beginAuthority(client);if(['stageFileHandoff','acknowledgeFileHandoff'].includes(operation))await assertWritable();
    const result=await client.query('SELECT lifeos_agent.assert_file_handoff_owner($1,$2,$3,$4) AS allowed',[owner.sessionRef,actor.ownerId,actor.spaceId,personal.ownerEmail]);if(result.rows[0]?.allowed!==true)fail(403,'FILE_ACCESS_DENIED');
   });
  },
 };
}
export type FileHandoffRuntime=Awaited<ReturnType<typeof createFileHandoffRuntime>>;
