'use client';
import{TaskCellDraftMemory}from'./task-cell-draft';
import{flushSync}from'react-dom';
import type{PersonalBinding}from'./client';
import{useEffect,useRef,useState,type ReactNode}from'react';
import{PersonalWorkspaceController,type ControllerSnapshot}from'./workspace-controller';
import{TaskEditor}from'./task-editor';
import{TaskBatchEditor}from'./task-batch-editor';
import editorStyles from './task-editor.module.css';
import{editorFromEntry,type PersonalEditorFields}from'./editor';
import{resolveTaskTarget,type TaskIdentity,type TaskTarget}from'./task-editor-state';
import type{PublicEntry}from'../platform/contracts';
import type{WorkspaceTask}from'./workspace-data';
type EditorContext={target:TaskTarget;binding:PersonalBinding};
type TaskActions={
 viewPreferenceScope:string|null;
 onRefresh:()=>void;onLogin:()=>void;onLogout:()=>void;onCreateTask:()=>boolean;
 onOpenTask:(task:TaskIdentity,trigger?:HTMLElement)=>boolean;
 onBeforeNavigate:()=>boolean;
 onBeforeSettingsChange:()=>boolean;
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
 const commandStorage=useRef(false);
 const cellDrafts=useRef(new TaskCellDraftMemory()).current;
 const[snapshot,setSnapshot]=useState<ControllerSnapshot>({state:{status:'unknown'},access:{authenticated:null,writable:null,loginAllowed:null},pendingTaskIds:[],mutationError:null,uncertain:false,saving:false,undoDeadline:null});
 const[editor,setEditor]=useState<EditorContext|null>(null),initialOpened=useRef(false),returnFocus=useRef<HTMLElement|null>(null);
 const[batchBinding,setBatchBinding]=useState<PersonalBinding|null>(null);
 const restoredBatchScope=useRef<string|null>(null);
 const batchCloseGuard=useRef<(()=>boolean)|null>(null);
 const editorCloseGuard=useRef<(()=>boolean)|null>(null);
 useEffect(()=>{let storage:Storage|undefined;try{storage=window.sessionStorage;}catch{/* Without reliable command retention, mutation will be disabled below. */}
  commandStorage.current=!!storage;
  const host=new PersonalWorkspaceController({fetcher:(url,init)=>fetch(url,init),origin:window.location.origin,storage,today:()=>new Date().toLocaleDateString('sv-SE'),key:()=>crypto.randomUUID()});controller.current=host;
  const update=()=>{const value=host.getSnapshot();cellDrafts.verify(value.state.status==='ready'?host.getEditorBinding():null);setSnapshot(storage?value:{...value,access:{...value.access,writable:false},mutationError:'浏览器无法保留待确认请求，当前仅可读取。'});};const stop=host.subscribe(update);update();void host.refresh();
  const visibility=()=>{if(document.visibilityState==='hidden'){cellDrafts.conceal();flushSync(()=>host.suspend());}else void host.refresh();};document.addEventListener('visibilitychange',visibility);
  const warn=(event:BeforeUnloadEvent)=>{cellDrafts.captureCurrent();const value=host.getSnapshot();if(cellDrafts.hasDraft()||value.saving||value.uncertain){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',warn);
  return()=>{stop();host.suspend();cellDrafts.clear();controller.current=null;commandStorage.current=false;document.removeEventListener('visibilitychange',visibility);window.removeEventListener('beforeunload',warn);};
 },[]);
 useEffect(()=>{if(initialOpened.current||snapshot.state.status!=='ready')return;initialOpened.current=true;const target=resolveTaskTarget(initialTaskId,initialCreateTask,snapshot.state.data.tasks);if(target){returnFocus.current=document.activeElement as HTMLElement|null;open(target);}},[snapshot.state,initialTaskId,initialCreateTask]);
 // A draft stays in component memory while concealed, scoped to its original verified owner and space.
 const verifiedBinding=controller.current?.getEditorBinding()??null;
 const concealed=!verifiedBinding||!editor||!sameBinding(editor.binding,verifiedBinding);
 useEffect(()=>{if(!verifiedBinding)return;const scope=JSON.stringify([verifiedBinding.ownerId,verifiedBinding.spaceId]);if(restoredBatchScope.current===scope)return;restoredBatchScope.current=scope;setBatchBinding(null);try{const retained=window.sessionStorage.getItem('lifeos.personal.todo-batch.v1:'+encodeURIComponent(verifiedBinding.ownerId)+':'+encodeURIComponent(verifiedBinding.spaceId));const host=controller.current;const matching=!host?.getSnapshot().uncertain||retained&&JSON.parse(retained).rows?.some((row:{command:unknown})=>host?.matchesPendingBatchCommand(row.command));if(retained&&matching){setEditor(null);setBatchBinding(verifiedBinding);}else setBatchBinding(null);}catch{/* Editor reports storage failure on open. */}},[verifiedBinding?.ownerId,verifiedBinding?.spaceId]);
 const selectedId=editor?.target.mode==='edit'?editor.target.task.id:null;
 const selectedTask=!concealed&&selectedId&&snapshot.state.status==='ready'
  ?snapshot.state.data.tasks.find(task=>task.id===selectedId)
  :null;
 const selectedEntry=selectedTask?controller.current?.getTaskEntry(selectedTask)??null:null;
 useEffect(()=>{if(editor&&verifiedBinding&&!sameBinding(editor.binding,verifiedBinding))setEditor(null);},[snapshot.state,editor]);
 const beforeNavigate=()=>{
  const current=controller.current?.getSnapshot();
  if(current?.saving||current?.uncertain)return false;
  cellDrafts.captureCurrent();
  if(cellDrafts.hasDraft()&&!window.confirm('放弃尚未保存的修改？'))return false;
  if(editorCloseGuard.current?.()===false)return false;
  if(batchCloseGuard.current?.()===false)return false;
  cellDrafts.discardCurrent();
  setEditor(null);setBatchBinding(null);
  return true;
 };
 const navigate=(url:string)=>{if(beforeNavigate())window.location.assign(url);};
 const login=()=>{if(batchBinding&&!verifiedBinding)window.location.assign('/login');else navigate('/login');};
 const refresh=()=>{if(batchBinding&&!verifiedBinding)void controller.current?.refresh();else if(beforeNavigate())void controller.current?.refresh();};
 const open=(next:TaskTarget,trigger?:HTMLElement)=>{
  const host=controller.current,binding=host?.getEditorBinding();
  if(!binding||!beforeNavigate())return false;
  returnFocus.current=trigger??(document.activeElement as HTMLElement|null);
  setEditor({target:next,binding});
  return true;
 };
 const close=()=>{setEditor(null);queueMicrotask(()=>returnFocus.current?.isConnected&&returnFocus.current.focus());};
 const save=async(task:TaskIdentity|null,fields:PersonalEditorFields)=>{if(!commandStorage.current)return null;const saved=await controller.current?.saveTask(task,fields)??null;if(saved)cellDrafts.confirm(saved);return saved;};
 const retry=async()=>{const saved=await controller.current?.retry()??null;if(saved)cellDrafts.confirm(saved);return saved;};
 const getTaskFields=(task:TaskIdentity)=>{
  const host=controller.current,current=host?.getSnapshot();
  if(current?.saving||current?.uncertain)return null;
  const entry=host?.getTaskEntry(task),space=host?.getSpaceId();
  return entry&&space?editorFromEntry(entry,space).fields:null;
 };
 const editorContent=editor&&<TaskEditor
  key={selectedId??editor.target.mode}
  target={editor.target} entry={selectedEntry} spaceId={editor.binding.spaceId} concealed={concealed}
  relations={concealed?{}:controller.current?.getRelationOptions()??{}}
  writable={snapshot.access.writable===true} saving={snapshot.saving} uncertain={snapshot.uncertain}
  error={snapshot.mutationError} onSave={save} onClose={close} onRetry={retry}
  onStopWaiting={()=>controller.current?.cancel()}
  onBatch={()=>{const binding=controller.current?.getEditorBinding();if(binding){setEditor(null);setBatchBinding(binding);}}}
  closeGuard={editorCloseGuard}
 />;
 return <>{children({
  ...snapshot,
  viewPreferenceScope:verifiedBinding?JSON.stringify([verifiedBinding.ownerId,verifiedBinding.spaceId]):null,
  onRefresh:refresh,
  onLogin:login,
  onLogout:()=>{if(beforeNavigate())void controller.current?.logout();},
  onCreateTask:()=>open({mode:'create'}),
  onOpenTask:(task,trigger)=>open({mode:'edit',task},trigger),
  onBeforeNavigate:beforeNavigate,
  onBeforeSettingsChange:()=>{
   const current=controller.current?.getSnapshot();
   if(current?.saving||current?.uncertain)return false;
   cellDrafts.captureCurrent();
   return true;
  },
  onSaveTask:save,getTaskFields,taskCellDraftMemory:cellDrafts,onRetryTaskMutation:retry,
  onUndoTaskStatus:()=>{if(beforeNavigate())void controller.current?.undoTaskStatus();},
  onSetTaskStatus:(task,status)=>{
   const current=controller.current?.getSnapshot();
   if(commandStorage.current&&current?.access.writable&&beforeNavigate())void controller.current?.setTaskStatus(task,status);
  },
 })}
 {editorContent}
 {batchBinding&&<TaskBatchEditor key={JSON.stringify(batchBinding)} binding={batchBinding}
  concealed={!verifiedBinding||!sameBinding(batchBinding,verifiedBinding)}
  writable={snapshot.access.writable===true} saving={snapshot.saving} error={snapshot.mutationError}
  onSave={async command=>commandStorage.current?await controller.current?.saveBatchTask(command)??null:null}
  onClose={()=>{setBatchBinding(null);queueMicrotask(()=>returnFocus.current?.isConnected&&returnFocus.current.focus());}}
  canSubmit={commands=>{const host=controller.current;return !!host&&(host.matchesPendingBatchCommand(null)||commands.some(command=>host.matchesPendingBatchCommand(command)));}}
  isUncertain={()=>{const current=controller.current?.getSnapshot();return current?.uncertain===true||current?.state.status!=='ready';}}
  onStop={()=>controller.current?.cancel()} closeGuard={batchCloseGuard}/>}

 {batchBinding&&!verifiedBinding&&<section role="alert" className={editorStyles.recovery}><p>当前身份尚未核实，批次内容已隐藏，原请求已保留。</p><button onClick={login}>前往登录</button><button onClick={refresh}>重新验证本人身份</button></section>}
 {!batchBinding&&(!editor||concealed)&&snapshot.uncertain&&<section role="alert" className={editorStyles.recovery}><p>保存结果尚未确认，原请求已保留。</p><button onClick={async()=>{if(await retry())close();}} disabled={snapshot.saving}>重试同一请求</button></section>}
 {!batchBinding&&(!editor||concealed)&&snapshot.saving&&<button onClick={()=>controller.current?.cancel()}>停止等待并保留请求</button>}</>;
}
