import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {emptyCareerPersonal,type CareerKind} from '../src/personal-career/domain.ts';
const url=new URL('../src/personal-career/projection.ts',import.meta.url);
const projection=existsSync(url)?await import(url.href):null;
function api(){assert.ok(projection,'career projection is not implemented');return projection;}
const pin={id:'11111111-1111-4111-8111-111111111111',sourceId:'22222222-2222-4222-8222-222222222222',revision:2};
const space='33333333-3333-4333-8333-333333333333';
function record(kind:CareerKind='employment',patch={}){return {...pin,fields:{title:'合成事实',text:'本人填写的原文',occurredOn:null,personal:{...emptyCareerPersonal(kind),...patch}}};}
function entry(){const fields=record().fields;return {id:pin.id,kind:'inbox',revision:pin.revision,syncState:'draft',externalStatus:null,draft:{...fields,disposition:'reference'},source:{id:pin.sourceId,system:'website',externalId:pin.id,version:1,original:{marker:'personal-manual-v1',type:'career',spaceId:space,input:{spaceId:space,confirmed:true,fields}}}};}
test('career summary preserves unknown date precision and explicit ongoing labels',()=>{
 assert.match(api().careerPeriodLabel({startOn:null,endOn:null,status:'unknown'}),/未知/);
 assert.equal(api().careerPeriodLabel({startOn:'2020',endOn:null,status:'current'}),'2020 – 至今');
 assert.equal(api().careerPeriodLabel({startOn:'2020-03',endOn:'2022',status:'ended'}),'2020-03 – 2022');
 assert.match(api().careerPeriodLabel({startOn:'2020',endOn:null,status:'ended'}),/结束日期未知/);
});
test('career projection accepts validated manual records only and never projects journals as career facts',()=>{
 const original=entry();const rows=api().projectCareerEntries([original],space,'原文');assert.equal(rows.length,1);assert.equal(rows[0].sourceId,pin.sourceId);
 assert.equal(api().projectCareerEntries([original],space,'missing').length,0);
 for(const mutate of [(v:any)=>v.source.original.type='journal',(v:any)=>v.source.original.spaceId=pin.id,(v:any)=>v.source.original.input.confirmed=false,(v:any)=>v.draft.disposition='pending',(v:any)=>v.source.system='xunji',(v:any)=>v.draft.personal.ownerId='other']){
  const value=structuredClone(original);mutate(value);assert.equal(api().projectCareerEntries([value],space).length,0);
 }
});
test('JD evidence mapping requires exact fact revision and never fabricates qualification scores',()=>{
 const employment=record(),opportunity=record('opportunity',{requirements:[{requirement:'交付经历',facts:[pin],gap:'量化结果待核实',nextAction:'回读原始报告'}]});
 const mapped=api().projectCareerRequirements(opportunity.fields.personal,[employment]);
 assert.equal(mapped[0].facts[0].fields.title,'合成事实');assert.equal(mapped[0].unavailable.length,0);assert.equal(mapped[0].gap,'量化结果待核实');assert.equal('score' in mapped[0],false);
 for(const records of [[{...employment,revision:3}],[record('resume')],[{...employment,sourceId:space}],[]]){
  const rows=api().projectCareerRequirements(opportunity.fields.personal,records);assert.equal(rows[0].facts.length,0);assert.equal(rows[0].unavailable.length,1);
 }
});
test('resume preview uses only explicitly pinned fact entries and reports changed or unavailable pins',()=>{
 const resume=record('resume',{facts:[pin]}),employment=record('employment',{organization:'原始组织',jobTitle:'原始职位'});
 const result=api().projectResumeFacts(resume,[employment,record('education',{organization:'未选择学校'})]);
 assert.equal(result.facts.length,1);assert.equal(result.facts[0].fields.personal.organization,'原始组织');assert.equal(result.unavailable.length,0);
 assert.equal(api().projectResumeFacts(resume,[{...employment,revision:3}]).unavailable.length,1);
 assert.equal(api().projectResumeFacts(null,[employment]).facts.length,0);
});
test('career board groups owner-entered states without claiming a saved job has been applied to',()=>{
 const records=[record('opportunity'),record('opportunity',{applicationState:'interview'}),record('education')];
 const result=api().projectCareerBoard(records);
 assert.equal(result.find((column:any)=>column.state==='saved').records.length,1);
 assert.equal(result.find((column:any)=>column.state==='applied').records.length,0);
 assert.equal(result.find((column:any)=>column.state==='interview').records.length,1);
});
