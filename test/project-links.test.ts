import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlatformHandler} from '../src/platform/http.ts';
import {DraftService} from '../src/platform/service.ts';
import {RecordsService} from '../src/records-candidate/service.ts';
import {validateRecordMetadata} from '../src/records-candidate/domain.ts';
import {MemoryPort} from './helpers/platform.ts';
import type {PublicEntry} from '../src/platform/contracts.ts';

const owner={id:'synthetic-links-owner',email:'links@example.invalid'},baseURL='http://127.0.0.1:3002';
const project=(links?:unknown)=>({type:'project',syntheticOnly:true,stage:'planned',nextStep:'Synthetic next step',completion:{selfReported:true,status:'not-complete',evidence:null},testing:{manuallyRecorded:true,outcome:'not-run',evidence:null},review:{decision:'pending',evidence:null},...(links===undefined?{}:{links})});
const command=(links?:unknown)=>({title:'Synthetic linked project',text:'Synthetic project description',record:project(links),confirmed:true,syntheticOnly:true});
const review=(expectedRevision:number,decision='accepted')=>({expectedRevision,decision,evidence:'Synthetic review evidence',confirmed:true,syntheticOnly:true});
const pin=(entry:PublicEntry,type='todo')=>({type,id:entry.id,sourceId:entry.source.id,revision:entry.revision});
const visible='?includeSynthetic=true';
function setup(){
 const repository=new MemoryPort(),drafts=new DraftService(repository),records=new RecordsService(drafts,()=>new Date('2026-10-23T12:00:00.000Z'));
 const handler=createPlatformHandler({repository,sessions:{read:async()=>({userId:owner.id,email:owner.email})},owner,baseURL});let keys=0;
 return{repository,drafts,records,async send(path:string,method='GET',body?:unknown,key='project-links-'+(++keys)){
  const response=await handler(new Request(baseURL+'/api/platform/'+path,{method,headers:{host:'127.0.0.1:3002',origin:baseURL,'content-type':'application/json','idempotency-key':key},...(body===undefined?{}:{body:JSON.stringify(body)})}));
  return{status:response.status,body:await response.json()};
 },async target(type='todo'){
  const key='project-target-'+(++keys);
  if(type==='todo')return(await drafts.mutate(owner.id,'todo',null,{title:'Synthetic task',notes:'Synthetic task details',dueOn:null,status:'open'},key)).entry;
  return(await records.create(owner.id,type as 'resource'|'article',{title:'Synthetic '+type,text:'Synthetic '+type+' details',record:type==='resource'?{type,syntheticOnly:true,url:'https://example.invalid/resource',author:null}:{type,syntheticOnly:true,author:null,attribution:'summary',sourceURL:null},confirmed:true,syntheticOnly:true},key)).entry;
 }};
}

test('legacy project metadata normalizes absent links to an empty array without rewriting raw source',async()=>{
 assert.deepEqual((validateRecordMetadata(project()) as any).links,[]);
 const f=setup(),created=await f.send('records/project','POST',command());assert.equal(created.status,201);
 assert.deepEqual(created.body.entry.draft.record.links,[]);assert.equal('links' in created.body.entry.source.original.record,false);
 const id=created.body.entry.id;delete (f.repository.rows.get(id)!.draft as any).record.links;
 const recap=await f.send('records/project/'+id+'/recap'+visible);assert.equal(recap.status,200);assert.deepEqual(recap.body.links,[]);
 assert.equal(recap.body.reviewApplicable,false);assert.equal(recap.body.reviewApplicability,'pending');
});

test('strict project links accept only canonical unique task/resource/article pins',async()=>{
 const f=setup(),task=await f.target(),article=await f.target('article'),resource=await f.target('resource');
 const links=[pin(task),pin(resource,'resource'),pin(article,'article')],created=await f.send('records/project','POST',command(links));assert.equal(created.status,201);
 assert.deepEqual(created.body.entry.draft.record.links,[links[2],links[1],links[0]]);
 assert.deepEqual(created.body.entry.source.original.record.links,links);
 for(const invalid of [[links[0],links[0]],Array.from({length:21},()=>links[0]),[{...links[0],type:'project'}],[{...links[0],ownerId:'forged'}],[{...links[0],id:'bad'}],[{...links[0],sourceId:'bad'}],[{...links[0],revision:0}],null,{}]){
  assert.equal((await f.send('records/project','POST',command(invalid))).status,400);
 }
 assert.equal(f.repository.rows.size,4);
});

test('new and refreshed pins must match current owner, type, source and revision atomically',async()=>{
 const f=setup(),task=await f.target(),foreign=await f.target(),resource=await f.target('resource');f.repository.rows.get(foreign.id)!.ownerId='other-owner';
 const missing={...pin(task),id:'11111111-1111-4111-8111-111111111111'};
 const invalid=[pin(foreign),missing,{...pin(task),sourceId:resource.source.id},{...pin(task),revision:2},{...pin(resource),type:'article'}];
 for(const link of invalid){const result=await f.send('records/project','POST',command([link]));assert.equal(result.status,409);assert.equal(result.body.error.code,'PROJECT_LINK_UNAVAILABLE');}
 assert.equal(f.repository.rows.size,3);assert.equal(f.repository.historyRows.length,3);assert.equal(f.repository.receipts.size,3);
});

test('unchanged stale or unavailable pins can be retained and removed while refreshed pins require a current read',async()=>{
 const f=setup(),task=await f.target(),p=await f.send('records/project','POST',command([pin(task)]));assert.equal(p.status,201);const id=p.body.entry.id;
 await f.drafts.mutate(owner.id,'todo',task.id,{expectedRevision:1,title:'Updated synthetic task'},'project-target-update');
 const staleRetained=await f.send('records/project/'+id,'PATCH',{...command([pin(task)]),text:'Changed project note',expectedRevision:1});assert.equal(staleRetained.status,200);
 const badRefresh=await f.send('records/project/'+id,'PATCH',{...command([{...pin(task),revision:3}]),expectedRevision:2});assert.equal(badRefresh.status,409);
 const refreshed=await f.send('records/project/'+id,'PATCH',{...command([{...pin(task),revision:2}]),expectedRevision:2});assert.equal(refreshed.status,200);
 f.repository.rows.delete(task.id);
 const unavailableRetained=await f.send('records/project/'+id,'PATCH',{...command([{...pin(task),revision:2}]),text:'Retain missing reference',expectedRevision:3});assert.equal(unavailableRetained.status,200);
 const removed=await f.send('records/project/'+id,'PATCH',{...command([]),expectedRevision:4});assert.equal(removed.status,200);assert.deepEqual(removed.body.entry.draft.record.links,[]);
});

test('recap resolves current and updated pins in one owner-filtered snapshot with deterministic read-only counts',async()=>{
 const f=setup(),task=await f.target(),resource=await f.target('resource'),p=await f.send('records/project','POST',command([pin(task),pin(resource,'resource')]));assert.equal(p.status,201);const id=p.body.entry.id;
 const accepted=await f.send('records/project/'+id+'/review','POST',review(1));assert.equal(accepted.status,200);
 const before=f.repository.historyRows.length;
 const current=await f.records.recap(owner.id,id,{includeSynthetic:true});assert.equal(current.observedAt,'2026-10-23T12:00:00.000Z');assert.equal(current.reviewApplicable,true);assert.equal(current.reviewApplicability,'current');
 assert.deepEqual(current.counts,{total:2,current:2,updated:0,unavailable:0,todo:1,resource:1,article:0});
 assert.equal(current.aiGenerated,false);assert.equal(current.readOnly,true);assert.equal(current.freshness,'refresh-to-check');assert.equal(current.snapshotConsistency,'owner-snapshot');
 const updated=await f.drafts.mutate(owner.id,'todo',task.id,{expectedRevision:1,status:'done',notes:'Updated synthetic task detail'},'project-update-task');
 const summary=await f.records.recap(owner.id,id,{includeSynthetic:true});assert.equal(summary.project.revision,2);assert.ok(summary.project.draft.record.type==='project');assert.equal(summary.project.draft.record.review.decision,'accepted');assert.equal(summary.reviewApplicable,false);assert.equal(summary.reviewApplicability,'stale-links');
 const reference=summary.links.find((link:any)=>link.link.id===task.id)!;assert.equal(reference.status,'updated');assert.equal(reference.link.revision,1);assert.equal(reference.current?.link.revision,2);assert.equal(reference.current?.link.sourceId,updated.entry.source.id);assert.equal(reference.current?.summary,'Updated synthetic task detail');
 assert.deepEqual(summary.counts,{total:2,current:1,updated:1,unavailable:0,todo:1,resource:1,article:0});assert.equal(f.repository.historyRows.length,before+1);
 const oldGet=f.repository.get.bind(f.repository);f.repository.get=async()=>{throw Error('recap must use a single snapshot');};
 assert.deepEqual(await f.records.recap(owner.id,id,{includeSynthetic:true}),summary);f.repository.get=oldGet;
});

test('missing foreign wrong-type and wrong-source targets all produce identical unavailable payloads',async()=>{
 for(const mode of ['missing','foreign','type','source']){
  const f=setup(),task=await f.target(),p=await f.send('records/project','POST',command([pin(task)]));assert.equal(p.status,201);const id=p.body.entry.id,row=f.repository.rows.get(task.id)!;
  if(mode==='missing')f.repository.rows.delete(task.id);if(mode==='foreign')row.ownerId='other-owner';if(mode==='type')row.kind='finance';if(mode==='source')row.source.id='11111111-1111-4111-8111-111111111111';
  const recap=await f.send('records/project/'+id+'/recap'+visible);assert.equal(recap.status,200);assert.deepEqual(recap.body.links,[{link:pin(task),status:'unavailable',current:null}]);
  assert.equal(JSON.stringify(recap.body.links).includes('Synthetic task'),false);
 }
});

test('accepted review checks every pin but rejected review remains possible and same-command retry precedes validation',async()=>{
 const f=setup(),task=await f.target(),p=await f.send('records/project','POST',command([pin(task)]),'project-links-create');assert.equal(p.status,201);const id=p.body.entry.id;
 const accepted=await f.send('records/project/'+id+'/review','POST',review(1),'project-linked-accept');assert.equal(accepted.status,200);
 await f.drafts.mutate(owner.id,'todo',task.id,{expectedRevision:1,status:'done'},'project-task-changed');
 const stale=await f.send('records/project/'+id+'/review','POST',review(2));assert.equal(stale.status,409);assert.equal(stale.body.error.code,'PROJECT_LINK_UNAVAILABLE');
 const replay=await f.send('records/project/'+id+'/review','POST',review(1),'project-linked-accept');assert.equal(replay.status,200);assert.equal(replay.body.duplicate,true);assert.deepEqual(replay.body.entry,accepted.body.entry);
 const createReplay=await f.send('records/project','POST',command([pin(task)]),'project-links-create');assert.equal(createReplay.status,200);assert.equal(createReplay.body.duplicate,true);
 const rejected=await f.send('records/project/'+id+'/review','POST',review(2,'rejected'));assert.equal(rejected.status,200);
 f.repository.rows.delete(task.id);const unavailable=await f.send('records/project/'+id+'/review','POST',review(3));assert.equal(unavailable.status,409);
});

test('changing link pins invalidates project review and exact edit retry preserves receipt and original history',async()=>{
 const f=setup(),a=await f.target(),b=await f.target(),p=await f.send('records/project','POST',command([pin(a)]));assert.equal(p.status,201);const id=p.body.entry.id;
 await f.send('records/project/'+id+'/review','POST',review(1));const raw={...command([pin(a),pin(b)]),expectedRevision:2};
 const edited=await f.send('records/project/'+id,'PATCH',raw,'project-links-edit');assert.equal(edited.status,200);assert.equal(edited.body.entry.draft.record.review.decision,'pending');assert.deepEqual(edited.body.entry.source,p.body.entry.source);
 f.repository.rows.delete(b.id);const retry=await f.send('records/project/'+id,'PATCH',raw,'project-links-edit');assert.equal(retry.status,200);assert.equal(retry.body.duplicate,true);assert.deepEqual(retry.body.entry,edited.body.entry);
 const history=await f.send('records/project/'+id+'/history'+visible);assert.deepEqual(history.body.history.map((e:any)=>[e.revision,e.draft.record.links.length,e.draft.record.review.decision]),[[3,2,'pending'],[2,1,'accepted'],[1,1,'pending']]);
});

test('project and target locks share one canonical row order and target changes cannot race into acceptance',async()=>{
 const f=setup(),task=await f.target(),resource=await f.target('resource'),article=await f.target('article'),links=[pin(task),pin(resource,'resource'),pin(article,'article')],p=await f.send('records/project','POST',command(links));assert.equal(p.status,201);const id=p.body.entry.id;
 const locks:string[]=[],transaction=f.repository.transaction.bind(f.repository);f.repository.transaction=(owner,key,run)=>transaction(owner,key,tx=>run({...tx,get:async(kind,id)=>{locks.push(kind+':'+id);return tx.get(kind,id);}}));
 const accepted=await f.send('records/project/'+id+'/review','POST',review(1));assert.equal(accepted.status,200);assert.deepEqual(locks,['inbox:'+id,'inbox:'+article.id,'inbox:'+resource.id,'todo:'+task.id].sort());
 const changed=f.drafts.mutate(owner.id,'todo',task.id,{expectedRevision:1,status:'done'},'project-target-race');
 const racing=f.records.reviewProject(owner.id,id,review(2),'project-review-race');await changed;await assert.rejects(racing,(e:any)=>e.code==='PROJECT_LINK_UNAVAILABLE');
 assert.equal(f.repository.rows.get(id)!.revision,2);
});

test('wrong-typed reciprocal project references still lock rows in identical order before rejection',async()=>{
 const f=setup(),a=await f.send('records/project','POST',command()),b=await f.send('records/project','POST',command());assert.equal(a.status,201);assert.equal(b.status,201);
 const orders:string[][]=[],transaction=f.repository.transaction.bind(f.repository);f.repository.transaction=(owner,key,run)=>transaction(owner,key,tx=>{const order:string[]=[];orders.push(order);return run({...tx,get:async(kind,id)=>{order.push(kind+':'+id);return tx.get(kind,id);}});});
 for(const[from,to]of [[a,b],[b,a]]){const result=await f.send('records/project/'+from.body.entry.id,'PATCH',{...command([pin(to.body.entry,'resource')]),expectedRevision:1});assert.equal(result.status,409);}
 assert.deepEqual(orders,[['inbox:'+a.body.entry.id,'inbox:'+b.body.entry.id].sort(),['inbox:'+a.body.entry.id,'inbox:'+b.body.entry.id].sort()]);
});

test('link candidates are bounded owner-scoped read-only projections and strict queries cannot inject owner',async()=>{
 const f=setup(),task=await f.target(),resource=await f.target('resource'),foreign=await f.target();f.repository.rows.get(foreign.id)!.ownerId='other-owner';
 const results=await f.send('records/project-links?type=todo&q=synthetic&includeSynthetic=true');assert.equal(results.status,200);assert.deepEqual(results.body.items.map((i:any)=>i.link),[pin(task)]);assert.equal(results.body.limit,50);assert.equal(results.body.truncated,false);
 assert.equal(results.body.items[0].title,'Synthetic task');assert.equal('ownerId' in results.body.items[0],false);
 assert.deepEqual((await f.send('records/project-links?type=todo')).body.items,[]);
 for(const query of ['type=project','type=todo&type=article','type=todo&owner=other','type=todo&q='+encodeURIComponent('x'.repeat(201)),'type=todo&limit=100','type=todo&includeSynthetic=1'])assert.equal((await f.send('records/project-links?'+query)).status,400);
 assert.equal((await f.send('records/project-links?type=resource&includeSynthetic=true')).body.items[0].link.id,resource.id);
 assert.equal((await f.send('records/project-links?type=todo','POST',{})).status,405);
 for(let i=0;i<51;i++)await f.target();
 const bounded=await f.send('records/project-links?type=todo&includeSynthetic=true');assert.equal(bounded.status,200);assert.equal(bounded.body.items.length,50);assert.equal(bounded.body.truncated,true);
});

test('project recap honors synthetic opt-in and owner and rejects query/body bypasses without writes',async()=>{
 const f=setup(),task=await f.target(),p=await f.send('records/project','POST',command([pin(task)]));assert.equal(p.status,201);const id=p.body.entry.id,path='records/project/'+id+'/recap';
 assert.equal((await f.send(path)).status,404);assert.equal((await f.send(path+'?includeSynthetic=1')).status,400);
 assert.equal((await f.send(path+visible+'&owner=other')).status,400);assert.equal((await f.send(path+visible+'&includeSynthetic=true')).status,400);
 assert.equal((await f.send(path,'POST',{})).status,405);
 f.repository.rows.get(id)!.ownerId='other-owner';assert.equal((await f.send(path+visible)).status,404);
 assert.equal(f.repository.historyRows.length,2);assert.equal(f.repository.receipts.size,2);
});
