import {stageFileSchema,ackFileSchema,fileIdSchema,commandKey,fail,publicFile,cleanupEligible,FileHandoffError,type FileHandoffActor,type FileHandoffRepository} from './contracts.ts';
import type {PinnedFileSource} from './source.ts';
import type {PrivateFileBlobs} from './blob-store.ts';

export class FileHandoffService{
 private readonly options:{enabled?:boolean;repository:FileHandoffRepository;source:PinnedFileSource;blobs:PrivateFileBlobs};
 constructor(options:{enabled?:boolean;repository:FileHandoffRepository;source:PinnedFileSource;blobs:PrivateFileBlobs}){this.options=options;}
 private enabled(){if(this.options.enabled!==true)fail(404,'FILE_HANDOFF_DISABLED');}
 async stage(actor:FileHandoffActor,value:unknown,key:string,signal?:AbortSignal){
  this.enabled();const parsed=stageFileSchema.safeParse(value);if(!parsed.success)fail(400,'FILE_INPUT_INVALID');commandKey(key);
  const input=parsed.data;this.options.source.validateUrl(input.file.download_url);
  const claim=await this.options.repository.reserve(actor,input,key);
  // A confirmed command is historical evidence; recover it without reusing an expired URL.
  if(claim.duplicate)return{entry:publicFile(claim.entry),duplicate:true};
  if(claim.recoveryToken){
   try{const blob=await this.options.blobs.inspect(claim.entry.id,claim.recoveryToken);return await this.options.repository.reconcile(actor,claim.entry.id,claim.recoveryToken,blob);}
   catch(error){if(error instanceof FileHandoffError&&['FILE_ACCESS_DENIED','FILE_TARGET_UNAVAILABLE','FILE_TRANSFER_LEASE_LOST'].includes(error.code))throw error;throw new FileHandoffError(503,'FILE_HANDOFF_OUTCOME_UNKNOWN',claim.entry.id);}
  }
  if(!claim.token)fail(409,'FILE_TRANSFER_BUSY');
  let persisted=false,source:Awaited<ReturnType<PinnedFileSource['download']>>|undefined;
  try{
   source=await this.options.source.download(input.file.download_url,signal);
   const blob=await this.options.blobs.put(claim.entry.id,claim.token,source.body,signal);persisted=true;
   return await this.options.repository.publish(actor,claim.entry.id,claim.token,blob);
  }catch(error){if(error instanceof FileHandoffError&&error.code==='FILE_STORAGE_OUTCOME_UNKNOWN')persisted=true;if(error instanceof FileHandoffError)throw new FileHandoffError(error.status,error.code,claim.entry.id);throw error;}
  finally{
   source?.close();
   // Once bytes exist, retain the original and claim for durable receipt reconciliation.
   if(!persisted)await this.options.repository.release(actor,claim.entry.id,claim.token).catch(()=>{});
  }
 }
 async get(actor:FileHandoffActor,id:string){
  this.enabled();fileIdSchema.parse(id);const record=await this.options.repository.get(actor,id,'getFileHandoff');
  return{entry:publicFile(record),cleanupEligible:cleanupEligible(record)};
 }
 async download(actor:FileHandoffActor,id:string){
  this.enabled();fileIdSchema.parse(id);const before=await this.options.repository.get(actor,id,'downloadFileHandoff');
  if(before.state!=='ready'||!before.blob)fail(409,'FILE_NOT_READY');
  const bytes=await this.options.blobs.read(before.blob),current=await this.options.repository.get(actor,id,'downloadFileHandoff');
  if(current.blob?.key!==before.blob.key||current.sha256!==before.sha256||current.bytes!==before.bytes)fail(409,'FILE_CHANGED');
  return{entry:publicFile(current),bytes};
 }
 async acknowledge(actor:FileHandoffActor,value:unknown,key:string){
  this.enabled();if(!actor.consumer)fail(403,'FILE_CONSUMER_REQUIRED');const input=ackFileSchema.safeParse(value);if(!input.success)fail(400,'FILE_ACK_INVALID');commandKey(key);
  return this.options.repository.acknowledge(actor,input.data,key);
 }
}
