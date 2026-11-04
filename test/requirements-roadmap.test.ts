import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../src/platform/requirements.ts';

const originalIds=['LO-UI-001','LO-AUTH-001','LO-PRIVACY-001','LO-VERSION-001','LO-OPS-001','LO-REQ-001'];

test('roadmap retains original IDs and exposes a current phase and actionable route',()=>{
 const b=model.requirements();
 for(const id of originalIds)assert.ok(b.requirements.some(r=>r.id===id));
 assert.ok(b.roadmap,'The requirement pool needs a project goal and development route');
 assert.ok(b.roadmap.goal.length>0&&b.roadmap.nextStep.length>0);
 assert.ok(b.roadmap.phases.some(p=>p.id===b.roadmap!.currentPhaseId));
 assert.deepEqual(b.roadmap.phases.map(p=>p.order),[1,2,3,4,5]);
 assert.ok(b.requirements.every(r=>r.roadmap&&r.roadmap.nextStep.length>0));
 assert.ok(b.requirements.find(r=>r.id==='LO-TASK-001')?.roadmap?.issueRefs.includes('https://github.com/Nirvana-Chow/lifeos-app/issues/5'));
 assert.ok(b.requirements.find(r=>r.id==='LO-PROJECT-001')?.roadmap?.issueRefs.includes('https://github.com/Nirvana-Chow/lifeos-app/issues/7'));
 assert.ok(!b.requirements.some(r=>r.status==='accepted'));
});

test('roadmap validation rejects ambiguous phases, invalid implementation and unsafe references',()=>{
 const invalid=(edit:(b:any)=>void)=>{const b=structuredClone(model.requirements());edit(b);assert.throws(()=>model.validateRequirementBaseline(b),/roadmap/i);};
 invalid(b=>{b.roadmap={goal:'goal',nextStep:'next',currentPhaseId:'missing',phases:[]};});
 invalid(b=>{b.requirements[0].roadmap={phaseId:'missing',priority:'P0',implementation:'partial',summary:'summary',nextStep:'next',issueRefs:[],prRefs:[],specTaskRefs:[]};});
 const fixture=structuredClone(model.requirements());
 fixture.roadmap={goal:'goal',nextStep:'next',currentPhaseId:'foundation',phases:[{id:'foundation',order:1,title:'基础',goal:'保留安全边界'}]};
 fixture.requirements[0].roadmap={phaseId:'foundation',priority:'P0',implementation:'complete',summary:'summary',nextStep:'next',issueRefs:[],prRefs:[],specTaskRefs:[]} as any;
 assert.throws(()=>model.validateRequirementBaseline(fixture),/roadmap/i);
 for(const field of ['issueRefs','prRefs','specTaskRefs']){
  const b=structuredClone(model.requirements());
  b.requirements[0].roadmap={phaseId:b.roadmap?.currentPhaseId??'foundation',priority:'P0',implementation:'partial',summary:'summary',nextStep:'next',issueRefs:[],prRefs:[],specTaskRefs:[],[field]:['javascript:alert(1)']} as any;
  assert.throws(()=>model.validateRequirementBaseline(b),/roadmap/i);
 }
});

test('legacy baselines without roadmap metadata remain valid and preserve the acceptance guard',()=>{
 const b=structuredClone(model.requirements());delete b.roadmap;
 for(const r of b.requirements)delete r.roadmap;
 assert.doesNotThrow(()=>model.validateRequirementBaseline(b));
 b.requirements[0].status='accepted';assert.throws(()=>model.validateRequirementBaseline(b),/acceptance/i);
});

test('selectors combine source-aware search and implementation filters without changing baseline order',()=>{
 assert.equal(typeof model.selectRequirements,'function','A shared selector must filter the same public baseline');
 const b=model.requirements();
 assert.deepEqual(model.selectRequirements(b,{query:' LO-TASK-001 ',implementation:'all'}).map(r=>r.id),['LO-TASK-001']);
 assert.deepEqual(model.selectRequirements(b,{query:'issues/7',implementation:'all'}).map(r=>r.id),['LO-PROJECT-001']);
 assert.equal(model.selectRequirements(b,{query:'LO-TASK-001',implementation:'not_started'}).length,0);
 assert.ok(model.selectRequirements(b,{implementation:'partial'}).every(r=>r.roadmap?.implementation==='partial'));
 assert.equal(model.selectRequirements(b,{query:'no-such-requirement'}).length,0);
 assert.deepEqual(model.selectRequirements(b,{}).map(r=>r.id),b.requirements.toSorted((a,c)=>(b.roadmap?.phases.find(p=>p.id===a.roadmap?.phaseId)?.order??99)-(b.roadmap?.phases.find(p=>p.id===c.roadmap?.phaseId)?.order??99)).map(r=>r.id));
});

test('roadmap rejects duplicate phase order and unsupported priorities instead of silently reordering scope',()=>{
 const original=model.requirements();
 const cases=[
  (b:any)=>{b.roadmap.phases[1].order=b.roadmap.phases[0].order;},
  (b:any)=>{b.roadmap.phases[1].id=b.roadmap.phases[0].id;},
  (b:any)=>{b.requirements[0].roadmap.priority='P9';},
  (b:any)=>{b.requirements[0].roadmap.nextStep=' ';},
  (b:any)=>{b.requirements[0].evidence=[];},
 ];
 for(const edit of cases){const b=structuredClone(original);edit(b);assert.throws(()=>model.validateRequirementBaseline(b),/roadmap/i);}
});


test('shared requirement filters intersect phase, priority and acceptance while preserving source data',()=>{
 const b=model.requirements(), before=JSON.stringify(b);
 const selected=b.requirements.find(r=>r.id==='LO-TASK-001')!;
 const filters={phase:selected.roadmap!.phaseId,priority:selected.roadmap!.priority,acceptance:selected.status};
 const rows=model.selectRequirements(b,filters);
 assert.ok(rows.length>0&&rows.length<b.requirements.length);
 assert.ok(rows.every(r=>r.roadmap?.phaseId===filters.phase&&r.roadmap?.priority===filters.priority&&r.status===filters.acceptance));
 assert.equal(model.selectRequirements(b,{...filters,query:'LO-TASK-001'}).length,1);
 assert.deepEqual(model.selectRequirements(b,{...filters,acceptance:'accepted'}),[]);
 assert.equal(model.selectRequirements(b,{phase:'missing'}).length,0);
 assert.equal(model.selectRequirements(b,{phase:'all',priority:'all',acceptance:'all'}).length,b.requirements.length);
 assert.equal(JSON.stringify(b),before);
});

test('project goal covers the connected personal data system',()=>{
 const goal=model.requirements().roadmap!.goal;
 for(const area of ['训练','睡眠','健康','财务','日程','日记','人生阶段'])assert.ok(goal.includes(area),area);
});

test('intake retains all 31 inherited stable IDs and records people, links, graph and portable Agent delivery',()=>{
 const baseline=model.requirements();
 const inherited=['VERSION','UI','REQ','AUTH','TASK','FIN','SOURCE','CAPTURE','OVERVIEW','TIMELINE','TIME','HEALTH','PROJECT','ARTICLE','SCHEDULE','PEOPLE','FILES','REPORT','AI','DATA','OUTPUT','SEARCH','PRIVACY','OPS','BACKUP','EXPERIMENT','LEARNING','LEGAL','JOURNAL','SEC'].map(key=>'LO-'+key+'-001').concat('LO-AUTH-002');
 const ids=new Set(baseline.requirements.map(r=>r.id));
 assert.equal(inherited.length,31);
 for(const id of [...inherited,'LO-LINK-001','LO-GRAPH-001','LO-AGENT-001'])assert.ok(ids.has(id),id);
 for(const id of ['LO-PEOPLE-001','LO-LINK-001','LO-GRAPH-001','LO-AGENT-001']){
  const item=baseline.requirements.find(r=>r.id===id)!;
  assert.ok(item.sourceRefs.length&&item.acceptanceCriteria.length&&item.roadmap?.issueRefs.length);
  assert.notEqual(item.status,'accepted');
 }
 assert.match(baseline.requirements.find(r=>r.id==='LO-REQ-001')!.acceptanceCriteria.join('\n'),/先.*需求池|入池/);
});
