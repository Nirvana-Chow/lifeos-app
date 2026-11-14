import {fileEntrySchema,type FileEntry,ackFileSchema} from './public.ts';
export async function verifiedFileBytes(response:Response,entry:FileEntry):Promise<Uint8Array<ArrayBuffer>>{
 if(!response.ok||response.redirected||entry.state!=='ready'||!entry.sha256||entry.bytes===null||entry.bytes>32*1024*1024||response.headers.get('content-length')!==String(entry.bytes)||response.headers.get('X-LifeOS-File-SHA256')!==entry.sha256||!Number.isSafeInteger(Number(response.headers.get('X-LifeOS-File-Revision')))||Number(response.headers.get('X-LifeOS-File-Revision'))<entry.revision){await response.body?.cancel().catch(()=>{});throw Error('FILE_DOWNLOAD_UNVERIFIED');}
 const reader=response.body?.getReader();if(!reader)throw Error('FILE_DOWNLOAD_UNAVAILABLE');const chunks:Uint8Array[]=[];let total=0;
 try{for(;;){const part=await reader.read();if(part.done)break;total+=part.value.byteLength;if(total>entry.bytes)throw Error('FILE_DOWNLOAD_TOO_LARGE');chunks.push(part.value);}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 if(total!==entry.bytes)throw Error('FILE_DOWNLOAD_TRUNCATED');const bytes=new Uint8Array(total);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),part=>part.toString(16).padStart(2,'0')).join('');if(digest!==entry.sha256)throw Error('FILE_DOWNLOAD_CHECKSUM_MISMATCH');return bytes;
}
export async function readWebsiteFile(id:string,fetcher:typeof fetch=fetch){
 const response=await fetcher('/api/platform/personal/file-handoffs/'+id,{credentials:'same-origin',cache:'no-store',redirect:'error'});if(!response.ok)throw Error('FILE_READ_UNAVAILABLE');const value=await response.json();return fileEntrySchema.parse(value.entry);
}
export function websiteAckReceipt(value:unknown,input:unknown){
 const ack=ackFileSchema.parse(input),response=value as {entry?:unknown;duplicate?:unknown},entry=fileEntrySchema.parse(response.entry),record=entry.acknowledgments.website;
 if(typeof response.duplicate!=='boolean'||entry.id!==ack.id||entry.revision!==ack.expectedRevision+1||entry.sha256!==ack.sha256||entry.bytes!==ack.bytes||record?.sha256!==ack.sha256||record?.bytes!==ack.bytes)throw Error('FILE_ACK_RECEIPT_INVALID');return entry;
}
