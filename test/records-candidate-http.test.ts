import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlatformHandler} from '../src/platform/http.ts';
import {DraftService} from '../src/platform/service.ts';
import {MemoryPort} from './helpers/platform.ts';
import type {Principal} from '../src/platform/contracts.ts';

const owner={id:'synthetic-records-owner',email:'records@example.invalid'},baseURL='http://127.0.0.1:3002';
const metadata=[
 {type:'learning',syntheticOnly:true,topic:'Synthetic topic',status:'planned',nextStep:null,resourceURL:null},
 {type:'career',syntheticOnly:true,evidence:'Synthetic evidence',nextStep:null},
 {type:'mood',syntheticOnly:true,label:'Self-reported synthetic calm',intensity:3},
 {type:'article',syntheticOnly:true,author:null,attribution:'summary',sourceURL:'https://example.invalid/source'},
 {type:'resource',syntheticOnly:true,url:'https://example.invalid/reference',author:null},
];
const command=(record:unknown=metadata[0])=>({title:'Synthetic reference',text:'Original synthetic text',occurredOn:null,record,confirmed:true,syntheticOnly:true});
function setup(){
 const repository=new MemoryPort();let principal:Principal|null={userId:owner.id,email:owner.email};
 const handler=createPlatformHandler({repository,sessions:{read:async()=>principal},owner,baseURL});let keys=0;
 return{repository,handler,setPrincipal:(p:Principal|null)=>{principal=p;},async send(path:string,method='GET',body?:unknown,key='records-command-'+(++keys),headers:Record<string,string>={}){
  const response=await handler(new Request(baseURL+'/api/platform/'+path,{method,headers:{host:'127.0.0.1:3002',origin:baseURL,'content-type':'application/json','idempotency-key':key,...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}));
  return{response,status:response.status,body:await response.json()};
 }};
}

test('all typed record routes create one inbox authority, isolate types and require explicit synthetic reads',async()=>{
 const f=setup();
 for(const record of metadata){
  const created=await f.send('records/'+record.type,'POST',command(record));assert.equal(created.status,201);
  const id=created.body.entry.id;assert.equal(created.body.entry.kind,'inbox');assert.equal(created.body.entry.draft.disposition,'reference');assert.deepEqual(created.body.entry.draft.record,record);
  assert.equal('ownerId' in created.body.entry,false);assert.equal(created.body.entry.syncState,'draft');
  assert.equal((await f.send('records/'+record.type+'/'+id)).status,404);
  assert.equal((await f.send('records/'+record.type+'/'+id+'/history')).status,404);
  assert.equal((await f.send('records/'+record.type+'/'+id+'?includeSynthetic=true')).body.entry.id,id);
  assert.deepEqual((await f.send('records/'+record.type)).body.items,[]);
  assert.deepEqual((await f.send('records/'+record.type+'?includeSynthetic=1')).body.items,[]);
  const list=await f.send('records/'+record.type+'?includeSynthetic=true');assert.deepEqual(list.body.items.map((e:{id:string})=>e.id),[id]);assert.equal(list.body.syntheticIncluded,true);
  assert.equal(list.response.headers.get('Cache-Control'),'private, no-store');assert.equal(list.response.headers.get('Vary'),'Cookie');assert.equal(list.response.headers.get('X-Content-Type-Options'),'nosniff');
  const edited=await f.send('records/'+record.type+'/'+id,'PATCH',{...command(record),title:'Synthetic correction '+record.type,expectedRevision:1});assert.equal(edited.status,200);assert.equal(edited.body.entry.revision,2);assert.deepEqual(edited.body.entry.draft.record,record);
  const history=await f.send('records/'+record.type+'/'+id+'/history?includeSynthetic=true');assert.deepEqual(history.body.history.map((e:{revision:number})=>e.revision),[2,1]);
 }
 assert.equal(f.repository.rows.size,5);assert.equal(f.repository.historyRows.length,10);assert.equal(f.repository.receipts.size,10);
});
test('typed commands preserve raw source and share idempotency, immutable original, history and compare-and-swap',async()=>{
 const f=setup(),raw=command({...metadata[0],topic:'  Synthetic topic  ',nextStep:'  '}),created=await f.send('records/learning','POST',raw,'records-create-fixed');assert.equal(created.status,201);const id=created.body.entry.id;
 const original={title:raw.title,text:raw.text,occurredOn:null,record:raw.record,disposition:'reference'};
 assert.deepEqual(created.body.entry.source.original,original);assert.equal(created.body.entry.draft.record.topic,'Synthetic topic');assert.equal(created.body.entry.draft.record.nextStep,null);
 const update={...command({...metadata[0],status:'done'}),text:'Corrected synthetic text',expectedRevision:1};
 const edited=await f.send('records/learning/'+id,'PATCH',update,'records-edit-fixed');assert.equal(edited.status,200);assert.equal(edited.body.entry.revision,2);assert.equal(edited.body.entry.source.id,created.body.entry.source.id);assert.deepEqual(edited.body.entry.source.original,original);
 const replay=await f.send('records/learning/'+id,'PATCH',update,'records-edit-fixed');assert.equal(replay.status,200);assert.equal(replay.body.duplicate,true);assert.deepEqual(replay.body.entry,edited.body.entry);
 const createReplay=await f.send('records/learning','POST',raw,'records-create-fixed');assert.equal(createReplay.status,200);assert.equal(createReplay.body.entry.revision,1);assert.equal(createReplay.body.duplicate,true);
 assert.equal((await f.send('records/learning','POST',{...raw,text:'Different raw'},'records-create-fixed')).status,409);
 assert.equal((await f.send('records/learning/'+id,'PATCH',update,'records-stale-edit')).status,409);
 const history=await f.send('records/learning/'+id+'/history?includeSynthetic=true');assert.equal(history.status,200);assert.equal(history.body.limit,100);assert.deepEqual(history.body.history.map((e:{revision:number})=>e.revision),[2,1]);assert.ok(history.body.history.every((e:{source:{original:unknown}})=>JSON.stringify(e.source.original)===JSON.stringify(original)));
 assert.equal(f.repository.rows.size,1);assert.equal(f.repository.historyRows.length,2);assert.equal(f.repository.receipts.size,2);
});
test('typed full replacements clear omitted body and date while preserving raw source and exact-command receipts',async()=>{
 const f=setup();
 for(const record of metadata){
  const raw={...command(record),text:'Previous synthetic text',occurredOn:'2026-10-22'};
  const created=await f.send('records/'+record.type,'POST',raw),id=created.body.entry.id;
  const replacement={title:'  Synthetic replacement  ',record,confirmed:true,syntheticOnly:true,expectedRevision:1},key='records-omitted-'+record.type;
  const edited=await f.send('records/'+record.type+'/'+id,'PATCH',replacement,key);assert.equal(edited.status,200);
  assert.equal(edited.body.entry.draft.title,'Synthetic replacement');assert.equal(edited.body.entry.draft.text,'');assert.equal(edited.body.entry.draft.occurredOn,null);
  assert.deepEqual(edited.body.entry.source,created.body.entry.source);
  const replay=await f.send('records/'+record.type+'/'+id,'PATCH',replacement,key);assert.equal(replay.status,200);assert.equal(replay.body.duplicate,true);assert.deepEqual(replay.body.entry,edited.body.entry);
  const equivalentButDifferentRaw=await f.send('records/'+record.type+'/'+id,'PATCH',{...replacement,text:'',occurredOn:null},key);assert.equal(equivalentButDifferentRaw.status,409);assert.equal(equivalentButDifferentRaw.body.error.code,'COMMAND_CONFLICT');
  const history=await f.send('records/'+record.type+'/'+id+'/history?includeSynthetic=true');assert.equal(history.body.history[0].draft.text,'');assert.equal(history.body.history[0].draft.occurredOn,null);assert.equal(history.body.history[1].draft.text,raw.text);assert.equal(history.body.history[1].draft.occurredOn,raw.occurredOn);
  const event=f.repository.events.at(-1) as {raw:Record<string,unknown>};assert.equal('text' in event.raw,false);assert.equal('occurredOn' in event.raw,false);assert.equal(event.raw.title,replacement.title);
 }
 assert.equal(f.repository.rows.size,5);assert.equal(f.repository.historyRows.length,10);assert.equal(f.repository.receipts.size,10);
});
test('generic inbox reads require synthetic opt-in for typed records while keeping legacy records and explicit export',async()=>{
 const f=setup(),legacy=await f.send('inbox','POST',{title:'Legacy synthetic inbox',text:'Legacy note'}),legacyId=legacy.body.entry.id;
 const typedIds:string[]=[];
 for(const record of metadata){const created=await f.send('records/'+record.type,'POST',command(record));assert.equal(created.status,201);typedIds.push(created.body.entry.id);}
 for(const query of ['', '?includeSynthetic=false','?includeSynthetic=1']){
  const list=await f.send('inbox'+query);assert.equal(list.status,200);assert.deepEqual(list.body.items.map((e:{id:string})=>e.id),[legacyId]);
  for(const id of typedIds)for(const suffix of ['', '/history']){const hidden=await f.send('inbox/'+id+suffix+query);assert.equal(hidden.status,404);assert.equal(hidden.body.error.code,'NOT_FOUND');assert.equal(hidden.response.headers.get('Cache-Control'),'private, no-store');}
 }
 const included=await f.send('inbox?includeSynthetic=true');assert.deepEqual(included.body.items.map((e:{id:string})=>e.id),[legacyId,...typedIds]);
 for(const id of typedIds)for(const suffix of ['', '/history'])assert.equal((await f.send('inbox/'+id+suffix+'?includeSynthetic=true')).status,200);
 assert.equal((await f.send('inbox/'+legacyId)).status,200);assert.equal((await f.send('inbox/'+legacyId+'/history')).status,200);
 const exported=await f.send('export');assert.equal(exported.status,200);for(const id of typedIds){assert.ok(exported.body.entries.some((e:{id:string})=>e.id===id));assert.ok(exported.body.history.some((e:{id:string})=>e.id===id));}
 assert.equal(f.repository.rows.size,6);assert.equal(f.repository.historyRows.length,6);assert.equal(f.repository.receipts.size,6);
});
test('concurrent updates serialize one winner and return conflict without an extra history event',async()=>{
 const f=setup(),created=await f.send('records/learning','POST',command()),id=created.body.entry.id;
 const results=await Promise.all(['a','b'].map(letter=>f.send('records/learning/'+id,'PATCH',{...command(),text:letter,expectedRevision:1},'records-race-'+letter)));
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(f.repository.historyRows.length,2);
});
test('URL references and markup stay inert source text and never fetch external content',async(t)=>{
 const fetch=t.mock.method(globalThis,'fetch',async()=>{throw Error('Unexpected external reference fetch');});
 const f=setup(),text='<script>syntheticExample()</script><img src="https://example.invalid/reference">';
 const created=await f.send('records/resource','POST',{...command(metadata[4]),text});assert.equal(created.status,201);
 assert.equal(created.body.entry.draft.text,text);assert.equal(created.body.entry.source.original.text,text);assert.equal(fetch.mock.callCount(),0);
});
test('owner, category and source identity hold across reads, writes, histories and export',async()=>{
 const f=setup(),created=await f.send('records/learning','POST',command()),id=created.body.entry.id;
 for(const action of ['','/history'])assert.equal((await f.send('records/career/'+id+action+'?includeSynthetic=true')).status,404);
 assert.equal((await f.send('records/career/'+id,'PATCH',{...command(metadata[1]),expectedRevision:1})).status,404);
 const legacy=await new DraftService(f.repository).mutate(owner.id,'inbox',null,{title:'Legacy synthetic',text:'Legacy'},'records-legacy-create');
 assert.equal((await f.send('records/learning/'+legacy.entry.id+'?includeSynthetic=true')).status,404);
 assert.equal((await f.send('records/learning/'+legacy.entry.id,'PATCH',{...command(),expectedRevision:1})).status,404);
 const ownExport=await f.send('export');assert.ok(ownExport.body.entries.some((e:{id:string})=>e.id===id));assert.ok(ownExport.body.history.some((e:{id:string})=>e.id===id));
 f.repository.rows.get(id)!.ownerId='synthetic-other-owner';
 for(const action of ['','/history'])assert.equal((await f.send('records/learning/'+id+action+'?includeSynthetic=true')).status,404);
 assert.equal((await f.send('records/learning/'+id,'PATCH',{...command(),expectedRevision:1})).status,404);
 assert.deepEqual((await f.send('records/learning?includeSynthetic=true')).body.items,[]);
 const exported=await f.send('export');assert.ok(!exported.body.entries.some((e:{id:string})=>e.id===id));assert.ok(!exported.body.history.some((e:{id:string})=>e.id===id));assert.equal(exported.body.backupOrRestoreVerified,false);
 assert.equal(f.repository.historyRows.length,2);
});
test('generic inbox mutations cannot create, retag, remove metadata, edit unconfirmed or turn typed records into tasks',async()=>{
 const f=setup(),created=await f.send('records/learning','POST',command()),id=created.body.entry.id;
 const inbox={title:'Synthetic bypass',text:'Unconfirmed',occurredOn:null,disposition:'reference',record:metadata[0]};
 assert.equal((await f.send('inbox','POST',inbox)).status,400);
 for(const patch of [{record:metadata[1]},{record:null},{record:metadata[0]},{text:'Unconfirmed edit'},{disposition:'pending'}]){
  const r=await f.send('inbox/'+id,'PATCH',{expectedRevision:1,...patch});assert.equal(r.status,400);assert.equal(r.body.error.code,'RECORD_ROUTE_REQUIRED');
 }
 assert.equal((await f.send('inbox/'+id+'/to-todo','POST',{expectedRevision:1})).status,409);
 assert.equal(f.repository.rows.size,1);assert.equal(f.repository.historyRows.length,1);assert.equal(f.repository.receipts.size,1);
});
test('cancelled, invalid or wrong-method commands produce no rows, history or receipts',async()=>{
 const f=setup();
 for(const body of [{...command(),confirmed:false},{...command(),syntheticOnly:false},{...command(),ownerId:'forged'},{...command(),disposition:'pending'},{...command(),record:metadata[1]},{...command(),record:{...metadata[0],unknown:1}},{...command(),occurredOn:'2026-02-30'},{...command(),expectedRevision:1}])assert.equal((await f.send('records/learning','POST',body)).status,400);
 assert.equal((await f.send('records/unknown','POST',command())).status,400);
 assert.equal((await f.send('records/learning','DELETE')).status,405);
 assert.equal((await f.send('records/learning/11111111-1111-4111-8111-111111111111/history','POST',command())).status,405);
 assert.equal(f.repository.rows.size,0);assert.equal(f.repository.historyRows.length,0);assert.equal(f.repository.receipts.size,0);
});
test('shared identity, host, Origin, JSON/body-size and storage failure boundaries stay closed',async()=>{
 const f=setup();
 f.setPrincipal(null);assert.equal((await f.send('records/learning','POST',command())).status,401);
 f.setPrincipal({userId:'other',email:owner.email});assert.equal((await f.send('records/learning','POST',command())).status,403);
 f.setPrincipal({userId:owner.id,email:'other@example.invalid'});assert.equal((await f.send('records/learning','POST',command())).status,403);
 f.setPrincipal({userId:owner.id,email:owner.email});
 assert.equal((await f.send('records/learning','POST',command(),'records-bad-origin',{origin:'https://example.invalid'})).status,403);
 assert.equal((await f.send('records/learning','POST',command(),'records-bad-host',{host:'example.invalid'})).status,403);
 assert.equal((await f.send('records/learning','POST',command(),'records-bad-content',{'content-type':'text/plain'})).status,415);
 assert.equal((await f.send('records/learning','POST',{...command(),text:'x'.repeat(131073)})).status,413);
 const malformed=await f.handler(new Request(baseURL+'/api/platform/records/learning',{method:'POST',headers:{host:'127.0.0.1:3002',origin:baseURL,'content-type':'application/json'},body:'{'}));assert.equal(malformed.status,400);
 assert.equal(f.repository.rows.size,0);assert.equal(f.repository.historyRows.length,0);assert.equal(f.repository.receipts.size,0);
 f.repository.fail=true;const failed=await f.send('records/learning','POST',command());assert.equal(failed.status,503);assert.equal(failed.body.error.code,'STORAGE_UNAVAILABLE');assert.ok(!JSON.stringify(failed.body).includes('fixture-private'));
});
