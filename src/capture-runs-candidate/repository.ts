import {z} from 'zod';
import {PlatformError} from '../platform/domain.ts';
import type {CaptureRun,PublicCaptureRun} from './contracts.ts';
const hash=z.string().regex(/^[a-f0-9]{64}$/),revision=z.number().int().min(1).max(2147483646);
const timestamp=z.string().max(24).refine(v=>/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)&&!v.startsWith('0000-')&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v);
export const captureRunProvenanceSchema=z.strictObject({provider:z.literal('volcengine-ark'),model:z.string().min(1).max(160).regex(/^[A-Za-z0-9_.:-]+$/),configurationRevision:revision,materialRevision:revision,mode:z.enum(['synthetic-sdk-test','approved-live'])});
export const captureRunRecordSchema=z.strictObject({kind:z.enum(['todo','inbox']),id:z.uuid(),sourceId:z.uuid(),revision:z.literal(1)});
export const captureRunEvidenceSchema=z.strictObject({id:z.uuid(),sourceHash:hash,provenance:captureRunProvenanceSchema.nullable()});
const publicFields={id:z.uuid(),revision,state:z.enum(['pending','ready','failed','cancelled','configuration-changed','confirmation-pending','confirmed']),kind:z.enum(['todo','life']),adapter:z.enum(['manual','synthetic-fixture','ai']),provenance:captureRunProvenanceSchema.nullable(),createdAt:timestamp,updatedAt:timestamp,record:captureRunRecordSchema.nullable()};
export const publicCaptureRunSchema=z.strictObject(publicFields).refine(v=>(v.adapter==='ai')===(v.provenance!==null)&&v.updatedAt>=v.createdAt&&(v.state==='confirmed')===(v.record!==null)&&(!v.record||v.record.kind===(v.kind==='todo'?'todo':'inbox')));
const runSchema=z.strictObject({...publicFields,ownerId:z.string().min(1).max(256).regex(/^[^\u0000-\u001f\u007f]+$/),sourceHash:hash,confirmationHash:hash.nullable()}).refine(v=>publicCaptureRunSchema.safeParse(publicRun(v)).success&&(['confirmation-pending','confirmed'].includes(v.state)===(v.confirmationHash!==null))&&(v.state!=='pending'||v.revision===1&&v.updatedAt===v.createdAt));
function publicRun(value:CaptureRun):PublicCaptureRun{const{ownerId,sourceHash,confirmationHash,...result}=value;return result;}
export function checkedCaptureRun(owner:string,value:unknown,expectedId?:string):CaptureRun{
 const result=runSchema.safeParse(value);if(!result.success||result.data.ownerId!==owner||expectedId!==undefined&&result.data.id!==expectedId)throw new PlatformError(503,'CAPTURE_RUN_STORAGE_UNAVAILABLE','运行凭证暂时无法核对。');return result.data;
}
export function publicCaptureRun(value:CaptureRun):PublicCaptureRun{return publicRun(structuredClone(value));}
