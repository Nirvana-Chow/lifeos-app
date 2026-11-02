import test from 'node:test';import assert from 'node:assert/strict';
import {SearchClient,SearchRequestError,createSearchReadFence,isSearchSessionFailure} from '../src/search-workbench/client.ts';
const id='10000000-0000-4000-8000-000000000001',sourceId='20000000-0000-4000-8000-000000000001';
const hit={id,kind:'todo',type:'todo',title:'合成任务',date:null,sourceId,sourceSystem:'website',snippet:'安全摘要',revision:1};
const result={items:[hit],limit:30,truncated:false,scanned:1,dataStatus:'isolated-test-drafts',syntheticIncluded:true,coverage:{scanLimit:2000,scanTruncated:false,calendarAvailable:false}};
const detail={current:{...hit,snippet:'',fields:[{label:'备注',value:'完整合成正文'}]},original:{...hit,snippet:'',fields:[{label:'备注',value:'原始合成正文'}]},history:[{...hit,snippet:'',fields:[]}],historyLimit:20,historyTruncated:false,dataStatus:'isolated-test-drafts',syntheticIncluded:true};
function harness(){let account='a',sessionFailure=false,response:unknown=result;const calls:string[]=[];const transport:typeof fetch=async(input,init)=>{const path=String(input);calls.push(path);assert.equal(init?.method,'GET');assert.equal(init?.cache,'no-store');assert.equal(init?.credentials,'same-origin');if(path.endsWith('/get-session'))return sessionFailure?Response.json({error:{code:'AUTH_UNAVAILABLE',message:'SECRET'}},{status:503}):Response.json({user:{id:account},session:{userId:account}});return Response.json(response);};return{client:new SearchClient(transport),calls,setAccount:(value:string)=>{account=value;},failSession:()=>{sessionFailure=true;},setResponse:(value:unknown)=>{response=value;}};}
test('search verifies account before and after each safe encoded GET',async()=>{
 const h=harness();assert.deepEqual(await h.client.search({q:'合成 & review',includeSynthetic:true}),result);assert.equal(h.calls.length,3);assert.equal(h.calls[1],'/api/platform/search?q=%E5%90%88%E6%88%90+%26+review&includeSynthetic=true&limit=30');
 h.setResponse(detail);assert.deepEqual(await h.client.source('todo',id,true),detail);
});
test('identity changes and unavailable session cannot expose results from another account',async()=>{
 const h=harness();await h.client.search({q:'x',includeSynthetic:true});h.setAccount('b');await assert.rejects(h.client.source('todo',id,true),(e:unknown)=>e instanceof SearchRequestError&&e.code==='ACCOUNT_CHANGED');assert.equal(h.calls.filter(p=>p.includes('/source/')).length,0);
 let calls=0;const changing=new SearchClient(async()=>{calls++;return calls===2?Response.json(result):Response.json({user:{id:calls===1?'a':'b'},session:{userId:calls===1?'a':'b'}});});await assert.rejects(changing.search({q:'x',includeSynthetic:true}),(e:unknown)=>e instanceof SearchRequestError&&e.code==='ACCOUNT_CHANGED');
 const failed=harness();failed.failSession();await assert.rejects(failed.client.search({q:'x',includeSynthetic:true}),(e:unknown)=>e instanceof SearchRequestError&&!e.message.includes('SECRET'));assert.equal(failed.calls.length,1);
});
test('responses with mixed identities, wrong source and invalid coverage are rejected',async()=>{
 for(const value of [{...result,items:[{...hit,ownerId:'b'}]},{...result,items:[hit,hit]},{...result,items:[{...hit,date:'2026-02-30'}]},{...result,scanned:3000},{...result,coverage:{...result.coverage,scanTruncated:true},truncated:false}]){const h=harness();h.setResponse(value);await assert.rejects(h.client.search({q:'x',includeSynthetic:true}));}
 const h=harness();h.setResponse({...detail,current:{...detail.current,id:sourceId}});await assert.rejects(h.client.source('todo',id,true));
});
test('default closed search stays empty and malformed inputs never reach transport',async()=>{
 const h=harness();h.setResponse({...result,items:[],scanned:0,syntheticIncluded:false});assert.equal((await h.client.search({q:'',includeSynthetic:false})).items.length,0);
 const before=h.calls.length;await assert.rejects(h.client.search({q:'x',from:'2026-02-30',includeSynthetic:true}));await assert.rejects(h.client.source('todo',id,false));assert.equal(h.calls.length,before);
});
test('read fence discards stale results and all responses after dispose',()=>{
 const fence=createSearchReadFence(),first=fence.begin(),second=fence.begin();assert.equal(first(),false);assert.equal(second(),true);fence.invalidate();assert.equal(second(),false);const third=fence.begin();fence.dispose();assert.equal(third(),false);assert.equal(fence.begin()(),false);
});
test('auth and unverifiable sessions remain global failures after read invalidation',async()=>{
 const fence=createSearchReadFence(),accepts=fence.begin();fence.invalidate();assert.equal(accepts(),false);
 assert.equal(isSearchSessionFailure(new SearchRequestError(403,'ACCOUNT_CHANGED','safe')),true);
 const h=harness();h.failSession();await assert.rejects(h.client.search({q:'x',includeSynthetic:true}),(error:unknown)=>isSearchSessionFailure(error)&&error instanceof SearchRequestError&&error.code==='IDENTITY_UNAVAILABLE');
 assert.equal(isSearchSessionFailure(new SearchRequestError(503,'SERVICE_UNAVAILABLE','safe')),false);
});
