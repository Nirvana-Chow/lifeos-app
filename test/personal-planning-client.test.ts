import test from 'node:test';import assert from 'node:assert/strict';
import {makePersonalCommand,PersonalMutationSession} from '../src/personal-candidate/client.ts';
const binding={ownerId:'fixture-owner',spaceId:'fixture-space'},id='11111111-1111-4111-8111-111111111111';
const todo={title:'Synthetic task',notes:'',dueOn:null,status:'open' as const},dates={plannedStartOn:'2030-11-05',plannedEndOn:'2030-11-10'};
function entry(type='todo',draft:unknown={...todo,...dates},revision=2){return{id,kind:type==='todo'?'todo':'inbox',draft,revision,source:{id:'22222222-2222-4222-8222-222222222222',system:'website',externalId:id,version:1,original:{marker:'personal-manual-v1',type,spaceId:binding.spaceId,input:{}}},syncState:'draft',externalStatus:null};}
test('legacy update receipts may preserve unsubmitted dates; retry keeps the exact original command',async()=>{
 const bodies:string[]=[];let calls=0;const session=new PersonalMutationSession({binding,fetcher:async(_,init)=>{bodies.push(String(init?.body));if(!calls++)throw Error('synthetic unknown');return Response.json({entry:entry(),duplicate:true});}});
 const command=makePersonalCommand(binding,'todo',id,todo,'planning-retry-001',true,1);await session.submit(command);assert.equal(session.getSnapshot().phase,'uncertain');await session.retry();assert.equal(session.getSnapshot().phase,'saved');assert.equal(bodies[0],bodies[1]);assert.equal(Object.hasOwn(command.body.fields,'plannedStartOn'),false);
});
test('explicit null, submitted dates and new-record payload remain exact receipt constraints',async()=>{
 for(const [fields,create] of [[{...todo,plannedStartOn:null,plannedEndOn:null},false],[{...todo,plannedStartOn:'2030-11-06',plannedEndOn:'2030-11-10'},false],[todo,true]] as const){
  const session=new PersonalMutationSession({binding,fetcher:async()=>Response.json({entry:entry('todo',{...todo,...dates},create?1:2),duplicate:false},{status:create?201:200})});await session.submit(makePersonalCommand(binding,'todo',create?null:id,fields,'planning-exact-001',true,create?undefined:1));assert.equal(session.getSnapshot().phase,'uncertain');
 }
});
test('legacy project receipts preserve omitted nested dates but reject invalid retained dates',async()=>{
 const fields={title:'Synthetic project',text:'',occurredOn:null,personal:{type:'project' as const,stage:'active' as const,purpose:null,nextStep:'',domain:null,topics:[]}};
 for(const [planning,phase] of [[dates,'saved'],[{plannedStartOn:'2030-02-30',plannedEndOn:null},'uncertain']] as const){
  const session=new PersonalMutationSession({binding,fetcher:async()=>Response.json({entry:entry('project',{...fields,personal:{...fields.personal,...planning},disposition:'reference'}),duplicate:false})});await session.submit(makePersonalCommand(binding,'project',id,fields,'planning-project-001',true,1));assert.equal(session.getSnapshot().phase,phase);
 }
});
