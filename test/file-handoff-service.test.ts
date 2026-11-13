import assert from 'node:assert/strict';
import test,{type TestContext} from 'node:test';
import {mkdtemp,realpath,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {PrivateFileBlobs} from '../src/file-handoff/blob-store.ts';
import {PinnedFileSource} from '../src/file-handoff/source.ts';
import {FileHandoffError,stageDigest,publicFile,cleanupEligible,type FileHandoffRepository,type FileHandoffActor,type StoredFile,type StageFileInput} from '../src/file-handoff/contracts.ts';

async function implementation(){const module=await import('../src/file-handoff/service.ts').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return null;throw error;});assert.ok(module,'the durable handoff service must exist');return module;}
const actor:FileHandoffActor={ownerId:'synthetic-owner',spaceId:'synthetic-space',authorityRef:'synthetic-grant'};
const input:StageFileInput={file:{download_url:'https://synthetic-files.example.invalid/new?signature=synthetic',file_id:'file_synthetic_new',file_name:'new.txt',mime_type:'text/plain'},requirementId:'LO-FILES-001',retention:{kind:'temporary',retainUntil:new Date(Date.now()+86400000).toISOString()}};
async function fixture(t:TestContext){
 const {FileHandoffService}=await implementation(),directory=await realpath(await mkdtemp(join(tmpdir(),'lifeos-synthetic-handoff-')));t.after(()=>rm(directory,{recursive:true,force:true}));
 let row:StoredFile|undefined,digest='',token='',downloads=0,publishes=0,reservations=0,loseReceipt=false,revoked=false,revokeOnOpen=false;
 const repository:FileHandoffRepository={
  reserve:async(a,value)=>{reservations++;if(revoked||a.ownerId!==actor.ownerId)throw new FileHandoffError(403,'FILE_ACCESS_DENIED');if(row){if(digest!==stageDigest(value))throw new FileHandoffError(409,'FILE_COMMAND_CONFLICT');return{entry:structuredClone(row),token:row.state==='ready'?null:token,duplicate:row.state==='ready'};}digest=stageDigest(value);token=randomUUID();row={id:randomUUID(),revision:1,state:'pending',sourceFileId:value.file.file_id,name:value.file.file_name??'ChatGPT-file.bin',mimeType:value.file.mime_type??'application/octet-stream',target:{id:value.requirementId,sourceId:randomUUID(),revision:1},retention:value.retention,sha256:null,bytes:null,createdAt:new Date().toISOString(),receivedAt:null,acknowledgments:{},blob:null};return{entry:structuredClone(row),token,duplicate:false};},
  publish:async(_a,id,claim,blob)=>{if(revoked)throw new FileHandoffError(403,'FILE_ACCESS_DENIED');assert.equal(id,row?.id);assert.equal(claim,token);publishes++;row={...row!,revision:2,state:'ready',sha256:blob.sha256,bytes:blob.bytes,blob,receivedAt:new Date().toISOString()};if(loseReceipt){loseReceipt=false;throw new FileHandoffError(503,'FILE_HANDOFF_OUTCOME_UNKNOWN');}return{entry:publicFile(row),duplicate:false};},
  release:async()=>{},get:async(a,id)=>{if(revoked||a.ownerId!==actor.ownerId)throw new FileHandoffError(403,'FILE_ACCESS_DENIED');assert.equal(id,row?.id);return structuredClone(row!);},
  acknowledge:async()=>{throw Error('covered by PostgreSQL fixture');},
 };
 const source=new PinnedFileSource({allowedOrigins:['https://synthetic-files.example.invalid'],maxBytes:128,timeoutMs:1000},{lookup:async()=>[{address:'8.8.8.8',family:4}],open:async()=>{downloads++;if(revokeOnOpen)revoked=true;return{status:200,length:null,mimeType:'text/plain',encoding:null,body:(async function*(){yield Buffer.from('real synthetic file bytes\n');})(),close:()=>{}};}});
 const blobs=new PrivateFileBlobs({directory,maxBytes:128}),service=new FileHandoffService({enabled:true,repository,source,blobs});
 return{service,repository,source,blobs,directory,current:()=>row,reservations:()=>reservations,downloads:()=>downloads,publishes:()=>publishes,set:(value:{loseReceipt?:boolean;revoked?:boolean;revokeOnOpen?:boolean})=>{loseReceipt=value.loseReceipt??loseReceipt;revoked=value.revoked??revoked;revokeOnOpen=value.revokeOnOpen??revokeOnOpen;}};
}
test('service persists real bytes, returns metadata and independently downloads and verifies the same original',async t=>{
 const f=await fixture(t),saved=await f.service.stage(actor,input,'synthetic-stage-001');
 assert.equal(saved.entry.state,'ready');assert.equal(saved.entry.bytes,26);assert.equal(JSON.stringify(saved).includes('signature='),false);assert.equal(JSON.stringify(saved).includes(f.directory),false);
 const read=await f.service.get(actor,saved.entry.id),download=await f.service.download(actor,saved.entry.id);
 assert.deepEqual(read.entry,saved.entry);assert.equal(download.bytes.toString(),'real synthetic file bytes\n');assert.equal(download.entry.sha256,saved.entry.sha256);assert.equal(read.cleanupEligible,false);
});
test('lost committed receipt recovers by original command without refetching even when the source URL changes',async t=>{
 const f=await fixture(t);f.set({loseReceipt:true});await assert.rejects(f.service.stage(actor,input,'synthetic-stage-unknown'),{code:'FILE_HANDOFF_OUTCOME_UNKNOWN'});
 const recovered=await f.service.stage(actor,{...input,file:{...input.file,download_url:'https://synthetic-files.example.invalid/new?signature=refreshed'}},'synthetic-stage-unknown');
 assert.equal(recovered.duplicate,true);assert.equal(f.downloads(),1);assert.equal(f.publishes(),1);assert.equal((await readdir(f.directory)).length,1);
 await assert.rejects(f.service.stage(actor,{...input,file:{...input.file,file_name:'different.txt'}},'synthetic-stage-unknown'),{code:'FILE_COMMAND_CONFLICT'});
});
test('closed service, revoked authority and path/message file impostors cannot produce a saved receipt',async t=>{
 const f=await fixture(t),{FileHandoffService}=await implementation();
 await assert.rejects(new FileHandoffService({repository:f.repository,source:f.source,blobs:new PrivateFileBlobs({directory:f.directory,maxBytes:128})}).stage(actor,input,'synthetic-closed'),{code:'FILE_HANDOFF_DISABLED'});
 for(const file of [{...input.file,file_name:'../outside.txt'},{...input.file,download_url:'sandbox:/mnt/data/file'},{...input.file,contents:'model text is not a file'}])await assert.rejects(f.service.stage(actor,{...input,file},'synthetic-bad-file'));
 f.set({revoked:true});await assert.rejects(f.service.stage(actor,input,'synthetic-revoked'),{code:'FILE_ACCESS_DENIED'});assert.equal(f.downloads(),0);assert.deepEqual(await readdir(f.directory),[]);
});
test('retention is only cleanup eligibility after both independently matching consumer acknowledgments',()=>{
 const entry={state:'ready',retention:{kind:'temporary',retainUntil:'2026-01-01T00:00:00Z'},sha256:'a'.repeat(64),bytes:26,acknowledgments:{website:{sha256:'a'.repeat(64),bytes:26,receivedAt:'2026-01-01T00:00:00Z'}}} as StoredFile;
 assert.equal(cleanupEligible(entry),false);assert.equal(cleanupEligible({...entry,acknowledgments:{...entry.acknowledgments,codex:{sha256:'b'.repeat(64),bytes:26,receivedAt:'2026-01-01T00:00:00Z'}}}),false);
 assert.equal(cleanupEligible({...entry,acknowledgments:{...entry.acknowledgments,codex:entry.acknowledgments.website}}),true);assert.equal(cleanupEligible({...entry,retention:{kind:'retained'}}),false);
});
test('authority loss during transfer preserves the unconfirmed original without publishing a successful receipt',async t=>{
 const f=await fixture(t);f.set({revokeOnOpen:true});
 await assert.rejects(f.service.stage(actor,input,'synthetic-mid-transfer'),{code:'FILE_ACCESS_DENIED'});assert.equal(f.publishes(),0);assert.equal((await readdir(f.directory)).length,1);
 f.set({revoked:false,revokeOnOpen:false});const pending=await f.service.get(actor,f.current()!.id);assert.equal(pending.entry.state,'pending');assert.equal(pending.entry.sha256,null);assert.equal(pending.entry.bytes,null);assert.equal(pending.cleanupEligible,false);
});
test('a download rechecks current authority after actual private bytes are read and returns no bytes after revocation',async t=>{
 const f=await fixture(t),saved=await f.service.stage(actor,input,'synthetic-read-revoked'),originalRead=f.blobs.read.bind(f.blobs);
 f.blobs.read=async blob=>{const bytes=await originalRead(blob);f.set({revoked:true});return bytes;};
 await assert.rejects(f.service.download(actor,saved.entry.id),{code:'FILE_ACCESS_DENIED'});assert.equal((await readdir(f.directory)).length,1);
});
test('an unqualified empty source allowlist is closed before any metadata reservation',async t=>{
 const f=await fixture(t),{FileHandoffService}=await implementation();
 const service=new FileHandoffService({enabled:true,repository:f.repository,blobs:f.blobs,source:new PinnedFileSource({allowedOrigins:[],maxBytes:128,timeoutMs:1000})});
 await assert.rejects(service.stage(actor,input,'synthetic-closed-source'),{code:'FILE_SOURCE_DENIED'});assert.equal(f.reservations(),0);assert.deepEqual(await readdir(f.directory),[]);
});
test('uncertain filesystem publication never releases a claim as a safely retryable transfer',async t=>{
 const f=await fixture(t);let released=0;f.repository.release=async()=>{released++;};
 (f.blobs as unknown as {syncDirectory:()=>Promise<void>}).syncDirectory=async()=>{throw Error('synthetic fsync failure');};
 await assert.rejects(f.service.stage(actor,input,'synthetic-storage-unknown'));
 assert.equal(released,0);assert.equal(f.publishes(),0);assert.equal((await readdir(f.directory)).length,1);assert.equal(f.current()!.state,'pending');
});
