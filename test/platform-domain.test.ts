import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTodo,validateFinance,validateId,validateRevision,validateIdempotencyKey,PlatformError} from '../src/platform/domain.ts';

const todo={title:'  合成下一行动  ',notes:'保留原文\n第二行',dueOn:'2028-02-29',status:'open'};
const expense={kind:'expense',amountMinor:1234,currency:'CNY',occurredOn:'2026-10-22',category:null,fromAccountRef:'fixture-wallet',toAccountRef:null,originalEntryId:null,notes:'合成消费'};
const bad=(fn:()=>unknown,code:string)=>assert.throws(fn,(e:unknown)=>e instanceof PlatformError&&e.code===code&&e.status===400);

test('todo normalizes title, preserves notes and keeps unknown due date empty',()=>{
 assert.deepEqual(validateTodo(todo),{...todo,title:'合成下一行动'});
 assert.deepEqual(validateTodo({title:'合成待办'}),{title:'合成待办',notes:'',dueOn:null,status:'open'});
});
test('identity and external-source claims cannot enter a website draft',()=>{
 for(const k of ['ownerId','userId','sourceId','source','externalStatus'])bad(()=>validateTodo({...todo,[k]:'forged'}),'UNKNOWN_FIELD');
 bad(()=>validateFinance({...expense,ownerId:'other'}),'UNKNOWN_FIELD');
});
test('dates reject impossible days and timezone timestamps instead of shifting the day',()=>{
 for(const dueOn of ['2026-02-29','2026-04-31','2026-10-22T00:00:00Z','2026-1-2',''])bad(()=>validateTodo({...todo,dueOn}),'INVALID_DATE');
 assert.equal(validateTodo({...todo,dueOn:'2025-12-31'}).dueOn,'2025-12-31');
});
test('draft text cannot be blank, oversized, NUL or implicit type coercion',()=>{
 for(const title of ['', '  ', 'x'.repeat(241), 42,'a\0b'])bad(()=>validateTodo({...todo,title}),'INVALID_TEXT');
 bad(()=>validateTodo({...todo,notes:'x'.repeat(16385)}),'INVALID_TEXT');
 bad(()=>validateTodo({...todo,status:'read'}),'INVALID_STATUS');
 bad(()=>validateTodo({...todo,status:null}),'INVALID_STATUS');
 bad(()=>validateTodo({...todo,notes:null}),'INVALID_TEXT');
 bad(()=>validateTodo([]),'INVALID_BODY');
});
test('finance preserves integer cents and unknown category rather than making up a classification',()=>{
 assert.deepEqual(validateFinance(expense),expense);
 for(const amountMinor of [0,-1,1.2,'1234',Number.MAX_SAFE_INTEGER])bad(()=>validateFinance({...expense,amountMinor}),'INVALID_AMOUNT');
 bad(()=>validateFinance({...expense,currency:'USD'}),'UNSUPPORTED_CURRENCY');
 bad(()=>validateFinance({...expense,occurredOn:'2026-02-30'}),'INVALID_DATE');
 bad(()=>validateFinance({...expense,notes:null}),'INVALID_TEXT');
});
test('transfer and repayment require two distinct account references and remain separate kinds',()=>{
 for(const kind of ['transfer','repayment']){
  const valid={...expense,kind,toAccountRef:'fixture-debt',category:null};
  assert.equal(validateFinance(valid).kind,kind);
  bad(()=>validateFinance({...valid,toAccountRef:null}),'ACCOUNT_LINK_REQUIRED');
  bad(()=>validateFinance({...valid,toAccountRef:'fixture-wallet'}),'DISTINCT_ACCOUNTS_REQUIRED');
 }
});
test('refund requires a stable original entry ID, without claiming ownership was verified by validation',()=>{
 const id='11111111-1111-4111-8111-111111111111';
 assert.equal(validateFinance({...expense,kind:'refund',originalEntryId:id}).originalEntryId,id);
 bad(()=>validateFinance({...expense,kind:'refund'}),'REFUND_LINK_REQUIRED');
 bad(()=>validateFinance({...expense,originalEntryId:id}),'UNEXPECTED_REFUND_LINK');
 bad(()=>validateFinance({...expense,kind:'refund',originalEntryId:'../../other'}),'INVALID_ID');
});
test('stable IDs, revisions and idempotency keys reject ambiguous or overflowing values',()=>{
 assert.equal(validateId('11111111-1111-4111-8111-111111111111'),'11111111-1111-4111-8111-111111111111');
 for(const id of ['a','../a','11111111-1111-1111-1111-111111111111'])bad(()=>validateId(id),'INVALID_ID');
 assert.equal(validateRevision(1),1);
 for(const n of [0,-1,1.1,'1',2147483648])bad(()=>validateRevision(n),'INVALID_REVISION');
 assert.equal(validateIdempotencyKey('fixture-command-001'),'fixture-command-001');
 for(const k of ['', 'short','a '.repeat(10),'x'.repeat(97)])bad(()=>validateIdempotencyKey(k),'INVALID_COMMAND_KEY');
});
