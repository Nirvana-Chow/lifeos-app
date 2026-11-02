import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlatformHandler} from '../src/platform/http.ts';
import {MemoryPort} from './helpers/platform.ts';
import {RecordsClient,createRecordCommand,createProjectReviewCommand} from '../src/records-workbench/client.ts';
import {RecordsSaveSession} from '../src/records-workbench/session.ts';
import {createRecordsCommandStore} from '../src/records-workbench/recovery.ts';
import {assertRecordReadback} from '../src/records-workbench/read-state.ts';
import {fieldsToForm,formToFields} from '../src/records-workbench/fields.ts';
import type {RecordFields,RecordEntry} from '../src/records-candidate/contracts.ts';
const owner={id:'synthetic-project-ui-owner',email:'synthetic-project-ui@example.invalid'},base='http://127.0.0.1:3111';
const fields:RecordFields={title:' Synthetic project ',text:'Synthetic complete project body\n<script>plain text only</script>',occurredOn:'2026-10-23',record:{type:'project',syntheticOnly:true,stage:'active',nextStep:'Synthetic next action',completion:{selfReported:true,status:'complete',evidence:'Synthetic self-reported completion'},testing:{manuallyRecorded:true,outcome:'passed',evidence:'Synthetic manually recorded test result'},review:{decision:'pending',evidence:null}}};
function setup(){const repository=new MemoryPort(),handler=createPlatformHandler({repository,sessions:{read:async()=>({userId:owner.id,email:owner.email})},owner,baseURL:base});
 const transport:typeof fetch=async(input,init)=>String(input)==='/api/platform/auth/get-session'?Response.json({user:{id:owner.id},session:{userId:owner.id}}):handler(new Request(new URL(String(input),base),{...init,headers:{...Object.fromEntries(new Headers(init?.headers)),origin:base,host:'127.0.0.1:3111'}}));
 return {repository,transport,client:new RecordsClient(transport)};}
const target=(entry:RecordEntry)=>({id:entry.id,revision:entry.revision,type:'project' as const,baseline:entry});

test('project workbench creates, reviews, edits and reads history through the real in-process handler',async()=>{
 const h=setup();assert.deepEqual(await h.client.list('project'),[]);
 const created=await h.client.send(createRecordCommand(fields,null,'project-ui-create',true,owner.id));assert.equal(created.entry.draft.title,'Synthetic project');assert.equal(created.entry.draft.record.type,'project');assert.deepEqual(created.entry.source.original,{...fields,disposition:'reference'});
 const accepted=await h.client.send(createProjectReviewCommand(created.entry,'accepted',' Synthetic user review ','project-ui-review',true,owner.id));assert.equal(accepted.entry.revision,2);if(accepted.entry.draft.record.type==='project')assert.deepEqual(accepted.entry.draft.record.review,{decision:'accepted',evidence:'Synthetic user review'});
 const same=formToFields(fieldsToForm(accepted.entry.draft));const unchanged=await h.client.send(createRecordCommand(same,target(accepted.entry),'project-ui-noop',true,owner.id));assert.equal(unchanged.entry.revision,3);if(unchanged.entry.draft.record.type==='project')assert.equal(unchanged.entry.draft.record.review.decision,'accepted');
 const edited=await h.client.send(createRecordCommand({...same,text:'Synthetic updated body'},target(unchanged.entry),'project-ui-edit',true,owner.id));assert.equal(edited.entry.revision,4);if(edited.entry.draft.record.type==='project'){assert.deepEqual(edited.entry.draft.record.review,{decision:'pending',evidence:null});assert.equal(edited.entry.draft.record.completion.selfReported,true);assert.equal(edited.entry.draft.record.testing.manuallyRecorded,true);}
 assert.deepEqual(edited.entry.source,created.entry.source);assertRecordReadback(edited.entry,await h.client.detail('project',edited.entry.id));assert.equal((await h.client.list('project')).length,1);
 const history=await h.client.history('project',edited.entry.id);assert.deepEqual(history.map(value=>[value.revision,value.draft.record.type==='project'?value.draft.record.review.decision:null]),[[4,'pending'],[3,'accepted'],[2,'accepted'],[1,'pending']]);assert.equal(h.repository.rows.size,1);assert.equal(h.repository.historyRows.length,4);
});

test('lost review response replays its saved receipt after a later edit without changing history',async()=>{
 const h=setup(),created=await h.client.send(createRecordCommand(fields,null,'project-retry-create',true,owner.id));let lose=true;const requests:{path:string;body:BodyInit|null|undefined;key:string|null}[]=[];
 const client=new RecordsClient(async(input,init)=>{if(String(input).endsWith('/review'))requests.push({path:String(input),body:init?.body,key:new Headers(init?.headers).get('idempotency-key')});const response=await h.transport(input,init);if(String(input).endsWith('/review')&&lose){lose=false;throw Error('Synthetic response lost after commit');}return response;});
 const data=new Map<string,string>(),store=createRecordsCommandStore({getItem:key=>data.get(key)??null,setItem:(key,value)=>{data.set(key,value);},removeItem:key=>{data.delete(key);}}),session=new RecordsSaveSession(client,()=> 'project-review-frozen',store);
 await session.review(created.entry,'accepted','Synthetic confirmed review',true);assert.equal(session.getSnapshot().phase,'uncertain');assert.equal(h.repository.historyRows.length,2);
 const afterReview=await h.client.detail('project',created.entry.id);const edited=await h.client.send(createRecordCommand({...formToFields(fieldsToForm(afterReview.draft)),text:'Synthetic later correction'},target(afterReview),'project-after-lost-review',true,owner.id));assert.equal(edited.entry.revision,3);
 const restored=new RecordsSaveSession(client,()=> 'must-not-replace-key',store);await restored.retry();assert.equal(restored.getSnapshot().phase,'saved');assert.equal(restored.getSnapshot().result?.duplicate,true);assert.equal(restored.getSnapshot().result?.entry.revision,2);assert.equal(h.repository.historyRows.length,3);assert.equal(data.size,0);assert.equal(requests.length,2);assert.deepEqual(requests[0],requests[1]);
 assertRecordReadback(restored.getSnapshot().result!.entry,await h.client.detail('project',created.entry.id));
});

test('stale project review is a visible conflict and cannot record a decision on a newer revision',async()=>{
 const h=setup(),created=await h.client.send(createRecordCommand(fields,null,'project-conflict-create',true,owner.id));await h.client.send(createRecordCommand({...fields,text:'Synthetic concurrent content'},target(created.entry),'project-concurrent-edit',true,owner.id));
 const session=new RecordsSaveSession(h.client,()=> 'project-stale-review');await session.review(created.entry,'rejected','Synthetic stale decision',true);assert.equal(session.getSnapshot().phase,'conflict');assert.equal(session.getSnapshot().pending,null);assert.equal(h.repository.historyRows.length,2);
 const current=await h.client.detail('project',created.entry.id);if(current.draft.record.type==='project')assert.equal(current.draft.record.review.decision,'pending');
 session.reset();await session.review(current,'rejected','Synthetic newly confirmed decision',true);assert.equal(session.getSnapshot().phase,'saved');assert.equal(h.repository.historyRows.length,3);
});

test('a 408 replacing a committed review response keeps one idempotent review and history revision',async()=>{
 const h=setup(),created=await h.client.send(createRecordCommand(fields,null,'project-408-create',true,owner.id));let intercepted=false;
 const client=new RecordsClient(async(input,init)=>{const response=await h.transport(input,init);if(String(input).endsWith('/review')&&!intercepted){intercepted=true;return Response.json({error:{code:'REQUEST_TIMEOUT',message:'Synthetic timeout after commit'}},{status:408});}return response;});
 const session=new RecordsSaveSession(client,()=> 'project-committed-408');await session.review(created.entry,'accepted','Synthetic confirmed review',true);assert.equal(session.getSnapshot().phase,'uncertain');assert.equal(h.repository.historyRows.length,2);await session.retry();assert.equal(session.getSnapshot().phase,'saved');assert.equal(session.getSnapshot().result?.duplicate,true);assert.equal(h.repository.historyRows.length,2);
});
