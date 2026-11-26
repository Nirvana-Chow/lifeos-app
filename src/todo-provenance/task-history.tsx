'use client';
import {useEffect,useState} from 'react';
import type {PublicEntry} from '../platform/contracts';
import {editorFromEntry} from '../personal-candidate/editor';
import {captureLabels} from './domain';

export function TaskSourceHistory({entry,spaceId}:{entry:PublicEntry;spaceId:string}){
 const [history,setHistory]=useState<PublicEntry[]|null>(null),[error,setError]=useState(false);
 const [open,setOpen]=useState(false);
 const {id,source,revision}=entry;
 useEffect(()=>{
  if(!open)return;
  const controller=new AbortController();
  setHistory(null);setError(false);
  void (async()=>{
   try{
    const response=await fetch('/api/platform/personal/todo/'+encodeURIComponent(id)+'/history',{
     cache:'no-store',credentials:'same-origin',signal:controller.signal,
    });
    if(!response.ok)throw Error();
    const body=await response.json();
    if(!Array.isArray(body.items)||!body.items.length)throw Error();
    const items=body.items as PublicEntry[];
    if(items[0].revision!==revision||items.some((row,index)=>row.id!==id||row.source.id!==source.id||
       row.source.version!==source.version||row.revision!==revision-index||
       JSON.stringify(row.source.original)!==JSON.stringify(source.original)||editorFromEntry(row,spaceId).type!=='todo'))throw Error();
    if(!controller.signal.aborted)setHistory(items);
   }catch{if(!controller.signal.aborted)setError(true);}
  })();
  return()=>controller.abort();
 },[open,id,revision,source,spaceId]);
 const labels=captureLabels(source.original);
 return <details onToggle={event=>setOpen(event.currentTarget.open)}>
  <summary>来源与修订历史</summary>
  <dl><div><dt>输入渠道</dt><dd>{labels.channel}</dd></div>
   <div><dt>表达类型</dt><dd>{labels.expression}</dd></div>
   <div><dt>来源 ID</dt><dd>{source.id}</dd></div>
   <div><dt>当前修订</dt><dd>{revision}</dd></div></dl>
  <details><summary>最初录入内容</summary><pre>{JSON.stringify(source.original,null,2)}</pre></details>
  {error?<p role="alert">无法核对该版本历史，请重新打开待办。</p>:history?
   <ol>{history.map(row=><li key={row.revision}><details><summary>修订 {row.revision}</summary>
    {'notes' in row.draft&&<p>{row.draft.notes}</p>}</details></li>)}</ol>:
   open?<p role="status">正在读取修订历史…</p>:null}
 </details>;
}
