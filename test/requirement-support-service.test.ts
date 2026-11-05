import test from 'node:test';
import assert from 'node:assert/strict';
import {RequirementSupportService} from '../src/requirement-support-candidate/service.ts';
import {RequirementsService} from '../src/requirements-candidate/service.ts';
import {requirements} from '../src/platform/requirements.ts';
import {MemoryPort} from './helpers/platform.ts';
const config={ownerId:'support-owner',ownerEmail:'support@example.test',spaceId:'support-space',databaseName:'fixture',baseURL:'https://support.example.test',approval:'personal-manual-v1',allowedTypes:['todo','journal'],requirementsEnabled:true,requirementSupportEnabled:true} as const;
const fields={title:'Explicitly reviewed private requirement',body:'Reviewed scope',phaseId:requirements().roadmap!.phases[0].id,priority:'P2',plannedStartOn:null,plannedEndOn:null} as const;
function setup(){
 const repository=new MemoryPort(),native=repository.transaction.bind(repository);
 repository.transaction=(owner,key,fn)=>native(owner,key,tx=>fn({...tx,lockRecordIdentity:async()=>{}}));
 repository.readCurrentSnapshot=async owner=>structuredClone([...repository.rows.values()].filter(r=>r.ownerId===owner));
 const req=new RequirementsService(repository,config),service=new RequirementSupportService(repository,config,req,{currentSourceSha:()=> 'a'.repeat(40)});
 return{repository,req,service};
}
const input={spaceId:config.spaceId,confirmed:true,fields:{text:'  私有原文\n保留所有空格  ',sourceLabel:'本人网页'}};
test('feedback persists original text and source without becoming an approved requirement',async()=>{
 const {repository,service,req}=setup(),created=await service.createFeedback(config.ownerId,input,'support-feedback-create');
 assert.equal(created.entry.text,input.fields.text);assert.equal(created.entry.state,'inbox');assert.equal(created.entry.source.channel,'owner-web');
 const restarted=new RequirementSupportService(repository,config,req);assert.equal((await restarted.feedback(config.ownerId,created.entry.id)).text,input.fields.text);
 assert.equal((await service.snapshot(config.ownerId)).total,1);assert.equal((await req.snapshot(config.ownerId)).total,34);
 assert.equal(JSON.stringify(created).includes('ownerId'),false);
 await assert.rejects(service.feedback('foreign-owner',created.entry.id),{code:'OWNER_ONLY'});
});
test('explicit conversion is one atomic receipt and exposes reciprocal links without changing public acceptance',async()=>{
 const {repository,service,req}=setup(),created=await service.createFeedback(config.ownerId,input,'support-convert-input');
 const command={spaceId:config.spaceId,confirmed:true,expectedRevision:1,action:'convert',fields};
 const converted=await service.reviewFeedback(config.ownerId,created.entry.id,command,'support-convert-1');assert.equal(converted.entry.state,'converted');assert.equal(converted.entry.revision,2);
 const target=converted.entry.references[0];assert.ok(target);const requirement=await req.get(config.ownerId,target.id);assert.deepEqual(requirement.fields,fields);assert.equal(requirement.requirement.status,'not_started');assert.equal(requirement.requirement.acceptance,undefined);
 assert.equal((await service.forRequirement(config.ownerId,target.id)).items[0].id,created.entry.id);
 assert.equal((await service.reviewFeedback(config.ownerId,created.entry.id,command,'support-convert-1')).duplicate,true);
 await assert.rejects(service.reviewFeedback(config.ownerId,created.entry.id,command,'support-convert-other-key'),{code:'REVISION_CONFLICT'});
 assert.equal(repository.rows.size,2);assert.equal((await service.feedback(config.ownerId,created.entry.id)).text,input.fields.text);
});
test('late revocation during conversion rolls back requirement, feedback and receipt',async()=>{
 const {repository,service}=setup(),created=await service.createFeedback(config.ownerId,input,'support-rollback-input');let checks=0;
 await assert.rejects(service.reviewFeedback(config.ownerId,created.entry.id,{spaceId:config.spaceId,confirmed:true,expectedRevision:1,action:'convert',fields},'support-rollback-convert',async()=>{if(++checks===4)throw Error('session revoked');}));
 assert.equal(repository.rows.size,1);assert.equal(repository.historyRows.length,1);assert.equal((await service.feedback(config.ownerId,created.entry.id)).state,'inbox');
});
test('link checks exact current target pins; archive retains original links and text',async()=>{
 const {service,req}=setup(),created=await service.createFeedback(config.ownerId,input,'support-link-input');
 const target=await req.mutate(config.ownerId,null,{spaceId:config.spaceId,confirmed:true,fields},'support-link-requirement');
 const reference={id:target.entry.id,revision:target.entry.revision,sourceId:target.entry.sourceId,baselineBinding:target.entry.baselineBinding};
 const command={spaceId:config.spaceId,confirmed:true,expectedRevision:1,action:'link',reference};
 await assert.rejects(service.reviewFeedback(config.ownerId,created.entry.id,{...command,reference:{...reference,revision:2}},'support-link-stale'),{code:'REFERENCE_CONFLICT'});
 const linked=await service.reviewFeedback(config.ownerId,created.entry.id,command,'support-link-current');assert.equal(linked.entry.state,'linked');
 const archived=await service.reviewFeedback(config.ownerId,created.entry.id,{spaceId:config.spaceId,confirmed:true,expectedRevision:2,action:'archive'},'support-archive');assert.equal(archived.entry.state,'archived');assert.deepEqual(archived.entry.references,[reference]);assert.equal(archived.entry.text,input.fields.text);
 assert.equal((await service.forRequirement(config.ownerId,reference.id)).items[0].state,'archived');
});
test('version-read is durable per owner/space/source and never an acceptance claim',async()=>{
 const {repository,service,req}=setup(),sourceSha='a'.repeat(40);
 assert.equal((await service.releaseRead(config.ownerId,sourceSha)).seen,false);
 await service.markReleaseRead(config.ownerId,{spaceId:config.spaceId,confirmed:true,sourceSha},'support-read-version');
 const restarted=new RequirementSupportService(repository,config,req,{currentSourceSha:()=>sourceSha});assert.equal((await restarted.releaseRead(config.ownerId,sourceSha)).seen,true);assert.equal((await restarted.snapshot(config.ownerId)).total,0);
 await assert.rejects(service.markReleaseRead(config.ownerId,{spaceId:config.spaceId,confirmed:true,sourceSha:'b'.repeat(40)},'support-read-not-running'),{code:'CURRENT_RELEASE_CHANGED'});
 const otherConfig={...config,spaceId:'another-support-space'},other=new RequirementSupportService(repository,otherConfig,new RequirementsService(repository,otherConfig),{currentSourceSha:()=>sourceSha});assert.equal((await other.releaseRead(config.ownerId,sourceSha)).seen,false);
 assert.equal(JSON.stringify(await restarted.releaseRead(config.ownerId,sourceSha)).includes('accepted'),false);
});
test('lost committed conversion replays the same historical receipt; competing commands cannot create a second requirement',async()=>{
 const {repository,service}=setup(),created=await service.createFeedback(config.ownerId,input,'support-race-input'),native=repository.transaction.bind(repository);let lose=true;
 repository.transaction=async(owner,key,fn)=>{const result=await native(owner,key,fn);if(lose){lose=false;throw Error('synthetic response lost after commit');}return result;};
 const command={spaceId:config.spaceId,confirmed:true,expectedRevision:1,action:'convert',fields};
 await assert.rejects(service.reviewFeedback(config.ownerId,created.entry.id,command,'support-lost-convert'));
 const repeated=await service.reviewFeedback(config.ownerId,created.entry.id,command,'support-lost-convert');assert.equal(repeated.duplicate,true);assert.equal(repeated.entry.revision,2);assert.equal(repository.rows.size,2);
 await assert.rejects(service.reviewFeedback(config.ownerId,created.entry.id,{...command,fields:{...fields,title:'Different'}},'support-lost-convert'),{code:'COMMAND_CONFLICT'});
 const next=await service.createFeedback(config.ownerId,input,'support-race-input-2');const results=await Promise.allSettled(['a','b'].map(k=>service.reviewFeedback(config.ownerId,next.entry.id,command,'support-race-convert-'+k)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(repository.rows.size,4);
});
test('closed modules, wrong spaces, corrupted snapshots and missing histories never fabricate empty success',async()=>{
 const {repository,service,req}=setup(),created=await service.createFeedback(config.ownerId,input,'support-corrupt-input');
 const disabled=new RequirementSupportService(repository,{...config,requirementSupportEnabled:undefined},req);await assert.rejects(disabled.snapshot(config.ownerId),{code:'REQUIREMENT_SUPPORT_DISABLED'});
 assert.throws(()=>new RequirementSupportService(repository,{...config,spaceId:'wrong-space'},req),{code:'SUPPORT_CONFIG_UNAVAILABLE'});
 const row=repository.rows.get(created.entry.id)!;const saved=structuredClone(row.source.original);row.source.original={...(row.source.original as object),accepted:true};await assert.rejects(service.snapshot(config.ownerId),{code:'SUPPORT_SNAPSHOT_UNAVAILABLE'});row.source.original=saved;
 assert.equal((await service.history(config.ownerId,created.entry.id)).items.length,1);repository.historyRows=[];await assert.rejects(service.history(config.ownerId,created.entry.id),{code:'SUPPORT_HISTORY_UNAVAILABLE'});
});
