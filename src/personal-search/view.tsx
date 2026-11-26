'use client';
import type {ChangeEvent,FormEvent} from 'react';
import {personalMonthDayPageSize,type PersonalSearchDateRange} from '../personal-candidate/search-dates.ts';
import {taskStatusLabels} from '../personal-candidate/task-editor-state';
import {Button} from '../ui-review/ui/button';
import {Input} from '../ui-review/ui/input';
import {searchHref,searchTypeLabels,type SearchSelection,type SearchRow} from './model.ts';
import type {PersonalSearchData} from './client.ts';
import s from './styles.module.css';

export type SearchViewState={phase:'idle'}|{phase:'loading'}|{phase:'error';message:string}|{phase:'auth';message:string}|{phase:'ready';data:PersonalSearchData};
export type SearchDraft={query:string;range:PersonalSearchDateRange};
type SearchInteraction={
 prefix:string;
 standaloneHref:string;
 draft:SearchDraft;
 onChange:(draft:SearchDraft)=>void;
 onSubmit:(draft:SearchDraft)=>void;
 onSelect:(row:SearchRow)=>void;
 onBack:()=>void;
 onPage?:(page:number)=>void;
};
function readDraft(form:HTMLFormElement):SearchDraft{
 const data=new FormData(form);
 return {query:String(data.get('q')??''),range:{from:String(data.get('from')??''),to:String(data.get('to')??''),monthDay:String(data.get('monthDay')??'')}};
}
function Identity({row,compact=false}:{row:SearchRow;compact?:boolean}){
 return <div className={s.metadata}>
  <span>{searchTypeLabels[row.type]} · {row.dateLabel}：{row.date??'日期未知'}</span>
  {row.todoStatus==='cancelled'&&<span>{taskStatusLabels.cancelled}</span>}
  {!compact&&<><span>{row.sourceLabel} · 版本 {row.revision}</span><span>记录 ID：{row.id}</span><span>来源 ID：{row.sourceId}</span></>}
 </div>;
}
export function PersonalSearchView({query,range={},selection,state,onRetry,interaction}:{query:string;range?:PersonalSearchDateRange;selection:SearchSelection|null;state:SearchViewState;onRetry:()=>void;interaction?:SearchInteraction}){
 const prefix=interaction?.prefix??'personal-search';
 const draft=interaction?.draft??{query,range};
 const currentPage=state.phase==='ready'?state.data.page??1:1;
 const lastPage=state.phase==='ready'?Math.max(1,Math.ceil(state.data.coverage.matched/personalMonthDayPageSize)):1;
 const pageControl=(page:number,label:string)=>interaction
  ?<Button type="button" variant="outline" onClick={()=>interaction.onPage?.(page)}>{label}</Button>
  :<Button asChild variant="outline"><a href={searchHref(query,undefined,range,page)}>{label}</a></Button>;
 const onChange=interaction? (event:ChangeEvent<HTMLFormElement>)=>interaction.onChange(readDraft(event.currentTarget)):undefined;
 const onSubmit=interaction? (event:FormEvent<HTMLFormElement>)=>{event.preventDefault();interaction.onSubmit(readDraft(event.currentTarget));}:undefined;
 return <section className={s.page} aria-label="本人记录搜索">
  <form action="/personal/search" method="get" className={s.form} role="search" onChange={onChange} onSubmit={onSubmit}>
   <label htmlFor={prefix+'-query'}>搜索标题与正文</label>
   <Input id={prefix+'-query'} name="q" type={interaction?'search':undefined} maxLength={240} defaultValue={draft.query} placeholder="输入关键词，留空查看当前授权记录"/>
   <div className={s.controls}>
    <label htmlFor={prefix+'-from'}>开始日期<Input id={prefix+'-from'} name="from" type="date" defaultValue={draft.range.from}/></label>
    <label htmlFor={prefix+'-to'}>结束日期<Input id={prefix+'-to'} name="to" type="date" defaultValue={draft.range.to}/></label>
    <label htmlFor={prefix+'-month-day'}>同月同日<Input id={prefix+'-month-day'} name="monthDay" maxLength={5} pattern="[0-9]{2}-[0-9]{2}" placeholder="例如 02-29" defaultValue={draft.range.monthDay}/></label>
    <Button type="submit">搜索</Button>
   </div>
  </form>
  <p className={s.hint}>日期按北京时间，包含所选起止日。同月同日匹配不同年份的同一月日。使用日期筛选时，日期未知的记录不进入结果。</p>
  {interaction&&<a className={s.standalone} href={interaction.standaloneHref}>在独立页面打开</a>}
  {!interaction&&<p className={s.hint}>仅搜索当前已授权的 LifeOS 本人记录标题与正文；不包含历史版本、财务流水、需求、反馈、附件内容或未导入的外部资料。未启用语义搜索。</p>}
  {state.phase==='idle'?null:state.phase==='loading'?<p role="status">正在核对搜索结果…</p>:state.phase==='error'||state.phase==='auth'?<div role="alert"><p>{state.message}</p>{state.phase==='auth'?<a href="/login">重新登录</a>:<Button variant="outline" type="button" onClick={onRetry}>重新读取</Button>}</div>:<>
   <p className={s.hint}>{!interaction&&<>搜索词：{query.trim()||'（全部）'} · </>}已搜索 {state.data.coverage.scanned} 条当前授权记录，匹配 {state.data.coverage.matched} 条。</p>
   {!interaction&&<p className={s.hint}>覆盖类别：{state.data.coverage.types.map(type=>searchTypeLabels[type]).join('、')||'无'}。这是上述授权范围的完整当前快照，不代表所有个人资料。</p>}
   {selection?<section className={s.detail} aria-label="原业务记录只读详情">
    {interaction?<Button type="button" variant="outline" onClick={interaction.onBack}>返回搜索结果</Button>:<a href={searchHref(query,undefined,range,currentPage)}>返回搜索结果</a>}
    {state.data.detail?<><h2 tabIndex={interaction?-1:undefined}>{state.data.detail.title}</h2><p className={s.hint}>原业务记录 · 只读详情，已独立读取当前版本</p><Identity row={state.data.detail}/><p className={s.body}>{state.data.detail.text||'这条记录没有正文。'}</p></>:<p role="status">原记录已不可访问或不在当前授权范围。搜索上下文已保留。</p>}
   </section>:<>
    <h2 className={s.heading}>搜索结果</h2>
    {!state.data.coverage.scanned?<p role="status">当前授权范围内还没有记录。</p>:!state.data.rows.length?<p role="status">{state.data.coverage.matched?'当前页没有记录。':<>没有匹配“{query}”的记录。{range.from||range.to||range.monthDay?'试试其他关键词或调整日期。':'试试其他关键词。'}</>}</p>:<ol className={s.results}>{state.data.rows.map(row=><li key={row.id} data-search-result={interaction?row.id:undefined}>
     {interaction?<button type="button" className={s.title} onClick={()=>interaction.onSelect(row)}>{row.title}<span className={s.openLabel}>查看原记录</span></button>:<a className={s.title} href={searchHref(query,{type:row.type,id:row.id},range,currentPage)}>{row.title}<span className={s.openLabel}>查看原记录</span></a>}
     <Identity row={row} compact={!!interaction}/><p className={s.excerpt}>{row.excerpt||'这条记录没有正文。'}</p>
    </li>)}</ol>}
    {state.data.page!==undefined&&(lastPage>1||currentPage>1)&&<nav className={s.pagination} aria-label="搜索结果分页">
     {currentPage>1&&pageControl(Math.min(currentPage-1,lastPage),'上一页')}
     <span>第 {currentPage} 页，共 {lastPage} 页</span>
     {currentPage<lastPage&&pageControl(currentPage+1,'下一页')}
    </nav>}
   </>}
  </>}
 </section>;
}
