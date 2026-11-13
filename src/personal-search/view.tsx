'use client';
import {Button} from '../ui-review/ui/button';
import {Input} from '../ui-review/ui/input';
import {searchHref,searchTypeLabels,type SearchSelection,type SearchRow} from './model.ts';
import type {PersonalSearchData} from './client.ts';
import s from './styles.module.css';
export type SearchViewState={phase:'loading'}|{phase:'error';message:string}|{phase:'auth';message:string}|{phase:'ready';data:PersonalSearchData};
function Identity({row}:{row:SearchRow}){return <div className={s.metadata}><span>{searchTypeLabels[row.type]} · {row.dateLabel}：{row.date??'日期未知'}</span><span>{row.sourceLabel} · 版本 {row.revision}</span><span>记录 ID：{row.id}</span><span>来源 ID：{row.sourceId}</span></div>;}
export function PersonalSearchView({query,selection,state,onRetry}:{query:string;selection:SearchSelection|null;state:SearchViewState;onRetry:()=>void}){
 return <section className={s.page} aria-label="本人记录搜索">
  <form action="/personal/search" method="get" className={s.form} role="search"><label htmlFor="personal-search-query">搜索标题与正文</label><div className={s.controls}><Input id="personal-search-query" name="q" maxLength={240} defaultValue={query} placeholder="输入关键词，留空查看当前授权记录"/><Button type="submit">搜索</Button></div></form>
  <p className={s.hint}>仅搜索当前已授权的 LifeOS 本人记录标题与正文；不包含历史版本、财务流水、需求、反馈、附件内容或未导入的外部资料。未启用语义搜索。</p>
  {state.phase==='loading'?<p role="status">正在读取并核对本人搜索范围…</p>:state.phase==='error'||state.phase==='auth'?<div role="alert"><p>{state.message}</p>{state.phase==='auth'?<a href="/login">重新登录</a>:<Button variant="outline" type="button" onClick={onRetry}>重新读取</Button>}</div>:<>
   <p className={s.hint}>搜索词：{query.trim()||'（全部）'} · 已搜索 {state.data.coverage.scanned} 条当前授权记录，匹配 {state.data.coverage.matched} 条。</p>
   <p className={s.hint}>覆盖类别：{state.data.coverage.types.map(type=>searchTypeLabels[type]).join('、')||'无'}。这是上述授权范围的完整当前快照，不代表所有个人资料。</p>
   {selection?<section className={s.detail} aria-label="原业务记录只读详情"><a href={searchHref(query)}>返回搜索结果</a>{state.data.detail?<><h2>{state.data.detail.title}</h2><p className={s.hint}>原业务记录 · 只读详情，已独立读取当前版本</p><Identity row={state.data.detail}/><p className={s.body}>{state.data.detail.text||'这条记录没有正文。'}</p></>:<p role="status">原记录已不可访问或不在当前授权范围。搜索上下文已保留。</p>}</section>:<>
    <h2 className={s.heading}>搜索结果</h2>
    {!state.data.coverage.scanned?<p role="status">当前授权范围内还没有记录。</p>:!state.data.rows.length?<p role="status">没有匹配“{query}”的记录。试试其他关键词。</p>:<ol className={s.results}>{state.data.rows.map(row=><li key={row.id}><a className={s.title} href={searchHref(query,{type:row.type,id:row.id})}>{row.title}<span className={s.openLabel}>查看原记录</span></a><Identity row={row}/><p className={s.excerpt}>{row.excerpt||'这条记录没有正文。'}</p></li>)}</ol>}
   </>}
  </>}
 </section>;
}
