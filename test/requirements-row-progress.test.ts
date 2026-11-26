import assert from 'node:assert/strict';
import test from 'node:test';
import {requirements, type Requirement} from '../src/platform/requirements.ts';
import type {RequirementItem} from '../src/requirements-candidate/service.ts';
import {requirementDelivery, requirementIsComplete} from '../src/ui-review/requirements-delivery.ts';
import {requirementRowProgress} from '../src/ui-review/requirements-row-progress.ts';

const observedAt='2026-11-26T08:00:00Z';
const mergedAt='2026-11-25T02:00:00Z', liveAt='2026-11-25T14:00:00Z';
const sha='a'.repeat(40), commit='https://github.com/Nirvana-Chow/lifeos-app/commit/'+sha;
const merged:Requirement['evidence'][number]={scope:'delivery-merged',ref:commit,at:mergedAt};
const live:Requirement['evidence'][number]={scope:'delivery-production-verified',ref:commit,at:liveAt,
 resultHref:'https://lifeos.nirvanachow.com/personal?page=projects',
 verificationHref:'https://github.com/Nirvana-Chow/lifeos-app/blob/'+sha+'/docs/verification/fixture.md'};

function fixture(state?: NonNullable<RequirementItem['fields']['workflow']>['state']): RequirementItem {
 const requirement:Requirement={...requirements().requirements[0],id:'LO-SYNTHETIC',status:'not_started',
  roadmap:undefined,evidence:[],blockedBy:[]};
 return {id:requirement.id,revision:1,sourceId:'10000000-0000-4000-8000-000000000001',baselineBinding:null,
  baselineConflict:false,requirement,fields:{title:requirement.title,body:'合成正文',phaseId:'foundation',priority:'P2',
   plannedStartOn:null,plannedEndOn:null,...(state?{workflow:{state,purpose:'合成用途',nextStep:'合成下一步'}}:{})}};
}

function progress(row: RequirementItem) {
 const delivery=requirementDelivery(row.requirement,row.fields.workflow,row.fields.body);
 return {...requirementRowProgress(row,delivery,observedAt),complete:requirementIsComplete(row.requirement,delivery)};
}

test('registered work, review and blocked states do not imply worker activity or delivery',()=>{
 for(const [state,label] of [['in_progress','登记为开发中'],['awaiting_review','待工程检查'],['planned','待开发'],
  ['blocked','有阻塞'],['done','待核实上线'],[undefined,'推进未记录']] as const){
  assert.deepEqual(progress(fixture(state)),{state:label,latest:undefined,complete:false});
 }
 const blocked=fixture();
 blocked.requirement.blockedBy=['合成阻塞'];
 assert.equal(progress(blocked).state,'有阻塞');
});

test('merge and verified delivery supply the result while existing owner acceptance controls completion',()=>{
 const row=fixture('done');
 row.requirement.evidence=[merged];
 assert.deepEqual(progress(row),{state:'待上线',latest:{label:'查看合并结果',href:commit,at:mergedAt},complete:false});
 row.requirement.evidence.push(live);
 assert.deepEqual(progress(row),{state:'已上线，待验收',
  latest:{label:'打开正式站结果',href:live.resultHref,at:liveAt},complete:false});
 row.requirement.status='accepted';
 row.requirement.acceptance={by:'user',baselineVersion:'fixture',ref:'synthetic-owner-review'};
 assert.equal(progress(row).state,'已完成');
 assert.equal(progress(row).complete,true);
});

test('the latest applicable saved follow-up is dated without copying the private note or trusting future data',()=>{
 const row=fixture('in_progress');
 row.requirement.evidence=[merged,live];
 row.fields.body='【开发跟进 2026-11-25T08:00:00Z】\n合成早于上线\n【开发跟进 2026-11-26T07:00:00Z】\n合成正文哨兵\n【开发跟进 2031-11-26T00:00:00Z】\n未来记录';
 const result=progress(row);
 assert.deepEqual(result.latest,{label:'已记录跟进',at:'2026-11-26T07:00:00Z'});
 assert.doesNotMatch(JSON.stringify(result),/正文哨兵|未来记录/);
 row.baselineConflict=true;
 assert.equal(progress(row).latest?.href,live.resultHref);
 row.baselineConflict=false;row.sourceId=null;row.revision=0;
 assert.equal(progress(row).latest?.at,liveAt);
});
