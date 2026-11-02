import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyRecordForm,formToFields,fieldsToForm} from '../src/records-workbench/fields.ts';
import type {RecordFields} from '../src/records-candidate/contracts.ts';

test('project form requires explicit stage, self-reported completion and manually recorded testing',()=>{
 const blank=emptyRecordForm('project');assert.equal(blank.stage,'');assert.equal(blank.completionStatus,'');assert.equal(blank.testingOutcome,'');
 assert.throws(()=>formToFields({...blank,title:'Synthetic project'}));
 const form={...blank,title:'Synthetic project',text:'Synthetic full body',stage:'active',completionStatus:'not-complete',testingOutcome:'not-run',nextStep:'Synthetic next action'};
 const fields=formToFields(form);assert.deepEqual(fields.record,{type:'project',syntheticOnly:true,stage:'active',nextStep:'Synthetic next action',completion:{selfReported:true,status:'not-complete',evidence:null},testing:{manuallyRecorded:true,outcome:'not-run',evidence:null},review:{decision:'pending',evidence:null}});
 assert.throws(()=>formToFields({...form,completionStatus:'complete'}));assert.throws(()=>formToFields({...form,testingOutcome:'passed'}));
 for(const outcome of ['passed','failed','blocked'])assert.doesNotThrow(()=>formToFields({...form,testingOutcome:outcome,testingEvidence:'Synthetic manually recorded evidence'}));
});

test('editing a reviewed project cannot copy its acceptance into a normal save',()=>{
 const fields:RecordFields={title:'Synthetic project',text:'Synthetic body',occurredOn:null,record:{type:'project',syntheticOnly:true,stage:'active',nextStep:null,completion:{selfReported:true,status:'complete',evidence:'Synthetic completion evidence'},testing:{manuallyRecorded:true,outcome:'passed',evidence:'Synthetic manually recorded evidence'},review:{decision:'accepted',evidence:'Synthetic user review'}}};
 const form=fieldsToForm(fields);assert.equal(form.stage,'active');assert.equal(form.completionEvidence,'Synthetic completion evidence');assert.equal(form.testingEvidence,'Synthetic manually recorded evidence');
 const edited=formToFields(form);assert.equal(edited.record.type,'project');if(edited.record.type==='project')assert.deepEqual(edited.record.review,{decision:'pending',evidence:null});
});

import * as recordClient from '../src/records-workbench/client.ts';
import {RecordsSaveSession} from '../src/records-workbench/session.ts';
import {createRecordsCommandStore} from '../src/records-workbench/recovery.ts';
import {assertRecordReadback} from '../src/records-workbench/read-state.ts';
import type {RecordEntry} from '../src/records-candidate/contracts.ts';
const id='11111111-1111-4111-8111-111111111111',sourceId='22222222-2222-4222-8222-222222222222',owner='synthetic-project-owner';
const projectFields:RecordFields={title:'Synthetic project',text:'Synthetic project body',occurredOn:null,record:{type:'project',syntheticOnly:true,stage:'active',nextStep:'Synthetic next step',completion:{selfReported:true,status:'complete',evidence:'Synthetic completion evidence'},testing:{manuallyRecorded:true,outcome:'passed',evidence:'Synthetic manually recorded test evidence'},review:{decision:'pending',evidence:null}}};
function entry():RecordEntry{return {id,kind:'inbox',revision:1,draft:{...structuredClone(projectFields),disposition:'reference'},source:{id:sourceId,system:'website',externalId:id,version:1,asOf:'2026-10-23T00:00:00.000Z',original:{...structuredClone(projectFields),disposition:'reference'}},createdAt:'2026-10-23T00:00:00.000Z',updatedAt:'2026-10-23T00:00:00.000Z',syncState:'draft',externalStatus:null};}
function reviewed():RecordEntry{const result=entry();result.revision=2;if(result.draft.record.type==='project')result.draft.record.review={decision:'accepted',evidence:'Synthetic project review evidence'};return result;}
const reviewCommand=()=>recordClient.createProjectReviewCommand(entry(),'accepted','Synthetic project review evidence','project-review-key',true,owner);
function setup(write:(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>|Response=()=>Response.json({entry:reviewed(),duplicate:false})){
 let account:string|null=owner;const calls:{path:string;init?:RequestInit}[]=[];
 const client=new recordClient.RecordsClient(async(input,init)=>{if(String(input).endsWith('/auth/get-session'))return Response.json(account?{user:{id:account},session:{userId:account}}:null);calls.push({path:String(input),init});return write(input,init);});
 return {client,calls,setOwner(value:string|null){account=value;}};
}
function storage(){const data=new Map<string,string>();return {data,store:createRecordsCommandStore({getItem:key=>data.get(key)??null,setItem:(key,value)=>{data.set(key,value);},removeItem:key=>{data.delete(key);}})};}

test('project review is an explicit confirmed command bound to the exact prior revision',()=>{
 assert.equal(typeof recordClient.createProjectReviewCommand,'function');
 for(const decision of ['accepted','rejected']as const){const command=recordClient.createProjectReviewCommand(entry(),decision,' Synthetic evidence ','project-review-valid',true,owner);assert.equal(command.path,'/api/platform/records/project/'+id+'/review');assert.equal(command.method,'POST');assert.deepEqual(JSON.parse(command.body),{expectedRevision:1,decision,evidence:' Synthetic evidence ',confirmed:true,syntheticOnly:true});assert.equal(Object.isFrozen(command),true);assert.equal(recordClient.inspectRecordCommand(command).operation,'review');}
 assert.throws(()=>recordClient.createProjectReviewCommand(entry(),'accepted','Synthetic evidence','project-review-unconfirmed',false,owner));
 assert.throws(()=>recordClient.createProjectReviewCommand(entry(),'accepted','  ','project-review-empty',true,owner));
 assert.throws(()=>recordClient.createProjectReviewCommand(entry(),'accepted','x'.repeat(16385),'project-review-long',true,owner));
});

test('lost project review retains endpoint, body, key and prior version through navigation and auth failure',async()=>{
 let writes=0;const h=setup(()=>{if(++writes===1)throw Error('Synthetic lost receipt');return Response.json({entry:reviewed(),duplicate:true});}),s=storage();
 const first=new RecordsSaveSession(h.client,()=> 'project-retained-key',s.store);await first.review(entry(),'accepted','Synthetic project review evidence',true);const frozen=first.getSnapshot().pending;assert.equal(first.getSnapshot().phase,'uncertain');
 const restored=new RecordsSaveSession(h.client,()=> 'must-not-create-key',s.store);h.setOwner(null);await restored.retry();assert.equal(restored.getSnapshot().phase,'uncertain');assert.deepEqual(restored.getSnapshot().pending,frozen);assert.equal(h.calls.length,1);assert.throws(()=>restored.reset());
 h.setOwner('other-synthetic-owner');await restored.retry();assert.equal(h.calls.length,1);assert.deepEqual(restored.getSnapshot().pending,frozen);
 await assert.rejects(()=>restored.save(projectFields,null,true));await assert.rejects(()=>restored.review(entry(),'rejected','Different evidence',true));
 h.setOwner(owner);await restored.retry();assert.equal(restored.getSnapshot().phase,'saved');assert.equal(restored.getSnapshot().result?.duplicate,true);assert.equal(s.data.size,0);
 assert.deepEqual(h.calls.map(call=>[call.path,call.init?.method,call.init?.body,new Headers(call.init?.headers).get('idempotency-key')]),Array(2).fill(['/api/platform/records/project/'+id+'/review','POST',frozen?.body,'project-retained-key']));
});

test('review receipt rejects changed content, source, decision, evidence and revision',async()=>{
 const good=reviewed();const changed=structuredClone(good);changed.draft.text='Unexpected content';const badReview=structuredClone(good);if(badReview.draft.record.type==='project')badReview.draft.record.review.evidence='Different evidence';
 const badDecision=structuredClone(good);if(badDecision.draft.record.type==='project')badDecision.draft.record.review.decision='rejected';
 for(const result of [changed,badReview,badDecision,{...good,revision:3},{...good,source:{...good.source,version:2}},{...good,id:sourceId}])await assert.rejects(()=>setup(()=>Response.json({entry:result,duplicate:false})).client.send(reviewCommand()),cause=>cause instanceof recordClient.RecordRequestError&&cause.uncertain);
 assert.equal((await setup().client.send(reviewCommand())).entry.revision,2);
 assert.throws(()=>assertRecordReadback(good,badReview));
});

test('review receipt checks authenticated owner after receiving mutation response',async()=>{
 const h=setup(()=>{h.setOwner('other-synthetic-owner');return Response.json({entry:reviewed(),duplicate:false});}),s=storage(),session=new RecordsSaveSession(h.client,()=> 'project-post-response-owner',s.store);
 await session.review(entry(),'accepted','Synthetic project review evidence',true);assert.equal(session.getSnapshot().phase,'uncertain');assert.equal(session.getSnapshot().error?.code,'ACCOUNT_CHANGED');assert.equal(s.data.size,1);
});

test('project edit receipts preserve accepted review only for an unchanged substantive draft',async()=>{
 const before=reviewed(),form=fieldsToForm(before.draft),fields=formToFields(form),target={id,revision:2,type:'project' as const,baseline:before};
 const unchanged=structuredClone(before);unchanged.revision=3;
 const noop=recordClient.createRecordCommand(fields,target,'project-noop-edit',true,owner);assert.equal((await setup(()=>Response.json({entry:unchanged,duplicate:false})).client.send(noop)).entry.revision,3);
 const updated={...fields,text:'Synthetic changed body'},edit=recordClient.createRecordCommand(updated,target,'project-changed-edit',true,owner),stale=structuredClone(unchanged);stale.draft.text=updated.text;
 await assert.rejects(()=>setup(()=>Response.json({entry:stale,duplicate:false})).client.send(edit),recordClient.RecordRequestError);
 if(stale.draft.record.type==='project')stale.draft.record.review={decision:'pending',evidence:null};assert.equal((await setup(()=>Response.json({entry:stale,duplicate:false})).client.send(edit)).entry.revision,3);
 assert.throws(()=>recordClient.createRecordCommand(fields,{id,revision:2,type:'project'},'project-no-baseline',true,owner));
});

test('normal project save cannot submit an acceptance and recovered review cannot be retargeted to edit',()=>{
 assert.throws(()=>recordClient.createRecordCommand({...projectFields,record:reviewed().draft.record},null,'project-forged-review',true,owner));
 const command=reviewCommand();for(const patch of [{path:'/api/platform/records/project/'+id,method:'PATCH'},{baseline:undefined},{body:JSON.stringify({...JSON.parse(command.body),confirmed:false})},{body:JSON.stringify({...JSON.parse(command.body),decision:'pending'})}])assert.throws(()=>recordClient.inspectRecordCommand({...command,...patch}));
});

test('authentication rejection after freezing a review retains the original command for same-account retry',async()=>{
 const h=setup(()=>Response.json({error:{code:'LOGIN_REQUIRED',message:'Synthetic authentication expired'}},{status:401})),s=storage(),session=new RecordsSaveSession(h.client,()=> 'project-auth-expired',s.store);
 await session.review(entry(),'accepted','Synthetic project review evidence',true);assert.equal(session.getSnapshot().phase,'uncertain');assert.ok(session.getSnapshot().pending);assert.equal(s.data.size,1);
});

test('maximum-size project evidence restores an exact frozen review after navigation',()=>{
 const long='S\n'.repeat(8192),baseline=entry();baseline.draft.text=long;if(baseline.draft.record.type==='project'){baseline.draft.record.nextStep='N'.repeat(4000);baseline.draft.record.completion.evidence=long.trim();baseline.draft.record.testing.evidence=long.trim();}
 baseline.source.original=structuredClone(baseline.draft);
 const command=recordClient.createProjectReviewCommand(baseline,'accepted',long,'project-long-recovery',true,owner),s=storage();s.store.keep(command);assert.ok([...s.data.values()][0].length>150000);const restored=new RecordsSaveSession(setup().client,undefined,s.store);assert.deepEqual(restored.getSnapshot().pending,command);assert.equal(recordClient.inspectRecordCommand(restored.getSnapshot().pending).operation,'review');
});

test('recovering a retained project reveals no fields until the original account is verified',async()=>{
 let resolveIdentity:((value:Response)=>void)|undefined;const client=new recordClient.RecordsClient(async()=>new Promise<Response>(resolve=>{resolveIdentity=resolve;}));
 assert.equal(typeof client.recover,'function');let visible=false;const recovering=client.recover(reviewCommand()).then(value=>{visible=true;return value;});await Promise.resolve();assert.equal(visible,false);
 resolveIdentity!(Response.json({user:{id:owner},session:{userId:owner}}));const recovered=await recovering;assert.equal(visible,true);assert.equal(recovered.operation,'review');assert.equal(recovered.fields.text,'Synthetic project body');
});

test('recovery conceals project content for switched, expired and unverifiable identities without discarding its command',async()=>{
 const command=reviewCommand();for(const identity of [()=>Response.json({user:{id:'different-owner'},session:{userId:'different-owner'}}),()=>Response.json(null),()=>Response.json({error:{code:'AUTH_UNAVAILABLE',message:'Synthetic outage'}},{status:503}),()=>{throw Error('Synthetic connection failure');}]){
  const s=storage();s.store.keep(command);const client=new recordClient.RecordsClient(async()=>identity());await assert.rejects(()=>client.recover(s.store.load()!),cause=>cause instanceof recordClient.RecordRequestError&&['ACCOUNT_CHANGED','LOGIN_REQUIRED','IDENTITY_UNAVAILABLE'].includes(cause.code));assert.deepEqual(s.store.load(),command);
 }
});

test('identity verification outage is marked so the view can conceal previously read content',async()=>{
 const client=new recordClient.RecordsClient(async()=>Response.json({error:{code:'AUTH_UNAVAILABLE',message:'Synthetic outage'}},{status:503}));await assert.rejects(()=>client.identity(),cause=>cause instanceof recordClient.RecordRequestError&&cause.code==='IDENTITY_UNAVAILABLE');
});

test('saved project readback stays bound to the command owner after navigation',async()=>{
 const h=setup(()=>Response.json({entry:reviewed()}));h.setOwner('different-owner');await assert.rejects(()=>h.client.detail('project',id,owner),cause=>cause instanceof recordClient.RecordRequestError&&cause.code==='ACCOUNT_CHANGED');assert.equal(h.calls.length,0);
});

test('an unknown 408 after a project mutation preserves the exact request for replay',async()=>{
 let writes=0;const h=setup(()=>++writes===1?Response.json({error:{code:'REQUEST_TIMEOUT',message:'Synthetic proxy timeout'}},{status:408}):Response.json({entry:reviewed(),duplicate:true})),s=storage(),session=new RecordsSaveSession(h.client,()=> 'project-timeout-key',s.store);
 await session.review(entry(),'accepted','Synthetic project review evidence',true);assert.equal(session.getSnapshot().phase,'uncertain');assert.ok(session.getSnapshot().pending);await session.retry();assert.equal(session.getSnapshot().phase,'saved');assert.equal(session.getSnapshot().result?.duplicate,true);assert.equal(h.calls[0].init?.body,h.calls[1].init?.body);assert.equal(new Headers(h.calls[1].init?.headers).get('idempotency-key'),'project-timeout-key');
});

test('visibility return conceals recovered project content until same-owner verification finishes',async()=>{
 const {createRecordsVisibilityGuard}=await import('../src/records-workbench/visibility.ts');let resolveIdentity:((value:Response)=>void)|undefined;const client=new recordClient.RecordsClient(async()=>new Promise<Response>(resolve=>{resolveIdentity=resolve;}));let visible=true,failed=false;
 const guard=createRecordsVisibilityGuard({conceal:()=>{visible=false;},verify:async()=>{await client.identity(owner);},reveal:()=>{visible=true;},failed:()=>{failed=true;}});
 guard.hide();assert.equal(visible,false);const check=guard.check();assert.equal(visible,false);resolveIdentity!(Response.json({user:{id:'different-owner'},session:{userId:'different-owner'}}));await check;assert.equal(visible,false);assert.equal(failed,true);
 failed=false;const next=guard.check();resolveIdentity!(Response.json({user:{id:owner},session:{userId:owner}}));await next;assert.equal(visible,true);assert.equal(failed,false);
});

test('hidden or disposed view ignores a late successful account verification',async()=>{
 const {createRecordsVisibilityGuard}=await import('../src/records-workbench/visibility.ts');let resolveVerification:(()=>void)|undefined,visible=true;
 const guard=createRecordsVisibilityGuard({conceal:()=>{visible=false;},verify:()=>new Promise<void>(resolve=>{resolveVerification=resolve;}),reveal:()=>{visible=true;},failed:()=>{throw Error('unexpected');}});
 const checking=guard.check();guard.hide();resolveVerification!();await checking;assert.equal(visible,false);
 const next=guard.check();guard.dispose();resolveVerification!();await next;assert.equal(visible,false);
});
