import test from 'node:test';import assert from 'node:assert/strict';
import {validateTodo} from '../src/platform/domain.ts';
import {normalizePersonalFields} from '../src/personal-candidate/business.ts';
const todo={title:'Synthetic task',notes:'',dueOn:'2030-12-01',status:'open' as const};
const project={title:'Synthetic project',text:'',occurredOn:null,personal:{type:'project',stage:'active',purpose:null,nextStep:'',domain:null,topics:[]}};
const dates={plannedStartOn:'2030-11-05',plannedEndOn:'2030-11-10'};
test('legacy payload canonical fields remain unchanged; explicit planning roundtrips without inferring a deadline',()=>{
 assert.deepEqual(validateTodo(todo),todo);assert.deepEqual(validateTodo({...todo,...dates}),{...todo,...dates});
 assert.deepEqual(normalizePersonalFields('project',project),project);assert.deepEqual(normalizePersonalFields('project',{...project,personal:{...project.personal,...dates}}),{...project,personal:{...project.personal,...dates}});
 assert.deepEqual(validateTodo({...todo,plannedStartOn:null}),{...todo,plannedStartOn:null});
});
test('planning accepts real leap and same-day dates, keeps partial schedules, and rejects impossible or reversed pairs',()=>{
 for(const pair of [{plannedStartOn:'2028-02-29',plannedEndOn:'2028-02-29'},{plannedStartOn:'2030-11-05',plannedEndOn:null},{plannedStartOn:null,plannedEndOn:'2030-11-10'}])assert.deepEqual(validateTodo({...todo,...pair}),{...todo,...pair});
 for(const pair of [{plannedStartOn:'2030-02-29'},{plannedStartOn:'2030-11-31'},{plannedStartOn:'2030-11-05T00:00:00Z'},{plannedStartOn:3},{plannedStartOn:undefined},{plannedStartOn:'2030-11-10',plannedEndOn:'2030-11-05'}]){
  assert.throws(()=>validateTodo({...todo,...pair}));assert.throws(()=>normalizePersonalFields('project',{...project,personal:{...project.personal,...pair}}));
 }
 assert.throws(()=>normalizePersonalFields('domain',{...project,personal:{type:'domain',...dates}}));
});
test('CAS update helper preserves only omitted planning keys and does not mutate the request or prior record',async()=>{
 const {preserveOmittedPlanning}=await import('../src/personal-candidate/planning.ts');
 const old={...todo,...dates},raw={...todo,title:'Changed title'},next=validateTodo(raw),copy=structuredClone([old,raw,next]);
 assert.deepEqual(preserveOmittedPlanning('todo',raw,old,next),{...next,...dates});assert.deepEqual([old,raw,next],copy);
 assert.deepEqual(preserveOmittedPlanning('todo',{...raw,plannedStartOn:null,plannedEndOn:null},old,validateTodo({...raw,plannedStartOn:null,plannedEndOn:null})),{...next,plannedStartOn:null,plannedEndOn:null});
 const personal={...project.personal,...dates};const updated={...project,personal:{...project.personal,stage:'paused'}};
 assert.deepEqual(preserveOmittedPlanning('project',updated,{...project,personal},normalizePersonalFields('project',updated)),{...updated,personal:{...updated.personal,...dates}});
});
test('a partial update is validated against the preserved other endpoint before it can be stored',async()=>{
 const {preserveOmittedPlanning}=await import('../src/personal-candidate/planning.ts');
 const old={...todo,...dates},raw={...todo,plannedStartOn:'2030-11-11'};
 assert.throws(()=>preserveOmittedPlanning('todo',raw,old,validateTodo(raw)),/开始|结束|排期/);
});
test('editor and native cell edits retain schedule separately from dueOn',async()=>{
 const {editorFromCommand,todoDraftFromEditor}=await import('../src/personal-candidate/editor.ts');
 const {taskCellFields}=await import('../src/personal-candidate/task-editor-state.ts');
 const command={ownerId:'fixture-owner',spaceId:'fixture-space',type:'todo',id:null,key:'planning-editor-001',method:'POST',body:{spaceId:'fixture-space',confirmed:true,fields:{...todo,...dates}}} as const;
 const view=editorFromCommand(command);assert.equal(view.fields.plannedStartOn,dates.plannedStartOn);assert.equal(view.fields.plannedEndOn,dates.plannedEndOn);assert.equal(view.fields.date,todo.dueOn);
 const updated=taskCellFields(view.fields,'title','Edited title');assert.deepEqual(todoDraftFromEditor(updated),{...todo,...dates,title:'Edited title'});
});
test('full-current projection carries committed dates and exposes legacy missing dates as null',async()=>{
 const {workspaceData}=await import('../src/personal-candidate/workspace-data.ts');
 const entry=(id:string,type:string,draft:unknown)=>({id,kind:type==='todo'?'todo':'inbox',revision:2,draft,source:{id:'33333333-3333-4333-8333-333333333333',system:'website',externalId:id,version:1,original:{marker:'personal-manual-v1',spaceId:'fixture-space',type,input:{}}},syncState:'draft',externalStatus:null});
 const items=[entry('11111111-1111-4111-8111-111111111111','todo',{...todo,...dates}),entry('22222222-2222-4222-8222-222222222222','todo',todo),entry('44444444-4444-4444-8444-444444444444','project',{...project,personal:{...project.personal,...dates},disposition:'reference'})];
 const result=workspaceData({scope:'full-current-snapshot',truncated:false,total:3,items,today:'2030-11-05',observedAt:'2030-11-05T00:00:00Z'},'fixture-space','2030-11-05');
 assert.equal(result.data.tasks[0].plannedStartOn,dates.plannedStartOn);assert.equal(result.data.tasks[1].plannedStartOn,null);assert.equal(result.data.tasks[1].plannedEndOn,null);assert.equal(result.data.projects[0].plannedEndOn,dates.plannedEndOn);
});

test('shared writer retains omitted dates after CAS, rejects merged reversal, and replays the original receipt',async()=>{
 const {PersonalService}=await import('../src/personal-candidate/service.ts');
 const {MemoryPort}=await import('./helpers/platform.ts');
 const config={ownerId:'planning-owner',ownerEmail:'planning@example.invalid',spaceId:'planning-space',databaseName:'fixture',baseURL:'https://planning.example.invalid',approval:'personal-manual-v1',allowedTypes:['todo','journal','project','domain','topic']} as const;
 for(const type of ['todo','project'] as const){
  const repo=new MemoryPort(),native=repo.transaction.bind(repo);repo.transaction=(owner,key,fn)=>native(owner,key,tx=>fn({...tx,lockRecordIdentity:async()=>{}}));
  const service=new PersonalService(repo,config),base=type==='todo'?todo:project;
  const withDates=(fields:typeof todo|typeof project,planning:Record<string,unknown>)=>type==='todo'?{...fields,...planning}:{...fields,personal:{...(fields as typeof project).personal,...planning}};
  const body=(fields:unknown,revision?:number)=>({spaceId:config.spaceId,confirmed:true,fields,...(revision?{expectedRevision:revision}:{})});
  const readDates=(draft:unknown)=>{const value=draft as Record<string,unknown>;return type==='todo'?value:value.personal as Record<string,unknown>;};
  const created=await service.mutate(config.ownerId,type,null,body(withDates(base,dates)),`planning-${type}-create`);
  const oldClientBody=body({...base,title:'Legacy title edit'},1),requestCopy=structuredClone(oldClientBody);
  const updated=await service.mutate(config.ownerId,type,created.entry.id,oldClientBody,`planning-${type}-legacy`);
  assert.deepEqual(oldClientBody,requestCopy);assert.equal(updated.entry.revision,2);assert.equal(readDates(updated.entry.draft).plannedStartOn,dates.plannedStartOn);assert.equal(readDates(updated.entry.draft).plannedEndOn,dates.plannedEndOn);
  const counts=[repo.rows.size,repo.historyRows.length,repo.receipts.size];
  await assert.rejects(service.mutate(config.ownerId,type,created.entry.id,body(withDates(base,{plannedStartOn:'2030-11-11'}),2),`planning-${type}-reversed`),{code:'INVALID_PLANNING_RANGE'});
  assert.deepEqual([repo.rows.size,repo.historyRows.length,repo.receipts.size],counts);assert.equal((await service.get(config.ownerId,type,created.entry.id)).revision,2);
  const cleared=await service.mutate(config.ownerId,type,created.entry.id,body(withDates(base,{plannedEndOn:null}),2),`planning-${type}-clear`);
  assert.equal(readDates(cleared.entry.draft).plannedStartOn,dates.plannedStartOn);assert.equal(readDates(cleared.entry.draft).plannedEndOn,null);
  const replay=await service.mutate(config.ownerId,type,created.entry.id,oldClientBody,`planning-${type}-legacy`);
  assert.equal(replay.duplicate,true);assert.equal(replay.entry.revision,2);assert.equal(readDates(replay.entry.draft).plannedEndOn,dates.plannedEndOn);assert.equal((await service.get(config.ownerId,type,created.entry.id)).revision,3);
 }
});
