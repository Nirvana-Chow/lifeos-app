import {z} from 'zod';
import {recordId,commandKey,digest,baselineBinding,writeFieldsSchema} from '../mcp-candidate/field-schemas.ts';
const requirement=z.union([recordId,z.string().regex(/^LO-[A-Z]+-\d{3}$/)]);
const holder=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/);
export const executionLeaseSchema=z.strictObject({id:recordId,requirementId:requirement,sourceId:recordId,revision:z.number().int().min(1).max(2147483647),workDigest:digest,holderId:holder,grantId:z.string().min(1).max(256),fence:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),expiresAt:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)});
export function executionArgumentSchema(id:string){
 if(id==='claimRequirementExecution')return z.strictObject({requirementId:requirement,workDigest:digest,holderId:holder,idempotencyKey:commandKey});
 const common={id:recordId,lease:executionLeaseSchema,idempotencyKey:commandKey};
 return z.discriminatedUnion('action',[z.strictObject({...common,action:z.literal('renew')}),z.strictObject({...common,action:z.literal('progress'),input:z.strictObject({fields:writeFieldsSchema('requirements',true),expectedRevision:z.number().int().min(1).max(2147483647),baselineBinding})})]);
}
