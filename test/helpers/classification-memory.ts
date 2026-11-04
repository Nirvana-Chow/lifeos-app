import {MemoryPort} from './platform.ts';
import type {ClassificationRepository,ClassificationTransaction,Transaction} from '../../src/platform/contracts.ts';
import type {ClassificationPlan,ClassificationApproval,ClassificationReceipt} from '../../src/personal-candidate/classification-contracts.ts';
import {decodePlan,decodeApproval,decodeReceipt,assertApprovalMatchesPlan} from '../../src/personal-candidate/classification-contracts.ts';
import {classificationCommandKey,assertReceiptMatchesPlan} from '../../src/personal-candidate/classification-postgres.ts';
import {PlatformError} from '../../src/platform/domain.ts';
/** Synthetic rollback port only. Native PostgreSQL tests own lock/ACL qualification. */
export class ClassificationMemoryPort extends MemoryPort implements ClassificationRepository {
 plans=new Map<string,ClassificationPlan>();approvals=new Map<string,ClassificationApproval>();classificationReceipts=new Map<string,ClassificationReceipt>();
 grantFence?:Transaction['lockAgentGrant'];
 async classificationTransaction<T>(owner:string,space:string,key:string,fn:(tx:ClassificationTransaction)=>Promise<T>):Promise<T>{
  return super.transaction(owner,classificationCommandKey(owner,space,key),async tx=>{
   const plans=structuredClone(this.plans),approvals=structuredClone(this.approvals),receipts=structuredClone(this.classificationReceipts);
   const planKey=(id:string)=>JSON.stringify([owner,space,id]),receiptKey=classificationCommandKey(owner,space,key);
   const conflict=():never=>{throw new PlatformError(409,'CLASSIFICATION_CONFLICT','分类计划已保存或提交。');};
   const getPlan=async(id:string)=>structuredClone(this.plans.get(planKey(id))??null);
   try{return await fn({...tx,...(this.grantFence?{lockAgentGrant:this.grantFence}:{}),
    getClassificationPlan:getPlan,lockClassificationPlan:async()=>{},
    saveClassificationPlan:async value=>{const p=decodePlan(value);if(p.ownerId!==owner||p.spaceId!==space)throw new PlatformError(403,'CLASSIFICATION_OWNER','空间不匹配。');if(this.plans.has(planKey(p.preview.planId)))return conflict();this.plans.set(planKey(p.preview.planId),structuredClone(p));},
    classificationApproval:async id=>structuredClone(this.approvals.get(planKey(id))??null),
    saveClassificationApproval:async value=>{const a=decodeApproval(value),p=await getPlan(a.planId);if(!p)throw Error('Missing fixture plan');assertApprovalMatchesPlan(a,p);if(this.approvals.has(planKey(a.planId)))return conflict();this.approvals.set(planKey(a.planId),structuredClone(a));},
    classificationReceipt:async()=>structuredClone(this.classificationReceipts.get(receiptKey)??null),
    classificationPlanCommitted:async id=>[...this.classificationReceipts.entries()].some(([k,r])=>k.startsWith(JSON.stringify([owner,'todo-classification-v1',space]).slice(0,-1)+',')&&r.planId===id),
    saveClassificationReceipt:async value=>{const r=decodeReceipt(value),p=await getPlan(r.planId);if(!p||!this.approvals.has(planKey(r.planId)))throw Error('Missing fixture approval');assertReceiptMatchesPlan(r,p);if(this.classificationReceipts.has(receiptKey)||[...this.classificationReceipts.entries()].some(([k,existing])=>k.startsWith(JSON.stringify([owner,'todo-classification-v1',space]).slice(0,-1)+',')&&existing.planId===r.planId))return conflict();this.classificationReceipts.set(receiptKey,structuredClone(r));},
   });}catch(error){this.plans=plans;this.approvals=approvals;this.classificationReceipts=receipts;throw error;}
  });
 }
}
