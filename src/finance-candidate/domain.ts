import {PlatformError} from '../platform/domain.ts';
import {validateCalendarDate} from '../calendar-candidate/domain.ts';
import type {FinanceComparisonQuery,FinanceKind} from './contracts.ts';
export const financeKinds=['income','expense','refund','transfer','repayment'] as const satisfies readonly FinanceKind[];
const bad=():never=>{throw new PlatformError(400,'INVALID_FINANCE_COMPARISON_QUERY','请核对两个日期区间、隔离范围与来源条数。');};
export function parseFinanceComparisonQuery(params:URLSearchParams):FinanceComparisonQuery{
 try{
  const known=['aFrom','aTo','bFrom','bTo','includeSynthetic','limit'],seen=new Set<string>();
  for(const[key]of params){if(!known.includes(key)||seen.has(key))bad();seen.add(key);}
  const aFrom=validateCalendarDate(params.get('aFrom')),aTo=validateCalendarDate(params.get('aTo')),bFrom=validateCalendarDate(params.get('bFrom')),bTo=validateCalendarDate(params.get('bTo')),include=params.get('includeSynthetic'),raw=params.get('limit');
  if(aFrom>aTo||bFrom>bTo||include!==null&&!['true','false'].includes(include)||raw!==null&&!/^[1-9]\d?$/.test(raw))bad();const limit=raw===null?20:Number(raw);if(limit>50)bad();
  return{aFrom,aTo,bFrom,bTo,includeSynthetic:include==='true',limit};
 }catch{return bad();}
}
export function financeCalendarDays(from:string,to:string):number{
 validateCalendarDate(from);validateCalendarDate(to);if(from>to)bad();return(Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000+1;
}
