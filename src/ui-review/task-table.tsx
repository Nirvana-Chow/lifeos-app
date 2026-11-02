"use client";
import { useEffect, useRef, useState } from "react";
import type {ListTable} from "@visactor/vtable";
import type {IEditor} from "@visactor/vtable-editors";
import type { TaskRow } from "./contract";
import type {PersonalEditorFields} from "../personal-candidate/editor";
import type{TaskCellDraft,TaskCellDraftMemory}from"../personal-candidate/task-cell-draft";
import type {PublicEntry} from "../platform/contracts";
import {receiptEditor,taskStatusLabels,type ReceiptEditor} from "../personal-candidate/task-editor-state";
import { Button } from "./ui/button";
import { resources } from "../component-review/resources";
export const statusLabels = taskStatusLabels;
type Props={draftMemory?:TaskCellDraftMemory;tasks:readonly TaskRow[];onOpen:(task:TaskRow,trigger?:HTMLButtonElement)=>void;writable?:boolean;blocked?:boolean;onSave?:(task:Pick<TaskRow,"id"|"revision">,fields:PersonalEditorFields)=>Promise<PublicEntry|null>;getTaskFields?:(task:Pick<TaskRow,"id"|"revision">)=>PersonalEditorFields|null};
const records=(tasks:readonly TaskRow[])=>tasks.map(task=>({_id:task.id,title:task.title,status:task.status,due:task.dueOn??"",project:task.project?.title??"—",area:task.area?.title??"—",detail:"编辑 / 查看"}));
function theme(element:HTMLElement){
 const css=getComputedStyle(element),token=(key:string,fallback:string)=>css.getPropertyValue(key).trim()||fallback;
 const background=token('--background','#fff'),foreground=token('--foreground','#171717'),border=token('--border','#e5e5e5'),muted=token('--muted','#f5f5f5'),secondary=token('--muted-foreground','#666');
 return{underlayBackgroundColor:background,defaultStyle:{fontFamily:'system-ui, sans-serif',fontSize:16,color:foreground,bgColor:background,borderColor:border,padding:[12,16]},headerStyle:{fontSize:16,fontWeight:600,bgColor:muted,color:secondary,hover:{cellBgColor:muted}},bodyStyle:{fontSize:16,color:foreground,bgColor:background,hover:{cellBgColor:muted}},frameStyle:{borderColor:border,borderLineWidth:0},selectionStyle:{cellBgColor:muted,cellBorderColor:foreground,cellBorderLineWidth:1},columnResize:{lineColor:secondary,bgColor:muted,lineWidth:1}};
}
export function TaskTable(props:Props){
 const {tasks,onOpen}=props,host=useRef<HTMLDivElement>(null),latest=useRef(props),tableRef=useRef<ListTable|null>(null),synchronize=useRef<(()=>void)|null>(null);latest.current=props;
 const [error,setError]=useState(false),[ready,setReady]=useState(false),[editError,setEditError]=useState<string|null>(null);
 useEffect(()=>{
  let stopped=false,editing=false,activeEditor:ReceiptEditor|null=null,restoring:TaskCellDraft|null=null;const scope=resources();setError(false);setReady(false);
  void Promise.all([import('@visactor/vtable'),import('@visactor/vtable-editors')]).then(([{ListTable},{InputEditor,DateInputEditor,ListEditor}])=>{
   if(stopped||!host.current)return;
   let table:ListTable;
   const allowed=()=>!stopped&&!!latest.current.writable&&!latest.current.blocked&&!!latest.current.onSave&&!!latest.current.getTaskFields;
   const editor=(field:'title'|'status'|'due',native:IEditor):IEditor=>{
    let writeDraft:((draft:TaskCellDraft|null)=>void)|null=null;
    const wrapped=receiptEditor(native,{field,capture:context=>{
     if(!allowed())return null;
     const record=table.getRecordByCell(context.col,context.row) as {_id?:string}|undefined,task=latest.current.tasks.find(t=>t.id===record?._id),fields=task&&latest.current.getTaskFields?.(task);
     if(!task||!fields)return null;const retained=restoring;restoring=null;const target=retained?{task:retained.task,fields:retained.fields}:{task:{id:task.id,revision:task.revision},fields};
     const memory=latest.current.draftMemory;writeDraft=memory?.claim(target.task,field,()=>window.confirm('当前表格修改尚未保存，放弃这些修改并编辑另一单元格？'))??null;if(memory&&!writeDraft)return null;
     editing=true;activeEditor=wrapped;setEditError(null);return target;
    },onDraft:draft=>writeDraft?.(draft),canSave:allowed,save:(task,fields)=>latest.current.onSave?.(task,fields)??Promise.resolve(null),active:()=>!stopped&&tableRef.current===table,cancel:()=>table.cancelEditCell(),style:input=>{
     if(!input||!host.current)return;const css=getComputedStyle(host.current);
     Object.assign(input.style,{font:'16px system-ui, sans-serif',color:css.getPropertyValue('--foreground').trim()||'#171717',backgroundColor:css.getPropertyValue('--background').trim()||'#fff',borderColor:css.getPropertyValue('--border').trim()||'#bbb'});
    },onError:message=>{if(!stopped)setEditError(message);}});
    return{...wrapped,onEnd:()=>{editing=false;wrapped.onEnd();activeEditor=null;}};
   };
   const title=editor('title',new InputEditor()),status=editor('status',new ListEditor({values:Object.values(statusLabels)})),due=editor('due',new DateInputEditor());
   table=new ListTable(host.current,{
    records:records(latest.current.tasks),columns:[
     {field:'title',title:'待办',width:320,sort:true,editor:()=>allowed()?title:''},
     {field:'status',title:'状态',width:110,sort:true,fieldFormat:record=>statusLabels[record.status as keyof typeof statusLabels],editor:()=>allowed()?status:''},
     {field:'due',title:'到期日',width:130,sort:true,fieldFormat:record=>record.due||'—',editor:()=>allowed()?due:''},
     {field:'project',title:'项目',width:180,sort:true},{field:'area',title:'领域',width:160,sort:true},{field:'detail',title:'详情',width:130}
    ],editCellTrigger:'doubleclick',keyboardOptions:{pasteValueToCell:false},widthMode:'standard',heightMode:'standard',defaultRowHeight:52,defaultHeaderRowHeight:44,theme:theme(host.current)
   });
   tableRef.current=table;scope.add(()=>{table.cancelEditCell();tableRef.current=null;table.release();});
   const sync=()=>{if(stopped)return;activeEditor?.setDisabled(!allowed());if(editing||!allowed())return;const draft=latest.current.draftMemory?.read();if(!draft)return;const col=draft.field==='title'?0:draft.field==='status'?1:2;for(let row=1;row<table.rowCount;row++){const record=table.getRecordByCell(col,row) as {_id?:string}|undefined;if(record?._id===draft.task.id){restoring=draft;table.startEditCell(col,row,draft.value);restoring=null;break;}}};
   synchronize.current=sync;scope.add(()=>{synchronize.current=null;});
   const memory=latest.current.draftMemory;if(memory){scope.add(memory.registerCapture(()=>activeEditor?.captureDraft()));scope.add(memory.onConfirmed(()=>{activeEditor?.discard();table.cancelEditCell();}));}

   const openCell=(col:number,row:number)=>{if(row<1||col<3||editing||latest.current.blocked)return;const record=table.getRecordByCell(col,row) as {_id?:string}|undefined,task=latest.current.tasks.find(t=>t.id===record?._id);if(task)latest.current.onOpen(task);};
   table.on('click_cell',event=>openCell(event.col,event.row));
   table.on('keydown',({keyCode,event})=>{if(keyCode!==13||editing||latest.current.blocked)return;const cell=table.getSelectedCellInfos()?.[0]?.[0];if(!cell||cell.row<1)return;event.preventDefault();if(cell.col<3){if(allowed())table.startEditCell(cell.col,cell.row);}else openCell(cell.col,cell.row);});
   const resize=new ResizeObserver(()=>table.resize());resize.observe(host.current);scope.add(()=>resize.disconnect());
   const update=()=>{if(!stopped&&host.current)table.updateTheme(theme(host.current));};const observer=new MutationObserver(update);
   observer.observe(document.documentElement,{attributes:true,attributeFilter:['class','style','data-theme','data-lifeos-theme']});observer.observe(document.body,{attributes:true,attributeFilter:['class','style','data-theme','data-lifeos-theme']});const shell=host.current.closest('.lo-shell');if(shell)observer.observe(shell,{attributes:true,attributeFilter:['class','style','data-theme','data-lifeos-theme']});scope.add(()=>observer.disconnect());
   const media=window.matchMedia('(prefers-color-scheme: dark)');media.addEventListener('change',update);scope.add(()=>media.removeEventListener('change',update));setReady(true);sync();
  }).catch(()=>{scope.release();if(!stopped)setError(true);});
  return()=>{stopped=true;scope.release();};
 },[]);
 useEffect(()=>{tableRef.current?.setRecords(records(tasks));synchronize.current?.();},[tasks]);
 useEffect(()=>{synchronize.current?.();},[props.writable,props.blocked]);
  return (
    <div className="lo-table-wrap">
      <div
        ref={host}
        className="lo-vtable"
        aria-label="待办表格"
        aria-busy={!ready && !error}
      />
      {!ready && !error && (
        <div className="lo-table-loading" role="status">
          正在加载表格…
        </div>
      )}
      {editError && <p role="alert">{editError}</p>}
      {error && (
        <div role="alert" className="lo-table-loading">
          表格加载失败，请切换列表查看。
        </div>
      )}
      <table className="lo-screen-reader-table">
        <caption>待办表格的文本内容</caption>
        <thead>
          <tr>
            {["待办", "状态", "到期日", "项目", "领域"].map((label) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id}>
              <td>
                <Button
                  variant="ghost"
                  aria-label={`打开任务：${task.title}`}
                  disabled={props.blocked}
                  onClick={(event) => onOpen(task, event.currentTarget)}
                >
                  {task.title}
                </Button>
              </td>
              <td>{statusLabels[task.status]}</td>
              <td>{task.dueOn ?? "未设置"}</td>
              <td>{task.project?.title ?? "未关联"}</td>
              <td>{task.area?.title ?? "未关联"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
