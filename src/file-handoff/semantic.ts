import {fileEntrySchema,retentionSchema} from './contracts.ts';
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export function verifyFileReceipt(operation:{id:string},args:Record<string,unknown>,data:Record<string,unknown>){
 const entry=fileEntrySchema.parse(data.entry);if(entry.state!=='ready'||!entry.sha256||entry.bytes===null||typeof data.duplicate!=='boolean')throw Error('FILE_RECEIPT_INVALID');
 if(operation.id==='stageFileHandoff'){
  const file=args.file as Record<string,unknown>;if(entry.revision!==2||entry.sourceFileId!==file.file_id||entry.target.id!==args.requirementId||entry.name!==(file.file_name??'ChatGPT-file.bin')||entry.mimeType!==(file.mime_type??'application/octet-stream')||!same(entry.retention,retentionSchema.parse(args.retention)))throw Error('FILE_RECEIPT_MISMATCH');
 }else if(operation.id==='acknowledgeFileHandoff'){
  const ack=entry.acknowledgments.codex;if(entry.id!==args.id||entry.revision!==Number(args.expectedRevision)+1||entry.sha256!==args.sha256||entry.bytes!==args.bytes||ack?.sha256!==args.sha256||ack?.bytes!==args.bytes)throw Error('FILE_ACK_RECEIPT_MISMATCH');
 }else throw Error('FILE_OPERATION_INVALID');return entry;
}
export function verifyFileCurrent(receipt:Record<string,unknown>,readback:{ok?:boolean;data?:Record<string,unknown>}){
 if(!readback?.ok)return{verified:false,state:'READBACK_UNAVAILABLE'};
 const expected=fileEntrySchema.safeParse(receipt.entry),current=fileEntrySchema.safeParse(readback.data?.entry);
 if(!expected.success||!current.success)return{verified:false,state:'FILE_READBACK_INVALID'};
 const before=expected.data,after=current.data;
 if(before.id!==after.id||before.sourceFileId!==after.sourceFileId||!same(before.target,after.target)||before.name!==after.name||before.mimeType!==after.mimeType||!same(before.retention,after.retention)||before.createdAt!==after.createdAt||before.receivedAt!==after.receivedAt||before.sha256!==after.sha256||before.bytes!==after.bytes)return{verified:false,state:'READBACK_IDENTITY_MISMATCH'};
 if(after.revision>before.revision)return{verified:false,state:'LATER_REVISION',receiptRevision:before.revision,currentRevision:after.revision};
 return{verified:same(before,after),state:same(before,after)?'VERIFIED':'READBACK_MISMATCH'};
}
