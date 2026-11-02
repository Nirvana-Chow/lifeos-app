import test from 'node:test';
import assert from 'node:assert/strict';
import {previewImport} from '../src/import-preview/preview.ts';
import {DraftService} from '../src/platform/service.ts';
import {MemoryPort} from './helpers/platform.ts';

const envelope=(entries:unknown[])=>({format:'lifeos.review.export.v2',scope:'isolated-synthetic',entries,history:[]});
async function fixture(){const repo=new MemoryPort(),service=new DraftService(repo);const {entry}=await service.mutate('owner-a','todo',null,{title:'synthetic title',notes:'synthetic body',dueOn:null,status:'open'},'preview-fixture-1');return{repo,service,entry};}
test('preview classifies valid new entries and exact duplicates without writing',async()=>{
 const {entry,repo}=await fixture(),before=structuredClone([...repo.rows]);
 const fresh=previewImport(envelope([entry]),[]);assert.deepEqual(fresh.counts,{candidate:1,duplicate:0,conflict:0,invalid:0});
 assert.equal(fresh.importAvailable,false);assert.equal(fresh.writesPerformed,0);
 const existing=previewImport(envelope([entry]),[entry]);assert.equal(existing.items[0].status,'duplicate');assert.deepEqual([...repo.rows],before);
});
test('same source or ID with changed contents is a conflict, including both batch rows',async()=>{
 const {entry}=await fixture(),changed=structuredClone(entry);changed.draft={title:'changed',notes:'',dueOn:null,status:'open'};
 assert.equal(previewImport(envelope([changed]),[entry]).items[0].status,'conflict');
 const batch=previewImport(envelope([entry,changed]),[]);assert.deepEqual(batch.items.map(x=>x.status),['conflict','conflict']);
 const remapped={...entry,id:'11111111-1111-4111-8111-111111111111'};assert.equal(previewImport(envelope([remapped]),[entry]).items[0].status,'conflict');
});
test('duplicate classification preserves raw exported fields before draft normalization',async()=>{
 const {entry}=await fixture(),changed=structuredClone(entry);
 if(!('title'in changed.draft))throw Error('Expected synthetic title');
 changed.draft.title=' '+changed.draft.title+' ';
 assert.equal(previewImport(envelope([changed]),[entry]).items[0].status,'conflict');
 assert.deepEqual(previewImport(envelope([entry,changed]),[]).items.map(row=>row.status),['conflict','conflict']);
 assert.deepEqual(previewImport(envelope([changed,structuredClone(changed)]),[]).items.map(row=>row.status),['candidate','duplicate']);
 assert.equal(changed.draft.title,' synthetic title ');
});
test('invalid records, absent fields and secret/owner metadata are rejected without echoing contents',async()=>{
 const {entry}=await fixture();
 const bad=previewImport(envelope([{...entry,draft:{title:'missing fields'}},{...entry,ownerId:'owner-b'},{...entry,source:{...entry.source,original:{apiKey:'synthetic-secret'}}}]),[]);
 assert.equal(bad.counts.invalid,3);assert.equal(JSON.stringify(bad).includes('synthetic-secret'),false);assert.equal(JSON.stringify(bad).includes('owner-b'),false);
 const missing=structuredClone(entry) as Record<string,unknown>;delete missing.source;
 assert.equal(previewImport(envelope([missing]),[]).items[0].status,'invalid');
});
for(const key of ['access_token','refresh_token','private_key','privateKey','client_secret','clientSecret','secret_key','session_token','id_token','authorization','cookie','credentials','owner-id','PASSWORD_HASH'])test(`protected ${key} metadata is rejected at every export boundary`,async()=>{
 const {entry}=await fixture(),protectedMetadata={nested:[{[key]:'synthetic-protected-value'}]},changed={...entry,source:{...entry.source,original:protectedMetadata}};
 const result=previewImport(envelope([changed]),[]);
 assert.equal(result.items[0].status,'invalid');
 assert.equal(JSON.stringify(result).includes('synthetic-protected-value'),false);
 assert.throws(()=>previewImport({...envelope([]),history:[protectedMetadata]},[]));
 assert.throws(()=>previewImport({...envelope([]),extensions:protectedMetadata},[]));
});
test('foreign/unsupported export scopes and large/deep input fail closed',()=>{
 assert.throws(()=>previewImport({...envelope([]),scope:'personal'},[]));
 assert.throws(()=>previewImport({...envelope([]),format:'csv'},[]));
 assert.throws(()=>previewImport(envelope(Array(101).fill({})),[]));
 let deep:unknown={};for(let i=0;i<20;i++)deep={value:deep};
 assert.throws(()=>previewImport({...envelope([]),history:[deep]},[]));
});
test('refund and derived-task references must resolve to compatible entries',async()=>{
 const {entry}=await fixture();const refund={...entry,kind:'finance',draft:{kind:'refund',amountMinor:100,currency:'CNY',occurredOn:'2026-10-23',category:null,fromAccountRef:null,toAccountRef:null,originalEntryId:entry.id,notes:''}};
 assert.equal(previewImport(envelope([refund]),[]).items[0].status,'invalid');
 assert.equal(previewImport(envelope([{...entry,inboxId:'11111111-1111-4111-8111-111111111111'}]),[]).items[0].status,'invalid');
});
test('history and extension export are inspected but never presented as restored',async()=>{
 const {entry}=await fixture();const result=previewImport({...envelope([entry]),history:[entry],extensions:{calendar:{status:'not-configured'}},aiSecretsIncluded:false,backupOrRestoreVerified:false},[]);
 assert.equal(result.historyCount,1);assert.equal(result.extensionsIncluded,false);assert.equal(result.restorationVerified,false);
 assert.throws(()=>previewImport({...envelope([]),history:[{password:'synthetic-secret'}]},[]));
});
