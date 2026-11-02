'use client';
import{TaskCellDraftMemory}from'./task-cell-draft';
import{flushSync}from'react-dom';
import type{PersonalBinding}from'./client';
import{useEffect,useRef,useState,type ReactNode}from'react';
import{PersonalWorkspaceController,type ControllerSnapshot}from'./workspace-controller';
import{TaskEditor}from'./task-editor';
import editorStyles from './task-editor.module.css';
import{editorFromEntry,type PersonalEditorFields}from'./editor';
import{resolveTaskTarget,type TaskTarget}from'./task-editor-state';
import type{PublicEntry}from'../platform/contracts';
import type{WorkspaceTask}from'./workspace-data';
type EditorContext={target:TaskTarget;binding:PersonalBinding;entry:PublicEntry|null};
const sameBinding=(a:PersonalBinding,b:PersonalBinding)=>a.ownerId===b.ownerId&&a.spaceId===b.spaceId;
/** UI-only shell is supplied by its owner; this host alone owns personal API access. */
export function ConnectedPersonalWorkspace({children,initialTaskId,initialCreateTask=false}:{initialTaskId?:string;initialCreateTask?:boolean;children:(props:ControllerSnapshot&{onRefresh:()=>void;onLogin:()=>void;onLogout:()=>void;onCreateTask:()=>void;onOpenTask:(task:Pick<WorkspaceTask,'id'|'revision'>)=>void;taskCellDraftMemory:TaskCellDraftMemory;onRetryTaskMutation:()=>Promise<PublicEntry|null>;onSaveTask:(task:Pick<WorkspaceTask,'id'|'revision'>|null,fields:PersonalEditorFields)=>Promise<PublicEntry|null>;getTaskFields:(task:Pick<WorkspaceTask,'id'|'revision'>)=>PersonalEditorFields|null;onUndoTaskStatus:()=>void;onSetTaskStatus:(task:Pick<WorkspaceTask,'id'|'revision'>,status:WorkspaceTask['status'])=>void})=>ReactNode}){
 const controller=useRef<PersonalWorkspaceController|null>(null);
 const cellDrafts=useRef(new TaskCellDraftMemory()).current;
 const[snapshot,setSnapshot]=useState<ControllerSnapshot>({state:{status:'unknown'},access:{authenticated:null,writable:null,loginAllowed:null},pendingTaskIds:[],mutationError:null,uncertain:false,saving:false,undoDeadline:null});
 const[editor,setEditor]=useState<EditorContext|null>(null),initialOpened=useRef(false),returnFocus=useRef<HTMLElement|null>(null);
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
 useEffect(()=>{if(editor&&verifiedBinding&&!sameBinding(editor.binding,verifiedBinding))setEditor(null);},[snapshot.state,editor]);
 const navigate=(url:string)=>{if(snapshot.saving||snapshot.uncertain)return;window.location.assign(url);};
 const open=(next:TaskTarget)=>{if(snapshot.saving||snapshot.uncertain)return;const binding=controller.current?.getEditorBinding();if(!binding)return;returnFocus.current=document.activeElement as HTMLElement|null;setEditor({target:next,binding,entry:next.mode==='edit'?controller.current?.getTaskEntry(next.task)??null:null});};
 const close=()=>{setEditor(null);queueMicrotask(()=>returnFocus.current?.isConnected&&returnFocus.current.focus());};
 const save=async(task:Pick<WorkspaceTask,'id'|'revision'>|null,fields:PersonalEditorFields)=>{const saved=await controller.current?.saveTask(task,fields)??null;if(saved)cellDrafts.confirm(saved);return saved;};
 const retry=async()=>{const saved=await controller.current?.retry()??null;if(saved)cellDrafts.confirm(saved);return saved;};
 const getTaskFields=(task:Pick<WorkspaceTask,'id'|'revision'>)=>{const host=controller.current,entry=host?.getTaskEntry(task),space=host?.getSpaceId();return entry&&space?editorFromEntry(entry,space).fields:null;};
 return <>{children({...snapshot,onRefresh:()=>{if(!editor||concealed)void controller.current?.refresh();},onLogin:()=>navigate('/login'),onLogout:()=>{if(!editor||concealed){setEditor(null);void controller.current?.logout();}},onCreateTask:()=>open({mode:'create'}),onOpenTask:task=>open({mode:'edit',task}),onSaveTask:save,getTaskFields,taskCellDraftMemory:cellDrafts,onRetryTaskMutation:retry,onUndoTaskStatus:()=>void controller.current?.undoTaskStatus(),onSetTaskStatus:(task,status)=>{if(snapshot.access.writable)void controller.current?.setTaskStatus(task,status);}})}
 {editor&&<TaskEditor key={editor.target.mode==='edit'?editor.target.task.id:editor.target.mode} target={editor.target} entry={editor.entry} spaceId={editor.binding.spaceId} concealed={concealed} relations={concealed?{}:controller.current?.getRelationOptions()??{}} writable={snapshot.access.writable===true} saving={snapshot.saving} uncertain={snapshot.uncertain} error={snapshot.mutationError} onSave={save} onClose={close} onRetry={retry} onStopWaiting={()=>controller.current?.cancel()}/>}
 {(!editor||concealed)&&snapshot.uncertain&&<section role="alert" className={editorStyles.recovery}><p>保存结果尚未确认，原请求已保留。</p><button onClick={async()=>{if(await retry())close();}} disabled={snapshot.saving}>重试同一请求</button></section>}
 {(!editor||concealed)&&snapshot.saving&&<button onClick={()=>controller.current?.cancel()}>停止等待并保留请求</button>}</>;
}
