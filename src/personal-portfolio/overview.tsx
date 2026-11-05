'use client';
import {useId,useState} from 'react';
import {formatPortfolioAmount,portfolioKinds,type PortfolioKind} from './model';
import {portfolioAmount,portfolioAsOf,portfolioKindLabels,portfolioSummary,summarizePortfolio,uniquePortfolioRecords,type PortfolioRecord} from './projection';
import s from './portfolio.module.css';

export function PortfolioOverview({records,onOpenRecord,onCreateKind}:{records:readonly PortfolioRecord[];onOpenRecord:(record:PortfolioRecord)=>void;onCreateKind?:(kind:PortfolioKind)=>void}){
 const [kind,setKind]=useState<PortfolioKind>('account'),id=useId(),allRows=uniquePortfolioRecords(records),rows=allRows.filter(row=>row.fields.personal.portfolioKind===kind),summary=summarizePortfolio(rows);
 return <section aria-label="账户、资产与投资" className={s.overview}>
  <div className={s.heading}><div role="tablist" aria-label="持有类别" className={s.tabs}>{portfolioKinds.map(value=><button data-slot="personal-record-action" key={value} id={id+value} type="button" role="tab" aria-selected={kind===value} aria-controls={id+'panel'} tabIndex={kind===value?0:-1} onClick={()=>setKind(value)} onKeyDown={event=>{const direction=event.key==='ArrowRight'?1:event.key==='ArrowLeft'?-1:0;if(direction){event.preventDefault();const next=portfolioKinds[(portfolioKinds.indexOf(value)+direction+portfolioKinds.length)%portfolioKinds.length];setKind(next);document.getElementById(id+next)?.focus();}else if(event.key==='Home'||event.key==='End'){event.preventDefault();const next=event.key==='Home'?'account':'investment';setKind(next);document.getElementById(id+next)?.focus();}}}>{portfolioKindLabels[value]} <span>{allRows.filter(row=>row.fields.personal.portfolioKind===value).length}</span></button>)}</div>{onCreateKind&&<button data-slot="personal-record-action" type="button" className={s.create} onClick={()=>onCreateKind(kind)}>添加{portfolioKindLabels[kind]}</button>}</div>
  <div role="tabpanel" id={id+'panel'} aria-labelledby={id+kind} tabIndex={0} className={s.panel}>
   {!rows.length?<p className={s.empty}>暂无{portfolioKindLabels[kind]}。添加后可查看手工{kind==='account'?'余额':'估值'}、日期与待补资料。</p>:<>
    <dl className={s.totals}>{summary.groups.map(group=><div key={group.currency}><dt>{group.currency} · 已知{kind==='account'?'余额':'估值'}合计</dt><dd>{group.knownCount?formatPortfolioAmount(group.knownTotalMinor,group.currency):'未知'}</dd><small>{group.knownCount} 条有金额{group.unknownCount?` · ${group.unknownCount} 条金额未知`:''}{group.earliestOn?` · ${group.earliestOn===group.latestOn?group.earliestOn:group.earliestOn+' 至 '+group.latestOn}`:''}</small></div>)}</dl>
    <ul className={s.list}>{rows.map(record=>{const p=record.fields.personal,amount=portfolioAmount(p),date=portfolioAsOf(p),summary=portfolioSummary(p);return <li key={record.id}><button data-slot="personal-record-action" type="button" className={s.record} onClick={()=>onOpenRecord(record)}><span className={s.recordTitle}><strong>{record.fields.title}</strong><span>{summary[0]}{p.portfolioKind==='investment'?` · ${p.quantity===null?'数量未知':'持有 '+p.quantity}`:''}</span></span><span className={s.recordAmount}><strong>{amount===null?(kind==='account'?'余额未知':'估值未知'):p.currency+' '+formatPortfolioAmount(amount,p.currency)}</strong><span>{date?'截至 '+date:'日期未知'}</span></span></button>{p.portfolioKind==='investment'&&<p className={s.cost}>{p.costMinor===null?'成本未知':'手工成本 '+p.currency+' '+formatPortfolioAmount(p.costMinor,p.currency)}</p>}</li>;})}</ul>
   </>}
   <p className={s.hint}>仅汇总当前已读记录，同一记录只计一次。不同币种分别列示；账户、资产、投资可能重叠，分别查看。余额和估值均按手工记录日期保留。</p>
  </div>
 </section>;
}
