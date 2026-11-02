'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {SearchQuery,SearchHit,SearchDocument} from '../search-candidate/contracts';
import type {TimelineQuery,TimelineItem} from '../timeline-candidate/contracts';
import type {RecordWindowResponse} from '../platform/window-contracts';
import {recordTypes} from '../records-candidate/contracts';
import {recordLabels} from '../records-workbench/fields';
import {formatTimelineTime} from '../timeline-workbench/client';
import {RecordWindowClient,RecordWindowError,isWindowIdentityFailure,type RecordWindowMode,type WindowSourceResult} from './client';
import s from './styles.module.css';

type Form={q:string;from:string;to:string;type:string;axis:TimelineQuery['axis'];timeZone:string;includeSynthetic:boolean};
type Query=SearchQuery|TimelineQuery;
type Item=SearchHit|TimelineItem;
type Attempt={kind:'page';query:Query;cursor:string|null}|{kind:'source';item:Item};
const initial:Form={q:'',from:'',to:'',type:'',axis:'occurred',timeZone:'Asia/Shanghai',includeSynthetic:false};
const types=['todo','finance','inbox','journal',...recordTypes];
const labels:Record<string,string>={todo:'待办',finance:'财务草稿',inbox:'收件箱',journal:'日志',...recordLabels};
const roles:Record<string,string>={due:'期限',occurred:'发生日期',recorded:'录入时间',changed:'更正时间',scheduled:'计划开始'};

/** Mounted only inside the parent's authorized synthetic-review gate. */
export function RecordWindowWorkbench({mode,client:provided}:{mode:RecordWindowMode;client?:RecordWindowClient}){
 const local=useRef<RecordWindowClient|null>(null);if(!local.current)local.current=new RecordWindowClient();const client=provided??local.current;
 const [form,setForm]=useState<Form>(initial),[page,setPage]=useState<RecordWindowResponse|null>(null),[submitted,setSubmitted]=useState<Query|null>(null);
 const [selected,setSelected]=useState<Item|null>(null),[detail,setDetail]=useState<WindowSourceResult|null>(null),[attempt,setAttempt]=useState<Attempt|null>(null);
 const [loading,setLoading]=useState<'page'|'source'|'identity'|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[blocked,setBlocked]=useState(false);
 const mounted=useRef(false),version=useRef(0),controller=useRef<AbortController|null>(null),hasRead=useRef(false);
 function invalidate(){version.current++;controller.current?.abort();controller.current=null;setLoading(null);}
 function clear(){invalidate();setPage(null);setSubmitted(null);setSelected(null);setDetail(null);setAttempt(null);}
 function fail(cause:unknown){
  if(!mounted.current)return;
  if(isWindowIdentityFailure(cause)){clear();setBlocked(true);}
  setNotice('');setError(cause instanceof RecordWindowError?cause.message:'读取未完成，可重试同一页。');
 }
 useEffect(()=>{
  mounted.current=true;hasRead.current=false;clear();setForm(initial);setError('');setNotice('');setBlocked(false);
  const unsubscribe=client.onIdentityFailure(fail);
  const hide=()=>{clear();setError('');setNotice('页面已离开当前焦点，之前的内容和翻页位置已清除。请重新开始查询。');};
  const hidden=()=>{if(document.visibilityState==='hidden')hide();};
  const verify=async()=>{
   if(!hasRead.current)return;clear();setLoading('identity');const stamp=version.current,abort=new AbortController();controller.current=abort;
   try{await client.identity(abort.signal);if(mounted.current&&stamp===version.current)setBlocked(false);}
   catch(cause){if(mounted.current&&(stamp===version.current||isWindowIdentityFailure(cause)))fail(cause);}
   finally{if(mounted.current&&stamp===version.current){controller.current=null;setLoading(null);}}
  };
  window.addEventListener('blur',hide);window.addEventListener('focus',verify);document.addEventListener('visibilitychange',hidden);
  return()=>{mounted.current=false;version.current++;controller.current?.abort();controller.current=null;unsubscribe();window.removeEventListener('blur',hide);window.removeEventListener('focus',verify);document.removeEventListener('visibilitychange',hidden);};
 },[mode,client]);
 function change<K extends keyof Form>(key:K,value:Form[K]){clear();setForm(previous=>({...previous,[key]:value}));setError('');setNotice('');}
 function query():Query{return mode==='search'?{q:form.q,...(form.from?{from:form.from}:{}),...(form.to?{to:form.to}:{}),...(form.type?{type:form.type}:{}),includeSynthetic:form.includeSynthetic,limit:30}:{axis:form.axis,...(form.from?{from:form.from}:{}),...(form.to?{to:form.to}:{}),...(form.type?{type:form.type}:{}),timeZone:form.timeZone,includeSynthetic:form.includeSynthetic,limit:50};}
 async function run(next:Attempt){
  if(!form.includeSynthetic||blocked)return;invalidate();const stamp=version.current,abort=new AbortController();controller.current=abort;hasRead.current=true;
  setAttempt(next);setLoading(next.kind);setError('');setNotice('');
  if(next.kind==='page'){setSelected(null);setDetail(null);}else{setSelected(next.item);setDetail(null);}
  try{
   if(next.kind==='page'){const result=await client.page(mode,next.query,next.cursor,abort.signal);if(mounted.current&&stamp===version.current){setPage(result);setSubmitted(result.query);setAttempt(null);}}
   else{const result=await client.source(next.item,abort.signal);if(mounted.current&&stamp===version.current){setDetail(result);setAttempt(null);}}
  }catch(cause){if(mounted.current&&(stamp===version.current||isWindowIdentityFailure(cause)))fail(cause);}
  finally{if(mounted.current&&stamp===version.current){controller.current=null;setLoading(null);}}
 }
 function submit(event:FormEvent){event.preventDefault();if(!form.includeSynthetic||blocked)return;clear();void run({kind:'page',query:query(),cursor:null});}
 function cancel(){invalidate();setError('');setNotice('已取消读取，可重试同一页。');}
 function back(){invalidate();setSelected(null);setDetail(null);setAttempt(null);setError('');setNotice('已返回同一查询的当前页。');}
 return <div className={s.page}>
  <header className={s.header}><div><h1>{mode==='search'?'统一搜索':'记录时间线'}</h1><p>逐页查找记录，回看完整来源与修订。</p></div><span className={s.badge}>合成评审</span></header>
  <p className={s.notice}>当前仅查询本账号获准查看的虚构评审记录。尚未读取时不展示任何默认记录。</p>
  <section className={s.panel} aria-label="窗口查询条件"><form className={s.form} onSubmit={submit}>
   {mode==='search'&&<label>关键词或完整来源 ID<input aria-label="窗口关键词" type="search" maxLength={200} value={form.q} onChange={event=>change('q',event.target.value)} placeholder="标题、正文、记录或来源标识"/></label>}
   {mode==='timeline'&&<div className={s.filters}><label>时间依据<select aria-label="窗口时间依据" value={form.axis} onChange={event=>change('axis',event.target.value as Form['axis'])}><option value="occurred">发生日期 / 待办期限</option><option value="recorded">录入时间</option><option value="changed">更正时间</option></select></label><label>显示时区<input aria-label="窗口时区" value={form.timeZone} maxLength={64} onChange={event=>change('timeZone',event.target.value)}/></label></div>}
   <div className={s.filters}><label>日期从<input aria-label="窗口开始日期" type="date" value={form.from} onChange={event=>change('from',event.target.value)}/></label><label>日期至<input aria-label="窗口结束日期" type="date" value={form.to} onChange={event=>change('to',event.target.value)}/></label><label>类型<select aria-label="窗口类型" value={form.type} onChange={event=>change('type',event.target.value)}><option value="">全部获准类型</option>{types.map(type=><option key={type} value={type}>{labels[type]}</option>)}</select></label></div>
   <label className={s.confirm}><input aria-label="窗口合成评审确认" type="checkbox" checked={form.includeSynthetic} onChange={event=>change('includeSynthetic',event.target.checked)}/><span>本次仅查询明确授权的虚构评审数据。</span></label>
   <div className={s.actions}><button type="submit" className={s.primary} disabled={!form.includeSynthetic||!!loading||blocked}>开始查询</button><button type="button" onClick={()=>{clear();setForm(initial);setError('');setNotice('');}}>清空</button>{loading&&<button type="button" onClick={cancel}>取消读取</button>}</div>
  </form></section>
  {error&&<p className={s.error} role="alert">{error}{blocked&&' 请恢复原账号或重新加载页面后再查询。'}</p>}
  {notice&&<p className={s.notice} role="status">{notice}</p>}
  {loading&&<p role="status">{loading==='source'?'正在核对来源与修订…':loading==='identity'?'正在重新核对账号…':'正在核对账号并读取当前窗口…'}</p>}
  {attempt&&!loading&&!blocked&&form.includeSynthetic&&<button type="button" className={s.primary} onClick={()=>void run(attempt)}>{attempt.kind==='page'?'重试同一页':'重试同一来源'}</button>}
  {selected?<section className={s.panel} aria-label="窗口来源详情"><button type="button" onClick={back}>返回同一查询和当前页</button><h2>{selected.title}</h2><p>所选修订 {selected.revision} · {labels[selected.type]??selected.type}</p>{detail&&<>
   {detail.currentChanged&&<p className={s.notice}>来源已有新修订，当前为修订 {detail.source.current.revision}。下方分别保留所选修订与当前内容。</p>}
   {detail.selectedOutsideHistory&&<p className={s.notice}>所选修订 {selected.revision} 不在本次返回的历史范围内。当前内容与首次输入不能替代该修订全文。</p>}
   {detail.selected&&<Document document={detail.selected} label="所选修订内容"/>}<Document document={detail.source.current} label="当前内容"/>
   <details className={s.help}><summary>首次输入与历史修订</summary><Document document={detail.source.original} label="首次原始输入"/><p>{detail.source.historyTruncated?`本次只返回最近 ${detail.source.historyLimit} 个修订。`:`本次返回 ${detail.source.history.length} 个修订。`}</p>{detail.source.history.map(doc=><details key={doc.revision}><summary>历史修订 {doc.revision} · {doc.title}</summary><Document document={doc} label="历史内容"/></details>)}</details>
   <details className={s.help}><summary>来源标识</summary><dl><dt>记录 ID</dt><dd>{selected.id}</dd><dt>来源 ID</dt><dd>{selected.sourceId}</dd></dl></details>
  </>}</section>:page&&submitted?<section className={s.panel} aria-label="当前窗口结果"><h2>当前页</h2><p role="status">本页扫描 {page.page.scanned} 条，返回 {page.page.returned} 条；符合条件的总量未知。</p><p>核对时刻：{page.observedAt}</p>
   {!page.items.length&&<p className={s.empty}>{page.page.hasMore?'本页扫描范围内没有匹配项，仍可读取下一页。':'本页没有匹配项，当前扫描已到末尾。'}</p>}
   <ul className={s.list}>{page.items.map(item=><li key={'eventKey'in item?item.eventKey:item.kind+':'+item.id}><button type="button" disabled={!!loading||!!attempt} onClick={()=>void run({kind:'source',item})}><strong>{item.title}</strong><span>{labels[item.type]??item.type} · 所选修订 {item.revision}</span>{'eventKey'in item?<><span>{roles[item.timeRole]}：{formatTimelineTime(item,(submitted as TimelineQuery).timeZone)}</span>{item.timeRole==='due'&&<span>此日期是待办期限，不表示已完成。</span>}<span className={s.body}>{item.summary||'没有补充摘要。'}</span></>:<><span>原日期：{item.date??'未知'}</span><span className={s.body}>{item.snippet||'没有补充摘要。'}</span></>}<span className={s.readMore}>阅读完整来源与更正 →</span></button></li>)}</ul>
   <div className={s.actions}>{page.page.hasMore?<button type="button" className={s.primary} disabled={!!loading||!!attempt} onClick={()=>void run({kind:'page',query:submitted,cursor:page.page.nextCursor})}>读取下一页</button>:<p>已到当前扫描末尾。</p>}<button type="button" disabled={!!loading} onClick={()=>{clear();void run({kind:'page',query:submitted,cursor:null});}}>按同一条件重新开始</button></div>
  </section>:!loading&&!error&&<p className={s.empty}>确认评审范围并提交查询后，才会读取第一页。</p>}
  <details className={`${s.panel} ${s.readingHelp}`} aria-label="窗口读取说明"><summary>如何理解逐页结果</summary><p>每页最多扫描 {mode==='search'?30:50} 条原始记录，再在本页窗口内按关键词、日期和类型筛选。返回 0 条也可能还有下一页；这里没有全局匹配总数。</p><p>窗口按记录创建时间倒序推进；更正轴按历史写入时间推进。发生日期和期限只是筛选与展示依据，结果并非按全局发生日期排序。此窗口不包含日历。</p><details className={s.help}><summary>翻页、时区与修订的限制</summary><p>各页分别读取，不构成共享快照。翻页期间的更正可能改变匹配；回填较早创建时间的插入可能遗漏。要查看更新记录，请按同一条件重新开始。</p><p>时间线默认使用北京时间（Asia/Shanghai）。仅日期与未知日期不虚构时刻；填日期范围后不包含未知日期。录入、更正、发生、期限具有不同含义。</p><p>当前仅保留一页。取消或失败后可重试刚才尝试的页；离开焦点、改动条件或撤回确认会清除内容与翻页位置。来源分别展示所选修订、当前内容、首次输入和本次可读历史，不用新修订冒充旧内容。</p></details></details>
 </div>;
}
function Document({document,label}:{document:SearchDocument;label:string}){return <section className={s.document}><h3>{label} · 修订 {document.revision}</h3><p><strong>{document.title}</strong></p><dl>{document.fields.map((field,index)=><div key={index}><dt>{field.label}</dt><dd>{field.value||'未填写'}</dd></div>)}</dl></section>;}
