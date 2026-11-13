'use client';
import {useEffect,useState} from 'react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '../ui-review/ui/dialog';
import {TaskBatch,batchIssues} from './task-batch';
import type {PersonalBinding,PersonalCommand} from './client';
import type {PublicEntry} from '../platform/contracts';
import styles from './task-editor.module.css';
type Props={binding:PersonalBinding;concealed:boolean;writable:boolean;saving:boolean;error:string|null;onSave:(command:PersonalCommand)=>Promise<PublicEntry|null>;onClose:()=>void;onStop:()=>void;isUncertain:()=>boolean;canSubmit:(commands:PersonalCommand[])=>boolean;closeGuard:{current:(()=>boolean)|null}};
export function TaskBatchEditor({binding,concealed,writable,saving,error,onSave,onClose,onStop,isUncertain,canSubmit,closeGuard}:Props){
 const [model]=useState(()=>{try{return {batch:new TaskBatch(binding,window.sessionStorage,()=>crypto.randomUUID()),error:null};}catch{return {batch:null,error:'无法核对批次草稿，已停止写入。请保留当前页面。'};}});
 const batch=model.batch;
 const [raw,setRaw]=useState(batch?.raw??''),[localError,setLocalError]=useState<string|null>(model.error),[running,setRunning]=useState(false),[,render]=useState(0);
 const rows=batch?.rows??[],issues=batchIssues(rows),unknown=rows.some(r=>r.state==='unknown'),busy=running||saving;
 const foreignPending=!canSubmit(rows.flatMap(row=>row.command?[row.command]:[]));
 const close=()=>{if(busy||unknown)return false;if((raw||rows.length)&&!window.confirm('关闭并保留批次草稿？'))return false;onClose();return true;};
 useEffect(()=>{closeGuard.current=close;return()=>{closeGuard.current=null;};});
 useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(raw||rows.length||busy){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[raw,rows.length,busy]);
 if(concealed)return null;
 const act=(fn:()=>void)=>{try{fn();setLocalError(null);render(x=>x+1);}catch(e){setLocalError(e instanceof Error?e.message:'无法保存草稿。');}};
 return <div data-lifeos-surface="personal"><Dialog open onOpenChange={open=>{if(!open)close();}}><DialogContent data-lifeos-surface="personal" className={styles.editor} showCloseButton={false} onCloseAutoFocus={e=>e.preventDefault()} onEscapeKeyDown={e=>{e.preventDefault();close();}} onPointerDownOutside={e=>e.preventDefault()}>
 <header className={styles.header}><div><DialogTitle>多行录入待办</DialogTitle><DialogDescription>一行一项，先预检再确认保存。逐条调用 createTodo；这是非原子批次，前面已保存的条目不会自动撤销。每条均独立回读，不自动推断日期。</DialogDescription></div><button type="button" disabled={busy||unknown} onClick={close}>关闭</button></header>
 <form className={styles.form} onSubmit={async e=>{e.preventDefault();if(!batch||busy||foreignPending||!writable||issues.some(Boolean))return;setRunning(true);setLocalError(null);try{await batch.run(onSave,()=>render(x=>x+1),isUncertain);}catch(e){setLocalError(e instanceof Error?e.message:'批次已停止，请保留草稿。');}finally{setRunning(false);}}}>
 <div className={styles.body}>
 {!rows.length?<><label>原始输入（最多50行）<textarea autoFocus rows={8} value={raw} disabled={!batch||busy||!writable} onChange={e=>{setRaw(e.target.value);act(()=>batch!.draft(e.target.value));}}/></label><button type="button" disabled={!batch||busy||!writable||!raw} onClick={()=>act(()=>batch!.preview(raw))}>预检条目</button></>:<><p>已核对 {rows.filter(r=>r.state==='verified').length} / {rows.filter(r=>r.selected).length} 项。失败或结果未确认时停止后续保存。</p><ol>{rows.map((row,i)=><li key={i}><label className={styles.topic}><input type="checkbox" aria-label={`保存第${i+1}项`} checked={row.selected} disabled={busy||!!row.command||!writable} onChange={e=>act(()=>batch!.edit(i,row.title,e.target.checked))}/>第{i+1}项 · {row.state==='verified'?'已保存并回读':row.state==='unknown'?'结果未确认':row.state==='failed'?'保存失败，后续已停止':'待保存'}</label><label>待办标题<input aria-label={`第${i+1}项标题`} value={row.title} aria-invalid={!!issues[i]} aria-describedby={issues[i]?`batch-error-${i}`:undefined} disabled={busy||!!row.command||!writable} onChange={e=>act(()=>batch!.edit(i,e.target.value,row.selected))}/></label>{issues[i]&&<p id={`batch-error-${i}`} role="alert">{issues[i]}</p>}{row.receipt&&<p>回执：{row.receipt.id} · 版本 {row.receipt.revision}</p>}</li>)}</ol><details><summary>保留的原始输入</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{batch?.raw}</pre></details></>}
 </div>
 {foreignPending&&<p role="alert">另有原请求尚未核对，当前批次未发送。<button type="button" onClick={onClose}>核对原有请求</button></p>}
 {(localError||error)&&<p role="alert">{localError||error}</p>}{unknown&&!busy&&<p role="alert">批次已停止。继续时仅重试原行请求与原 key；已核对的条目不会重发。</p>}
 <footer className={styles.footer}>{busy&&<button type="button" onClick={onStop}>停止等待并保留请求</button>}<button type="button" disabled={busy||unknown} onClick={close}>关闭并保留</button>{!!rows.length&&<><button type="button" disabled={busy||unknown||!writable} onClick={()=>act(()=>{batch!.clear();setRaw('');})}>清空批次</button><button type="submit" disabled={busy||foreignPending||!writable||!batch||issues.some(Boolean)||!rows.some(r=>r.selected&&r.state!=='verified')}>{busy?'正在逐条保存…':unknown?'核对原请求并继续':'确认顺序保存'}</button></>}</footer>
 </form></DialogContent></Dialog></div>;
}
