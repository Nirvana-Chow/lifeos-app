import test from 'node:test';
import assert from 'node:assert/strict';
import {PersonalFinanceService} from '../src/personal-finance/service.ts';
import {handlePersonalFinance} from '../src/personal-finance/http.ts';
import {freezePersonalFinanceCommand,keepPersonalFinanceCommand,readPersonalFinanceCommand,sendPersonalFinanceCommand,readPersonalFinanceSnapshot} from '../src/personal-finance/client.ts';
import {financeAmountMinor,formatFinanceAmount} from '../src/personal-finance/domain.ts';
import {MemoryPort} from './helpers/platform.ts';
const binding={ownerId:'finance-http-fixture',spaceId:'finance-http-space'},baseURL='https://finance.example.test';
const fields={kind:'expense',amountMinor:2901,currency:'CNY',occurredOn:'2030-11-05',category:'餐饮',fromAccountRef:null,toAccountRef:null,originalEntryId:null,notes:'Explicit synthetic test fixture'} as const;
function setup(){const repo=new MemoryPort();repo.readCurrentSnapshot=async owner=>structuredClone([...repo.rows.values()].filter(row=>row.ownerId===owner));const service=new PersonalFinanceService(repo,{...binding,enabled:true,writable:true}),values=new Map<string,string>(),store={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};let owner=true,writable=true;
 const context={ownerId:binding.ownerId,baseURL,service,assertOwner:async()=>{if(!owner)throw Object.assign(Error('owner revoked'),{status:403});},guard:async()=>{if(!writable)throw Error('write permit revoked');}};
 const fetcher=(async(input:RequestInfo|URL,init:RequestInit={})=>{const request=new Request(baseURL+String(input),{...init,headers:{host:'finance.example.test',origin:baseURL,...Object.fromEntries(new Headers(init.headers))}});return(await handlePersonalFinance(request,context))!;}) as typeof fetch;
 return{repo,service,store,fetcher,context,setOwner:(v:boolean)=>{owner=v;},setWritable:(v:boolean)=>{writable=v;}};
}
test('exact decimal intake never guesses or rounds cents',()=>{
 for(const [input,minor]of [['0.01',1],['29.01',2901],['1.2',120],['10000000000.00',1000000000000]] as const)assert.equal(financeAmountMinor(input),minor);
 for(const input of ['0','0.001','1e2','1,234','-1','1.005',' 1','10000000000.01'])assert.throws(()=>financeAmountMinor(input));
 assert.equal(formatFinanceAmount('-101'),'-1.01');assert.equal(formatFinanceAmount('900719925474099300'), '9007199254740993.00');
});
test('finance HTTP exposes status/list/detail/history/CAS and rejects extra query/origin/body fields',async()=>{
 const {fetcher,repo}=setup();const status=await(await fetcher('/api/platform/personal/finance/status')).json();assert.equal(status.configured,true);
 const command=freezePersonalFinanceCommand(binding,fields,null,'finance-http-create'),response=await fetcher(command.path,{method:command.method,headers:{'content-type':'application/json','idempotency-key':command.key},body:JSON.stringify(command.body)});assert.equal(response.status,201);
 const receipt=await response.json(),id=receipt.entry.id;
 const get=await fetcher('/api/platform/personal/finance/'+id);assert.equal(get.headers.get('cache-control'),'private, no-store');assert.equal((await get.json()).entry.fields.amountMinor,2901);
 assert.equal((await(await fetcher('/api/platform/personal/finance/'+id+'/history')).json()).complete,true);
 await assert.rejects(fetcher('/api/platform/personal/finance/'+id,{method:'PATCH',headers:{'content-type':'application/json','idempotency-key':'finance-http-stale'},body:JSON.stringify({...command.body,expectedRevision:2})}),{code:'REVISION_CONFLICT'});
 await assert.rejects(handlePersonalFinance(new Request(baseURL+'/api/platform/personal/finance',{method:'POST',headers:{host:'finance.example.test',origin:'https://other.example.test'}}),setup().context),{code:'ORIGIN_DENIED'});
 await assert.rejects(fetcher('/api/platform/personal/finance?unknown=true'),{code:'INVALID_FINANCE_QUERY'});
 assert.equal(repo.rows.size,1);
});
test('unknown finance save restores the same frozen key; replay then confirms a separate GET before clearing it',async()=>{
 const {fetcher,store,repo}=setup(),command=freezePersonalFinanceCommand(binding,fields,null,'finance-lost-response');let lost=true;
 const flaky=(async(input:RequestInfo|URL,init?:RequestInit)=>{const response=await fetcher(input,init);if(init?.method==='POST'&&lost){lost=false;throw Error('synthetic response lost after commit');}return response;}) as typeof fetch;
 await assert.rejects(sendPersonalFinanceCommand(flaky,store,command),{uncertain:true});assert.equal(repo.rows.size,1);assert.equal(readPersonalFinanceCommand(store,binding)?.key,'finance-lost-response');
 const restored=readPersonalFinanceCommand(store,binding)!;assert.ok(Object.isFrozen(restored.body.fields));
 const saved=await sendPersonalFinanceCommand(flaky,store,restored);assert.equal(saved.current.fields.amountMinor,2901);assert.equal(saved.receipt.revision,1);assert.equal(repo.rows.size,1);assert.equal(readPersonalFinanceCommand(store,binding),null);
});
test('failed readback and account switching preserve the original command and never send to the new owner',async()=>{
 const {fetcher,store,repo}=setup(),command=freezePersonalFinanceCommand(binding,fields,null,'finance-readback-failure');
 const badRead=(async(input:RequestInfo|URL,init?:RequestInit)=>{if(!init?.method&&/\/[a-f0-9-]{36}$/.test(String(input)))return new Response('{}',{status:503});return fetcher(input,init);}) as typeof fetch;
 await assert.rejects(sendPersonalFinanceCommand(badRead,store,command),{uncertain:true});assert.equal(repo.rows.size,1);assert.equal(readPersonalFinanceCommand(store,binding)?.key,command.key);
 const switched=(async(input:RequestInfo|URL,init?:RequestInit)=>String(input).endsWith('/status')?Response.json({scope:'personal-finance-v1',configured:true,writable:true,ownerId:'different-owner',spaceId:binding.spaceId,source:'manual-entry',authority:'manual-records-only',accountBalances:'unknown'}):fetcher(input,init)) as typeof fetch;
 await assert.rejects(sendPersonalFinanceCommand(switched,store,command),{status:403});assert.equal(repo.rows.size,1);assert.equal(readPersonalFinanceCommand(store,binding)?.key,command.key);
 assert.throws(()=>keepPersonalFinanceCommand(store,freezePersonalFinanceCommand(binding,{...fields,amountMinor:3000},null,'finance-another-key')));
});
test('client rejects a partial or forged summary instead of displaying plausible finance totals',async()=>{
 const {fetcher,service}=setup();await service.create(binding.ownerId,{spaceId:binding.spaceId,confirmed:true,fields},'finance-summary-client');
 const snapshot=await readPersonalFinanceSnapshot(fetcher,binding);assert.equal(snapshot.summary.netExpenseMinor,'2901');
 const partial=(async(input:RequestInfo|URL,init?:RequestInit)=>{const response=await fetcher(input,init);if(String(input).endsWith('/snapshot')){const data=await response.json();data.total=2;return Response.json(data);}return response;}) as typeof fetch;
 await assert.rejects(readPersonalFinanceSnapshot(partial,binding));
});
test('an uncertain finance write stays uncertain after later definite conflicts, including browser recovery',async()=>{
 const {fetcher,store}=setup(),command=freezePersonalFinanceCommand(binding,fields,null,'finance-uncertain-chain');
 const lost=(async(input:RequestInfo|URL,init?:RequestInit)=>{const result=await fetcher(input,init);if(init?.method)throw Error('lost after commit');return result;}) as typeof fetch;
 await assert.rejects(sendPersonalFinanceCommand(lost,store,command),{uncertain:true});
 const conflict=(async(input:RequestInfo|URL,init?:RequestInit)=>init?.method?Response.json({error:{code:'REVISION_CONFLICT',message:'版本冲突'}},{status:409}):fetcher(input,init)) as typeof fetch;
 await assert.rejects(sendPersonalFinanceCommand(conflict,store,readPersonalFinanceCommand(store,binding)!),{uncertain:true,status:409});assert.equal(readPersonalFinanceCommand(store,binding)?.key,command.key);
});
test('finance recovery only clears after storage removal is independently confirmed',async()=>{
 const {fetcher,store}=setup(),command=freezePersonalFinanceCommand(binding,fields,null,'finance-clear-failure');const blocked={...store,removeItem:()=>{}};
 await assert.rejects(sendPersonalFinanceCommand(fetcher,blocked,command),{uncertain:true});assert.equal(readPersonalFinanceCommand(store,binding)?.key,command.key);
});
