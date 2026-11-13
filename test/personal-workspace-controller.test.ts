import{test}from'node:test';import assert from'node:assert/strict';import{makePersonalCommand}from'../src/personal-candidate/client.ts';import{normalizePersonalFields}from'../src/personal-candidate/business.ts';import{validateInbox,validateTodo}from'../src/platform/domain.ts';import{PersonalWorkspaceController}from'../src/personal-candidate/workspace-controller.ts';
const id='11111111-1111-4111-8111-111111111111',sourceId='22222222-2222-4222-8222-222222222222';
function fixture(allowedTypes:unknown=['todo'],now=()=>0){let entry:any={createdAt:'2026-10-27T00:00:00Z',updatedAt:'2026-10-27T00:00:00Z',id,kind:'todo',draft:{title:'Fixture',notes:'Preserved',dueOn:null,status:'open'},source:{id:sourceId,system:'website',externalId:id,version:1,asOf:'2026-10-27T00:00:00Z',original:{marker:'personal-manual-v1',spaceId:'fixture-space',type:'todo',input:{}}},revision:3,syncState:'draft',externalStatus:null};const extras:any[]=[],receipts=new Map<string,any>();let authenticated=true,writable=true,truncate=false,lose=false,reads=0,space='fixture-space',badSource=false;const writes:{key:string;body:any}[]=[],storage=new Map<string,string>();const response=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status});
 const fetcher=async(input:RequestInfo|URL,init?:RequestInit)=>{const path=String(input);if(path.endsWith('availability'))return response({configured:true,loginAllowed:true,transport:'ssh-loopback',origin:'http://127.0.0.1:3331'});if(path.endsWith('status'))return authenticated?response({scope:'personal-manual-candidate',ownerId:'fixture-owner',spaceId:space,storageVerified:true,writable,allowedTypes}):response({},401);if(path.includes('/overview')){reads++;return response({items:[entry,...extras],total:1+extras.length,scope:'full-current-snapshot',truncated:truncate,today:'2026-10-27',observedAt:'2026-10-27T00:00:00Z'});}if(init?.method==='PATCH'||init?.method==='POST'&&path.endsWith('/todo')){const key=new Headers(init.headers).get('idempotency-key')!,body=JSON.parse(String(init.body));const duplicate=writes.some(w=>w.key===key);writes.push({key,body});if(!duplicate)entry=init?.method==='POST'?{...entry,id:'44444444-4444-4444-8444-444444444444',revision:1,draft:validateTodo(body.fields),source:{...entry.source,externalId:'44444444-4444-4444-8444-444444444444',original:{marker:'personal-manual-v1',spaceId:'fixture-space',type:'todo',input:body}}}:{...entry,draft:validateTodo(body.fields),revision:body.expectedRevision+1};if(!duplicate)receipts.set(key,structuredClone(entry));if(lose){lose=false;throw Error('connection lost after commit');}return response({entry:badSource?{...entry,source:{...entry.source,id:'55555555-5555-4555-8555-555555555555'}}:receipts.get(key),duplicate});}if(path==='/api/platform/personal/todo/'+id&&!init?.method)return response({entry});if(path.endsWith('sign-out'))return response({success:true});throw Error('unexpected '+path);};
 const controller=new PersonalWorkspaceController({fetcher,origin:'http://127.0.0.1:3331',today:()=> '2026-10-27',key:()=>crypto.randomUUID(),now,storage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>{storage.set(k,v);},removeItem:k=>{storage.delete(k);}}});return{externalEdit:()=>{entry={...entry,revision:entry.revision+1,draft:{...entry.draft,title:'Newer remote title',notes:'Newer remote body'}};},addEntry:(entry:any)=>extras.push(entry),changeSpace:()=>space='different-space',badSource:()=>badSource=true,controller,fetcher,writes,storage,setAuth:(v:boolean)=>authenticated=v,setWritable:(v:boolean)=>writable=v,setTruncated:()=>truncate=true,lose:()=>lose=true,reads:()=>reads};}
test('controller reads full real endpoint and patches expected revision preserving fields',async()=>{const f=fixture();await f.controller.refresh();assert.equal(f.controller.getSnapshot().state.status,'ready');await f.controller.setTaskStatus({id,revision:3},'done');assert.equal(f.writes.length,1);assert.deepEqual(f.writes[0].body,{spaceId:'fixture-space',confirmed:true,expectedRevision:3,fields:{title:'Fixture',notes:'Preserved',dueOn:null,status:'done'}});const s=f.controller.getSnapshot();assert.equal(s.state.status==='ready'&&s.state.data.tasks[0].revision,4);});
test('expired session, disabled writes, stale row and incomplete snapshot never submit',async()=>{for(const mode of['auth','write','stale','truncate']){const f=fixture();await f.controller.refresh();if(mode==='auth')f.setAuth(false);if(mode==='write')f.setWritable(false);if(mode==='truncate'){f.setTruncated();await f.controller.refresh();}await f.controller.setTaskStatus({id,revision:mode==='stale'?2:3},'done');assert.equal(f.writes.length,0);}});
test('lost response keeps exact command/key; retry recovers receipt rather than fresh mutation',async()=>{const f=fixture();await f.controller.refresh();f.lose();await f.controller.setTaskStatus({id,revision:3},'done');assert.equal(f.controller.getSnapshot().uncertain,true);await f.controller.setTaskStatus({id,revision:3},'open');assert.equal(f.writes.length,1);await f.controller.retry();assert.equal(f.writes.length,2);assert.deepEqual(f.writes[0],f.writes[1]);assert.equal(f.storage.size,0);assert.equal(f.controller.getSnapshot().state.status,'ready');});
test('suspend clears cached private rows and logout does not depend on business writes',async()=>{const f=fixture();await f.controller.refresh();f.controller.suspend();assert.deepEqual(f.controller.getSnapshot().state,{status:'unknown'});await f.controller.setTaskStatus({id,revision:3},'done');assert.equal(f.writes.length,0);f.setWritable(false);await f.controller.logout();assert.equal(f.controller.getSnapshot().access.authenticated,false);});
test('double click serializes during permission preflight',async()=>{const f=fixture();await f.controller.refresh();await Promise.all([f.controller.setTaskStatus({id,revision:3},'done'),f.controller.setTaskStatus({id,revision:3},'done')]);assert.equal(f.writes.length,1);});
test('cancel or suspend settles a held permission preflight before its late response and sends zero writes',async()=>{
 for(const stop of ['cancel','suspend'] as const)for(const stage of ['fetch','body']){const f=fixture();let delay=false,release!:()=>void,entered!:()=>void,signal:AbortSignal|undefined;const seen=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);const c=new PersonalWorkspaceController({fetcher:async(input,init)=>{if(delay&&String(input).endsWith('/status')){signal=init?.signal??undefined;entered();if(stage==='fetch')await gate;else{const response=await f.fetcher(input,init),json=response.json.bind(response);response.json=async()=>{await gate;return json();};return response;}}return f.fetcher(input,init);},origin:'http://127.0.0.1:3331',today:()=> '2026-10-27',key:()=>crypto.randomUUID()});await c.refresh();delay=true;let settled=false;const pending=c.saveTask({id,revision:3},{title:'Retained draft',text:'Keep',date:'',status:'done'}).then(result=>{settled=true;return result;});await seen;c[stop]();await new Promise<void>(r=>setImmediate(r));
 try{assert.equal(settled,true,'Cancellation must finish without releasing preflight');assert.equal(signal?.aborted,true);assert.equal(await pending,null);assert.equal(c.getSnapshot().saving,false);assert.equal(c.getSnapshot().uncertain,false);assert.equal(f.writes.length,0);}finally{release();await pending;}await new Promise<void>(r=>setImmediate(r));assert.equal(f.writes.length,0);
 }
});

test('verified status exposes exactly the allowed record types and clears them when suspended',async()=>{
 for(const allowedTypes of [['todo','journal'],['todo','journal','project','domain','topic']]){
  const f=fixture(allowedTypes);await f.controller.refresh();const snapshot=f.controller.getSnapshot();
  assert.equal(snapshot.state.status,'ready');assert.equal(snapshot.access.writable,true);assert.deepEqual(snapshot.access.allowedTypes,allowedTypes);
  f.controller.suspend();assert.equal(f.controller.getSnapshot().access.allowedTypes,undefined);
 }
});
test('unknown or malformed status type capabilities never reach an editable workspace',async()=>{
 for(const allowedTypes of [null,['todo','future'],['todo',null]]){
  const f=fixture(allowedTypes);await f.controller.refresh();const snapshot=f.controller.getSnapshot();
  assert.equal(snapshot.state.status,'error');assert.equal(snapshot.access.writable,false);assert.equal(snapshot.access.allowedTypes,undefined);
 }
});

// Catches an overview reload after a receipt, a lost Promise result, or PATCH identity loss.
test('saveTask edits from verified revision and applies only its receipt without loading or another overview',async()=>{
 const f=fixture();await f.controller.refresh();const states:string[]=[];f.controller.subscribe(()=>states.push(f.controller.getSnapshot().state.status));
 const original=f.controller.getTaskEntry({id,revision:3})!;
 const saved=await f.controller.saveTask({id,revision:3},{title:'Changed',text:'New notes',date:'2026-11-04',status:'in_progress'});
 assert.equal(saved?.id,id);assert.equal(saved?.revision,4);assert.deepEqual(saved?.source,original.source);
 assert.deepEqual(f.writes[0].body.fields,{title:'Changed',notes:'New notes',dueOn:'2026-11-04',status:'in_progress'});
 assert.equal(f.reads(),1);assert.equal(states.includes('loading'),false);assert.equal(states.includes('unknown'),false);
 assert.equal(f.controller.getTaskEntry({id,revision:3}),null);assert.equal(f.controller.getTaskEntry({id,revision:4})?.draft&&validateTodo(f.controller.getTaskEntry({id,revision:4})!.draft).title,'Changed');
});
test('create explicitly uses POST while missing, stale and readonly edits never create',async()=>{
 const f=fixture();await f.controller.refresh();
 for(const target of [{id:'33333333-3333-4333-8333-333333333333',revision:3},{id,revision:2}])assert.equal(await f.controller.saveTask(target,{title:'Bad',text:'',date:'',status:'open'}),null);
 assert.equal(f.writes.length,0);
 const saved=await f.controller.saveTask(null,{title:'Created',text:'Manual',date:'',status:'open'});
 assert.equal(saved?.revision,1);assert.equal('expectedRevision'in f.writes[0].body,false);assert.equal(f.reads(),1);
 f.setWritable(false);await f.controller.saveTask(null,{title:'Denied',text:'',date:'',status:'open'});assert.equal(f.writes.length,1);
});
test('undo uses receipt revision and previous status within 10 seconds, never a stale whole draft',async()=>{
 let now=100;const f=fixture(['todo'],()=>now);await f.controller.refresh();
 await f.controller.setTaskStatus({id,revision:3},'in_progress');await f.controller.setTaskStatus({id,revision:4},'done');
 assert.equal(f.controller.getSnapshot().undoDeadline,10100);now=10099;await f.controller.undoTaskStatus();
 assert.equal(f.writes[2].body.expectedRevision,5);assert.equal(f.writes[2].body.fields.status,'in_progress');assert.equal(f.writes[2].body.fields.notes,'Preserved');assert.equal(f.controller.getSnapshot().undoDeadline,null);assert.equal(f.reads(),1);
});
test('undo expires at the boundary and is invalidated by editing, refresh or suspension',async()=>{
 for(const mode of ['deadline','edit','refresh','suspend']){let now=0;const f=fixture(['todo'],()=>now);await f.controller.refresh();await f.controller.setTaskStatus({id,revision:3},'done');
 if(mode==='deadline')now=10000;if(mode==='edit')await f.controller.saveTask({id,revision:4},{title:'Latest',text:'Latest body',date:'',status:'done'});if(mode==='refresh')await f.controller.refresh();if(mode==='suspend')f.controller.suspend();const count=f.writes.length;await f.controller.undoTaskStatus();assert.equal(f.writes.length,count);assert.equal(f.controller.getSnapshot().undoDeadline,null);}
});
test('lost edit receipt retries the same PATCH locally without fetching overview',async()=>{
 const f=fixture();await f.controller.refresh();f.lose();assert.equal(await f.controller.saveTask({id,revision:3},{title:'Changed',text:'Body',date:'',status:'done'}),null);assert.equal(f.controller.getSnapshot().uncertain,true);
 await f.controller.retry();assert.deepEqual(f.writes[0],f.writes[1]);assert.equal(f.reads(),1);assert.equal(f.controller.getTaskEntry({id,revision:4})?.draft&&validateTodo(f.controller.getTaskEntry({id,revision:4})!.draft).title,'Changed');
});

test('related entries retain stable source/version references and foreign bindings are rejected',async()=>{
 const f=fixture(['todo','project']);const projectId='66666666-6666-4666-8666-666666666666',projectSource='77777777-7777-4777-8777-777777777777';
 f.addEntry({id:projectId,kind:'inbox',draft:{title:'Project',text:'',occurredOn:null,disposition:'reference',personal:{type:'project',stage:'active',purpose:null,nextStep:'',domain:null,topics:[]}},source:{id:projectSource,system:'website',externalId:projectId,version:1,asOf:'2026-10-27T00:00:00Z',original:{marker:'personal-manual-v1',spaceId:'fixture-space',type:'project',input:{}}},revision:2,syncState:'draft',externalStatus:null});
 await f.controller.refresh();assert.equal(f.controller.getRelationOptions().project.length,1);
 const personal={domain:null,topics:[],project:{id:projectId,sourceId:projectSource,revision:2}};
 await f.controller.saveTask({id,revision:3},{title:'Related',text:'Keep',date:'',status:'open',personal});
 assert.deepEqual(f.writes[0].body.fields.personal,personal);assert.equal(f.controller.getRelationOptions().project[0].revision,2);
 const options=f.controller.getRelationOptions();options.project[0].revision=999;assert.equal(f.controller.getRelationOptions().project[0].revision,2);
 assert.equal(await f.controller.saveTask({id,revision:4},{title:'Foreign relation',text:'',date:'',status:'open',personal:{...personal,project:{...personal.project,sourceId:'88888888-8888-4888-8888-888888888888'}}}),null);assert.equal(f.writes.length,1);
 f.changeSpace();assert.equal(await f.controller.saveTask({id,revision:4},{title:'Other space',text:'',date:'',status:'open'}),null);assert.equal(f.writes.length,1);assert.equal(f.controller.getSpaceId(),null);
});
test('a source-changing receipt never replaces the trusted row',async()=>{
 const f=fixture();await f.controller.refresh();f.badSource();assert.equal(await f.controller.saveTask({id,revision:3},{title:'Changed',text:'',date:'',status:'done'}),null);assert.equal(f.controller.getTaskEntry({id,revision:3})?.source.id,sourceId);assert.match(f.controller.getSnapshot().mutationError??'',/来源/);
});
test('retained uncertain request can recover after suspend and authoritative reread',async()=>{
 const f=fixture();await f.controller.refresh();f.lose();await f.controller.saveTask({id,revision:3},{title:'Changed',text:'',date:'',status:'done'});f.controller.suspend();await f.controller.refresh();assert.equal(f.controller.getSnapshot().uncertain,true);await f.controller.retry();assert.equal(f.controller.getSnapshot().uncertain,false);assert.equal(f.writes.length,2);assert.deepEqual(f.writes[0],f.writes[1]);assert.equal(f.controller.getTaskEntry({id,revision:4})?.revision,4);
});
test('pure status cell save is undoable, subsequent text edit invalidates that undo',async()=>{
 const f=fixture();await f.controller.refresh();await f.controller.saveTask({id,revision:3},{title:'Fixture',text:'Preserved',date:'',status:'done'});assert.equal(f.controller.getSnapshot().undoDeadline,10000);await f.controller.undoTaskStatus();assert.equal(f.writes[1].body.fields.status,'open');
 await f.controller.saveTask({id,revision:5},{title:'Latest',text:'Edited text',date:'',status:'done'});assert.equal(f.controller.getSnapshot().undoDeadline,null);await f.controller.undoTaskStatus();assert.equal(f.writes.length,3);assert.equal(f.writes[2].body.fields.notes,'Edited text');
});

test('unknown older receipt confirms the original key without replacing newer content and unlocks later edits',async()=>{
 const f=fixture();await f.controller.refresh();f.lose();await f.controller.saveTask({id,revision:3},{title:'Old command',text:'Old body',date:'',status:'done'});f.externalEdit();f.controller.suspend();await f.controller.refresh();
 await f.controller.retry();const current=f.controller.getTaskEntry({id,revision:5});assert.equal(current?.revision,5);assert.equal(current&&validateTodo(current.draft).notes,'Newer remote body');assert.equal(f.controller.getSnapshot().uncertain,false);assert.equal(f.storage.size,0);assert.equal(f.writes.length,2);assert.deepEqual(f.writes[0],f.writes[1]);
 const saved=await f.controller.saveTask({id,revision:5},{title:'Next edit',text:'Newer remote body',date:'',status:'done'});assert.equal(saved?.revision,6);assert.equal(f.writes[2].body.expectedRevision,5);assert.notEqual(f.writes[2].key,f.writes[0].key);
});

test('shared pending journal/project/domain/topic commands recover their original type and unlock todo saves',async()=>{
 const recordId='99999999-9999-4999-8999-999999999999',recordSource='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 for(const type of ['journal','project','domain','topic'] as const){for(const create of [false,true]){
  const f=fixture(['todo','journal','project','domain','topic']);
  const personal=type==='project'?{type,stage:'active',purpose:null,nextStep:'Next',domain:null,topics:[]}:type==='domain'||type==='topic'?{type}:undefined;
  const fields={title:'Recovered '+type,text:'Retained text',occurredOn:null,...(personal?{personal}:{})};
  const command=makePersonalCommand({ownerId:'fixture-owner',spaceId:'fixture-space'},type,create?null:recordId,fields,'retained-'+type+'-'+create,true,create?undefined:2);
  const draft=validateInbox({...normalizePersonalFields(type,fields),disposition:'reference'}),entry={id:recordId,kind:'inbox',draft,source:{id:recordSource,system:'website',externalId:recordId,version:1,asOf:'2026-10-27T00:00:00Z',original:{marker:'personal-manual-v1',spaceId:'fixture-space',type,input:create?command.body:{}}},revision:create?1:2,syncState:'draft',externalStatus:null};
  if(!create)f.addEntry(entry);const saved={...entry,revision:create?1:3};f.storage.set('lifeos.personal.pending.v1:fixture-owner:fixture-space',JSON.stringify(command));
  const recovered:{url:string;key:string;body:unknown;method:string}[]=[];
  const controller=new PersonalWorkspaceController({fetcher:async(input,init)=>{if(String(input)==='/api/platform/personal/'+type+(create?'':'/'+recordId)){recovered.push({url:String(input),key:new Headers(init?.headers).get('idempotency-key')!,body:JSON.parse(String(init?.body)),method:init?.method??''});return new Response(JSON.stringify({entry:saved,duplicate:true}),{status:create?201:200});}return f.fetcher(input,init);},origin:'http://127.0.0.1:3331',today:()=> '2026-10-27',key:()=>crypto.randomUUID(),storage:{getItem:k=>f.storage.get(k)??null,setItem:(k,v)=>{f.storage.set(k,v);},removeItem:k=>{f.storage.delete(k);}}});
  await controller.refresh();assert.equal(controller.getSnapshot().uncertain,true);const receipt=await controller.retry();assert.equal(receipt?.id,recordId);assert.equal(controller.getSnapshot().uncertain,false);assert.equal(f.storage.size,0);assert.deepEqual(recovered,[{url:'/api/platform/personal/'+type+(create?'':'/'+recordId),key:command.key,body:command.body,method:command.method}]);assert.equal(f.reads(),1);
  if(type!=='journal'){const relation=controller.getRelationOptions()[type];assert.equal(relation.length,1);assert.equal(relation[0].revision,create?1:3);}
  const next=await controller.saveTask({id,revision:3},{title:'Todo remains editable',text:'Preserved',date:'',status:'open'});assert.equal(next?.revision,4);assert.equal(f.writes.length,1);
 }}
});

test('a cancelled preflight cannot clear the saving state of a newer held attempt',async()=>{
 const f=fixture();let hold=false,release!:()=>void;const gate=new Promise<void>(r=>release=r);const c=new PersonalWorkspaceController({fetcher:async(input,init)=>{if(hold&&String(input).endsWith('/status'))await gate;return f.fetcher(input,init);},origin:'http://127.0.0.1:3331',today:()=> '2026-10-27',key:()=>crypto.randomUUID()});await c.refresh();hold=true;const fields={title:'New attempt',text:'Keep draft',date:'',status:'open' as const},old=c.saveTask({id,revision:3},fields);c.cancel();const next=c.saveTask({id,revision:3},fields);await old;await new Promise<void>(r=>setImmediate(r));
 try{assert.equal(c.getSnapshot().saving,true,'Old finally must not unlock a newer permission preflight');assert.equal(f.writes.length,0);}finally{c.cancel();release();await next;}
 assert.equal(f.writes.length,0);
});


test('saved planning is projected only after its individual authoritative readback',async()=>{
 const f=fixture();let reads=0,release!:()=>void;const gate=new Promise<void>(r=>release=r);
 const c=new PersonalWorkspaceController({fetcher:async(input,init)=>{if(String(input)==='/api/platform/personal/todo/'+id&&!init?.method){reads++;await gate;}return f.fetcher(input,init);},origin:'http://127.0.0.1:3331',today:()=> '2026-10-27',key:()=>crypto.randomUUID()});await c.refresh();
 const saving=c.saveTask({id,revision:3},{title:'Fixture',text:'Preserved',date:'',status:'open',plannedStartOn:'2030-11-05',plannedEndOn:'2030-11-10'});
 for(let i=0;i<8;i++)await new Promise<void>(r=>setImmediate(r));
 assert.equal(reads,1);const before=c.getSnapshot().state;assert.equal(before.status==='ready'&&before.data.tasks[0].plannedStartOn,null);release();assert.equal((await saving)?.revision,4);const after=c.getSnapshot().state;assert.equal(after.status==='ready'&&after.data.tasks[0].plannedStartOn,'2030-11-05');
});
test('failed planning readback keeps the old projection and requires refresh before any fresh write',async()=>{
 const f=fixture();const c=new PersonalWorkspaceController({fetcher:async(input,init)=>String(input)==='/api/platform/personal/todo/'+id&&!init?.method?Response.json({}, {status:503}):f.fetcher(input,init),origin:'http://127.0.0.1:3331',today:()=> '2026-10-27',key:()=>crypto.randomUUID()});await c.refresh();
 const fields={title:'Fixture',text:'Preserved',date:'',status:'open' as const,plannedStartOn:'2030-11-05',plannedEndOn:'2030-11-10'};assert.equal(await c.saveTask({id,revision:3},fields),null);const state=c.getSnapshot().state;assert.equal(state.status==='ready'&&state.data.tasks[0].plannedStartOn,null);assert.match(c.getSnapshot().mutationError??'',/回读/);await c.saveTask({id,revision:3},fields);assert.equal(f.writes.length,1);
});
test('a newer readback is projected without replacing it by the historical planning receipt',async()=>{
 const f=fixture();const c=new PersonalWorkspaceController({fetcher:async(input,init)=>{if(String(input)==='/api/platform/personal/todo/'+id&&!init?.method)f.externalEdit();return f.fetcher(input,init);},origin:'http://127.0.0.1:3331',today:()=> '2026-10-27',key:()=>crypto.randomUUID()});await c.refresh();const saved=await c.saveTask({id,revision:3},{title:'Fixture',text:'Preserved',date:'',status:'open',plannedStartOn:'2030-11-05',plannedEndOn:'2030-11-10'});assert.equal(saved?.revision,4);const state=c.getSnapshot().state;assert.equal(state.status==='ready'&&state.data.tasks[0].revision,5);assert.equal(state.status==='ready'&&state.data.tasks[0].title,'Newer remote title');
});
test('a malformed or source-swapped planning readback cannot reach the projection',async()=>{
 for(const mode of ['revision','source','body']){
  const f=fixture();const c=new PersonalWorkspaceController({fetcher:async(input,init)=>{const response=await f.fetcher(input,init);if(String(input)==='/api/platform/personal/todo/'+id&&!init?.method){const body=await response.json();if(mode==='revision')body.entry.revision=undefined;if(mode==='source')body.entry.source.id='55555555-5555-4555-8555-555555555555';if(mode==='body')body.entry.draft.plannedEndOn='2030-11-11';return Response.json(body);}return response;},origin:'http://127.0.0.1:3331',today:()=> '2026-10-27',key:()=>crypto.randomUUID()});await c.refresh();assert.equal(await c.saveTask({id,revision:3},{title:'Fixture',text:'Preserved',date:'',status:'open',plannedStartOn:'2030-11-05',plannedEndOn:'2030-11-10'}),null);const state=c.getSnapshot().state;assert.equal(state.status==='ready'&&state.data.tasks[0].plannedStartOn,null);assert.match(c.getSnapshot().mutationError??'',/回读/);
 }
});
test('cancelling a held planning readback settles without rendering late saved dates or submitting another write',async()=>{
 const f=fixture();let started=false,release!:()=>void;const gate=new Promise<void>(r=>release=r);const c=new PersonalWorkspaceController({fetcher:async(input,init)=>{if(String(input)==='/api/platform/personal/todo/'+id&&!init?.method){started=true;await gate;}return f.fetcher(input,init);},origin:'http://127.0.0.1:3331',today:()=> '2026-10-27',key:()=>crypto.randomUUID()});await c.refresh();let settled=false;const fields={title:'Fixture',text:'Preserved',date:'',status:'open' as const,plannedStartOn:'2030-11-05',plannedEndOn:'2030-11-10'},saving=c.saveTask({id,revision:3},fields).finally(()=>settled=true);for(let i=0;i<8;i++)await new Promise<void>(r=>setImmediate(r));assert.equal(started,true);c.cancel();for(let i=0;i<8;i++)await new Promise<void>(r=>setImmediate(r));assert.equal(settled,true);release();assert.equal(await saving,null);await c.saveTask({id,revision:3},fields);assert.equal(f.writes.length,1);const state=c.getSnapshot().state;assert.equal(state.status==='ready'&&state.data.tasks[0].plannedStartOn,null);
});

test('batch readback failure retains exact command across reload and does not skip independent GET',async()=>{
 const f=fixture();let readback=false,expired=false;const reads:string[]=[];
 const fetcher:typeof fetch=async(input,init)=>{const path=String(input);if(path.endsWith('/status')&&expired)return Response.json({}, {status:401});if(path.endsWith('/todo/44444444-4444-4444-8444-444444444444')){reads.push(path);if(!readback)throw Error('lost readback');const response=await f.fetcher('/api/platform/personal/overview');const data=await response.json();return Response.json({entry:data.items[0]});}return f.fetcher(input,init);};
 const storage={getItem:(k:string)=>f.storage.get(k)??null,setItem:(k:string,v:string)=>{f.storage.set(k,v);},removeItem:(k:string)=>{f.storage.delete(k);}};
 const create=()=>new PersonalWorkspaceController({fetcher,origin:'http://127.0.0.1:3331',storage,today:()=> '2026-10-27',key:()=>crypto.randomUUID()});
 const command=makePersonalCommand({ownerId:'fixture-owner',spaceId:'fixture-space'},'todo',null,{title:'明天交稿',notes:'',dueOn:null,status:'open'},'batch-exact-original',true);
 const first=create();await first.refresh();assert.equal(await first.saveBatchTask(command),null);assert.equal(first.getSnapshot().uncertain,true);assert.equal(reads.length,1);assert.equal(f.writes.length,1);first.suspend();
 const second=create();await second.refresh();assert.equal(second.getSnapshot().uncertain,true);expired=true;assert.equal(await second.saveBatchTask(command),null);assert.notEqual(second.getSnapshot().state.status,'ready');assert.equal(f.writes.length,1);
 expired=false;readback=true;await second.refresh();const saved=await second.saveBatchTask(command);assert.equal(saved?.id,'44444444-4444-4444-8444-444444444444');assert.equal(second.getSnapshot().uncertain,false);assert.equal(reads.length,2);assert.deepEqual(f.writes[0],f.writes[1]);assert.equal(f.storage.size,0);
});
test('batch preflight preserves raw input while following the single writer title normalization',async()=>{
 const {TaskBatch}=await import('../src/personal-candidate/task-batch.ts');const f=fixture();await f.controller.refresh();const store=new Map<string,string>();const batch=new TaskBatch({ownerId:'fixture-owner',spaceId:'fixture-space'},{getItem:k=>store.get(k)??null,setItem:(k,v)=>{store.set(k,v);},removeItem:k=>{store.delete(k);}},()=>crypto.randomUUID());batch.preview('  明天交稿  ');await batch.run(c=>f.controller.saveBatchTask(c));assert.equal(f.writes.length,1);assert.equal(f.writes[0].body.fields.title,'明天交稿');assert.equal(batch.raw,'  明天交稿  ');
});

test('batch status and POST/GET authorization loss conceal private projections while preserving original command',async()=>{
 for(const loss of ['preflight','post','get'] as const){
  const f=fixture();let triggered=false;const fetcher:typeof fetch=async(input,init)=>{const path=String(input);if(triggered&&loss==='preflight'&&path.endsWith('/status'))return Response.json({}, {status:401});if(triggered&&loss==='post'&&init?.method==='POST')return Response.json({error:{code:'UNAUTHORIZED'}},{status:401});if(triggered&&loss==='get'&&path.includes('/todo/')&&!init?.method)return Response.json({error:{code:'FORBIDDEN'}},{status:403});return f.fetcher(input,init);};
  const c=new PersonalWorkspaceController({fetcher,origin:'http://127.0.0.1:3331',storage:{getItem:k=>f.storage.get(k)??null,setItem:(k,v)=>{f.storage.set(k,v);},removeItem:k=>{f.storage.delete(k);}},today:()=> '2026-10-27',key:()=>crypto.randomUUID()});await c.refresh();
  const command=makePersonalCommand({ownerId:'fixture-owner',spaceId:'fixture-space'},'todo',null,{title:'Private batch content',notes:'',dueOn:null,status:'open'},'batch-auth-boundary',true);
  if(loss==='preflight'){f.lose();await c.saveBatchTask(command);assert.equal(c.getSnapshot().uncertain,true);}
  triggered=true;await c.saveBatchTask(command);assert.notEqual(c.getSnapshot().state.status,'ready',loss);assert.equal(c.getEditorBinding(),null,loss);if(loss!=='preflight')assert.equal(f.storage.size,1,'POST/GET loss preserves writer command');
 }
});
test('unattempted retained batch yields to an unrelated original unknown command',async()=>{const f=fixture();await f.controller.refresh();f.lose();await f.controller.saveTask(null,{title:'Original single task',text:'',date:'',status:'open'});assert.equal(f.controller.getSnapshot().uncertain,true);assert.equal(f.controller.matchesPendingBatchCommand(null),false);const pending=[...f.storage.values()].map(v=>JSON.parse(v))[0];assert.equal(f.controller.matchesPendingBatchCommand(pending),true);assert.equal(f.writes.length,1);});
test('batch post-readback status scope loss conceals owner space storage and writable mismatches',async()=>{for(const patch of [{ownerId:'other-owner'},{spaceId:'other-space'},{storageVerified:false},{writable:false},{scope:'wrong-scope'},{allowedTypes:[]}]){const f=fixture();const fetcher:typeof fetch=async(input,init)=>{const path=String(input);if(path.endsWith('/status')&&f.writes.length){const body=await (await f.fetcher(input,init)).json();return Response.json({...body,...patch});}if(path.includes('/todo/')&&!init?.method){const body=await (await f.fetcher('/api/platform/personal/overview')).json();return Response.json({entry:body.items[0]});}return f.fetcher(input,init);};const c=new PersonalWorkspaceController({fetcher,origin:'http://127.0.0.1:3331',storage:{getItem:k=>f.storage.get(k)??null,setItem:(k,v)=>{f.storage.set(k,v);},removeItem:k=>{f.storage.delete(k);}},today:()=> '2026-10-27',key:()=>crypto.randomUUID()});await c.refresh();const command=makePersonalCommand({ownerId:'fixture-owner',spaceId:'fixture-space'},'todo',null,{title:'Private batch',notes:'',dueOn:null,status:'open'},'batch-post-scope-loss',true);assert.equal(await c.saveBatchTask(command),null);assert.notEqual(c.getSnapshot().state.status,'ready',JSON.stringify(patch));assert.equal(c.getEditorBinding(),null);assert.equal(f.storage.size,1);assert.deepEqual(JSON.parse([...f.storage.values()][0]),command);}});
test('stopping a held batch retry preflight settles without losing command or posting late status',async()=>{const f=fixture();let hold=false,entered!:()=>void,release!:()=>void;const seen=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);const c=new PersonalWorkspaceController({fetcher:async(input,init)=>{if(hold&&String(input).endsWith('/status')){entered();await gate;}return f.fetcher(input,init);},origin:'http://127.0.0.1:3331',storage:{getItem:k=>f.storage.get(k)??null,setItem:(k,v)=>{f.storage.set(k,v);},removeItem:k=>{f.storage.delete(k);}},today:()=> '2026-10-27',key:()=>crypto.randomUUID()});await c.refresh();const command=makePersonalCommand({ownerId:'fixture-owner',spaceId:'fixture-space'},'todo',null,{title:'Synthetic retry',notes:'',dueOn:null,status:'open'},'held-batch-retry',true);f.lose();await c.saveBatchTask(command);hold=true;let settled=false;const retry=c.saveBatchTask(command).finally(()=>settled=true);await seen;c.cancel();for(let i=0;i<5;i++)await new Promise<void>(r=>setImmediate(r));try{assert.equal(settled,true);assert.equal(c.getSnapshot().uncertain,true);assert.equal(f.writes.length,1);assert.deepEqual(JSON.parse([...f.storage.values()][0]),command);}finally{release();await retry;}assert.equal(f.writes.length,1);});
