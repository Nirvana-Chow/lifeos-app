import {completeRecordFields} from '../agent-api/personal-records.ts';
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
 const e=entry(data),requirement=operation.module==='requirements';
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
