'use client';
import Link from 'next/link';
import {FinanceComparison} from './compare';
import {useCallback,useEffect,useRef,useState,useSyncExternalStore,type FormEvent} from 'react';
import {resolveTasksAccess,type TasksAccess,type TasksAccountState} from '../tasks-workbench/access';
import {FinanceClient,FinanceRequestError,readFinanceIdentity,type FinanceEntry} from './client';
import {emptyFinanceFields,fieldsFromDraft,formatAmount,financeLabels,type FinanceFields} from './fields';
import {FinanceSaveSession} from './session';
import {createFinanceCommandStore} from './recovery';
import {createFinanceReadFence,assertFinanceReadback} from './read-state';
import s from './styles.module.css';

export type FinanceWorkbenchProps={access?:TasksAccess;accountState?:TasksAccountState;loginHref?:string;onNavigationLockChange?:(locked:boolean)=>void};
type Connection={client:FinanceClient;session:FinanceSaveSession};
// In-flight saves survive route unmounts, but a different identity never receives this session.
const connections=new Map<string,Connection>();

export function FinanceWorkbench({access='unavailable',accountState='unavailable',loginHref='/app/login',onNavigationLockChange}:FinanceWorkbenchProps){
 const gate=resolveTasksAccess(access,accountState);
 return <div className={s.page}>
  <header className={s.header}><div><h1>财务</h1><p>手工记录流水，核对账户方向、原支出与修订来源。</p></div><span className={s.badge}>{gate==='developer-review'?'Developer review mode':'需本人账号'}</span></header>
  {gate==='developer-review'?<ConnectedFinance loginHref={loginHref} onNavigationLockChange={onNavigationLockChange}/>:<section className={s.panel}>
   {gate==='checking'?<p role="status">正在核对登录状态…</p>:gate==='signed-out'?<><h2>登录后查看财务</h2><p>当前未登录，不能读取或保存私有财务记录。</p><Link className={s.link} href={loginHref}>前往登录</Link></>:gate==='service-unavailable'?<><h2>财务服务暂不可用</h2><p role="alert">未能核对账号与数据连接，请稍后重试。</p></>:<><h2>本人财务尚未开放</h2><p>本人账号与个人数据范围尚未就绪。已有虚构评审账号不代表你的本人账号。</p></>}
  </section>}
 <FinanceComparison allowed={gate==='developer-review'}/>
 </div>;
}
function ConnectedFinance({loginHref,onNavigationLockChange}:Pick<FinanceWorkbenchProps,'onNavigationLockChange'>&{loginHref:string}){
 const [connection,setConnection]=useState<Connection|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{
  let active=true;setError('');
  void(async()=>{try{
   const owner=await readFinanceIdentity();if(!active)return;
   let connected=connections.get(owner);
   if(!connected){const client=new FinanceClient(owner),session=new FinanceSaveSession(client,undefined,createFinanceCommandStore(sessionStorage,owner));connected={client,session};connections.set(owner,connected);}
   setConnection(connected);
  }catch(cause){if(active)setError(cause instanceof FinanceRequestError?cause.message:'无法恢复本标签页的待确认财务请求。请恢复原评审账号并核对原保存结果；新保存暂不可用。');}})();
  return()=>{active=false;};
 },[retry]);
 return <><p className={s.notice}>开发者评审模式：当前只读写隔离库中的虚构测试记录。本人 owner 尚未配置；这些记录是站内草稿，外部来源未同步。账户引用用于记录资金方向，尚未连接真实账户或余额。</p>
  {error?<section className={s.panel}><p role="alert" className={s.error}>{error}</p><a className={s.link} href={loginHref} target="_blank" rel="noopener noreferrer">在新标签页登录</a><button type="button" onClick={()=>setRetry(value=>value+1)}>重新核对身份与恢复状态</button></section>:connection?<FinanceContent {...connection} loginHref={loginHref} onNavigationLockChange={onNavigationLockChange}/>:<p role="status">正在核对身份并恢复待确认请求…</p>}
 </>;
}
function FinanceContent({client,session,loginHref,onNavigationLockChange}:Connection&{loginHref:string;onNavigationLockChange?:FinanceWorkbenchProps['onNavigationLockChange']}){
 const save=useSyncExternalStore(session.subscribe,session.getSnapshot,session.getSnapshot),locked=!!save.pending;
 const [items,setItems]=useState<FinanceEntry[]>([]),[loaded,setLoaded]=useState(false),[loading,setLoading]=useState(false);
 const [selected,setSelected]=useState<FinanceEntry|null>(null),[fields,setFields]=useState<FinanceFields>(emptyFinanceFields),[editing,setEditing]=useState(false),[target,setTarget]=useState<Pick<FinanceEntry,'id'|'revision'>|null>(null);
 const [history,setHistory]=useState<FinanceEntry[]|null>(null),[historyLoading,setHistoryLoading]=useState(false),[historyError,setHistoryError]=useState('');
 const [detailLoading,setDetailLoading]=useState(false),[readbackLoading,setReadbackLoading]=useState(false),[latest,setLatest]=useState<FinanceEntry|null>(null);
 const [error,setError]=useState(''),[message,setMessage]=useState(''),[needsLogin,setNeedsLogin]=useState(false),[filter,setFilter]=useState<'all'|FinanceFields['kind']>('all');
 const alive=useRef(true),reads=useRef(createFinanceReadFence());
 useEffect(()=>{alive.current=true;reads.current=createFinanceReadFence();return()=>{alive.current=false;reads.current.dispose();};},[]);
 const report=useCallback((cause:unknown)=>{
  if(!alive.current)return;setError(cause instanceof Error?cause.message:'财务读取失败，请重试。');
  if(cause instanceof FinanceRequestError&&[401,403].includes(cause.status)){
   reads.current.invalidate();setNeedsLogin(true);setItems([]);setSelected(null);setHistory(null);setLatest(null);setLoaded(false);setLoading(false);setDetailLoading(false);setHistoryLoading(false);setReadbackLoading(false);setMessage('');
  }
 },[]);
 const reload=useCallback(async()=>{
  const accepts=reads.current.begin('list');setLoading(true);
  try{const rows=await client.list();if(!accepts())return;setItems(rows);setLoaded(true);setNeedsLogin(false);setError('');}
  catch(cause){if(accepts())report(cause);}finally{if(accepts())setLoading(false);}
 },[client,report]);
 useEffect(()=>{void reload();},[reload]);
 useEffect(()=>{
  onNavigationLockChange?.(locked);
  const warn=(event:BeforeUnloadEvent)=>{if(session.getSnapshot().pending){event.preventDefault();event.returnValue='';}};
  window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
 },[locked,onNavigationLockChange,session]);
 useEffect(()=>{
  const command=save.pending??(['conflict','rejected'].includes(save.phase)?save.attempt:null);if(!command)return;
  const body=JSON.parse(command.body);setFields(JSON.parse(command.input));setTarget(command.method==='PATCH'?{id:command.path.split('/').at(-1)!,revision:body.expectedRevision}:null);setEditing(true);
 },[save.pending,save.phase,save.attempt]);
 useEffect(()=>{if(save.error&&[401,403].includes(save.error.status))report(save.error);},[save.error,report]);
 const readSaved=useCallback(async(entry:FinanceEntry)=>{
  reads.current.invalidate('detail','history');const accepts=reads.current.begin('readback');setReadbackLoading(true);setSelected(null);setHistory(null);setLatest(null);setEditing(false);setMessage('已收到保存回执，正在重新读取…');
  try{
   const current=await client.detail(entry.id);if(!accepts())return;assertFinanceReadback(current,entry);
   setSelected(current);setTarget({id:current.id,revision:current.revision});setFields(fieldsFromDraft(current.draft));setNeedsLogin(false);
   setMessage(current.revision===entry.revision?'已保存并重新读取隔离评审库中的站内草稿。':'已确认保存；当前记录另有更新，现显示重新读取的最新修订。');
   window.dispatchEvent(new Event('lifeos-record-saved'));await reload();
  }catch(cause){if(accepts()){setMessage('已收到保存回执，但重新读取尚未完成。');report(cause);}}finally{if(accepts())setReadbackLoading(false);}
 },[client,reload,report]);
 useEffect(()=>{if(save.phase==='saved'&&save.result)void readSaved(save.result.entry);},[save.phase,save.result,readSaved]);
 function clearSelection(){reads.current.invalidate('detail','history','readback');setDetailLoading(false);setHistoryLoading(false);setReadbackLoading(false);setSelected(null);setLatest(null);setHistory(null);setHistoryError('');setError('');setMessage('');}
 async function choose(entry:FinanceEntry){
  if(locked)return;clearSelection();setEditing(false);session.reset();const accepts=reads.current.begin('detail');setDetailLoading(true);
  try{const current=await client.detail(entry.id);if(!accepts())return;if(current.revision<entry.revision)throw Error('读取版本落后于列表，请重新读取。');setSelected(current);setTarget({id:current.id,revision:current.revision});setFields(fieldsFromDraft(current.draft));}
  catch(cause){if(accepts())report(cause);}finally{if(accepts())setDetailLoading(false);}
 }
 function startNew(){if(locked)return;clearSelection();session.reset();setTarget(null);setFields(emptyFinanceFields());setEditing(true);}
 async function submit(event:FormEvent){
  event.preventDefault();if(locked||save.phase==='conflict')return;reads.current.invalidate('list','detail','history','readback');setLoading(false);setHistoryLoading(false);setError('');setMessage('');
  try{await session.save(fields,target);}catch(cause){report(cause);}
 }
 function cancel(){if(locked)return;reads.current.invalidate('detail','history','readback');setDetailLoading(false);setHistoryLoading(false);setReadbackLoading(false);session.reset();setEditing(false);setLatest(null);setError('');setFields(selected?fieldsFromDraft(selected.draft):emptyFinanceFields());setTarget(selected?{id:selected.id,revision:selected.revision}:null);setMessage('已取消编辑，未提交此表单。');}
 async function readHistory(){
  if(!selected)return;const accepts=reads.current.begin('history'),id=selected.id;setHistoryLoading(true);setHistoryError('');
  try{const rows=await client.history(id);if(accepts())setHistory(rows);}catch(cause){if(accepts()){if(cause instanceof FinanceRequestError&&[401,403].includes(cause.status))report(cause);else setHistoryError(cause instanceof Error?cause.message:'历史读取失败。');}}finally{if(accepts())setHistoryLoading(false);}
 }
 async function readConflict(){
  if(!target)return;const accepts=reads.current.begin('detail');setDetailLoading(true);setLatest(null);
  try{const current=await client.detail(target.id);if(!accepts())return;if(current.revision<=target.revision)throw Error('最新修订尚未读取到，请稍后重试。');setLatest(current);}catch(cause){if(accepts())report(cause);}finally{if(accepts())setDetailLoading(false);}
 }
 function rebase(){if(!latest||locked)return;reads.current.invalidate('history');setHistoryLoading(false);setSelected(latest);setTarget({id:latest.id,revision:latest.revision});setLatest(null);setHistory(null);session.reset();setMessage('已明确选择最新修订作为基础；你的修改保留在表单中，请核对后再保存。');}
 const pendingPanel=locked&&<div className={s.notice} role="status"><strong>{save.phase==='saving'?'正在保存…':'本次保存结果尚未确认'}</strong><p>已保留原始表单、修订与请求标识。确认结果前不能取消或开始新保存，请使用原评审账号重试同一请求。</p>{save.phase!=='saving'&&<button type="button" onClick={()=>void session.retry()}>重试本次保存</button>}</div>;
 if(needsLogin)return <section className={s.panel}><h2>请核对原评审账号</h2><p>身份失效或发生变化，财务数据已隐藏。请使用保存时的同一评审账号重新登录。</p>{pendingPanel}<a className={s.link} href={loginHref} target="_blank" rel="noopener noreferrer">在新标签页登录</a><button type="button" disabled={save.phase==='saving'} onClick={()=>void reload()}>已登录，重新读取</button>{error&&<p role="alert" className={s.error}>{error}</p>}</section>;
 const visible=items.filter(entry=>filter==='all'||entry.draft.kind===filter),outgoing=['expense','transfer','repayment'].includes(fields.kind),incoming=['income','refund','transfer','repayment'].includes(fields.kind),paired=['transfer','repayment'].includes(fields.kind);
 return <>
  {error&&<p role="alert" className={s.error}>{error}</p>}{save.error&&<p role="alert" className={s.error}>{save.error.message}</p>}{message&&<p role="status" className={s.notice}>{message}</p>}{pendingPanel}
  <div className={s.columns}>
   <section className={s.panel} aria-label="财务流水列表"><div className={s.toolbar}><h2>流水</h2><button type="button" disabled={locked||loading} onClick={()=>void reload()}>重新读取</button><button type="button" disabled={locked} onClick={startNew}>新建流水</button></div>
    <label className={s.filter}>显示类型<select value={filter} disabled={locked} onChange={event=>setFilter(event.target.value as typeof filter)}><option value="all">全部流水</option>{Object.entries(financeLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    {loading&&<p role="status">正在读取流水…</p>}{!loading&&loaded&&visible.length===0&&<p className={s.empty}>当前筛选没有财务记录。</p>}{error&&items.length>0&&<p className={s.muted}>以下为上次成功读取的记录。</p>}
    <ul className={s.list}>{visible.map(entry=><li key={entry.id}><button type="button" disabled={locked} aria-current={selected?.id===entry.id?'true':undefined} onClick={()=>void choose(entry)}><strong>{financeLabels[entry.draft.kind]} · ¥{formatAmount(entry.draft.amountMinor)}</strong><span>{entry.draft.occurredOn} · {entry.draft.category??'未分类'}</span><span>{entry.draft.notes||'无备注'}</span><small>站内草稿 · 修订 {entry.revision}</small></button></li>)}</ul>
   </section>
   <section className={s.panel} aria-label="财务流水详情">
    {(detailLoading||readbackLoading)&&<p role="status">正在读取当前修订…</p>}
    {save.phase==='saved'&&save.result&&!readbackLoading&&!selected&&<button type="button" onClick={()=>void readSaved(save.result!.entry)}>重试保存后回读</button>}
    {editing?<><h2>{target?'编辑流水':'新建流水'}</h2><form className={s.form} onSubmit={submit}><fieldset disabled={locked}>
     <div className={s.formColumns}><label>流水类型<select value={fields.kind} onChange={event=>setFields({...fields,kind:event.target.value as FinanceFields['kind'],originalEntryId:''})}>{Object.entries(financeLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>金额（CNY 元）<input required inputMode="decimal" autoComplete="off" maxLength={14} aria-describedby="finance-amount-help" value={fields.amount} onChange={event=>setFields({...fields,amount:event.target.value})}/></label></div>
     <p id="finance-amount-help" className={s.help}>金额为正数，最多两位小数。流水类型决定资金方向。</p>
     <div className={s.formColumns}><label>发生日期<input required type="date" value={fields.occurredOn} onChange={event=>setFields({...fields,occurredOn:event.target.value})}/></label><label>分类（可留空）<input maxLength={80} value={fields.category} onChange={event=>setFields({...fields,category:event.target.value})}/></label></div>
     <div className={s.formColumns}>
      {outgoing&&<label>{fields.kind==='repayment'?'还款付款账户引用':'转出／付款账户引用'}{paired?'（必填）':'（可留空）'}<input required={paired} maxLength={64} pattern="[A-Za-z0-9][A-Za-z0-9._:\-]*" autoComplete="off" aria-describedby="finance-account-help" value={fields.fromAccountRef} onChange={event=>setFields({...fields,fromAccountRef:event.target.value})}/></label>}
      {incoming&&<label>{fields.kind==='repayment'?'被偿还账户引用':'转入／收款账户引用'}{paired?'（必填）':'（可留空）'}<input required={paired} maxLength={64} pattern="[A-Za-z0-9][A-Za-z0-9._:\-]*" autoComplete="off" aria-describedby="finance-account-help" value={fields.toAccountRef} onChange={event=>setFields({...fields,toAccountRef:event.target.value})}/></label>}
     </div>
     <p id="finance-account-help" className={s.help}>填写已有账户引用，仅用字母、数字、点、冒号、下划线或连字符。留空表示尚未明确；转账与还款必须填写不同的两端账户。</p>
     {fields.kind==='refund'&&<><label>原支出记录 ID<input required value={fields.originalEntryId} maxLength={36} autoComplete="off" list="finance-expense-ids" aria-describedby="finance-refund-help" onChange={event=>setFields({...fields,originalEntryId:event.target.value})}/><datalist id="finance-expense-ids">{items.filter(entry=>entry.draft.kind==='expense').map(entry=><option key={entry.id} value={entry.id}>{entry.draft.occurredOn} · ¥{formatAmount(entry.draft.amountMinor)} · {entry.draft.notes}</option>)}</datalist></label><p id="finance-refund-help" className={s.help}>关联当前账号可访问的 CNY 支出。退款单独记录，保留原支出。</p></>}
     <label>备注<textarea maxLength={16384} value={fields.notes} onChange={event=>setFields({...fields,notes:event.target.value})}/></label>
     <div className={s.actions}><button className={s.primary} type="submit" disabled={save.phase==='conflict'}>保存站内草稿</button><button type="button" onClick={cancel}>取消编辑</button></div>
    </fieldset></form>
    {save.phase==='conflict'&&<div className={s.notice}><h3>先核对修订冲突</h3><p>你的金额、账户和备注仍保留。读取当前修订并确认作为基础后，才能再次保存。</p><button type="button" disabled={detailLoading} onClick={()=>void readConflict()}>读取最新修订</button>{latest&&<><h4>当前修订 {latest.revision}</h4><FinanceText entry={latest}/><button type="button" onClick={rebase}>已核对，保留我的修改并使用此修订</button></>}</div>}</>:selected?<><div className={s.toolbar}><h2>{financeLabels[selected.draft.kind]} · ¥{formatAmount(selected.draft.amountMinor)}</h2><span className={s.badge}>站内草稿</span></div><FinanceText entry={selected}/><button type="button" disabled={locked} onClick={()=>{session.reset();setFields(fieldsFromDraft(selected.draft));setTarget({id:selected.id,revision:selected.revision});setEditing(true);setMessage('');}}>编辑流水</button>{selected.draft.kind==='expense'&&<button type="button" className={s.secondary} disabled={locked} onClick={()=>{const original=selected.id;startNew();setFields({...emptyFinanceFields(),kind:'refund',originalEntryId:original});}}>关联此支出新建退款</button>}</>:!detailLoading&&!readbackLoading&&<p className={s.empty}>选择一条流水查看详情，或新建手工流水。</p>}
    {selected&&<details className={s.provenance}><summary>来源与修订历史</summary><dl><dt>记录 ID</dt><dd>{selected.id}</dd><dt>来源 ID</dt><dd>{selected.source.id}</dd><dt>外部引用</dt><dd>{selected.source.externalId}</dd><dt>来源系统</dt><dd>站内输入（website）</dd><dt>来源版本</dt><dd>{selected.source.version}</dd><dt>来源时间</dt><dd>{selected.source.asOf}</dd><dt>记录修订</dt><dd>{selected.revision}</dd><dt>更新时间</dt><dd>{selected.updatedAt}</dd><dt>同步状态</dt><dd>站内草稿 · 外部来源未同步</dd></dl><h3>原始提交内容</h3><pre>{JSON.stringify(selected.source.original,null,2)}</pre><button type="button" disabled={historyLoading||locked} onClick={()=>void readHistory()}>{historyLoading?'正在读取历史…':'读取最近 100 个修订'}</button>{historyError&&<p role="alert" className={s.error}>{historyError}</p>}{history?.length===0&&<p>接口没有返回历史修订。</p>}{history?.map(entry=><details key={entry.revision}><summary>修订 {entry.revision} · {entry.updatedAt}</summary><FinanceText entry={entry}/></details>)}</details>}
   </section>
  </div>
 </>;
}
function FinanceText({entry}:{entry:FinanceEntry}){const draft=entry.draft;return <div className={s.content}><dl><dt>流水类型</dt><dd>{financeLabels[draft.kind]}</dd><dt>金额</dt><dd>¥{formatAmount(draft.amountMinor)} CNY</dd><dt>发生日期</dt><dd>{draft.occurredOn}</dd><dt>分类</dt><dd>{draft.category??'未分类'}</dd><dt>付款账户</dt><dd>{draft.fromAccountRef??'未提供／不适用'}</dd><dt>收款账户</dt><dd>{draft.toAccountRef??'未提供／不适用'}</dd>{draft.kind==='refund'&&<><dt>原支出 ID</dt><dd>{draft.originalEntryId}</dd></>}</dl><p className={s.notes}>{draft.notes||'没有备注。'}</p></div>;}
