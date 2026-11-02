'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Card,CardHeader,CardTitle,CardContent} from '../../components/ui/card';
import s from '../workbench/styles.module.css';
import {calendarStorageAccess,calendarEntryForm,calendarDayRequest,calendarRequest,sendCalendarCommand,createCalendarDetailReader,freezeCalendarCommand,keepCalendarPending,readCalendarPending,clearCalendarPending,CalendarClientError,type CalendarCommand,type CalendarEntry,type CalendarHistory,type CalendarForm} from './client-model.ts';

type Access='unavailable'|'developer-review';
const today=()=>new Date().toISOString().slice(0,10);
function freshForm(date:string):CalendarForm{const next=new Date(date+'T00:00:00Z');next.setUTCDate(next.getUTCDate()+1);return{title:'',notes:'',kind:'all-day',startDate:date,endDate:next.toISOString().slice(0,10),startAt:'',endAt:'',timeZone:'UTC'};}
function scheduleText(entry:CalendarEntry):string{return entry.schedule.kind==='all-day'?`${entry.schedule.startDate} 至 ${entry.schedule.endDate}（结束日期不包含当天）`:`${entry.schedule.startAt} → ${entry.schedule.endAt} · ${entry.schedule.timeZone}`;}
function errorText(error:unknown):string{return error instanceof Error?error.message:'操作未完成，请保留当前输入。';}
/** ownerScope only partitions local recovery; trusted server session remains the sole authority. */
export function CalendarCandidatePage({access='unavailable',ownerScope='',storageReady=false}:{access?:Access;ownerScope?:string;storageReady?:boolean}){
 const enabled=access==='developer-review'&&!!ownerScope,writable=calendarStorageAccess(access,ownerScope,storageReady);
 const [date,setDate]=useState(today),[timeZone,setTimeZone]=useState('UTC'),[form,setForm]=useState<CalendarForm>(()=>freshForm(today()));
 const [entries,setEntries]=useState<CalendarEntry[]|null>(null),[selected,setSelected]=useState<CalendarEntry|null>(null),[history,setHistory]=useState<CalendarHistory[]|null>(null),[editing,setEditing]=useState<{id:string;revision:number}|undefined>();
 const [pending,setPending]=useState<CalendarCommand|null>(null),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[failure,setFailure]=useState<number|null>(null),[pendingConflict,setPendingConflict]=useState(false);
 const [detailReader]=useState(()=>createCalendarDetailReader(fetch));
 const scope=useRef(ownerScope),dayRequest=useRef(0),saving=useRef(false),selectedId=useRef(selected?.id);scope.current=ownerScope;selectedId.current=selected?.id;
 async function loadDay(){
  if(!writable)return;const owner=ownerScope,request=++dayRequest.current;setEntries(null);
  try{const result=await calendarDayRequest(fetch,{access,ownerScope},date,timeZone);if(scope.current!==owner||request!==dayRequest.current)return;setEntries(result);}
  catch(cause){if(scope.current===owner&&request===dayRequest.current){setError(errorText(cause));setFailure(cause instanceof CalendarClientError?cause.status:null);}}
 }
 async function loadDetail(id:string){
  if(!writable)return null;const owner=ownerScope;setHistory(null);
  const entry=await detailReader.read(id);if(scope.current!==owner||!entry)return null;
  setSelected(entry);return entry;
 }
 useEffect(()=>{
  dayRequest.current++;detailReader.invalidate();setPendingConflict(false);setReady(false);setEntries(null);setSelected(null);setHistory(null);setEditing(undefined);setPending(null);setError('');setMessage('');setFailure(null);setForm(freshForm(today()));
  if(!enabled)return;
  try{const saved=readCalendarPending(sessionStorage,ownerScope);if(saved){setPending(saved);setForm(saved.form);const match=/^\/([^/]+)/.exec(saved.path);if(match&&'expectedRevision'in saved.body)setEditing({id:match[1],revision:saved.body.expectedRevision!});setMessage('已恢复未确认请求，请使用同一请求重试。');}setReady(true);}
  catch(cause){setError('无法恢复未确认请求：'+errorText(cause));}
 },[ownerScope,enabled]);
 useEffect(()=>()=>detailReader.invalidate(),[detailReader]);
 useEffect(()=>{if(writable&&ready)void loadDay();return()=>{dayRequest.current++;};},[date,timeZone,ownerScope,writable,ready]);
 useEffect(()=>{if(!pending)return;const guard=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);},[pending]);
 async function send(command:CalendarCommand){
  if(!writable||!ready||saving.current||command.ownerScope!==ownerScope)return;
  const owner=ownerScope;saving.current=true;setBusy(true);setError('');setMessage('');setFailure(null);setPendingConflict(false);
  try{
   keepCalendarPending(sessionStorage,owner,command);setPending(command);
   const entry=await sendCalendarCommand(fetch,sessionStorage,command);if(scope.current!==owner)return;
   setPending(null);setSelected(entry);setHistory(null);setEditing({id:entry.id,revision:entry.revision});setForm(calendarEntryForm(entry));setMessage(entry.status==='cancelled'?'已读回取消状态，来源和历史仍保留。':'已保存并读回站内安排。计划不代表已完成。');void loadDay();
  }catch(cause){
   if(scope.current!==owner)return;setError(errorText(cause));setFailure(cause instanceof CalendarClientError?cause.status:null);
   setPendingConflict(cause instanceof CalendarClientError&&!cause.uncertain&&cause.status===409);
   try{setPending(readCalendarPending(sessionStorage,owner));}catch{setError('无法读取保留的请求，请保留页面并重新读取。');}
  }finally{saving.current=false;if(scope.current===owner)setBusy(false);}
 }
 function submit(event:FormEvent){event.preventDefault();if(pending){void send(pending);return;}try{void send(freezeCalendarCommand(ownerScope,crypto.randomUUID(),form,editing));}catch(cause){setError(errorText(cause));}}
 async function openEntry(entry:CalendarEntry){if(pending||busy)return;setError('');setMessage('');try{const current=await loadDetail(entry.id);if(current){setEditing({id:current.id,revision:current.revision});setForm(calendarEntryForm(current));}}catch(cause){setError(errorText(cause));setFailure(cause instanceof CalendarClientError?cause.status:null);}}
 async function readHistory(){if(!selected||!writable)return;const id=selected.id,owner=ownerScope;try{const result=await calendarRequest(fetch,'/'+id+'/history');if(scope.current===owner&&selectedId.current===id&&'history'in result)setHistory(result.history);}catch(cause){setError(errorText(cause));}}
 async function adoptLatest(){
  if(!pending||!pendingConflict||!editing)return;setBusy(true);setError('');try{const current=await loadDetail(editing.id);if(!current)return;clearCalendarPending(sessionStorage,ownerScope,pending.key);setPending(null);setPendingConflict(false);setEditing({id:current.id,revision:current.revision});setFailure(null);setMessage('已读取最新版本，原输入仍在表单中。请与详情核对后再保存。');}catch(cause){setError(errorText(cause));}finally{setBusy(false);}
 }
 function startNew(){if(!writable||pending||busy)return;detailReader.invalidate();setPendingConflict(false);setSelected(null);setHistory(null);setEditing(undefined);setForm(freshForm(date));setMessage('');setError('');setFailure(null);}
 const locked=!writable||!ready||busy||!!pending||selected?.status==='cancelled';
 return <div className={s.page}>
  <div className={s.pageHeader}><div><h1>站内日历</h1><p>记录安排、查看日期与修订来源。</p></div><span className={s.badge}>候选 · 默认未开放</span></div>
  {!enabled?<Card className={s.panel}><CardContent className={s.panelBody}><h2>日历尚未开放</h2><p>本人账号和数据授权尚未就绪。当前不会读取或保存日历。</p></CardContent></Card>:<>
   <p className={s.statusLine}>开发评审：仅供已授权的隔离合成数据测试。站内计划不代表完成，也未连接 Apple 日历。</p>
   {!storageReady&&<p className={s.statusLine} role="status">日历扩展存储尚未启用。新操作已关闭；此前未确认请求仍保留，存储核实可用后才能重试。</p>}
   {error&&<p className={s.error} role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
   {failure===401&&<p><a href="/review/admin/login">登录评审账号</a>后返回；未确认请求仍保留在当前浏览器会话。</p>}
   {pending&&<Card className={s.panel}><CardContent className={s.panelBody}><h2>本次请求尚未确认</h2><p>输入和请求标识已保留。确认结果前，表单和事件切换暂时锁定。</p><div className={s.actions}><button type="button" className={s.button} disabled={busy||!writable} onClick={()=>void send(pending)}>重试同一请求</button>{pendingConflict&&editing&&<button type="button" className={s.buttonSecondary} disabled={busy||!writable} onClick={()=>void adoptLatest()}>读取最新版本，保留草稿</button>}</div></CardContent></Card>}
   <div className={s.twoColumns}>
    <Card className={s.panel}><CardHeader className={s.panelHead}><CardTitle><h2>按日查看</h2></CardTitle></CardHeader><CardContent className={s.panelBody}><div className={s.form}><label>日期<input type="date" value={date} disabled={busy} onChange={event=>{if(event.target.value)setDate(event.target.value);}}/></label><label>查看时区（明确选择）<input value={timeZone} onChange={event=>setTimeZone(event.target.value)} placeholder="UTC 或 Asia/Shanghai"/></label><button type="button" className={s.buttonSecondary} disabled={!writable} onClick={()=>void loadDay()}>重新读取</button></div>{entries===null?<p>尚未读到日列表。</p>:entries.length===0?<p>该日期没有可访问的站内安排。</p>:<ul>{entries.map(entry=><li key={entry.id}><button type="button" className={s.buttonSecondary} disabled={!writable||!!pending||busy} onClick={()=>void openEntry(entry)}>{entry.title} · {entry.status==='planned'?'计划中':'已取消'}</button><p>{scheduleText(entry)}</p></li>)}</ul>}</CardContent></Card>
    <Card className={s.panel}><CardHeader className={s.panelHead}><CardTitle><h2>{editing?'编辑安排':'新建安排'}</h2></CardTitle><button type="button" className={s.buttonSecondary} disabled={!writable||!!pending||busy} onClick={startNew}>新建安排</button></CardHeader><CardContent className={s.panelBody}><form className={s.form} onSubmit={submit}><fieldset disabled={locked}><label>名称<input required maxLength={240} value={form.title} onChange={event=>setForm({...form,title:event.target.value})}/></label><label>原始说明<textarea maxLength={16000} value={form.notes} onChange={event=>setForm({...form,notes:event.target.value})}/></label><label>时间类型<select value={form.kind} onChange={event=>setForm({...form,kind:event.target.value as CalendarForm['kind']})}><option value="all-day">全天日期</option><option value="timed">明确时间</option></select></label>{form.kind==='all-day'?<><label>开始日期<input type="date" required value={form.startDate} onChange={event=>setForm({...form,startDate:event.target.value})}/></label><label>结束日期（不包含当天）<input type="date" required value={form.endDate} onChange={event=>setForm({...form,endDate:event.target.value})}/></label></>:<><p>请输入完整时间和 Z 或偏移；如 2026-10-23T09:00:00+08:00。夏令时重叠需要明确偏移。</p><label>开始时间<input required value={form.startAt} placeholder="2026-10-23T09:00:00+08:00" onChange={event=>setForm({...form,startAt:event.target.value})}/></label><label>结束时间<input required value={form.endAt} placeholder="2026-10-23T10:00:00+08:00" onChange={event=>setForm({...form,endAt:event.target.value})}/></label><label>事件时区或明确偏移<input required value={form.timeZone} placeholder="Asia/Shanghai 或 +08:00" onChange={event=>setForm({...form,timeZone:event.target.value})}/></label></>}<button className={s.button} type="submit">{editing?'保存修订':'创建安排'}</button></fieldset></form></CardContent></Card>
   </div>
   {selected&&<Card className={s.panel}><CardHeader className={s.panelHead}><CardTitle><h2>安排详情</h2></CardTitle><span className={s.badge}>{selected.status==='planned'?'计划中':'已取消'} · 版本 {selected.revision}</span></CardHeader><CardContent className={s.panelBody}><h3>{selected.title}</h3><p>{scheduleText(selected)}</p><p style={{whiteSpace:'pre-wrap'}}>{selected.notes||'没有说明。'}</p><dl><dt>来源</dt><dd>站内输入 · {selected.source.id}</dd><dt>来源唯一标识</dt><dd>{selected.source.externalId}</dd><dt>最后更新</dt><dd>{selected.updatedAt}</dd></dl><details><summary>保留的原始输入</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(selected.source.original,null,2)}</pre></details><div className={s.actions}><button type="button" className={s.buttonSecondary} disabled={!writable} onClick={()=>void readHistory()}>读取历史</button><button type="button" className={s.buttonSecondary} disabled={!writable||busy||!!pending||selected.status==='cancelled'} onClick={()=>{try{void send(freezeCalendarCommand(ownerScope,crypto.randomUUID(),form,selected,true));}catch(cause){setError(errorText(cause));}}}>取消安排并保留记录</button></div>{history&&<ol>{history.map(({entry,raw})=><li key={entry.revision}>版本 {entry.revision} · {entry.status==='planned'?'计划中':'已取消'} · {entry.title}<p>{scheduleText(entry)}</p><p style={{whiteSpace:'pre-wrap'}}>{entry.notes}</p><details><summary>此次提交原文</summary><pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(raw,null,2)}</pre></details></li>)}</ol>}</CardContent></Card>}
  </>}
 </div>;
}
