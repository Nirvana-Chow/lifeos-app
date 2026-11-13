import assert from 'node:assert/strict';
import test from 'node:test';
import {createPersonalPlatformHandler} from '../src/personal-candidate/runtime-http.ts';
import {makePersonalCommand,PersonalMutationSession,type PersonalFetch} from '../src/personal-candidate/client.ts';
import {CookingScopeLost,verifyCookingMutationAccess} from '../src/cooking/log-access.ts';
import {MemoryPort} from './helpers/platform.ts';

const baseURL='https://mutation-auth-recovery.example.invalid';
const config={ownerId:'synthetic-auth-recovery-owner',ownerEmail:'recovery@example.invalid',
 spaceId:'synthetic-auth-recovery-space',databaseName:'fixture',baseURL,
 approval:'personal-manual-v1',allowedTypes:['todo','journal'],cookingEnabled:true} as const;
const binding={ownerId:config.ownerId,spaceId:config.spaceId};
const owner={userId:config.ownerId,email:config.ownerEmail};
const storageKey='lifeos.personal.pending.v1:'+config.ownerId+':'+config.spaceId;

function store(){
 const values=new Map<string,string>();
 return{values,port:{getItem:(key:string)=>values.get(key)??null,
  setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}}};
}

function fixture(loss:401|403){
 const repository=new MemoryPort();
 let actor:{userId:string;email:string}|null=owner;
 const handler=createPersonalPlatformHandler({repository,config,storageVerified:true,
  sessions:{read:async()=>actor},assertWritable:async()=>{}});
 const transact=repository.transaction.bind(repository);
 repository.transaction=async(ownerId,key,run)=>{
  const result=await transact(ownerId,key,run);
  actor=loss===401?null:{userId:'synthetic-other-auth-owner',email:'other@example.invalid'};
  return result;
 };
 const requests:{key:string|null;body:string;method:string}[]=[];
 const fetcher:PersonalFetch=async(input,init)=>{
  const headers=new Headers(init?.headers);headers.set('host',new URL(baseURL).host);
  if(init?.method==='POST'||init?.method==='PATCH'){
   headers.set('origin',baseURL);
   requests.push({key:headers.get('idempotency-key'),body:String(init.body),method:init.method});
  }
  return handler(new Request(new URL(String(input),baseURL),{...init,headers}));
 };
 return{repository,requests,fetcher,restore(){actor=owner;repository.transaction=transact;}};
}

for(const type of ['journal','todo'] as const){
 test(`${type} preserves a first post-commit 401/403 until exact owner-scoped recovery`,async t=>{
  for(const loss of [401,403] as const)await t.test(String(loss),async()=>{
   const f=fixture(loss),storage=store();
   const fields=type==='todo'?{title:'synthetic auth todo',notes:'Original synthetic input',dueOn:null,status:'open' as const}
    :{title:'synthetic auth journal',text:'Original synthetic input',occurredOn:null};
   const key=`synthetic-first-auth-${type}-${loss}`;
   const command=makePersonalCommand(binding,type,null,fields,key,true);
   const session=new PersonalMutationSession({binding,storage:storage.port,fetcher:f.fetcher,verifyReadback:true});
   await session.submit(command);
   assert.equal(session.getSnapshot().phase,'uncertain');
   assert.equal(session.getSnapshot().pending?.key,key);
   assert.deepEqual(session.getSnapshot().pending?.body,{spaceId:config.spaceId,confirmed:true,fields});
   assert.equal(session.getSnapshot().saved,null);assert.equal(f.requests.length,1,'no automatic retry');
   assert.deepEqual([...storage.values.keys()],[storageKey]);
   const originalBytes=storage.values.get(storageKey)!;
   assert.equal(JSON.parse(originalBytes).key,key);
   assert.equal(f.repository.rows.size,1);assert.equal(f.repository.receipts.size,1);

   for(const foreignBinding of [{ownerId:'synthetic-foreign-owner',spaceId:config.spaceId},
    {ownerId:config.ownerId,spaceId:'synthetic-foreign-space'}]){
    const foreign=new PersonalMutationSession({binding:foreignBinding,storage:storage.port,fetcher:f.fetcher});
    assert.equal(foreign.getSnapshot().phase,'idle');assert.equal(foreign.getSnapshot().pending,null);
    await foreign.retry();assert.equal(f.requests.length,1);
    assert.equal(storage.values.get(storageKey),originalBytes);
   }
   session.invalidateBinding();f.restore();await session.retry();assert.equal(f.requests.length,1);
   assert.equal(storage.values.get(storageKey),originalBytes);
   const recovered=new PersonalMutationSession({binding,storage:storage.port,fetcher:f.fetcher,verifyReadback:true});
   assert.equal(recovered.getSnapshot().phase,'uncertain');assert.equal(recovered.getSnapshot().pending?.key,key);
   await recovered.retry();
   assert.equal(recovered.getSnapshot().phase,'saved');assert.equal(recovered.getSnapshot().observed?.revision,1);
   assert.equal(storage.values.size,0);assert.equal(f.requests.length,2);
   assert.deepEqual(f.requests[1],f.requests[0]);
   assert.equal(f.repository.rows.size,1);assert.equal(f.repository.receipts.size,1);
   assert.equal(f.repository.historyRows.length,1);assert.equal(f.repository.events.length,1);
  });
 });
}

test('ordinary initial 400/404/409 still reject and clear, while prior-unknown commands stay retained',async t=>{
 for(const status of [400,404,409])await t.test(String(status),async()=>{
  const key='synthetic-known-rejection-'+status;
  const command=makePersonalCommand(binding,'journal',null,{title:'synthetic rejection',text:'Known input',occurredOn:null},key,true);
  const storage=store();let replies=0;
  const reject=()=>Response.json({error:{code:status===409?'REVISION_CONFLICT':status===404?'NOT_FOUND':'INVALID_BODY'}},{status});
  const known=new PersonalMutationSession({binding,storage:storage.port,fetcher:async()=>{replies++;return reject();}});
  await known.submit(command);assert.equal(known.getSnapshot().phase,'rejected');
  assert.equal(known.getSnapshot().pending,null);assert.equal(storage.values.size,0);assert.equal(replies,1);
  await known.retry();assert.equal(replies,1);

  storage.values.set(storageKey,JSON.stringify(command));
  const pending=new PersonalMutationSession({binding,storage:storage.port,fetcher:async()=>reject()});
  await pending.retry();assert.equal(pending.getSnapshot().phase,'uncertain');
  assert.equal(pending.getSnapshot().pending?.key,key);
  assert.equal(storage.values.get(storageKey),JSON.stringify(command));
 });
});

test('Cooking scope wrapper and real session retain post-commit 401 through the existing invalidation path',async()=>{
 const f=fixture(401),storage=store();
 let session:PersonalMutationSession;
 const fetcher:PersonalFetch=async(input,init)=>{
  const response=await f.fetcher(input,init);
  try{await verifyCookingMutationAccess(response,input,binding);}catch(error){
   if(error instanceof CookingScopeLost)session.invalidateBinding();
   throw error;
  }
  return response;
 };
 const fields={title:'synthetic cooking auth',text:'Original cooking note',occurredOn:'2030-02-28',
  personal:{type:'cooking' as const,schemaVersion:1 as const,recipe:null}};
 const key='synthetic-cooking-original-auth-key';
 session=new PersonalMutationSession({binding,storage:storage.port,fetcher,verifyReadback:true});
 await session.submit(makePersonalCommand(binding,'cooking',null,fields,key,true));
 assert.equal(session.getSnapshot().phase,'uncertain');assert.equal(session.getSnapshot().pending?.key,key);
 assert.equal(storage.values.size,1);assert.equal(f.requests.length,1);
 f.restore();await session.retry();assert.equal(f.requests.length,1,'invalidated instance stays inactive');
 session=new PersonalMutationSession({binding,storage:storage.port,fetcher,verifyReadback:true});
 await session.retry();assert.equal(session.getSnapshot().phase,'saved');assert.equal(storage.values.size,0);
 assert.deepEqual(f.requests[1],f.requests[0]);assert.equal(f.repository.rows.size,1);
 assert.equal(f.repository.receipts.size,1);assert.equal(f.repository.historyRows.length,1);
});
