import test from 'node:test';
import assert from 'node:assert/strict';
import {PersonalFinanceService} from '../src/personal-finance/service.ts';
import {DraftService} from '../src/platform/service.ts';
import {MemoryPort} from './helpers/platform.ts';
import type {FinanceDraft} from '../src/platform/domain.ts';
import type {Transaction} from '../src/platform/contracts.ts';

const config={ownerId:'finance-fixture-owner',spaceId:'finance-fixture-space',enabled:true,writable:true};
const expense:FinanceDraft={kind:'expense',amountMinor:1234,currency:'CNY',occurredOn:'2030-11-05',category:'餐饮',fromAccountRef:'cash',toAccountRef:null,originalEntryId:null,notes:'Explicit internal fixture'};
const command=(fields:FinanceDraft=expense)=>({spaceId:config.spaceId,confirmed:true,fields});
function setup(){const repo=new MemoryPort();repo.readCurrentSnapshot=async owner=>structuredClone([...repo.rows.values()].filter(row=>row.ownerId===owner));return{repo,service:new PersonalFinanceService(repo,config)};}

test('real manual finance persists through the existing writer and only its owner/space/source can read or edit it',async()=>{
 const {repo,service}=setup(),synthetic=await new DraftService(repo).mutate(config.ownerId,'finance',null,expense,'finance-synthetic-only');
 assert.equal((await service.list(config.ownerId)).entries.length,0);
 const saved=await service.create(config.ownerId,command(),'finance-owner-create');
 assert.equal(repo.rows.size,2);assert.equal(saved.entry.type,'finance');assert.equal(saved.entry.fields.amountMinor,1234);
 const reloaded=new PersonalFinanceService(repo,config);assert.deepEqual(await reloaded.get(config.ownerId,saved.entry.id),saved.entry);
 assert.equal((await reloaded.list(config.ownerId)).entries.length,1);
 await assert.rejects(service.get('foreign-owner',saved.entry.id),{code:'OWNER_ONLY'});
 await assert.rejects(new PersonalFinanceService(repo,{...config,spaceId:'another-space'}).get(config.ownerId,saved.entry.id),{code:'NOT_FOUND'});
 await assert.rejects(service.get(config.ownerId,synthetic.entry.id),{code:'NOT_FOUND'});
 await assert.rejects(service.update(config.ownerId,synthetic.entry.id,{...command(),expectedRevision:1},'finance-synthetic-edit'),{code:'NOT_FOUND'});
 await assert.rejects(service.create(config.ownerId,{...command(),spaceId:'foreign-space'},'finance-foreign-space'),{code:'PERSONAL_CONFIRMATION_REQUIRED'});
 const original=structuredClone(saved.entry.source),edited=await service.update(config.ownerId,saved.entry.id,{...command({...expense,amountMinor:2001}),expectedRevision:1},'finance-owner-edit');
 assert.equal(edited.entry.revision,2);assert.equal(edited.entry.fields.amountMinor,2001);assert.deepEqual(edited.entry.source,original);
 assert.deepEqual((await service.history(config.ownerId,saved.entry.id)).entries.map(row=>row.revision),[2,1]);
 await assert.rejects(service.update(config.ownerId,saved.entry.id,{...command(),expectedRevision:1},'finance-stale-edit'),{code:'REVISION_CONFLICT'});
 assert.equal(repo.historyRows.length,3);
});

test('finance idempotency is namespaced and replay keeps the original revision and source instead of creating again',async()=>{
 const {repo,service}=setup();await new DraftService(repo).mutate(config.ownerId,'finance',null,expense,'finance-same-key');
 const first=await service.create(config.ownerId,command(),'finance-same-key');
 await service.update(config.ownerId,first.entry.id,{...command({...expense,notes:'changed'}),expectedRevision:1},'finance-change-key');
 const replay=await service.create(config.ownerId,command(),'finance-same-key');
 assert.equal(replay.duplicate,true);assert.deepEqual(replay.entry,first.entry);assert.equal((await service.get(config.ownerId,first.entry.id)).revision,2);
 await assert.rejects(service.create(config.ownerId,command({...expense,amountMinor:5000}),'finance-same-key'),{code:'COMMAND_CONFLICT'});
 assert.equal(repo.rows.size,2);
});

test('finance revocation before receipt replay and during receipt save rolls back records, history and receipts',async()=>{
 const {repo,service}=setup();const first=await service.create(config.ownerId,command(),'finance-guard-key');
 await assert.rejects(service.create(config.ownerId,command(),'finance-guard-key',{assertActor:async()=>{throw Error('owner revoked');}}),/owner revoked/);
 let live=true,guards=0;const transaction=repo.transaction.bind(repo);
 repo.transaction=(owner,key,fn)=>transaction(owner,key,tx=>fn({...tx,saveReceipt:async receipt=>{await tx.saveReceipt(receipt);live=false;}}));
 await assert.rejects(service.create(config.ownerId,command(),'finance-revoked-save',{transactionGuard:async(_tx:Transaction)=>{guards++;if(!live)throw Error('grant revoked');}}),/grant revoked/);
 assert.ok(guards>=3);assert.equal(repo.rows.size,1);assert.equal(repo.historyRows.length,1);assert.equal(repo.receipts.size,1);assert.equal((await service.get(config.ownerId,first.entry.id)).revision,1);
});

test('finance summary covers only its real records; transfer/repayment do not become expenses or invented balances',async()=>{
 const {service}=setup();const saved=await service.create(config.ownerId,command(),'finance-expense-total');
 for(const [kind,amount]of [['income',5000],['refund',234],['transfer',9000],['repayment',8000]] as const){await service.create(config.ownerId,command({...expense,kind,amountMinor:amount,fromAccountRef:kind==='transfer'||kind==='repayment'?'cash':null,toAccountRef:kind==='transfer'||kind==='repayment'?'bank':null,originalEntryId:kind==='refund'?saved.entry.id:null}),'finance-total-'+kind);}
 const snapshot=await service.snapshot(config.ownerId);assert.equal(snapshot.entries.length,5);
 assert.equal(snapshot.summary.byKind.expense.totalMinor,'1234');assert.equal(snapshot.summary.byKind.income.totalMinor,'5000');assert.equal(snapshot.summary.byKind.refund.totalMinor,'234');assert.equal(snapshot.summary.netExpenseMinor,'1000');assert.equal(snapshot.summary.netRecordedIncomeMinor,'4000');assert.equal(snapshot.summary.accountBalanceMinor,null);
 assert.equal(snapshot.coverage.meaning,'recorded-manual-transactions-only');assert.equal(snapshot.coverage.firstOccurredOn,'2030-11-05');
});

test('refunds reuse same-owner same-currency expense locking and cannot refer to synthetic or other kinds',async()=>{
 const {repo,service}=setup(),synthetic=await new DraftService(repo).mutate(config.ownerId,'finance',null,expense,'finance-refund-synthetic');
 await assert.rejects(service.create(config.ownerId,command({...expense,kind:'refund',originalEntryId:synthetic.entry.id}),'finance-invalid-refund'),{code:'NOT_FOUND'});
 const income=await service.create(config.ownerId,command({...expense,kind:'income'}),'finance-income-refund');
 await assert.rejects(service.create(config.ownerId,command({...expense,kind:'refund',originalEntryId:income.entry.id}),'finance-wrong-refund'),{code:'INVALID_REFUND_SOURCE'});
 const original=await service.create(config.ownerId,command(),'finance-original-expense');
 await service.create(config.ownerId,command({...expense,kind:'refund',originalEntryId:original.entry.id}),'finance-correct-refund');
 await assert.rejects(service.update(config.ownerId,original.entry.id,{...command({...expense,kind:'income'}),expectedRevision:1},'finance-linked-edit'),{code:'LINKED_REFUNDS'});
 await assert.rejects(service.create(config.ownerId,command({...expense,amountMinor:12.34}),'finance-float-amount'),{code:'INVALID_AMOUNT'});
});

test('closed finance gates and incomplete snapshots/history never return a misleading complete summary',async()=>{
 const {repo,service}=setup();assert.equal(new PersonalFinanceService(repo,{...config,enabled:false}).status(config.ownerId).configured,false);
 await assert.rejects(new PersonalFinanceService(repo,{...config,enabled:false}).list(config.ownerId),{code:'FINANCE_UNAVAILABLE'});
 await assert.rejects(new PersonalFinanceService(repo,{...config,writable:false}).create(config.ownerId,command(),'finance-read-only'),{code:'FINANCE_READ_ONLY'});
 const saved=await service.create(config.ownerId,command(),'finance-history-gap'),row=repo.rows.get(saved.entry.id)!;row.revision=4;
 const history=await service.history(config.ownerId,row.id);assert.equal(history.complete,false);assert.equal(history.truncated,true);
 repo.historyRows=[];await assert.rejects(service.history(config.ownerId,row.id),{code:'FINANCE_HISTORY_UNAVAILABLE'});
 repo.readCurrentSnapshot=undefined;await assert.rejects(service.snapshot(config.ownerId),{code:'FINANCE_SNAPSHOT_UNAVAILABLE'});
});
test('manual finance fails closed on corrupt timestamps or extra private source fields without returning a partial total',async()=>{
 const {repo,service}=setup(),saved=await service.create(config.ownerId,command(),'finance-corrupt-source'),row=repo.rows.get(saved.entry.id)!;
 (row.source as any).privateExtra='must never leave the source boundary';
 await assert.rejects(service.snapshot(config.ownerId),{code:'FINANCE_RECORD_UNAVAILABLE'});delete(row.source as any).privateExtra;
 row.source.asOf='2026-02-30T00:00:00Z';await assert.rejects(service.get(config.ownerId,row.id),{code:'FINANCE_RECORD_UNAVAILABLE'});
});
