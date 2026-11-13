import {createHash} from 'node:crypto';
import {z} from 'zod';

export class FileHandoffError extends Error{
 readonly status:number;readonly code:string;
 constructor(status:number,code:string){super(code);this.status=status;this.code=code;}
}
export function fail(status:number,code:string):never{throw new FileHandoffError(status,code);}
export const sha256=(bytes:string|Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
export const fileIdSchema=z.string().uuid();
export const checksumSchema=z.string().regex(/^[a-f0-9]{64}$/);
const displayName=z.string().min(1).max(180).refine(value=>!/[\x00-\x1f\x7f/\\]/.test(value)&&value!=='.'&&value!=='..');
const mime=z.string().max(160).regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i);
// All four properties must be declared; OpenAI permits only these two required properties.
export const openAiFileSchema=z.strictObject({download_url:z.string().min(1).max(8192),file_id:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/),mime_type:mime.optional(),file_name:displayName.optional()});
export const retentionSchema=z.discriminatedUnion('kind',[z.strictObject({kind:z.literal('temporary'),retainUntil:z.iso.datetime({offset:true})}),z.strictObject({kind:z.literal('retained')})]);
export const stageFileSchema=z.strictObject({file:openAiFileSchema,requirementId:z.union([fileIdSchema,z.string().regex(/^LO-[A-Z]+-\d{3}$/)]),retention:retentionSchema});
export const ackFileSchema=z.strictObject({id:fileIdSchema,expectedRevision:z.number().int().min(1),sha256:checksumSchema,bytes:z.number().int().min(0).max(32*1024*1024)});
export type StageFileInput=z.infer<typeof stageFileSchema>;
export type Retention=z.infer<typeof retentionSchema>;
export type AckInput=z.infer<typeof ackFileSchema>;
export type FileOperation='stageFileHandoff'|'getFileHandoff'|'downloadFileHandoff'|'acknowledgeFileHandoff';
/** Server-created identity only. Never accept this object in MCP/HTTP input. */
export type FileHandoffActor=Readonly<{ownerId:string;spaceId:string;authorityRef:string;consumer?:'website'|'codex'}>;
export type FileTarget=Readonly<{id:string;sourceId:string;revision:number}>;
export type BlobReceipt=Readonly<{key:string;sha256:string;bytes:number}>;
export type FileAck=Readonly<{sha256:string;bytes:number;receivedAt:string}>;
export type FileEntry=Readonly<{id:string;revision:number;state:'pending'|'ready';sourceFileId:string;name:string;mimeType:string;target:FileTarget;retention:Retention;sha256:string|null;bytes:number|null;createdAt:string;receivedAt:string|null;acknowledgments:Partial<Record<'website'|'codex',FileAck>>}>;
export type StoredFile=FileEntry&{blob:BlobReceipt|null};
export const fileEntrySchema=z.strictObject({id:fileIdSchema,revision:z.number().int().min(1),state:z.enum(['pending','ready']),sourceFileId:z.string().min(1).max(256),name:displayName,mimeType:mime,target:z.strictObject({id:stageFileSchema.shape.requirementId,sourceId:fileIdSchema,revision:z.number().int().min(1)}),retention:retentionSchema,sha256:checksumSchema.nullable(),bytes:z.number().int().min(0).max(32*1024*1024).nullable(),createdAt:z.iso.datetime(),receivedAt:z.iso.datetime().nullable(),acknowledgments:z.strictObject({website:z.strictObject({sha256:checksumSchema,bytes:z.number().int().min(0),receivedAt:z.iso.datetime()}).optional(),codex:z.strictObject({sha256:checksumSchema,bytes:z.number().int().min(0),receivedAt:z.iso.datetime()}).optional()})});
export type TransferClaim={entry:StoredFile;token:string|null;duplicate:boolean};
export interface FileHandoffRepository{
 reserve(actor:FileHandoffActor,input:StageFileInput,key:string):Promise<TransferClaim>;
 publish(actor:FileHandoffActor,id:string,token:string,blob:BlobReceipt):Promise<{entry:FileEntry;duplicate:boolean}>;
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
