import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlatformHandler} from '../src/platform/http.ts';
import {MemoryPort} from './helpers/platform.ts';
import {FinanceClient,FinanceRequestError,createFinanceCommand,readFinanceIdentity} from '../src/finance-workbench/client.ts';
import {parseAmount,formatAmount,emptyFinanceFields,fieldsFromDraft,type FinanceFields} from '../src/finance-workbench/fields.ts';
import {FinanceSaveSession} from '../src/finance-workbench/session.ts';
import {createFinanceCommandStore} from '../src/finance-workbench/recovery.ts';
import {createFinanceReadFence,assertFinanceReadback} from '../src/finance-workbench/read-state.ts';

const owner={id:'synthetic-finance-owner',email:'finance-fixture@example.invalid'};
const ownerKey=JSON.stringify([owner.id,owner.email]);
const fields:FinanceFields={kind:'expense',amount:'12.30',occurredOn:'2028-02-29',category:'',fromAccountRef:'fixture-wallet',toAccountRef:'',originalEntryId:'',notes:'Synthetic notes only'};
function harness(){
 const repository=new MemoryPort();let authenticated=true,identity=owner;
 const handler=createPlatformHandler({repository,sessions:{read:async()=>authenticated?{userId:identity.id,email:identity.email}:null},owner,baseURL:'http://127.0.0.1:3111'});
 const transport:typeof fetch=async(input,init)=>String(input)==='/api/platform/auth/get-session'?Response.json(authenticated?{user:{id:identity.id,email:identity.email},session:{userId:identity.id}}:null):handler(new Request(new URL(String(input),'http://127.0.0.1:3111'),{...init,headers:{...Object.fromEntries(new Headers(init?.headers)),origin:'http://127.0.0.1:3111',host:'127.0.0.1:3111'}}));
 return{repository,client:new FinanceClient(ownerKey,transport),transport,signOut(){authenticated=false;},signIn(){authenticated=true;},switchOwner(){identity={id:'synthetic-other-owner',email:'other@example.invalid'};}};
}
function storage(){const data=new Map<string,string>();return{data,port:{getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);},removeItem:(key:string)=>{data.delete(key);}}};}
const failure=(code:string,status=400)=>Response.json({error:{code,message:'Untrusted server message'}},{status});
function override(h:ReturnType<typeof harness>,callback:(input:Parameters<typeof fetch>[0],init?:RequestInit)=>Promise<Response>):typeof fetch{return(input,init)=>String(input)==='/api/platform/auth/get-session'?h.transport(input,init):callback(input,init);}

test('amount rejects ambiguous decimal syntax, rounding, nonpositive amounts and overflow',()=>{
 for(const amount of ['', ' ', ' 1.20','1.20 ','+1','-1','0','0.00','1e2','1,000','01','00.01','.1','1.','1.001','NaN','Infinity','10000000000.01','999999999999999999999'])assert.throws(()=>parseAmount(amount),Error,amount);
 for(const [amount,minor]of [['0.01',1],['0.10',10],['12.3',1230],['9999999999.99',999999999999],['10000000000.00',1000000000000]]as const){assert.equal(parseAmount(amount),minor);assert.equal(parseAmount(formatAmount(minor)),minor);}
 for(const minor of [0,-1,1.5,NaN,1000000000001])assert.throws(()=>formatAmount(minor));
});
test('blank forms contain no sample values; invalid account, date, refund link and extra fields never send',async()=>{
 assert.deepEqual(emptyFinanceFields(),{kind:'expense',amount:'',occurredOn:'',category:'',fromAccountRef:'',toAccountRef:'',originalEntryId:'',notes:''});
 const h=harness(),session=new FinanceSaveSession(h.client,()=> 'finance-validation');
 for(const patch of [{amount:'1.001'},{occurredOn:'2027-02-29'},{fromAccountRef:'bad account'},{kind:'refund',originalEntryId:''},{kind:'transfer',toAccountRef:''},{kind:'repayment',toAccountRef:'fixture-wallet'},{ownerId:'forged'}])await assert.rejects(()=>session.save({...fields,...patch} as FinanceFields));
 assert.equal(h.repository.rows.size,0);assert.equal(session.getSnapshot().pending,null);
});
test('command retains raw correction, normalizes account directions and preserves refund source id',()=>{
 const source='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 for(const kind of ['expense','income','refund','transfer','repayment']as const){
  const command=createFinanceCommand({...fields,kind,category:'  Synthetic category  ',fromAccountRef:'fixture-wallet',toAccountRef:'fixture-bank',originalEntryId:kind==='refund'?source:''},null,'finance-directions',ownerKey);
  const body=JSON.parse(command.body);assert.equal(body.amountMinor,1230);assert.equal(body.category,'  Synthetic category  ');
  assert.equal(body.fromAccountRef,kind==='income'||kind==='refund'?null:'fixture-wallet');assert.equal(body.toAccountRef,kind==='expense'?null:'fixture-bank');assert.equal(body.originalEntryId,kind==='refund'?source:null);assert.equal(Object.isFrozen(command),true);
 }
});
test('initial rejection permits correction; malformed or ambiguous failures keep the command pending',async()=>{
 const h=harness();
 for(const response of [()=>new Response('broken proxy',{status:400}),()=>failure('UNKNOWN_CODE'),()=>new Response(null,{status:503}),()=>Response.json({entry:{},duplicate:false}),()=>failure('COMMAND_CONFLICT',409)]){
  const session=new FinanceSaveSession(new FinanceClient(ownerKey,override(h,async()=>response())),()=> 'finance-uncertain');await session.save(fields);assert.equal(session.getSnapshot().phase,'uncertain');assert.ok(session.getSnapshot().pending);assert.throws(()=>session.reset());
 }
 const rejected=new FinanceSaveSession(new FinanceClient(ownerKey,override(h,async()=>failure('INVALID_AMOUNT'))),()=> 'finance-rejected');await rejected.save(fields);assert.equal(rejected.getSnapshot().phase,'rejected');assert.equal(rejected.getSnapshot().pending,null);assert.ok(rejected.getSnapshot().attempt?.body.includes('Synthetic notes'));rejected.reset();
});
test('lost create response keeps frozen body/key and retry does not create a duplicate',async()=>{
 const h=harness(),requests:{body:BodyInit|null|undefined;key:string|null}[]=[];let lose=true;
 const client=new FinanceClient(ownerKey,override(h,async(input,init)=>{requests.push({body:init?.body,key:new Headers(init?.headers).get('idempotency-key')});const response=await h.transport(input,init);if(lose){lose=false;throw Error('synthetic lost response');}return response;}));
 const store=storage(),session=new FinanceSaveSession(client,()=> 'finance-lost-response',createFinanceCommandStore(store.port,ownerKey));const mutable={...fields};
 await session.save(mutable);mutable.amount='999';mutable.notes='Later correction';assert.equal(session.getSnapshot().phase,'uncertain');assert.equal(h.repository.rows.size,1);await assert.rejects(()=>session.save(mutable));
 await session.retry();assert.equal(session.getSnapshot().phase,'saved');assert.equal(session.getSnapshot().result?.duplicate,true);assert.equal(h.repository.rows.size,1);assert.equal(h.repository.historyRows.length,1);assert.deepEqual(requests[1],requests[0]);assert.equal(store.data.size,0);
});
test('uncertain write never releases its key on later 401, 403, 400 or revision conflict',async()=>{
 for(const [code,status]of [['LOGIN_REQUIRED',401],['ACCOUNT_NOT_ALLOWED',403],['INVALID_AMOUNT',400],['REVISION_CONFLICT',409]]as const){
  const h=harness();let calls=0;const session=new FinanceSaveSession(new FinanceClient(ownerKey,override(h,async(input,init)=>{if(++calls===1){await h.transport(input,init);throw Error('lost');}return failure(code,status);})),()=> 'finance-uncertain-rejection');
  await session.save(fields);await session.retry();assert.equal(session.getSnapshot().phase,'uncertain',code);assert.equal(session.getSnapshot().pending?.key,'finance-uncertain-rejection');await assert.rejects(()=>session.save(fields));assert.equal(h.repository.rows.size,1);
 }
});
test('identity changes block frozen replay before any write and original owner can resume after login',async()=>{
 const h=harness();let lose=true,writes=0;
 const session=new FinanceSaveSession(new FinanceClient(ownerKey,override(h,async(input,init)=>{writes++;const result=await h.transport(input,init);if(lose){lose=false;throw Error('lost');}return result;})),()=> 'finance-identity-retry');
 await session.save(fields);h.signOut();await session.retry();assert.equal(session.getSnapshot().phase,'uncertain');assert.equal(writes,1);
 h.signIn();await session.retry();assert.equal(session.getSnapshot().phase,'saved');assert.equal(writes,2);
 const other=harness();other.switchOwner();const changed=new FinanceSaveSession(other.client,()=> 'finance-changed-owner');await changed.save(fields);assert.equal(changed.getSnapshot().error?.code,'IDENTITY_CHANGED');assert.equal(other.repository.rows.size,0);
});
test('CAS conflict retains the correction and requires a fresh explicit revision',async()=>{
 const h=harness(),created=(await h.client.send(createFinanceCommand(fields,null,'finance-conflict-create',ownerKey))).entry;
 await h.client.send(createFinanceCommand({...fields,notes:'Other editor'},created,'finance-conflict-other',ownerKey));
 const session=new FinanceSaveSession(h.client,()=> 'finance-conflict-local');await session.save({...fields,notes:'My correction'},created);
 assert.equal(session.getSnapshot().phase,'conflict');assert.equal(session.getSnapshot().pending,null);assert.equal(JSON.parse(session.getSnapshot().attempt!.body).expectedRevision,1);assert.equal(JSON.parse(session.getSnapshot().attempt!.body).notes,'My correction');assert.equal((await h.client.detail(created.id)).draft.notes,'Other editor');
});
test('recovery restores exact command and blocks wrong owner, tampered body/path and storage failure',async()=>{
 const h=harness(),memory=storage(),store=createFinanceCommandStore(memory.port,ownerKey),command=createFinanceCommand(fields,null,'finance-recovery-key',ownerKey);store.keep(command);
 const restored=new FinanceSaveSession(h.client,()=> 'unused-new-key',store);assert.deepEqual(restored.getSnapshot().pending,command);await restored.retry();assert.equal(h.repository.rows.size,1);assert.equal(memory.data.size,0);
 store.keep(command);assert.throws(()=>createFinanceCommandStore(memory.port,'different-owner').load());
 const key=[...memory.data.keys()][0];for(const patch of [{path:'/api/platform/todos'},{body:'{"amountMinor":2}'},{owner:'other-owner'},{extra:'not-allowed'}]){memory.data.set(key,JSON.stringify({...command,...patch}));assert.throws(()=>store.load());}
 const broken=new FinanceSaveSession(h.client,()=> 'finance-no-storage',{load:()=>null,keep:()=>{throw Error('unavailable');},clear:()=>{}});await assert.rejects(()=>broken.save(fields));assert.equal(h.repository.rows.size,1);
});
test('failure to clear a successful persisted receipt keeps recovery locked',async()=>{
 const h=harness();let pending:ReturnType<typeof createFinanceCommand>|null=null;
 const session=new FinanceSaveSession(h.client,()=> 'finance-clear-failure',{load:()=>pending,keep:command=>{pending=command;},clear:()=>{throw Error('blocked storage');}});await session.save(fields);assert.equal(session.getSnapshot().phase,'uncertain');assert.ok(session.getSnapshot().pending);assert.equal(h.repository.rows.size,1);
});
test('all five kinds use existing handler rules; linked refund keeps original source and source history',async()=>{
 const h=harness();assert.deepEqual(await h.client.list(),[]);const expense=(await h.client.send(createFinanceCommand(fields,null,'finance-five-expense',ownerKey))).entry;
 const refund=(await h.client.send(createFinanceCommand({...fields,kind:'refund',amount:'2.00',originalEntryId:expense.id,toAccountRef:'fixture-bank'},null,'finance-five-refund',ownerKey))).entry;
 for(const kind of ['income','transfer','repayment']as const)assert.equal((await h.client.send(createFinanceCommand({...fields,kind,toAccountRef:'fixture-bank'},null,'finance-five-'+kind,ownerKey))).entry.draft.kind,kind);
 const corrected=(await h.client.send(createFinanceCommand({...fieldsFromDraft(expense.draft),notes:'Manual correction'},expense,'finance-five-correct',ownerKey))).entry;
 assert.deepEqual(corrected.source.original,expense.source.original);assert.equal(refund.draft.originalEntryId,expense.id);assert.equal((await h.client.list()).length,5);assert.deepEqual((await h.client.history(expense.id)).map(x=>x.revision),[2,1]);
 await assert.rejects(()=>h.client.send(createFinanceCommand({...fields,kind:'income',toAccountRef:'fixture-bank'},corrected,'finance-linked-change',ownerKey)),error=>error instanceof FinanceRequestError&&error.code==='LINKED_REFUNDS'&&!error.uncertain);
 const missing='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';await assert.rejects(()=>h.client.send(createFinanceCommand({...fields,kind:'refund',originalEntryId:missing},null,'finance-refund-missing',ownerKey)),error=>error instanceof FinanceRequestError&&error.status===404);
});
test('malformed, incomplete, wrong-identity and duplicate rows never become finance data',async()=>{
 const h=harness(),entry=(await h.client.send(createFinanceCommand(fields,null,'finance-response-valid',ownerKey))).entry;
 for(const broken of [{...entry,ownerId:'leaked'},{...entry,draft:{kind:'expense'}},{...entry,source:{...entry.source,externalId:'wrong'}},{...entry,source:{...entry.source,asOf:'bad'}},{...entry,source:{...entry.source,version:0}},{...entry,draft:{...entry.draft,amountMinor:1.1}}])await assert.rejects(()=>new FinanceClient(ownerKey,override(h,async()=>Response.json({items:[broken],dataStatus:'isolated-test-drafts'}))).list(),FinanceRequestError);
 await assert.rejects(()=>new FinanceClient(ownerKey,override(h,async()=>Response.json({items:[entry,entry],dataStatus:'isolated-test-drafts'}))).list(),FinanceRequestError);
 const other='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';await assert.rejects(()=>new FinanceClient(ownerKey,override(h,async()=>Response.json({entry:{...entry,id:other,source:{...entry.source,externalId:other}}}))).detail(entry.id),FinanceRequestError);
 await assert.rejects(()=>readFinanceIdentity(async()=>Response.json({user:{id:owner.id}})),FinanceRequestError);
});
test('successful receipts must match the frozen body, target id and expected revision',async()=>{
 const h=harness(),create=createFinanceCommand(fields,null,'finance-receipt-valid',ownerKey),created=await h.client.send(create),edit=createFinanceCommand({...fields,notes:'Correction'},created.entry,'finance-receipt-edit',ownerKey);
 for(const entry of [{...created.entry,draft:{...created.entry.draft,amountMinor:9}},{...created.entry,revision:2}])await assert.rejects(()=>new FinanceClient(ownerKey,override(h,async()=>Response.json({entry,duplicate:false}))).send(create),error=>error instanceof FinanceRequestError&&error.uncertain);
 await assert.rejects(()=>new FinanceClient(ownerKey,override(h,async()=>Response.json(created))).send(edit),error=>error instanceof FinanceRequestError&&error.uncertain);
});
test('stale selection, authentication and save readbacks cannot publish old data',async()=>{
 const fence=createFinanceReadFence(),list=fence.begin('list'),detail=fence.begin('detail'),history=fence.begin('history'),readback=fence.begin('readback');
 fence.invalidate('detail','history','readback');assert.equal(list(),true);for(const accept of [detail,history,readback])assert.equal(accept(),false);
 const conflict=fence.begin('detail'),next=fence.begin('detail');assert.equal(conflict(),false);assert.equal(next(),true);fence.invalidate();assert.equal(list(),false);assert.equal(next(),false);const last=fence.begin('list');fence.dispose();assert.equal(last(),false);
 const h=harness(),entry=(await h.client.send(createFinanceCommand(fields,null,'finance-readback-valid',ownerKey))).entry;
 assert.throws(()=>assertFinanceReadback({...entry,revision:1},{...entry,revision:2}));assert.throws(()=>assertFinanceReadback({...entry,draft:{...entry.draft,notes:'Wrong snapshot'}},entry));assert.throws(()=>assertFinanceReadback({...entry,id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},entry));assert.doesNotThrow(()=>assertFinanceReadback({...entry,revision:2},entry));
});
test('changing identity during a read invalidates its result',async()=>{
 const h=harness();const client=new FinanceClient(ownerKey,override(h,async(input,init)=>{const result=await h.transport(input,init);h.switchOwner();return result;}));
 await assert.rejects(()=>client.list(),error=>error instanceof FinanceRequestError&&error.code==='IDENTITY_CHANGED');
});
test('identity requires a matching authenticated session, never just an arbitrary user object',async()=>{
 for(const value of [{user:owner},{user:owner,session:{userId:'different'}},{user:{...owner,id:'bad\u0000id'},session:{userId:'bad\u0000id'}}])await assert.rejects(()=>readFinanceIdentity(async()=>Response.json(value)),FinanceRequestError);
});
test('impossible timestamps, corrupt provenance and unknown data scopes fail closed',async()=>{
 const h=harness(),entry=(await h.client.send(createFinanceCommand(fields,null,'finance-provenance-guard',ownerKey))).entry;
 for(const patch of [{createdAt:'2026-02-30T00:00:00.000Z'},{source:{...entry.source,version:2}},{source:{...entry.source,original:{unexpected:'untrusted'}}},{unexpected:'untrusted'}]){
  await assert.rejects(()=>new FinanceClient(ownerKey,override(h,async()=>Response.json({items:[{...entry,...patch}],dataStatus:'isolated-test-drafts'}))).list(),FinanceRequestError);
 }
 await assert.rejects(()=>new FinanceClient(ownerKey,override(h,async()=>Response.json({items:[entry],dataStatus:'personal'}))).list(),FinanceRequestError);
});
test('unstructured error and unexpected success status never release a financial write',async()=>{
 const h=harness(),entry=(await h.client.send(createFinanceCommand(fields,null,'finance-response-status',ownerKey))).entry;
 for(const reply of [()=>Response.json({error:{code:'INVALID_AMOUNT'}},{status:400}),()=>failure('INVALID_AMOUNT',418),()=>Response.json({entry,duplicate:false},{status:202})]){
  const session=new FinanceSaveSession(new FinanceClient(ownerKey,override(h,async()=>reply())),()=> 'finance-untrusted-error');await session.save(fields);assert.equal(session.getSnapshot().phase,'uncertain');
 }
});
test('identity change after a commit retains the uncertain original command',async()=>{
 const h=harness(),session=new FinanceSaveSession(new FinanceClient(ownerKey,override(h,async(input,init)=>{const result=await h.transport(input,init);h.switchOwner();return result;})),()=> 'finance-after-commit-owner');
 await session.save(fields);assert.equal(h.repository.rows.size,1);assert.equal(session.getSnapshot().phase,'uncertain');assert.equal(session.getSnapshot().error?.code,'IDENTITY_CHANGED');assert.equal(session.getSnapshot().pending?.owner,ownerKey);await session.retry();assert.equal(h.repository.rows.size,1);assert.equal(session.getSnapshot().phase,'uncertain');
});
test('history rejects another record, duplicate revisions and ascending snapshots',async()=>{
 const h=harness(),first=(await h.client.send(createFinanceCommand(fields,null,'finance-history-create',ownerKey))).entry,second=(await h.client.send(createFinanceCommand({...fields,notes:'Newer note'},first,'finance-history-edit',ownerKey))).entry;
 const other='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 for(const history of [[first,first],[first,second],[{...first,id:other,source:{...first.source,externalId:other}}]])await assert.rejects(()=>new FinanceClient(ownerKey,override(h,async()=>Response.json({history,limit:100}))).history(first.id),FinanceRequestError);
});
