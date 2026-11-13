import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateReleaseArtifact,releaseNotes} from '../src/release-notes-candidate/runtime.ts';
import {readReleaseNotice} from '../src/ui-review/owner-modules.ts';
import {createPersonalPlatformHandler} from '../src/personal-candidate/runtime-http.ts';
import {MemoryPort} from './helpers/platform.ts';

const sha='d'.repeat(40);
const files=['Dockerfile.platform-review','next.config.ts','package-lock.json','package.json','proxy.ts'].sort((a,b)=>a.localeCompare(b,'en')).map(path=>({path,sha256:'b'.repeat(64)}));
const proof={version:1,sourceSha:sha,sourceTreeDigest:createHash('sha256').update(JSON.stringify(files)).digest('hex'),files};
const changes=['待办支持按项目或领域分组，未分配项目或领域的事项单独展示。','菜谱库提供377道带来源的中外菜谱，支持按食材与分类筛选并查看步骤。','日记新增历史上的今天，可查看库内日期覆盖并打开原始记录。'];

test('an actual image absent from static history receives its finite owner summary with exact source identity',()=>{
 const artifact=validateReleaseArtifact(proof,'synthetic-current-build',sha);assert.ok(artifact);
 const notes=releaseNotes(artifact),current=notes.records.filter(row=>row.runningExactSource);
 assert.equal(current.length,1);
 assert.equal(current[0].sourceSha,sha);
 assert.equal(current[0].sourceURL,'https://github.com/Nirvana-Chow/lifeos-app/commit/'+sha);
 assert.deepEqual(current[0].changes,changes);
 assert.equal(notes.records.find(row=>row.id==='requirements-owner-source')?.runningExactSource,false);
 assert.deepEqual(notes.current,artifact);assert.equal(notes.ownerAccepted,false);assert.equal(notes.visualQualification,'not-attested');
});

test('missing or rejected image proof never promotes the finite descriptor or history to current',()=>{
 for(const artifact of [null,validateReleaseArtifact({...proof,sourceTreeDigest:'0'.repeat(64)},'synthetic-current-build',sha),validateReleaseArtifact(proof,'bad/build',sha),validateReleaseArtifact(proof,'synthetic-current-build','e'.repeat(40))]){
  const notes=releaseNotes(artifact);
  assert.equal(notes.current,null);assert.ok(notes.records.length>0);assert.equal(notes.records.some(row=>row.runningExactSource),false);
  assert.equal(readReleaseNotice({...notes,preferencesEnabled:true,readState:null}),null);
 }
});

test('an exact historical source keeps its original summary instead of receiving newer feature copy',()=>{
 const historical='e83e8133fe014afd36ba154927572bd51a7e2aca';
 const artifact=validateReleaseArtifact({...proof,sourceSha:historical},'synthetic-history-build',historical);assert.ok(artifact);
 const current=releaseNotes(artifact).records.filter(row=>row.runningExactSource);
 assert.equal(current.length,1);assert.equal(current[0].id,'requirements-owner-source');assert.equal(current[0].title,'需求池持久化与交付流程调整');
});

test('the existing owner releases endpoint projects the actual summary into the original unread notice without writing records',async()=>{
 const repository=new MemoryPort(),artifact=validateReleaseArtifact(proof,'synthetic-current-build',sha);assert.ok(artifact);
 const config={ownerId:'summary-owner',ownerEmail:'fixture@example.test',spaceId:'summary-space',databaseName:'fixture',baseURL:'https://summary.example.test',approval:'personal-manual-v1',allowedTypes:['todo','journal'],requirementsEnabled:true,requirementSupportEnabled:true} as const;
 const handler=createPersonalPlatformHandler({config,repository,storageVerified:true,sessions:{read:async()=>({userId:config.ownerId,email:config.ownerEmail})},assertWritable:async()=>{throw Error('Read must not request a writer');},releaseArtifact:()=>artifact});
 const response=await handler(new Request(config.baseURL+'/api/platform/personal/requirement-support/releases',{headers:{host:'summary.example.test'}}));
 assert.equal(response.status,200);const value=await response.json(),notice=readReleaseNotice(value);
 assert.ok(notice);assert.equal(notice.sourceSha,sha);assert.equal(notice.records.length,1);assert.deepEqual(notice.records[0].changes,changes);
 assert.equal(readReleaseNotice({...value,readState:{...value.readState,seen:true}}),null);
 assert.equal(repository.rows.size,0);assert.equal(repository.receipts.size,0);
});
