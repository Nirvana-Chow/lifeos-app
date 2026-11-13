import {constants} from 'node:fs';
import {open,lstat,realpath,link,unlink,statfs} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {type BlobReceipt,FileHandoffError,fail,fileIdSchema,checksumSchema} from './contracts.ts';

export class PrivateFileBlobs{
 readonly directory:string;readonly maxBytes:number;
 constructor(options:{directory:string;maxBytes:number}){
  if(resolve(options.directory)!==options.directory||!Number.isInteger(options.maxBytes)||options.maxBytes<1||options.maxBytes>32*1024*1024)fail(503,'FILE_STORAGE_CONFIG_INVALID');
  this.directory=options.directory;this.maxBytes=options.maxBytes;
 }
 private async checkedDirectory(){
  const info=await lstat(this.directory);
  if(!info.isDirectory()||info.uid!==process.getuid?.()||info.mode&0o077||await realpath(this.directory)!==this.directory)fail(503,'FILE_STORAGE_CONFIG_INVALID');
 }
 private async syncDirectory(){const fd=await open(this.directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await fd.sync();}finally{await fd.close();}}
 async checkReady(){try{await this.checkedDirectory();}catch{fail(503,'FILE_STORAGE_CONFIG_INVALID');}}
 async put(id:string,token:string,body:AsyncIterable<Uint8Array>,signal?:AbortSignal):Promise<BlobReceipt>{
  try{return await this.write(id,token,body,signal);}catch(error){if(error instanceof FileHandoffError)throw error;throw new FileHandoffError(503,'FILE_STORAGE_UNAVAILABLE');}
 }
 private async write(id:string,token:string,body:AsyncIterable<Uint8Array>,signal?:AbortSignal):Promise<BlobReceipt>{
  fileIdSchema.parse(id);fileIdSchema.parse(token);await this.checkedDirectory();
  if(signal?.aborted)fail(400,'FILE_CANCELLED');
  const space=await statfs(this.directory);if(space.bavail*space.bsize<this.maxBytes+128*1024*1024)fail(503,'FILE_STORAGE_CAPACITY_UNAVAILABLE');
  const temporary=join(this.directory,'.tmp-'+randomUUID()),key=id+'.'+token+'.blob',target=join(this.directory,key);
  const fd=await open(temporary,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);let bytes=0,closed=false,published=false;
  try{
   const hash=createHash('sha256');
   for await(const chunk of body){
    if(signal?.aborted)fail(400,'FILE_CANCELLED');
    if(!(chunk instanceof Uint8Array))fail(502,'FILE_SOURCE_INVALID');bytes+=chunk.length;if(bytes>this.maxBytes)fail(413,'FILE_TOO_LARGE');
    for(let offset=0;offset<chunk.length;){const result=await fd.write(chunk,offset,chunk.length-offset);if(!result.bytesWritten)fail(503,'FILE_STORAGE_UNAVAILABLE');offset+=result.bytesWritten;}
    hash.update(chunk);
   }
   if(signal?.aborted)fail(400,'FILE_CANCELLED');await fd.sync();await fd.close();closed=true;
   // link is atomic and refuses an existing target; never overwrite a unique original.
   await link(temporary,target);published=true;await unlink(temporary);await this.syncDirectory();
   return{key,sha256:hash.digest('hex'),bytes};
  }catch(error){if(published)throw new FileHandoffError(503,'FILE_STORAGE_OUTCOME_UNKNOWN');if(error instanceof FileHandoffError)throw error;throw new FileHandoffError(503,'FILE_STORAGE_UNAVAILABLE');}
  finally{if(!closed)await fd.close().catch(()=>{});await unlink(temporary).catch(()=>{});}
 }
 async read(blob:BlobReceipt):Promise<Buffer>{
  if(!/^[a-f0-9-]{36}\.[a-f0-9-]{36}\.blob$/.test(blob.key)||!checksumSchema.safeParse(blob.sha256).success||!Number.isInteger(blob.bytes)||blob.bytes<0||blob.bytes>this.maxBytes)fail(503,'FILE_BLOB_UNAVAILABLE');
  return(await this.verified(blob.key,blob)).bytes;
 }
 async inspect(id:string,token:string):Promise<BlobReceipt>{
  if(!fileIdSchema.safeParse(id).success||!fileIdSchema.safeParse(token).success)fail(503,'FILE_BLOB_UNAVAILABLE');
  return(await this.verified(id+'.'+token+'.blob')).blob;
 }
 private async verified(key:string,expected?:BlobReceipt){
  try{
   await this.checkedDirectory();const fd=await open(join(this.directory,key),constants.O_RDONLY|constants.O_NOFOLLOW);
   try{const info=await fd.stat();if(!info.isFile()||info.uid!==process.getuid?.()||info.nlink!==1||info.mode&0o077||info.size<0||info.size>this.maxBytes||expected&&info.size!==expected.bytes)fail(503,'FILE_BLOB_UNAVAILABLE');
    const bounded=Buffer.alloc(info.size+1);let size=0;
    while(size<bounded.length){const read=await fd.read(bounded,size,bounded.length-size);if(!read.bytesRead)break;size+=read.bytesRead;}
    const bytes=bounded.subarray(0,size),sha256=createHash('sha256').update(bytes).digest('hex');if(size!==info.size||expected&&sha256!==expected.sha256)fail(503,'FILE_BLOB_UNAVAILABLE');return{bytes,blob:{key,sha256,bytes:size}};
   }finally{await fd.close();}
  }catch{throw new FileHandoffError(503,'FILE_BLOB_UNAVAILABLE');}
 }
}
