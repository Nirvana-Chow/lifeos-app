import assert from 'node:assert/strict';
import test,{type TestContext} from 'node:test';
import {mkdtemp,realpath,readFile,readdir,symlink,link,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

async function implementation(){
 const module=await import('../src/file-handoff/blob-store.ts').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return null;throw error;});
 assert.ok(module,'the actual bounded private file store must exist');return module;
}
const id='00000000-0000-4000-8000-000000000001',attempt='00000000-0000-4000-8000-000000000002';
const chunks=async function*(value:Uint8Array){yield value.subarray(0,3);yield value.subarray(3);};
async function directory(t:TestContext){const root=await realpath(await mkdtemp(join(tmpdir(),'lifeos-synthetic-file-')));t.after(()=>rm(root,{recursive:true,force:true}));return root;}

test('actual synthetic bytes are atomically persisted and independently rehashed without a path in the receipt',async t=>{
 const {PrivateFileBlobs}=await implementation(),root=await directory(t),store=new PrivateFileBlobs({directory:root,maxBytes:64});
 const original=Buffer.from('Synthetic generated file\n中文\n'),blob=await store.put(id,attempt,chunks(original));
 assert.equal(blob.bytes,original.length);assert.equal(blob.sha256,createHash('sha256').update(original).digest('hex'));
 assert.equal(JSON.stringify(blob).includes(root),false);assert.deepEqual(await store.read(blob),original);
 assert.deepEqual((await readdir(root)).filter(name=>name.startsWith('.tmp-')),[]);
 await assert.rejects(store.put(id,attempt,chunks(Buffer.from('replacement'))));
 assert.deepEqual(await store.read(blob),original);
});
test('oversized, interrupted and aborted transfers never publish a partial original',async t=>{
 const {PrivateFileBlobs}=await implementation(),root=await directory(t),store=new PrivateFileBlobs({directory:root,maxBytes:8});
 await assert.rejects(store.put(id,attempt,chunks(Buffer.alloc(9))),{code:'FILE_TOO_LARGE'});
 await assert.rejects(store.put(id,attempt,(async function*(){yield Buffer.from('part');throw Error('synthetic interrupted');})()));
 await assert.rejects(store.put(id,attempt,chunks(Buffer.from('x')),AbortSignal.abort()),{code:'FILE_CANCELLED'});
 assert.deepEqual(await readdir(root),[]);
});
test('private file storage rejects traversal, symlink roots and substituted hardlinked originals',async t=>{
 const {PrivateFileBlobs}=await implementation(),root=await directory(t),store=new PrivateFileBlobs({directory:root,maxBytes:64});
 await assert.rejects(store.put('../outside',attempt,chunks(Buffer.from('x'))));
 await assert.rejects(store.read({key:'../outside',sha256:'a'.repeat(64),bytes:1}));
 const alias=join(root,'alias');await symlink(root,alias);await assert.rejects(new PrivateFileBlobs({directory:alias,maxBytes:64}).put(id,attempt,chunks(Buffer.from('x'))));
 const blob=await store.put(id,attempt,chunks(Buffer.from('original')));await link(join(root,blob.key),join(root,'extra-link'));
 await assert.rejects(store.read(blob),{code:'FILE_BLOB_UNAVAILABLE'});
 assert.equal((await readFile(join(root,blob.key))).toString(),'original');
});
test('a missing private directory reports a bounded code without exposing an absolute filesystem path',async t=>{
 const {PrivateFileBlobs}=await implementation(),root=await directory(t),missing=join(root,'not-created');
 await assert.rejects(new PrivateFileBlobs({directory:missing,maxBytes:64}).put(id,attempt,chunks(Buffer.from('x'))),(error:any)=>{assert.equal(error.code,'FILE_STORAGE_UNAVAILABLE');assert.equal(error.message.includes(root),false);return true;});
});
test('concurrent publication has one winner and never replaces its verified original',async t=>{
 const {PrivateFileBlobs}=await implementation(),root=await directory(t),store=new PrivateFileBlobs({directory:root,maxBytes:64});
 const results=await Promise.allSettled([store.put(id,attempt,chunks(Buffer.from('first original'))),store.put(id,attempt,chunks(Buffer.from('second original')))]);
 const saved=results.filter((result):result is PromiseFulfilledResult<Awaited<ReturnType<typeof store.put>>>=>result.status==='fulfilled');
 assert.equal(saved.length,1);assert.equal(results.filter(result=>result.status==='rejected').length,1);
 assert.ok(['first original','second original'].includes((await store.read(saved[0].value)).toString()));assert.equal((await readdir(root)).length,1);
});
test('failure after atomic publication preserves the original and reports an unknown outcome',async t=>{
 const {PrivateFileBlobs}=await implementation(),root=await directory(t),store=new PrivateFileBlobs({directory:root,maxBytes:64});
 (store as unknown as {syncDirectory:()=>Promise<void>}).syncDirectory=async()=>{throw Error('synthetic fsync failure');};
 await assert.rejects(store.put(id,attempt,chunks(Buffer.from('unique original'))),{code:'FILE_STORAGE_OUTCOME_UNKNOWN'});
 assert.deepEqual(await readdir(root),[id+'.'+attempt+'.blob']);assert.equal((await readFile(join(root,id+'.'+attempt+'.blob'))).toString(),'unique original');
});
