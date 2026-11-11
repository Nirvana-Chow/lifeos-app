import {object,PlatformError} from '../platform/domain.ts';
import {validateChecklist,validateDecisionCommand,validateReviewSnapshot,type ReviewSnapshot,type StorageReviewChecklist} from './domain.ts';
const equal=(a:unknown,b:unknown):boolean=>JSON.stringify(a)===JSON.stringify(b);
type Fields={checklist:StorageReviewChecklist}|{checklistRevision:string;itemId:string;decision:'keep'|'trash'|'defer'|null};
export function validateStorageReviewFields(operationId:string,input:unknown):Fields{
 if(operationId==='createStorageReview'||operationId==='updateStorageReviewChecklist')return{checklist:validateChecklist(object(input,['checklist']).checklist)};
 if(operationId!=='updateStorageReviewDecision')throw new PlatformError(400,'OPERATION_UNAVAILABLE','无效审核操作。');
 const fields=object(input,['checklistRevision','itemId','decision']);
 const value=validateDecisionCommand({expectedRevision:1,checklistRevision:fields.checklistRevision,id:fields.itemId,decision:fields.decision});
 return{checklistRevision:value.checklistRevision,itemId:value.id,decision:value.decision};
}
export function expectedStorageReviewFields(operationId:string,input:unknown,before?:Pick<ReviewSnapshot,'checklist'|'decisions'>):Pick<ReviewSnapshot,'checklist'|'decisions'>{
 const fields=validateStorageReviewFields(operationId,input);
 if(operationId==='createStorageReview')return{checklist:('checklist'in fields?fields.checklist:undefined)!,decisions:[]};
 const previous=validateReviewSnapshot({revision:1,...before});
 if('checklist'in fields){
  const next=fields.checklist;
  if(next.revision===previous.checklist.revision&&!equal(next,previous.checklist))throw new PlatformError(409,'CHECKLIST_REVISION_CONFLICT','相同清单版本不能更换内容。');
  for(const d of previous.decisions){const a=previous.checklist.items.find(i=>i.id===d.id),b=next.items.find(i=>i.id===d.id);if(!a||!b||!equal(a,b))throw new PlatformError(409,'CHECKLIST_DECISION_CONFLICT','已决定对象已变化。');}
  return{checklist:next,decisions:[...previous.decisions].sort((a,b)=>next.items.findIndex(i=>i.id===a.id)-next.items.findIndex(i=>i.id===b.id))};
 }
 if(fields.checklistRevision!==previous.checklist.revision)throw new PlatformError(409,'REVISION_CONFLICT','清单版本已变化。');
 if(!previous.checklist.items.some(i=>i.id===fields.itemId&&i.status==='pending'))throw new PlatformError(409,'PROTECTED_ITEM','该条目不可修改。');
 const decisions=previous.decisions.filter(d=>d.id!==fields.itemId);
 if(fields.decision!==null)decisions.push({id:fields.itemId,decision:fields.decision});
 decisions.sort((a,b)=>previous.checklist.items.findIndex(i=>i.id===a.id)-previous.checklist.items.findIndex(i=>i.id===b.id));
 return{checklist:previous.checklist,decisions};
}
