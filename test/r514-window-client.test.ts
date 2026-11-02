import test from 'node:test';
import assert from 'node:assert/strict';
import {RecordWindowClient,RecordWindowError,RecordWindowCancelled} from '../src/record-window-workbench/client.ts';
import type {RecordWindowResponse} from '../src/platform/window-contracts.ts';
import type {SearchHit,SearchQuery,SourceResponse} from '../src/search-candidate/contracts.ts';
import type {TimelineItem,TimelineQuery} from '../src/timeline-candidate/contracts.ts';

const owner='synthetic-window-client-owner',id='11111111-1111-4111-8111-111111111111',sourceId='22222222-2222-4222-8222-222222222222',stamp='2027-01-01T00:00:00.000Z';
const hit:SearchHit={id,sourceId,kind:'todo',type:'todo',revision:1,title:'Synthetic window source',date:'2027-01-01',sourceSystem:'website',snippet:'Synthetic bounded summary'};
const query={q:'',includeSynthetic:true,limit:2};
const timelineQuery:TimelineQuery={axis:'recorded',timeZone:'Asia/Shanghai',includeSynthetic:true,limit:2};
const row:TimelineItem={eventKey:'recorded:todo:'+id,id,sourceId,kind:'todo',type:'todo',revision:1,currentRevision:1,title:hit.title,summary:hit.snippet,date:'2027-01-01',at:stamp,dateKind:'instant',sourceTimeZone:'UTC',timeRole:'recorded',status:'open',isHistorical:false};
function payload():RecordWindowResponse{return{mode:'search',query:{...query},items:[{...hit}],observedAt:stamp,syntheticIncluded:true,dataStatus:'isolated-test-drafts',page:{cursorUsed:null,nextCursor:'opaque_next_1',hasMore:true,scanned:2,returned:1,limit:2,ordering:'record-createdAt-desc-id-desc',consistency:'per-page-read-not-snapshot',compatibilityScope:'scanned-versions-and-originals',filtering:'bounded-window-post-filter',totalMatches:null,calendarIncluded:false,newerRecordsRequireRestart:true,revisionsMayChange:true,backdatedInsertionsMayBeMissed:true}};}
function source():SourceResponse{const original={...hit,fields:[{label:'备注',value:'Synthetic selected full text'}]},current={...original,revision:3,title:'Synthetic newer current',fields:[{label:'备注',value:'Synthetic new full text'}]};return{current,original,history:[current,{...original,revision:2},structuredClone(original)],historyLimit:20,historyTruncated:false,dataStatus:'isolated-test-drafts',syntheticIncluded:true};}
const identity=(account:string|null=owner)=>Response.json(account?{user:{id:account},session:{userId:account}}:null);
function fixture(value:unknown=payload()){
 let account:string|null=owner;const calls:Array<{path:string;init?:RequestInit}>=[];
 const transport:typeof fetch=async(input,init)=>{const path=String(input);calls.push({path,init});return path.endsWith('/auth/get-session')?identity(account):Response.json(path.includes('/source/')?source():value);};
 return{calls,transport,client:new RecordWindowClient(transport),setAccount(next:string|null){account=next;}};
}

test('explicit synthetic scope, calendar rejection and invalid cursor perform no transport reads',async()=>{
 for(const [input,cursor]of [[{...query,includeSynthetic:false},null],[{...query,type:'calendar'},null],[query,'x'.repeat(1801)],[query,'not/a/cursor'],[{...query,unknown:'field'},null]]as const){const f=fixture();await assert.rejects(()=>f.client.page('search',input as Partial<SearchQuery>,cursor),RecordWindowError);assert.equal(f.calls.length,0);}
});

test('actual window client normalizes query and sends only page URLs with before/after identity',async()=>{
 const f=fixture();assert.deepEqual(await f.client.page('search',query),payload());assert.deepEqual(f.calls.map(call=>call.path),['/api/platform/auth/get-session','/api/platform/search/page?includeSynthetic=true&limit=2','/api/platform/auth/get-session']);
 assert.ok(f.calls.every(call=>call.init?.signal instanceof AbortSignal&&call.init.credentials==='same-origin'&&call.init.cache==='no-store'));
 const next=payload();next.page.cursorUsed='opaque_next_1';next.page.nextCursor=null;next.page.hasMore=false;next.page.scanned=1;const g=fixture(next);await g.client.page('search',query,'opaque_next_1');assert.match(g.calls[1].path,/cursor=opaque_next_1$/);
});

test('empty match pages can advance and no global counts are inferred',async()=>{
 const value=payload();value.items=[];value.page.returned=0;const result=await fixture(value).client.page('search',query);assert.equal(result.page.hasMore,true);assert.equal(result.items.length,0);assert.equal(result.page.totalMatches,null);
});

test('strict page and query echo reject false metadata, duplicate keys and nonprogressing cursors',async()=>{
 const mutations:Array<(value:RecordWindowResponse)=>void>=[r=>{r.mode='timeline';},r=>{r.query.limit=3;},r=>{(r.query as any).q='different';},r=>{(r as any).private='forbidden';},r=>{(r.query as any).private='forbidden';},r=>{r.page.scanned=3;},r=>{r.page.scanned=0;},r=>{r.page.returned=0;},r=>{r.page.limit=3;},r=>{r.page.nextCursor=null;},r=>{r.page.nextCursor='invalid+/=';},r=>{r.page.nextCursor='x'.repeat(1801);},r=>{r.page.cursorUsed='other';},r=>{r.page.hasMore=false;},r=>{r.page.calendarIncluded=true as any;},r=>{r.page.totalMatches=1 as any;},r=>{r.page.compatibilityScope='all-records' as any;},r=>{r.page.consistency='snapshot' as any;},r=>{r.page.ordering='history-createdAt-desc-id-desc-revision-desc';},r=>{r.page.filtering='global' as any;},r=>{r.page.newerRecordsRequireRestart=false as any;},r=>{r.page.revisionsMayChange=false as any;},r=>{r.page.backdatedInsertionsMayBeMissed=false as any;},r=>{r.items.push({...hit});r.page.returned=2;},r=>{r.items[0].kind='calendar';},r=>{r.observedAt='2027-02-30T00:00:00.000Z';}];
 for(const mutate of mutations){const value=payload();mutate(value);await assert.rejects(()=>fixture(value).client.page('search',query),cause=>cause instanceof RecordWindowError&&cause.code==='INVALID_RESPONSE');}
 const value=payload();value.page.cursorUsed='opaque_next_1';await assert.rejects(()=>fixture(value).client.page('search',query,'opaque_next_1'),RecordWindowError);
});

test('timeline uses the shared validator, exact changed ordering and query defaults',async()=>{
 const value=payload();value.mode='timeline';value.query={...timelineQuery};value.items=[row];assert.equal((await fixture(value).client.page('timeline',timelineQuery)).items.length,1);
 const changed={...value,query:{...timelineQuery,axis:'changed' as const},items:[{...row,eventKey:'changed:todo:'+id+':2',revision:2,currentRevision:3,isHistorical:true,timeRole:'changed' as const}],page:{...value.page,ordering:'history-createdAt-desc-id-desc-revision-desc' as const}};
 assert.equal((await fixture(changed).client.page('timeline',changed.query)).page.ordering,changed.page.ordering);
 const invalid=structuredClone(changed);invalid.items[0].eventKey='wrong';await assert.rejects(()=>fixture(invalid).client.page('timeline',changed.query),RecordWindowError);
});

test('successful and failed reads pin the original owner after the page operation',async()=>{
 for(const status of [200,404,503]){const f=fixture();const client=new RecordWindowClient(async(input,init)=>{if(String(input).includes('/search/page')){f.setAccount('synthetic-other-owner');return Response.json(status===200?payload():{error:{message:'PRIVATE_SENTINEL'}},{status});}return f.transport(input,init);});await assert.rejects(()=>client.page('search',query),cause=>cause instanceof RecordWindowError&&cause.code==='ACCOUNT_CHANGED');}
 const f=fixture();await f.client.page('search',query);f.setAccount('other');const before=f.calls.length;await assert.rejects(()=>f.client.page('search',query),cause=>cause instanceof RecordWindowError&&cause.code==='ACCOUNT_CHANGED');assert.equal(f.calls.length-before,1);
});

test('raw authorization bodies are never echoed and failed data still triggers postflight',async()=>{
 for(const status of [401,403]){const f=fixture(),client=new RecordWindowClient(async(input,init)=>String(input).includes('/search/page')?new Response('PRIVATE_RAW_BODY',{status}):f.transport(input,init));await assert.rejects(()=>client.page('search',query),cause=>cause instanceof RecordWindowError&&cause.status===status&&!cause.message.includes('PRIVATE_RAW_BODY'));assert.equal(f.calls.length,2);}
 const f=fixture(),client=new RecordWindowClient(async(input,init)=>{if(String(input).includes('/search/page')){f.setAccount(null);throw Error('PRIVATE_NETWORK_ERROR');}return f.transport(input,init);});await assert.rejects(()=>client.page('search',query),cause=>cause instanceof RecordWindowError&&cause.status===401&&!cause.message.includes('PRIVATE_'));
});

test('bounded streamed bytes and declared length reject oversized page bodies',async()=>{
 for(const declared of [true,false]){const f=fixture(),client=new RecordWindowClient(async(input,init)=>String(input).includes('/search/page')?new Response(declared?'{}':new Uint8Array(2_000_001),{headers:declared?{'content-length':'2000001'}:{}}):f.transport(input,init));await assert.rejects(()=>client.page('search',query),cause=>cause instanceof RecordWindowError&&cause.code==='INVALID_RESPONSE');assert.equal(f.calls.length,2);}
});

test('cancellation reaches data and retains a fresh owner postflight without publishing',async()=>{
 const f=fixture(),abort=new AbortController();let started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;});
 const client=new RecordWindowClient(async(input,init)=>{if(String(input).includes('/search/page')){assert.ok(init?.signal);started();return new Promise<Response>((_,reject)=>init!.signal!.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));}return f.transport(input,init);});
 const pending=client.page('search',query,null,abort.signal);await ready;abort.abort();await assert.rejects(()=>pending,RecordWindowCancelled);assert.equal(f.calls.length,2);
 const before=f.calls.length;await assert.rejects(()=>client.page('search',query,null,abort.signal),RecordWindowCancelled);assert.equal(f.calls.length,before);
});

test('deadline remains active with caller signal and bounds a stalled body',async t=>{
 const deadlines:AbortController[]=[];t.mock.method(AbortSignal,'timeout',(ms:number)=>{assert.equal(ms,20_000);const abort=new AbortController();deadlines.push(abort);return abort.signal;});
 const f=fixture(),caller=new AbortController();let started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;});
 const client=new RecordWindowClient(async(input,init)=>String(input).includes('/search/page')?new Response(new ReadableStream({start(){started();}})):f.transport(input,init));
 const pending=client.page('search',query,null,caller.signal);await ready;deadlines.at(-1)!.abort();await assert.rejects(()=>pending,cause=>cause instanceof RecordWindowError&&cause.code==='READ_TIMEOUT');assert.equal(caller.signal.aborted,false);assert.equal(f.calls.length,2);
});

test('late forbidden response after ignored cancellation revokes subscribed scope',async()=>{
 const f=fixture(),caller=new AbortController();let finish!:(value:Response)=>void,started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;});const errors:RecordWindowError[]=[];
 const client=new RecordWindowClient(async(input,init)=>String(input).includes('/search/page')?new Promise<Response>(resolve=>{finish=resolve;started();}):f.transport(input,init));client.onIdentityFailure(error=>errors.push(error));const pending=client.page('search',query,null,caller.signal);await ready;caller.abort();await assert.rejects(()=>pending,RecordWindowCancelled);finish(new Response('PRIVATE_SENTINEL',{status:403}));await new Promise(resolve=>setImmediate(resolve));assert.equal(errors.at(-1)?.status,403);assert.ok(errors.every(error=>!error.message.includes('PRIVATE_SENTINEL')));
});

test('source pins selected ID/source/revision and separates current and selected content',async()=>{
 const f=fixture();await f.client.page('search',query);const result=await f.client.source(hit);assert.equal(result.selected?.revision,1);assert.equal(result.source.current.revision,3);assert.equal(result.currentChanged,true);assert.equal(result.selectedOutsideHistory,false);assert.equal(result.selected?.fields[0].value,'Synthetic selected full text');assert.equal(f.calls.filter(call=>call.path.includes('/search/source/'))[0].path,'/api/platform/search/source/todo/'+id+'?includeSynthetic=true');
 const noRead=fixture();await assert.rejects(()=>noRead.client.source(hit),RecordWindowError);assert.equal(noRead.calls.length,0);
});

test('missing historical revision is explicit, never replaced by current; source mismatches reject',async()=>{
 const value=source();value.historyTruncated=true;const f=fixture(),client=new RecordWindowClient(async(input,init)=>String(input).includes('/source/')?Response.json(value):f.transport(input,init));await client.page('search',query);const result=await client.source({...hit,revision:2});assert.equal(result.selected?.revision,2);value.history=[];const absent=await client.source({...hit,revision:2});assert.equal(absent.selected,null);assert.equal(absent.selectedOutsideHistory,true);value.current.sourceId=id;await assert.rejects(()=>client.source(hit),RecordWindowError);
});

test('source requests are byte bounded and primary owner checked around failed source reads',async()=>{
 for(const mode of ['large','switch']){const f=fixture(),client=new RecordWindowClient(async(input,init)=>{if(String(input).includes('/source/')){if(mode==='switch'){f.setAccount('other-owner');return Response.json({error:{message:'PRIVATE_SENTINEL'}},{status:503});}return new Response(new Uint8Array(2_000_001));}return f.transport(input,init);});await client.page('search',query);await assert.rejects(()=>client.source(hit),cause=>cause instanceof RecordWindowError&&(mode!=='switch'||cause.code==='ACCOUNT_CHANGED')&&!cause.message.includes('PRIVATE_SENTINEL'));}
});

test('nested source transport preserves authorization failures even if session still returns original owner',async()=>{
 for(const status of [401,403]){const f=fixture(),client=new RecordWindowClient(async(input,init)=>String(input).includes('/source/')?new Response('PRIVATE_SOURCE_AUTH_BODY',{status}):f.transport(input,init));await client.page('search',query);await assert.rejects(()=>client.source(hit),cause=>cause instanceof RecordWindowError&&cause.status===status&&!cause.message.includes('PRIVATE_SOURCE_AUTH_BODY'));}
});

test('selected saved revision prefers normalized history over raw original input and never invents missing history',async()=>{
 const value=source();value.original.title='  '+hit.title+'  ';value.original.fields=[{label:'备注',value:'Synthetic raw original input'}];const f=fixture(),client=new RecordWindowClient(async(input,init)=>String(input).includes('/source/')?Response.json(value):f.transport(input,init));await client.page('search',query);
 const result=await client.source(hit);assert.equal(result.selected?.title,hit.title);assert.equal(result.selected?.fields[0].value,'Synthetic selected full text');assert.equal(result.source.original.title,'  '+hit.title+'  ');
 value.history=value.history.filter(doc=>doc.revision!==1);value.historyTruncated=true;value.original.title=hit.title;const absent=await client.source(hit);assert.equal(absent.selected,null);assert.equal(absent.selectedOutsideHistory,true);assert.equal(absent.source.original.revision,1);assert.equal(absent.source.original.fields[0].value,'Synthetic raw original input');
});
