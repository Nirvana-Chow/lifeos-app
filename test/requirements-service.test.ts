import test from 'node:test';
import assert from 'node:assert/strict';
import {RequirementsService,requirementBinding,requirementIdentity} from '../src/requirements-candidate/service.ts';
import {requirements} from '../src/platform/requirements.ts';
import type {InboxDraft} from '../src/platform/domain.ts';
import {MemoryPort} from './helpers/platform.ts';

const config={ownerId:'requirements-owner',ownerEmail:'fixture@example.test',spaceId:'requirements-space',databaseName:'fixture',baseURL:'https://requirements.example.test',approval:'personal-manual-v1',allowedTypes:['todo','journal'],requirementsEnabled:true} as const;
const fields={title:'Synthetic requirement',body:'A long private description',phaseId:requirements().roadmap!.phases[0].id,priority:'P3',plannedStartOn:null,plannedEndOn:null} as const;
function setup(baseline=requirements()){
 const repo=new MemoryPort(),native=repo.transaction.bind(repo);let identityLocks=0;
 repo.transaction=(owner,key,fn)=>native(owner,key,tx=>fn({...tx,lockRecordIdentity:async()=>{identityLocks++;}}));
 repo.readCurrentSnapshot=async owner=>structuredClone([...repo.rows.values()].filter(row=>row.ownerId===owner));
 return {repo,service:new RequirementsService(repo,config,()=>baseline),locks:()=>identityLocks};
}
const create={spaceId:config.spaceId,confirmed:true,fields};
test('requirements snapshot composes frozen baseline and independently persistent private long text without acceptance',async()=>{
 const {repo,service}=setup(),original=requirements();
 const before=await service.snapshot(config.ownerId);assert.equal(before.items.length,34);assert.equal(before.truncated,false);
 const result=await service.mutate(config.ownerId,null,create,'requirements-create-1');
 assert.equal(result.entry.fields.priority,'P3');assert.equal(result.entry.revision,1);
 assert.equal(result.entry.requirement.status,'not_started');assert.equal(result.entry.requirement.acceptance,undefined);
 const reload=new RequirementsService(repo,config);
 assert.equal((await reload.get(config.ownerId,result.entry.id)).fields.body,fields.body);
 const snapshot=await reload.snapshot(config.ownerId);assert.equal(snapshot.items.length,35);
 assert.deepEqual(requirements(),original);assert.equal(JSON.stringify(snapshot).includes('ownerId'),false);
});
test('first baseline edits have one owner-space-ID identity and concurrent different command keys use CAS',async()=>{
 const {repo,service,locks}=setup(),base=requirements(),id=base.requirements[0].id,binding=requirementBinding(base,id);
 const command={...create,expectedRevision:0,baselineBinding:binding};
 const results=await Promise.allSettled([service.mutate(config.ownerId,id,command,'requirements-overlay-1'),service.mutate(config.ownerId,id,{...command,fields:{...fields,title:'Other'}},'requirements-overlay-2')]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((results.find(r=>r.status==='rejected') as PromiseRejectedResult).reason.code,'REVISION_CONFLICT');
 assert.equal(repo.rows.size,1);assert.equal(repo.rows.keys().next().value,requirementIdentity(config.ownerId,config.spaceId,id));assert.ok(locks()>=2);
 const current=await service.get(config.ownerId,id);assert.equal(current.revision,1);assert.deepEqual(current.requirement.evidence,base.requirements[0].evidence);assert.deepEqual(current.requirement.acceptance,base.requirements[0].acceptance);
 assert.equal((await service.snapshot(config.ownerId)).items.length,34);
});
test('immutable provenance and baseline digest conflicts reject edits; changed baseline stays visible',async()=>{
 const baseline=structuredClone(requirements()),{repo,service}=setup(baseline),id=baseline.requirements[0].id,binding=requirementBinding(baseline,id),body={...create,expectedRevision:0,baselineBinding:binding};
 for(const extra of ['evidence','acceptance','status','ownerId','source'])await assert.rejects(service.mutate(config.ownerId,id,{...body,[extra]:[]},'requirements-extra-'+extra),{code:'UNKNOWN_FIELD'});
 await service.mutate(config.ownerId,id,body,'requirements-overlay-first');
 baseline.requirements[0].description+=' Newly changed';
 const current=await service.get(config.ownerId,id);assert.equal(current.baselineConflict,true);
 await assert.rejects(service.mutate(config.ownerId,id,{...body,expectedRevision:1},'requirements-stale-base'),{code:'BASELINE_CONFLICT'});
 await assert.rejects(service.mutate(config.ownerId,id,{...body,expectedRevision:1,baselineBinding:requirementBinding(baseline,id)},'requirements-rebind-base'),{code:'BASELINE_CONFLICT'});
 assert.equal(repo.rows.size,1);assert.equal(repo.historyRows.length,1);
});
test('exact unknown-command recovery replays historical receipt, rejects changed payload and isolates owners and spaces',async()=>{
 const {service,repo}=setup(),native=repo.transaction.bind(repo);let lost=true;
 repo.transaction=async(owner,key,fn)=>{const result=await native(owner,key,fn);if(lost){lost=false;throw Error('lost after commit');}return result;};
 await assert.rejects(service.mutate(config.ownerId,null,create,'requirements-lost-1'));
 const recovered=await service.mutate(config.ownerId,null,create,'requirements-lost-1');assert.equal(recovered.duplicate,true);
 await assert.rejects(service.mutate(config.ownerId,null,{...create,fields:{...fields,title:'Changed'}},'requirements-lost-1'),{code:'COMMAND_CONFLICT'});
 await assert.rejects(service.snapshot('foreign-owner'),{code:'OWNER_ONLY'});
 const foreign=new RequirementsService(repo,{...config,spaceId:'other-requirements-space'});
 await assert.rejects(foreign.get(config.ownerId,recovered.entry.id),{code:'NOT_FOUND'});
 assert.equal((await foreign.snapshot(config.ownerId)).items.length,34);assert.equal(repo.historyRows.length,1);
});
test('bounded fields, complete updates, verified snapshots and source/schema guards fail closed',async()=>{
 const {repo,service}=setup();
 const long={...create,fields:{...fields,body:'长'.repeat(16384)}};
 const first=await service.mutate(config.ownerId,null,long,'requirements-long-1');assert.equal(first.entry.fields.body.length,16384);
 await assert.rejects(service.mutate(config.ownerId,null,{...long,fields:{...long.fields,body:long.fields.body+'长'}},'requirements-too-long'),{code:'INVALID_TEXT'});
 await assert.rejects(service.mutate(config.ownerId,null,{...create,fields:{...fields,plannedStartOn:'2026-02-30'}},'requirements-bad-date'),{code:'INVALID_DATE'});
 await assert.rejects(service.mutate(config.ownerId,null,{...create,fields:{...fields,plannedStartOn:'2026-11-07',plannedEndOn:'2026-11-06'}},'requirements-bad-range'),{code:'INVALID_PLANNED_RANGE'});
 const partial={...fields} as Record<string,unknown>;delete partial.priority;
 await assert.rejects(service.mutate(config.ownerId,first.entry.id,{spaceId:config.spaceId,confirmed:true,fields:partial,expectedRevision:1,baselineBinding:null},'requirements-partial'),{code:'COMPLETE_REQUIREMENT_REQUIRED'});
 const row=repo.rows.get(first.entry.sourceId===null?'':first.entry.id)!;
 const saved=structuredClone(row.source.original);row.source.original={...(row.source.original as object),acceptance:'forged'};
 await assert.rejects(service.get(config.ownerId,first.entry.id),{code:'NOT_FOUND'});row.source.original=saved;
 repo.readCurrentSnapshot=async()=>[{...row,ownerId:'foreign-owner'}];await assert.rejects(service.snapshot(config.ownerId),{code:'REQUIREMENTS_SNAPSHOT_UNAVAILABLE'});
});

test('known corrupted requirement rows fail full snapshot closed; missing identity fence and late authorization write nothing',async()=>{
 const {repo,service}=setup(),created=await service.mutate(config.ownerId,null,create,'requirements-corrupt-create'),row=repo.rows.get(created.entry.id)!;
 const before=structuredClone(row.source.original);row.source.original={...(row.source.original as object),schema:3};await assert.rejects(service.snapshot(config.ownerId),{code:'REQUIREMENTS_SNAPSHOT_UNAVAILABLE'});row.source.original=before;
 let checks=0;await assert.rejects(service.mutate(config.ownerId,null,create,'requirements-late-revoke',async()=>{if(++checks===3)throw Error('owner session changed');}));assert.equal(repo.rows.size,1);assert.equal(repo.historyRows.length,1);
 const original=repo.transaction.bind(repo);repo.transaction=(owner,key,fn)=>original(owner,key,tx=>{const{lockRecordIdentity,...without}=tx;void lockRecordIdentity;return fn(without);});await assert.rejects(service.mutate(config.ownerId,null,create,'requirements-no-native-lock'),{code:'REQUIREMENTS_IDENTITY_LOCK_UNAVAILABLE'});assert.equal(repo.rows.size,1);
});

test('existing personal overview and task snapshots ignore typed requirement inbox rows without new allowedTypes',async()=>{
 const {PersonalService}=await import('../src/personal-candidate/service.ts'),{service,repo}=setup();await service.mutate(config.ownerId,null,create,'requirements-overview-private');const personal=new PersonalService(repo,config);
 await personal.mutate(config.ownerId,'todo',null,{spaceId:config.spaceId,confirmed:true,fields:{title:'Synthetic existing task',notes:'',dueOn:null,status:'open'}},'requirements-overview-todo');
 assert.equal((await personal.currentSnapshot(config.ownerId)).length,1);const overview=await personal.overview(config.ownerId,'2026-11-05');assert.equal(overview.total,1);assert.equal(overview.counts.open,1);assert.equal((await service.snapshot(config.ownerId)).total,35);
});

test('owner workflow survives schema2 current history and legacy PATCH while engineering and acceptance evidence remain unchanged',async()=>{
 const baseline=structuredClone(requirements()),{repo,service}=setup(baseline),id=baseline.requirements[0].id,binding=requirementBinding(baseline,id);
 const workflow={state:'in_progress',purpose:'说明业务用途，保留原始文字。',nextStep:'核对可用入口后更新需求。'};
 const first=await service.mutate(config.ownerId,id,{...create,fields:{...fields,workflow},expectedRevision:0,baselineBinding:binding},'requirements-workflow-first');
 assert.deepEqual(first.entry.fields.workflow,workflow);
 assert.deepEqual((await new RequirementsService(repo,config,()=>baseline).get(config.ownerId,id)).fields,first.entry.fields);
 const legacy=await service.mutate(config.ownerId,id,{...create,fields:{...fields,title:'Legacy edit'},expectedRevision:1,baselineBinding:binding},'requirements-workflow-legacy');
 assert.deepEqual(legacy.entry.fields.workflow,workflow);
 assert.deepEqual((await service.snapshot(config.ownerId)).items.find(item=>item.id===id)!.fields,legacy.entry.fields);
 const history=await service.history(config.ownerId,id);assert.deepEqual(history.items.map(item=>item.fields.workflow),[workflow,workflow]);
 assert.deepEqual(legacy.entry.requirement.evidence,baseline.requirements[0].evidence);assert.deepEqual(legacy.entry.requirement.acceptance,baseline.requirements[0].acceptance);assert.deepEqual(legacy.entry.requirement.roadmap, {...baseline.requirements[0].roadmap,phaseId:fields.phaseId,priority:fields.priority});
 const cleared=await service.mutate(config.ownerId,id,{...create,fields:{...fields,workflow:null},expectedRevision:2,baselineBinding:binding},'requirements-workflow-clear');
 assert.equal(cleared.entry.fields.workflow,null);assert.equal((await service.get(config.ownerId,id)).revision,3);assert.equal(repo.rows.size,1);
 const preservedClear=await service.mutate(config.ownerId,id,{...create,expectedRevision:3,baselineBinding:binding},'requirements-workflow-preserve-clear');assert.equal(preservedClear.entry.fields.workflow,null);
});
test('workflow validates bounded literal fields and cannot carry acceptance or implementation claims',async()=>{
 const {service,repo}=setup(),workflow={state:'done',purpose:'',nextStep:''};
 const first=await service.mutate(config.ownerId,null,{...create,fields:{...fields,workflow}},'requirements-workflow-done');
 assert.equal(first.entry.requirement.status,'not_started');assert.equal(first.entry.requirement.roadmap!.implementation,'not_started');assert.equal(first.entry.requirement.acceptance,undefined);
 for(const [name,value,code] of [['state',{...workflow,state:'accepted'},'INVALID_REQUIREMENT_WORKFLOW'],['purpose',{...workflow,purpose:'x'.repeat(4097)},'INVALID_REQUIREMENT_WORKFLOW'],['null-byte',{...workflow,nextStep:'x\0'},'INVALID_REQUIREMENT_WORKFLOW'],['incomplete',{state:'planned',purpose:''},'INVALID_REQUIREMENT_WORKFLOW'],['evidence',{...workflow,evidence:[]},'UNKNOWN_FIELD'],['acceptance',{...workflow,acceptance:{}},'UNKNOWN_FIELD']] as const){
  await assert.rejects(service.mutate(config.ownerId,null,{...create,fields:{...fields,workflow:value}},'requirements-workflow-invalid-'+name),{code});
 }
 assert.equal(repo.rows.size,1);
 const row=repo.rows.get(first.entry.id)!,original=structuredClone(row.source.original);
 (row.source.original as {input:{fields:{workflow:{purpose:string}}}}).input.fields.workflow.purpose='tampered';await assert.rejects(service.get(config.ownerId,first.entry.id),{code:'NOT_FOUND'});row.source.original=original;
 (row.draft as InboxDraft).requirement!.workflow!.state='accepted' as never;await assert.rejects(service.snapshot(config.ownerId),{code:'REQUIREMENTS_SNAPSHOT_UNAVAILABLE'});
});
test('workflow CAS and unknown recovery keep the exact historical receipt without overwriting later progress',async()=>{
 const {service,repo}=setup(),workflow={state:'planned',purpose:'保存用途',nextStep:'确认范围'},command={...create,fields:{...fields,workflow}};
 const native=repo.transaction.bind(repo);let lost=true;repo.transaction=async(owner,key,fn)=>{const result=await native(owner,key,fn);if(lost){lost=false;throw Error('lost workflow receipt');}return result;};
 await assert.rejects(service.mutate(config.ownerId,null,command,'requirements-workflow-lost'));
 const replay=await service.mutate(config.ownerId,null,command,'requirements-workflow-lost');assert.equal(replay.duplicate,true);assert.equal(repo.rows.size,1);
 const patch={...create,fields:{...fields,workflow:{...workflow,state:'blocked',nextStep:'等待材料'}},expectedRevision:1,baselineBinding:null};
 const changed=await service.mutate(config.ownerId,replay.entry.id,patch,'requirements-workflow-change');assert.equal(changed.entry.fields.workflow?.state,'blocked');
 await assert.rejects(service.mutate(config.ownerId,replay.entry.id,patch,'requirements-workflow-stale'),{code:'REVISION_CONFLICT'});
 await assert.rejects(service.mutate(config.ownerId,null,{...command,fields:{...command.fields,workflow:{...workflow,nextStep:'changed'}}},'requirements-workflow-lost'),{code:'COMMAND_CONFLICT'});
 const historical=await service.mutate(config.ownerId,null,command,'requirements-workflow-lost');assert.equal(historical.entry.revision,1);assert.deepEqual(historical.entry.fields.workflow,workflow);assert.equal((await service.get(config.ownerId,replay.entry.id)).revision,2);
});
