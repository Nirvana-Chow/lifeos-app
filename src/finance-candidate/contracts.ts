import type {FinanceDraft} from '../platform/domain.ts';
export type FinanceKind=FinanceDraft['kind'];
/** Civil occurredOn dates only: no timezone or createdAt fallback. */
export type FinanceComparisonQuery={aFrom:string;aTo:string;bFrom:string;bTo:string;includeSynthetic:boolean;limit:number};
export type FinanceComparisonItem={id:string;kind:'finance';type:'finance';transactionKind:FinanceKind;sourceId:string;revision:number;occurredOn:string;amountMinor:number;currency:'CNY';summary:string};
export type FinanceKindTotals=Record<FinanceKind,{count:number;totalMinor:string}>;
export type FinanceComparisonPeriod={from:string;to:string;calendarDays:number;recordCount:number;recordedDays:number;byKind:FinanceKindTotals;netExpenseMinor:string;items:FinanceComparisonItem[];itemsTruncated:boolean};
export type FinanceComparisonResponse={
 query:FinanceComparisonQuery;observedAt:string;dataStatus:'isolated-test-drafts';syntheticIncluded:boolean;
 comparison:null|{currency:'CNY';a:FinanceComparisonPeriod;b:FinanceComparisonPeriod;overlap:{from:string|null;to:string|null;calendarDays:number;recordCount:number};delta:{direction:'b-minus-a';byKindMinor:Record<FinanceKind,string>;netExpenseMinor:string}};
 coverage:{
  /** null means no authorized snapshot was read, not zero existing records. */
  currentFinanceRecords:number|null;datedRecords:number|null;unknownDateRecords:number|null;unsupportedCurrencyRecords:number|null;
  firstOccurredOn:string|null;lastOccurredOn:string|null;
  snapshot:'single-owner-snapshot';summaryScope:'all-current-snapshot-records';meaning:'existing-records-only';
 };
};
