'use client';
import Link from 'next/link';
import {useCallback,useEffect,useRef,useState,type MouseEvent,type ReactNode} from 'react';
import {Button} from '../ui-review/ui/button';
import {readJournalHistory,readJournalOriginal,type JournalOriginal} from './history';
import {JournalCoveragePanel} from './coverage-panel';
import {useOwnerPageVerification} from '../personal-candidate/privacy';
import {activityDate} from '../personal-daily/activity-review/activity.mjs';
import type {JournalPeriod} from './journal-period';
import s from './history.module.css';

export function JournalHistoryPanel({onBeforeOpen,children}:{onBeforeOpen?:()=>boolean;children?:ReactNode}){
 const verified=useOwnerPageVerification(),hasPrivacyBoundary=verified!==null;
 const [snapshot,setSnapshot]=useState<Awaited<ReturnType<typeof readJournalHistory>>|null>(null),[detail,setDetail]=useState<JournalOriginal|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState('');
 const [period,setPeriod]=useState<JournalPeriod|null>(null);
 const [moreToday,setMoreToday]=useState(false);
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
 const hide=useCallback(()=>{generation.current++;setSnapshot(null);setDetail(null);setError('');setBusy(false);},[]);
 useEffect(()=>{
  const visibility=()=>{if(document.visibilityState==='hidden')hide();else if(!hasPrivacyBoundary)void load();};
  document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',hide);
  return()=>{hide();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',hide);};
 },[load,hide,hasPrivacyBoundary]);
 useEffect(()=>{if(verified===false)hide();else void load();},[verified,hide,load]);
 async function open(event:MouseEvent<HTMLAnchorElement>,id:string){
  if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||event.button!==0)return;
  event.preventDefault();if(busy||!snapshot||guard.current?.()===false)return;
  const token=++generation.current;setBusy(true);setError('');setDetail(null);
  try{const reference=snapshot.history.rows.find(row=>row.id===id);if(!reference)throw Error('日记已不在当前快照中，请重新读取历史。');const original=await readJournalOriginal(fetch,id,snapshot.binding,reference);if(token===generation.current)setDetail(original);}
  catch(reason){if(token===generation.current){setSnapshot(null);setError(reason instanceof Error?reason.message:'原文暂时无法读取，请重试。');}}
  finally{if(token===generation.current)setBusy(false);}
 }
 const history=snapshot?.history;
 const today=history?.rows.filter(row=>row.occurredOn===history.today)??[];
 const activityDay=activityDate(detail?.current.occurredOn);
 const todayList=(rows:typeof today)=><ul className={s.titles}>{rows.map(row=>
  <li key={row.id}><a href={row.href} onClick={event=>void open(event,row.id)}>{row.title}</a></li>
 )}</ul>;
 return <>
  <section className={s.panel} aria-labelledby="records-journal">
   <div className={s.heading}>
    <div><h2 id="records-journal">日记</h2>{history&&<p className={s.meta}>北京时间 {history.today}</p>}</div>
    <Button variant="outline" disabled={busy} onClick={()=>void load()}>重新读取历史</Button>
   </div>
   {busy&&<p role="status">正在核对日记与服务器日期…</p>}
   {error&&<p role="alert" className={s.error}>{error}</p>}
   {history&&(today.length>0
    ? <section aria-label="今天的日记">{todayList(today.slice(0,3))}
      {today.length>3&&<details className={s.disclosure} open={moreToday} onToggle={event=>setMoreToday(event.currentTarget.open)}><summary>其余 {today.length-3} 条当天日记</summary>{moreToday&&todayList(today.slice(3))}</details>}
     </section>
    : <p className={s.meta}>当前库内没有当天日记。</p>)}
   {detail&&<article className={s.original} aria-label="日记原文">
    <h3 ref={originalHeading} tabIndex={-1}>日记原文</h3>
    <p><strong>{detail.current.title}</strong> · {detail.current.occurredOn??'记录日期未知'} · 当前版本 {detail.entry.revision}</p>
    {activityDay&&<Link href={'/personal/activity?date='+activityDay} prefetch={false} onNavigate={event=>{if(guard.current?.()===false)event.preventDefault();}}>查看当天活动</Link>}
    <p className={s.body}>{detail.current.text}</p>
    {detail.original.text!==detail.current.text&&<details><summary>最初保存的原文</summary><p className={s.body}>{detail.original.text}</p></details>}
    <details><summary>来源与已读取版本</summary><p className={s.identifier}>记录 ID：{detail.entry.id}<br/>来源 ID：{detail.entry.source.id}</p><p>已读取 {detail.history.length} 个版本。{detail.historyTruncated?'版本历史有读取上限，不代表完整历史。':'本次版本历史未截断。'}</p></details>
   </article>}
   {children}
   <details className={s.disclosure}><summary>历史上的今天</summary><section aria-label="历史上的今天">
    {history&&(history.matches.length
     ? <ul className={s.matches}>{history.matches.map(row=><li key={row.id}><span className={s.date}>{row.occurredOn}</span><a href={row.href} onClick={event=>void open(event,row.id)}>{row.title}</a></li>)}</ul>
     : <p>当前记录库没有过去年份同月同日的日记。</p>)}
   </section></details>
  </section>
  <section className={s.panel} aria-labelledby="records-periods">
   <div className={s.heading}><h2 id="records-periods">周期回顾</h2><div className={s.actions}>
    <Button type="button" variant="outline" aria-pressed={period==='week'} disabled={!history} onClick={()=>setPeriod(period==='week'?null:'week')}>周记</Button>
    <Button type="button" variant="outline" aria-pressed={period==='year'} disabled={!history} onClick={()=>setPeriod(period==='year'?null:'year')}>年记</Button>
    <Button type="button" variant="outline" aria-pressed={period==='month'} disabled={!history} onClick={()=>setPeriod(period==='month'?null:'month')}>日记日历</Button>
   </div></div>
   {period&&history&&<JournalCoveragePanel period={period} onPeriodChange={setPeriod} history={history} onOpen={(event,id)=>void open(event,id)}/>}
  </section>
 </>;
}
