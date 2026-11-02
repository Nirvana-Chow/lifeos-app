'use client';
import Link from 'next/link';
import {useCallback,useEffect,useRef,useState,useSyncExternalStore,type FormEvent} from 'react';
import {TasksClient,TaskRequestError,type TaskEntry,type TaskFields} from './client';
import {TasksSaveSession} from './session';
import {createTasksCommandStore} from './recovery';
import {createTasksReadFence} from './read-state';
import {resolveTasksAccess,type TasksAccess,type TasksAccountState} from './access';
import s from './styles.module.css';
export type {TasksAccess,TasksAccountState} from './access';
export type TasksWorkbenchProps={access?:TasksAccess;accountState?:TasksAccountState;loginHref?:string;onNavigationLockChange?:(locked:boolean)=>void};
const client=new TasksClient();
let browserSession:TasksSaveSession|undefined;
const empty=():TaskFields=>({title:'',notes:'',dueOn:'',status:'open'});
const labels={open:'待办',in_progress:'进行中',done:'已完成',cancelled:'已取消'};

export function TasksWorkbench({access='unavailable',accountState='unavailable',loginHref='/app/login',onNavigationLockChange}:TasksWorkbenchProps){
 const gate=resolveTasksAccess(access,accountState);
 return <div className={s.page}>
  <header className={s.header}><div><h1>待办</h1><p>查看事项、核对来源，并记录进展。</p></div><span className={s.badge}>{gate==='developer-review'?'Developer review mode':'需本人账号'}</span></header>
  {gate==='developer-review'?<ConnectedTasks loginHref={loginHref} onNavigationLockChange={onNavigationLockChange}/>:<section className={s.panel}>
   {gate==='checking'?<p role="status">正在核对登录状态…</p>:gate==='signed-out'?<><h2>登录后查看待办</h2><p>当前未登录，不能读取或保存私有待办。</p><Link className={s.link} href={loginHref}>前往登录</Link></>:gate==='service-unavailable'?<><h2>待办服务暂不可用</h2><p role="alert">未能核对账号与数据连接，请稍后重试。</p></>:<><h2>本人待办尚未开放</h2><p>本人账号与个人数据范围尚未就绪。已有虚构评审账号不代表你的本人账号。</p></>}
  </section>}
 </div>;
}
function ConnectedTasks({loginHref,onNavigationLockChange}:Pick<TasksWorkbenchProps,'onNavigationLockChange'>&{loginHref:string}){
 const [session,setSession]=useState<TasksSaveSession|null>(null),[storageError,setStorageError]=useState('');
 useEffect(()=>{try{browserSession??=new TasksSaveSession(client,undefined,createTasksCommandStore(sessionStorage));setSession(browserSession);}catch{setStorageError('无法恢复本标签页的待确认请求。请先核对原保存结果，本次未开放新保存。');}},[]);
 return <><p className={s.notice}>开发者评审模式：当前只读写隔离库中的虚构测试记录。本人 owner 尚未配置；这些记录仍是站内草稿，外部来源未同步。</p>{storageError?<p role="alert" className={s.error}>{storageError}</p>:session?<TasksContent session={session} loginHref={loginHref} onNavigationLockChange={onNavigationLockChange}/>:<p role="status">正在恢复待确认请求…</p>}</>;
}
function TasksContent({session,loginHref,onNavigationLockChange}:{session:TasksSaveSession;loginHref:string;onNavigationLockChange?:TasksWorkbenchProps['onNavigationLockChange']}){
 const save=useSyncExternalStore(session.subscribe,session.getSnapshot,session.getSnapshot),locked=!!save.pending;
 const [items,setItems]=useState<TaskEntry[]>([]),[loaded,setLoaded]=useState(false),[loading,setLoading]=useState(false),[detailLoading,setDetailLoading]=useState(false);
 const [selected,setSelected]=useState<TaskEntry|null>(null),[fields,setFields]=useState<TaskFields>(empty),[editing,setEditing]=useState(false),[target,setTarget]=useState<Pick<TaskEntry,'id'|'revision'>|null>(null);
 const [history,setHistory]=useState<TaskEntry[]|null>(null),[historyLoading,setHistoryLoading]=useState(false),[historyError,setHistoryError]=useState('');
 const [error,setError]=useState(''),[message,setMessage]=useState(''),[needsLogin,setNeedsLogin]=useState(false),[filter,setFilter]=useState<'all'|'active'|'done'>('active'),[latest,setLatest]=useState<TaskEntry|null>(null);
 const alive=useRef(true),reads=useRef(createTasksReadFence());
 useEffect(()=>{alive.current=true;reads.current=createTasksReadFence();return()=>{alive.current=false;reads.current.dispose();};},[]);
 const report=useCallback((cause:unknown)=>{if(!alive.current)return;setError(cause instanceof Error?cause.message:'待办读取失败，请重试。');if(cause instanceof TaskRequestError&&cause.status===401){setNeedsLogin(true);setItems([]);setLoaded(false);setLoading(false);setDetailLoading(false);setHistoryLoading(false);reads.current.invalidate();}},[]);
 const reload=useCallback(async()=>{const accepts=reads.current.begin('list');setLoading(true);try{const rows=await client.list();if(!accepts())return;setItems(rows);setLoaded(true);setNeedsLogin(false);setError('');}catch(cause){if(accepts())report(cause);}finally{if(accepts())setLoading(false);}},[report]);
 useEffect(()=>{void reload();},[reload]);
 useEffect(()=>{onNavigationLockChange?.(locked);const warn=(event:BeforeUnloadEvent)=>{if(session.getSnapshot().pending){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[locked,onNavigationLockChange,session]);
 // Restore the exact correction and revision, never silently rebase a pending command.
 useEffect(()=>{const command=save.pending??(['conflict','rejected'].includes(save.phase)?save.attempt:null);if(!command)return;const body=JSON.parse(command.body);setFields({title:body.title,notes:body.notes,dueOn:body.dueOn??'',status:body.status});setTarget(command.method==='PATCH'?{id:command.path.split('/').at(-1)!,revision:body.expectedRevision}:null);setEditing(true);},[save.pending,save.phase,save.attempt]);
 useEffect(()=>{if(save.error?.status===401)report(save.error);},[save.error,report]);
 useEffect(()=>{
  if(save.phase!=='saved'||!save.result)return;
  let cancelled=false;setMessage('已收到保存回执，正在重新读取…');setEditing(false);setLatest(null);
  void(async()=>{try{const entry=await client.detail(save.result!.entry.id);if(cancelled||!alive.current)return;if(entry.revision<save.result!.entry.revision)throw Error('保存回执与当前读取版本不一致，请重新读取。');setSelected(entry);setTarget({id:entry.id,revision:entry.revision});setFields({...entry.draft,dueOn:entry.draft.dueOn??''});setHistory(null);setMessage('已保存并重新读取隔离评审库中的站内草稿。');setNeedsLogin(false);window.dispatchEvent(new Event('lifeos-record-saved'));await reload();}catch(cause){if(!cancelled&&alive.current){setMessage('已收到保存回执，但重新读取尚未完成。');report(cause);}}})();
  return()=>{cancelled=true;};
 },[save.phase,save.result,reload,report]);
 async function choose(entry:TaskEntry){if(locked)return;const accepts=reads.current.begin('detail');reads.current.invalidate('history');setHistoryLoading(false);setDetailLoading(true);setError('');setMessage('');setSelected(null);setEditing(false);setLatest(null);setHistory(null);setHistoryError('');session.reset();try{const current=await client.detail(entry.id);if(!accepts())return;setSelected(current);setTarget({id:current.id,revision:current.revision});setFields({...current.draft,dueOn:current.draft.dueOn??''});}catch(cause){if(accepts())report(cause);}finally{if(accepts())setDetailLoading(false);}}
 function startNew(){if(locked)return;reads.current.invalidate('detail','history');setDetailLoading(false);setHistoryLoading(false);session.reset();setSelected(null);setTarget(null);setFields(empty());setEditing(true);setLatest(null);setHistory(null);setError('');setMessage('');}
 async function submit(event:FormEvent){event.preventDefault();if(locked||save.phase==='conflict')return;setError('');setMessage('');try{await session.save(fields,target);}catch(cause){report(cause);}}
 async function transition(status:'open'|'done'){if(!selected||locked)return;setFields({...selected.draft,status,dueOn:selected.draft.dueOn??''});setTarget({id:selected.id,revision:selected.revision});setEditing(true);setMessage('');setError('');try{await session.save({...selected.draft,status},selected);}catch(cause){report(cause);}}
 async function readHistory(){if(!selected)return;const id=selected.id,accepts=reads.current.begin('history');setHistoryLoading(true);setHistoryError('');try{const rows=await client.history(id);if(accepts())setHistory(rows);}catch(cause){if(accepts()){if(cause instanceof TaskRequestError&&cause.status===401)report(cause);else setHistoryError(cause instanceof Error?cause.message:'版本读取失败。');}}finally{if(accepts())setHistoryLoading(false);}}
 async function readConflict(){if(!target)return;const accepts=reads.current.begin('detail');setDetailLoading(true);try{const current=await client.detail(target.id);if(accepts())setLatest(current);}catch(cause){if(accepts())report(cause);}finally{if(accepts())setDetailLoading(false);}}
 function rebase(){if(!latest)return;setSelected(latest);setTarget({id:latest.id,revision:latest.revision});setLatest(null);session.reset();setMessage('已选择最新版本作为基础；你的修改仍保留在表单，请再次核对后保存。');}
 const pendingPanel=locked&&<div className={s.notice} role="status"><strong>{save.phase==='saving'?'正在保存…':'本次保存结果尚未确认'}</strong><p>已保留本次内容与请求标识。请重试同一请求；确认结果前不能取消或开始新保存。</p>{save.phase!=='saving'&&<button type="button" onClick={()=>void session.retry()}>重试本次保存</button>}</div>;
 if(needsLogin)return <section className={s.panel}><h2>登录已失效</h2><p>请使用同一评审账号重新登录，再返回核对本次结果。</p>{pendingPanel}<a className={s.link} href={loginHref} target="_blank" rel="noopener noreferrer">在新标签页登录</a><button type="button" disabled={save.phase==='saving'} onClick={()=>void reload()}>已登录，重新读取</button>{error&&<p role="alert" className={s.error}>{error}</p>}</section>;
 const visible=items.filter(entry=>filter==='all'||(filter==='done'?entry.draft.status==='done':['open','in_progress'].includes(entry.draft.status)));
 return <>
  {error&&<p role="alert" className={s.error}>{error}</p>}{save.error&&<p role="alert" className={s.error}>{save.error.message}</p>}{message&&<p role="status" className={s.notice}>{message}</p>}{pendingPanel}
  <div className={s.columns}>
   <section className={s.panel} aria-label="待办列表"><div className={s.toolbar}><h2>事项</h2><button type="button" disabled={locked||loading} onClick={()=>void reload()}>重新读取</button><button type="button" disabled={locked} onClick={startNew}>新建待办</button></div>
    <label className={s.filter}>显示<select value={filter} disabled={locked} onChange={event=>setFilter(event.target.value as typeof filter)}><option value="active">待办与进行中</option><option value="done">已完成</option><option value="all">全部状态</option></select></label>
    {loading&&<p role="status">正在读取待办…</p>}{!loading&&loaded&&visible.length===0&&<p className={s.empty}>当前筛选没有待办记录。</p>}
    <ul className={s.list}>{visible.map(entry=><li key={entry.id}><button type="button" disabled={locked} aria-current={selected?.id===entry.id?'true':undefined} onClick={()=>void choose(entry)}><strong>{entry.draft.title}</strong><span>{labels[entry.draft.status]} · {entry.draft.dueOn?'截止 '+entry.draft.dueOn:'未设截止日期'}</span><small>站内草稿 · 修订 {entry.revision}{entry.inboxId?' · 来自收件箱':''}</small></button></li>)}</ul>
   </section>
   <section className={s.panel} aria-label="待办详情">
    {detailLoading&&<p role="status">正在读取最新版本…</p>}
    {editing?<><h2>{target?'编辑待办':'新建待办'}</h2><form className={s.form} onSubmit={submit}><fieldset disabled={locked}>
     <label>标题<input required maxLength={240} value={fields.title} onChange={event=>setFields({...fields,title:event.target.value})}/></label>
     <label>说明<textarea maxLength={16384} value={fields.notes} onChange={event=>setFields({...fields,notes:event.target.value})}/></label>
     <div className={s.formColumns}><label>截止日期（可留空）<input type="date" value={fields.dueOn??''} onChange={event=>setFields({...fields,dueOn:event.target.value})}/></label><label>状态<select value={fields.status} onChange={event=>setFields({...fields,status:event.target.value as TaskFields['status']})}>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label></div>
     <div className={s.actions}><button className={s.primary} type="submit" disabled={save.phase==='conflict'}>保存站内草稿</button><button type="button" onClick={()=>{session.reset();setEditing(false);setLatest(null);setError('');if(selected)setFields({...selected.draft,dueOn:selected.draft.dueOn??''});}}>取消编辑</button></div>
    </fieldset></form>
    {save.phase==='conflict'&&<div className={s.notice}><h3>先核对修订冲突</h3><p>你的修改已保留。读取最新版本后，明确选择以它为基础，再次保存。</p><button type="button" disabled={detailLoading} onClick={()=>void readConflict()}>读取最新版本</button>{latest&&<><h4>服务器当前版本 {latest.revision}</h4><TaskText entry={latest}/><button type="button" onClick={rebase}>已核对，保留我的修改并使用此版本</button></>}</div>}</>:selected?<><div className={s.toolbar}><h2>{selected.draft.title}</h2><span className={s.badge}>{labels[selected.draft.status]}</span></div><TaskText entry={selected}/><div className={s.actions}><button type="button" disabled={locked} onClick={()=>{session.reset();setEditing(true);setMessage('');}}>编辑</button><button type="button" disabled={locked} onClick={()=>void transition(selected.draft.status==='done'?'open':'done')}>{selected.draft.status==='done'?'重新打开':'标记完成'}</button></div></>:!detailLoading&&<p className={s.empty}>选择一条待办查看详情，或新建待办。</p>}
    {selected&&<details className={s.provenance}><summary>来源与修订历史</summary><dl><dt>记录 ID</dt><dd>{selected.id}</dd><dt>来源 ID</dt><dd>{selected.source.id}</dd><dt>来源系统</dt><dd>站内输入（website）</dd><dt>来源版本</dt><dd>{selected.source.version}</dd><dt>来源时间</dt><dd>{selected.source.asOf}</dd><dt>记录修订</dt><dd>{selected.revision}</dd><dt>更新时间</dt><dd>{selected.updatedAt}</dd>{selected.inboxId&&<><dt>关联收件箱 ID</dt><dd>{selected.inboxId}</dd></>}<dt>同步状态</dt><dd>站内草稿 · 外部来源未同步</dd></dl><h3>原始输入</h3><pre>{JSON.stringify(selected.source.original,null,2)}</pre><button type="button" disabled={historyLoading||locked} onClick={()=>void readHistory()}>{historyLoading?'正在读取历史…':'读取最近 100 个修订'}</button>{historyError&&<p role="alert" className={s.error}>{historyError}</p>}{history?.length===0&&<p>接口没有返回历史修订。</p>}{history?.map(entry=><details key={entry.revision}><summary>修订 {entry.revision} · {entry.updatedAt}</summary><TaskText entry={entry}/></details>)}</details>}
   </section>
  </div>
 </>;
}
function TaskText({entry}:{entry:TaskEntry}){return <div className={s.content}><p><strong>标题：</strong>{entry.draft.title}</p><p><strong>状态：</strong>{labels[entry.draft.status]}</p><p><strong>截止：</strong>{entry.draft.dueOn??'未设置'}</p><p className={s.notes}>{entry.draft.notes||'没有补充说明。'}</p></div>;}
