'use client';
import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import type {PublicEntry} from '../platform/contracts';
import {JournalMutationSession,JournalReadError,makeJournalCreate,makeJournalUpdate,readJournalDetail,readJournalList,createJournalDetailFence,type JournalFields,type JournalState} from './client';
import s from './journal.module.css';

const emptyFields=():JournalFields=>({title:'',text:'',occurredOn:''});
const entryFields=(entry:PublicEntry):JournalFields=>'text'in entry.draft?{title:entry.draft.title,text:entry.draft.text,occurredOn:entry.draft.occurredOn??''}:emptyFields();
const initialMutation:JournalState={phase:'idle',pending:null,saved:null,error:'',status:null};
function originalText(entry:PublicEntry):string{const original=entry.source.original;return original&&typeof original==='object'&&'inputText'in original&&typeof original.inputText==='string'?original.inputText:'此记录没有可展示的原始文字。';}

/** onLockChange lets the host disable imperative navigation while a save is unresolved. */
export function JournalPage({apiPrefix='/api/platform/journal',loginHref='/review/admin/login',allowSyntheticReview=false,onLockChange}:{apiPrefix?:string;loginHref?:string;allowSyntheticReview?:boolean;onLockChange?:(locked:boolean)=>void}={}){
 const [session,setSession]=useState<JournalMutationSession|null>(null),[mutation,setMutation]=useState<JournalState>(initialMutation);
 const [showSynthetic,setShowSynthetic]=useState(false),[items,setItems]=useState<PublicEntry[]>([]),[selected,setSelected]=useState<PublicEntry|null>(null),[history,setHistory]=useState<PublicEntry[]>([]);
 const [fields,setFields]=useState<JournalFields>(emptyFields),[editing,setEditing]=useState(false),[acknowledged,setAcknowledged]=useState(false),[auth,setAuth]=useState<boolean|null>(null),[loading,setLoading]=useState(true),[detailLoading,setDetailLoading]=useState(false),[readError,setReadError]=useState(''),[formError,setFormError]=useState(''),[savedMessage,setSavedMessage]=useState('');
 const handledSave=useRef<PublicEntry|null>(null),listGeneration=useRef(0),details=useRef(createJournalDetailFence()),locked=mutation.phase==='saving'||mutation.phase==='uncertain';
 const syntheticView=allowSyntheticReview&&showSynthetic;
 const lockedRef=useRef(locked);lockedRef.current=locked;
 useEffect(()=>{
  let storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>;
  try{storage=window.sessionStorage;}catch{storage={getItem:()=>{throw Error();},setItem:()=>{throw Error();},removeItem:()=>{throw Error();}};}
  const next=new JournalMutationSession({apiPrefix,storage});setSession(next);setMutation(next.getSnapshot());
  const pending=next.getSnapshot().pending;
  if(pending){setShowSynthetic(allowSyntheticReview);setEditing(true);setAcknowledged(true);setFields(pending.method==='POST'?{title:pending.body.fields.title,text:pending.body.fields.body,occurredOn:pending.body.fields.date??''}:{title:pending.body.title,text:pending.body.text,occurredOn:pending.body.occurredOn??''});}
  return next.subscribe(()=>setMutation(next.getSnapshot()));
 },[apiPrefix]);
 useEffect(()=>{onLockChange?.(locked);return()=>onLockChange?.(false);},[locked,onLockChange]);
 useEffect(()=>{
  if(!locked)return;
  const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
  const keepPage=(event:MouseEvent)=>{const target=event.target;if(!(target instanceof Element))return;const link=target.closest('a[href]');if(link&&link.getAttribute('target')!=='_blank'){event.preventDefault();event.stopPropagation();}};
  window.addEventListener('beforeunload',warn);document.addEventListener('click',keepPage,true);
  return()=>{window.removeEventListener('beforeunload',warn);document.removeEventListener('click',keepPage,true);};
 },[locked]);
 const loadList=useCallback(async()=>{
  const generation=++listGeneration.current;setLoading(true);setReadError('');
  try{const found=await readJournalList(fetch,syntheticView,apiPrefix);if(generation!==listGeneration.current)return;setItems(found);setAuth(true);}
  catch(error){if(generation!==listGeneration.current)return;setItems([]);if(error instanceof JournalReadError&&error.status===401){setAuth(false);setSelected(null);setHistory([]);}setReadError(error instanceof Error?error.message:'读取失败，请重试。');}
  finally{if(generation===listGeneration.current)setLoading(false);}
 },[apiPrefix,syntheticView]);
 useEffect(()=>{void loadList();return()=>{listGeneration.current++;details.current.invalidate();};},[loadList]);
 async function choose(id:string){
  if(lockedRef.current)return;const accepts=details.current.begin();setDetailLoading(true);setReadError('');setFormError('');setSavedMessage('');setEditing(false);
  try{const found=await readJournalDetail(id,syntheticView,fetch,apiPrefix);if(!accepts()||lockedRef.current)return;setSelected(found.entry);setHistory(found.history);setFields(entryFields(found.entry));setAuth(true);}
  catch(error){if(!accepts())return;setSelected(null);setHistory([]);if(error instanceof JournalReadError&&error.status===401)setAuth(false);setReadError(error instanceof Error?error.message:'日记读取失败，请重试。');}
  finally{if(accepts())setDetailLoading(false);}
 }
 useEffect(()=>{
  if(mutation.status===401)setAuth(false);
  if(mutation.phase!=='saved'||!mutation.saved||handledSave.current===mutation.saved)return;
  handledSave.current=mutation.saved;setSelected(mutation.saved);setHistory([mutation.saved]);setFields(entryFields(mutation.saved));setEditing(false);setFormError('');setSavedMessage('已确认保存测试草稿。');setAuth(true);void loadList();
  window.dispatchEvent(new Event('lifeos-record-saved'));
 },[mutation,loadList]);
 function changeScope(value:boolean){if(locked)return;details.current.invalidate();setDetailLoading(false);setShowSynthetic(value);setSelected(null);setHistory([]);setEditing(false);setFields(emptyFields());setSavedMessage('');setFormError('');}
 function begin(){if(locked||!syntheticView||!auth)return;details.current.invalidate();setDetailLoading(false);setSelected(null);setHistory([]);setFields(emptyFields());setAcknowledged(false);setEditing(true);setFormError('');setSavedMessage('');}
 async function submit(event:FormEvent){
  event.preventDefault();if(!session||locked||!auth||!syntheticView)return;setFormError('');setSavedMessage('');
  try{if(!acknowledged)throw Error('请确认只填写虚构测试数据。');const key='journal-ui-'+crypto.randomUUID();const command=selected?makeJournalUpdate(selected,fields,key):makeJournalCreate(fields,key,Intl.DateTimeFormat().resolvedOptions().timeZone,acknowledged);await session.submit(command);}
  catch(error){setFormError(error instanceof Error?error.message:'请核对填写内容。');}
 }
 const editingExisting=!!selected||mutation.pending?.method==='PATCH';
 return <main className={s.page}>
  <header className={s.header}><div><p className={s.eyebrow}>生活记录</p><h1>日记</h1><p>保存一段文字，也保留最初的记录。</p></div>{allowSyntheticReview&&<button className={s.primary} disabled={!syntheticView||!auth||locked||loading||!session} onClick={begin}>新建测试日记</button>}</header>
  <div className={s.toolbar}>{allowSyntheticReview&&<label><input type="checkbox" checked={syntheticView} disabled={locked} onChange={event=>changeScope(event.target.checked)}/>显示合成测试日记</label>}<button disabled={locked||loading} onClick={()=>void loadList()}>重新读取</button></div>
  {syntheticView&&<p className={s.notice}>当前为合成测试视图。请只填写虚构内容；个人数据写入尚未开放。</p>}
  {readError&&<p className={s.error} role="alert">{readError}</p>}
  {mutation.error&&<div className={s.error} role="alert"><p>{mutation.error}</p>{mutation.phase==='uncertain'&&<><p>本次表单和页面导航已锁定。重试会使用原来的内容与请求标识。</p>{mutation.pending&&<button disabled={!session} onClick={()=>void session?.retry()}>重试本次保存</button>}</>}{mutation.phase==='rejected'&&mutation.status===409&&selected&&<button disabled={locked} onClick={()=>void choose(selected.id)}>读取当前版本并重新核对</button>}</div>}
  {formError&&<p className={s.error} role="alert">{formError}</p>}
  {savedMessage&&<p className={s.success} role="status">{savedMessage}</p>}
  {mutation.phase==='saving'&&<p role="status">正在确认保存，请稍候…</p>}
  {auth===false&&<section className={s.panel}><h2>登录后查看日记</h2><p>当前会话未通过验证。</p><a href={loginHref} target={locked?'_blank':undefined} rel={locked?'noopener noreferrer':undefined}>{locked?'在新标签页登录':'前往登录'}</a>{locked&&<p>完成登录后返回此页，重试同一次保存。</p>}</section>}
  {auth!==false&&<div className={s.columns}>
   <section className={s.panel} aria-label="日记列表"><h2>{syntheticView?'测试日记':'我的日记'}</h2>{loading?<p role="status">正在读取日记…</p>:items.length?<ul className={s.list}>{items.map(entry=><li key={entry.id}><button disabled={locked||detailLoading} aria-current={selected?.id===entry.id?'true':undefined} onClick={()=>void choose(entry.id)}><strong>{'title'in entry.draft?entry.draft.title:'日记'}</strong><span>{'occurredOn'in entry.draft&&entry.draft.occurredOn?entry.draft.occurredOn:'日期未提供'}</span></button></li>)}</ul>:!readError&&<div className={s.empty}><p>{syntheticView?'还没有测试日记。':'还没有可展示的个人日记。'}</p><p>{syntheticView?'可以新建一条虚构记录，体验保存与更正。':'只有明确标记为生活记录的内容会出现在这里。'}</p></div>}</section>
   <section className={s.panel} aria-label="日记详情">
    {detailLoading?<p role="status">正在读取日记及历史…</p>:editing?<><h2>{editingExisting?'编辑日记':'新建测试日记'}</h2><form onSubmit={submit}><fieldset disabled={locked||!auth||!syntheticView}><label>标题<input required maxLength={240} value={fields.title} onChange={event=>setFields({...fields,title:event.target.value})}/></label><label>日记正文<textarea required maxLength={16384} rows={12} value={fields.text} onChange={event=>setFields({...fields,text:event.target.value})}/></label><label>记录日期（可留空）<input type="date" value={fields.occurredOn} onChange={event=>setFields({...fields,occurredOn:event.target.value})}/></label><p className={s.hint}>未填写日期时保留为未知，不自动补成今天。</p><label className={s.ack}><input type="checkbox" checked={acknowledged} onChange={event=>setAcknowledged(event.target.checked)}/>我确认这里只包含虚构测试内容。</label><div className={s.actions}><button className={s.primary} type="submit" disabled={!acknowledged||!session}>确认保存</button><button type="button" onClick={()=>{setEditing(false);setFields(selected?entryFields(selected):emptyFields());}}>取消编辑</button></div></fieldset></form></>:selected?<><div className={s.detailHeading}><h2>{'title'in selected.draft?selected.draft.title:'日记'}</h2>{syntheticView&&<button disabled={locked} onClick={()=>{setEditing(true);setAcknowledged(false);setSavedMessage('');}}>编辑</button>}</div><p className={s.hint}>{'occurredOn'in selected.draft&&selected.draft.occurredOn?selected.draft.occurredOn:'日期未提供'} · 版本 {selected.revision}</p><p className={s.body}>{'text'in selected.draft?selected.draft.text:''}</p><details className={s.history}><summary>原文与编辑历史</summary><h3>最初的记录</h3><p className={s.body}>{originalText(selected)}</p><h3>已读取的版本</h3>{history.map(item=><details key={item.revision}><summary>版本 {item.revision}</summary><p className={s.body}>{'text'in item.draft?item.draft.text:''}</p></details>)}<button disabled={locked} onClick={()=>void choose(selected.id)}>重新读取完整历史</button></details></>:<div className={s.empty}><h2>选择一篇日记</h2><p>在左侧打开已有记录，查看正文、原文和编辑历史。</p></div>}
   </section>
  </div>}
 </main>;
}
export default JournalPage;
