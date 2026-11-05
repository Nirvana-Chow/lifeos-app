'use client';
import {useEffect,useId,useRef,useState} from 'react';
import type {PublicEntry} from '../platform/contracts';
import {RelationFields} from '../personal-candidate/relation-fields';
import {accountTypes,assetTypes,formatPortfolioAmount,portfolioAmountMinor,portfolioCurrencies,type PersonalPortfolio,type PortfolioCurrency,type PortfolioReference} from './model';
import {accountTypeLabels,assetTypeLabels,portfolioKindLabels} from './projection';
import s from './portfolio.module.css';

function MoneyInput({label,value,currency,onChange,negative=false}:{label:string;value:string|null;currency:PortfolioCurrency;onChange:(value:string|null)=>void;negative?:boolean}){
 const [text,setText]=useState(value===null?'':formatPortfolioAmount(value,currency,false)),[error,setError]=useState(''),committed=useRef(value),input=useRef<HTMLInputElement>(null),id=useId();
 useEffect(()=>{if(value!==committed.current){committed.current=value;setText(value===null?'':formatPortfolioAmount(value,currency,false));setError('');input.current?.setCustomValidity('');}},[value,currency]);
 return <label>{label}（{currency}）<input ref={input} aria-label={`${label}（${currency}）`} name={label} type="text" inputMode={negative?'text':'decimal'} autoComplete="off" value={text} aria-invalid={error?true:undefined} aria-describedby={error?id:undefined} onChange={event=>{
  const raw=event.target.value;setText(raw);
  try{const amount=raw===''?null:portfolioAmountMinor(raw,currency);if(!negative&&amount?.startsWith('-'))throw Error('请填写非负金额。');committed.current=amount;onChange(amount);setError('');event.currentTarget.setCustomValidity('');}
  catch(error){const message=(error as Error).message;setError(message);event.currentTarget.setCustomValidity(message);}
 }}/>{error&&<span className={s.error} id={id}>{error}</span>}</label>;
}
function PortfolioReferenceInput({label,kind,value,onChange,options}:{label:string;kind:'account'|'asset';value:PortfolioReference|null;onChange:(value:PortfolioReference|null)=>void;options:Record<string,PublicEntry[]>}){
 const rows=(options.portfolio??[]).filter(entry=>{const p=(entry.draft as {personal?:{type?:string;portfolioKind?:string}}).personal;return p?.type==='portfolio'&&p.portfolioKind===kind;}),current=value?JSON.stringify(value):'';
 const pins=rows.map(entry=>({entry,pin:{id:entry.id,sourceId:entry.source.id,revision:entry.revision}}));
 return <label>{label}<select aria-label={label} value={current} onChange={event=>onChange(event.target.value?JSON.parse(event.target.value):null)}><option value="">不关联</option>{value&&!pins.some(row=>JSON.stringify(row.pin)===current)&&<option value={current}>保留原引用 · 版本 {value.revision}（请核对目标）</option>}{pins.map(({entry,pin})=><option key={entry.id} value={JSON.stringify(pin)}>{'title'in entry.draft?entry.draft.title:'记录'} · 版本 {entry.revision}</option>)}</select></label>;
}
/** Title/text/occurredOn stay in the root editor. This component never persists or infers financial values. */
export function PortfolioFields({value,onChange,options,disabled=false}:{value:PersonalPortfolio;onChange:(value:PersonalPortfolio)=>void;options:Record<string,PublicEntry[]>;disabled?:boolean}){
 const p=value,change=(patch:object)=>onChange({...p,...patch} as PersonalPortfolio);
 return <fieldset className={s.fields} disabled={disabled}>
  <legend>{portfolioKindLabels[p.portfolioKind]}资料</legend>
  <div className={s.grid}>
   {p.portfolioKind==='account'&&<label>账户类型<select aria-label="账户类型" value={p.accountType} onChange={event=>change({accountType:event.target.value})}>{accountTypes.map(type=><option key={type} value={type}>{accountTypeLabels[type]}</option>)}</select></label>}
   {p.portfolioKind==='asset'&&<label>资产种类<select aria-label="资产种类" value={p.assetType} onChange={event=>change({assetType:event.target.value})}>{assetTypes.map(type=><option key={type} value={type}>{assetTypeLabels[type]}</option>)}</select></label>}
   <label>币种<select aria-label="币种" value={p.currency} onChange={event=>{const currency=event.target.value as PortfolioCurrency;if(currency===p.currency)return;change({currency,...(p.portfolioKind==='account'?{balanceMinor:null}:p.portfolioKind==='asset'?{valuationMinor:null}:{costMinor:null,valuationMinor:null})});}}>{Object.keys(portfolioCurrencies).map(currency=><option key={currency} value={currency}>{currency}</option>)}</select></label>
  </div>
  {p.portfolioKind==='investment'&&<div className={s.grid}>
   <label>投资代码（可留空）<input maxLength={80} value={p.symbol??''} onChange={event=>change({symbol:event.target.value||null})}/></label>
   <label>投资名称（可留空）<input maxLength={240} value={p.name??''} onChange={event=>change({name:event.target.value||null})}/></label>
   <label>持有数量（可留空）<input inputMode="decimal" maxLength={80} pattern="[0-9]+([.][0-9]+)?" value={p.quantity??''} onChange={event=>change({quantity:event.target.value||null})}/></label>
   <MoneyInput key={'cost:'+p.currency} label="手工成本" value={p.costMinor} currency={p.currency} onChange={costMinor=>change({costMinor})}/>
  </div>}
  <div className={s.grid}>
   {p.portfolioKind==='account'?<MoneyInput key={'balance:'+p.currency} label="手工余额" value={p.balanceMinor} currency={p.currency} onChange={balanceMinor=>change({balanceMinor})} negative/>:<MoneyInput key={'valuation:'+p.currency} label="手工估值" value={p.valuationMinor} currency={p.currency} onChange={valuationMinor=>change({valuationMinor})}/>}
   <label>{p.portfolioKind==='asset'?'估值日期':'截至日期'}<input type="date" required={p.portfolioKind==='account'?p.balanceMinor!==null:p.portfolioKind==='asset'?p.valuationMinor!==null:p.valuationMinor!==null||p.costMinor!==null} value={(p.portfolioKind==='asset'?p.valuationOn:p.asOf)??''} onChange={event=>change({[p.portfolioKind==='asset'?'valuationOn':'asOf']:event.target.value||null})}/></label>
  </div>
  <p className={s.hint}>金额留空表示未知；填写金额时需注明日期。切换币种会清空金额，请按新币种重填。{p.portfolioKind==='account'?'信用账户可用负余额表示欠款。':'以上为本人手工估值。'}</p>
  <details><summary>关联与归属（可留空）</summary><div className={s.grid}>
   {p.portfolioKind!=='account'&&<PortfolioReferenceInput label="所属账户" kind="account" value={p.account} options={options} onChange={account=>change({account})}/>}
   {p.portfolioKind==='investment'&&<PortfolioReferenceInput label="关联资产" kind="asset" value={p.asset} options={options} onChange={asset=>change({asset})}/>}
   <RelationFields value={p.links} onChange={links=>change({links})} options={options}/>
  </div></details>
 </fieldset>;
}
