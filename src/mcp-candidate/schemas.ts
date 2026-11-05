// Inherits the official-SDK structural projection from e890615 / 5eaf53f;
// current business validation stays in the existing API/domain modules.
import {z} from 'zod';
import {agentOperations} from '../agent-api/capabilities.ts';
import {object,todoKeys,todoRequiredKeys,financeKeys,validateId,validateRevision,validateIdempotencyKey,validateTodo,validateFinance,PlatformError} from '../platform/domain.ts';
import {normalizePersonalFields} from '../personal-candidate/business.ts';
import {organizationTypes,completeOrganizationFields} from '../agent-api/organization.ts';
import {completeRecordFields,isRecordModule} from '../agent-api/personal-records.ts';
import {requirementId,validateRequirementFields,validateBaselineBinding} from '../requirements-candidate/domain.ts';
import {validateFeedbackInput} from '../requirement-support-candidate/domain.ts';
import {decodeChanges} from '../personal-candidate/classification-contracts.ts';
import {classificationConfirmation} from '../personal-candidate/classification-service.ts';
import {writeFieldsSchema,organizationFieldsSchema,classificationChanges,recordId,revision,commandKey,digest,baselineBinding} from './field-schemas.ts';
export type Operation=typeof agentOperations[number];
const fields=z.record(z.string(),z.unknown());
// Envelope parsing deliberately leaves business values to the canonical native
// normalizers below. The discovery projection must never become a second writer.
function envelopeSchema(operation:Operation){
 const shape:Record<string,z.ZodType>={};
 if(operation.path.includes('{id}'))shape.id=z.string();
 if(operation.path.includes('{type}'))shape.type=z.enum(organizationTypes);
 if(operation.id==='previewTodoClassification')shape.changes=z.array(fields);
 else if(operation.id==='commitTodoClassification'){shape.planId=z.string();shape.digest=z.string();shape.confirmed=z.literal(true);shape.idempotencyKey=z.string();}
 else if(operation.method!=='GET'){
  shape.fields=fields;shape.idempotencyKey=z.string();
  if(operation.method==='PATCH')shape.expectedRevision=z.number();
  if(operation.id==='updateRequirement')shape.baselineBinding=z.union([fields,z.null()]);
 }
 return z.strictObject(shape);
}
/** Native contract structure, including complete fields and mutually exclusive kinds. */
export function argumentSchema(operation:Operation):z.ZodType{
 const shape:Record<string,z.ZodType>={};
 if(operation.path.includes('{id}'))shape.id=operation.module==='requirements'?z.union([recordId,z.string().regex(/^LO-[A-Z]+-\d{3}$/)]):recordId;
 if(operation.path.includes('{type}'))shape.type=z.enum(organizationTypes);
 if(operation.id==='previewTodoClassification')shape.changes=classificationChanges;
 else if(operation.id==='commitTodoClassification'){shape.planId=recordId;shape.digest=digest;shape.confirmed=z.literal(true);shape.idempotencyKey=commandKey;}
 else if(operation.method!=='GET'){
  shape.idempotencyKey=commandKey;
  if(operation.method==='PATCH')shape.expectedRevision=operation.module==='requirements'?z.number().int().min(0).max(2147483647).describe('CAS revision from GET; zero only for the first edit of a public LO-ID.'):revision;
  if(operation.id==='updateRequirement')shape.baselineBinding=baselineBinding;
  if(operation.module==='organization'){
   return z.xor(organizationTypes.map(type=>z.strictObject({...shape,type:z.literal(type),fields:organizationFieldsSchema(type,operation.method==='PATCH')}))).describe('Complete organization fields on PATCH; metadata type must match route type. Omitted optional project planning dates preserve saved dates; null clears.');
  }
  shape.fields=writeFieldsSchema(operation.module,operation.method==='PATCH');
 }
 return z.strictObject(shape).describe(operation.method==='PATCH'?'Submit complete required fields, not a partial merge. Preserve current fields from GET; optional planning/workflow omission preserves values and null clears. Native normalizers and current authorization remain authoritative.':operation.description);
}
export function parseArguments(operation:Operation,input:unknown){
 const parsed=envelopeSchema(operation).safeParse(input);
 if(!parsed.success)throw new PlatformError(400,'INVALID_ARGUMENTS','Invalid arguments');
 const args=parsed.data;let path:string=operation.path;
 if(path.includes('{id}'))path=path.replace('{id}',operation.module==='requirements'?requirementId(args.id):validateId(args.id));
 if(path.includes('{type}'))path=path.replace('{type}',String(args.type));
 const {id:_id,type:_type,idempotencyKey,...body}=args;
 if(idempotencyKey!==undefined)validateIdempotencyKey(idempotencyKey);
 if(operation.id==='previewTodoClassification')decodeChanges(body.changes);
 else if(operation.id==='commitTodoClassification')classificationConfirmation(body);
 else if(operation.method!=='GET'){
  if(operation.method==='PATCH'&&!(operation.module==='requirements'&&typeof args.id==='string'&&args.id.startsWith('LO-')&&body.expectedRevision===0))validateRevision(body.expectedRevision);
  if(operation.module==='requirements'){
   validateRequirementFields(body.fields);
   if(operation.method==='PATCH')validateBaselineBinding(body.baselineBinding);
  }else if(operation.module==='todo'){
   const value=object(body.fields,todoKeys);
   if(operation.method==='PATCH'&&todoRequiredKeys.some(k=>!Object.hasOwn(value,k)))throw new PlatformError(400,'COMPLETE_TODO_REQUIRED','Complete fields required');
   // The native HTTP contract accepts null as a PATCH clear only; POST must
   // omit personal or supply relations. Validate without rewriting the wire body.
   validateTodo(operation.method==='PATCH'&&value.personal===null?Object.fromEntries(Object.entries(value).filter(([k])=>k!=='personal')):value);
  }else if(operation.module==='feedback')validateFeedbackInput(body.fields);
  else if(operation.module==='finance'){
   const value=object(body.fields,financeKeys);
   if(financeKeys.some(k=>!Object.hasOwn(value,k)))throw new PlatformError(400,'COMPLETE_FINANCE_REQUIRED','Complete fields required');
   validateFinance(value);
  }else if(isRecordModule(operation.module))normalizePersonalFields(operation.module,completeRecordFields(body.fields,operation.module));
  else if(operation.module==='organization'){
   if(operation.method==='PATCH')completeOrganizationFields(body.fields);
   normalizePersonalFields(String(args.type),body.fields);
  }else throw new PlatformError(400,'OPERATION_UNSUPPORTED','Unsupported operation');
 }
 return{path,body:operation.method==='GET'?undefined:body,key:typeof idempotencyKey==='string'?idempotencyKey:undefined};
}
