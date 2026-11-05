import type {FinanceDraft} from '../platform/domain.ts';
import type {SourceEvidence,Transaction} from '../platform/contracts.ts';

export type FinanceBinding={ownerId:string;spaceId:string};
export type PersonalFinanceConfig=FinanceBinding&{enabled?:boolean;writable?:boolean};
export type PersonalFinanceEntry={id:string;type:'finance';spaceId:string;fields:FinanceDraft;source:SourceEvidence;revision:number;createdAt:string;updatedAt:string};
export type PersonalFinanceResult={entry:PersonalFinanceEntry;duplicate:boolean};
export type FinanceMutationContext={assertActor?:()=>Promise<void>;transactionGuard?:(tx:Transaction)=>Promise<void>};
export type PersonalFinanceStatus={scope:'personal-finance-v1';configured:false;writable:false;reason:string}|({scope:'personal-finance-v1';configured:true;writable:boolean;source:'manual-entry';authority:'manual-records-only';accountBalances:'unknown'}&FinanceBinding);
export type FinanceTotals=Record<FinanceDraft['kind'],{count:number;totalMinor:string}>;
export type FinanceSummary={currency:'CNY';byKind:FinanceTotals;netExpenseMinor:string;netRecordedIncomeMinor:string;accountBalanceMinor:null};
export type FinanceCoverage={meaning:'recorded-manual-transactions-only';source:'manual-entry';recordCount:number;firstOccurredOn:string|null;lastOccurredOn:string|null;externalLedgerConnected:false;accountBalances:'unknown'};
export type FinanceSnapshot={scope:'personal-finance-snapshot-v1';spaceId:string;entries:PersonalFinanceEntry[];total:number;observedAt:string;summary:FinanceSummary;coverage:FinanceCoverage;accounts:{reference:string;balanceMinor:null}[];categories:string[]};
