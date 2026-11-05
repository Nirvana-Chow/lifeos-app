import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHmac} from 'node:crypto';
import {prepareRequirementsFixture,requirementsFixture as fixture,requirementsFixturePool,requirementsManagerURL} from './helpers/requirements-stage-pg.ts';
import {PostgresPlatformRepository,verifyRestrictedPool,type SqlPool} from '../src/platform/postgres.ts';
import {PersonalService} from '../src/personal-candidate/service.ts';
import {requirementBinding,requirementIdentity} from '../src/requirements-candidate/service.ts';
import {requirements} from '../src/platform/requirements.ts';
import {verifyAgentRequirementsReadiness} from '../src/agent-api/runtime.ts';
import {createPostgresKeyIssuer,readKeyIssuerConfig} from '../src/agent-api/key-issuer.ts';
import {assertAgentGrant} from '../src/agent-api/grant-fence.ts';

test('OPT-IN independent native requirements schema2 persistence and grants',{skip:process.env.RUN_REQUIREMENTS_POSTGRES_TESTS!=='1'&&'No separately declared requirements fixture55452',timeout:90000},async t=>{
 await prepareRequirementsFixture();const admin=requirementsFixturePool('admin'),business=requirementsFixturePool('runtime',3),manager=requirementsFixturePool('manager');
 const config={ownerId:fixture.ownerId,ownerEmail:fixture.email,spaceId:fixture.spaceId,databaseName:fixture.database,baseURL:fixture.origin,approval:'personal-manual-v1',allowedTypes:['todo','journal','project','domain','topic'],requirementsEnabled:true} as const;
 const repo=new PostgresPlatformRepository(business as SqlPool,true,true,{organization:true,classification:false,requirements:true}),service=new PersonalService(repo,config).requirements,fields={title:'Synthetic PostgreSQL requirement',body:'长'.repeat(16384),phaseId:requirements().roadmap!.phases[0].id,priority:'P3',plannedStartOn:null,plannedEndOn:null} as const;
 const body={spaceId:fixture.spaceId,confirmed:true,fields};
 try{
  await verifyRestrictedPool(business as SqlPool);await verifyAgentRequirementsReadiness(business);
  await t.test('concurrent first overlays lock one deterministic identity and second different key sees CAS conflict',async()=>{
   const id=requirements().requirements[0].id,command={...body,expectedRevision:0,baselineBinding:requirementBinding(requirements(),id)};
   const outcomes=await Promise.allSettled([service.mutate(fixture.ownerId,id,command,randomUUID()),service.mutate(fixture.ownerId,id,command,randomUUID())]);
   assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal((outcomes.find(r=>r.status==='rejected') as PromiseRejectedResult).reason.code,'REVISION_CONFLICT');
   const counts=(await admin.query('SELECT count(*)::int AS records,(SELECT count(*)::int FROM lifeos_platform.platform_history WHERE record_id=$1) AS history FROM lifeos_platform.platform_record WHERE id=$1',[requirementIdentity(fixture.ownerId,fixture.spaceId,id)])).rows[0];assert.deepEqual(counts,{records:1,history:1});
  });
  await t.test('create restart readback update history and lost committed response recover exact command',async()=>{
   const key=randomUUID(),original=repo.transaction.bind(repo);let lost=true;
   repo.transaction=async(owner,key,fn)=>{const value=await original(owner,key,fn);if(lost){lost=false;throw Error('synthetic lost committed response');}return value;};
   await assert.rejects(service.mutate(fixture.ownerId,null,body,key));const replay=await service.mutate(fixture.ownerId,null,body,key);assert.equal(replay.duplicate,true);repo.transaction=original;
   const reload=new PersonalService(new PostgresPlatformRepository(business as SqlPool,true),config).requirements;
   assert.equal((await reload.get(fixture.ownerId,replay.entry.id)).fields.body.length,16384);
   const updated=await reload.mutate(fixture.ownerId,replay.entry.id,{...body,fields:{...fields,priority:'P1'},expectedRevision:1,baselineBinding:null},randomUUID());assert.equal(updated.entry.revision,2);assert.equal((await reload.history(fixture.ownerId,replay.entry.id,1)).truncated,true);
  });
  await t.test('new issuer mode has independently verified native scopes and fence rejects revoked requirements grants',async()=>{
   const token=randomUUID().replaceAll('-','');await admin.query('INSERT INTO lifeos_platform.platform_session(id,token,"userId","expiresAt","mfaVerified") VALUES($1,$2,$3,clock_timestamp()+interval \'1 hour\',true)',[randomUUID(),token,fixture.ownerId]);
   const cookie='__Secure-lifeos-platform-candidate.session_token='+encodeURIComponent(token+'.'+createHmac('sha256',fixture.sessionSecret).update(token).digest('base64'));
   const issuer=await createPostgresKeyIssuer(readKeyIssuerConfig({socketPath:'/tmp/requirements-fixture.sock',baseURL:fixture.origin,databaseURL:requirementsManagerURL(),ownerId:fixture.ownerId,ownerEmail:fixture.email,spaceId:fixture.spaceId,sessionSecret:fixture.sessionSecret,agentSecret:fixture.agentSecret,businessScopes:'requirements-v1'}));
   try{
    const issued=await issuer.handle('create',cookie,{name:'Synthetic requirements grant',scopes:['requirements:read','requirements:write'],expiresInDays:7});assert.equal(issued.status,201);const grant=(issued.body as {grant:{id:string}}).grant;
    const binding={grantId:grant.id,ownerId:fixture.ownerId,spaceId:fixture.spaceId},fence=(tx:import('../src/platform/contracts.ts').Transaction)=>assertAgentGrant(tx,binding,['requirements:read','requirements:write']);
    await service.mutate(fixture.ownerId,null,body,randomUUID(),async()=>{},fence);
    await manager.query('UPDATE lifeos_agent.apikey SET enabled=false WHERE id=$1',[grant.id]);
    await assert.rejects(service.mutate(fixture.ownerId,null,body,randomUUID(),async()=>{},fence),{code:'WRITE_GRANT_REVOKED'});
   }finally{await issuer.close();}
  });
 }finally{await Promise.all([admin.end(),business.end(),manager.end()]);}
});
