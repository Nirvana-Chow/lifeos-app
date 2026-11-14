import {createHash} from 'node:crypto';
import {fileIdSchema,type StoredFile,type FileEntry,type StageFileInput,type BlobReceipt,type AckInput,type FileOperation} from './public.ts';
export * from './public.ts';

export class FileHandoffError extends Error{
 readonly status:number;readonly code:string;readonly handoffId?:string;
 constructor(status:number,code:string,handoffId?:string){super(code);this.status=status;this.code=code;if(handoffId&&fileIdSchema.safeParse(handoffId).success)this.handoffId=handoffId;}
}
export function fail(status:number,code:string):never{throw new FileHandoffError(status,code);}
export const sha256=(bytes:string|Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
/** Server-created identity only. Never accept this object in MCP/HTTP input. */
export type FileHandoffActor=Readonly<{ownerId:string;spaceId:string;authorityRef:string;consumer?:'website'|'codex'}>;
export type TransferClaim={entry:StoredFile;token:string|null;recoveryToken?:string;duplicate:boolean};
export interface FileHandoffRepository{
 reserve(actor:FileHandoffActor,input:StageFileInput,key:string):Promise<TransferClaim>;
 publish(actor:FileHandoffActor,id:string,token:string,blob:BlobReceipt):Promise<{entry:FileEntry;duplicate:boolean}>;
 reconcile(actor:FileHandoffActor,id:string,previousToken:string,blob:BlobReceipt):Promise<{entry:FileEntry;duplicate:boolean}>;
 release(actor:FileHandoffActor,id:string,token:string):Promise<void>;
 get(actor:FileHandoffActor,id:string,operation?:FileOperation):Promise<StoredFile>;
 acknowledge(actor:FileHandoffActor,input:AckInput,key:string):Promise<{entry:FileEntry;duplicate:boolean}>;
}
export function publicFile(entry:StoredFile):FileEntry{const{blob:_,...visible}=entry;return visible;}
export function stageDigest(input:StageFileInput):string{
 const{download_url:_,...file}=input.file;
 return sha256(JSON.stringify({file,requirementId:input.requirementId,retention:input.retention}));
}
export function commandKey(value:string){if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value))fail(400,'FILE_COMMAND_INVALID');return value;}
export function cleanupEligible(entry:FileEntry,now=Date.now()):boolean{
 return entry.state==='ready'&&entry.retention.kind==='temporary'&&Date.parse(entry.retention.retainUntil)<=now&&['website','codex'].every(consumer=>{
  const ack=entry.acknowledgments[consumer as 'website'|'codex'];return !!ack&&ack.sha256===entry.sha256&&ack.bytes===entry.bytes;
 });
}
