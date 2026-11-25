'use client';
import Link from 'next/link';
import {useCallback,useEffect,useRef,useState,type MouseEvent,type ReactNode} from 'react';
import {Button} from '../ui-review/ui/button';
import {readJournalHistory,readJournalOriginal,type JournalOriginal} from './history';
import {JournalCoveragePanel} from './coverage-panel';
import {useOwnerPageVerification} from '../personal-candidate/privacy';
import {activityDate} from '../personal-daily/activity-review/activity.mjs';
import type {JournalPeriod} from './journal-period';
import {personRecordHref,personRecordId,readLinkedPerson} from '../personal-people/journal-links';
import s from './history.module.css';

export function JournalHistoryPanel({onBeforeOpen,renderEditor,activityLink}:{onBeforeOpen?:()=>boolean;renderEditor?:(onSaved:()=>void,journalDay?:string)=>ReactNode;activityLink?:ReactNode}){
 const verified=useOwnerPageVerification(),hasPrivacyBoundary=verified!==null;
 const [snapshot,setSnapshot]=useState<Awaited<ReturnType<typeof readJournalHistory>>|null>(null),[detail,setDetail]=useState<JournalOriginal|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState('');
 const [period,setPeriod]=useState<JournalPeriod|null>(null);
 const [moreToday,setMoreToday]=useState(false);
 const [returnPerson,setReturnPerson]=useState<{detail:JournalOriginal;id:string}|null>(null);
 const generation=useRef(0),guard=useRef(onBeforeOpen),originalHeading=useRef<HTMLHeadingElement>(null);guard.current=onBeforeOpen;
 useEffect(()=>{if(detail)originalHeading.current?.focus();},[detail]);
 useEffect(()=>{
  const personal=detail?.current.personal;
  if(!detail||!snapshot||personal?.type!=='journal')return;
  const id=personRecordId(new URLSearchParams(window.location.search).get('person'));
  const pin=personal.links.people.find(link=>link.id===id);
  if(!pin)return;
  let active=true;
  void readLinkedPerson(pin,snapshot.binding).then(verified=>{
   if(active&&verified)setReturnPerson({detail,id:pin.id});
  });
  return()=>{active=false;};
 },[detail,snapshot]);
 const load=useCallback(async()=>{
  const token=++generation.current;setBusy(true);setError('');setSnapshot(null);setDetail(null);
  try{
   const result=await readJournalHistory();
   const id=new URLSearchParams(window.location.search).get('record');
   const reference=id?result.history.rows.find(row=>row.id===id):null;
   if(id&&!reference){
    if(token!==generation.current)return;
    setSnapshot(result);
    setError('日记已不在当前快照中，可从下方选择其他记录。');
    return;
   }
   const original=id?await readJournalOriginal(fetch,id,result.binding,reference!):null;
   if(token!==generation.current)return;setSnapshot(result);setDetail(original);
  }catch(reason){if(token===generation.current)setError(reason instanceof Error?reason.message:'日记暂时无法读取，请重试。');}
  finally{if(token===generation.current)setBusy(false);}
 },[]);
 const hide=useCallback(()=>{generation.current++;setSnapshot(null);setDetail(null);setReturnPerson(null);setError('');setBusy(false);},[]);
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
 const history=snapshot?.sources.diary,memos=snapshot?.sources.memos;
 const today=history?.rows.filter(row=>row.occurredOn===history.today)??[];
 const recentMemos=memos?.rows.filter(row=>row.occurredOn===null||row.occurredOn<=memos.today)
  .toSorted((a,b)=>(b.occurredOn??'').localeCompare(a.occurredOn??''))??[];
 const activityDay=activityDate(detail?.current.occurredOn);
 const todayList=(rows:typeof today)=><ul className={s.titles}>{rows.map(row=>
  <li key={row.id}><a href={row.href} onClick={event=>void open(event,row.id)}>{row.title}</a></li>
 )}</ul>;
 const datedList=(rows:typeof today)=><ul className={s.matches}>{rows.map(row=><li key={row.id}>
  <span className={s.date}>{row.occurredOn??'日期未知'}</span><a href={row.href} onClick={event=>void open(event,row.id)}>{row.title}</a>
 </li>)}</ul>;
 const memoDetail=!!detail&&!!memos?.rows.some(row=>row.id===detail.entry.id);
 const detailLabel=memoDetail?'随手记原文':snapshot?.sources.unclassified.some(row=>row.id===detail?.entry.id)?'记录原文':'日记原文';
 const original=detail&&<article className={s.original} aria-label={detailLabel}>
  <h3 ref={originalHeading} tabIndex={-1}>{detailLabel}</h3>
  <p><strong>{detail.current.title}</strong> · {detail.current.occurredOn??'记录日期未知'} · 当前版本 {detail.entry.revision}</p>
  {memoDetail&&<p className={s.meta}>来源：LifeOS 本人记录 · 已核对关联主题</p>}
  {activityDay&&<Link href={'/personal/activity?date='+activityDay} prefetch={false} onNavigate={event=>{if(guard.current?.()===false)event.preventDefault();}}>查看当天活动</Link>}
  {returnPerson?.detail===detail&&<Link href={personRecordHref(returnPerson.id)} prefetch={false} onNavigate={event=>{if(guard.current?.()===false)event.preventDefault();}}>返回关联人物</Link>}
  <p className={s.body}>{detail.current.text}</p>
  {detail.original.text!==detail.current.text&&<details><summary>最初保存的原文</summary><p className={s.body}>{detail.original.text}</p></details>}
  <details><summary>来源与已读取版本</summary><p className={s.identifier}>记录 ID：{detail.entry.id}<br/>来源 ID：{detail.entry.source.id}</p><p>已读取 {detail.history.length} 个版本。{detail.historyTruncated?'版本历史有读取上限，不代表完整历史。':'本次版本历史未截断。'}</p></details>
 </article>;
 return <>
  <section className={s.panel} aria-labelledby="records-memos">
   <div className={s.heading}><h2 id="records-memos">Memos</h2>{activityLink}</div>
   {recentMemos.length>0?datedList(recentMemos.slice(0,3)):<p className={s.meta} role="status">{busy?'正在读取随手记…':!memos?'随手记暂时无法核对。':snapshot?.sources.unclassified.length?'部分记录分类待核对。':'当前库内暂无已核对的随手记或思考。'}</p>}
   {recentMemos.length>3&&<details className={s.disclosure}><summary>更多随手记</summary>{datedList(recentMemos.slice(3))}</details>}
   {memoDetail&&original}
  </section>
  <section className={s.panel} aria-labelledby="records-journal">
   <div className={s.heading}>
    <div><h2 id="records-journal">日记</h2>{history&&<p className={s.meta}>北京时间 {history.today}</p>}</div>
    <Button variant="outline" disabled={busy} onClick={()=>void load()}>重新读取历史</Button>
   </div>
   {busy&&<p role="status">正在核对日记与服务器日期…</p>}
   {error&&<p role="alert" className={s.error}>{error}</p>}
   {renderEditor?.(()=>void load(),history?.today)}
   {history&&(today.length>0
    ? <section aria-label="今天的日记">{todayList(today.slice(0,3))}
      {today.length>3&&<details className={s.disclosure} open={moreToday} onToggle={event=>setMoreToday(event.currentTarget.open)}><summary>其余 {today.length-3} 条当天日记</summary>{moreToday&&todayList(today.slice(3))}</details>}
     </section>
    : <p className={s.meta}>当前库内没有当天日记。</p>)}
   {!memoDetail&&original}
   <details className={s.disclosure}><summary>历史上的今天</summary><section aria-label="历史上的今天">
    {!!memos?.matches.length&&<><h3>Memos</h3>{datedList(memos.matches)}</>}
    {history&&(history.matches.length
     ? <><h3>日记</h3>{datedList(history.matches)}</>
     : <p>当前记录库没有过去年份同月同日的日记。</p>)}
   </section></details>
  </section>
  <section className={s.panel} aria-labelledby="records-periods">
   <div className={s.heading}><h2 id="records-periods">周期回顾</h2><div className={s.actions} role="group" aria-label="时间维度">
    {(['day','week','month','quarter','year'] as const).map((grain,index)=><Button key={grain} type="button" variant="outline"
     aria-pressed={period===grain} disabled={!history} onClick={()=>setPeriod(period===grain?null:grain)}>{['日','周','月','季度','年'][index]}</Button>)}
   </div></div>
   {period&&history&&memos&&<JournalCoveragePanel period={period} onPeriodChange={setPeriod} history={history} memos={memos} onOpen={(event,id)=>void open(event,id)}/>}
   {!!snapshot?.sources.unclassified.length&&<details className={s.disclosure}><summary>分类待核对（{snapshot.sources.unclassified.length}）</summary>{datedList(snapshot.sources.unclassified)}</details>}
  </section>
 </>;
}
