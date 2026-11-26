'use client';
import {projectDetailHref} from './project-detail-href';
import {PlanningInputs} from './planning-inputs';
import{useEffect,useRef,useState,type ComponentType}from'react';
import{Dialog,DialogContent,DialogTitle,DialogDescription}from'../ui-review/ui/dialog';
import type{PublicEntry}from'../platform/contracts';
import type{PersonalEditorFields}from'./editor';
import{clonePersonalJSON,editorFromEntry}from'./editor';
import type{PersonalRelations,PersonalReference}from'./business';
import{taskStatusLabels,taskReceiptMatchesSubmission,type TaskTarget,type TaskIdentity}from'./task-editor-state';
import styles from'./task-editor.module.css';
const empty:PersonalEditorFields={title:'',text:'',date:'',status:'open'};
type CloseGuard={current:(()=>boolean)|null};
type LabelOption=PersonalReference&{title:string};

/** Optional #19 action for one verified saved task. Request a suggestion only after user activation.
 * onAdd stages authorized labels in the draft. The existing Save button remains the only writer. */
export type TaskLabelSuggestionAction=ComponentType<{
 task:TaskIdentity;
 availableLabels:readonly LabelOption[];
 selectedLabels:readonly PersonalReference[];
 onAdd:(labels:readonly PersonalReference[])=>void;
}>;

const noRelations:PersonalRelations={domain:null,project:null,topics:[]};
const related=(fields:PersonalEditorFields)=>fields.personal&&!('type'in fields.personal)?fields.personal:noRelations;
const reference=(entry:PublicEntry):PersonalReference=>({id:entry.id,sourceId:entry.source.id,revision:entry.revision});
type TaskEditorProps={
 target:TaskTarget;
 entry:PublicEntry|null;
 spaceId:string|null;
 relations:Record<string,PublicEntry[]>;
 writable:boolean;
 saving:boolean;
 uncertain:boolean;
 error:string|null;
 onSave:(task:TaskIdentity|null,fields:PersonalEditorFields)=>Promise<PublicEntry|null>;
 onClose:()=>void;
 onRetry:()=>Promise<PublicEntry|null>;
 onStopWaiting:()=>void;
 concealed?:boolean;
 closeGuard?:CloseGuard;
 onBatch?:()=>void;
 onRestoreFocus?:()=>void;
 inPlaceDetail?:boolean;
 LabelSuggestionAction?:TaskLabelSuggestionAction;
};
function confirmClose(busy:boolean,dirty:boolean){
 return !busy&&(!dirty||window.confirm('放弃尚未保存的修改？'));
}
export function TaskEditor({
 target,entry,spaceId,relations,writable,saving,uncertain,error,onSave,onClose,onRetry,onStopWaiting,
 concealed=false,closeGuard,onBatch,onRestoreFocus,inPlaceDetail=false,LabelSuggestionAction,
}:TaskEditorProps){
 const [openingEdit]=useState(()=>{
  if(concealed||target.mode!=='edit'||!entry||!spaceId||
   entry.id!==target.task.id||entry.revision!==target.task.revision)return null;
  return {task:target.task,fields:editorFromEntry(entry,spaceId).fields};
 });
 const initial=useRef<PersonalEditorFields>(openingEdit?.fields??empty);
 const submitted=useRef<PersonalEditorFields|null>(null);
 const approvedDocumentLeave=useRef(false);
 const closeButton=useRef<HTMLButtonElement>(null);
 const suggestionTarget=useRef<string|null>(null);
 const[editTask,setEditTask]=useState<TaskIdentity|null>(openingEdit?.task??null);
 const[fields,setFields]=useState(()=>clonePersonalJSON(initial.current)),[localError,setLocalError]=useState<string|null>(null),[submitting,setSubmitting]=useState(false);
 const busy=saving||uncertain||submitting,dirty=JSON.stringify(fields)!==JSON.stringify(initial.current);
 const viewing=target.mode==='edit'&&!writable&&!dirty;
 const detailFields=viewing&&!concealed&&entry&&spaceId?editorFromEntry(entry,spaceId).fields:null;
 const missing=target.mode==='missing'||target.mode==='edit'&&(!editTask||!entry&&!dirty);
 const blocked=busy||!writable||missing;
 const close=()=>{if(confirmClose(busy,dirty))onClose();};
 useEffect(()=>{
  if(!closeGuard)return;
  closeGuard.current=()=>{
   const accepted=confirmClose(busy,dirty);
   if(accepted)approvedDocumentLeave.current=true;
   return accepted;
  };
  return()=>{closeGuard.current=null;};
 },[busy,dirty,closeGuard]);
 useEffect(()=>{
  const prevent=(event:BeforeUnloadEvent)=>{
   if(approvedDocumentLeave.current){approvedDocumentLeave.current=false;return;}
   if(dirty||busy){event.preventDefault();event.returnValue='';}
  };
  window.addEventListener('beforeunload',prevent);
  return()=>window.removeEventListener('beforeunload',prevent);
 },[dirty,busy]);
 useEffect(()=>{
  if(concealed||busy||dirty||target.mode!=='edit'||!entry||!spaceId||entry.id!==target.task.id||entry.revision===editTask?.revision)return;
  const next=editorFromEntry(entry,spaceId).fields;
  initial.current=next;
  setFields(next);
  setEditTask({id:entry.id,revision:entry.revision});
 },[concealed,busy,dirty,target,entry,spaceId,editTask?.revision]);
 const suggestionKey=!concealed&&!blocked&&editTask&&entry?.id===editTask.id&&entry.revision===editTask.revision
  ?JSON.stringify([spaceId,entry.id,entry.revision,entry.source.id]):null;
 useEffect(()=>{
  suggestionTarget.current=suggestionKey;
  return()=>{suggestionTarget.current=null;};
 },[suggestionKey]);
 // Keep component memory through concealment; do not render private DOM until the host re-verifies its binding.
 if(concealed)return null;
 const shown=detailFields??fields;
 const relation=related(shown);
 const setProject=(project:PersonalReference|null)=>setFields(current=>({...current,personal:{...related(current),project}}));
 const toggleLabel=(id:string,selected:PersonalReference|null)=>setFields(current=>{
  const relations=related(current);
  const remaining=relations.topics.filter(pin=>pin.id!==id);
  return {...current,personal:{...relations,topics:selected?[...remaining,selected]:remaining}};
 });
 const relationName=(type:'domain'|'project'|'topic',pin:PersonalReference|null)=>{
  if(!pin)return '未设置';
  const match=relations[type]?.find(value=>value.id===pin.id&&value.source.id===pin.sourceId);
  if(!match||!('title'in match.draft))return '原关联（待核对）';
  return match.revision===pin.revision?match.draft.title:match.draft.title+'（版本已变化）';
 };
 const project=relation.project&&relations.project?.find(value=>value.id===relation.project?.id&&value.source.id===relation.project.sourceId);
 const projectName=relationName('project',relation.project);
 const relatedProject=project?<a href={projectDetailHref(project.id)} onClick={event=>{
  if(event.button!==0||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
  if(!confirmClose(busy,dirty)){event.preventDefault();return;}
  approvedDocumentLeave.current=true;
 }}>{projectName}</a>:projectName;
 const topicOptions=(relations.topic??[]).flatMap(value=>'title'in value.draft?[{...reference(value),title:value.draft.title}]:[]);
 const stageLabels=(requested:readonly PersonalReference[])=>{
  if(!suggestionKey||suggestionTarget.current!==suggestionKey)return;
  const candidates=topicOptions.filter(option=>requested.some(ref=>ref.id===option.id&&ref.sourceId===option.sourceId&&ref.revision===option.revision));
  if(!candidates.length)return;
  setFields(current=>{
   const existing=related(current);
   const additions=candidates.filter(option=>!existing.topics.some(ref=>ref.id===option.id));
   return additions.length?{...current,personal:{...existing,topics:[...existing.topics,...additions.map(({id,sourceId,revision})=>({id,sourceId,revision}))]}}:current;
  });
 };
 const labels=<details className={styles.disclosure}>
  <summary>标签（可选）{relation.topics.length>0&&<span className={styles.labelCount}>{relation.topics.length}</span>}</summary>
  <fieldset aria-label="选择已有标签">
   {!topicOptions.length&&<p>暂无可选标签</p>}
   {relation.topics.filter(pin=>!topicOptions.some(option=>option.id===pin.id&&option.sourceId===pin.sourceId)).map(pin=>
    <label className={styles.topic} key={pin.id}><input type="checkbox" checked onChange={()=>toggleLabel(pin.id,null)}/>不可用标签（取消勾选以移除）</label>)}
   {topicOptions.map(({id,sourceId,revision,title})=><label className={styles.topic} key={id}>
    <input type="checkbox" checked={relation.topics.some(pin=>pin.id===id&&pin.sourceId===sourceId)}
     onChange={event=>toggleLabel(id,event.target.checked?{id,sourceId,revision}:null)}/>{title}
   </label>)}
  </fieldset>
  {LabelSuggestionAction&&suggestionKey&&editTask&&topicOptions.length>0&&
   <LabelSuggestionAction task={editTask} availableLabels={topicOptions} selectedLabels={relation.topics} onAdd={stageLabels}/>}
 </details>;
 const projectMatches=!!project;
 const association=<details className={styles.disclosure}>
  <summary>关联</summary>
  {viewing?<dl><div><dt>项目</dt><dd>{relatedProject}</dd></div>{relation.domain&&<div><dt>原有领域</dt><dd>{relationName('domain',relation.domain)}</dd></div>}</dl>:
   <><label>关联项目<select value={relation.project?.id??''} onChange={event=>{const selected=relations.project?.find(value=>value.id===event.target.value);setProject(selected?reference(selected):null);}}>
    <option value="">不关联项目</option>
    {relation.project&&!projectMatches&&<option value={relation.project.id} disabled>原关联（待核对）</option>}
    {relations.project?.filter(value=>projectMatches||value.id!==relation.project?.id).map(value=>
     <option key={value.id} value={value.id}>{'title'in value.draft?value.draft.title:''}{relation.project?.id===value.id&&relation.project.revision!==value.revision?'（版本已变化，重新选择核对）':''}</option>)}
   </select></label>
   {project&&<p>{relatedProject}</p>}
   {relation.domain&&<p>原有领域 {relationName('domain',relation.domain)}</p>}</>}
 </details>;
 const heading=target.mode==='create'?'新建待办':missing?'待办不可用':'待办详情';
 const content=missing?<p role="alert">无法读取这条待办，未创建新记录。</p>:viewing?<div className={styles.form}>
   <div className={`${styles.body} ${styles.detail}`} tabIndex={0} aria-label="读取待办内容">
    <h3>{shown.title}</h3>
    <p className={styles.detailText}>{shown.text||'暂无正文'}</p>
    <dl>
     <div><dt>计划开始</dt><dd>{shown.plannedStartOn||'未设置'}</dd></div><div><dt>计划结束</dt><dd>{shown.plannedEndOn||'未设置'}</dd></div>
     <div><dt>到期日</dt><dd>{shown.date||'未设置'}</dd></div>
     <div><dt>状态</dt><dd>{taskStatusLabels[shown.status]}</dd></div>
     <div><dt>标签</dt><dd>{relation.topics.length?relation.topics.map(topic=>relationName('topic',topic)).join('、'):'未设置'}</dd></div>
    </dl>
    {association}
   </div>
  </div>:<form className={styles.form} onSubmit={async event=>{event.preventDefault();if(blocked)return;submitted.current=clonePersonalJSON(fields);setSubmitting(true);setLocalError(null);try{const saved=await onSave(editTask,fields);if(saved)onClose();}catch{setLocalError('保存失败，请保留内容后重试。');}finally{setSubmitting(false);}}}>
   <div className={styles.body}><fieldset disabled={blocked}>
    <label>标题<input autoFocus={!inPlaceDetail} required maxLength={240} value={fields.title} onChange={e=>setFields({...fields,title:e.target.value})}/></label>
    <label>正文<textarea rows={inPlaceDetail?4:6} maxLength={16384} value={fields.text} onChange={e=>setFields({...fields,text:e.target.value})}/></label>
    <div className={styles.row}><label>到期日<input type="date" value={fields.date} onChange={e=>setFields({...fields,date:e.target.value})}/></label><label>状态<select value={fields.status} onChange={e=>setFields({...fields,status:e.target.value as PersonalEditorFields['status']})}>{Object.entries(taskStatusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label></div>
    <PlanningInputs className={styles.row} value={{plannedStartOn:fields.plannedStartOn||null,plannedEndOn:fields.plannedEndOn||null}} onChange={(field,value)=>setFields({...fields,[field]:value??''})}/>
    {labels}
    {target.mode==='edit'&&association}
   </fieldset></div>
   {(localError||error)&&<p role="alert">{localError||error}</p>}{uncertain&&<p role="alert">结果尚未确认，请保留输入并重试原请求。</p>}
   <footer className={styles.footer}>{target.mode==='create'&&onBatch&&<button type="button" disabled={busy||dirty||!writable} onClick={onBatch}>多行录入</button>}{uncertain&&<button type="button" disabled={saving} onClick={async()=>{const saved=await onRetry();if(saved&&taskReceiptMatchesSubmission(editTask?{mode:'edit',task:editTask}:target,submitted.current,saved,spaceId))onClose();}}>重试同一请求</button>}{saving&&<button type="button" onClick={onStopWaiting}>停止等待并保留请求</button>}<button type="button" disabled={busy} onClick={close}>{dirty?'取消':'关闭'}</button><button type="submit" disabled={blocked}>{saving||submitting?'正在保存…':'保存待办'}</button></footer>
  </form>;
 return <div data-lifeos-surface="personal"><Dialog open onOpenChange={open=>{if(!open)close();}}><DialogContent className={`${styles.editor}${inPlaceDetail?' '+styles.inlineDetail:''}`}
  overlayClassName={inPlaceDetail?styles.detailBackdrop:undefined} data-lifeos-surface="personal" data-task-detail-focus
  onOpenAutoFocus={event=>{if(inPlaceDetail){event.preventDefault();closeButton.current?.focus({preventScroll:true});}}} onCloseAutoFocus={event=>{event.preventDefault();onRestoreFocus?.();}} showCloseButton={false} onEscapeKeyDown={event=>{if(busy)event.preventDefault();}} onPointerDownOutside={event=>{event.preventDefault();close();}}>
  <header className={styles.header}><div><DialogTitle>{heading}</DialogTitle><DialogDescription className={styles.accessibleDescription}>{missing?'无法读取所选待办。':!writable?'当前为只读，可查看内容。':viewing?'查看待办内容及关联。':'待办内容'}</DialogDescription>{!missing&&!writable&&<p role="status">当前为只读，可查看内容。</p>}</div><button ref={closeButton} type="button" aria-label={target.mode==='create'?'关闭待办编辑':'关闭待办详情'} disabled={busy} onClick={close}>关闭</button></header>
  {content}
 </DialogContent></Dialog></div>;
}
