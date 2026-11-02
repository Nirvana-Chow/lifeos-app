'use client';
import{useEffect,useRef,useState}from'react';
import{Dialog,DialogContent,DialogTitle,DialogDescription}from'../ui-review/ui/dialog';
import type{PublicEntry}from'../platform/contracts';
import type{PersonalEditorFields}from'./editor';
import{editorFromEntry}from'./editor';
import type{PersonalRelations,PersonalReference}from'./business';
import{taskStatusLabels,taskReceiptMatchesSubmission,type TaskTarget,type TaskIdentity}from'./task-editor-state';
import styles from'./task-editor.module.css';
const empty:PersonalEditorFields={title:'',text:'',date:'',status:'open'};
export function TaskEditor({target,entry,spaceId,relations,writable,saving,uncertain,error,onSave,onClose,onRetry,onStopWaiting,concealed=false}:{target:TaskTarget;entry:PublicEntry|null;spaceId:string|null;relations:Record<string,PublicEntry[]>;writable:boolean;saving:boolean;uncertain:boolean;error:string|null;onSave:(task:TaskIdentity|null,fields:PersonalEditorFields)=>Promise<PublicEntry|null>;onClose:()=>void;onRetry:()=>Promise<PublicEntry|null>;onStopWaiting:()=>void;concealed?:boolean}){
 const initial=useRef<PersonalEditorFields>(target.mode==='edit'&&entry&&spaceId?editorFromEntry(entry,spaceId).fields:empty);
 const submitted=useRef<PersonalEditorFields|null>(null);
 const[fields,setFields]=useState(()=>structuredClone(initial.current)),[localError,setLocalError]=useState<string|null>(null),[submitting,setSubmitting]=useState(false);
 const busy=saving||uncertain||submitting,dirty=JSON.stringify(fields)!==JSON.stringify(initial.current),missing=target.mode==='missing'||target.mode==='edit'&&(!entry||!spaceId);
 const blocked=busy||!writable||missing;
 const close=()=>{if(busy)return;if(!dirty||window.confirm('放弃尚未保存的修改？'))onClose();};
 useEffect(()=>{const prevent=(event:BeforeUnloadEvent)=>{if(dirty||busy){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',prevent);return()=>window.removeEventListener('beforeunload',prevent);},[dirty,busy]);
 // Keep component memory through concealment; do not render private DOM until the host re-verifies its binding.
 if(concealed)return null;
 const relation=fields.personal&&!('type'in fields.personal)?fields.personal:{domain:null,project:null,topics:[]};
 const reference=(entry:PublicEntry):PersonalReference=>({id:entry.id,sourceId:entry.source.id,revision:entry.revision});
 const setRelation=(patch:Partial<PersonalRelations>)=>setFields({...fields,personal:{...relation,...patch}});
 return <div data-lifeos-surface="personal"><Dialog open onOpenChange={open=>{if(!open)close();}}><DialogContent className={styles.editor} data-lifeos-surface="personal" onCloseAutoFocus={event=>event.preventDefault()} showCloseButton={false} onEscapeKeyDown={event=>{if(busy)event.preventDefault();}} onPointerDownOutside={event=>{event.preventDefault();close();}}>
  <header className={styles.header}><div><DialogTitle>{target.mode==='create'?'新建待办':missing?'待办不可用':'编辑待办'}</DialogTitle><DialogDescription className={styles.accessibleDescription}>{missing?'无法读取所选待办。':!writable?'当前为只读，可查看内容。':'待办内容'}</DialogDescription>{!missing&&!writable&&<p role="status">当前为只读，可查看内容。</p>}</div><button type="button" aria-label="关闭待办编辑" disabled={busy} onClick={close}>关闭</button></header>
  {missing?<p role="alert">无法读取这条待办，未创建新记录。</p>:<form className={styles.form} onSubmit={async event=>{event.preventDefault();if(blocked)return;submitted.current=structuredClone(fields);setSubmitting(true);setLocalError(null);try{const saved=await onSave(target.mode==='edit'?target.task:null,fields);if(saved)onClose();}catch{setLocalError('保存失败，请保留内容后重试。');}finally{setSubmitting(false);}}}>
   <div className={styles.body}><fieldset disabled={blocked}>
    <label>标题<input autoFocus required maxLength={240} value={fields.title} onChange={e=>setFields({...fields,title:e.target.value})}/></label>
    <label>正文<textarea rows={6} maxLength={16384} value={fields.text} onChange={e=>setFields({...fields,text:e.target.value})}/></label>
    <div className={styles.row}><label>到期日<input type="date" value={fields.date} onChange={e=>setFields({...fields,date:e.target.value})}/></label><label>状态<select value={fields.status} onChange={e=>setFields({...fields,status:e.target.value as PersonalEditorFields['status']})}>{Object.entries(taskStatusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label></div>
    <details><summary>分类（可选）</summary>{(['domain','project'] as const).map(type=><label key={type}>{type==='domain'?'领域':'项目'}<select value={relation[type]?.id??''} onChange={e=>{const entry=relations[type]?.find(v=>v.id===e.target.value);setRelation({[type]:entry?reference(entry):null});}}><option value="">不分类</option>{relation[type]&&!relations[type]?.some(v=>v.id===relation[type]?.id)&&<option value={relation[type]!.id}>原关联（待核对）</option>}{relations[type]?.map(v=><option key={v.id} value={v.id}>{'title'in v.draft?v.draft.title:''}{relation[type]?.id===v.id&&relation[type]?.revision!==v.revision?'（版本已变化，重新选择核对）':''}</option>)}</select></label>)}
     <fieldset><legend>主题</legend>{!relations.topic?.length&&<p>暂无可选主题</p>}{relation.topics.filter(t=>!relations.topic?.some(v=>v.id===t.id)).map(t=><label className={styles.topic} key={t.id}><input type="checkbox" checked onChange={e=>{if(!e.target.checked)setRelation({topics:relation.topics.filter(v=>v.id!==t.id)});}}/>不可用主题（取消勾选以移除）</label>)}{relations.topic?.map(v=><label className={styles.topic} key={v.id}><input type="checkbox" checked={relation.topics.some(t=>t.id===v.id)} onChange={e=>setRelation({topics:e.target.checked?[...relation.topics.filter(t=>t.id!==v.id),reference(v)]:relation.topics.filter(t=>t.id!==v.id)})}/>{'title'in v.draft?v.draft.title:''}</label>)}</fieldset>
    </details>
   </fieldset></div>
   {(localError||error)&&<p role="alert">{localError||error}</p>}{uncertain&&<p role="alert">结果尚未确认，请保留输入并重试原请求。</p>}
   <footer className={styles.footer}>{uncertain&&<button type="button" disabled={saving} onClick={async()=>{const saved=await onRetry();if(saved&&taskReceiptMatchesSubmission(target,submitted.current,saved,spaceId))onClose();}}>重试同一请求</button>}{saving&&<button type="button" onClick={onStopWaiting}>停止等待并保留请求</button>}<button type="button" disabled={busy} onClick={close}>{dirty?'取消':'关闭'}</button><button type="submit" disabled={blocked}>{saving||submitting?'正在保存…':'保存待办'}</button></footer>
  </form>}
 </DialogContent></Dialog></div>;
}
