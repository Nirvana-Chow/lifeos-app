import test from 'node:test';
import assert from 'node:assert/strict';
import {RecordsClient,RecordRequestError,parseRecordEntry,createRecordCommand,inspectRecordCommand} from '../src/records-workbench/client.ts';
import {fieldsToForm,formToFields} from '../src/records-workbench/fields.ts';
import {createRecordsCommandStore} from '../src/records-workbench/recovery.ts';
import {RecordsSaveSession} from '../src/records-workbench/session.ts';
import type {RecordEntry,RecordFields,ProjectLink,ProjectLinkCandidate,ProjectRecapResponse} from '../src/records-candidate/contracts.ts';
const id='11111111-1111-4111-8111-111111111111',sourceId='22222222-2222-4222-8222-222222222222',linkedId='33333333-3333-4333-8333-333333333333',linkedSource='44444444-4444-4444-8444-444444444444',owner='synthetic-project-links-owner',now='2026-10-24T00:00:00.000Z';
const pin:ProjectLink={type:'todo',id:linkedId,sourceId:linkedSource,revision:1};
const fields:RecordFields={title:'Synthetic project links',text:'Synthetic body',occurredOn:null,record:{type:'project',syntheticOnly:true,stage:'active',nextStep:null,completion:{selfReported:true,status:'not-complete',evidence:null},testing:{manuallyRecorded:true,outcome:'not-run',evidence:null},review:{decision:'pending',evidence:null}}};
function entry(links?:ProjectLink[]):RecordEntry{const value=structuredClone(fields);if(value.record.type==='project'&&links!==undefined)value.record.links=structuredClone(links);return {id,kind:'inbox',draft:{...value,disposition:'reference'},source:{id:sourceId,system:'website',externalId:id,version:1,asOf:now,original:{...structuredClone(value),disposition:'reference'}},revision:1,createdAt:now,updatedAt:now,syncState:'draft',externalStatus:null};}
function candidate(link:ProjectLink=pin):ProjectLinkCandidate{return {link:structuredClone(link),title:'Synthetic linked task',summary:'Synthetic source summary',updatedAt:now};}
function recap():ProjectRecapResponse{return {project:entry([pin]),links:[{link:pin,status:'current',current:candidate()}],counts:{total:1,current:1,updated:0,unavailable:0,todo:1,resource:0,article:0},reviewApplicable:false,reviewApplicability:'pending',observedAt:now,readOnly:true,aiGenerated:false,snapshotConsistency:'owner-snapshot',freshness:'refresh-to-check',dataStatus:'isolated-test-drafts',syntheticIncluded:true};}
function setup(read:()=>Response=()=>Response.json({items:[candidate()],limit:50,truncated:false,observedAt:now,dataStatus:'isolated-test-drafts',syntheticIncluded:true})){
 let identity:string|null=owner;const calls:string[]=[];const client=new RecordsClient(async(input)=>{if(String(input).endsWith('/auth/get-session'))return Response.json(identity?{user:{id:identity},session:{userId:identity}}:null);calls.push(String(input));return read();});return {client,calls,changeOwner(value:string|null){identity=value;}};
}

test('legacy and linked project rows validate without rewriting original missing-link evidence',()=>{
 const legacy=entry(),original=JSON.stringify(legacy.source.original);assert.doesNotThrow(()=>parseRecordEntry(legacy,'project'));const parsed=parseRecordEntry(legacy,'project');assert.equal(JSON.stringify(parsed.source.original),original);assert.equal(Object.hasOwn(parsed.draft.record,'links'),false);
 assert.doesNotThrow(()=>parseRecordEntry(entry([]),'project'));assert.deepEqual(parseRecordEntry(entry([pin]),'project').draft.record,entry([pin]).draft.record);
});

test('link editor round trips exact pins and a retained legacy command keeps its original bytes',()=>{
 const form=fieldsToForm(entry([pin]).draft);assert.deepEqual(form.links,[pin]);form.links[0].revision=2;const result=formToFields(form);if(result.record.type==='project')assert.deepEqual(result.record.links,[{...pin,revision:2}]);
 const command=createRecordCommand(fields,null,'links-legacy-command',true,owner),body=command.body,data=new Map<string,string>(),store=createRecordsCommandStore({getItem:key=>data.get(key)??null,setItem:(key,value)=>{data.set(key,value);},removeItem:key=>{data.delete(key);}});store.keep(command);const restored=new RecordsSaveSession(setup().client,undefined,store);assert.equal(restored.getSnapshot().pending?.body,body);assert.equal(inspectRecordCommand(store.load()).command.body,body);assert.equal(Object.hasOwn(JSON.parse(body).record,'links'),false);
});

test('candidate reads require same owner before and after and send explicit synthetic scope',async()=>{
 const h=setup();assert.deepEqual((await h.client.projectCandidates('todo','Synthetic',owner)).items,[candidate()]);assert.equal(h.calls[0],'/api/platform/records/project-links?type=todo&q=Synthetic&includeSynthetic=true');
 h.changeOwner('another-owner');await assert.rejects(()=>h.client.projectCandidates('todo','Synthetic',owner),cause=>cause instanceof RecordRequestError&&cause.code==='ACCOUNT_CHANGED');assert.equal(h.calls.length,1);
 const changed=setup(()=>{changed.changeOwner('another-owner');return Response.json({items:[candidate()],limit:50,truncated:false,observedAt:now,dataStatus:'isolated-test-drafts',syntheticIncluded:true});});await assert.rejects(()=>changed.client.projectCandidates('todo','',owner),RecordRequestError);
});

test('candidate responses reject foreign types, malformed pins, unexpected fields and private owner metadata',async()=>{
 for(const item of [{...candidate(),link:{...pin,type:'article'}},{...candidate(),link:{...pin,revision:0}},{...candidate(),ownerId:'private'},{...candidate(),link:{...pin,title:'copied title'}}])await assert.rejects(()=>setup(()=>Response.json({items:[item],limit:50,truncated:false,observedAt:now,dataStatus:'isolated-test-drafts',syntheticIncluded:true})).client.projectCandidates('todo','',owner),RecordRequestError);
});

test('recap binds each current fact to the saved pin and verifies counts and review applicability',async()=>{
 const valid=recap();assert.deepEqual(await setup(()=>Response.json(valid)).client.projectRecap(id,owner),valid);
 const mismatch=recap();mismatch.links[0].current!.link.sourceId=sourceId;
 for(const value of [mismatch,{...recap(),counts:{...recap().counts,total:2}},{...recap(),reviewApplicable:true},{...recap(),project:{...entry([pin]),id:linkedId}},{...recap(),links:[{link:pin,status:'unavailable',current:candidate()}]}])await assert.rejects(()=>setup(()=>Response.json(value)).client.projectRecap(id,owner),RecordRequestError);
 const unavailable=recap();unavailable.links=[{link:pin,status:'unavailable',current:null}];unavailable.counts={...unavailable.counts,current:0,unavailable:1};assert.equal((await setup(()=>Response.json(unavailable)).client.projectRecap(id,owner)).links[0].current,null);
});

test('explicit selection stores only unique pins, removal drops only selected link, refresh preserves source identity',async()=>{
 const {addProjectLink,removeProjectLink,refreshProjectLink}=await import('../src/records-workbench/project-links.ts');
 assert.deepEqual(addProjectLink([],pin),[pin]);assert.throws(()=>addProjectLink([pin],pin));assert.deepEqual(removeProjectLink([pin],pin),[]);
 const updated={...pin,revision:2};assert.deepEqual(refreshProjectLink([pin],pin,updated),[updated]);assert.throws(()=>refreshProjectLink([pin],pin,{...updated,sourceId}));assert.throws(()=>refreshProjectLink([updated],pin,{...pin,revision:3}));
});

test('legacy readback permits normalized empty pins but preserves immutable original evidence',async()=>{
 const {assertRecordReadback}=await import('../src/records-workbench/read-state.ts'),legacy=entry(),normalized=structuredClone(legacy);if(normalized.draft.record.type==='project')normalized.draft.record.links=[];
 assert.doesNotThrow(()=>assertRecordReadback(legacy,normalized));assert.equal(Object.hasOwn(legacy.draft.record,'links'),false);const changed=structuredClone(normalized);const original=changed.source.original as RecordFields;if(original.record.type==='project')original.record.links=[];assert.throws(()=>assertRecordReadback(legacy,changed));
});

test('known link prewrite refusal releases editing; unknown conflict and late refusal preserve exact frozen command',async()=>{
 for(const [status,code] of [[409,'PROJECT_LINK_UNAVAILABLE'],[400,'INVALID_PROJECT_LINK']] as const){const h=setup(()=>Response.json({error:{code,message:'safe'}},{status})),session=new RecordsSaveSession(h.client,()=> 'links-rejected-command');await session.save(formToFields(fieldsToForm(entry([pin]).draft)),null,true);assert.equal(session.getSnapshot().phase,'rejected');assert.equal(session.getSnapshot().pending,null);assert.match(session.getSnapshot().error!.message,/关联/);assert.doesNotThrow(()=>session.reset());}
 let response=Response.json({error:{code:'UNKNOWN_CONFLICT',message:'safe'}},{status:409});const h=setup(()=>response),session=new RecordsSaveSession(h.client,()=> 'links-uncertain-command');await session.save(formToFields(fieldsToForm(entry([pin]).draft)),null,true);assert.equal(session.getSnapshot().phase,'uncertain');const frozen=session.getSnapshot().pending;response=Response.json({error:{code:'PROJECT_LINK_UNAVAILABLE',message:'safe'}},{status:409});await session.retry();assert.equal(session.getSnapshot().phase,'uncertain');assert.equal(session.getSnapshot().pending,frozen);
});

test('source detail requires the pinned source and type, reconfirms owner on failures, and preserves current/original/history',async()=>{
 const document={id:pin.id,kind:'todo',type:'todo',title:'Synthetic source body',date:null,sourceId:pin.sourceId,sourceSystem:'website',snippet:'Synthetic body',revision:2,fields:[{label:'正文',value:'Synthetic full body'}]},value={current:document,original:{...document,revision:1,title:'Synthetic original'},history:[document],historyLimit:20,historyTruncated:false,dataStatus:'isolated-test-drafts',syntheticIncluded:true};
 const h=setup(()=>Response.json(value)),result=await h.client.projectSource(pin,owner);assert.equal(result.current.revision,2);assert.equal(result.original.title,'Synthetic original');assert.deepEqual(result.history,[document]);assert.equal(h.calls[0],'/api/platform/search/source/todo/'+pin.id+'?includeSynthetic=true');
 for(const documentChange of [{sourceId},{type:'article'}]){const bad={...value,current:{...document,...documentChange},original:{...document,...documentChange},history:[]};await assert.rejects(()=>setup(()=>Response.json(bad)).client.projectSource(pin,owner),cause=>cause instanceof RecordRequestError&&cause.status===404&&cause.code==='NOT_FOUND');}
 const changed=setup(()=>{changed.changeOwner('other-account');return Response.json({error:{code:'NOT_FOUND',message:'safe'}},{status:404});});await assert.rejects(()=>changed.client.projectSource(pin,owner),cause=>cause instanceof RecordRequestError&&cause.code==='ACCOUNT_CHANGED');
 let sourceRead=false;const unavailable=new RecordsClient(async input=>String(input).endsWith('/auth/get-session')?(sourceRead?Response.json({error:{code:'DOWN',message:'safe'}},{status:503}):Response.json({user:{id:owner},session:{userId:owner}})):(sourceRead=true,Response.json(value)));await assert.rejects(()=>unavailable.projectSource(pin,owner),cause=>cause instanceof RecordRequestError&&cause.code==='IDENTITY_UNAVAILABLE');
});
