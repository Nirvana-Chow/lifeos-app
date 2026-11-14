import test from 'node:test';import assert from 'node:assert/strict';import {sha256,type FileEntry} from '../src/file-handoff/contracts.ts';
import type {FileSession} from '../src/file-handoff/runtime.ts';
const id='00000000-0000-4000-8000-000000000001',bytes=Buffer.from('HTTP actual synthetic bytes\n');
const entry={id,revision:2,state:'ready',name:'合成文件.txt',mimeType:'text/plain',sha256:sha256(bytes),bytes:bytes.length} as FileEntry;
test('file HTTP content is actual binary with bounded metadata headers and no JSON/base64/redirect',async()=>{
 const module=await import('../src/file-handoff/http.ts').catch(()=>null);assert.ok(module,'actual file HTTP adapter must exist');
 let checked=0;const session={actor:{ownerId:'synthetic-owner',spaceId:'synthetic-space',authorityRef:'synthetic',consumer:'website'},service:{download:async()=>({entry,bytes})}} as unknown as FileSession;
 const response=await module.handleFileHandoffRequest(new Request('https://synthetic.example.test/api/platform/agent/v1/file-handoffs/'+id+'/content'),{session,mount:'/api/platform/agent/v1/file-handoffs',current:async()=>{checked++;}});
 assert.equal(response!.status,200);assert.deepEqual(Buffer.from(await response!.arrayBuffer()),bytes);assert.equal(response!.headers.get('X-LifeOS-File-SHA256'),entry.sha256);assert.equal(response!.headers.get('Content-Length'),String(bytes.length));assert.match(response!.headers.get('Content-Disposition')!,/^attachment;/);assert.equal(response!.headers.get('Location'),null);assert.equal(checked,2);
});
test('an acknowledgment cannot spoof its consumer or owner through JSON',async()=>{
 const module=await import('../src/file-handoff/http.ts').catch(()=>null);assert.ok(module);let writes=0;
 const session={actor:{consumer:'website'},service:{acknowledge:async()=>{writes++;throw Error();}}} as unknown as FileSession;
 const response=await module.handleFileHandoffRequest(new Request('https://synthetic.example.test/api/platform/personal/file-handoffs/'+id+'/acknowledgments',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:2,sha256:entry.sha256,bytes:bytes.length,consumer:'codex'})}),{session,mount:'/api/platform/personal/file-handoffs',current:async()=>{}});
 assert.equal(response!.status,400);assert.equal(writes,0);
});
