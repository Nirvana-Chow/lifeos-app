'use client';
import {useCallback,useEffect,useRef,useState,type MouseEvent} from 'react';
import {Button} from '../ui-review/ui/button';
import {readJournalHistory,readJournalOriginal,type JournalOriginal} from './history';
import {JournalCoveragePanel} from './coverage-panel';
import s from './history.module.css';

export function JournalHistoryPanel({onBeforeOpen}:{onBeforeOpen?:()=>boolean}){
 const [snapshot,setSnapshot]=useState<Awaited<ReturnType<typeof readJournalHistory>>|null>(null),[detail,setDetail]=useState<JournalOriginal|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState('');
 const generation=useRef(0),guard=useRef(onBeforeOpen),originalHeading=useRef<HTMLHeadingElement>(null);guard.current=onBeforeOpen;
 useEffect(()=>{if(detail)originalHeading.current?.focus();},[detail]);
 const load=useCallback(async()=>{
  const token=++generation.current;setBusy(true);setError('');setSnapshot(null);setDetail(null);
  try{
   const result=await readJournalHistory();
   const id=new URLSearchParams(window.location.search).get('record');
   const reference=id?result.history.rows.find(row=>row.id===id):null;
   if(id&&!reference)throw Error('日记已不在当前快照中，请重新读取历史。');
   const original=id?await readJournalOriginal(fetch,id,result.binding,reference!):null;
   if(token!==generation.current)return;setSnapshot(result);setDetail(original);
  }catch(reason){if(token===generation.current)setError(reason instanceof Error?reason.message:'日记暂时无法读取，请重试。');}
  finally{if(token===generation.current)setBusy(false);}
 },[]);
 useEffect(()=>{
  void load();
  const hide=()=>{generation.current++;setSnapshot(null);setDetail(null);setError('');setBusy(false);};
  const visibility=()=>{if(document.visibilityState==='hidden')hide();else void load();};
  document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',hide);
  return()=>{hide();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',hide);};
 },[load]);
 async function open(event:MouseEvent<HTMLAnchorElement>,id:string){
  if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||event.button!==0)return;
  event.preventDefault();if(busy||!snapshot||guard.current?.()===false)return;
  const token=++generation.current;setBusy(true);setError('');setDetail(null);
  try{const reference=snapshot.history.rows.find(row=>row.id===id);if(!reference)throw Error('日记已不在当前快照中，请重新读取历史。');const original=await readJournalOriginal(fetch,id,snapshot.binding,reference);if(token===generation.current)setDetail(original);}
  catch(reason){if(token===generation.current){setSnapshot(null);setError(reason instanceof Error?reason.message:'原文暂时无法读取，请重试。');}}
  finally{if(token===generation.current)setBusy(false);}
 }
 const history=snapshot?.history,coverage=history?.coverage;
 return <>{history&&<JournalCoveragePanel history={history} onOpen={(event,id)=>void open(event,id)}/>}<section className={s.panel} aria-label="历史上的今天">
  <div className={s.heading}><div><h2>历史上的今天</h2>{history&&<p className={s.meta}>北京时间 {history.today}</p>}</div><Button variant="outline" disabled={busy} onClick={()=>void load()}>重新读取历史</Button></div>
  {busy&&<p role="status">正在核对日记与服务器日期…</p>}
  {error&&<p role="alert" className={s.error}>{error}</p>}
  {history&&coverage&&<>
   <p className={s.meta}>当前库内 {coverage.count} 条日记；{coverage.dated} 条有记录日期，{coverage.undated} 条日期未知。{coverage.from&&coverage.to&&<>已知日期范围 {coverage.from} 至 {coverage.to}。</>} 历史完整性尚未确认。</p>
   <p className={s.meta}>按记录日期匹配过去年份的同月同日；不使用创建时间补日期。</p>
   {history.matches.length?<ul className={s.matches}>{history.matches.map(row=><li key={row.id}><span className={s.date}>{row.occurredOn}</span><a href={row.href} onClick={event=>void open(event,row.id)}>{row.title}</a><span className={s.excerpt}>{row.text.replace(/\s+/g,' ').slice(0,160)}</span></li>)}</ul>:<p>当前记录库没有过去年份同月同日的日记。</p>}
   <p className={s.meta}>结果只覆盖已接入当前库的记录，不能据此推断那天没有发生事情。</p>
   {detail&&<article className={s.original} aria-label="日记原文"><h3 ref={originalHeading} tabIndex={-1}>日记原文</h3><p><strong>{detail.current.title}</strong> · {detail.current.occurredOn??'记录日期未知'} · 当前版本 {detail.entry.revision}</p><details open><summary>最初保存的原文</summary><p className={s.body}>{detail.original.text}</p></details><details open><summary>当前正文</summary><p className={s.body}>{detail.current.text}</p></details><details><summary>稳定记录标识与已读取版本</summary><p className={s.identifier}>记录 ID：{detail.entry.id}<br/>来源 ID：{detail.entry.source.id}</p><p>已读取 {detail.history.length} 个版本。{detail.historyTruncated?'版本历史有读取上限，不代表完整历史。':'本次版本历史未截断。'}</p></details></article>}
   <details className={s.method}><summary>相似日的实现状态</summary><p>相似日尚未启用 embedding 与 rerank；当前没有语义相似结果，也没有关键词分数代替的相似结果。需先确认提供方、私密日记处理范围与费用。</p></details>
  </>}
 </section></>;
}
