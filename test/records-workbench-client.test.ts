import test from 'node:test';
import assert from 'node:assert/strict';
import {RecordsClient,RecordRequestError,createRecordCommand,parseRecordEntry} from '../src/records-workbench/client.ts';
import {RecordsSaveSession} from '../src/records-workbench/session.ts';
import {createRecordsCommandStore} from '../src/records-workbench/recovery.ts';
import {createRecordsReadFence,assertRecordReadback} from '../src/records-workbench/read-state.ts';
import type {RecordEntry,RecordFields,RecordType} from '../src/records-candidate/contracts.ts';
const id='11111111-1111-4111-8111-111111111111',sourceId='22222222-2222-4222-8222-222222222222';
const fields:RecordFields={title:'Synthetic learning',text:'Synthetic full body\n<script>escaped text</script>',occurredOn:null,record:{type:'learning',syntheticOnly:true,topic:'Synthetic topic',status:'active',nextStep:null,resourceURL:null}};
const fixture=(value:RecordFields=fields,revision=1):RecordEntry=>({id,kind:'inbox',draft:{...structuredClone(value),title:value.title.trim(),disposition:'reference'},revision,createdAt:'2026-10-23T00:00:00.000Z',updatedAt:'2026-10-23T00:00:00.000Z',source:{id:sourceId,system:'website',externalId:id,version:revision,asOf:'2026-10-23T00:00:00.000Z',original:{...structuredClone(value),disposition:'reference'}},syncState:'draft',externalStatus:null});
const response=(entry=fixture(),duplicate=false)=>Response.json({entry,duplicate});
function harness(write:(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>|Response=()=>response()){
 let owner='synthetic-records-owner';const calls:{path:string;init?:RequestInit}[]=[];
 const client=new RecordsClient(async(input,init)=>{if(String(input)==='/api/platform/auth/get-session')return Response.json({user:{id:owner},session:{userId:owner}});calls.push({path:String(input),init});return write(input,init);});
 return {client,calls,changeOwner(){owner='different-synthetic-owner';}};
}
const command=(value=fields)=>createRecordCommand(value,null,'records-test-command',true,'synthetic-records-owner');
function storageHarness(){const data=new Map<string,string>();return {data,storage:{getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);},removeItem:(key:string)=>{data.delete(key);}}};}

test('confirmation and complete category validation precede command creation',()=>{
 assert.throws(()=>createRecordCommand(fields,null,'records-confirm-no',false,'synthetic-records-owner'));
 assert.throws(()=>command({...fields,record:{...fields.record,status:''} as unknown as RecordFields['record']}));
 assert.throws(()=>command({...fields,occurredOn:'2026-02-30'}));
 assert.throws(()=>command({...fields,record:{type:'resource',syntheticOnly:true,url:'javascript:alert(1)',author:null}}));
 assert.throws(()=>createRecordCommand(fields,{id,revision:1,type:'career'},'records-wrong-type',true,'synthetic-records-owner'));
 assert.equal(Object.isFrozen(command()),true);assert.equal(JSON.parse(command().body).confirmed,true);
});

test('read boundaries demand explicit synthetic scope and exact requested record type and identity',async()=>{
 const h=harness(()=>Response.json({items:[fixture()],dataStatus:'isolated-test-drafts',syntheticIncluded:true}));
 assert.equal((await h.client.list('learning')).length,1);assert.equal(h.calls[0].path,'/api/platform/records/learning?includeSynthetic=true');
 assert.equal(h.calls[0].init?.credentials,'same-origin');assert.equal(h.calls[0].init?.cache,'no-store');
 await assert.rejects(()=>h.client.list('career'),RecordRequestError);
 await assert.rejects(()=>new RecordsClient(async()=>Response.json({items:[],syntheticIncluded:false,dataStatus:'isolated-test-drafts'})).list('learning'),RecordRequestError);
 const other={...fixture(),id:sourceId};await assert.rejects(()=>harness(()=>response(other)).client.detail('learning',id),RecordRequestError);
});

test('malformed provenance, partial drafts and private owner fields are never rendered as records',()=>{
 for(const value of [{...fixture(),ownerId:'forbidden'},{...fixture(),source:{...fixture().source,externalId:sourceId}},{...fixture(),source:{...fixture().source,id:'bad'}},{...fixture(),createdAt:'yesterday'},{...fixture(),draft:{title:'Incomplete'}},{...fixture(),source:{...fixture().source,original:{}}}])assert.throws(()=>parseRecordEntry(value,'learning'));
});

test('history rejects a foreign type, wrong ID and missing limit',async()=>{
 for(const payload of [{history:[{...fixture(),id:sourceId}],limit:100},{history:[fixture({...fields,record:{type:'career',syntheticOnly:true,evidence:'Synthetic evidence',nextStep:null}})],limit:100},{history:[fixture()]}])await assert.rejects(()=>harness(()=>Response.json(payload)).client.history('learning',id),RecordRequestError);
});

test('frozen command survives an uncertain save, navigation reconstruction and later auth loss',async()=>{
 let count=0;const h=harness(()=>{count++;if(count===1)throw Error('Synthetic lost response');if(count===2)return Response.json({error:{code:'LOGIN_REQUIRED',message:'untrusted'}},{status:401});return response(fixture(),true);});
 const {storage,data}=storageHarness(),store=createRecordsCommandStore(storage),first=new RecordsSaveSession(h.client,()=> 'records-lost-key',store);
 const mutable=structuredClone(fields);await first.save(mutable,null,true);mutable.title='Later mutation';assert.equal(first.getSnapshot().phase,'uncertain');
 const restored=new RecordsSaveSession(h.client,()=> 'never-new-key',store);await restored.retry();assert.equal(restored.getSnapshot().phase,'uncertain');assert.equal(restored.getSnapshot().error?.status,401);
 assert.throws(()=>restored.reset());await assert.rejects(()=>restored.save(mutable,null,true));await restored.retry();
 assert.equal(restored.getSnapshot().phase,'saved');assert.equal(restored.getSnapshot().result?.duplicate,true);assert.equal(data.size,0);
 assert.equal(h.calls[0].init?.body,h.calls[1].init?.body);assert.equal(h.calls[1].init?.body,h.calls[2].init?.body);
 assert.equal(new Headers(h.calls[2].init?.headers).get('idempotency-key'),'records-lost-key');
});

test('a different authenticated account cannot replay the retained command',async()=>{
 const h=harness(()=>{throw Error('lost');}),{storage}=storageHarness();const session=new RecordsSaveSession(h.client,()=> 'records-owner-key',createRecordsCommandStore(storage));
 await session.save(fields,null,true);h.changeOwner();await session.retry();
 assert.equal(h.calls.length,1);assert.equal(session.getSnapshot().phase,'uncertain');assert.equal(session.getSnapshot().error?.code,'ACCOUNT_CHANGED');
});

test('every later negative response preserves an uncertain command including revision conflicts',async()=>{
 for(const [status,code]of [[400,'INVALID_TEXT'],[403,'ACCOUNT_NOT_ALLOWED'],[409,'REVISION_CONFLICT'],[409,'COMMAND_CONFLICT']]as const){
 let count=0;const h=harness(()=>{if(++count===1)throw Error('lost');return Response.json({error:{code,message:'Synthetic rejection'}},{status});});const session=new RecordsSaveSession(h.client,()=> 'records-retain-'+status+code);
 await session.save(fields,null,true);await session.retry();assert.equal(session.getSnapshot().phase,'uncertain');assert.ok(session.getSnapshot().pending);
 }
});

test('initial structured rejection releases the command while malformed rejection does not',async()=>{
 const h=harness(()=>Response.json({error:{code:'REVISION_CONFLICT',message:'Synthetic conflict'}},{status:409}));const session=new RecordsSaveSession(h.client,()=> 'records-conflict-key');
 await session.save(fields,{id,revision:1,type:'learning'},true);assert.equal(session.getSnapshot().phase,'conflict');assert.equal(session.getSnapshot().pending,null);assert.ok(session.getSnapshot().attempt?.body.includes(fields.text.replaceAll('\n','\\n')));session.reset();
 for(const response of [()=>new Response('proxy',{status:400}),()=>new Response(null,{status:503}),()=>Response.json({duplicate:false,entry:{}})]){const broken=new RecordsSaveSession(harness(response).client,()=> 'records-broken-key');await broken.save(fields,null,true);assert.equal(broken.getSnapshot().phase,'uncertain');}
});

test('successful receipts must match body, revision, original input and target',async()=>{
 const valid=fixture();for(const value of [{...valid,draft:{...valid.draft,text:'Other content'}},{...valid,revision:2},{...valid,source:{...valid.source,original:{...valid.source.original as object,title:'Other original'}}}])await assert.rejects(()=>harness(()=>response(value)).client.send(command()),error=>error instanceof RecordRequestError&&error.uncertain);
 const spaced={...fields,title:'  Synthetic learning  '};const h=harness(()=>response(fixture(spaced)));assert.equal((await h.client.send(command(spaced))).entry.draft.title,'Synthetic learning');
 const edit=createRecordCommand(fields,{id,revision:2,type:'learning'},'records-patch-key',true,'synthetic-records-owner');await assert.rejects(()=>harness(()=>response(fixture(fields,2))).client.send(edit),RecordRequestError);
});

test('storage failure prevents send and corrupt or retargeted recovery prevents reconstruction',async()=>{
 const h=harness(),session=new RecordsSaveSession(h.client,()=> 'records-store-key',{load:()=>null,keep:()=>{throw Error('Unavailable');},clear:()=>{}});
 await assert.rejects(()=>session.save(fields,null,true));assert.equal(h.calls.length,0);
 for(const mutate of [(value:Record<string,unknown>)=>({...value,path:'https://example.invalid/steal'}),(value:Record<string,unknown>)=>({...value,method:'DELETE'}),(value:Record<string,unknown>)=>({...value,ownerId:''}),(value:Record<string,unknown>)=>({...value,body:JSON.stringify({...JSON.parse(String(value.body)),confirmed:false})})]){
 const {storage,data}=storageHarness(),store=createRecordsCommandStore(storage);store.keep(command());const key=[...data.keys()][0];storage.setItem(key,JSON.stringify(mutate(command())));assert.throws(()=>new RecordsSaveSession(h.client,undefined,store));
 }
});

test('read fences invalidate stale reads on selection, auth loss and unmount',()=>{
 const fence=createRecordsReadFence(),list=fence.begin('list'),detail=fence.begin('detail'),history=fence.begin('history'),readback=fence.begin('readback');
 fence.invalidate('detail','history','readback');assert.equal(list(),true);assert.equal(detail(),false);assert.equal(history(),false);assert.equal(readback(),false);
 const latest=fence.begin('detail');fence.invalidate();assert.equal(list(),false);assert.equal(latest(),false);const next=fence.begin('list');fence.dispose();assert.equal(next(),false);
});

test('all category forms start empty and require the user to choose required signals',async()=>{
 const {emptyRecordForm,formToFields,fieldsToForm}=await import('../src/records-workbench/fields.ts');
 for(const type of ['learning','career','mood','article','resource']as const){const form=emptyRecordForm(type);assert.equal(form.title,'');assert.equal(form.occurredOn,'');assert.equal(form.status,'');assert.equal(form.attribution,'');assert.equal(form.intensity,'');assert.throws(()=>formToFields(form));}
 const form=fieldsToForm(fields);form.title='  Synthetic original title  ';const result=formToFields(form);assert.equal(result.title,form.title);assert.equal(result.occurredOn,null);
 assert.throws(()=>formToFields({...emptyRecordForm('mood'),title:'Synthetic mood',label:'Synthetic calm',intensity:'1.5'}));
 assert.equal(formToFields({...emptyRecordForm('mood'),title:'Synthetic mood',label:'Synthetic calm'}).record.type,'mood');
});

test('double submission during account verification cannot issue two mutations',async()=>{
 let resolveIdentity:((response:Response)=>void)|undefined,calls=0;const client=new RecordsClient(async(input)=>{if(String(input).endsWith('get-session')){if(!resolveIdentity)return new Promise<Response>(resolve=>{resolveIdentity=resolve;});return Response.json({user:{id:'synthetic-records-owner'},session:{userId:'synthetic-records-owner'}});}calls++;return response();});
 const session=new RecordsSaveSession(client,()=> 'records-double-key');const first=session.save(fields,null,true);await assert.rejects(()=>session.save(fields,null,true));resolveIdentity!(Response.json({user:{id:'synthetic-records-owner'},session:{userId:'synthetic-records-owner'}}));await first;assert.equal(calls,1);
});


test('same-revision readback rejects any changed saved field before reporting completion',()=>{
 const receipt=fixture();assert.doesNotThrow(()=>assertRecordReadback(receipt,structuredClone(receipt)));
 for(const patch of [{title:'Other title'},{text:'Other complete body'},{occurredOn:'2026-10-22'},{record:{...receipt.draft.record,topic:'Other topic'}}]){
  const current={...structuredClone(receipt),draft:{...receipt.draft,...patch}} as RecordEntry;
  assert.throws(()=>assertRecordReadback(receipt,current),/回读与保存回执不一致/);
 }
});

test('newer readback permits a new draft only with identical immutable source and record identity',()=>{
 const receipt=fixture(),current={...structuredClone(receipt),revision:2,draft:{...receipt.draft,text:'Synthetic later correction'}};
 assert.doesNotThrow(()=>assertRecordReadback(receipt,current));
 for(const changed of [{...current,id:sourceId},{...current,revision:0},{...current,source:{...current.source,id}},{...current,source:{...current.source,version:2}},{...current,source:{...current.source,asOf:'2026-10-24T00:00:00.000Z'}},{...current,source:{...current.source,original:{...fields,title:'Different original',disposition:'reference'}}}])assert.throws(()=>assertRecordReadback(receipt,changed),/回读与保存回执不一致/);
 const reordered={...current,source:{...current.source,original:{disposition:'reference',record:fields.record,occurredOn:null,text:fields.text,title:fields.title}}};assert.doesNotThrow(()=>assertRecordReadback(receipt,reordered));
});

test('account change after mutation response preserves the command instead of claiming saved',async()=>{
 const h=harness(()=>{h.changeOwner();return response();}),{storage,data}=storageHarness();
 const session=new RecordsSaveSession(h.client,()=> 'records-post-response-owner',createRecordsCommandStore(storage));
 await session.save(fields,null,true);assert.equal(session.getSnapshot().phase,'uncertain');assert.equal(session.getSnapshot().error?.code,'ACCOUNT_CHANGED');assert.equal(session.getSnapshot().pending?.key,'records-post-response-owner');assert.equal(data.size,1);
});

test('list, detail and history discard responses if authenticated identity changes during each read',async()=>{
 for(const action of ['list','detail','history']as const){const h=harness(()=>{h.changeOwner();return Response.json(action==='list'?{items:[fixture()],dataStatus:'isolated-test-drafts',syntheticIncluded:true}:action==='detail'?{entry:fixture()}:{history:[fixture()],limit:100});});
  await assert.rejects(()=>action==='list'?h.client.list('learning'):action==='detail'?h.client.detail('learning',id):h.client.history('learning',id),error=>error instanceof RecordRequestError&&error.code==='ACCOUNT_CHANGED'&&!error.uncertain);
 }
});

test('authentication loss after a committed response retains exact retry through verification failure',async()=>{
 for(const identityFailure of [()=>Response.json(null),()=>Response.json({error:{code:'AUTH_UNAVAILABLE',message:'Synthetic unavailable'}},{status:503})]){
  let reads=0,writes=0;const {storage,data}=storageHarness();
  const client=new RecordsClient(async(input)=>{if(String(input).endsWith('get-session'))return ++reads>2?identityFailure():Response.json({user:{id:'synthetic-records-owner'},session:{userId:'synthetic-records-owner'}});writes++;return response();});
  const session=new RecordsSaveSession(client,()=> 'records-post-commit-auth',createRecordsCommandStore(storage));await session.save(fields,null,true);
  assert.equal(writes,1);assert.equal(session.getSnapshot().phase,'uncertain');assert.equal(session.getSnapshot().pending?.body,command().body);assert.equal(data.size,1);assert.equal(session.getSnapshot().error?.uncertain,true);
 }
});
