import {object,validateFinance,type FinanceDraft} from '../platform/domain.ts';
import {financeAccounts} from '../platform/form-inputs.ts';

export type FinanceFields={kind:FinanceDraft['kind'];amount:string;occurredOn:string;category:string;fromAccountRef:string;toAccountRef:string;originalEntryId:string;notes:string};
export const financeLabels:Record<FinanceDraft['kind'],string>={expense:'支出',income:'收入',refund:'退款',transfer:'转账',repayment:'还款'};
const fieldKeys=['kind','amount','occurredOn','category','fromAccountRef','toAccountRef','originalEntryId','notes'];
const maximum=1_000_000_000_000n;

/** Parse exact decimal text into integer minor units; no floating point rounding. */
export function parseAmount(value:string):number{
 if(typeof value!=='string'||!/^(0|[1-9]\d{0,10})(\.\d{1,2})?$/.test(value))throw Error('金额需要正数，最多两位小数；请勿使用空格、逗号或科学计数法。');
 const [whole,fraction='']=value.split('.'),minor=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
 if(minor<1n||minor>maximum)throw Error('金额需在 0.01 至 10000000000.00 元之间。');
 return Number(minor);
}
export function formatAmount(minor:number):string{
 if(!Number.isSafeInteger(minor)||minor<1||minor>Number(maximum))throw Error('金额不是有效的整数分。');
 const value=BigInt(minor);return `${value/100n}.${String(value%100n).padStart(2,'0')}`;
}
export function emptyFinanceFields():FinanceFields{return{kind:'expense',amount:'',occurredOn:'',category:'',fromAccountRef:'',toAccountRef:'',originalEntryId:'',notes:''};}
export function fieldsFromDraft(draft:FinanceDraft):FinanceFields{return{kind:draft.kind,amount:formatAmount(draft.amountMinor),occurredOn:draft.occurredOn,category:draft.category??'',fromAccountRef:draft.fromAccountRef??'',toAccountRef:draft.toAccountRef??'',originalEntryId:draft.originalEntryId??'',notes:draft.notes};}
export function draftFromFields(fields:FinanceFields):FinanceDraft{
 const raw=object(fields,fieldKeys);
 if(fieldKeys.some(key=>typeof raw[key]!=='string'))throw Error('财务表单字段不完整。');
 if(fields.kind!=='refund'&&fields.originalEntryId!=='')throw Error('只有退款可以关联原支出。');
 const draft={kind:fields.kind,amountMinor:parseAmount(fields.amount),currency:'CNY' as const,occurredOn:fields.occurredOn,category:fields.category===''?null:fields.category,...financeAccounts(fields.kind,fields.fromAccountRef,fields.toAccountRef),originalEntryId:fields.originalEntryId||null,notes:fields.notes};
 validateFinance(draft);return draft;
}
