import test from 'node:test';
import assert from 'node:assert/strict';
import {projectReports,readProjectReports,ReportAccessError} from '../src/personal-reports/report.ts';

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
  for(const mode of ['ready','otherOwner','otherSpace',401,403]){
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
      assert.ok(String(input).endsWith('/todo/workspace-snapshot?today='+today));
      return Response.json(snapshot([project(1),task()]),{status:typeof mode==='number'?mode:200});
    };
    if(mode==='ready')assert.equal((await readProjectReports(today,signal,mock)).reports.length,1);
    else await assert.rejects(readProjectReports(today,signal,mock),ReportAccessError);
  }
});
