import type{PersonalBinding}from'./client.ts';
import type{PersonalEditorFields}from'./editor.ts';
import type{PublicEntry}from'../platform/contracts.ts';
import{taskCellFields,taskReceiptMatchesSubmission,type TaskIdentity}from'./task-editor-state.ts';
export type TaskCellField='title'|'status'|'due';
export type TaskCellDraft={task:TaskIdentity;fields:PersonalEditorFields;field:TaskCellField;value:string};
const same=(a:PersonalBinding,b:PersonalBinding)=>a.ownerId===b.ownerId&&a.spaceId===b.spaceId;
const sameCell=(a:Pick<TaskCellDraft,'task'|'field'>,b:Pick<TaskCellDraft,'task'|'field'>)=>a.task.id===b.task.id&&a.task.revision===b.task.revision&&a.field===b.field;
/** One in-memory draft; binding is deliberately absent from the UI-facing read result. No storage or writer. */
export class TaskCellDraftMemory{
 private epoch=0;private active:PersonalBinding|null=null;private retained:{binding:PersonalBinding;draft:TaskCellDraft}|null=null;private capture:(()=>void)|null=null;private confirmed=new Set<()=>void>();
 verify(binding:PersonalBinding|null){if(!binding||!this.active||!same(binding,this.active))this.epoch++;if(binding&&this.retained&&!same(binding,this.retained.binding))this.retained=null;this.active=binding?{...binding}:null;}
 read():TaskCellDraft|null{return this.active&&this.retained&&same(this.active,this.retained.binding)?structuredClone(this.retained.draft):null;}
 /** Every editor receives a writer scoped to its binding, cell and lifecycle. Unrelated cleanup cannot clear it. */
 claim(task:TaskIdentity,field:TaskCellField,allowDiscard:()=>boolean):((draft:TaskCellDraft|null)=>void)|null{
  if(!this.active)return null;const binding={...this.active},cell={task:{...task},field},before=this.epoch;
  if(this.retained&&!sameCell(this.retained.draft,cell)){
   if(!allowDiscard()||!this.active||!same(binding,this.active)||this.epoch!==before)return null;
   this.retained=null;
  }
  const token=++this.epoch;
  return draft=>{
   if(token!==this.epoch||!this.active||!same(binding,this.active))return;
   const ownsRetained=this.retained&&same(binding,this.retained.binding)&&sameCell(this.retained.draft,cell);
   if(!draft){if(ownsRetained)this.retained=null;return;}
   if(!sameCell(draft,cell)||this.retained&&!ownsRetained)return;
   this.retained={binding:{...binding},draft:structuredClone(draft)};
  };
 }
 registerCapture(capture:()=>void){this.capture=capture;return()=>{if(this.capture===capture)this.capture=null;};}
 captureCurrent(){this.capture?.();}
 hasDraft(){return this.retained!==null;}
 conceal(){this.captureCurrent();this.verify(null);}
 clear(){this.epoch++;this.retained=null;this.active=null;this.capture=null;}
 onConfirmed(listener:()=>void){this.confirmed.add(listener);return()=>{this.confirmed.delete(listener);};}
 confirm(receipt:PublicEntry){const draft=this.read();if(!draft||!this.active)return;try{if(taskReceiptMatchesSubmission({mode:'edit',task:draft.task},taskCellFields(draft.fields,draft.field,draft.value),receipt,this.active.spaceId)){this.retained=null;this.epoch++;this.confirmed.forEach(fn=>fn());}}catch{/* Invalid unsubmitted text cannot match a receipt. */}}
}
