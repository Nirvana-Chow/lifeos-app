import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,realpath,rm,readFile,writeFile,readdir,open} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {fileHandoffOperations} from '../src/file-handoff/operations.ts';import {sha256} from '../src/file-handoff/contracts.ts';
const id='00000000-0000-4000-8000-000000000001',sourceId='00000000-0000-4000-8000-000000000002',fingerprint='a'.repeat(64),bytes=Buffer.from('native independently received original\n');
test('an adopted native closure saves real bytes and recovers lost acknowledgment without redownload or overwrite',async t=>{
 const module=await import('../src/file-handoff/receiver.ts').catch(()=>null);assert.ok(module,'actual adopted binary receiver must exist');
 const directory=await realpath(await mkdtemp(join(tmpdir(),'lifeos-synthetic-receiver-')));t.after(()=>rm(directory,{recursive:true,force:true}));let downloads=0,acks=0,lost=true;
 let entry={id,revision:2,state:'ready',sourceFileId:'file_synthetic',name:'synthetic.txt',mimeType:'text/plain',target:{id:sourceId,sourceId,revision:1},retention:{kind:'retained'},sha256:sha256(bytes),bytes:bytes.length,createdAt:new Date().toISOString(),receivedAt:new Date().toISOString(),acknowledgments:{}};
 const receipts=new Map<string,unknown>();
 const options={directory,adoption:{version:'file-handoff-v1',credentialFingerprint:fingerprint},beforeUse:async()=>{},nativeRequest:async(path:string,method:string,encoded?:string,key?:string)=>{
  if(path==='/v2/capabilities')return{status:200,data:{apiVersion:'2',operations:fileHandoffOperations},credentialFingerprint:fingerprint};
  if(method==='POST'){acks++;const input=JSON.parse(encoded!);if(!receipts.has(key!)){entry={...entry,revision:entry.revision+1,acknowledgments:{codex:{sha256:input.sha256,bytes:input.bytes,receivedAt:new Date().toISOString()}}};receipts.set(key!,structuredClone(entry));}
   if(lost){lost=false;throw Error('synthetic lost committed ack');}return{status:200,data:{entry:receipts.get(key!),duplicate:acks>1},credentialFingerprint:fingerprint};}
  return{status:200,data:{entry},credentialFingerprint:fingerprint};
 },nativeBinaryRequest:async(path:string)=>{assert.equal(path,'/v1/file-handoffs/'+id+'/content');downloads++;return{response:new Response(bytes,{headers:{'content-length':String(bytes.length),'X-LifeOS-File-SHA256':entry.sha256,'X-LifeOS-File-Revision':String(entry.revision)}}),credentialFingerprint:fingerprint};}};
 const receiver=new module.FileReceiver(options as any),first=await receiver.receive({id,filename:'received.txt',idempotencyKey:'synthetic-native-file-command'});
 assert.equal(first.acknowledgment.outcome,'unknown');assert.deepEqual(await readFile(join(directory,'received.txt')),bytes);
 const replay=await new module.FileReceiver(options as any).receive({id,filename:'received.txt',idempotencyKey:'synthetic-native-file-command'});
 assert.equal(replay.acknowledgment.ok,true);assert.equal(downloads,1);assert.equal(JSON.stringify(replay).includes(directory),false);assert.equal(replay.file.sha256,sha256(bytes));assert.equal(replay.file.bytes,bytes.length);
 await writeFile(join(directory,'user-existing.txt'),'preserve existing user bytes',{mode:0o600});
 await assert.rejects(receiver.receive({id,filename:'user-existing.txt',idempotencyKey:'synthetic-different-command'}));assert.equal((await readFile(join(directory,'user-existing.txt'))).toString(),'preserve existing user bytes');
 assert.equal((await readdir(directory)).some(name=>name.startsWith('.tmp-')),false);
});
test('unadopted receiver or unsafe destination never reaches native credentials or binary transport',async()=>{
 const module=await import('../src/file-handoff/receiver.ts').catch(()=>null);assert.ok(module);let calls=0;
 assert.throws(()=>new module.FileReceiver({directory:'/not-used',nativeRequest:async()=>{calls++;},nativeBinaryRequest:async()=>{calls++;}} as any));assert.equal(calls,0);
});
test('only a definite CAS conflict permits an explicit new acknowledgment key, which remains recoverable by the original receive',async t=>{
 const {FileReceiver}=await import('../src/file-handoff/receiver.ts'),directory=await realpath(await mkdtemp(join(tmpdir(),'lifeos-synthetic-file-conflict-')));t.after(()=>rm(directory,{recursive:true,force:true}));let downloads=0,conflict=true;
 let entry={id,revision:2,state:'ready',sourceFileId:'file_synthetic',name:'synthetic.txt',mimeType:'text/plain',target:{id:sourceId,sourceId,revision:1},retention:{kind:'retained'},sha256:sha256(bytes),bytes:bytes.length,createdAt:new Date().toISOString(),receivedAt:new Date().toISOString(),acknowledgments:{}};
 const options={directory,adoption:{version:'file-handoff-v1',credentialFingerprint:fingerprint},beforeUse:async()=>{},nativeRequest:async(path:string,method:string,encoded?:string)=>{
  if(path==='/v2/capabilities')return{status:200,data:{apiVersion:'2',operations:fileHandoffOperations},credentialFingerprint:fingerprint};
  if(method==='POST'){const args=JSON.parse(encoded!);if(conflict){conflict=false;entry={...entry,revision:3};}if(args.expectedRevision!==entry.revision)return{status:409,data:{error:'FILE_REVISION_CONFLICT'},credentialFingerprint:fingerprint};entry={...entry,revision:entry.revision+1,acknowledgments:{codex:{sha256:args.sha256,bytes:args.bytes,receivedAt:new Date().toISOString()}}};return{status:200,data:{entry,duplicate:false},credentialFingerprint:fingerprint};}
  return{status:200,data:{entry},credentialFingerprint:fingerprint};
 },nativeBinaryRequest:async()=>{downloads++;return{response:new Response(bytes,{headers:{'content-length':String(bytes.length),'X-LifeOS-File-SHA256':entry.sha256,'X-LifeOS-File-Revision':String(entry.revision)}}),credentialFingerprint:fingerprint};}};
 const receiver=new FileReceiver(options as any),input={id,filename:'conflict.txt',idempotencyKey:'synthetic-original-receive'};
 assert.equal((await receiver.receive(input)).acknowledgment.status,409);
 assert.equal((await receiver.receive({...input,acknowledgmentKey:'synthetic-new-confirmation'})).acknowledgment.ok,true);
 assert.equal((await receiver.receive(input)).acknowledgment.ok,true);assert.equal(downloads,1);
});

test('an existing native destination remains unknown without ACK until its directory durability succeeds',async t=>{
 const {FileReceiver}=await import('../src/file-handoff/receiver.ts'),directory=await realpath(await mkdtemp(join(tmpdir(),'lifeos-native-durability-'))),handle=await open(directory,'r'),prototype=Object.getPrototypeOf(handle),sync=prototype.sync;await handle.close();let blocked=true,directorySyncAttempts=0,downloads=0,acks=0;
 t.after(async()=>{prototype.sync=sync;await rm(directory,{recursive:true,force:true});});
 prototype.sync=async function(){if((await this.stat()).isDirectory()){directorySyncAttempts++;if(blocked&&directorySyncAttempts>=2)throw Error('synthetic persistent destination directory fsync failure');}return sync.call(this);};
 let entry={id,revision:2,state:'ready',sourceFileId:'file_synthetic',name:'synthetic.txt',mimeType:'text/plain',target:{id:sourceId,sourceId,revision:1},retention:{kind:'retained'},sha256:sha256(bytes),bytes:bytes.length,createdAt:new Date().toISOString(),receivedAt:new Date().toISOString(),acknowledgments:{}};
 const receiver=new FileReceiver({directory,adoption:{version:'file-handoff-v1',credentialFingerprint:fingerprint},beforeUse:async()=>{},nativeRequest:async(path,method,encoded)=>{
  if(path==='/v2/capabilities')return{status:200,data:{apiVersion:'2',operations:fileHandoffOperations},credentialFingerprint:fingerprint};
  if(method==='POST'){acks++;const input=JSON.parse(encoded!);entry={...entry,revision:3,acknowledgments:{codex:{sha256:input.sha256,bytes:input.bytes,receivedAt:new Date().toISOString()}}};return{status:200,data:{entry,duplicate:false},credentialFingerprint:fingerprint};}
  return{status:200,data:{entry},credentialFingerprint:fingerprint};
 },nativeBinaryRequest:async()=>{downloads++;return{response:new Response(bytes,{headers:{'content-length':String(bytes.length),'X-LifeOS-File-SHA256':entry.sha256,'X-LifeOS-File-Revision':String(entry.revision)}}),credentialFingerprint:fingerprint};}});
 const input={id,filename:'durable.txt',idempotencyKey:'synthetic-native-durable-original'};
 await assert.rejects(receiver.receive(input),{code:'FILE_RECEIVE_OUTCOME_UNKNOWN'});assert.equal(directorySyncAttempts,2);assert.equal(acks,0);assert.deepEqual(await readFile(join(directory,input.filename)),bytes);
 await assert.rejects(receiver.receive(input),{code:'FILE_RECEIVE_OUTCOME_UNKNOWN'});assert.equal(directorySyncAttempts,3);assert.equal(acks,0);assert.equal(downloads,1);assert.deepEqual(await readFile(join(directory,input.filename)),bytes);
 blocked=false;const recovered=await receiver.receive(input);assert.equal(recovered.acknowledgment.ok,true);assert.equal(directorySyncAttempts,4);assert.equal(acks,1);assert.equal(downloads,1);assert.deepEqual(await readFile(join(directory,input.filename)),bytes);
});
