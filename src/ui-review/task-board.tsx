'use client';

import {useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {GripVertical} from 'lucide-react';
import type {TaskRow,TaskStatus,LifeOSWorkspaceProps} from './contract';
import {taskStatusLabels} from '../personal-candidate/task-editor-state';
import {Kanban,KanbanBoard,KanbanColumn,KanbanColumnHandle,KanbanColumnContent,KanbanItem,KanbanItemHandle,type KanbanCommitMeta} from './reui/kanban';
import {Button} from './ui/button';
import styles from './task-board.module.css';

const statuses:TaskStatus[]=['open','in_progress','done','cancelled'];
type Arrangement={columns:TaskStatus[];cards:Record<string,string[]>};
const defaults=():Arrangement=>({columns:[...statuses],cards:{}});
function readArrangement(scope:string|null):Arrangement{
 if(!scope)return defaults();
 try{const value=JSON.parse(window.localStorage.getItem('lifeos.task-board.v1:'+scope)??'null');
  if(!value||!Array.isArray(value.columns)||value.columns.length!==4||new Set(value.columns).size!==4||!value.columns.every((v:TaskStatus)=>statuses.includes(v)))return defaults();
  const cards:Record<string,string[]>={};for(const status of statuses)if(Array.isArray(value.cards?.[status]))cards[status]=value.cards[status].filter((v:unknown)=>typeof v==='string').slice(0,10000);
  return {columns:value.columns,cards};
 }catch{return defaults();}
}
function groupTasks(tasks:readonly TaskRow[],arrangement:Arrangement):Record<string,TaskRow[]>{
 return Object.fromEntries(arrangement.columns.map(status=>{const ranks=new Map((arrangement.cards[status]??[]).map((id,index)=>[id,index]));return [status,tasks.filter(task=>task.status===status).toSorted((a,b)=>(ranks.get(a.id)??Infinity)-(ranks.get(b.id)??Infinity))];}));
}
/** Native ReUI manages drag preview only. The host remains the sole authoritative status writer. */
export function TaskBoard({tasks,writable,blocked,pendingTaskIds=[],scope=null,onSetTaskStatus,renderCard}:{
 tasks:readonly TaskRow[];writable:boolean;blocked:boolean;pendingTaskIds?:readonly string[];scope?:string|null;
 onSetTaskStatus?:LifeOSWorkspaceProps['onSetTaskStatus'];renderCard:(task:TaskRow)=>ReactNode;
}){
 const [arrangementState,setArrangementState]=useState<{scope:string|null;value:Arrangement}>({scope:null,value:defaults()});
 const arrangement=arrangementState.scope===scope?arrangementState.value:defaults();
 const authoritative=useMemo(()=>groupTasks(tasks,arrangement),[tasks,arrangement]);
 const [preview,setPreview]=useState<{scope:string|null;columns:Record<string,TaskRow[]>}|null>(null),[notice,setNotice]=useState('');
 const dragging=useRef<{scope:string|null;task:{id:string;revision:number;status:TaskStatus}|null}|null>(null);
 const visibleColumns=preview&&preview.scope===scope?preview.columns:authoritative;
 const latest=useRef({tasks,writable,blocked,pendingTaskIds,scope,onSetTaskStatus});latest.current={tasks,writable,blocked,pendingTaskIds,scope,onSetTaskStatus};
 const finish=()=>{dragging.current=null;setPreview(null);};
 useEffect(()=>{setArrangementState({scope,value:readArrangement(scope)});finish();setNotice('');},[scope]);
 useEffect(()=>{if(blocked)finish();},[blocked]);
 function saveArrangement(value:Arrangement){setArrangementState({scope,value});if(scope)try{window.localStorage.setItem('lifeos.task-board.v1:'+scope,JSON.stringify(value));}catch{setNotice('浏览器未允许保存，排列仅用于本次视图。');}}
 function move(task:TaskRow,status:TaskStatus){
  const current=latest.current,actual=current.tasks.find(value=>value.id===task.id);
  if(!current.writable||current.blocked||!current.onSetTaskStatus||current.pendingTaskIds.includes(task.id)||!actual||actual.revision!==task.revision||actual.status===status)return;
  current.onSetTaskStatus({id:actual.id,revision:actual.revision},status);
 }
 function commit(value:Record<string,TaskRow[]>,meta:KanbanCommitMeta<TaskRow>){
  const captured=dragging.current;finish();
  if(!captured||captured.scope!==latest.current.scope||!meta.event.over||latest.current.blocked)return;
  if(meta.kind==='column'){saveArrangement({...arrangement,columns:Object.keys(value) as TaskStatus[]});return;}
  const original=captured.task,task=original&&latest.current.tasks.find(row=>row.id===original.id);
  if(!task||task.revision!==original.revision||task.status!==original.status)return;
  if(meta.overContainer===original.status){saveArrangement({...arrangement,cards:{...arrangement.cards,[original.status]:(value[original.status]??[]).map(row=>row.id)}});return;}
  if(statuses.includes(meta.overContainer as TaskStatus))move(task,meta.overContainer as TaskStatus);
 }
 return <div className="lo-native-board" data-task-board="reui">
  <p className="lo-board-view-note">排列仅用于当前浏览器，状态以保存回执为准。{notice&&<span role="status">{notice}</span>}</p>
  <Kanban value={visibleColumns} onValueChange={value=>{if(dragging.current&&dragging.current.scope===latest.current.scope&&!latest.current.blocked)setPreview({scope:dragging.current.scope,columns:value});}} getItemValue={task=>task.id} restoreOnCancel
   onDragStart={event=>{const task=latest.current.tasks.find(row=>row.id===event.active.id);dragging.current={scope,task:task?{id:task.id,revision:task.revision,status:task.status}:null};}}
   onValueCommit={commit} onDragCancel={finish} onDragEnd={()=>{queueMicrotask(finish);}}
   accessibility={{screenReaderInstructions:{draggable:'空格开始拖动，方向键移动，空格放下，Escape 取消。也可以使用移动到菜单。'}}}>
   <KanbanBoard className="lo-board">{Object.entries(visibleColumns).map(([status,items])=><KanbanColumn key={status} value={status} className="lo-board-column" disabled={blocked} data-kanban-status={status}>
    <h2><KanbanColumnHandle asChild><button type="button" className="lo-column-drag" aria-label={`排列${taskStatusLabels[status as TaskStatus]}栏目`} disabled={blocked}><GripVertical size={16} aria-hidden="true"/>{taskStatusLabels[status as TaskStatus]}</button></KanbanColumnHandle><span>{items.length}</span></h2>
    <KanbanColumnContent value={status} className="lo-board-cards">{items.map(task=><KanbanItem key={task.id} value={task.id} className="lo-kanban-card" data-kanban-task={task.id} disabled={blocked||!writable||pendingTaskIds.includes(task.id)}>
     <div className="lo-board-card-tools"><KanbanItemHandle asChild><Button variant="ghost" className="lo-card-drag" aria-label={`拖动：${task.title}`} disabled={blocked||!writable||pendingTaskIds.includes(task.id)}><GripVertical size={16} aria-hidden="true"/></Button></KanbanItemHandle><label className="lo-board-move">移动到<select aria-label="移动到" value={task.status} disabled={blocked||!writable||!onSetTaskStatus||pendingTaskIds.includes(task.id)} onChange={event=>move(task,event.target.value as TaskStatus)}>{statuses.map(status=><option key={status} value={status}>{taskStatusLabels[status]}</option>)}</select></label></div>
     {renderCard(task)}
     <dl className={styles.classification} aria-label="待办分类">
      <div><dt>项目</dt><dd data-unassociated={!task.project||undefined}>{task.project?.title??'未关联项目'}</dd></div>
      <div><dt>领域</dt><dd data-unassociated={!task.area||undefined}>{task.area?.title??'未关联领域'}</dd></div>
     </dl>
    </KanbanItem>)}{!items.length&&<div className="lo-board-empty">暂无待办</div>}</KanbanColumnContent>
   </KanbanColumn>)}</KanbanBoard>
  </Kanban>
 </div>;
}
