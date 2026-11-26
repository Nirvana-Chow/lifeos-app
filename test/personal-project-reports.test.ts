import {handlePersonalRequest} from '../src/personal-candidate/http.ts';
import {readTaskWorkspaceSnapshot} from '../src/personal-candidate/task-workspace-read.ts';
import type {PersonalConfig} from '../src/personal-candidate/config.ts';
import type {PersonalService} from '../src/personal-candidate/service.ts';
import type {StoredEntry} from '../src/platform/contracts.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {projectReports,readProjectReports,ReportAccessError,projectReviewId} from '../src/personal-reports/report.ts';

const today='2026-11-26', observedAt=today+'T00:00:00Z', spaceId='synthetic-report-space';
const id=(n:number)=>'11111111-1111-4111-8111-'+String(n).padStart(12,'0');
function entry(n:number,type:'project'|'todo',draft:object,revision=1) {
  return {
    id:id(n), kind:type==='todo'?'todo':'inbox', draft, revision, syncState:'draft', externalStatus:null,
    createdAt:observedAt, updatedAt:observedAt,
    source:{id:id(n+100),externalId:id(n),system:'website',version:1,asOf:observedAt,
      original:{marker:'personal-manual-v1',spaceId,type,input:{}}},
  };
}
const project=(n:number,revision=1)=>entry(n,'project',{
  title:'Synthetic shared name',text:'PRIVATE_BODY_SENTINEL',occurredOn:null,disposition:'reference',
  personal:{type:'project',stage:'active',purpose:'advance',nextStep:'',domain:null,topics:[]},
},revision);
const task=(revision=1,sourceId=id(101))=>entry(3,'todo',{
  title:'Synthetic task',notes:'PRIVATE_BODY_SENTINEL',dueOn:null,status:'open',
  personal:{project:{id:id(1),sourceId,revision:1},domain:null,topics:[]},
},revision);
const snapshot=(items:unknown[])=>({items,total:items.length,truncated:false,scope:'task-workspace-current-snapshot',today,observedAt});

test('same-name projects associate only by stable ID and source, without copying body text',()=>{
  const result=projectReports(snapshot([project(1),project(2),task()]),spaceId,today);
  assert.equal(result.observedAt,observedAt);
  assert.deepEqual(result.reports.map(row=>[row.id,row.duplicateTitle,row.tasks.length]),[[id(1),true,1],[id(2),true,0]]);
  assert.equal(result.reports[0].tasks[0].sourceId,id(103));
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_BODY_SENTINEL/);
  assert.equal(projectReports(snapshot([project(1),task(1,id(999))]),spaceId,today).reports[0].tasks.length,0);
});

test('changes to membership or pinned revisions invalidate only the related report',()=>{
  const read=(rows:unknown[])=>projectReports(snapshot(rows),spaceId,today).reports;
  const first=read([project(1),project(2),task()]);
  for(const changed of [read([project(1),project(2)]),read([project(1),project(2),task(2)]),read([project(1,2),project(2),task()])]){
    assert.notEqual(changed[0].stamp,first[0].stamp);
    assert.equal(changed[1].stamp,first[1].stamp);
  }
  assert.equal(read([project(1,2),task()])[0].referenceChanged,true);
  assert.equal(read([task(),project(1)])[0].stamp,first[0].stamp);
});

test('incomplete or foreign-space snapshots fail closed',()=>{
  const value=snapshot([project(1)]);
  assert.throws(()=>projectReports({...value,truncated:true},spaceId,today));
  assert.throws(()=>projectReports({...value,total:2},spaceId,today));
  assert.throws(()=>projectReports(value,'other-space',today));
});

test('snapshot read uses GET only and rejects identity changes and 401/403',async()=>{
  const signal=new AbortController().signal;
  const status={scope:'personal-manual-candidate',storageVerified:true,ownerId:'synthetic-owner',spaceId,allowedTypes:['project','todo']};
  for(const mode of ['ready','otherOwner','otherSpace','unmatchedEvidence',401,403]){
    let statusReads=0;
    const mock:typeof fetch=async(input,init)=>{
      assert.equal(init?.method ?? 'GET','GET');
      assert.equal(init?.cache,'no-store');
      assert.equal(init?.credentials,'same-origin');
      assert.equal(init?.signal,signal);
      if(String(input).endsWith('/status')){
        statusReads++;
        const altered=statusReads===2 ? mode==='otherOwner'?{ownerId:'other-owner'}:mode==='otherSpace'?{spaceId:'other-space'}:{}:{};
        return Response.json({...status,...altered});
      }
      if(String(input).includes('/history?')){
        assert.ok(String(input).endsWith('/project/'+id(1)+'/history?view=review-evidence'));
        return Response.json({scope:'project-review-evidence',projectId:id(1),sourceId:id(101),
          revision:mode==='unmatchedEvidence'?2:1,historyCoverage:'partial',originalDecision:null});
      }
      assert.ok(String(input).endsWith('/todo/workspace-snapshot?today='+today+'&view=project-reports'));
      const value=snapshot([project(1),task()]);
      return Response.json({...value,items:[],total:0,review:projectReports(value,spaceId,today)},
        {status:typeof mode==='number'?mode:200});
    };
    if(mode==='ready'){
      const result=await readProjectReports(today,signal,mock);
      assert.equal(result.reports.length,1);
      assert.deepEqual(result.evidence,{historyCoverage:'partial',originalDecision:null});
    }else if(mode==='unmatchedEvidence')await assert.rejects(readProjectReports(today,signal,mock),/evidence changed/);
    else await assert.rejects(readProjectReports(today,signal,mock),ReportAccessError);
  }
});

test('deep links accept exactly one valid project ID',()=>{
  assert.equal(projectReviewId(id(1)),id(1));
  assert.equal(projectReviewId([id(1),id(2)]),'');
  assert.equal(projectReviewId('../projects'),'');
});

const config:PersonalConfig={ownerId:'synthetic-owner',ownerEmail:'reports@example.invalid',spaceId,
  databaseName:'synthetic',baseURL:'http://127.0.0.1:3111',approval:'personal-manual-v1',allowedTypes:['project','todo']};
const request=(path:string)=>new Request(config.baseURL+path,{headers:{host:'127.0.0.1:3111'}});

test('opt-in snapshot strips bodies and the unchanged snapshot still returns legacy entries',async()=>{
  const raw=project(1);
  const row={...raw,ownerId:config.ownerId,source:{...raw.source,
    original:{...raw.source.original,input:{spaceId,confirmed:true,fields:(({disposition:_,...fields})=>fields)(raw.draft as Record<string,unknown>)}}}} as StoredEntry;
  const reader={readTaskWorkspaceSnapshot:async()=>[row]};
  const url='/api/platform/personal/todo/workspace-snapshot?today='+today;
  const original=await readTaskWorkspaceSnapshot(request(url),config,true,reader);
  assert.match(JSON.stringify(original),/PRIVATE_BODY_SENTINEL/);
  assert.equal('review' in original,false);
  const narrow=await readTaskWorkspaceSnapshot(request(url+'&view=project-reports'),config,true,reader);
  assert.ok('review' in narrow);
  assert.equal(narrow.review?.projectCount,1);
  assert.doesNotMatch(JSON.stringify(narrow),/PRIVATE_BODY_SENTINEL/);
  assert.deepEqual(narrow.items,[]);
});

test('by-ID evidence uses owner checks and only returns matching revision metadata',async()=>{
  const current=project(1,2);
  let checks=0;
  let versions=[current];
  const service={config,async get(owner:string,type:string,key:string){
    assert.equal(owner,config.ownerId);assert.equal(type,'project');assert.equal(key,current.id);
    return current;
  },async history(){return {items:versions,truncated:false};}} as unknown as PersonalService;
  const url='/api/platform/personal/project/'+current.id+'/history';
  const guards={assertOwner:async()=>{checks++;},assertWritable:async()=>assert.fail('write called')};
  const read=async(query:string)=>(await handlePersonalRequest(request(url+query),config.ownerId,config.baseURL,service,guards))!.json();
  assert.deepEqual(await read('?view=review-evidence'),{
    scope:'project-review-evidence',projectId:current.id,sourceId:current.source.id,revision:2,historyCoverage:'partial',originalDecision:null,
  });
  assert.equal(checks,2);
  versions=[current,project(1,1)];
  assert.equal((await read('?view=review-evidence')).historyCoverage,'complete');
  assert.match(JSON.stringify(await read('')),/PRIVATE_BODY_SENTINEL/);
});
