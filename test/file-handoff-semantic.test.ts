import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyFileReceipt,verifyFileCurrent} from '../src/file-handoff/semantic.ts';
const entry={id:'10000000-0000-4000-8000-000000000001',revision:2,state:'ready',sourceFileId:'file_synthetic',name:'synthetic.txt',mimeType:'text/plain',target:{id:'LO-FILES-001',sourceId:'20000000-0000-4000-8000-000000000001',revision:1},retention:{kind:'temporary',retainUntil:'2026-11-15T00:00:00Z'},sha256:'a'.repeat(64),bytes:4,createdAt:'2026-11-14T00:00:00Z',receivedAt:'2026-11-14T00:00:01Z',acknowledgments:{}};
test('file receipt semantics preserve native schemas despite input property order and later acknowledgments',()=>{
 const args={file:{file_id:entry.sourceFileId,file_name:entry.name,mime_type:entry.mimeType},requirementId:entry.target.id,retention:{retainUntil:entry.retention.retainUntil,kind:'temporary'}};
 assert.equal(verifyFileReceipt({id:'stageFileHandoff'},args,{entry,duplicate:false}).id,entry.id);
 assert.equal(verifyFileCurrent({entry},{ok:true,data:{entry}}).verified,true);
 const later={...entry,revision:3,acknowledgments:{website:{sha256:entry.sha256,bytes:entry.bytes,receivedAt:'2026-11-14T00:00:02Z'}}};
 assert.equal(verifyFileCurrent({entry},{ok:true,data:{entry:later}}).state,'LATER_REVISION');
 for(const changed of [{...later,name:'changed.txt'},{...later,retention:{kind:'retained'}},{...later,target:{...entry.target,revision:2}}])assert.equal(verifyFileCurrent({entry},{ok:true,data:{entry:changed}}).state,'READBACK_IDENTITY_MISMATCH');
});
