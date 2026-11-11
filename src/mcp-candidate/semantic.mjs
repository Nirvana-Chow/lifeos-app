import {completeRecordFields} from '../agent-api/personal-records.ts';
import {expectedStorageReviewFields} from '../storage-review/agent-fields.ts';
import {preserveOmittedPlanning} from '../personal-candidate/planning.ts';
import {validateTodo,validateFinance} from '../platform/domain.ts';
import {normalizePersonalFields} from '../personal-candidate/business.ts';
import {validateRequirementFields} from '../requirements-candidate/domain.ts';
import {validateFeedbackInput} from '../requirement-support-candidate/domain.ts';
import {classificationCanonical as canonical,decodePreview,decodeResult,classificationNoOp} from '../personal-candidate/classification-contracts.ts';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const equal=(a,b)=>canonical(a)===canonical(b);
export const responseEntry=v=>v&&typeof v==='object'&&!Array.isArray(v)?(v.entry&&typeof v.entry==='object'?v.entry:typeof v.id==='string'&&(v.fields||typeof v.title==='string'&&typeof v.text==='string'&&v.source)?v:undefined):undefined;
const entry=responseEntry;
export function verifyReceipt(operation,args,before,data){
 if(['claimRequirementExecution','updateRequirementExecution'].includes(operation.id)){
  if(args.action==='progress')return verifyReceipt({id:'updateRequirement',module:'requirements',method:'PATCH'},{...args.input,id:args.lease.requirementId},before,data);
  const l=data?.lease,expected=operation.id==='claimRequirementExecution'?args:args.lease;
  if(!l||!uuid(l.id)||!(uuid(l.requirementId)||/^LO-[A-Z]+-\d{3}$/.test(l.requirementId))||!uuid(l.sourceId)||!Number.isInteger(l.revision)||l.revision<1||!Number.isSafeInteger(l.fence)||l.fence<1||!Number.isSafeInteger(l.expiresAt)||l.expiresAt<1||typeof l.grantId!=='string'||!l.grantId||l.requirementId!==expected.requirementId||l.workDigest!==expected.workDigest||l.holderId!==expected.holderId||args.action==='renew'&&(l.id!==args.lease.id||l.sourceId!==args.lease.sourceId||l.fence!==args.lease.fence||l.grantId!==args.lease.grantId||l.expiresAt<args.lease.expiresAt))throw Error('EXECUTION_RECEIPT_INVALID');
  return l;
 }
 const e=entry(data),requirement=operation.module==='requirements';
 if(operation.module==='storageReview'){
  if(!e||!uuid(e.id)||!uuid(e.sourceId)||!Number.isInteger(e.revision)||e.revision<1)throw Error('STORAGE_REVIEW_RECEIPT_INVALID');
  const expected=expectedStorageReviewFields(operation.id,args.fields,before?.fields);
  if(operation.method==='POST'&&e.revision!==1)throw Error('CREATE_REVISION_MISMATCH');
  if(operation.method==='PATCH'){
   const replay=data.duplicate===true&&!Number.isInteger(before?.revision);
   const revision=args.expectedRevision+(equal(expected,before?.fields)?0:1);
   if(!before||e.id!==args.id||e.sourceId!==before.sourceId||!(replay?[args.expectedRevision,args.expectedRevision+1].includes(e.revision):e.revision===revision))throw Error('RECEIPT_IDENTITY_OR_CAS_MISMATCH');
  }
  if(!equal(e.fields,expected))throw Error('RECEIPT_CANONICAL_FIELDS_MISMATCH');
  return e;
 }
 if(!e||!(uuid(e.id)||requirement&&/^LO-[A-Z]+-\d{3}$/.test(e.id))||!Number.isInteger(e.revision)||e.revision<1||(operation.module!=='feedback'&&(!e.fields||typeof e.fields!=='object'))||!uuid(e.sourceId))throw Error('RECEIPT_INVALID');
 if(operation.method==='POST'&&e.revision!==1)throw Error('CREATE_REVISION_MISMATCH');
 if(operation.method==='PATCH'&&(!before||e.id!==args.id||(before.sourceId!==null&&e.sourceId!==before.sourceId)||e.revision!==args.expectedRevision+1))throw Error('RECEIPT_IDENTITY_OR_CAS_MISMATCH');
 let expected;
 if(operation.module==='todo'){const raw={...args.fields};if(raw.personal===null)delete raw.personal;expected={...validateTodo(raw),personal:raw.personal??null};}
 else if(operation.module==='finance')expected=validateFinance(args.fields);
 else if(operation.module==='requirements')expected=validateRequirementFields(args.fields);
 else if(operation.module==='feedback')expected=validateFeedbackInput(args.fields);
 else expected=normalizePersonalFields(operation.module==='organization'?args.type:operation.module,operation.module==='organization'?args.fields:completeRecordFields(args.fields,operation.module));
 if(operation.module==='journal')expected={...expected,personal:expected.personal??null};
 if(before)expected=preserveOmittedPlanning(operation.module==='organization'?args.type:operation.module,args.fields,before.fields,expected);
 if(requirement&&operation.method==='PATCH'){if(!equal(e.baselineBinding,args.baselineBinding)||e.baselineConflict!==false)throw Error('RECEIPT_BASELINE_MISMATCH');if(!Object.hasOwn(args.fields,'workflow')&&Object.hasOwn(before.fields,'workflow')&&!equal(e.fields.workflow,before.fields.workflow))throw Error('OMITTED_WORKFLOW_CHANGED');}
 if(requirement&&before&&!Object.hasOwn(args.fields,'workflow')&&Object.hasOwn(before.fields,'workflow'))expected={...expected,workflow:before.fields.workflow};
 if(operation.module==='feedback'&&(e.state!=='inbox'||!equal(e.references,[])||e.source?.channel!=='agent-feedback'))throw Error('FEEDBACK_PROJECTION_MISMATCH');
 const actualFields=operation.module==='feedback'?{title:e.title,text:e.text,sourceLabel:e.source?.label}:e.fields;
 if(!equal(actualFields,expected))throw Error('RECEIPT_CANONICAL_FIELDS_MISMATCH');
 return e;
}
export function verifyCurrent(receipt,readback){
 const expected=entry(receipt);if(!readback?.ok)return{verified:false,state:'READBACK_UNAVAILABLE'};const current=entry(readback.data);
 if(!current||current.id!==expected.id||current.sourceId!==expected.sourceId)return{verified:false,state:'READBACK_IDENTITY_MISMATCH'};
 if(!Number.isInteger(current.revision)||current.revision<1)return{verified:false,state:'READBACK_REVISION_INVALID'};
 if(current.revision>expected.revision)return{verified:false,state:'LATER_REVISION',receiptRevision:expected.revision,currentRevision:current.revision};
 return{verified:equal(current,expected),state:equal(current,expected)?'VERIFIED':'READBACK_MISMATCH'};
}
export function verifyClassification(manifest,data){
 const p=decodePreview(manifest),r=decodeResult(data);
 if(p.planId!==r.planId||p.digest!==r.digest||!equal([...p.unchangedIds].sort(),[...r.unchangedIds].sort())||!equal(p.changes.map(c=>c.todo.id).sort(),r.entries.map(e=>e.id).sort()))throw Error('CLASSIFICATION_SET_MISMATCH');
 for(const c of p.changes){const e=r.entries.find(e=>e.id===c.todo.id),noop=classificationNoOp(c.before,c.after);if(e.sourceId!==c.todo.sourceId||e.revision!==c.todo.expectedRevision+(noop?0:1)||!equal(e.personal,noop?c.before:c.after))throw Error('CLASSIFICATION_ENTRY_MISMATCH');}
 return r;
}
export function verifyClassificationCurrent(manifest,receipt,readback){const r=verifyClassification(manifest,receipt);if(!readback.ok)return{verified:false,state:'READBACK_UNAVAILABLE'};const entries=readback.data?.entries;if(!Array.isArray(entries)||!equal(entries.map(e=>e.id).sort(),r.entries.map(e=>e.id).sort()))return{verified:false,state:'READBACK_SET_MISMATCH'};
 const results=r.entries.map(e=>verifyCurrent({entry:{id:e.id,sourceId:e.sourceId,revision:e.revision,fields:{personal:e.personal}}},{ok:true,data:{entry:{id:e.id,sourceId:entries.find(c=>c.id===e.id)?.sourceId,revision:entries.find(c=>c.id===e.id)?.revision,fields:{personal:entries.find(c=>c.id===e.id)?.fields?.personal}}}}));return{verified:results.every(r=>r.verified),state:results.every(r=>r.verified)?'VERIFIED':'READBACK_MISMATCH',entries:results};}

export function verifyExecutionCurrent(operation,args,receipt,readback){
 if(args.action==='progress')return verifyCurrent(receipt,readback);
 if(!readback?.ok)return{verified:false,state:'READBACK_UNAVAILABLE'};
 const lease=receipt?.lease,current=readback.data?.execution,record=entry(readback.data);
 if(!lease||!current||!record||record.id!==lease.requirementId||record.sourceId!==lease.sourceId||current.sourceId!==lease.sourceId)return{verified:false,state:'READBACK_IDENTITY_MISMATCH'};
 if(current.leaseActive!==true||current.state!=='running')return{verified:false,state:'LEASE_NOT_ACTIVE'};
 if(current.workDigest!==lease.workDigest||current.fence!==lease.fence||current.revision!==record.revision||record.revision<lease.revision)return{verified:false,state:'LEASE_LATER_REVISION'};
 const actual=current.lease,keys=['id','requirementId','sourceId','workDigest','holderId','grantId','fence','expiresAt'];
 return actual&&keys.every(key=>equal(actual[key],lease[key]))?{verified:true,state:'VERIFIED'}:{verified:false,state:'LEASE_LATER_REVISION'};
}
