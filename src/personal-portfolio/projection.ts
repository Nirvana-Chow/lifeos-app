import type {PersonalPortfolio,PortfolioCurrency,PortfolioKind,PortfolioPersonalFields} from './model.ts';
import {formatPortfolioAmount} from './model.ts';
/** Only root-authorized, normalized PersonalService rows may enter this projection. */
export type PortfolioRecord={id:string;sourceId:string;revision:number;fields:PortfolioPersonalFields};
export type PortfolioGroup={portfolioKind:PortfolioKind;currency:PortfolioCurrency;count:number;knownCount:number;unknownCount:number;knownTotalMinor:string;earliestOn:string|null;latestOn:string|null};
export const portfolioKindLabels:Record<PortfolioKind,string>={account:'账户',asset:'资产',investment:'投资'};
export const accountTypeLabels={checking:'活期账户',savings:'储蓄账户',cash:'现金',wallet:'电子钱包',credit:'信用账户',brokerage:'证券账户',other:'其他账户'};
export const assetTypeLabels={property:'不动产',vehicle:'车辆',collectible:'收藏品',equipment:'设备',other:'其他资产'};
export function portfolioAmount(p:PersonalPortfolio):string|null{return p.portfolioKind==='account'?p.balanceMinor:p.valuationMinor;}
export function portfolioAsOf(p:PersonalPortfolio):string|null{return p.portfolioKind==='asset'?p.valuationOn:p.asOf;}
/** Repeated list pages/revisions must not multiply one saved object's contribution. */
export function uniquePortfolioRecords(records:readonly PortfolioRecord[]):PortfolioRecord[]{
 const rows=new Map<string,PortfolioRecord>();
 for(const row of records){const previous=rows.get(row.id);if(!previous||row.revision>previous.revision)rows.set(row.id,row);}
 return [...rows.values()];
}
/** No cross-currency or cross-kind grand total: account snapshots may include linked holdings. */
export function summarizePortfolio(records:readonly PortfolioRecord[]):{recordCount:number;groups:PortfolioGroup[]}{
 const rows=uniquePortfolioRecords(records),groups=new Map<string,PortfolioGroup>();
 for(const row of rows){const p=row.fields.personal,key=p.portfolioKind+':'+p.currency;
  let group=groups.get(key);if(!group){group={portfolioKind:p.portfolioKind,currency:p.currency,count:0,knownCount:0,unknownCount:0,knownTotalMinor:'0',earliestOn:null,latestOn:null};groups.set(key,group);}
  group.count++;const amount=portfolioAmount(p),date=portfolioAsOf(p);
  if(amount===null){group.unknownCount++;continue;}
  group.knownCount++;group.knownTotalMinor=(BigInt(group.knownTotalMinor)+BigInt(amount)).toString();
  if(date!==null){if(group.earliestOn===null||date<group.earliestOn)group.earliestOn=date;if(group.latestOn===null||date>group.latestOn)group.latestOn=date;}
 }
 return{recordCount:rows.length,groups:[...groups.values()].sort((a,b)=>['account','asset','investment'].indexOf(a.portfolioKind)-['account','asset','investment'].indexOf(b.portfolioKind)||a.currency.localeCompare(b.currency))};
}
export function portfolioSummary(p:PersonalPortfolio):string[]{
 const amount=portfolioAmount(p),date=portfolioAsOf(p),type=p.portfolioKind==='account'?accountTypeLabels[p.accountType]:p.portfolioKind==='asset'?assetTypeLabels[p.assetType]:p.symbol??p.name??'手工持仓';
 return[type,amount===null?(p.portfolioKind==='account'?'余额未知':'估值未知'):`${p.currency} ${formatPortfolioAmount(amount,p.currency)}`,date?`截至 ${date}`:'日期未知',...(p.portfolioKind==='investment'?[p.quantity===null?'数量未知':`持有 ${p.quantity}`,p.costMinor===null?'成本未知':`手工成本 ${p.currency} ${formatPortfolioAmount(p.costMinor,p.currency)}`]:[])];
}
