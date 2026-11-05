import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryPort} from './helpers/platform.ts';
import {PersonalService,personalEntryType} from '../src/personal-candidate/service.ts';
import {readPersonalConfig,type PersonalConfig,type PersonalType} from '../src/personal-candidate/config.ts';
import {personalPermitBinding,createPersonalPlatformHandler} from '../src/personal-candidate/runtime-http.ts';
import {emptyMediaPersonal} from '../src/personal-media/domain.ts';
import {emptyCareerPersonal} from '../src/personal-career/domain.ts';
import {emptyPortfolioPersonal} from '../src/personal-portfolio/model.ts';

const config={ownerId:'synthetic-three-owner',ownerEmail:'three@example.test',spaceId:'synthetic-three-space',databaseName:'lifeos_platform_test_local',allowedTypes:['todo','journal','project','domain','topic'],approval:'personal-manual-v1',baseURL:'https://three.example.test',mediaEnabled:true,careerEnabled:true,portfolioEnabled:true} as const;
const fields=(personal:unknown)=>({title:'Synthetic record',text:'Explicit synthetic source text',occurredOn:null,personal});
const body=(personal:unknown)=>({spaceId:config.spaceId,confirmed:true,fields:fields(personal)});
const snapshot=(repo:MemoryPort)=>structuredClone({rows:repo.rows,history:repo.historyRows,receipts:repo.receipts});
function setup(delta:Record<string,unknown>={}){const repo=new MemoryPort();repo.readCurrentSnapshot=async owner=>structuredClone([...repo.rows.values()].filter(row=>row.ownerId===owner));const service=new PersonalService(repo,{...config,...delta} as PersonalConfig);const save=async(type:string,personal:unknown,key=crypto.randomUUID())=>(await service.mutate(config.ownerId,type as PersonalType,null,body(personal),key)).entry;return{repo,service,save};}
const pin=(entry:Awaited<ReturnType<PersonalService['get']>>)=>({id:entry.id,sourceId:entry.source.id,revision:entry.revision});

test('three module flags remain separate, invalid flags reject, and permits bind only enabled modules',()=>{
 const platform={ownerId:config.ownerId,ownerEmail:config.ownerEmail,baseURL:config.baseURL,databaseURL:'postgresql://lifeos_platform_candidate_runtime:synthetic-only@127.0.0.1:55432/lifeos_platform_test_local'};
 const env={LIFEOS_PERSONAL_ENABLED:'1',LIFEOS_PERSONAL_APPROVED:'personal-manual-v1',LIFEOS_PERSONAL_OWNER_ID:config.ownerId,LIFEOS_PERSONAL_OWNER_EMAIL:config.ownerEmail,LIFEOS_PERSONAL_SPACE_ID:config.spaceId,LIFEOS_PERSONAL_DATABASE_NAME:config.databaseName,LIFEOS_PERSONAL_B_CANDIDATE:'project-domain-v1',LIFEOS_PERSONAL_ALLOWED_TYPES:'todo,journal,project,domain,topic'};
 const closed=readPersonalConfig(env,platform)!;
 for(const [name,flag,version] of [['media','mediaEnabled','personal-media-v1'],['career','careerEnabled','personal-career-v1'],['portfolio','portfolioEnabled','personal-portfolio-v1']] as const){
  const key='LIFEOS_PERSONAL_'+name.toUpperCase(),enabled=readPersonalConfig({...env,[key]:version},platform)!;
  assert.equal((closed as Record<string,unknown>)[flag],undefined);assert.equal((enabled as Record<string,unknown>)[flag],true);assert.deepEqual(enabled.allowedTypes,['todo','journal','project','domain','topic']);
  for(const value of ['1','',version+'-extra'])assert.throws(()=>readPersonalConfig({...env,[key]:value},platform));
  const legacy=personalPermitBinding(closed,'a'.repeat(40)),explicitOff=personalPermitBinding({...closed,[flag]:undefined},'a'.repeat(40));assert.deepEqual(explicitOff,legacy);assert.notEqual(personalPermitBinding(enabled,'a'.repeat(40)).configDigest,legacy.configDigest);
 }
});
test('native three-business writer persists all typed records, CAS and receipts with full snapshot and complete record history',async()=>{
 const {repo,service,save}=setup();
 for(const [type,personal] of [['media',emptyMediaPersonal()],['career',emptyCareerPersonal('education')],['portfolio',emptyPortfolioPersonal('account')]] as const){
  const first=await save(type,personal,'synthetic-create-'+type);assert.equal(personalEntryType(first,config.spaceId),type);assert.equal(repo.rows.get(first.id)!.kind,'inbox');assert.equal((first.source.original as {marker:string}).marker,'personal-manual-v1');
  const replay=await service.mutate(config.ownerId,type as PersonalType,null,body(personal),'synthetic-create-'+type);assert.equal(replay.duplicate,true);assert.equal(replay.entry.id,first.id);
  const edited=await service.mutate(config.ownerId,type as PersonalType,first.id,{...body(personal),fields:{...fields(personal),text:'Revised source text'},expectedRevision:1},'synthetic-update-'+type);assert.equal(edited.entry.revision,2);assert.deepEqual(edited.entry.source,first.source);
  assert.equal((await service.get(config.ownerId,type as PersonalType,first.id)).revision,2);assert.deepEqual((await service.history(config.ownerId,type as PersonalType,first.id)).items.map(row=>row.revision),[2,1]);
  const before=snapshot(repo);await assert.rejects(service.mutate(config.ownerId,type as PersonalType,first.id,{...body(personal),expectedRevision:1},'synthetic-stale-'+type),{code:'REVISION_CONFLICT'});assert.deepEqual(snapshot(repo),before);
  await assert.rejects(service.get('other-owner',type as PersonalType,first.id),{code:'OWNER_ONLY'});
  const closed=new PersonalService(repo,{...config,mediaEnabled:undefined,careerEnabled:undefined,portfolioEnabled:undefined} as PersonalConfig);await assert.rejects(closed.get(config.ownerId,type as PersonalType,first.id),{code:'PERSONAL_TYPE_DENIED'});
 }
 const oldest=[...repo.rows.values()][0];for(let i=0;i<60;i++)await save('media',{...emptyMediaPersonal('film'),state:'wish'},'synthetic-over-window-'+i);
 assert.equal((await service.currentSnapshot(config.ownerId)).length,63);assert.deepEqual((await service.history(config.ownerId,'media' as PersonalType,oldest.id)).items.map(row=>row.revision),[2,1]);
});
test('career facts accept only locked education employment or achievement targets; subtype source revision and owner failures roll back',async()=>{
 const {repo,service,save}=setup(),facts=[];
 for(const kind of ['education','employment','achievement'] as const)facts.push(await save('career',emptyCareerPersonal(kind)));
 const resume=await save('career',{...emptyCareerPersonal('resume'),facts:facts.map(pin)});assert.equal(personalEntryType(resume,config.spaceId),'career');
 const opportunity=await save('career',emptyCareerPersonal('opportunity'));
 const invalidTargets=[resume,opportunity];
 for(const target of invalidTargets){const before=snapshot(repo);await assert.rejects(save('career',{...emptyCareerPersonal('resume'),facts:[pin(target)]}),{code:'REFERENCE_CONFLICT'});await assert.rejects(save('career',{...emptyCareerPersonal('opportunity'),requirements:[{requirement:'Synthetic requirement',facts:[pin(target)],gap:null,nextAction:null}]}),{code:'REFERENCE_CONFLICT'});await assert.rejects(save('career',{...emptyCareerPersonal('achievement'),evidence:[{label:'Synthetic evidence',url:null,reference:{type:'career',link:pin(target)}}]}),{code:'REFERENCE_CONFLICT'});assert.deepEqual(snapshot(repo),before);}
 const fact=facts[0],reference=pin(fact);
 for(const bad of [{...reference,sourceId:'00000000-0000-4000-8000-000000000001'},{...reference,revision:2}]){const before=snapshot(repo);await assert.rejects(save('career',{...emptyCareerPersonal('resume'),facts:[bad]}),{code:'REFERENCE_CONFLICT'});assert.deepEqual(snapshot(repo),before);}
 const original=repo.rows.get(fact.id)!;repo.rows.set(fact.id,{...original,ownerId:'other-owner'});const before=snapshot(repo);await assert.rejects(save('career',{...emptyCareerPersonal('resume'),facts:[reference]}),{code:'REFERENCE_CONFLICT'});assert.deepEqual(snapshot(repo),before);repo.rows.set(fact.id,original);
 await service.mutate(config.ownerId,'career' as PersonalType,fact.id,{...body(emptyCareerPersonal('education')),expectedRevision:1},'synthetic-fact-revised');await assert.rejects(save('career',{...emptyCareerPersonal('resume'),facts:[reference]}),{code:'REFERENCE_CONFLICT'});
 await assert.rejects(save('career',{...emptyCareerPersonal('resume'),facts:[{...pin(facts[1]),expectedKinds:['resume']}]}));
});
test('portfolio account and asset references have server-derived subtype constraints in the shared locked transaction',async()=>{
 const {repo,save}=setup(),account=await save('portfolio',emptyPortfolioPersonal('account')),asset=await save('portfolio',{...emptyPortfolioPersonal('asset'),account:pin(account)});
 const investment=await save('portfolio',{...emptyPortfolioPersonal('investment'),account:pin(account),asset:pin(asset)});assert.equal(personalEntryType(investment,config.spaceId),'portfolio');
 for(const personal of [{...emptyPortfolioPersonal('asset'),account:pin(asset)},{...emptyPortfolioPersonal('investment'),account:pin(asset),asset:null},{...emptyPortfolioPersonal('investment'),account:null,asset:pin(account)}]){const before=snapshot(repo);await assert.rejects(save('portfolio',personal),{code:'REFERENCE_CONFLICT'});assert.deepEqual(snapshot(repo),before);}
 const before=snapshot(repo);await assert.rejects(save('portfolio',{...emptyPortfolioPersonal('asset'),account:{...pin(asset),expectedKinds:['asset']}}));assert.deepEqual(snapshot(repo),before);
});
test('owner three-business routes recheck sessions after reads and require verified storage and independent module gates',async()=>{
 const {repo,save}=setup(),entry=await save('media',emptyMediaPersonal());let active=true;
 const sessions={read:async()=>active?{userId:config.ownerId,email:config.ownerEmail}:null};
 const make=(delta:Record<string,unknown>={},storageVerified=true)=>createPersonalPlatformHandler({repository:repo,sessions,config:{...config,...delta} as PersonalConfig,storageVerified,assertWritable:async()=>{}});
 const request=(path:string)=>new Request(config.baseURL+'/api/platform/personal/'+path,{headers:{host:'three.example.test'}});
 for(const type of ['media','career','portfolio'])assert.equal((await make() (request(type+'/snapshot'))).status,200);
 assert.equal((await make() (request('media/'+entry.id+'/history'))).status,200);
 const status=await (await make({},false)(request('status'))).json();assert.equal(status.mediaEnabled,false);assert.equal(status.careerEnabled,false);assert.equal(status.portfolioEnabled,false);
 assert.equal((await make({},false)(request('media/snapshot'))).status,503);assert.equal((await make({mediaEnabled:undefined})(request('media/snapshot'))).status,404);
 const native=repo.readCurrentSnapshot!;repo.readCurrentSnapshot=async owner=>{const rows=await native(owner);active=false;return rows;};assert.equal((await make()(request('media/snapshot'))).status,401);
});

test('owner HTTP create update snapshot and history reuse the shared service for all three modules',async()=>{
 const {repo}=setup();const handler=createPersonalPlatformHandler({repository:repo,sessions:{read:async()=>({userId:config.ownerId,email:config.ownerEmail})},config,storageVerified:true,assertWritable:async()=>{}});
 const send=async(path:string,method='GET',input?:unknown)=>{const response=await handler(new Request(config.baseURL+'/api/platform/personal/'+path,{method,headers:{host:'three.example.test',origin:config.baseURL,'content-type':'application/json','idempotency-key':crypto.randomUUID()},...(input?{body:JSON.stringify(input)}:{})}));return{status:response.status,body:await response.json()};};
 for(const [type,personal] of [['media',emptyMediaPersonal()],['career',emptyCareerPersonal('achievement')],['portfolio',emptyPortfolioPersonal('asset')]] as const){
  const created=await send(type,'POST',body(personal));assert.equal(created.status,201,type);const id=created.body.entry.id;
  const updated=await send(type+'/'+id,'PATCH',{...body(personal),expectedRevision:1});assert.equal(updated.status,200,type);assert.equal(updated.body.entry.revision,2);
  assert.equal((await send(type+'/'+id)).body.entry.revision,2);assert.deepEqual((await send(type+'/'+id+'/history')).body.items.map((row:{revision:number})=>row.revision),[2,1]);assert.equal((await send(type+'/snapshot')).body.total,1);
 }
});
test('new reference adapters preserve native organization pins and reject wrong owner space source or stale portfolio pins atomically',async()=>{
 const {repo,service,save}=setup(),project=await save('project',{type:'project',stage:'active',purpose:null,nextStep:'',domain:null,topics:[]});
 await save('media',{...emptyMediaPersonal(),links:{project:pin(project),domain:null,topics:[]}});
 const account=await save('portfolio',emptyPortfolioPersonal('account')),reference=pin(account);
 const native=repo.rows.get(account.id)!;repo.rows.set(account.id,{...native,source:{...native.source,original:{...(native.source.original as object),spaceId:'foreign-space'}}});
 const before=snapshot(repo);await assert.rejects(save('portfolio',{...emptyPortfolioPersonal('asset'),account:reference}),{code:'REFERENCE_CONFLICT'});assert.deepEqual(snapshot(repo),before);repo.rows.set(account.id,native);
 await service.mutate(config.ownerId,'portfolio',account.id,{...body(emptyPortfolioPersonal('account')),expectedRevision:1},'synthetic-account-revised');
 const revised=snapshot(repo);await assert.rejects(save('portfolio',{...emptyPortfolioPersonal('asset'),account:reference}),{code:'REFERENCE_CONFLICT'});assert.deepEqual(snapshot(repo),revised);
});
test('unverified storage hides all three new business types from owner aggregates while preserving legacy records',async t=>{
 const {repo,service,save}=setup(),newEntries:Awaited<ReturnType<PersonalService['get']>>[]=[];
 for(const [type,personal]of [['media',emptyMediaPersonal()],['career',emptyCareerPersonal()],['portfolio',emptyPortfolioPersonal('account')]] as const)newEntries.push(await save(type,personal));
 const legacy=(await service.mutate(config.ownerId,'journal',null,{spaceId:config.spaceId,confirmed:true,fields:{title:'Synthetic legacy',text:'Synthetic legacy journal',occurredOn:null}},'synthetic-legacy-aggregate')).entry;
 const make=(storageVerified:boolean)=>createPersonalPlatformHandler({repository:repo,sessions:{read:async()=>({userId:config.ownerId,email:config.ownerEmail})},config,storageVerified,assertWritable:async()=>{}});
 const send=async(storageVerified:boolean,path:string)=>{const response=await make(storageVerified)(new Request(config.baseURL+'/api/platform/personal/'+path,{headers:{host:'three.example.test'}}));return{status:response.status,body:await response.json()};};
 const status=await send(false,'status');for(const flag of ['mediaEnabled','careerEnabled','portfolioEnabled'])assert.equal(status.body[flag],false);
 for(const type of ['media','career','portfolio'])assert.equal((await send(false,type+'/snapshot')).status,503);
 for(const path of ['overview?today=2030-11-05','search?q=Synthetic','export'])await t.test(path,async()=>{
  const closed=await send(false,path);assert.equal(closed.status,200,path);
  const items=path==='export'?closed.body.entries:closed.body.items;assert.deepEqual(items.map((entry:{id:string})=>entry.id),[legacy.id],path);
  if(path==='export')assert.deepEqual(closed.body.history.map((entry:{id:string})=>entry.id),[legacy.id]);
  const text=JSON.stringify(closed.body);for(const entry of newEntries)assert.equal(text.includes(entry.id),false,path);
  const ready=await send(true,path);assert.equal(ready.status,200);assert.equal((path==='export'?ready.body.entries:ready.body.items).length,4,path);
 });
 const ready=await send(true,'status');for(const flag of ['mediaEnabled','careerEnabled','portfolioEnabled'])assert.equal(ready.body[flag],true);
});
