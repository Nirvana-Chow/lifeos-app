import test from 'node:test';
import assert from 'node:assert/strict';
import {JournalMutationSession,makeJournalCreate,makeJournalUpdate,readJournalList,readJournalDetail,createJournalDetailFence} from '../src/journal-candidate/client.ts';
import type {PublicEntry} from '../src/platform/contracts.ts';

const id='01607246-d521-4b12-8cf3-465ad4b4f505';
const entry=(revision=1):PublicEntry=>({id,kind:'inbox',draft:{title:'虚构日记',text:'【虚构】读书记录',occurredOn:null,disposition:'reference'},source:{id:'557327ba-8ea7-4231-84ed-67a89d5c807e',system:'website',externalId:id,version:1,asOf:'2026-10-23T01:00:00Z',original:{inputText:'【虚构】读书记录',capture:{kind:'life',workflow:'single-record-v1'}}},revision,createdAt:'2026-10-23T01:00:00Z',updatedAt:'2026-10-23T01:00:00Z',syncState:'draft',externalStatus:null});
const fields={title:'虚构日记',text:'【虚构】读书记录',occurredOn:''};
const create=()=>makeJournalCreate(fields,'journal-fixture-key-01','UTC',true);
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
function store(){const data=new Map<string,string>();return {data,getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);},removeItem:(key:string)=>{data.delete(key);}};}
test('starting a new journal or changing its scope invalidates a delayed detail response',async()=>{
 const fence=createJournalDetailFence();let resolve!:(value:PublicEntry)=>void;
 const old=new Promise<PublicEntry>(r=>resolve=r),accept=fence.begin();let selected:PublicEntry|null=null;
 const pending=old.then(value=>{if(accept())selected=value;});fence.invalidate();resolve(entry());await pending;assert.equal(selected,null);
 const current=fence.begin();assert.equal(current(),true);fence.invalidate();assert.equal(current(),false);
});

test('new journal commands keep unknown dates unknown and reject impossible dates or missing synthetic consent',()=>{
 const command=create();assert.equal(command.body.fields.date,null);assert.equal(command.body.text,fields.text);assert.equal(command.body.kind,'life');
 assert.throws(()=>makeJournalCreate({...fields,occurredOn:'2026-02-30'},'journal-fixture-key-01','UTC',true));
 assert.throws(()=>makeJournalCreate(fields,'journal-fixture-key-01','UTC',false));
 assert.throws(()=>makeJournalCreate(fields,'journal-fixture-key-01','invented-zone',true));
});
test('uncertain saves freeze the original serialized command, block another command and retry the same request',async()=>{
 const requests:{url:string;init:RequestInit|undefined}[]=[];let attempt=0;
 const session=new JournalMutationSession({fetcher:async(url,init)=>{requests.push({url:String(url),init});if(attempt++===0)throw Error('response lost');return response({entry:entry(),duplicate:true});}});
 const command=create();await session.submit(command);assert.equal(session.getSnapshot().phase,'uncertain');
 command.body.fields.body='changed after submission';await session.submit(makeJournalCreate({...fields,text:'different'},'journal-fixture-key-02','UTC',true));assert.equal(requests.length,1);
 await session.retry();assert.equal(session.getSnapshot().phase,'saved');assert.equal(requests.length,2);assert.equal(requests[0].init?.body,requests[1].init?.body);assert.deepEqual(requests[0].init?.headers,requests[1].init?.headers);assert.equal(JSON.parse(String(requests[1].init?.body)).fields.body,'【虚构】读书记录');assert.equal(session.getSnapshot().pending,null);
});
test('first explicit revision conflict releases the command but retains rejection information',async()=>{
 const session=new JournalMutationSession({fetcher:async()=>response({error:{code:'REVISION_CONFLICT',message:'读取当前版本再核对。'}},409)});
 await session.submit(makeJournalUpdate(entry(),{...fields,text:'【虚构】更正'},'journal-fixture-edit-01'));assert.equal(session.getSnapshot().phase,'rejected');assert.equal(session.getSnapshot().status,409);assert.equal(session.getSnapshot().pending,null);assert.equal(session.getSnapshot().saved,null);
});
test('unauthorized first save is explicit and unauthorized retry cannot discard an earlier uncertain save',async()=>{
 let count=0;const session=new JournalMutationSession({fetcher:async()=>++count===1?response({},503):response({error:{code:'UNAUTHENTICATED',message:'请登录。'}},401)});
 await session.submit(create());await session.retry();assert.equal(session.getSnapshot().phase,'uncertain');assert.equal(session.getSnapshot().status,401);assert.ok(session.getSnapshot().pending);
 const first=new JournalMutationSession({fetcher:async()=>response({error:{code:'UNAUTHENTICATED',message:'请登录。'}},401)});await first.submit(create());assert.equal(first.getSnapshot().phase,'rejected');assert.equal(first.getSnapshot().status,401);
});
test('malformed or unrelated success replies never become a confirmed journal save',async()=>{
 for(const reply of [()=>new Response('not json'),()=>response({}),()=>response({entry:{...entry(),kind:'todo'},duplicate:false}),()=>response({entry:{...entry(),draft:{...entry().draft,title:'another title'}},duplicate:false})]){
  const session=new JournalMutationSession({fetcher:async()=>reply()});await session.submit(create());assert.equal(session.getSnapshot().phase,'uncertain');assert.equal(session.getSnapshot().saved,null);
 }
});
test('pending command survives remount without resubmitting and matching confirmation clears storage',async()=>{
 const storage=store();const first=new JournalMutationSession({storage,fetcher:async()=>{throw Error('lost');}});await first.submit(create());assert.equal(storage.data.size,1);
 let requests=0;const restored=new JournalMutationSession({storage,fetcher:async()=>{requests++;return response({entry:entry(),duplicate:true});}});assert.equal(restored.getSnapshot().phase,'uncertain');assert.equal(requests,0);await restored.retry();assert.equal(restored.getSnapshot().phase,'saved');assert.equal(storage.data.size,0);
});
test('invalid retained command and failed local retention fail closed without sending a request',async()=>{
 const storage=store();const first=new JournalMutationSession({storage,fetcher:async()=>{throw Error('lost');}});await first.submit(create());const [key]=[...storage.data.keys()];storage.data.set(key,JSON.stringify({...create(),body:{...create().body,ownerId:'forged'}}));let requests=0;const bad=new JournalMutationSession({storage,fetcher:async()=>{requests++;return response({entry:entry(),duplicate:false});}});await bad.submit(create());assert.equal(requests,0);assert.equal(bad.getSnapshot().phase,'uncertain');
 const unavailable=new JournalMutationSession({storage:{getItem:()=>null,setItem:()=>{throw Error('denied');},removeItem:()=>{}},fetcher:async()=>{requests++;return response({entry:entry(),duplicate:false});}});await unavailable.submit(create());assert.equal(requests,0);assert.equal(unavailable.getSnapshot().phase,'rejected');
});
test('reads default to filtered API, propagate explicit synthetic scope to detail/history and report unauthorized',async()=>{
 const urls:string[]=[];const fetcher=async(url:RequestInfo|URL)=>{urls.push(String(url));return response(String(url).includes('/history')?{history:[entry()],limit:100}:String(url).includes(id)?{entry:entry()}:{items:[]});};
 assert.deepEqual(await readJournalList(fetcher),[]);await readJournalDetail(id,true,fetcher);assert.deepEqual(urls,['/api/platform/journal','/api/platform/journal/'+id+'?includeSynthetic=1','/api/platform/journal/'+id+'/history?includeSynthetic=1']);
 await assert.rejects(readJournalList(async()=>response({error:{code:'UNAUTHENTICATED',message:'请登录。'}},401)),{status:401});
});

test('incomplete source metadata, missing persistence state and merely accepted responses cannot confirm a save',async()=>{
 const complete=entry();
 const invalid:unknown[]=[{...complete,source:{original:complete.source.original}},{...complete,createdAt:undefined},{...complete,updatedAt:'invalid'},{...complete,syncState:undefined},{...complete,externalStatus:'completed'},{...complete,source:{...complete.source,externalId:'unrelated'}},{...complete,ownerId:'injected-owner'}];
 for(const value of invalid){const session=new JournalMutationSession({fetcher:async()=>response({entry:value,duplicate:false})});await session.submit(create());assert.equal(session.getSnapshot().phase,'uncertain');assert.equal(session.getSnapshot().saved,null);}
 const accepted=new JournalMutationSession({fetcher:async()=>response({entry:complete,duplicate:false},202)});await accepted.submit(create());assert.equal(accepted.getSnapshot().phase,'uncertain');
});

test('read failures never expose upstream error messages or unrecognized codes',async()=>{
 const sensitive='fixture-secret-token=DO-NOT-DISPLAY';
 for(const [code,status] of [['UNAUTHENTICATED',401],['INTERNAL_'+sensitive,503]] as const){
  await assert.rejects(readJournalList(async()=>response({error:{code,message:sensitive}},status)),error=>{assert.ok(error instanceof Error);assert.doesNotMatch(error.message,/fixture-secret-token|DO-NOT-DISPLAY/);assert.equal((error as Error&{status:number}).status,status);if(status===401)assert.match(error.message,/登录/);return true;});
 }
 await assert.rejects(readJournalDetail(id,true,async()=>response({error:{code:'NOT_FOUND',message:sensitive}},404)),error=>{assert.ok(error instanceof Error);assert.doesNotMatch(error.message,/fixture-secret-token|DO-NOT-DISPLAY/);return true;});
});
test('save rejection and an uncertain unauthorized retry preserve status without exposing upstream text',async()=>{
 const sensitive='fixture-secret-token=DO-NOT-DISPLAY';
 const conflict=new JournalMutationSession({fetcher:async()=>response({error:{code:'REVISION_CONFLICT',message:sensitive}},409)});await conflict.submit(create());assert.equal(conflict.getSnapshot().phase,'rejected');assert.equal(conflict.getSnapshot().status,409);assert.equal(conflict.getSnapshot().pending,null);assert.doesNotMatch(conflict.getSnapshot().error,/fixture-secret-token|DO-NOT-DISPLAY/);assert.match(conflict.getSnapshot().error,/版本/);
 let attempts=0;const retry=new JournalMutationSession({fetcher:async()=>++attempts===1?response({},503):response({error:{code:'UNAUTHENTICATED',message:sensitive}},401)});await retry.submit(create());const pending=retry.getSnapshot().pending;await retry.retry();assert.equal(retry.getSnapshot().phase,'uncertain');assert.equal(retry.getSnapshot().status,401);assert.deepEqual(retry.getSnapshot().pending,pending);assert.doesNotMatch(retry.getSnapshot().error,/fixture-secret-token|DO-NOT-DISPLAY/);assert.match(retry.getSnapshot().error,/登录/);
});
