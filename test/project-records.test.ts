import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlatformHandler} from '../src/platform/http.ts';
import {PlatformError,validateInbox} from '../src/platform/domain.ts';
import {DraftService} from '../src/platform/service.ts';
import {MemoryPort} from './helpers/platform.ts';
import type {Principal} from '../src/platform/contracts.ts';

const owner={id:'synthetic-project-owner',email:'project@example.invalid'},baseURL='http://127.0.0.1:3002';
const pending={decision:'pending',evidence:null};
const metadata=()=>({type:'project',syntheticOnly:true,stage:'idea',nextStep:null,completion:{selfReported:true,status:'not-complete',evidence:null},testing:{manuallyRecorded:true,outcome:'not-run',evidence:null},review:{...pending},links:[]});
const command=(record:unknown=metadata())=>({title:'Synthetic project',text:'Original synthetic project description',occurredOn:null,record,confirmed:true,syntheticOnly:true});
const review=(expectedRevision=1)=>({expectedRevision,decision:'accepted',evidence:'Synthetic user review evidence',confirmed:true,syntheticOnly:true});
function setup(){
 const repository=new MemoryPort();let principal:Principal|null={userId:owner.id,email:owner.email};
 const handler=createPlatformHandler({repository,sessions:{read:async()=>principal},owner,baseURL});let keys=0;
 return{repository,handler,setPrincipal:(p:Principal|null)=>{principal=p;},async send(path:string,method='GET',body?:unknown,key='project-command-'+(++keys),headers:Record<string,string>={}){
  const response=await handler(new Request(baseURL+'/api/platform/'+path,{method,headers:{host:'127.0.0.1:3002',origin:baseURL,'content-type':'application/json','idempotency-key':key,...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}));
  return{response,status:response.status,body:await response.json()};
 }};
}
const assert400=(run:()=>unknown)=>assert.throws(run,(e:unknown)=>e instanceof PlatformError&&e.status===400);

test('project metadata uses existing inbox JSON and keeps completion, manual tests and user review independent',()=>{
 for(const stage of ['idea','planned','active','paused','closed']){
  const record={...metadata(),stage};
  assert.deepEqual(validateInbox({title:'Synthetic project',disposition:'reference',record}).record,record);
 }
 const {review:unused,...raw}=metadata();void unused;
 const normalized=validateInbox({title:'Synthetic project',disposition:'reference',record:{...raw,nextStep:'  Synthetic next action  '}}).record;
 assert.deepEqual(normalized,{...metadata(),nextStep:'Synthetic next action'});
});

test('project validation rejects fabricated verification, missing evidence and unknown review fields',()=>{
 for(const record of [
  {...metadata(),stage:'done'}, {...metadata(),stage:undefined}, {...metadata(),syntheticOnly:false},
  {...metadata(),completion:{selfReported:false,status:'complete',evidence:'Claim'}},
  {...metadata(),completion:{selfReported:true,status:'complete',evidence:' '}},
  {...metadata(),completion:{selfReported:true,status:'verified',evidence:'Claim'}},
  {...metadata(),testing:{manuallyRecorded:false,outcome:'passed',evidence:'Claim'}},
  {...metadata(),testing:{manuallyRecorded:true,outcome:'passed',evidence:null}},
  {...metadata(),testing:{manuallyRecorded:true,outcome:'verified',evidence:'Claim'}},
  {...metadata(),testing:{manuallyRecorded:true,outcome:'passed',evidence:'Claim',systemVerified:true}},
  {...metadata(),review:{decision:'accepted',evidence:null}},
  {...metadata(),review:{decision:'pending',evidence:'Unexpected old decision evidence'}},
  {...metadata(),review:{decision:'pending',evidence:null,acceptedBy:'forged'}},
  {...metadata(),nextStep:'x'.repeat(4001)},
 ])assert400(()=>validateInbox({title:'Synthetic project',disposition:'reference',record}));
});

test('project writes preserve original source and require opt-in reads without creating another record store',async()=>{
 const f=setup(),raw=command({...metadata(),nextStep:'  Synthetic next action  '}),created=await f.send('records/project','POST',raw,'project-create-fixed');
 assert.equal(created.status,201);const entry=created.body.entry,id=entry.id;
 assert.equal(entry.kind,'inbox');assert.equal(entry.draft.disposition,'reference');assert.equal(entry.draft.record.nextStep,'Synthetic next action');
 assert.deepEqual(entry.source.original,{title:raw.title,text:raw.text,occurredOn:null,record:raw.record,disposition:'reference'});
 assert.equal('ownerId' in entry,false);assert.equal(entry.syncState,'draft');
 for(const prefix of ['records/project','inbox']){
  assert.deepEqual((await f.send(prefix)).body.items,[]);
  for(const suffix of ['', '/history'])assert.equal((await f.send(prefix+'/'+id+suffix)).status,404);
  assert.equal((await f.send(prefix+'/'+id+'?includeSynthetic=true')).body.entry.id,id);
 }
 assert.equal((await f.send('records/project?includeSynthetic=true')).body.items.length,1);
 const replay=await f.send('records/project','POST',raw,'project-create-fixed');assert.equal(replay.status,200);assert.equal(replay.body.duplicate,true);
 assert.equal(f.repository.rows.size,1);assert.equal(f.repository.historyRows.length,1);assert.equal(f.repository.receipts.size,1);
});

test('explicit project review is atomic, revisioned and retryable after a later update',async()=>{
 const f=setup(),created=await f.send('records/project','POST',command());assert.equal(created.status,201);const id=created.body.entry.id;
 const accepted=await f.send('records/project/'+id+'/review','POST',review(),'project-review-fixed');assert.equal(accepted.status,200);
 assert.equal(accepted.body.entry.revision,2);assert.deepEqual(accepted.body.entry.source,created.body.entry.source);
 assert.deepEqual(accepted.body.entry.draft.record.review,{decision:'accepted',evidence:'Synthetic user review evidence'});
 assert.deepEqual(accepted.body.entry.draft.record.completion,metadata().completion);assert.deepEqual(accepted.body.entry.draft.record.testing,metadata().testing);
 const edited=await f.send('records/project/'+id,'PATCH',{...command(),text:'Substantive correction',expectedRevision:2});assert.equal(edited.status,200);assert.deepEqual(edited.body.entry.draft.record.review,pending);
 const replay=await f.send('records/project/'+id+'/review','POST',review(),'project-review-fixed');assert.equal(replay.status,200);assert.equal(replay.body.duplicate,true);assert.deepEqual(replay.body.entry,accepted.body.entry);
 const changed=await f.send('records/project/'+id+'/review','POST',{...review(),decision:'rejected'},'project-review-fixed');assert.equal(changed.status,409);assert.equal(changed.body.error.code,'COMMAND_CONFLICT');
 const stale=await f.send('records/project/'+id+'/review','POST',review());assert.equal(stale.status,409);assert.equal(stale.body.error.code,'REVISION_CONFLICT');
 const history=await f.send('records/project/'+id+'/history?includeSynthetic=true');assert.deepEqual(history.body.history.map((e:any)=>[e.revision,e.draft.record.review.decision]),[[3,'pending'],[2,'accepted'],[1,'pending']]);
 assert.equal(f.repository.rows.size,1);assert.equal(f.repository.historyRows.length,3);assert.equal(f.repository.receipts.size,3);
});

test('every substantive project field invalidates prior review while equivalent normalized edits preserve it',async()=>{
 const replacements=[
  {...command(),title:'New synthetic title'}, {...command(),text:'New synthetic body'}, {...command(),occurredOn:'2026-10-23'},
  command({...metadata(),stage:'closed'}), command({...metadata(),nextStep:'Synthetic next step'}),
  command({...metadata(),completion:{selfReported:true,status:'complete',evidence:'Self-reported synthetic evidence'}}),
  command({...metadata(),testing:{manuallyRecorded:true,outcome:'passed',evidence:'Manually recorded synthetic evidence'}}),
 ];
 for(const replacement of replacements){
  const f=setup(),created=await f.send('records/project','POST',command());assert.equal(created.status,201);const id=created.body.entry.id;
  const accepted=await f.send('records/project/'+id+'/review','POST',review());assert.equal(accepted.status,200);
  const unchanged=await f.send('records/project/'+id,'PATCH',{...command(),title:'  Synthetic project  ',expectedRevision:2});assert.equal(unchanged.status,200);assert.equal(unchanged.body.entry.draft.record.review.decision,'accepted');
  const edited=await f.send('records/project/'+id,'PATCH',{...replacement,expectedRevision:3});assert.equal(edited.status,200);assert.deepEqual(edited.body.entry.draft.record.review,pending);
  assert.deepEqual(edited.body.entry.source,created.body.entry.source);
 }
});

test('ordinary commands and generic inbox cannot forge accepted or rejected project decisions',async()=>{
 const f=setup();
 for(const decision of ['accepted','rejected']){
  const forged=command({...metadata(),review:{decision,evidence:'Forged acceptance'}});
  const result=await f.send('records/project','POST',forged);assert.equal(result.status,400);assert.equal(result.body.error.code,'PROJECT_REVIEW_ACTION_REQUIRED');
 }
 const created=await f.send('records/project','POST',command());assert.equal(created.status,201);const id=created.body.entry.id;
 for(const decision of ['accepted','rejected'])assert.equal((await f.send('records/project/'+id,'PATCH',{...command({...metadata(),review:{decision,evidence:'Forged'}}),expectedRevision:1})).status,400);
 for(const body of [{record:metadata()},{record:null},{text:'Forged bypass'}])assert.equal((await f.send('inbox/'+id,'PATCH',{...body,expectedRevision:1})).body.error.code,'RECORD_ROUTE_REQUIRED');
 assert.equal((await f.send('inbox','POST',{title:'Injected',disposition:'reference',record:metadata()})).body.error.code,'RECORD_ROUTE_REQUIRED');
 assert.equal(f.repository.historyRows.length,1);assert.equal(f.repository.receipts.size,1);
});

test('AI capture and unconfirmed record commands cannot introduce project or review metadata',async()=>{
 const f=setup();
 for(const body of [{...command(),confirmed:false},{...command(),syntheticOnly:false},{...command(),ownerId:'forged'}])assert.equal((await f.send('records/project','POST',body)).status,400);
 const base={text:'Synthetic capture input',kind:'project',timeZone:'UTC',adapter:'manual'};
 assert.equal((await f.send('capture/preview','POST',base)).status,400);
 const confirmation={...base,fields:{title:'Synthetic project',body:'Synthetic body',date:null},confirmed:true,singleItem:true,syntheticOnly:true};
 assert.equal((await f.send('capture/confirm','POST',confirmation)).status,400);
 assert.equal((await f.send('capture/confirm','POST',{...confirmation,kind:'life',fields:{...confirmation.fields,record:{...metadata(),review:{decision:'accepted',evidence:'Forged capture approval'}}}})).status,400);
 assert.equal(f.repository.rows.size,0);assert.equal(f.repository.historyRows.length,0);assert.equal(f.repository.receipts.size,0);
});

test('review decision requires confirmed synthetic command and evidence, and accepts only explicit decision action',async()=>{
 const f=setup(),created=await f.send('records/project','POST',command());assert.equal(created.status,201);const id=created.body.entry.id,path='records/project/'+id+'/review';
 for(const body of [
  {...review(),confirmed:false}, {...review(),syntheticOnly:false}, {...review(),decision:'pending'},
  {...review(),evidence:' '}, {...review(),evidence:'x'.repeat(16385)}, {...review(),expectedRevision:0},
  {...review(),ownerId:'forged'}, {...review(),systemVerified:true}, {...review(),stage:'closed'},
 ])assert.equal((await f.send(path,'POST',body)).status,400);
 for(const method of ['GET','PATCH','DELETE'])assert.equal((await f.send(path,method)).status,405);
 assert.equal((await f.send('records/learning/'+id+'/review','POST',review())).status,404);
 const rejected=await f.send(path,'POST',{...review(),decision:'rejected',evidence:'  Synthetic rejection evidence  '});assert.equal(rejected.status,200);assert.deepEqual(rejected.body.entry.draft.record.review,{decision:'rejected',evidence:'Synthetic rejection evidence'});
 assert.equal(f.repository.historyRows.length,2);assert.equal(f.repository.receipts.size,2);
});

test('project routes derive owner from shared session and cross-owner IDs stay unavailable',async()=>{
 const f=setup(),created=await f.send('records/project','POST',command());assert.equal(created.status,201);const id=created.body.entry.id;
 f.setPrincipal(null);assert.equal((await f.send('records/project/'+id+'/review','POST',review())).status,401);
 f.setPrincipal({userId:'other-owner',email:owner.email});assert.equal((await f.send('records/project/'+id+'/review','POST',review())).status,403);
 f.setPrincipal({userId:owner.id,email:owner.email});f.repository.rows.get(id)!.ownerId='other-owner';
 for(const action of ['', '/history'])assert.equal((await f.send('records/project/'+id+action+'?includeSynthetic=true')).status,404);
 assert.equal((await f.send('records/project/'+id+'/review','POST',review())).status,404);
 assert.equal((await f.send('records/project/'+id,'PATCH',{...command(),expectedRevision:1})).status,404);
 assert.deepEqual((await f.send('records/project?includeSynthetic=true')).body.items,[]);
 assert.equal(f.repository.historyRows.length,1);assert.equal(f.repository.receipts.size,1);
});

test('concurrent project edit and review serialize one winner without orphan history or receipt',async()=>{
 const f=setup(),created=await f.send('records/project','POST',command());assert.equal(created.status,201);const id=created.body.entry.id;
 const results=await Promise.all([
  f.send('records/project/'+id+'/review','POST',review(),'project-race-review'),
  f.send('records/project/'+id,'PATCH',{...command(),text:'Concurrent synthetic change',expectedRevision:1},'project-race-edit'),
 ]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(f.repository.historyRows.length,2);assert.equal(f.repository.receipts.size,2);
});

test('review receipt failure rolls back the project decision and event in the existing transaction',async()=>{
 const f=setup(),created=await f.send('records/project','POST',command());assert.equal(created.status,201);const id=created.body.entry.id;
 const originalTransaction=f.repository.transaction.bind(f.repository);
 f.repository.transaction=(owner,key,run)=>originalTransaction(owner,key,tx=>run({...tx,saveReceipt:async()=>{throw Error('synthetic receipt failure');}}));
 const failed=await f.send('records/project/'+id+'/review','POST',review());assert.equal(failed.status,503);
 assert.equal(f.repository.rows.get(id)!.revision,1);assert.deepEqual((f.repository.rows.get(id)!.draft as any).record.review,pending);
 assert.equal(f.repository.historyRows.length,1);assert.equal(f.repository.receipts.size,1);assert.equal(f.repository.events.length,1);
});

test('project review keeps common origin, content and source identity boundaries closed',async()=>{
 const f=setup(),created=await f.send('records/project','POST',command());assert.equal(created.status,201);const id=created.body.entry.id,path='records/project/'+id+'/review';
 assert.equal((await f.send(path,'POST',review(),'project-bad-origin',{origin:'https://example.invalid'})).status,403);
 assert.equal((await f.send(path,'POST',review(),'project-bad-content',{'content-type':'text/plain'})).status,415);
 const legacy=await new DraftService(f.repository).mutate(owner.id,'inbox',null,{title:'Synthetic ordinary inbox'},'project-legacy-create');
 assert.equal((await f.send('records/project/'+legacy.entry.id+'/review','POST',review())).status,404);
 assert.equal(f.repository.historyRows.length,2);assert.equal(f.repository.receipts.size,2);
});
