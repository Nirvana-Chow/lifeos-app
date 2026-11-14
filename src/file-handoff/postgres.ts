import {randomUUID} from 'node:crypto';
import type {SqlPool,SqlClient} from '../platform/postgres.ts';
import {FileHandoffError,fail,fileIdSchema,fileEntrySchema,stageFileSchema,ackFileSchema,commandKey,stageDigest,sha256,publicFile,type FileHandoffRepository,type FileHandoffActor,type FileOperation,type FileTarget,type StageFileInput,type StoredFile,type BlobReceipt,type AckInput,type FileEntry} from './contracts.ts';

export type FileHandoffAuthority={
 /** Must recheck current grant/OAuth/session and exact operation on this original SQL client. */
 authorize:(client:SqlClient,actor:FileHandoffActor,operation:FileOperation)=>Promise<void>;
 /** Existing authoritative reader: owner/space/current source, never a caller-supplied object. */
 readTarget:(client:SqlClient,actor:FileHandoffActor,id:string)=>Promise<FileTarget|null>;
};
type Options={enabled?:boolean;ownerId:string;spaceId:string;maxBytes?:number;maxReservedBytes?:number;leaseMs?:number};
const instant=(value:unknown)=>value instanceof Date?value.toISOString():value;
function decode(row:Record<string,unknown>):StoredFile{
 try{
  const entry=fileEntrySchema.parse({id:row.id,revision:row.revision,state:row.state,sourceFileId:row.source_file_id,name:row.name,mimeType:row.mime_type,target:row.target,retention:row.retention,sha256:row.sha256,bytes:row.byte_length===null?null:Number(row.byte_length),createdAt:instant(row.created_at),receivedAt:instant(row.received_at),acknowledgments:row.acknowledgments});
  if(entry.state==='ready'){
   if(!entry.sha256||entry.bytes===null||typeof row.blob_key!=='string'||!/^[a-f0-9-]{36}\.[a-f0-9-]{36}\.blob$/.test(row.blob_key)||!entry.receivedAt)throw Error();
   return{...entry,blob:{key:row.blob_key,sha256:entry.sha256,bytes:entry.bytes}};
  }
  if(entry.sha256!==null||entry.bytes!==null||entry.receivedAt!==null||row.blob_key!==null)throw Error();return{...entry,blob:null};
 }catch{return fail(503,'FILE_METADATA_INVALID');}
}
export class PostgresFileHandoffs implements FileHandoffRepository{
 private readonly pool:SqlPool;private readonly options:Options;private readonly authority:FileHandoffAuthority;
 private readonly maxBytes:number;private readonly maxReservedBytes:number;private readonly leaseMs:number;
 constructor(pool:SqlPool,options:Options,authority:FileHandoffAuthority){
  this.pool=pool;this.options=Object.freeze({...options});this.authority=authority;
  this.maxBytes=options.maxBytes??16*1024*1024;this.maxReservedBytes=options.maxReservedBytes??256*1024*1024;this.leaseMs=options.leaseMs??120000;
  if(!Number.isInteger(this.maxBytes)||this.maxBytes<1||this.maxBytes>32*1024*1024||!Number.isSafeInteger(this.maxReservedBytes)||this.maxReservedBytes<this.maxBytes||this.maxReservedBytes>1024*1024*1024||!Number.isInteger(this.leaseMs)||this.leaseMs<60000||this.leaseMs>300000||typeof authority?.authorize!=='function'||typeof authority?.readTarget!=='function')fail(503,'FILE_METADATA_CONFIG_INVALID');
 }
 private check(actor:FileHandoffActor){
  if(this.options.enabled!==true)fail(404,'FILE_HANDOFF_DISABLED');
  if(actor.ownerId!==this.options.ownerId||actor.spaceId!==this.options.spaceId||!/^[A-Za-z0-9:._-]{1,256}$/.test(actor.authorityRef))fail(403,'FILE_ACCESS_DENIED');
 }
 private async transaction<T>(actor:FileHandoffActor,operation:FileOperation,run:(client:SqlClient)=>Promise<T>):Promise<T>{
  this.check(actor);const client=await this.pool.connect().catch(()=>fail(503,'FILE_METADATA_UNAVAILABLE'));let committing=false;
  try{
   await client.query('BEGIN');await client.query("SELECT set_config('lifeos.file_owner',$1,true),set_config('lifeos.file_space',$2,true),set_config('lifeos.owner_id',$1,true)",[actor.ownerId,actor.spaceId]);
   await this.authority.authorize(client,actor,operation);const result=await run(client);committing=true;await client.query('COMMIT');return result;
  }catch(error){await client.query('ROLLBACK').catch(()=>{});if(committing)throw new FileHandoffError(503,'FILE_HANDOFF_OUTCOME_UNKNOWN');if(error instanceof FileHandoffError)throw error;throw new FileHandoffError(503,'FILE_METADATA_UNAVAILABLE');}
  finally{client.release();}
 }
 private async target(client:SqlClient,actor:FileHandoffActor,id:string,sourceId?:string){
  const target=await this.authority.readTarget(client,actor,id);
  if(!target||target.id!==id||!fileIdSchema.safeParse(target.sourceId).success||!Number.isInteger(target.revision)||target.revision<1||sourceId&&target.sourceId!==sourceId)fail(404,'FILE_TARGET_UNAVAILABLE');return{id:target.id,sourceId:target.sourceId,revision:target.revision};
 }
 private async command(client:SqlClient,actor:FileHandoffActor,key:string){
  commandKey(key);await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['file-handoff-command-v1',actor.ownerId,actor.spaceId,actor.authorityRef,key])]);
  return(await client.query('SELECT * FROM lifeos_platform.file_handoff_command WHERE owner_id=$1 AND space_id=$2 AND authority_ref=$3 AND command_key=$4 FOR UPDATE',[actor.ownerId,actor.spaceId,actor.authorityRef,key])).rows[0];
 }
 private async row(client:SqlClient,actor:FileHandoffActor,id:string,lock=false){
  fileIdSchema.parse(id);const row=(await client.query('SELECT *,lease_until>clock_timestamp() AS lease_live FROM lifeos_platform.file_handoff WHERE owner_id=$1 AND space_id=$2 AND id=$3::uuid'+(lock?' FOR UPDATE':''),[actor.ownerId,actor.spaceId,id])).rows[0];
  if(!row)fail(404,'FILE_NOT_FOUND');return row;
 }
 private receipt(value:unknown,current:StoredFile):FileEntry{
  try{const saved=fileEntrySchema.parse((value as {entry:unknown})?.entry);
   if(saved.id!==current.id||saved.state!=='ready'||saved.sha256!==current.sha256||saved.bytes!==current.bytes||saved.sourceFileId!==current.sourceFileId||saved.target.sourceId!==current.target.sourceId)throw Error();return saved;
  }catch{return fail(503,'FILE_RECEIPT_INVALID');}
 }
 async reserve(actor:FileHandoffActor,value:StageFileInput,key:string){
  this.check(actor);const input=stageFileSchema.parse(value),digest=stageDigest(input);let handoffId:string|undefined;
  try{return await this.transaction(actor,'stageFileHandoff',async client=>{
   const prior=await this.command(client,actor,key);
   if(prior){
    if(prior.action!=='stage'||prior.intent_digest!==digest)fail(409,'FILE_COMMAND_CONFLICT');
    const row=await this.row(client,actor,String(prior.file_id),true),entry=decode(row);handoffId=entry.id;await this.target(client,actor,entry.target.id,entry.target.sourceId);
    if(prior.response!==null){const saved=this.receipt(prior.response,entry);return{entry:{...saved,blob:entry.blob},token:null,duplicate:true};}
    if(entry.state!=='pending')fail(503,'FILE_RECEIPT_INVALID');if(row.lease_live===true)fail(409,'FILE_TRANSFER_BUSY');
    // A dead process may already have published bytes. Never replace that original
    // by refetching an expiring URL; only an explicitly released attempt is retryable.
    if(row.transfer_token!==null)return{entry,token:null,recoveryToken:String(row.transfer_token),duplicate:false};
    const token=randomUUID();await client.query("UPDATE lifeos_platform.file_handoff SET transfer_token=$4::uuid,lease_until=clock_timestamp()+($5::double precision*interval '1 millisecond') WHERE owner_id=$1 AND space_id=$2 AND id=$3::uuid",[actor.ownerId,actor.spaceId,entry.id,token,this.leaseMs]);return{entry,token,duplicate:false};
   }
   const target=await this.target(client,actor,input.requirementId);
   const now=Date.now();if(input.retention.kind==='temporary'&&(Date.parse(input.retention.retainUntil)<=now||Date.parse(input.retention.retainUntil)>now+7*86400000))fail(400,'FILE_RETENTION_INVALID');
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['file-handoff-capacity-v1',actor.ownerId,actor.spaceId])]);
   const usage=(await client.query("SELECT count(*)::int AS count,coalesce(sum(CASE WHEN state='ready' THEN byte_length ELSE $3 END),0)::text AS bytes FROM lifeos_platform.file_handoff WHERE owner_id=$1 AND space_id=$2",[actor.ownerId,actor.spaceId,this.maxBytes])).rows[0];
   if(!usage||Number(usage.count)>=128||!Number.isSafeInteger(Number(usage.bytes))||Number(usage.bytes)+this.maxBytes>this.maxReservedBytes)fail(503,'FILE_STORAGE_CAPACITY_UNAVAILABLE');
   const id=randomUUID(),token=randomUUID();handoffId=id;
   const row=(await client.query("INSERT INTO lifeos_platform.file_handoff(owner_id,space_id,id,authority_ref,command_key,source_file_id,name,mime_type,target,retention,transfer_token,lease_until) VALUES($1,$2,$3::uuid,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::uuid,clock_timestamp()+($12::double precision*interval '1 millisecond')) RETURNING *",[actor.ownerId,actor.spaceId,id,actor.authorityRef,key,input.file.file_id,input.file.file_name??'ChatGPT-file.bin',input.file.mime_type??'application/octet-stream',JSON.stringify(target),JSON.stringify(input.retention),token,this.leaseMs])).rows[0];
   await client.query("INSERT INTO lifeos_platform.file_handoff_command(owner_id,space_id,authority_ref,command_key,action,intent_digest,file_id,response) VALUES($1,$2,$3,$4,'stage',$5,$6::uuid,NULL)",[actor.ownerId,actor.spaceId,actor.authorityRef,key,digest,id]);return{entry:decode(row),token,duplicate:false};
  });}catch(error){if(error instanceof FileHandoffError&&['FILE_HANDOFF_OUTCOME_UNKNOWN','FILE_TRANSFER_BUSY'].includes(error.code))throw new FileHandoffError(error.status,error.code,handoffId);throw error;}
 }
 async publish(actor:FileHandoffActor,id:string,token:string,blob:BlobReceipt){
  return this.complete(actor,id,token,blob,false);
 }
 async reconcile(actor:FileHandoffActor,id:string,previousToken:string,blob:BlobReceipt){
  return this.complete(actor,id,previousToken,blob,true);
 }
 private async complete(actor:FileHandoffActor,id:string,token:string,blob:BlobReceipt,recover:boolean){
  if(blob.key!==id+'.'+token+'.blob'||!/^[a-f0-9]{64}$/.test(blob.sha256)||!Number.isInteger(blob.bytes)||blob.bytes<0||blob.bytes>this.maxBytes)fail(400,'FILE_BLOB_INVALID');
  return this.transaction(actor,'stageFileHandoff',async client=>{
   const initial=await this.row(client,actor,id);if(initial.authority_ref!==actor.authorityRef)fail(403,'FILE_ACCESS_DENIED');
   const command=await this.command(client,actor,String(initial.command_key));
   const row=await this.row(client,actor,id,true),entry=decode(row);
   if(!command||command.action!=='stage'||command.file_id!==id||row.state!=='pending'||row.transfer_token!==token||row.lease_live!==!recover)fail(409,'FILE_TRANSFER_LEASE_LOST');
   await this.target(client,actor,entry.target.id,entry.target.sourceId);
   // Existing complete bytes are immutable. A fresh token fences the old writer
   // before ready is committed; a missing/partial original never reaches this path.
   const completingToken=recover?randomUUID():token;
   if(recover)await client.query('UPDATE lifeos_platform.file_handoff SET transfer_token=$4::uuid WHERE owner_id=$1 AND space_id=$2 AND id=$3::uuid',[actor.ownerId,actor.spaceId,id,completingToken]);
   const completed=await client.query("UPDATE lifeos_platform.file_handoff SET state='ready',revision=revision+1,blob_key=$4,sha256=$5,byte_length=$6,received_at=clock_timestamp(),transfer_token=NULL,lease_until=NULL WHERE owner_id=$1 AND space_id=$2 AND id=$3::uuid AND state='pending' AND transfer_token=$7::uuid AND ($8::boolean OR lease_until>clock_timestamp()) RETURNING *",[actor.ownerId,actor.spaceId,id,blob.key,blob.sha256,blob.bytes,completingToken,recover]);
   if(completed.rows.length!==1)fail(409,'FILE_TRANSFER_LEASE_LOST');const saved=decode(completed.rows[0]);
   const response={entry:publicFile(saved),duplicate:false};await client.query('UPDATE lifeos_platform.file_handoff_command SET response=$5::jsonb WHERE owner_id=$1 AND space_id=$2 AND authority_ref=$3 AND command_key=$4',[actor.ownerId,actor.spaceId,actor.authorityRef,String(initial.command_key),JSON.stringify(response)]);return response;
  });
 }
 async release(actor:FileHandoffActor,id:string,token:string){
  await this.transaction(actor,'stageFileHandoff',async client=>{await client.query("UPDATE lifeos_platform.file_handoff SET transfer_token=NULL,lease_until=NULL WHERE owner_id=$1 AND space_id=$2 AND id=$3::uuid AND authority_ref=$4 AND state='pending' AND transfer_token=$5::uuid",[actor.ownerId,actor.spaceId,id,actor.authorityRef,token]);});
 }
 async get(actor:FileHandoffActor,id:string,operation:FileOperation='getFileHandoff'){
  if(!['getFileHandoff','downloadFileHandoff'].includes(operation))fail(403,'FILE_ACCESS_DENIED');
  return this.transaction(actor,operation,async client=>{const entry=decode(await this.row(client,actor,id));await this.target(client,actor,entry.target.id,entry.target.sourceId);return entry;});
 }
 async acknowledge(actor:FileHandoffActor,value:AckInput,key:string){
  this.check(actor);if(actor.consumer!=='website'&&actor.consumer!=='codex')fail(403,'FILE_CONSUMER_REQUIRED');const input=ackFileSchema.parse(value),digest=sha256(JSON.stringify({consumer:actor.consumer,input}));
  return this.transaction(actor,'acknowledgeFileHandoff',async client=>{
   const prior=await this.command(client,actor,key);if(prior&&(prior.action!=='ack'||prior.intent_digest!==digest||prior.file_id!==input.id))fail(409,'FILE_COMMAND_CONFLICT');
   const row=await this.row(client,actor,input.id,true),entry=decode(row);await this.target(client,actor,entry.target.id,entry.target.sourceId);
   if(prior){if(!prior.response)fail(503,'FILE_RECEIPT_INVALID');return{entry:this.receipt(prior.response,entry),duplicate:true};}
   if(entry.state!=='ready')fail(409,'FILE_NOT_READY');if(entry.revision!==input.expectedRevision)fail(409,'FILE_REVISION_CONFLICT');if(entry.sha256!==input.sha256||entry.bytes!==input.bytes)fail(409,'FILE_ACK_MISMATCH');
   const ack={sha256:entry.sha256,bytes:entry.bytes,receivedAt:new Date().toISOString()},acknowledgments={...entry.acknowledgments,[actor.consumer!]:ack};
   const saved=decode((await client.query('UPDATE lifeos_platform.file_handoff SET revision=revision+1,acknowledgments=$4::jsonb WHERE owner_id=$1 AND space_id=$2 AND id=$3::uuid RETURNING *',[actor.ownerId,actor.spaceId,input.id,JSON.stringify(acknowledgments)])).rows[0]);
   const response={entry:publicFile(saved),duplicate:false};await client.query("INSERT INTO lifeos_platform.file_handoff_command(owner_id,space_id,authority_ref,command_key,action,intent_digest,file_id,response) VALUES($1,$2,$3,$4,'ack',$5,$6::uuid,$7::jsonb)",[actor.ownerId,actor.spaceId,actor.authorityRef,key,digest,input.id,JSON.stringify(response)]);return response;
  });
 }
}
