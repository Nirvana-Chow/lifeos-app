import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlatformHandler} from '../src/platform/http.ts';
import {MemoryPort} from './helpers/platform.ts';
const baseURL='http://127.0.0.1:3002',owner={id:'fixture-integrated-owner',email:'fixture-integrated@example.invalid'};
const metadata={type:'project',syntheticOnly:true,stage:'planned',nextStep:'Review synthetic implementation',completion:{selfReported:true,status:'not-complete',evidence:null},testing:{manuallyRecorded:true,outcome:'not-run',evidence:null},review:{decision:'pending',evidence:null}};
function setup(){const repository=new MemoryPort();let identity:'owner'|'other'|'none'='owner';let key=0;
 const handler=createPlatformHandler({legacyUnboundedReadsEnabled:true,repository,baseURL,owner,sessions:{read:async()=>identity==='none'?null:{userId:identity==='other'?'fixture-other':owner.id,email:owner.email}}});
 return{repository,setIdentity:(next:typeof identity)=>{identity=next;},async send(path:string,method='GET',body?:unknown){const response=await handler(new Request(baseURL+'/api/platform/'+path,{method,headers:{host:'127.0.0.1:3002',origin:baseURL,'content-type':'application/json','idempotency-key':'r55-integration-'+(++key)},...(body===undefined?{}:{body:JSON.stringify(body)})}));return{response,body:await response.json()};}};
}
test('unified search and project review stay behind the same session/owner gate without touching storage',async()=>{
 const f=setup();for(const identity of ['none','other'] as const){f.setIdentity(identity);for(const [path,method]of [['search?includeSynthetic=true','GET'],['search/source/inbox/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa?includeSynthetic=true','GET'],['records/project/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/review','POST']]){const result=await f.send(path,method,method==='POST'?{}:undefined);assert.equal(result.response.status,identity==='none'?401:403);assert.match(result.response.headers.get('cache-control')??'',/no-store/);}}
 assert.equal(f.repository.reads,0);assert.equal(f.repository.events.length,0);
});
test('project editing, explicit review and unified search all return one source and history across years',async()=>{
 const f=setup(),raw={title:'Synthetic project before correction',text:'Original cross-year synthetic evidence',occurredOn:'2025-12-31',record:metadata,confirmed:true,syntheticOnly:true};
 const created=await f.send('records/project','POST',raw);assert.equal(created.response.status,201);const first=created.body.entry,id=first.id;
 const accepted=await f.send('records/project/'+id+'/review','POST',{expectedRevision:1,decision:'accepted',evidence:'Manual synthetic review only',confirmed:true,syntheticOnly:true});assert.equal(accepted.response.status,200);
 const edited=await f.send('records/project/'+id,'PATCH',{...raw,title:'Synthetic project corrected',occurredOn:'2026-01-01',record:{...metadata,nextStep:'Recheck corrected evidence'},expectedRevision:2});assert.equal(edited.response.status,200);assert.equal(edited.body.entry.draft.record.review.decision,'pending');
 const empty=await f.send('search?q=Synthetic');assert.deepEqual(empty.body.items,[]);
 const found=await f.send('search?'+new URLSearchParams({q:first.source.id,from:'2025-12-01',to:'2026-01-31',type:'project',includeSynthetic:'true'}));assert.equal(found.response.status,200);assert.equal(found.body.items.length,1);assert.equal(found.body.items[0].id,id);assert.equal(found.body.items[0].sourceId,first.source.id);assert.equal(found.body.items[0].date,'2026-01-01');
 const detail=await f.send('search/source/inbox/'+id+'?includeSynthetic=true');assert.equal(detail.response.status,200);assert.equal(detail.body.current.title,'Synthetic project corrected');assert.equal(detail.body.original.title,raw.title);assert.equal(detail.body.original.date,'2025-12-31');assert.deepEqual(detail.body.history.map((x:{revision:number})=>x.revision),[3,2,1]);assert.equal(detail.body.current.sourceId,detail.body.original.sourceId);
 const exported=await f.send('export');assert.equal(exported.body.entries.length,1);assert.equal(exported.body.entries[0].id,id);assert.equal(exported.body.history.length,3);assert.equal(f.repository.rows.size,1);
 f.repository.rows.get(id)!.ownerId='fixture-other';assert.deepEqual((await f.send('search?includeSynthetic=true&q=Synthetic')).body.items,[]);assert.equal((await f.send('search/source/inbox/'+id+'?includeSynthetic=true')).response.status,404);
});
