import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlatformHandler} from '../src/platform/http.ts';
import {MemoryPort} from './helpers/platform.ts';
import {TasksClient,TaskRequestError,createTaskCommand} from '../src/tasks-workbench/client.ts';
import {TasksSaveSession} from '../src/tasks-workbench/session.ts';

const owner={id:'synthetic-tasks-owner',email:'tasks-fixture@example.invalid'};
const draft={title:'Synthetic task',notes:'Synthetic notes only',dueOn:'2028-02-29',status:'open' as const};
function harness(){
 const repository=new MemoryPort();let authenticated=true;
 const handler=createPlatformHandler({repository,sessions:{read:async()=>authenticated?{userId:owner.id,email:owner.email}:null},owner,baseURL:'http://127.0.0.1:3111'});
 const transport:typeof fetch=async(input,init)=>handler(new Request(new URL(String(input),'http://127.0.0.1:3111'),{...init,headers:{...Object.fromEntries(new Headers(init?.headers)),origin:'http://127.0.0.1:3111',host:'127.0.0.1:3111'}}));
 return{repository,client:new TasksClient(transport),transport,signOut(){authenticated=false;},signIn(){authenticated=true;}};
}

test('real todo API supports list, create, detail, revision edits, complete, reopen and source history',async()=>{
 const {client}=harness();assert.deepEqual(await client.list(),[]);
 const created=await client.send(createTaskCommand(draft,null,'tasks-test-create'));
 assert.equal(created.entry.draft.title,'Synthetic task');assert.equal(created.entry.syncState,'draft');
 assert.equal((await client.detail(created.entry.id)).revision,1);
 const edited=await client.send(createTaskCommand({...draft,title:'Synthetic corrected'},created.entry,'tasks-test-edit'));
 const done=await client.send(createTaskCommand({...edited.entry.draft,status:'done'},edited.entry,'tasks-test-done'));
 const reopened=await client.send(createTaskCommand({...done.entry.draft,status:'open'},done.entry,'tasks-test-reopen'));
 assert.equal(reopened.entry.revision,4);assert.equal(reopened.entry.draft.status,'open');
 assert.deepEqual(reopened.entry.source.original,draft);
 assert.equal((await client.list()).length,1);
 const history=await client.history(created.entry.id);assert.deepEqual(history.map(e=>e.revision),[4,3,2,1]);
});

test('invalid calendar dates are rejected before a command exists; blank date is optional',()=>{
 for(const dueOn of ['2027-02-29','2026-04-31','2026-13-01','2026-1-01'])assert.throws(()=>createTaskCommand({...draft,dueOn},null,'tasks-date-invalid'));
 assert.equal(JSON.parse(createTaskCommand({...draft,dueOn:''},null,'tasks-date-empty').body).dueOn,null);
 assert.throws(()=>createTaskCommand({...draft,title:' '},null,'tasks-title-empty'));
});

test('lost create response preserves frozen body and key, locks replacement and retries without a duplicate',async()=>{
 const h=harness();let lose=true;const requests:{body:unknown;key:string|null}[]=[];
 const client=new TasksClient(async(input,init)=>{requests.push({body:init?.body,key:new Headers(init?.headers).get('idempotency-key')});const response=await h.transport(input,init);if(lose){lose=false;throw Error('synthetic lost response');}return response;});
 const session=new TasksSaveSession(client,()=> 'tasks-lost-response');const mutable={...draft};
 await session.save(mutable);mutable.title='Later edit';
 assert.equal(session.getSnapshot().phase,'uncertain');assert.equal(h.repository.rows.size,1);
 assert.throws(()=>session.reset(),/确认/);await assert.rejects(()=>session.save(mutable),/确认/);
 await session.retry();const state=session.getSnapshot();assert.equal(state.phase,'saved');
 assert.equal(state.result?.duplicate,true);assert.equal(state.result?.entry.draft.title,'Synthetic task');
 assert.equal(h.repository.rows.size,1);assert.equal(h.repository.historyRows.length,1);
 assert.deepEqual(requests[1],requests[0]);assert.equal(requests[0].key,'tasks-lost-response');
});

test('an uncertain request stays frozen through a later 401 and resumes after login',async()=>{
 const h=harness();let lose=true;
 const session=new TasksSaveSession(new TasksClient(async(input,init)=>{const response=await h.transport(input,init);if(lose){lose=false;throw Error('lost');}return response;}),()=> 'tasks-auth-retry');
 await session.save(draft);h.signOut();await session.retry();
 assert.equal(session.getSnapshot().phase,'uncertain');assert.equal(session.getSnapshot().error?.status,401);
 assert.equal(session.getSnapshot().pending?.key,'tasks-auth-retry');
 h.signIn();await session.retry();assert.equal(session.getSnapshot().phase,'saved');assert.equal(h.repository.rows.size,1);
});

test('revision conflicts preserve correction for explicit rebase; no silent overwrite',async()=>{
 const h=harness();const initial=(await h.client.send(createTaskCommand(draft,null,'tasks-conflict-create'))).entry;
 await h.client.send(createTaskCommand({...draft,notes:'Another editor'},initial,'tasks-conflict-external'));
 const session=new TasksSaveSession(h.client,()=> 'tasks-conflict-save');
 await session.save({...draft,notes:'My correction'},initial);
 assert.equal(session.getSnapshot().phase,'conflict');assert.equal(session.getSnapshot().pending,null);
 assert.equal((await h.client.detail(initial.id)).draft.notes,'Another editor');
 assert.equal(session.getSnapshot().attempt?.body.includes('My correction'),true);
});

test('401, forbidden ownership and malformed reads never turn into empty task lists',async()=>{
 for(const [status,code]of [[401,'LOGIN_REQUIRED'],[403,'ACCOUNT_NOT_ALLOWED']]as const){
  const client=new TasksClient(async()=>Response.json({error:{code,message:'Untrusted detail'}},{status}));
  await assert.rejects(()=>client.list(),error=>error instanceof TaskRequestError&&error.status===status&&!error.uncertain);
 }
 await assert.rejects(()=>new TasksClient(async()=>Response.json({items:[{id:'broken'}]})).list(),TaskRequestError);
});

test('5xx and malformed success keep a command pending; a definitive initial 400 permits correction',async()=>{
 for(const response of [()=>new Response(null,{status:503}),()=>Response.json({entry:{id:'broken'},duplicate:false})]){
  const session=new TasksSaveSession(new TasksClient(async()=>response()),()=> 'tasks-uncertain-write');await session.save(draft);
  assert.equal(session.getSnapshot().phase,'uncertain');assert.equal(session.getSnapshot().pending?.key,'tasks-uncertain-write');
 }
 const session=new TasksSaveSession(new TasksClient(async()=>Response.json({error:{code:'INVALID_TEXT'}},{status:400})),()=> 'tasks-rejected-write');
 await session.save(draft);assert.equal(session.getSnapshot().phase,'rejected');assert.equal(session.getSnapshot().pending,null);session.reset();
});

test('restored tab recovery retries the persisted body and key; corrupt recovery blocks new writes',async()=>{
 const {createTasksCommandStore}=await import('../src/tasks-workbench/recovery.ts');
 const data=new Map<string,string>();const storage={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);},removeItem:(key:string)=>{data.delete(key);}};
 const h=harness();const store=createTasksCommandStore(storage);let lost=true;
 const first=new TasksSaveSession(new TasksClient(async(input,init)=>{const response=await h.transport(input,init);if(lost){lost=false;throw Error('lost');}return response;}),()=> 'tasks-restored-key',store);
 await first.save(draft);assert.equal(data.size,1);
 const restored=new TasksSaveSession(h.client,()=> 'must-not-be-used',store);
 assert.equal(restored.getSnapshot().pending?.key,'tasks-restored-key');await restored.retry();
 assert.equal(h.repository.rows.size,1);assert.equal(data.size,0);
 storage.setItem('lifeos.tasks.pending.v1','{"apiKey":"synthetic-disallowed-field"}');
 assert.throws(()=>new TasksSaveSession(h.client,()=> 'must-not-send',store));
});

test('unavailable recovery storage prevents sending a command',async()=>{
 const h=harness();const store={load:()=>null,keep:()=>{throw Error('storage unavailable');},clear:()=>{}};
 const session=new TasksSaveSession(h.client,()=> 'tasks-storage-fail',store);
 await assert.rejects(()=>session.save(draft));assert.equal(h.repository.rows.size,0);
});

test('an unparseable 400 after a lost response cannot release the pending command',async()=>{
 const h=harness();let calls=0;const session=new TasksSaveSession(new TasksClient(async(input,init)=>{if(++calls===1){await h.transport(input,init);throw Error('lost');}return new Response('proxy failure',{status:400});}),()=> 'tasks-unknown-400');
 await session.save(draft);await session.retry();assert.equal(session.getSnapshot().phase,'uncertain');
 await assert.rejects(()=>session.save({...draft,title:'Replacement'}));assert.equal(h.repository.rows.size,1);
});

test('an incomplete successful task response is rejected instead of claiming save success',async()=>{
 const h=harness();const result=await h.client.send(createTaskCommand(draft,null,'tasks-full-response'));
 const client=new TasksClient(async()=>Response.json({...result,entry:{...result.entry,draft:{title:'Only title'}}}));
 await assert.rejects(()=>client.send(createTaskCommand(draft,null,'tasks-incomplete-response')),error=>error instanceof TaskRequestError&&error.uncertain);
});

test('developer review requires both explicit access and a connected review account',async()=>{
 const {resolveTasksAccess}=await import('../src/tasks-workbench/access.ts');
 assert.equal(resolveTasksAccess('unavailable','review-only'),'owner-unavailable');
 assert.equal(resolveTasksAccess('developer-review','not-signed-in'),'signed-out');
 assert.equal(resolveTasksAccess('developer-review','unavailable'),'service-unavailable');
 assert.equal(resolveTasksAccess('developer-review','review-only'),'developer-review');
});

test('command preserves the typed original title while the API normalizes the editable draft',async()=>{
 const h=harness();const fields={...draft,title:'  Synthetic original spacing  '};
 const result=await h.client.send(createTaskCommand(fields,null,'tasks-original-spacing'));
 assert.equal(result.entry.draft.title,'Synthetic original spacing');
 assert.deepEqual(result.entry.source.original,fields);
});

test('authentication invalidation prevents late list and detail responses from publishing',async()=>{
 const {createTasksReadFence}=await import('../src/tasks-workbench/read-state.ts');const fence=createTasksReadFence();
 const list=fence.begin('list'),detail=fence.begin('detail');assert.equal(list(),true);
 fence.invalidate();assert.equal(list(),false);assert.equal(detail(),false);
 const refreshed=fence.begin('list');assert.equal(refreshed(),true);fence.dispose();assert.equal(refreshed(),false);
});

test('switching tasks invalidates stale detail and history without discarding a list refresh',async()=>{
 const {createTasksReadFence}=await import('../src/tasks-workbench/read-state.ts');const fence=createTasksReadFence();
 const list=fence.begin('list'),detail=fence.begin('detail'),history=fence.begin('history');
 fence.invalidate('detail','history');assert.equal(list(),true);assert.equal(detail(),false);assert.equal(history(),false);
 const first=fence.begin('detail'),latest=fence.begin('detail');assert.equal(first(),false);assert.equal(latest(),true);
});
