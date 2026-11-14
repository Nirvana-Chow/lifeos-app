import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID,createHash,createHmac} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {prepareBusinessMcpPolicyFixture} from './helpers/business-mcp-policy-stage-pg.ts';
import {requirementsFixture as fixture,requirementsFixturePool as pool} from './helpers/requirements-stage-pg.ts';
import {agentOperations,policyOAuthBusinessMcpOperations} from '../src/agent-api/capabilities.ts';
import {policyAuthorizationScopes} from '../src/agent-api/business-policy.ts';
import {readBusinessPolicyCatalog} from '../src/agent-api/business-policy-postgres.ts';
import {readCurrentAgentGrant,agentOperationAvailable,verifyAgentRequirementsReadiness,verifyAgentBusinessReadiness} from '../src/agent-api/runtime.ts';
import type {AgentModules} from '../src/agent-api/config.ts';
import {PostgresPlatformRepository,verifyRestrictedPool,lockCurrentAgentGrant,type SqlPool} from '../src/platform/postgres.ts';
import {verifyClassificationPool,classificationQueries} from '../src/personal-candidate/classification-postgres.ts';
import {classificationOAuthProducer} from '../src/personal-candidate/classification-oauth.ts';
import {ClassificationService,classificationPolicyRevision} from '../src/personal-candidate/classification-service.ts';
import {classificationPlanDigest,type ClassificationPlan} from '../src/personal-candidate/classification-contracts.ts';
import type {PersonalConfig} from '../src/personal-candidate/config.ts';
import {PersonalService} from '../src/personal-candidate/service.ts';
import {AuthorityService} from '../src/agent-authority/service.ts';
import {assertAgentGrant} from '../src/agent-api/grant-fence.ts';
import {createPlatformAuth,readVerifiedOwnerSession} from '../src/platform/auth.ts';
import {createBusinessOAuthHttp} from '../src/business-mcp-oauth/http.ts';
import {BusinessOAuthLedger,intersectOAuthGrant,tokenIdentity,validateBusinessClaims,type OAuthState,type BusinessAccessClaims} from '../src/business-mcp-oauth/ledger.ts';
import {sameOAuthFence,type OAuthGrantFence} from '../src/business-mcp-oauth/contracts.ts';
import {verifyBusinessOAuthPool} from '../src/business-mcp-oauth/readiness.ts';
import {verifyBusinessOAuthPolicyPool} from '../src/business-mcp-oauth/policy-readiness.ts';
import {requireMcpAuth} from '@better-auth/mcp';
import {verifyOAuthQueryParams} from '@better-auth/oauth-provider';
import {createAgentHandler} from '../src/agent-api/http.ts';
import {HttpBusinessClient} from '../src/mcp-http/business-client.ts';
import {filePermissionSchema} from '../src/file-handoff/permission-contracts.ts';
import {fileHandoffOperations} from '../src/file-handoff/operations.ts';

const enabled=process.env.RUN_BUSINESS_MCP_POLICY_POSTGRES_TESTS==='1';
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const body=(p:{planId:string;digest:string})=>({planId:p.planId,digest:p.digest,confirmed:true});
async function blocked(admin:ReturnType<typeof pool>,pid:()=>number,blocker:number){
 const until=Date.now()+5000;while(Date.now()<until){if(pid()>0&&(await admin.query('SELECT $2::int=ANY(pg_blocking_pids($1)) AS blocked',[pid(),blocker])).rows[0].blocked)return;await delay(10);}assert.fail('Actual transaction did not wait at the original PostgreSQL fence');
}
test('OPT-IN full0025: real current-grant/OAuth intersection and transaction-bound classification provenance',{
 skip:!enabled&&'No allocated fresh descriptor: full0025 SQL, role, provider and lock tests not executed',timeout:180000,
},async t=>{
 const prepared=await prepareBusinessMcpPolicyFixture(),writer=prepared.writer,admin=pool('admin',2),runtime=pool('runtime',4),verifier=pool('verifier',2),manager=pool('manager',1);
 const connections=[writer,admin,runtime,verifier,manager];const groups:string[]=[];
 const origin='https://lifeos.nirvanachow.com',owner={ownerId:fixture.ownerId,spaceId:fixture.spaceId,ownerEmail:fixture.email},grantId='synthetic-full-policy-'+randomUUID();
 const config={resource:origin+'/api/platform/mcp',issuer:origin+'/api/platform/auth',grantId,scopes:['personal-business:all','offline_access']};
 const personal:PersonalConfig={...owner,databaseName:fixture.database,baseURL:origin,approval:'personal-manual-v1',businessWriteMode:'owner-managed',readonlyLoginApproved:true,allowedTypes:['todo','journal','project','domain','topic'],requirementsEnabled:true,requirementSupportEnabled:true,calendarEnabled:true,healthEnabled:true,peopleEnabled:true,financeEnabled:true,mediaEnabled:true,careerEnabled:true,portfolioEnabled:true,cookingEnabled:true};
 const modules:AgentModules={organization:true,classification:true,businessDataPolicy:true,personalRecords:true,storageReview:true,requirements:true,requirementEvents:false,fileHandoff:false};
 const repository=new PostgresPlatformRepository(runtime as SqlPool,true,true,modules),ledger=new BusinessOAuthLedger(runtime as SqlPool,config,owner.ownerId,owner.spaceId);
 const sql=await readFile('db/0025_business_mcp_full_policy.proposed.sql','utf8');
 const ordinary=policyOAuthBusinessMcpOperations.filter(op=>op.module!=='fileHandoff');
 const client=await writer.connect().catch(async error=>{await Promise.allSettled(connections.map(connection=>connection.end()));throw error;});
 async function group(name:string,run:()=>Promise<void>){let failure:unknown;await t.test(name,async()=>{try{await run();groups.push(name);}catch(error){failure=error;throw error;}});if(failure)throw failure;}
 const oldObjects=async()=>(await client.query(`SELECT jsonb_build_object(
  'relations',(SELECT jsonb_agg(jsonb_build_array(c.oid,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity,(SELECT jsonb_agg(jsonb_build_array(attnum,attname,attacl,attnotnull) ORDER BY attnum) FROM pg_attribute WHERE attrelid=c.oid AND attnum>0 AND NOT attisdropped)) ORDER BY c.oid) FROM pg_class c WHERE c.oid=ANY($1::oid[])),
  'functions',(SELECT jsonb_agg(jsonb_build_array(p.oid,p.prosrc,p.proowner,p.proacl,p.prosecdef,p.provolatile,p.proconfig) ORDER BY p.oid) FROM pg_proc p WHERE p.oid=ANY($2::oid[])),
  'roles',(SELECT jsonb_agg(jsonb_build_array(oid,rolname,rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolbypassrls,rolreplication,rolcanlogin) ORDER BY oid) FROM pg_roles WHERE rolname NOT LIKE 'pg_%'),
  'memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.oid) FROM pg_auth_members m)) AS value`,[oldRelationIds,oldFunctionIds])).rows[0].value;
 let oldRelationIds:number[]=[],oldFunctionIds:number[]=[],before:unknown,registrations:unknown;
 const policyOptions=async()=>{
  const catalog=await readBusinessPolicyCatalog(verifier);
  const available=await Promise.all(agentOperations.map(async op=>{
   if(!agentOperationAvailable(op.id,personal,true,modules))return false;
   if(op.module==='classification'){await verifyAgentBusinessReadiness(runtime);await verifyClassificationPool(runtime as SqlPool);}
   if(op.module==='requirements')await verifyAgentRequirementsReadiness(runtime);
   return catalog.operations.some(row=>row.id===op.id&&row.enabled);
  }));
  return{ownerId:owner.ownerId,spaceId:owner.spaceId,policyEnabled:catalog.enabled,registry:agentOperations,operationAvailable:(id:string)=>available[agentOperations.findIndex(op=>op.id===id)]===true};
 };
 const original=()=>readCurrentAgentGrant(verifier,grantId,policyOptions);
 const current=async(fence:OAuthGrantFence)=>{const state=await ledger.read(fence.tokenId);return state&&sameOAuthFence(state.oauthFence,fence)?intersectOAuthGrant(state,await original()):null;};
 let issue!:()=>Promise<{token:string;state:OAuthState}>;
 let active:{token:string;state:OAuthState};
 let service:ClassificationService,authority:AuthorityService,ownerActor:NonNullable<Awaited<ReturnType<AuthorityService['resolveOwnerActor']>>>;
 let ownerSessionId:string,ownerSessionToken:string;
 let changes:Parameters<ClassificationService['preview']>[1];
 try{
  await group('1 marked fresh split owners, real restricted identities and pre0025 legacy readiness',async()=>{
   for(const [connection,role]of [[runtime,'lifeos_platform_candidate_runtime'],[verifier,'lifeos_agent_verifier'],[manager,'lifeos_agent_key_manager']] as const)assert.equal((await connection.query('SELECT current_user AS role')).rows[0].role,role);
   await verifyRestrictedPool(runtime as SqlPool);await verifyClassificationPool(runtime as SqlPool);
   await client.query('UPDATE lifeos_agent.oauth_business_control SET enabled=true,grant_id=$1,owner_email=$2,scopes=$3',[grantId,fixture.email,['journal:read']]);
   await verifyBusinessOAuthPool(runtime as SqlPool,{...config,scopes:['journal:read']},owner);
   await assert.rejects(verifyBusinessOAuthPolicyPool(runtime as SqlPool,config,owner),/BUSINESS_MCP_POLICY_SCHEMA_UNAVAILABLE/);
   oldRelationIds=(await client.query("SELECT c.oid FROM pg_class c WHERE c.relnamespace IN('lifeos_agent'::regnamespace,'lifeos_platform'::regnamespace) AND c.relkind='r' ORDER BY c.oid")).rows.map(row=>row.oid);
   oldFunctionIds=(await client.query("SELECT p.oid FROM pg_proc p WHERE p.pronamespace IN('lifeos_agent'::regnamespace,'lifeos_platform'::regnamespace) ORDER BY p.oid")).rows.map(row=>row.oid);
   before=await oldObjects();registrations=(await client.query('SELECT operation_id,required_scopes,enabled FROM lifeos_agent.business_policy_operation ORDER BY operation_id')).rows;
  });
  await group('2 actual owning role applies exact0025 once without changing old roles, table ACL or function bodies',async()=>{
   const restricted=await runtime.connect();try{await assert.rejects(restricted.query(sql));}finally{await restricted.query('ROLLBACK');restricted.release();}
   await client.query("SELECT set_config('lifeos.agent_expected_database',$1,false),set_config('lifeos.agent_expected_owner',$2,false),set_config('lifeos.agent_expected_space',$3,false)",[fixture.database,owner.ownerId,owner.spaceId]);
   await client.query("SET lifeos.business_mcp_policy_approved='all-personal-business-v1'");await client.query(sql);
   assert.deepEqual(await oldObjects(),before);
   const currentRows=(await client.query('SELECT operation_id,required_scopes,enabled FROM lifeos_agent.business_policy_operation ORDER BY operation_id')).rows;
   for(const row of registrations as {operation_id:string;required_scopes:string[];enabled:boolean}[])assert.deepEqual(currentRows.find(value=>value.operation_id===row.operation_id),row);
   assert.ok(currentRows.filter(row=>!(registrations as {operation_id:string}[]).some(old=>old.operation_id===row.operation_id)).every(row=>row.enabled===false));
   await assert.rejects(verifyBusinessOAuthPool(runtime as SqlPool,config,owner));
  });
  await group('3 independently qualified new functions and metadata RLS remain closed to other roles',async()=>{
   await client.query('INSERT INTO lifeos_agent.apikey(id,"configId","referenceId",key,enabled,"createdAt","updatedAt","expiresAt",metadata,permissions) VALUES($1,\'default\',$2,\'synthetic-unused-key-digest\',true,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval \'2 hours\',$3,$4)',[grantId,owner.ownerId,JSON.stringify({spaceId:owner.spaceId,businessDataPolicy:'all-personal-business-v1'}),JSON.stringify({todo:['read','write'],requirements:['read','write']})]);
   await client.query('UPDATE lifeos_agent.business_policy_control SET enabled=true');
   await client.query('UPDATE lifeos_agent.business_policy_operation SET enabled=true WHERE operation_id=ANY($1::text[])',[ordinary.map(op=>op.id)]);
   await client.query('UPDATE lifeos_agent.oauth_business_control SET scopes=$1',[config.scopes]);
   await verifyBusinessOAuthPool(runtime as SqlPool,config,owner);
   await assert.rejects(verifyBusinessOAuthPolicyPool(verifier as SqlPool,config,owner));
   for(const connection of [runtime,verifier,manager])await assert.rejects(connection.query('SELECT * FROM lifeos_agent.oauth_business_token'),{code:'42501'});
   for(const connection of [verifier,manager])await assert.rejects(connection.query('SELECT * FROM lifeos_platform.platform_classification_oauth_producer'),{code:'42501'});
   await assert.rejects(runtime.query('UPDATE lifeos_platform.platform_classification_oauth_producer SET digest=digest WHERE false'),{code:'42501'});
   assert.equal((await runtime.query('SELECT count(*)::int AS count FROM lifeos_platform.platform_classification_oauth_producer')).rows[0].count,0);
  });
  await group('4 real original catalog and grant reader apply reviewed enabled operations and actual native availability',async()=>{
   assert.equal(ordinary.length,59);const grant=await original();assert.ok(grant);assert.equal(grant.businessDataPolicy,'all-personal-business-v1');
   assert.ok(ordinary.every(op=>grant.allowedOperationIds?.includes(op.id)));assert.ok(!grant.allowedOperationIds?.includes('claimRequirementExecution'));
   await client.query("UPDATE lifeos_agent.business_policy_operation SET enabled=false WHERE operation_id='getCooking'");
   assert.ok(!(await original())?.allowedOperationIds?.includes('getCooking'));
   await client.query("UPDATE lifeos_agent.business_policy_operation SET enabled=true WHERE operation_id='getCooking'");
   assert.ok((await original())?.allowedOperationIds?.includes('getCooking'));
  });
  await group('5 official provider issues a real full-scope JWT after actual native owner/consent and ledger verification',async()=>{
   const sessionId=randomUUID(),sessionToken='synthetic-full-session-'+randomUUID();
   ownerSessionId=sessionId;
   ownerSessionToken=sessionToken;
   await client.query('INSERT INTO lifeos_platform.platform_session(id,token,"userId","createdAt","updatedAt","expiresAt","mfaVerified","sessionDurationMode","sessionDurationSeconds") VALUES($1,$2,$3,statement_timestamp(),statement_timestamp(),statement_timestamp()+interval \'30 minutes\',true,\'fixed\',1800)',[sessionId,sessionToken,owner.ownerId]);
   const cookie='__Secure-lifeos-platform-candidate.session_token='+encodeURIComponent(sessionToken+'.'+createHmac('sha256',fixture.sessionSecret).update(sessionToken).digest('base64'));
   const platform={baseURL:origin,ownerId:owner.ownerId,ownerEmail:owner.ownerEmail,secret:fixture.sessionSecret,databaseURL:'',sessionSeconds:1800};
   const auth=createPlatformAuth(platform,runtime,{requireMfa:true,businessOAuth:config,sessionDuration:true,disableSessionRefresh:true});await auth.$context;
   const verify=async(token:string):Promise<BusinessAccessClaims|null>=>{let claims:ReturnType<typeof validateBusinessClaims>=null;await requireMcpAuth(auth,(_r,value)=>{claims=validateBusinessClaims(value,config,owner.ownerId);return new Response(null,{status:204});},{resource:config.resource,issuer:config.issuer})(new Request(config.resource,{headers:{authorization:'Bearer '+token}}));return claims;};
   const http=createBusinessOAuthHttp({origin,config,assertReady:()=>verifyBusinessOAuthPool(runtime as SqlPool,config,owner),owner:headers=>readVerifiedOwnerSession(auth,platform,headers),handler:request=>auth.handler(request),verifyQuery:query=>verifyOAuthQueryParams(query,platform.secret),verifyToken:verify,ledger});
   const {generateKeyPair,exportJWK,SignJWT}=await import('jose'),keys=await generateKeyPair('RS256'),clientId='https://full-policy-fixture.example.test/client.json',callback='https://full-policy-fixture.example.test/callback';
   await client.query('INSERT INTO lifeos_platform.platform_oauth_client(id,"clientId",name,disabled,"skipConsent","tokenEndpointAuthMethod","redirectUris",scopes,"grantTypes","responseTypes","requirePKCE",jwks) VALUES($1,$2,\'Synthetic full policy client\',false,false,\'private_key_jwt\',$3::jsonb,$4::jsonb,$5::jsonb,\'["code"]\'::jsonb,true,$6)',[randomUUID(),clientId,JSON.stringify([callback]),JSON.stringify(config.scopes),JSON.stringify(['authorization_code','refresh_token']),JSON.stringify({keys:[{...await exportJWK(keys.publicKey),kid:'full-policy-fixture',alg:'RS256',use:'sig'}]})]);
   await client.query('INSERT INTO lifeos_platform.platform_oauth_client_resource(id,"clientId","resourceId") VALUES($1,$2,$3)',[randomUUID(),clientId,config.resource]);
   issue=async()=>{
    // Independent synthetic scenarios only; preserve the original provider max3 rule.
    await client.query('DELETE FROM lifeos_platform.platform_rate_limit');
    const verifierValue='v'.repeat(43),params=new URLSearchParams({client_id:clientId,redirect_uri:callback,resource:config.resource,response_type:'code',scope:config.scopes.join(' '),state:randomUUID(),code_challenge:createHash('sha256').update(verifierValue).digest('base64url'),code_challenge_method:'S256',prompt:'consent'});
    const authorized=await http(new Request(config.issuer+'/oauth2/authorize?'+params,{headers:{host:new URL(origin).host,cookie,accept:'text/html'}}));assert.equal(authorized.status,302);
    const consentUrl=new URL(authorized.headers.get('location')!,origin);assert.equal(consentUrl.pathname,'/personal/oauth');
    const consent=await http(new Request(config.issuer+'/oauth2/consent',{method:'POST',headers:{host:new URL(origin).host,origin,'content-type':'application/json',cookie},body:JSON.stringify({accept:true,oauth_query:consentUrl.search.slice(1)})}));assert.equal(consent.status,200);
    const code=new URL((await consent.json()).url).searchParams.get('code');assert.ok(code);
    const assertion=await new SignJWT({}).setProtectedHeader({alg:'RS256',kid:'full-policy-fixture'}).setIssuer(clientId).setSubject(clientId).setAudience(config.issuer+'/oauth2/token').setIssuedAt().setExpirationTime('1m').setJti(randomUUID()).sign(keys.privateKey);
    const response=await http(new Request(config.issuer+'/oauth2/token',{method:'POST',headers:{host:new URL(origin).host,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,resource:config.resource,grant_type:'authorization_code',code,redirect_uri:callback,code_verifier:verifierValue,client_assertion:assertion,client_assertion_type:'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'})}));assert.equal(response.status,200);
    const tokens=await response.json(),claims=await verify(tokens.access_token);assert.ok(claims);assert.deepEqual(claims.scope.split(' ').sort(),[...config.scopes].sort());
    const state=await ledger.read(tokenIdentity(tokens.access_token));assert.ok(state);assert.equal(state.oauthFence.policy,'all-personal-business-v1');assert.match(state.producerAuthorizationRevision!,/^classification-oauth-v1:[a-f0-9]{64}$/);return{token:tokens.access_token as string,state};
   };
   active=await issue();
   authority=new AuthorityService({...owner,verifyOwner:async headers=>{const session=await readVerifiedOwnerSession(auth,platform,headers);return session?{ownerId:session.principal.userId,spaceId:owner.spaceId,sessionRef:session.sessionRef}:null;},verifyAgent:async token=>{if(!await verify(token))return null;const state=await ledger.read(tokenIdentity(token));return state?intersectOAuthGrant(state,await original()):null;},readCurrentAgent:async(_id,fence)=>fence?current(fence):original()});
   ownerActor=(await authority.resolveOwnerActor(new Headers({cookie})))!;assert.ok(ownerActor);
   service=new ClassificationService(repository,personal,{authority,assertReady:()=>verifyClassificationPool(runtime as SqlPool),assertWritable:async()=>{},policyRevision:()=>classificationPolicyRevision(personal)});
  });
  await group('6 every reviewed ordinary operation passes both real SQL fences, while engineering/commit/file authority is excluded',async()=>{
   const grant=await current(active.state.oauthFence);assert.ok(grant);assert.deepEqual([...grant.allowedOperationIds].sort(),ordinary.map(op=>op.id).sort());
   await repository.transaction(owner.ownerId,'full-policy-all-fences',async tx=>{for(const op of ordinary)await assertAgentGrant(tx,grant,policyAuthorizationScopes(op)! as never,op.id);});
   for(const operationId of ['commitTodoClassification','claimRequirementExecution','stageFileHandoff'])assert.equal((await runtime.query('SELECT lifeos_agent.assert_policy_oauth_business_grant($1,$2,$3,$4::jsonb,$5::text[],$6) AS allowed',[grantId,owner.ownerId,owner.spaceId,JSON.stringify(active.state.oauthFence),['todo:read','organization:read'],operationId])).rows[0].allowed,false);
  });
  await group('7 native API/MCP consumer saves and independently reads business data and previews with durable OAuth metadata',async()=>{
   const personalService=new PersonalService(repository,personal);
   const project=(await personalService.mutate(owner.ownerId,'project',null,{spaceId:owner.spaceId,confirmed:true,fields:{title:'Synthetic classification project',text:'',occurredOn:null,personal:{type:'project',stage:'active',purpose:null,nextStep:'',domain:null,topics:[]}}},'full-preview-project')).entry;
   const todo=(await personalService.mutate(owner.ownerId,'todo',null,{spaceId:owner.spaceId,confirmed:true,fields:{title:'Synthetic classification task',notes:'Fixture only',status:'open',dueOn:null}},'full-preview-todo')).entry;
   changes={changes:[{todo:{id:todo.id,sourceId:todo.source.id,expectedRevision:todo.revision},before:null,after:{project:{id:project.id,sourceId:project.source.id,revision:project.revision},domain:null,topics:[]}}]};
   const handler=createAgentHandler({enabled:true,mountPath:'/api/platform/agent',fenceWrites:true,modules,config:personal,repository,verify:async token=>token===active.token?current(active.state.oauthFence):null,readCurrentGrant:async(_id,fence)=>fence?current(fence):original(),operationAvailable:id=>agentOperationAvailable(id,personal,true,modules),assertWritable:async()=>{},classification:auth=>new ClassificationService(repository,personal,{authority:auth,assertReady:()=>verifyClassificationPool(runtime as SqlPool),assertWritable:async()=>{},policyRevision:()=>classificationPolicyRevision(personal)})});
   const consumer=new HttpBusinessClient(origin,active.token,handler,new AbortController().signal),catalog=await consumer.discover();assert.deepEqual(catalog.operations.map(op=>op.id).sort(),ordinary.map(op=>op.id).sort());
   const saved=await consumer.execute('createJournal',{fields:{title:'Synthetic full-policy journal',text:'Fixture only',occurredOn:null,personal:null},idempotencyKey:'full-policy-journal'});assert.equal(saved.ok,true);assert.equal(saved.verification?.verified,true);
   const finance=await consumer.execute('createFinance',{fields:{kind:'expense',amountMinor:1234,currency:'CNY',occurredOn:'2030-11-05',category:'Synthetic',fromAccountRef:'cash',toAccountRef:null,originalEntryId:null,notes:'Fixture only'},idempotencyKey:'full-policy-finance'});assert.equal(finance.ok,true);assert.equal(finance.verification?.verified,true);
   const feedback=await consumer.execute('createFeedback',{fields:{text:'Synthetic full-policy feedback',sourceLabel:'Fixture only'},idempotencyKey:'full-policy-feedback'});assert.equal(feedback.ok,true);assert.equal(feedback.verification?.verified,true);
   const checklist={schema:1,revision:'full-policy-storage-v1',context:{summary:'Fixture only'},items:[{id:'S-1',title:'Synthetic item',body:'No actual paths',question:'Keep?',group:'Test',kind:'file',status:'pending'}]};
   const storage=await consumer.execute('createStorageReview',{fields:{checklist},idempotencyKey:'full-policy-storage'});assert.equal(storage.ok,true);assert.equal(storage.verification?.verified,true);
   const stored=(storage.data as {entry:{id:string;revision:number}}).entry;
   const note=await consumer.execute('updateStorageReviewNote',{id:stored.id,expectedRevision:stored.revision,fields:{checklistRevision:checklist.revision,itemId:'S-1',note:'Synthetic original OAuth note\r\n'},idempotencyKey:'full-policy-storage-note'});assert.equal(note.ok,true);assert.equal(note.verification?.verified,true);
   const preview=await consumer.execute('previewTodoClassification',changes);assert.equal(preview.ok,true);
   const p=preview.data as {planId:string};assert.ok(p?.planId);
   assert.equal((await client.query('SELECT count(*)::int AS count FROM lifeos_platform.platform_classification_oauth_producer WHERE owner_id=$1 AND plan_id=$2',[owner.ownerId,p.planId])).rows[0].count,1);
   assert.equal((await service.review(ownerActor,p.planId)).stale,false);
   const fresh=pool('runtime',1);try{const independent=new PostgresPlatformRepository(fresh as SqlPool,true,true,modules);await independent.classificationTransaction(owner.ownerId,owner.spaceId,randomUUID(),async tx=>{const plan=await tx.getClassificationPlan(p.planId);assert.ok(plan);const producer=await tx.classificationOAuthProducer!(p.planId);assert.ok(producer);assert.equal(producer.digest,plan.preview.digest);assert.deepEqual(producer.oauthFence,active.state.oauthFence);});}finally{await fresh.end();}
  });
  await group('8 same-transaction metadata validates the original plan ID/digest/revision/expiry and actual OAuth fence',async()=>{
   const actor=(await authority.resolveAgentActor(active.token))!,preview=await service.preview(actor,changes);
   const source=(await client.query('SELECT plan FROM lifeos_platform.platform_classification_plan WHERE owner_id=$1 AND plan_id=$2',[owner.ownerId,preview.planId])).rows[0].plan as ClassificationPlan;
   for(const patch of [{digest:'e'.repeat(64)},{proposalRevision:2},{expiresAt:new Date(Date.parse(source.preview.expiresAt)+1).toISOString()},{producerAuthorizationRevision:'classification-oauth-v1:'+'e'.repeat(64)},{oauthFence:{...active.state.oauthFence,bindingRevision:active.state.oauthFence.bindingRevision+1}}]){
    const actual=await runtime.connect();try{
     await actual.query('BEGIN');await actual.query("SELECT set_config('lifeos.owner_id',$1,true),set_config('lifeos.classification_space_id',$2,true)",[owner.ownerId,owner.spaceId]);
     const tx=classificationQueries(actual,owner.ownerId,owner.spaceId,randomUUID());
     const proposal={...source,preview:{...source.preview,planId:randomUUID(),digest:'0'.repeat(64)}};const plan={...proposal,preview:{...proposal.preview,digest:classificationPlanDigest(proposal)}};
     await tx.saveClassificationPlan(plan);const producer={...classificationOAuthProducer(plan,active.state.oauthFence),...patch};
     // Bypass the JS decoder deliberately: exercise the actual SQL constraints/trigger.
     await assert.rejects(actual.query('INSERT INTO lifeos_platform.platform_classification_oauth_producer(owner_id,space_id,plan_id,digest,proposal_revision,grant_id,expires_at,producer_authorization_revision,oauth_fence) VALUES($1,$2,$3,$4,$5,$6,$7::timestamptz,$8,$9::jsonb)',[owner.ownerId,owner.spaceId,producer.planId,producer.digest,producer.proposalRevision,producer.grantId,producer.expiresAt,producer.producerAuthorizationRevision,JSON.stringify(producer.oauthFence)]),{code:'LG403'});
    }finally{await actual.query('ROLLBACK');actual.release();}
   }
  });
  await group('9 token revocation and same-grant re-consent cannot be replaced by the still-valid original key at owner commit',async()=>{
   for(const change of ['revocation','new-binding','original-policy-removed'] as const){
    active=await issue();const actor=(await authority.resolveAgentActor(active.token))!,preview=await service.preview(actor,changes);await service.approve(ownerActor,body(preview));
    const before=await repository.exportSnapshot(owner.ownerId);
    if(change==='revocation')await client.query('UPDATE lifeos_agent.oauth_business_token SET revoked=true WHERE token_id=$1',[active.state.oauthFence.tokenId]);
    else if(change==='new-binding')await issue();
    else{
     const digest=(await manager.query('SELECT lifeos_agent.current_managed_grant_digest($1) AS value',[grantId])).rows[0].value;
     await manager.query('SELECT lifeos_agent.set_managed_business_grant($1,$2,$3,$4::jsonb,NULL)',[ownerSessionToken,grantId,digest,JSON.stringify({todo:['read','write'],requirements:['read','write']})]);
     await assert.rejects(manager.query('SELECT lifeos_agent.set_managed_business_grant($1,$2,$3,$4::jsonb,$5)',[ownerSessionToken,grantId,digest,JSON.stringify({todo:['read','write'],requirements:['read','write']}),'all-personal-business-v1']),{code:'LG409'});
    }
    assert.ok(await original());await assert.rejects(service.commit(ownerActor,body(preview),'revoked-full-preview-'+randomUUID()));assert.deepEqual(await repository.exportSnapshot(owner.ownerId),before);
    if(change==='original-policy-removed'){
     const digest=(await manager.query('SELECT lifeos_agent.current_managed_grant_digest($1) AS value',[grantId])).rows[0].value;
     await manager.query('SELECT lifeos_agent.set_managed_business_grant($1,$2,$3,$4::jsonb,$5)',[ownerSessionToken,grantId,digest,JSON.stringify({todo:['read','write'],requirements:['read','write']}),'all-personal-business-v1']);
    }
   }
  });
  await group('10 original OAuth advisory gate rejects a waiting old producer after a real concurrent revoke',async()=>{
   active=await issue();const grant=await current(active.state.oauthFence);assert.ok(grant);const hold=await writer.connect();let waiting=0;
   try{await hold.query('BEGIN');const blocker=(await hold.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;await hold.query('UPDATE lifeos_agent.oauth_business_token SET revoked=true WHERE token_id=$1',[active.state.oauthFence.tokenId]);
    const observed:SqlPool={connect:async()=>{const c=await runtime.connect();waiting=(await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;return c;}};
    const race=new PostgresPlatformRepository(observed,true,true,modules);const work=race.transaction(owner.ownerId,randomUUID(),tx=>assertAgentGrant(tx,grant,['todo:read','organization:read'],'previewTodoClassification'));void work.catch(()=>{});
    await blocked(admin,()=>waiting,blocker);await hold.query('COMMIT');await assert.rejects(work,{code:'WRITE_GRANT_REVOKED'});
   }finally{await hold.query('ROLLBACK').catch(()=>{});hold.release();}
  });
  await group('10a same-client current fence notices actual SQL token expiry while its original transaction remains open',async()=>{
   const seconds=Math.floor(Number((await runtime.query('SELECT extract(epoch FROM clock_timestamp()) AS seconds')).rows[0].seconds)),clientId='https://full-policy-fixture.example.test/client.json';
   const state=await ledger.register('synthetic-short-expiry-sql-'+randomUUID(),{iss:config.issuer,aud:config.resource,sub:owner.ownerId,azp:clientId,client_id:clientId,sid:ownerSessionId,iat:seconds,exp:seconds+3,scope:config.scopes.join(' ')},'authorization_code');assert.ok(state);
   const originalGrant=await original();assert.ok(originalGrant);const grant=intersectOAuthGrant(state,originalGrant);assert.ok(grant);
   const same=await runtime.connect();try{await same.query('BEGIN');await same.query("SELECT set_config('lifeos.owner_id',$1,true)",[owner.ownerId]);
    const binding={...grant,operationId:'previewTodoClassification'};
    assert.equal(await lockCurrentAgentGrant(same,owner.ownerId,binding,['todo:read','organization:read'],true),true);
    await same.query('SELECT pg_sleep(GREATEST(0,$1::double precision-extract(epoch FROM clock_timestamp())+0.1))',[state.oauthFence.expiresAt]);
    assert.equal(await lockCurrentAgentGrant(same,owner.ownerId,binding,['todo:read','organization:read'],true),false);
   }finally{await same.query('ROLLBACK');same.release();}
  });
  await group('11 actual readiness rejects new body, metadata ACL/RLS/trigger drift and restores exact reviewed source',async()=>{
   const signature='lifeos_agent.read_policy_oauth_business_token(text,text,text)',row=(await client.query('SELECT pg_get_functiondef(to_regprocedure($1)) AS definition,prosrc FROM pg_proc WHERE oid=to_regprocedure($1)',[signature])).rows[0];
   assert.equal(row.definition.split(row.prosrc).length,2);
   try{await client.query(row.definition.replace(row.prosrc,()=>row.prosrc+'\n-- unknown full-policy body\n'));await assert.rejects(verifyBusinessOAuthPolicyPool(runtime as SqlPool,config,owner));}finally{await client.query(row.definition);}
   for(const [mutation,restore]of [
    ['GRANT UPDATE ON lifeos_platform.platform_classification_oauth_producer TO lifeos_platform_candidate_runtime','REVOKE UPDATE ON lifeos_platform.platform_classification_oauth_producer FROM lifeos_platform_candidate_runtime'],
    ['ALTER TABLE lifeos_platform.platform_classification_oauth_producer NO FORCE ROW LEVEL SECURITY','ALTER TABLE lifeos_platform.platform_classification_oauth_producer FORCE ROW LEVEL SECURITY'],
    ['ALTER TABLE lifeos_platform.platform_classification_oauth_producer DISABLE TRIGGER classification_oauth_binding','ALTER TABLE lifeos_platform.platform_classification_oauth_producer ENABLE TRIGGER classification_oauth_binding'],
   ]){try{await client.query(mutation);await assert.rejects(verifyBusinessOAuthPolicyPool(runtime as SqlPool,config,owner));}finally{await client.query(restore);}await verifyBusinessOAuthPool(runtime as SqlPool,config,owner);}
  });
  await group('11a actual restricted READ ONLY transaction qualifies full readiness without a metadata write',async()=>{
   const readonly=await runtime.connect();try{await readonly.query('BEGIN READ ONLY');assert.equal((await readonly.query("SELECT current_setting('transaction_read_only') AS mode")).rows[0].mode,'on');
    const sameClient:SqlPool={connect:async()=>({query:readonly.query.bind(readonly),release(){}})};await verifyBusinessOAuthPool(sameClient,config,owner);
    await assert.rejects(readonly.query('UPDATE lifeos_platform.platform_session SET "updatedAt"=clock_timestamp() WHERE false'),{code:'25006'});
   }finally{await readonly.query('ROLLBACK');readonly.release();}
  });
  await group('11b separately consented files retain original MFA/digest/revision CAS and permission revocation under the full marker',async()=>{
   const digest=(await manager.query('SELECT lifeos_agent.current_managed_grant_digest($1) AS value',[grantId])).rows[0].value;
   const permission=(await manager.query('SELECT lifeos_agent.set_file_handoff_permission($1,$2,$3,0,$4::text[],$5) AS value',[ownerSessionToken,grantId,digest,['file-handoff:read','file-handoff:write'],'codex'])).rows[0].value;
   assert.equal(permission.revision,1);
   await assert.rejects(manager.query('SELECT lifeos_agent.set_file_handoff_permission($1,$2,$3,0,$4::text[],$5)',[ownerSessionToken,grantId,digest,['file-handoff:read'],'codex']),{code:'LG409'});
   active=await issue();const lookup=await readCurrentAgentGrant(verifier,grantId,policyOptions,true);assert.ok(lookup);
   const fileOriginal={...lookup,fileHandoff:filePermissionSchema.parse('fileHandoff'in lookup?lookup.fileHandoff:undefined)};
   const ordinaryOnly=intersectOAuthGrant(active.state,fileOriginal);assert.ok(ordinaryOnly);assert.equal(ordinaryOnly.fileHandoff,undefined);assert.ok(!ordinaryOnly.allowedOperationIds.includes('getFileHandoff'));
   const scopes=[...config.scopes,'file-handoff:read'],fileConfig={...config,scopes},fileClient='https://full-file-fixture.example.test/client.json';
   await client.query('UPDATE lifeos_agent.oauth_business_control SET scopes=$1',[scopes]);
   await verifyBusinessOAuthPool(runtime as SqlPool,fileConfig,owner);
   await client.query('INSERT INTO lifeos_platform.platform_oauth_client(id,"clientId",disabled,"skipConsent","tokenEndpointAuthMethod","redirectUris",scopes) VALUES($1,$2,false,false,\'none\',\'["https://full-file-fixture.example.test/callback"]\'::jsonb,$3::jsonb)',[randomUUID(),fileClient,JSON.stringify(scopes)]);
   await client.query('INSERT INTO lifeos_platform.platform_oauth_consent(id,"clientId","userId","referenceId",resources,scopes,"createdAt","updatedAt") VALUES($1,$2,$3,\'lifeos-business-mcp-v1\',$4::jsonb,$5::jsonb,statement_timestamp(),statement_timestamp())',[randomUUID(),fileClient,owner.ownerId,JSON.stringify([config.resource]),JSON.stringify(scopes)]);
   const fileLedger=new BusinessOAuthLedger(runtime as SqlPool,fileConfig,owner.ownerId,owner.spaceId);await fileLedger.approve(ownerSessionId,fileClient,scopes);
   const seconds=Math.floor(Date.now()/1000),state=await fileLedger.register('synthetic-full-file-sql-'+randomUUID(),{iss:config.issuer,aud:config.resource,sub:owner.ownerId,azp:fileClient,client_id:fileClient,sid:ownerSessionId,iat:seconds,exp:seconds+300,scope:scopes.join(' ')},'authorization_code');assert.ok(state);
   const grant=intersectOAuthGrant(state,fileOriginal);assert.ok(grant);assert.ok(grant.allowedOperationIds.includes('getFileHandoff'));assert.ok(!grant.allowedOperationIds.includes('stageFileHandoff'));
   assert.deepEqual(grant.fileHandoff?.scopes,['file-handoff:read']);
   // Files retain their dedicated native fence; the ordinary policy guard must not admit them.
   await assert.rejects(repository.transaction(owner.ownerId,randomUUID(),tx=>assertAgentGrant(tx,grant,['file-handoff:read'],'getFileHandoff')),{code:'GRANT_OPERATION_INVALID'});
   const fileAllowed=async(operationId:'getFileHandoff'|'stageFileHandoff')=>{
    const same=await runtime.connect();try{await same.query('BEGIN');await same.query("SELECT set_config('lifeos.owner_id',$1,true)",[owner.ownerId]);
     return await lockCurrentAgentGrant(same,owner.ownerId,{...grant,operationId},fileHandoffOperations.find(operation=>operation.id===operationId)!.requiredScopes,true);
    }finally{await same.query('ROLLBACK');same.release();}
   };
   assert.equal(await fileAllowed('getFileHandoff'),true);
   assert.equal(await fileAllowed('stageFileHandoff'),false);
   const currentDigest=(await manager.query('SELECT lifeos_agent.current_managed_grant_digest($1) AS value',[grantId])).rows[0].value;
   await manager.query('SELECT lifeos_agent.set_file_handoff_permission($1,$2,$3,1,ARRAY[]::text[],NULL)',[ownerSessionToken,grantId,currentDigest]);
   assert.equal(await fileAllowed('getFileHandoff'),false);
  });
  await group('12 original narrow consent remains narrow on the new schema; final full control disable and source invariants are read back',async()=>{
   const originalGrant=await original();assert.ok(originalGrant);
   const scopes=['journal:read','todo:read','organization:read'],narrowConfig={...config,scopes},narrowClient='https://narrow-policy-fixture.example.test/client.json';
   await client.query('UPDATE lifeos_agent.oauth_business_control SET scopes=$1',[scopes]);await verifyBusinessOAuthPool(runtime as SqlPool,narrowConfig,owner);
   await client.query('INSERT INTO lifeos_platform.platform_oauth_client(id,"clientId",disabled,"skipConsent","tokenEndpointAuthMethod","redirectUris",scopes) VALUES($1,$2,false,false,\'none\',\'["https://narrow-policy-fixture.example.test/callback"]\'::jsonb,$3::jsonb)',[randomUUID(),narrowClient,JSON.stringify(scopes)]);
   await client.query('INSERT INTO lifeos_platform.platform_oauth_consent(id,"clientId","userId","referenceId",resources,scopes,"createdAt","updatedAt") VALUES($1,$2,$3,\'lifeos-business-mcp-v1\',$4::jsonb,$5::jsonb,statement_timestamp(),statement_timestamp())',[randomUUID(),narrowClient,owner.ownerId,JSON.stringify([config.resource]),JSON.stringify(scopes)]);
   const narrowLedger=new BusinessOAuthLedger(runtime as SqlPool,narrowConfig,owner.ownerId,owner.spaceId);await narrowLedger.approve(ownerSessionId,narrowClient,scopes);
   // Real SQL registration/read/fence with synthetic claims. This is not another
   // provider JWT handshake; the full-scope handshake was actually exercised above.
   const seconds=Math.floor(Date.now()/1000),narrowState=await narrowLedger.register('synthetic-narrow-sql-'+randomUUID(),{iss:config.issuer,aud:config.resource,sub:owner.ownerId,azp:narrowClient,client_id:narrowClient,sid:ownerSessionId,iat:seconds,exp:seconds+300,scope:scopes.join(' ')},'authorization_code');assert.ok(narrowState);
   const projection=intersectOAuthGrant(narrowState,originalGrant);assert.ok(projection);assert.ok(projection.allowedOperationIds.includes('getJournal'));
   assert.ok(!['createTodo','getCooking','previewTodoClassification','commitTodoClassification'].some(id=>projection.allowedOperationIds.includes(id)));
   assert.ok(projection.scopes.every(scope=>scopes.includes(scope)));
   for(const [operation,required,expected]of [['getJournal',['journal:read'],true],['previewTodoClassification',['todo:read','organization:read'],false]] as const)assert.equal((await runtime.query('SELECT lifeos_agent.assert_oauth_business_grant($1,$2,$3,$4::jsonb,$5::text[],$6) AS allowed',[grantId,owner.ownerId,owner.spaceId,JSON.stringify(narrowState.oauthFence),required,operation])).rows[0].allowed,expected);
   await client.query('UPDATE lifeos_agent.oauth_business_control SET enabled=false');await assert.rejects(verifyBusinessOAuthPool(runtime as SqlPool,config,owner));
   assert.equal((await runtime.query('SELECT lifeos_agent.oauth_business_activation() AS value')).rows[0].value.enabled,false);assert.deepEqual(await oldObjects(),before);
   await admin.query("UPDATE business_mcp_policy_fixture.identity SET phase='complete' WHERE source_digest=$1",[prepared.sourceDigest]);
  });
  t.diagnostic('FULL0025_ACTUAL_PG '+JSON.stringify({source:prepared.sourceSha,sourceDigest:prepared.sourceDigest,sqlSha256:hash(sql),groups:groups.length,ordinaryOperations:ordinary.length,server:'170011',realRestrictedLogins:true,originalReaderAndNativePolicyOptions:true,productionConfigurationWrapperTested:false,providerJwtAndConsent:true,metadataSameTransaction:true,productionIO:false}));
 }finally{await client.query('ROLLBACK').catch(()=>{});client.release();await Promise.allSettled(connections.map(connection=>connection.end()));}
});
