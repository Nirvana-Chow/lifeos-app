import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlatformHandler} from '../src/platform/http.ts';
import {SearchService} from '../src/search-candidate/service.ts';
import {SearchClient} from '../src/search-workbench/client.ts';
import {DraftService} from '../src/platform/service.ts';
import {MemoryPort} from './helpers/platform.ts';
const baseURL='http://127.0.0.1:3002',owner={id:'fixture-r56-owner',email:'r56-owner@example.invalid'};
function setup(){const repository=new MemoryPort();let identity:'owner'|'other'|'none'='owner',key=0;
 const handler=createPlatformHandler({legacyUnboundedReadsEnabled:true,repository,baseURL,owner,sessions:{read:async()=>identity==='none'?null:{userId:identity==='other'?'fixture-other':owner.id,email:owner.email}}});
 return{repository,setIdentity:(value:typeof identity)=>{identity=value;},async send(path:string,method='GET',body?:unknown,requestKey?:string){const response=await handler(new Request(baseURL+'/api/platform/'+path,{method,headers:{host:'127.0.0.1:3002',origin:baseURL,'content-type':'application/json','idempotency-key':requestKey??'r56-integration-'+(++key)},...(body===undefined?{}:{body:JSON.stringify(body)})}));return{response,body:await response.json()};}};
}
const project=(links:unknown[])=>({title:'Synthetic linked project',text:'Deterministic source review only',occurredOn:'2026-01-02',confirmed:true,syntheticOnly:true,record:{type:'project',syntheticOnly:true,stage:'active',nextStep:'Check linked source changes',completion:{selfReported:true,status:'not-complete',evidence:null},testing:{manuallyRecorded:true,outcome:'not-run',evidence:null},review:{decision:'pending',evidence:null},links}});
const pin=(type:string,entry:any)=>({type,id:entry.id,sourceId:entry.source.id,revision:entry.revision});
test('linked project request flow preserves one source and exposes changed versions before manual rereview',async()=>{
 const f=setup();
 const todo=(await f.send('todos','POST',{title:'Synthetic linked task',notes:'Original task note',status:'open',dueOn:'2025-12-31'})).body.entry;
 const resource=(await f.send('records/resource','POST',{title:'Synthetic reading reference',text:'Original resource note',occurredOn:null,record:{type:'resource',syntheticOnly:true,url:'https://example.invalid/r56',author:null},confirmed:true,syntheticOnly:true})).body.entry;
 assert.ok(todo?.id);assert.ok(resource?.id);
 const links=[pin('todo',todo),pin('resource',resource)],body=project(links),created=await f.send('records/project','POST',body,'r56-link-create');assert.equal(created.response.status,201);const first=created.body.entry,id=first.id;
 const replay=await f.send('records/project','POST',body,'r56-link-create');assert.equal(replay.body.duplicate,true);assert.equal(replay.body.entry.id,id);
 const selected=await f.send('records/project-links?type=resource&includeSynthetic=true&q=Synthetic');assert.equal(selected.response.status,200);assert.equal(selected.body.items.length,1);assert.equal(selected.body.items[0].link.id,resource.id);
 const hidden=await f.send('records/project-links?type=resource');assert.equal(hidden.response.status,200);assert.deepEqual(hidden.body.items,[]);
 const accepted=await f.send('records/project/'+id+'/review','POST',{expectedRevision:1,decision:'accepted',evidence:'Manual synthetic source check',confirmed:true,syntheticOnly:true});assert.equal(accepted.response.status,200);
 const recap=await f.send('records/project/'+id+'/recap?includeSynthetic=true');assert.equal(recap.response.status,200);assert.equal(recap.body.reviewApplicable,true);assert.equal(recap.body.aiGenerated,false);assert.equal(recap.body.counts.current,2);
 const changed=await f.send('todos/'+todo.id,'PATCH',{expectedRevision:1,title:'Synthetic linked task corrected',status:'done'});assert.equal(changed.response.status,200);
 const stale=await f.send('records/project/'+id+'/recap?includeSynthetic=true');assert.equal(stale.body.counts.updated,1);assert.equal(stale.body.reviewApplicable,false);assert.equal(stale.body.reviewApplicability,'stale-links');assert.equal(stale.body.project.draft.record.review.decision,'accepted');
 const blocked=await f.send('records/project/'+id+'/review','POST',{expectedRevision:2,decision:'accepted',evidence:'Cannot accept stale linked version',confirmed:true,syntheticOnly:true});assert.equal(blocked.response.status,409);
 const corrected=await f.send('records/project/'+id,'PATCH',{...body,expectedRevision:2,record:{...body.record,links:[pin('todo',changed.body.entry),pin('resource',resource)]}});assert.equal(corrected.response.status,200);assert.equal(corrected.body.entry.draft.record.review.decision,'pending');assert.equal(corrected.body.entry.source.id,first.source.id);assert.equal(corrected.body.entry.source.original.record.links.find((ref:any)=>ref.id===todo.id).revision,1);
 const source=await f.send('search/source/inbox/'+id+'?includeSynthetic=true');assert.equal(source.response.status,200);assert.equal(source.body.current.revision,3);assert.equal(source.body.original.revision,1);
 const exported=await f.send('export');assert.equal(exported.body.entries.length,3);assert.equal(exported.body.entries.filter((entry:any)=>entry.id===todo.id).length,1);assert.equal(exported.body.history.filter((entry:any)=>entry.id===id).length,3);
 for(const identity of ['none','other'] as const){f.setIdentity(identity);for(const path of ['records/project-links?includeSynthetic=true','records/project/'+id+'/recap?includeSynthetic=true'])assert.equal((await f.send(path)).response.status,identity==='none'?401:403);}
});
test('unified source search retains project reference IDs and revisions without copying referenced content',async()=>{
 const f=setup(),todo=(await f.send('todos','POST',{title:'Synthetic referenced task',notes:'Never copied into project metadata',status:'open',dueOn:null})).body.entry;
 const body=project([]),{links:omitted,...legacyRecord}=body.record;void omitted;const created=await f.send('records/project','POST',{...body,record:legacyRecord});assert.equal(created.response.status,201);const entry=created.body.entry;
 // Model a valid stored link projection directly so this pins the search boundary,
 // separately from the transactional linking handler covered by the first test.
 const stored=f.repository.rows.get(entry.id)!;assert.ok('record' in stored.draft);(stored.draft as any).record.links=[pin('todo',todo)];
 const found=await f.send('search?'+new URLSearchParams({q:todo.source.id,type:'project',includeSynthetic:'true'}));assert.equal(found.response.status,200);assert.deepEqual(found.body.items.map((item:any)=>item.id),[entry.id]);
 const detail=await f.send('search/source/inbox/'+entry.id+'?includeSynthetic=true');const serialized=JSON.stringify(detail.body.current.fields);assert.ok(serialized.includes(todo.id));assert.ok(serialized.includes(todo.source.id));assert.ok(!serialized.includes('Never copied into project metadata'));assert.ok(!serialized.includes(owner.id));
});

test('maximum project link set remains readable through the real search service and client',async()=>{
 const repository=new MemoryPort(),id='10000000-0000-4000-8000-000000000001',sourceId='20000000-0000-4000-8000-000000000001',now='2026-10-23T00:00:00.000Z';
 const links=Array.from({length:20},(_,i)=>({type:'todo',id:'30000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),sourceId:'40000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),revision:i+1}));
 const {confirmed,syntheticOnly,...fields}=project(links);void confirmed;void syntheticOnly;const draft={...fields,disposition:'reference'};
 repository.rows.set(id,{id,ownerId:owner.id,kind:'inbox',draft,source:{id:sourceId,system:'website',externalId:id,version:1,asOf:now,original:structuredClone(draft)},revision:1,createdAt:now,updatedAt:now,syncState:'draft',externalStatus:null} as any);
 const response=await new SearchService(new DraftService(repository)).source(owner.id,'inbox',id,true),client=new SearchClient(async path=>String(path).endsWith('/auth/get-session')?Response.json({user:{id:owner.id},session:{userId:owner.id}}):Response.json(response));
 const detail=await client.source('inbox',id,true),values=detail.current.fields.map(field=>field.value).join('\n');
 for(const link of links){assert.ok(values.includes(link.id));assert.ok(values.includes(link.sourceId));}
 assert.equal(detail.current.id,id);assert.equal(detail.original.sourceId,sourceId);
});
