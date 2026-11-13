import test from 'node:test';import assert from 'node:assert/strict';import {sha256,type FileEntry} from '../src/file-handoff/contracts.ts';
test('website and native consumers independently hash bounded binary rather than trust response metadata',async()=>{
 const api=await import('../src/file-handoff/web-client.ts').catch(()=>null);assert.ok(api);
 const bytes=Buffer.from('independent download bytes'),entry={id:'00000000-0000-4000-8000-000000000001',revision:2,state:'ready',sha256:sha256(bytes),bytes:bytes.length} as FileEntry;
 const response=(data:Uint8Array)=>new Response(data as any,{headers:{'content-length':String(bytes.length),'X-LifeOS-File-SHA256':entry.sha256!,'X-LifeOS-File-Revision':'2'}});
 assert.deepEqual(Buffer.from(await api.verifiedFileBytes(response(bytes),entry)),bytes);
 await assert.rejects(api.verifiedFileBytes(response(Buffer.from('tampered download bytes')),entry));
 await assert.rejects(api.verifiedFileBytes(new Response(bytes),entry));
 await assert.rejects(api.verifiedFileBytes(response(Buffer.concat([bytes,bytes])),entry));
});
