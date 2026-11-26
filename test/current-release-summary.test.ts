import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateReleaseArtifact,releaseNotes} from '../src/release-notes-candidate/runtime.ts';
import {readReleaseNotice} from '../src/ui-review/owner-modules.ts';
import {createPersonalPlatformHandler} from '../src/personal-candidate/runtime-http.ts';
import {MemoryPort} from './helpers/platform.ts';

const finance='2d0c8df0d83a39a01984f72bcb217de4de3caf7b';
const projects='40f40919cb8ac3a38caca22e2c7c3a83dc9ec3d0';
const historical='e83e8133fe014afd36ba154927572bd51a7e2aca';
const unknown='d'.repeat(40);
const files=['Dockerfile.platform-review','next.config.ts','package-lock.json','package.json','proxy.ts'].sort((a,b)=>a.localeCompare(b,'en')).map(path=>({path,sha256:'b'.repeat(64)}));
const proof={version:1,sourceTreeDigest:createHash('sha256').update(JSON.stringify(files)).digest('hex'),files};
const artifact=(sourceSha:string)=>validateReleaseArtifact({...proof,sourceSha},'synthetic-current-build',sourceSha)!;
const selected=(sourceSha:string)=>releaseNotes(artifact(sourceSha)).records.filter(row=>row.runningExactSource);

test('each known running source selects just its own reviewed record',()=>{
 const first=selected(finance),second=selected(projects);
 assert.equal(first.length,1);assert.equal(second.length,1);
 assert.equal(first[0].sourceURL,'https://github.com/Nirvana-Chow/lifeos-app/commit/'+finance);
 assert.equal(second[0].sourceURL,'https://github.com/Nirvana-Chow/lifeos-app/commit/'+projects);
 assert.equal(first[0].title,'财务、日记复盘与时间线');
 assert.equal(second[0].title,'开发项目首屏摘要');
 assert.notDeepEqual(first[0].changes,second[0].changes);
 const old=selected(historical);
 assert.equal(old.length,1);assert.equal(old[0].id,'requirements-owner-source');
});

test('unknown running identity is retained without borrowing a historical note',()=>{
 const current=artifact(unknown),notes=releaseNotes(current);
 assert.deepEqual(notes.current,current);
 assert.deepEqual(selected(unknown),[]);
 assert.deepEqual(selected('e'.repeat(40)),[]);
 assert.ok(notes.records.some(row=>row.id==='owner-workspace-20261113'&&row.sourceSha==='c2458a8f9786f992b19a6a14209e25e47f3d0925'));
 assert.ok(notes.records.some(row=>row.sourceSha===historical));
 assert.equal(notes.ownerAccepted,false);assert.equal(notes.visualQualification,'not-attested');
});

test('missing or rejected image proof never promotes history to current',()=>{
 for(const invalid of [null,validateReleaseArtifact({...proof,sourceSha:finance,sourceTreeDigest:'0'.repeat(64)},'synthetic-current-build',finance),validateReleaseArtifact({...proof,sourceSha:finance},'bad/build',finance),validateReleaseArtifact({...proof,sourceSha:finance},'synthetic-current-build',unknown)]){
  const notes=releaseNotes(invalid);
  assert.equal(notes.current,null);assert.ok(notes.records.length>0);
  assert.equal(notes.records.some(row=>row.runningExactSource),false);
  assert.equal(readReleaseNotice({...notes,preferencesEnabled:true,readState:null}),null);
 }
});

test('owner endpoint reads old version preferences without leaking them into a new running version',async()=>{
 const repository=new MemoryPort(),native=repository.transaction.bind(repository);
 repository.transaction=(owner,key,fn)=>native(owner,key,tx=>fn({...tx,lockRecordIdentity:async()=>{}}));
 let current=artifact(historical);
 const config={ownerId:'summary-owner',ownerEmail:'fixture@example.test',spaceId:'summary-space',databaseName:'fixture',baseURL:'https://summary.example.test',approval:'personal-manual-v1',allowedTypes:['todo','journal'],requirementsEnabled:true,requirementSupportEnabled:true} as const;
 let owner=config.ownerId as string;
 const handler=createPersonalPlatformHandler({config,repository,storageVerified:true,sessions:{read:async()=>({userId:owner,email:config.ownerEmail})},assertWritable:async()=>{},releaseArtifact:()=>current});
 const endpoint=config.baseURL+'/api/platform/personal/requirement-support/releases';
 const read=()=>handler(new Request(endpoint,{headers:{host:'summary.example.test'}}));
 const first=await handler(new Request(endpoint+'/read',{method:'POST',headers:{host:'summary.example.test',origin:config.baseURL,'content-type':'application/json','idempotency-key':'synthetic-previously-read'},body:JSON.stringify({spaceId:config.spaceId,confirmed:true,sourceSha:historical})}));
 assert.equal(first.status,200);
 current=artifact(finance);
 let value=await (await read()).json();
 assert.equal(value.readState.seen,false);
 assert.equal(readReleaseNotice(value)?.records[0]?.title,'财务、日记复盘与时间线');
 current=artifact(unknown);
 value=await (await read()).json();
 assert.equal(value.readState.sourceSha,unknown);
 assert.deepEqual(readReleaseNotice(value)?.records,[]);
 current=artifact(historical);
 value=await (await read()).json();
 assert.equal(value.readState.seen,true);
 assert.equal(repository.rows.size,1);
 assert.equal(repository.receipts.size,1);
 owner='foreign-owner';
 assert.equal((await read()).status,403);
});
