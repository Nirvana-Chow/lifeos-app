import {z} from 'zod';import {join,resolve} from 'node:path';import {randomUUID} from 'node:crypto';
import {constants,lstatSync,realpathSync} from 'node:fs';import {lstat,open,link,unlink,readdir} from 'node:fs/promises';
import {DurableStore} from '../mcp-candidate/native-store.mjs';import {LifeOSApiClient,type OperationResult} from '../mcp-candidate/client.ts';
import type {McpRuntimeOptions} from '../mcp-candidate/config.ts';
import {PrivateFileBlobs} from './blob-store.ts';import {verifiedFileBytes} from './web-client.ts';
import {FileHandoffError,fail,sha256,commandKey,fileIdSchema,fileEntrySchema,openAiFileSchema,type FileEntry} from './contracts.ts';
const origin='https://lifeos.nirvanachow.com';
export const fileReceiveInput=z.strictObject({id:fileIdSchema,filename:openAiFileSchema.shape.file_name.unwrap().refine(value=>Buffer.byteLength(value)<=240),idempotencyKey:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/),acknowledgmentKey:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/).optional()});
type Options={directory:string;adoption:{version:'file-handoff-v1';credentialFingerprint:string};beforeUse:()=>Promise<void>;nativeRequest:NonNullable<McpRuntimeOptions['nativeRequest']>;nativeBinaryRequest:(path:string)=>Promise<{response:Response;credentialFingerprint:string}>};
type Transfer={requestId:string;transport:'file-receive-v1';key:string;id:string;filename:string;sha256:string;bytes:number;token:string;directoryRef:string};
/** Explicit adopted-host library. No credential reader, environment fallback, installer or daemon. */
export class FileReceiver{
 readonly #options:Options;readonly #transfers:DurableStore;readonly #commands:DurableStore;readonly #api:LifeOSApiClient;readonly #blobs:PrivateFileBlobs;
 constructor(options:Options){
  if(options?.adoption?.version!=='file-handoff-v1'||!/^[a-f0-9]{64}$/.test(options.adoption.credentialFingerprint)||typeof options.beforeUse!=='function'||typeof options.nativeRequest!=='function'||typeof options.nativeBinaryRequest!=='function')fail(403,'FILE_RECEIVER_NOT_ADOPTED');
  try{const info=lstatSync(options.directory);if(resolve(options.directory)!==options.directory||realpathSync(options.directory)!==options.directory||!info.isDirectory()||info.uid!==process.getuid?.()||info.mode&0o077)throw Error();}catch{fail(503,'FILE_RECEIVER_DIRECTORY_INVALID');}
  this.#options=Object.freeze({...options,adoption:Object.freeze({...options.adoption})});
  try{this.#transfers=new DurableStore(join(options.directory,'.file-receive-v1'),options.adoption.credentialFingerprint);this.#commands=new DurableStore(join(options.directory,'.file-ack-v1'),options.adoption.credentialFingerprint);}catch{fail(503,'FILE_RECEIVER_STORE_INVALID');}
  this.#api=new LifeOSApiClient({origin,nativeRequest:options.nativeRequest,beforeUse:options.beforeUse,durable:this.#commands,fileHandoff:'file-handoff-v1'});
  this.#blobs=new PrivateFileBlobs({directory:options.directory,maxBytes:32*1024*1024});
 }
 async available(){const catalog=await this.#api.discover();return ['getFileHandoff','downloadFileHandoff','acknowledgeFileHandoff'].every(id=>catalog.operations.some(operation=>operation.id===id));}
 ownsAcknowledgment(requestId:string){return this.#commands.pending(requestId)?.operationId==='acknowledgeFileHandoff';}
 async #metadata(id:string):Promise<FileEntry>{
  const result=await this.#api.execute('getFileHandoff',{id});if(!result.ok)fail(result.status||503,'FILE_RECEIVE_AUTHORITY_UNAVAILABLE');const entry=fileEntrySchema.parse(result.data?.entry);if(entry.id!==id||entry.state!=='ready'||!entry.sha256||entry.bytes===null)fail(409,'FILE_NOT_READY');return entry;
 }
 async #exists(path:string){try{return await lstat(path);}catch(error){if((error as {code?:string}).code==='ENOENT')return null;throw error;}}
 async #sync(){const fd=await open(this.#options.directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await fd.sync();}finally{await fd.close();}}
 async #readLocal(request:Transfer,links=1){
  const fd=await open(join(this.#options.directory,request.filename),constants.O_RDONLY|constants.O_NOFOLLOW);try{
   const info=await fd.stat();if(!info.isFile()||info.uid!==process.getuid?.()||info.mode&0o077||info.nlink!==links||info.size!==request.bytes)fail(503,'FILE_LOCAL_ORIGINAL_UNAVAILABLE');
   const bytes=Buffer.alloc(request.bytes+1);let length=0;while(length<bytes.length){const part=await fd.read(bytes,length,bytes.length-length);if(!part.bytesRead)break;length+=part.bytesRead;}
   if(length!==request.bytes||sha256(bytes.subarray(0,length))!==request.sha256)fail(503,'FILE_LOCAL_CHECKSUM_MISMATCH');
  }finally{await fd.close();}
 }
 async #receiveBytes(request:Transfer,entry:FileEntry){
  await this.#blobs.checkReady();const target=join(this.#options.directory,request.filename),opaque=join(this.#options.directory,request.id+'.'+request.token+'.blob'),destination=await this.#exists(target),staged=await this.#exists(opaque);
  if(destination){
   if(staged){if(destination.dev!==staged.dev||destination.ino!==staged.ino)fail(503,'FILE_LOCAL_OUTCOME_UNKNOWN');await this.#readLocal(request,2);await unlink(opaque);}
   await this.#readLocal(request);await this.#sync();return;
  }
  if(!staged){
   const path='/v1/file-handoffs/'+request.id+'/content',result=await this.#options.nativeBinaryRequest(path);
   if(result.credentialFingerprint!==this.#options.adoption.credentialFingerprint||result.response.url&&result.response.url!==origin+'/api/platform/agent'+path){await result.response.body?.cancel().catch(()=>{});fail(403,'FILE_BINARY_BINDING_CHANGED');}
   const bytes=await verifiedFileBytes(result.response,entry),blob=await this.#blobs.put(request.id,request.token,(async function*(){yield bytes;})());
   if(blob.sha256!==request.sha256||blob.bytes!==request.bytes)fail(503,'FILE_LOCAL_CHECKSUM_MISMATCH');
  }else{const blob=await this.#blobs.inspect(request.id,request.token);if(blob.sha256!==request.sha256||blob.bytes!==request.bytes)fail(503,'FILE_LOCAL_CHECKSUM_MISMATCH');}
  await link(opaque,target);await unlink(opaque);await this.#sync();await this.#readLocal(request);
 }
 async receive(value:unknown):Promise<{file:{id:string;filename:string;sha256:string;bytes:number};acknowledgment:OperationResult}>{
  const parsed=fileReceiveInput.safeParse(value);if(!parsed.success)fail(400,'FILE_RECEIVE_INPUT_INVALID');const input=parsed.data;
  try{return await this.#transfers.exclusive(async()=>{
   const prior=this.#transfers.findRequestByKey(input.idempotencyKey) as Transfer|undefined,directoryRef=sha256(this.#options.directory);
   if(prior&&(prior.transport!=='file-receive-v1'||prior.id!==input.id||prior.filename!==input.filename||prior.directoryRef!==directoryRef))fail(409,'FILE_ORIGINAL_RECEIVE_REQUIRED');
   if(!prior&&await this.#exists(join(this.#options.directory,input.filename)))fail(409,'FILE_DESTINATION_EXISTS');
   const entry=await this.#metadata(input.id),request:Transfer=prior??{requestId:randomUUID(),transport:'file-receive-v1',key:input.idempotencyKey,id:input.id,filename:input.filename,sha256:entry.sha256!,bytes:entry.bytes!,token:randomUUID(),directoryRef};
   if(request.sha256!==entry.sha256||request.bytes!==entry.bytes)fail(409,'FILE_ORIGINAL_CHANGED');
   if(!prior){
    const records=(await readdir(join(this.#options.directory,'.file-receive-v1'))).filter(name=>/^[a-f0-9-]{36}\.json$/.test(name));let reserved=0;
    for(const name of records){const record=this.#transfers.pending(name.slice(0,-5));if(record?.transport!=='file-receive-v1'||!Number.isSafeInteger(record.bytes)||record.bytes<0||record.bytes>32*1024*1024)fail(409,'FILE_FOREIGN_RECOVERY_REQUIRED');reserved+=record.bytes;}
    if(records.length>=128||reserved+request.bytes>256*1024*1024)fail(503,'FILE_RECEIVE_CAPACITY_UNAVAILABLE');
    this.#transfers.prepare(request);
   }
   await this.#receiveBytes(request,entry);const current=await this.#metadata(request.id);
   if(current.sha256!==request.sha256||current.bytes!==request.bytes)fail(409,'FILE_ORIGINAL_CHANGED');
   let activeKey=this.#transfers.settled(request.requestId)?.data?.acknowledgmentKey??request.key;commandKey(activeKey);
   const localReceipt={id:request.id,filename:request.filename,sha256:request.sha256,bytes:request.bytes};
   const remember=()=>this.#transfers.receipt(request.requestId,{status:200,data:{...localReceipt,acknowledgmentKey:activeKey}});remember();
   const old=this.#commands.findRequestByKey(activeKey);let acknowledgment:OperationResult;
   if(!old&&input.acknowledgmentKey&&input.acknowledgmentKey!==activeKey)fail(409,'FILE_ORIGINAL_ACK_UNRESOLVED');
   if(old){
    if(Object.hasOwn(old,'transport')||old.operationId!=='acknowledgeFileHandoff')fail(409,'FILE_FOREIGN_RECOVERY_REQUIRED');
    const args=JSON.parse(old.argsJSON);if(args.id!==request.id||args.sha256!==request.sha256||args.bytes!==request.bytes)fail(409,'FILE_ORIGINAL_RECEIVE_REQUIRED');
    acknowledgment=await this.#api.retry(old.requestId);
    if(input.acknowledgmentKey&&input.acknowledgmentKey!==activeKey&&!acknowledgment.ok){
     if(acknowledgment.status!==409||current.revision<=args.expectedRevision)fail(409,'FILE_ORIGINAL_ACK_UNRESOLVED');
     activeKey=input.acknowledgmentKey;remember();acknowledgment=await this.#ack(current,activeKey);
    }
   }else acknowledgment=await this.#ack(current,activeKey);
   const result={file:{id:request.id,filename:request.filename,sha256:request.sha256,bytes:request.bytes},acknowledgment};this.#transfers.finish(request.requestId,result);return result;
  });}catch(error){if(error instanceof FileHandoffError)throw error;throw new FileHandoffError(503,'FILE_RECEIVE_OUTCOME_UNKNOWN');}
 }
 async #ack(entry:FileEntry,key:string){return this.#api.execute('acknowledgeFileHandoff',{id:entry.id,expectedRevision:entry.revision,sha256:entry.sha256,bytes:entry.bytes,idempotencyKey:commandKey(key)});}
}
