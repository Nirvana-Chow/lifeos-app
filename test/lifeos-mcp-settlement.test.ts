import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,rmSync,existsSync,mkdirSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {agentOperations} from '../src/agent-api/capabilities.ts';
import {LifeOSApiClient} from '../src/mcp-candidate/client.ts';

const origin='https://lifeos.nirvanachow.com';
const fingerprint='a'.repeat(64);
const id='11111111-1111-4111-8111-111111111111';
const sourceId='22222222-2222-4222-8222-222222222222';
const fields={title:'Synthetic journal',text:'Body',occurredOn:null,personal:null};
const command={fields,idempotencyKey:'synthetic-settlement-01'};
const entry={id,sourceId,revision:1,fields};

// A matching GET must not bless a receipt that changed the requested association,
// introduced a field, or used a noninitial create revision.
test('full canonical create receipt rejects unexpected fields and revision despite a matching GET',async()=>{
 for(const bad of [
  {...entry,revision:99},
  {...entry,fields:{...fields,personal:{type:'journal',links:{project:{id,sourceId,revision:1},domain:null,topics:[],people:[]}}}},
  {...entry,fields:{...fields,workflow:{state:'planned'}}},
 ]){
  const client=new LifeOSApiClient({origin,credentialProvider:async()=>'synthetic-provider'},async url=>Response.json(String(url).endsWith('/v2/capabilities')?{apiVersion:'2',operations:agentOperations}:{entry:bad}));
  const result=await client.execute('createJournal',command);
  assert.equal(result.ok,false);
  assert.notEqual(result.verification?.verified,true);
 }
});

// Invalid commands must be rejected without loading an updater, credential or API.
test('local unknown and invalid operations stop before any trusted provider initialization',async()=>{
 let updates=0,credentials=0,requests=0;
 const client=new LifeOSApiClient({origin,beforeUse:async()=>{updates++;},credentialProvider:async()=>{credentials++;return 'synthetic-provider';}},async()=>{requests++;return Response.json({apiVersion:'2',operations:agentOperations});});
 for(const [operationId,args] of [['unknownOperation',{}],['createTodo',{fields:{title:'Invalid',personal:null},idempotencyKey:'synthetic-invalid-01'}],['getTodo',{id:'../../invalid'}]] as const){
  assert.equal((await client.execute(operationId,args)).ok,false);
 }
 assert.deepEqual({updates,credentials,requests},{updates:0,credentials:0,requests:0});
});

for(const state of ['receipt-confirmed','complete'])test('durable '+state+' restart recovery only reads and separates a later current revision',async()=>{
 const {DurableStore}=await import('../src/mcp-candidate/native-store.mjs');
 const directory=mkdtempSync(join(tmpdir(),'lifeos-mcp-settled-'));
 try{
  const store=new DurableStore(directory,fingerprint);
  const request={requestId:id,operationId:'createJournal',path:'/v1/records/journal',encoded:JSON.stringify({fields}),argsJSON:JSON.stringify(command),key:command.idempotencyKey};
  const receipt={status:201,data:{entry}};
  await store.exclusive(async()=>{store.prepare(request);store.receipt(id,receipt);if(state==='complete')store.finish(id,{...receipt,verification:{verified:true,state:'VERIFIED'}});});
  let writes=0,reads=0;
  const client=new LifeOSApiClient({origin,durable:new DurableStore(directory,fingerprint),beforeUse:async()=>{},nativeRequest:async(path,method)=>{
   if(method!=='GET')writes++;else reads++;
   return{status:200,credentialFingerprint:fingerprint,data:path==='/v2/capabilities'?{apiVersion:'2',operations:agentOperations}:{entry:{...entry,revision:2,fields:{...fields,text:'A later legitimate edit'}}}};
  }});
  for(let attempt=0;attempt<2;attempt++){
   const result=await client.retry(id);
   assert.equal(result.ok,true);
   assert.equal((result.data?.entry as typeof entry).revision,1);
   assert.deepEqual(result.verification,{verified:false,state:'LATER_REVISION',receiptRevision:1,currentRevision:2});
  }
  const duplicate=await client.execute('createJournal',command);
  assert.equal(duplicate.error,'RECOVERY_REQUIRED');assert.equal(duplicate.recovery?.requestId,id);
  assert.equal(duplicate.outcome,undefined);assert.equal(writes,0);assert.ok(reads>0);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('durable unconfirmed restart retries only the original body and key',async()=>{
 const {DurableStore}=await import('../src/mcp-candidate/native-store.mjs');
 const directory=mkdtempSync(join(tmpdir(),'lifeos-mcp-unknown-'));
 try{
  let lose=true;const writes:{encoded:string|undefined;key:string|undefined}[]=[];
  const options={origin,beforeUse:async()=>{},nativeRequest:async(path:string,method:string,encoded?:string,key?:string)=>{
   if(method!=='GET'){writes.push({encoded,key});if(lose){lose=false;throw Error('synthetic connection loss');}}
   return{status:200,credentialFingerprint:fingerprint,data:path==='/v2/capabilities'?{apiVersion:'2',operations:agentOperations}:{entry}};
  }};
  const first=new LifeOSApiClient({...options,durable:new DurableStore(directory,fingerprint)});
  const result=await first.execute('createJournal',command);assert.equal(result.outcome,'unknown');
  const second=new LifeOSApiClient({...options,durable:new DurableStore(directory,fingerprint)});
  const retry=await second.retry(result.recovery!.requestId);assert.equal(retry.verification?.verified,true);
  assert.equal(writes.length,2);assert.deepEqual(writes[0],{encoded:JSON.stringify({fields}),key:command.idempotencyKey});assert.deepEqual(writes[1],writes[0]);
  await second.retry(result.recovery!.requestId);assert.equal(writes.length,2);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('explicit dead-writer recovery requires inspection, preserves quarantine and never steals a live lock',async()=>{
 const {DurableStore,inspectWriterLock,recoverWriterLock}=await import('../src/mcp-candidate/native-store.mjs');
 const directory=mkdtempSync(join(tmpdir(),'lifeos-mcp-lock-'));
 try{
  const moduleURL=new URL('../src/mcp-candidate/native-store.mjs',import.meta.url).href;
  const child=spawnSync(process.execPath,['--input-type=module','-e',`import {DurableStore} from ${JSON.stringify(moduleURL)};await new DurableStore(${JSON.stringify(directory)},${JSON.stringify(fingerprint)}).exclusive(async()=>process.exit(90));`],{encoding:'utf8'});
  assert.equal(child.status,90);
  const inspected=inspectWriterLock(directory);assert.equal(inspected.ownerAlive,false);
  assert.throws(()=>recoverWriterLock(directory,'0'.repeat(64)),/LOCK_INSPECTION_CHANGED/);
  const recovered=recoverWriterLock(directory,inspected.digest);assert.equal(existsSync(recovered.quarantine),true);assert.equal(existsSync(join(directory,'.writer-lock')),false);
  assert.equal(readdirSync(directory).filter(n=>n.startsWith('.abandoned-lock-')).length,1);
  const store=new DurableStore(directory,fingerprint);
  await store.exclusive(async()=>{const live=inspectWriterLock(directory);assert.equal(live.ownerAlive,true);assert.throws(()=>recoverWriterLock(directory,live.digest),/LIVE_WRITER_LOCK/);});
  mkdirSync(join(directory,'.lock-recovery'),{mode:0o700});
  await assert.rejects(store.exclusive(async()=>assert.fail('recovery guard must block writer')),/LOCK_RECOVERY_IN_PROGRESS/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
