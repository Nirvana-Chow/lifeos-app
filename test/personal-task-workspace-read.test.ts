import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {MemoryPort} from './helpers/platform.ts';
import {journalFixture,journalStatus} from './helpers/journal-history.ts';
import type {PersonalConfig,PersonalType} from '../src/personal-candidate/config.ts';
import {createPersonalPlatformHandler} from '../src/personal-candidate/runtime-http.ts';
import {personalEntryType,PersonalService} from '../src/personal-candidate/service.ts';
import type {StoredEntry} from '../src/platform/contracts.ts';
import {PostgresPlatformRepository,type SqlPool} from '../src/platform/postgres.ts';
import {PersonalWorkspaceController} from '../src/personal-candidate/workspace-controller.ts';
import {workspaceData} from '../src/personal-candidate/workspace-data.ts';
import {reminderSourceDigest} from '../src/import-preview/reminders.ts';

const path='/api/platform/personal/todo/workspace-snapshot';
const date='2026-11-26';
const query=path+'?today='+date;
const cookie='synthetic-owner-session=1';
const types=['todo','project','domain','topic'] as const;
const configBase:PersonalConfig={
 ownerId:'synthetic-task-workspace-owner',ownerEmail:'tasks@example.invalid',spaceId:journalStatus.spaceId,
 databaseName:'synthetic',baseURL:'http://127.0.0.1',approval:'personal-manual-v1',allowedTypes:[...types,'journal'],
};
const source=(row:StoredEntry)=>row.source.original as {marker?:string;spaceId?:string;type?:PersonalType};

async function fixture(t:TestContext){
 const memory=new MemoryPort(),reads:{kind:'wide'|'narrow';rows:number;types?:readonly string[]}[]=[];
 const rows=()=>[...memory.rows.values()];
 memory.readCurrentSnapshot=async owner=>{
  const selected=rows().filter(row=>row.ownerId===owner).sort((a,b)=>a.id.localeCompare(b.id));
  reads.push({kind:'wide',rows:selected.length});
  return selected;
 };
 const repository=Object.assign(memory,{
  async readTaskWorkspaceSnapshot(owner:string,spaceId:string,allowedTypes:readonly PersonalType[]){
   const selected=rows().filter(row=>row.ownerId===owner&&source(row).spaceId===spaceId&&allowedTypes.includes(source(row).type!)).sort((a,b)=>a.id.localeCompare(b.id));
   reads.push({kind:'narrow',rows:selected.length,types:allowedTypes});
   return selected;
  },
 });
 const seed=new PersonalService(repository,configBase);
 const add=async(type:PersonalType,fields:unknown)=>(
  await seed.mutate(configBase.ownerId,type,null,{spaceId:configBase.spaceId,confirmed:true,fields},'synthetic-narrow-'+type)
 ).entry;
 const reference=({id,source,revision}:{id:string;source:{id:string};revision:number})=>({id,sourceId:source.id,revision});
 const domain=await add('domain',{title:'Synthetic area',text:'',occurredOn:null,personal:{type:'domain'}});
 const topic=await add('topic',{title:'Synthetic topic',text:'',occurredOn:null,personal:{type:'topic'}});
 const project=await add('project',{title:'Synthetic project',text:'',occurredOn:null,
  personal:{type:'project',stage:'active',purpose:null,nextStep:'',domain:reference(domain),topics:[reference(topic)]}});
 const todo=await add('todo',{title:'Synthetic linked todo',notes:'Exact todo note',dueOn:'2026-11-26',status:'open',
  personal:{project:reference(project),domain:null,topics:[reference(topic)]}});
 for(let i=1;i<=176;i++){
  const entry=journalFixture(i,date,'Fictional unrelated material. '.repeat(16));
  memory.rows.set(entry.id,{...entry,ownerId:configBase.ownerId});
 }

 let session: {userId:string;email:string;sessionRef?:string}|null={userId:configBase.ownerId,email:configBase.ownerEmail,sessionRef:'synthetic-session-one'};
 let spaceId=configBase.spaceId;
 let expireAfterRead=false,storageVerified=true,allowedTypes=configBase.allowedTypes,readerAvailable=true;
 let writable=false,permitChecks=0;
 let origin:string;
 const server=createServer(async(req,res)=>{
  const handler=createPersonalPlatformHandler({
   config:{...configBase,baseURL:origin,allowedTypes,spaceId},storageVerified,
   taskSnapshotValidatorKey:'synthetic-task-snapshot-test-key',
   repository:readerAvailable?repository:memoryWithoutReader,
   sessions:{read:async headers=>headers.get('cookie')===cookie&&(!expireAfterRead||reads.length===0)?session:null},
   assertWritable:async()=>{permitChecks++;if(!writable)throw Error('Synthetic write permit closed');},
  });
  const response=await handler(new Request(origin+req.url,{method:req.method,headers:new Headers(req.headers as Record<string,string>)}));
  res.writeHead(response.status,Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
 });
 const memoryWithoutReader=new MemoryPort();
 memoryWithoutReader.readCurrentSnapshot=memory.readCurrentSnapshot;
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
 origin='http://127.0.0.1:'+(server.address() as AddressInfo).port;
 return {reads,todo,project,domain,topic,origin,row:(id:string)=>memory.rows.get(id)!,remove:(id:string)=>memory.rows.delete(id),put:(row:StoredEntry)=>memory.rows.set(row.id,row),
  get:(url:string,init?:RequestInit)=>fetch(origin+url,{...init,headers:{cookie,...init?.headers}}),
  setSession:(value:typeof session)=>{session=value;},
  setExpiry:()=>{expireAfterRead=true;},
  setSpace:(value:string)=>{spaceId=value;},
  setStorage:(value:boolean)=>{storageVerified=value;},
  setAllowed:(value:readonly PersonalType[])=>{allowedTypes=value;},
  removeReader:()=>{readerAvailable=false;},
  openWritePermit:()=>{writable=true;},
  permitChecks:()=>permitChecks,
 };
}

test('the opted-in owner HTTP path loads only task workspace records, preserving source and legacy overview',async t=>{
 const f=await fixture(t);
 const wide=await f.get('/api/platform/personal/overview?today='+date),wideText=await wide.text();
 assert.equal(wide.status,200);
 assert.equal(JSON.parse(wideText).scope,'full-current-snapshot');
 const narrow=await f.get(query),narrowText=await narrow.text();
 assert.equal(narrow.status,200);
 assert.equal(narrow.headers.get('cache-control'),'private, no-store');
 assert.equal(narrow.headers.get('vary'),'Cookie');
 const snapshot=JSON.parse(narrowText);
 assert.equal(snapshot.scope,'task-workspace-current-snapshot');
 assert.equal(snapshot.today,date);
 assert.equal(snapshot.truncated,false);
 assert.equal(snapshot.total,4);
 assert.ok(Number.isFinite(Date.parse(snapshot.observedAt)));
 const expected=JSON.parse(wideText).items.filter((entry:StoredEntry)=>types.some(type=>type===personalEntryType(entry,configBase.spaceId)));
 assert.deepEqual(snapshot.items,expected);
 const legacy=JSON.parse(wideText);
 const projected=workspaceData({...snapshot,scope:legacy.scope,observedAt:legacy.observedAt},configBase.spaceId,date).data;
 assert.deepEqual(projected,workspaceData(legacy,configBase.spaceId,date).data);
 assert.equal(projected.tasks[0]?.area?.id,f.domain.id,'existing project-domain inheritance is preserved');
 assert.ok(snapshot.items.every((row:StoredEntry)=>!('ownerId' in row)));
 assert.deepEqual(new Set(snapshot.items.map((entry:StoredEntry)=>entry.id)),new Set([f.todo.id,f.project.id,f.domain.id,f.topic.id]));
 assert.deepEqual(f.reads,[{kind:'wide',rows:180},{kind:'narrow',rows:4,types:[...types]}]);
 assert.ok(Buffer.byteLength(narrowText)<Buffer.byteLength(wideText)/10);
 const old=await f.get('/api/platform/personal/overview?today='+date);
 assert.deepEqual((await old.json()).items,JSON.parse(wideText).items);
 const journal=await f.get('/api/platform/personal/journal/snapshot');
 assert.equal((await journal.json()).total,176);
 t.diagnostic(JSON.stringify({oldBytes:Buffer.byteLength(wideText),narrowBytes:Buffer.byteLength(narrowText),oldFixtureRowsReturned:180,narrowFixtureRowsReturned:4,physicalPostgres:false}));
});

test('task snapshot revalidation is private, session-bound and compares the whole representation',async t=>{
 const f=await fixture(t),bundled=query+'&include=access';
 const read=(tag:string|null)=>f.get(bundled,tag?{headers:{'If-None-Match':tag}}:undefined);
 const first=await read(null),etag=first.headers.get('etag');
 assert.equal(first.status,200);assert.ok(etag);assert.equal((await first.json()).total,4);
 const same=await read(etag);
 assert.equal(same.status,304);assert.equal(await same.text(),'');
 assert.equal(same.headers.get('cache-control'),'private, no-store');assert.equal(same.headers.get('vary'),'Cookie');
 assert.ok(Number.isFinite(Date.parse(same.headers.get('x-lifeos-snapshot-observed-at')!)));
 assert.equal(f.reads.length,2,'storage is still independently checked');
 const legacy=await f.get(query,{headers:{'If-None-Match':etag}});
 assert.equal(legacy.status,200);assert.equal(legacy.headers.get('etag'),null);
 f.setSession({userId:configBase.ownerId,email:configBase.ownerEmail,sessionRef:'synthetic-new-session'});
 const newSession=await read(etag),newTag=newSession.headers.get('etag');
 assert.equal(newSession.status,200);assert.ok(newTag&&newTag!==etag);
 // Keep item count and even the fixture revision unchanged. Representation edits still invalidate.
 const task=f.row(f.todo.id);
 f.put({...task,draft:{...task.draft,title:'Same count edit'}});
 const changed=await read(newTag),changedTag=changed.headers.get('etag');
 assert.equal(changed.status,200);assert.notEqual(changedTag,newTag);
 assert.equal((await changed.json()).items.find((row:StoredEntry)=>row.id===task.id).draft.title,'Same count edit');
 f.remove(f.todo.id);
 const removed=await read(changedTag);assert.equal(removed.status,200);assert.equal((await removed.json()).total,3);
 const removedTag=removed.headers.get('etag');f.openWritePermit();
 const writable=await read(removedTag);assert.equal(writable.status,200);assert.equal((await writable.json()).access.writable,true);
 f.setSpace('synthetic-another-space');
 const moved=await read(writable.headers.get('etag'));assert.equal(moved.status,200);assert.equal((await moved.json()).total,0);
 const tag=moved.headers.get('etag');
 f.setSession(null);assert.equal((await read(tag)).status,401);
 f.setSession({userId:'synthetic-other-owner',email:configBase.ownerEmail,sessionRef:'synthetic-new-session'});
 assert.equal((await read(tag)).status,403);
 f.setSession({userId:configBase.ownerId,email:configBase.ownerEmail,sessionRef:'synthetic-new-session'});
 f.reads.length=0;f.setExpiry();assert.equal((await read(tag)).status,401);
});

test('the real foreground reader renders a 304 only from its validated in-memory snapshot',async t=>{
 const f=await fixture(t);const requests:{status:number;tag:string|null}[]=[];
 const controller=new PersonalWorkspaceController({origin:f.origin,taskWorkspace:true,today:()=>date,key:()=>crypto.randomUUID(),fetcher:async(input,init)=>{
  const url=String(input),r=await f.get(url,init);
  if(url.includes('workspace-snapshot'))requests.push({status:r.status,tag:new Headers(init?.headers).get('if-none-match')});
  return r;
 }});
 await controller.refresh();assert.equal(requests[0]?.status,200);assert.equal(requests[0]?.tag,null);
 assert.ok(controller.getTaskEntry(f.todo));
 controller.suspendForBackground();assert.equal(controller.getTaskEntry(f.todo),null);
 await controller.refresh();assert.equal(requests[1]?.status,304);assert.ok(requests[1]?.tag);
 assert.ok(controller.getTaskEntry(f.todo));
 controller.suspendForBackground();f.setSession(null);await controller.refresh();
 assert.equal(requests[2]?.status,401);assert.equal(controller.getSnapshot().state.status,'forbidden');assert.equal(controller.getTaskEntry(f.todo),null);
 f.setSession({userId:configBase.ownerId,email:configBase.ownerEmail,sessionRef:'synthetic-new-session'});
 await controller.refresh();assert.equal(requests[3]?.tag,null);assert.equal(requests[3]?.status,200);
 controller.suspend();await controller.refresh();assert.equal(requests[4]?.tag,null);
});

test('the narrow read rejects unapproved calls without fallback, and rechecks authority before disclosure',async t=>{
 const f=await fixture(t);
 for(const [url,init,status] of [
  [query,{headers:{cookie:''}},401],
  [query,{headers:{authorization:'Bearer synthetic'}},403],
  [query,{headers:{origin:'https://foreign.example.invalid'}},403],
  [query,{headers:{'sec-fetch-site':'same-site'}},403],
  [query,{method:'POST'},405],
  [path,{},400],
  [query+'&today='+date,{},400],
  [query+'&type=journal',{},400],
  [path+'?today=2026-02-30',{},400],
 ] as const){
  const response=await f.get(url,init);
  assert.equal(response.status,status,`${url} ${JSON.stringify(init)}`);
  assert.equal((await response.json()).items,undefined);
 }
 f.setSession({userId:'synthetic-other-owner',email:configBase.ownerEmail});
 assert.equal((await f.get(query)).status,403);
 f.setSession({userId:configBase.ownerId,email:configBase.ownerEmail});
 f.setAllowed(['journal']);
 assert.equal((await f.get(query)).status,403);
 f.setAllowed(configBase.allowedTypes);
 f.setStorage(false);
 assert.equal((await f.get(query)).status,503);
 f.setStorage(true);
 f.removeReader();
 assert.equal((await f.get(query)).status,503);
 assert.deepEqual(f.reads,[]);
 assert.equal((await f.get('/api/platform/personal/overview?today='+date)).status,200);
});

test('revoking the owner after the narrow storage read releases no items',async t=>{
 const f=await fixture(t);
 f.setExpiry();
 const response=await f.get(query);
 assert.equal(response.status,401);
 assert.equal((await response.json()).items,undefined);
 assert.deepEqual(f.reads,[{kind:'narrow',rows:4,types:[...types]}]);
});

test('the narrow scope preserves Apple originals and excludes foreign or malformed source rows',async t=>{
 const f=await fixture(t);
 const appleSource={
  id:'77777777-7777-4777-8777-777777777777',listID:'88888888-8888-4888-8888-888888888888',
  capturedAt:'2026-11-25T03:00:00Z',isCompleted:false,dueDate:null,dueDateIsAllDay:null,completionDate:null,
  original:{title:'Synthetic Apple original'},notesIncluded:false,sourceTimes:{},
 };
 const original={marker:'personal-apple-reminders-v1',spaceId:configBase.spaceId,type:'todo',
  sourceRef:'apple-reminder:'+appleSource.id,sourceDigest:reminderSourceDigest(appleSource),source:appleSource,
  initialDraft:{title:appleSource.original.title,notes:'',dueOn:null,status:'open'}};
 const id='77777777-7777-4777-8777-777777777772';
 const valid={...f.todo,id,ownerId:configBase.ownerId,
  source:{...f.todo.source,id:'77777777-7777-4777-8777-777777777771',externalId:id,original}};
 f.put(valid);
 const corruptId='77777777-7777-4777-8777-777777777774';
 f.put({...valid,id:corruptId,source:{...valid.source,externalId:corruptId,original:{...original,sourceDigest:'0'.repeat(64)}}});
 const otherId='77777777-7777-4777-8777-777777777775';
 f.put({...valid,id:otherId,ownerId:'synthetic-other-owner',source:{...valid.source,externalId:otherId}});
 const foreignSpaceId='77777777-7777-4777-8777-777777777776';
 f.put({...valid,id:foreignSpaceId,source:{...valid.source,externalId:foreignSpaceId,original:{...original,spaceId:'synthetic-other-space'}}});
 f.setAllowed(['todo','project','journal']);
 const response=await f.get(query);
 assert.equal(response.status,200);
 const {items}=await response.json();
 assert.deepEqual(new Set(items.map((row:StoredEntry)=>row.id)),new Set([id,f.todo.id,f.project.id]));
 assert.deepEqual(items.find((row:StoredEntry)=>row.id===id).source.original,original);
 assert.deepEqual(f.reads,[{kind:'narrow',rows:4,types:['todo','project']}]);
});

test('the PostgreSQL adapter binds owner, space and types in a read-only query before decoding',async()=>{
 const calls:{sql:string;values?:unknown[]}[]=[];
 let released=false;
 const pool:SqlPool={connect:async()=>({
  query:async(sql,values)=>{
   calls.push({sql,values});
   return {rows:[],rowCount:0};
  },
  release:()=>{released=true;},
 })};
 const repository=new PostgresPlatformRepository(pool,true);
 assert.deepEqual(await repository.readTaskWorkspaceSnapshot(configBase.ownerId,configBase.spaceId,types),[]);
 assert.equal(calls[0]?.sql,'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 assert.deepEqual(calls[1],{sql:"SELECT set_config('lifeos.owner_id',$1,true)",values:[configBase.ownerId]});
 const read=calls[2]!;
 assert.match(read.sql,/JOIN lifeos_platform\.platform_source s ON s\.owner_id=r\.owner_id AND s\.id=r\.source_id/);
 assert.match(read.sql,/r\.owner_id=\$1 AND s\.original->>'spaceId'=\$2 AND s\.original->>'type'=ANY\(\$3::text\[\]\)/);
 assert.match(read.sql,/personal-manual-v1/);
 assert.match(read.sql,/personal-apple-reminders-v1/);
 assert.match(read.sql,/ORDER BY r\.id LIMIT 10001/);
 assert.deepEqual(read.values,[configBase.ownerId,configBase.spaceId,types]);
 assert.equal(calls[3]?.sql,'COMMIT');
 assert.equal(calls.length,4);
 assert.equal(released,true);
});

test('opt-in workspace access uses the same protected snapshot and leaves the legacy response intact',async t=>{
 const f=await fixture(t);
 const legacy=await f.get(query);
 assert.equal(legacy.status,200);
 assert.equal('access' in await legacy.json(),false);
 assert.equal(f.permitChecks(),0);
 const bundle=await f.get(query+'&include=access');
 assert.equal(bundle.status,200);
 assert.equal(bundle.headers.get('cache-control'),'private, no-store');
 assert.equal(bundle.headers.get('vary'),'Cookie');
 const value=await bundle.json();
 assert.equal(value.total,4);
 assert.deepEqual(value.access,{scope:'personal-manual-candidate',ownerId:configBase.ownerId,spaceId:configBase.spaceId,storageVerified:true,allowedTypes:configBase.allowedTypes,writable:false});
 f.openWritePermit();
 assert.equal((await (await f.get(query+'&include=access')).json()).access.writable,true);
 assert.equal(f.permitChecks(),2);
 for(const invalid of ['&include=other','&include=access&include=access','&include=access&extra=true']){
  assert.equal((await f.get(query+invalid)).status,400);
 }
});

test('the opt-in read returns neither access nor data after the bound session is revoked',async t=>{
 const f=await fixture(t);
 f.setExpiry();
 const response=await f.get(query+'&include=access');
 assert.equal(response.status,401);
 const value=await response.json();
 assert.equal(value.error.code,'LOGIN_REQUIRED');
 assert.equal('access' in value,false);
 assert.equal('items' in value,false);
});
