'use client';
import{TaskCellDraftMemory}from'./task-cell-draft';
import{flushSync}from'react-dom';
import type{PersonalBinding}from'./client';
import{useEffect,useRef,useState,type ReactNode}from'react';
import{PersonalWorkspaceController,type ControllerSnapshot}from'./workspace-controller';
import{TaskEditor}from'./task-editor';
import editorStyles from './task-editor.module.css';
import{editorFromEntry,type PersonalEditorFields}from'./editor';
import{resolveTaskTarget,type TaskIdentity,type TaskTarget}from'./task-editor-state';
import type{PublicEntry}from'../platform/contracts';
import type{WorkspaceTask}from'./workspace-data';
type EditorContext={target:TaskTarget;binding:PersonalBinding;inline:boolean};
type TaskActions={
 onRefresh:()=>void;onLogin:()=>void;onLogout:()=>void;onCreateTask:()=>void;
 onOpenTask:(task:TaskIdentity)=>void;
 onEditTaskInline:(task:TaskIdentity,trigger?:HTMLElement)=>void;
 inlineTask:{id:string;content:ReactNode}|null;
 onLeaveTaskInline:()=>boolean;
 taskCellDraftMemory:TaskCellDraftMemory;
 onRetryTaskMutation:()=>Promise<PublicEntry|null>;
 onSaveTask:(task:TaskIdentity|null,fields:PersonalEditorFields)=>Promise<PublicEntry|null>;
 getTaskFields:(task:TaskIdentity)=>PersonalEditorFields|null;
 onUndoTaskStatus:()=>void;
 onSetTaskStatus:(task:TaskIdentity,status:WorkspaceTask['status'])=>void;
};
const sameBinding=(a:PersonalBinding,b:PersonalBinding)=>a.ownerId===b.ownerId&&a.spaceId===b.spaceId;
/** UI-only shell is supplied by its owner; this host alone owns personal API access. */
export function ConnectedPersonalWorkspace({children,initialTaskId,initialCreateTask=false}:{initialTaskId?:string;initialCreateTask?:boolean;children:(props:ControllerSnapshot&TaskActions)=>ReactNode}){
 const controller=useRef<PersonalWorkspaceController|null>(null);
 const cellDrafts=useRef(new TaskCellDraftMemory()).current;
 const[snapshot,setSnapshot]=useState<ControllerSnapshot>({state:{status:'unknown'},access:{authenticated:null,writable:null,loginAllowed:null},pendingTaskIds:[],mutationError:null,uncertain:false,saving:false,undoDeadline:null});
 const[editor,setEditor]=useState<EditorContext|null>(null),initialOpened=useRef(false),returnFocus=useRef<HTMLElement|null>(null);
 const inlineCloseGuard=useRef<(()=>boolean)|null>(null);
 useEffect(()=>{let storage:Storage|undefined;try{storage=window.sessionStorage;}catch{/* Without reliable command retention, mutation will be disabled below. */}
  const host=new PersonalWorkspaceController({fetcher:(url,init)=>fetch(url,init),origin:window.location.origin,storage,today:()=>new Date().toLocaleDateString('sv-SE'),key:()=>crypto.randomUUID()});controller.current=host;
  const update=()=>{const value=host.getSnapshot();cellDrafts.verify(value.state.status==='ready'?host.getEditorBinding():null);setSnapshot(storage?value:{...value,access:{...value.access,writable:false},mutationError:'浏览器无法保留待确认请求，当前仅可读取。'});};const stop=host.subscribe(update);update();void host.refresh();
  const visibility=()=>{if(document.visibilityState==='hidden'){cellDrafts.conceal();flushSync(()=>host.suspend());}else void host.refresh();};document.addEventListener('visibilitychange',visibility);
  const warn=(event:BeforeUnloadEvent)=>{cellDrafts.captureCurrent();const value=host.getSnapshot();if(cellDrafts.hasDraft()||value.saving||value.uncertain){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',warn);
  return()=>{stop();host.suspend();cellDrafts.clear();controller.current=null;document.removeEventListener('visibilitychange',visibility);window.removeEventListener('beforeunload',warn);};
 },[]);
 useEffect(()=>{if(initialOpened.current||snapshot.state.status!=='ready')return;initialOpened.current=true;const target=resolveTaskTarget(initialTaskId,initialCreateTask,snapshot.state.data.tasks);if(target){returnFocus.current=document.activeElement as HTMLElement|null;open(target);}},[snapshot.state,initialTaskId,initialCreateTask]);
 // A draft stays in component memory while concealed, scoped to its original verified owner and space.
 const verifiedBinding=controller.current?.getEditorBinding()??null;
 const concealed=!verifiedBinding||!editor||!sameBinding(editor.binding,verifiedBinding);
 const selectedId=editor?.target.mode==='edit'?editor.target.task.id:null;
 const selectedTask=!concealed&&selectedId&&snapshot.state.status==='ready'
  ?snapshot.state.data.tasks.find(task=>task.id===selectedId)
  :null;
 const selectedEntry=selectedTask?controller.current?.getTaskEntry(selectedTask)??null:null;
 useEffect(()=>{if(editor&&verifiedBinding&&!sameBinding(editor.binding,verifiedBinding))setEditor(null);},[snapshot.state,editor]);
 const canLeaveInline=()=>!editor?.inline||(!snapshot.saving&&!snapshot.uncertain&&(inlineCloseGuard.current?.()??true));
 const leaveInline=()=>{
  if(!canLeaveInline())return false;
  if(editor?.inline)setEditor(null);
  return true;
 };
 const navigate=(url:string)=>{if(snapshot.saving||snapshot.uncertain||!leaveInline())return;window.location.assign(url);};
 const open=(next:TaskTarget,inline=false,trigger?:HTMLElement)=>{
  if(snapshot.saving||snapshot.uncertain)return;
  const host=controller.current,binding=host?.getEditorBinding();
  if(!binding)return;
  if(inline){
   if(next.mode!=='edit'||snapshot.access.writable!==true||
    snapshot.pendingTaskIds.includes(next.task.id)||!host?.getTaskEntry(next.task))return;
   if(editor?.inline&&selectedId===next.task.id)return;
  }
  if(!canLeaveInline())return;
  returnFocus.current=trigger??(document.activeElement as HTMLElement|null);
  setEditor({target:next,binding,inline});
 };
 const close=()=>{setEditor(null);queueMicrotask(()=>returnFocus.current?.isConnected&&returnFocus.current.focus());};
 const save=async(task:TaskIdentity|null,fields:PersonalEditorFields)=>{const saved=await controller.current?.saveTask(task,fields)??null;if(saved)cellDrafts.confirm(saved);return saved;};
 const retry=async()=>{const saved=await controller.current?.retry()??null;if(saved)cellDrafts.confirm(saved);return saved;};
 const getTaskFields=(task:TaskIdentity)=>{const host=controller.current,entry=host?.getTaskEntry(task),space=host?.getSpaceId();return entry&&space?editorFromEntry(entry,space).fields:null;};
 const editorContent=editor&&<TaskEditor
  key={`${editor.inline?'inline':'dialog'}:${selectedId??editor.target.mode}`}
  target={editor.target} entry={selectedEntry} spaceId={editor.binding.spaceId} concealed={concealed}
  relations={concealed?{}:controller.current?.getRelationOptions()??{}}
  writable={snapshot.access.writable===true} saving={snapshot.saving} uncertain={snapshot.uncertain}
  error={snapshot.mutationError} onSave={save} onClose={close} onRetry={retry}
  onStopWaiting={()=>controller.current?.cancel()} inline={editor.inline}
  closeGuard={editor.inline?inlineCloseGuard:undefined}
 />;
 return <>{children({
  ...snapshot,
  onRefresh:()=>{if(!editor||concealed)void controller.current?.refresh();},
  onLogin:()=>navigate('/login'),
  onLogout:()=>{
   if((editor&&!editor.inline&&!concealed)||!canLeaveInline())return;
   setEditor(null);
   void controller.current?.logout();
  },
  onCreateTask:()=>open({mode:'create'}),
  onOpenTask:task=>open({mode:'edit',task}),
  onEditTaskInline:(task,trigger)=>open({mode:'edit',task},true,trigger),
  inlineTask:editor?.inline&&selectedId?{id:selectedId,content:editorContent}:null,
  onLeaveTaskInline:leaveInline,
  onSaveTask:save,getTaskFields,taskCellDraftMemory:cellDrafts,onRetryTaskMutation:retry,
  onUndoTaskStatus:()=>{if(!editor?.inline)void controller.current?.undoTaskStatus();},
  onSetTaskStatus:(task,status)=>{
   if(snapshot.access.writable&&!editor?.inline)void controller.current?.setTaskStatus(task,status);
  },
 })}
 {!editor?.inline&&editorContent}
 {(!editor||concealed)&&snapshot.uncertain&&<section role="alert" className={editorStyles.recovery}><p>保存结果尚未确认，原请求已保留。</p><button onClick={async()=>{if(await retry())close();}} disabled={snapshot.saving}>重试同一请求</button></section>}
 {(!editor||concealed)&&snapshot.saving&&<button onClick={()=>controller.current?.cancel()}>停止等待并保留请求</button>}</>;
}
