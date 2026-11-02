import{editorFromEntry,type PersonalEditorFields}from'./editor.ts';
import type{WorkspaceTask}from'./workspace-data.ts';
import type{PublicEntry}from'../platform/contracts.ts';
import{validateTodo}from'../platform/domain.ts';
import type{TaskCellDraft}from'./task-cell-draft.ts';
/** Native input lifecycle used by the receipt bridge; no vendor geometry or data writer. */
export type NativeReceiptEditor = {
 onStart: (context: { value?: unknown }) => void;
 onEnd: () => void;
 getValue: () => unknown;
 getInputElement?: () => HTMLElement;
 isEditorElement?: (target: HTMLElement) => boolean;
 element?: HTMLInputElement | HTMLSelectElement;
};
export type TaskIdentity=Pick<WorkspaceTask,'id'|'revision'>;
export type TaskTarget={mode:'create'}|{mode:'edit';task:TaskIdentity}|{mode:'missing';id:string};
export const taskStatusLabels={open:'未完成',in_progress:'进行中',done:'已完成',cancelled:'已取消'};
export function resolveTaskTarget(id:string|undefined,create:boolean,tasks:readonly TaskIdentity[]):TaskTarget|null{
 if(id!==undefined){const task=tasks.find(t=>t.id===id);return task?{mode:'edit',task:{id:task.id,revision:task.revision}}:{mode:'missing',id};}return create?{mode:'create'}:null;
}
export function taskCellFields(fields:PersonalEditorFields,field:'title'|'status'|'due',value:unknown):PersonalEditorFields{
 const next=structuredClone(fields);if(typeof value!=='string')throw Error('输入无效。');
 if(field==='title')next.title=value;
 if(field==='due')next.date=value;
 if(field==='status'){const status=Object.entries(taskStatusLabels).find(([key,label])=>key===value||label===value)?.[0];if(!status)throw Error('状态无效。');next.status=status as PersonalEditorFields['status'];}
 validateTodo({title:next.title,notes:next.text,dueOn:next.date||null,status:next.status,...(next.personal?{personal:next.personal}:{})});return next;
}
/** Only the popup's own submitted content can dismiss its retained draft after shared-session recovery. */
export function taskReceiptMatchesSubmission(target:TaskTarget,fields:PersonalEditorFields|null,receipt:PublicEntry,spaceId:string|null):boolean{
 if(!fields||!spaceId||target.mode==='missing')return false;
 if(target.mode==='edit'&&(receipt.id!==target.task.id||receipt.revision!==target.task.revision+1)||target.mode==='create'&&receipt.revision!==1)return false;
 try{
  if(editorFromEntry(receipt,spaceId).type!=='todo')return false;
  const expected=validateTodo({title:fields.title,notes:fields.text,dueOn:fields.date||null,status:fields.status,...(fields.personal?{personal:fields.personal}:{})});
  return JSON.stringify(validateTodo(receipt.draft))===JSON.stringify(expected);
 }catch{return false;}
}
/** Validation always returns false: only authoritative receipts may update projected rows. */
export type ReceiptEditor = NativeReceiptEditor & {
 validateValue: (value: unknown, previousValue?: unknown) => Promise<false>;
 captureDraft: () => void;
 discard: () => void;
 setDisabled: (disabled: boolean) => void;
};
export function receiptEditor(native:NativeReceiptEditor,options:{field?:'title'|'status'|'due';capture:(context:Parameters<NativeReceiptEditor['onStart']>[0])=>{task:TaskIdentity;fields:PersonalEditorFields}|null;save:(task:TaskIdentity,fields:PersonalEditorFields)=>Promise<PublicEntry|null>;active:()=>boolean;canSave?:()=>boolean;cancel:()=>void;style:(element?:HTMLElement)=>void;onDraft?:(draft:TaskCellDraft|null)=>void;onError?:(message:string)=>void}):ReceiptEditor{
 let context:ReturnType<typeof options.capture>=null,epoch=0,busy=false,discarded=false,removeInputListener:(()=>void)|null=null;
 const element=()=>native.getInputElement?.()??native.element;
 const captureDraft=()=>{if(!context||discarded)return;const value=native.getValue(),field=options.field??'title';if(typeof value!=='string')return;const old=field==='title'?context.fields.title:field==='due'?context.fields.date:taskStatusLabels[context.fields.status];options.onDraft?.(value===old?null:{task:{...context.task},fields:structuredClone(context.fields),field,value});};
 const editor:ReceiptEditor={
  captureDraft,discard(){discarded=true;options.onDraft?.(null);},setDisabled(disabled){const input=element();if(input)(input as HTMLInputElement|HTMLSelectElement).disabled=disabled;},
  onStart(start){context=options.capture(start);++epoch;busy=false;discarded=false;if(!context){if(options.active())options.cancel();return;}native.onStart({...start,value:options.field==='status'?taskStatusLabels[start.value as keyof typeof taskStatusLabels]??start.value:start.value});options.style(element());
   const input=element();if(input){const escape=(event:KeyboardEvent)=>{if(event.key!=='Escape')return;event.preventDefault();event.stopPropagation();if(!busy&&options.canSave?.()!==false){editor.discard();options.cancel();}};input.addEventListener('input',captureDraft);input.addEventListener('change',captureDraft);input.addEventListener('keydown',escape);removeInputListener=()=>{input.removeEventListener('input',captureDraft);input.removeEventListener('change',captureDraft);input.removeEventListener('keydown',escape);};}captureDraft();
  },
  onEnd(){captureDraft();context=null;++epoch;removeInputListener?.();removeInputListener=null;native.onEnd();},
  getValue:()=>native.getValue(),isEditorElement:target=>native.isEditorElement?.(target)??false,
  async validateValue(value){if(!context||busy||!options.active()||options.canSave?.()===false)return false;busy=true;const token=epoch,captured=context;let exit=false;captureDraft();editor.setDisabled(true);
   try{const next=taskCellFields(captured.fields,options.field??'title',value);exit=JSON.stringify(next)===JSON.stringify(captured.fields);if(!exit)exit=!!await options.save(captured.task,next);}
   catch(error){options.onError?.(error instanceof Error?error.message:'保存失败，请重新核对。');}
   finally{if(exit&&token===epoch&&options.active()){discarded=true;options.onDraft?.(null);options.cancel();context=null;}busy=false;if(options.active())editor.setDisabled(options.canSave?.()===false);}
   return false;
  }
 };return editor;
}
