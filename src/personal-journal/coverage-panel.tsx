'use client';
import {useMemo,useState,type MouseEvent} from 'react';
import {Button} from '../ui-review/ui/button';
import {validateCalendarDate} from '../calendar-candidate/domain';
import {journalMonthDays,projectJournalPeriod,shiftJournalMonth,type JournalPeriod} from './journal-period';
import type {JournalHistory,JournalHistoryRow} from './history';
import s from './coverage.module.css';

type OpenOriginal=(event:MouseEvent<HTMLAnchorElement>,id:string)=>void;
const labels:Record<JournalPeriod,string>={day:'日',week:'周',month:'月',quarter:'季度',year:'年'};
const weekdays=['一','二','三','四','五','六','日'];
function JournalReferences({rows,onOpen}:{rows:JournalHistoryRow[];onOpen:OpenOriginal}){
 const [limit,setLimit]=useState(20),shown=rows.slice(0,limit);
 return <>
  <p className={s.meta}>显示 {shown.length} / {rows.length} 条日记</p>
  {rows.length>0&&<ul className={s.records}>{shown.map(row=><li key={row.id}>
   <div className={s.recordHeading}><span className={s.date}>{row.occurredOn??'日期未知'}</span><a href={row.href} onClick={event=>onOpen(event,row.id)}>{row.title}</a><span className={s.meta}>版本 {row.revision}</span></div>
   <p className={s.excerpt}>{row.text.replace(/\s+/g,' ').slice(0,160)}</p>
   <details><summary>来源引用</summary><p className={s.identifier}>记录 ID：{row.id}<br/>来源 ID：{row.sourceId}<br/>读取版本：{row.revision}</p></details>
  </li>)}</ul>}
  {shown.length<rows.length&&<Button type="button" variant="outline" onClick={()=>setLimit(previous=>previous+20)}>显示更多日记</Button>}
 </>;
}

/** Read-only views of the same complete, owner-verified snapshot as journal history. */
export function JournalCoveragePanel({history,onOpen}:{history:JournalHistory;onOpen:OpenOriginal}){
 const [date,setDate]=useState(history.today),[period,setPeriod]=useState<JournalPeriod>('month'),[inputError,setInputError]=useState('');
 const month=useMemo(()=>journalMonthDays(date,history.rows),[date,history.rows]);
 const selection=useMemo(()=>projectJournalPeriod(history,date,period),[history,date,period]);
 const previous=shiftJournalMonth(date,-1),next=shiftJournalMonth(date,1),coverage=history.coverage;
 function select(value:string,grain=period){setDate(value);setPeriod(grain);setInputError('');}
 function enterDate(value:string){try{validateCalendarDate(value);select(value);}catch{setInputError('请选择有效的参考日期。');}}
 return <section className={s.panel} aria-label="日记日历与周期资料">
  <div className={s.heading}><div><h2>日记日历</h2><p className={s.meta}>北京时间 {history.today}</p></div><Button type="button" variant="outline" onClick={()=>select(history.today,'day')}>回到今天</Button></div>
  <p className={s.meta}>当前已接入 {coverage.count} 条日记：{coverage.dated} 条有记录日期，{coverage.undated} 条日期未知。{coverage.from&&coverage.to?<>已知日期范围 {coverage.from} 至 {coverage.to}。</>:'尚无已知日期范围。'}</p>
  <div className={s.layout}>
   <div className={s.month}>
    <div className={s.monthHeading}><Button type="button" variant="ghost" disabled={!previous} onClick={()=>previous&&select(previous,'month')}>上个月</Button><h3 aria-live="polite">{month.month}</h3><Button type="button" variant="ghost" disabled={!next} onClick={()=>next&&select(next,'month')}>下个月</Button></div>
    <div className={s.calendarWrap}><table className={s.calendar} aria-label={month.month+' 日记月历'}><thead><tr>{weekdays.map(day=><th key={day} scope="col">周{day}</th>)}</tr></thead><tbody>{Array.from({length:month.cells.length/7},(_,week)=><tr key={week}>{month.cells.slice(week*7,week*7+7).map((cell,day)=><td key={day}>{cell&&<button type="button" aria-label={cell.date+'，'+cell.count+' 条日记'} aria-pressed={cell.date===date} aria-current={cell.date===history.today?'date':undefined} className={s.day} onClick={()=>select(cell.date,'day')}><span>{Number(cell.date.slice(8))}</span>{cell.count>0&&<small>{cell.count} 条</small>}</button>}</td>)}</tr>)}</tbody></table></div>
    <p className={s.meta}>周一开始；数字标记已保存的日记条数。空白日期仅表示当前库内没有记录。</p>
   </div>
   <div className={s.period}>
    <h3>周期资料</h3>
    <div className={s.controls}><label>参考日期<input aria-label="参考日期" type="date" min="0001-01-01" max="9999-12-31" value={date} onChange={event=>enterDate(event.target.value)} aria-invalid={!!inputError}/></label><label>资料周期<select aria-label="资料周期" value={period} onChange={event=>setPeriod(event.target.value as JournalPeriod)}>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label></div>
    {inputError&&<p role="alert">{inputError}</p>}
    <p className={s.range}>{selection.range.from} 至 {selection.range.to}（含首尾日）</p>
    <p aria-live="polite">已保存 {selection.rows.length} 条，分布在 {selection.recordedDays} 个记录日期。</p>
    {!selection.rows.length&&<p>当前库内没有这个周期的有日期日记。</p>}
    <JournalReferences key={period+date} rows={selection.rows} onOpen={onOpen}/>
   </div>
  </div>
  <section className={s.undated} aria-label="日期未知的日记"><h3>日期未知的日记</h3><p className={s.meta}>以下 {selection.undated.length} 条未分配到任何周期；不使用创建或更正时间补造记录日期。</p><JournalReferences rows={selection.undated} onOpen={onOpen}/></section>
  <p className={s.meta}>以上只覆盖已接入当前库的日记，历史完整性未知；不能据此推断某天没有发生事情。当前展示资料与原文引用，尚未生成每日、周、月、季度或年度总结。</p>
 </section>;
}
