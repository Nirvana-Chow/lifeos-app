import assert from 'node:assert/strict';import test from 'node:test';import {randomUUID,createHash,createHmac}from'node:crypto';
import {prepareBusinessOAuthFixture}from'./helpers/business-mcp-oauth-stage-pg.ts';
import {requirementsFixture as fixture,requirementsFixturePool as pool}from'./helpers/requirements-stage-pg.ts';
import {createPlatformAuth,readVerifiedOwnerSession}from'../src/platform/auth.ts';
import {createBusinessOAuthHttp}from'../src/business-mcp-oauth/http.ts';
import {BusinessOAuthLedger,validateBusinessClaims,intersectOAuthGrant,tokenIdentity,type OAuthState}from'../src/business-mcp-oauth/ledger.ts';
import {requireMcpAuth}from'@better-auth/mcp';import {verifyOAuthQueryParams}from'@better-auth/oauth-provider';
import {verifyBusinessOAuthPool}from'../src/business-mcp-oauth/readiness.ts';
import {readCurrentAgentGrant}from'../src/agent-api/runtime.ts';
import {PostgresPlatformRepository,type SqlPool}from'../src/platform/postgres.ts';
import {assertAgentTodoWriteGrant}from'../src/agent-api/grant-fence.ts';
import {createAgentHandler}from'../src/agent-api/http.ts';
import {HttpBusinessClient}from'../src/mcp-http/business-client.ts';
import {setTimeout as delay}from'node:timers/promises';
async function waitBlocked(admin:ReturnType<typeof pool>,pid:()=>number,blocker:number){
 const end=Date.now()+4000;while(Date.now()<end){if(pid()>0&&(await admin.query('SELECT $2::int=ANY(pg_blocking_pids($1)) AS blocked',[pid(),blocker])).rows[0].blocked)return;await delay(10);}assert.fail('Expected the actual PostgreSQL lock barrier');
}

test('OPT-IN fresh PostgreSQL official OAuth, current authority, PK replay and transactional revocation fences',{
 skip:process.env.RUN_BUSINESS_MCP_OAUTH_POSTGRES_TESTS!=='1'&&'No explicit fresh SSH-loopback OAuth fixture; PostgreSQL not executed',timeout:90000,
},async t=>{
 await prepareBusinessOAuthFixture();const admin=pool('admin',2),runtime=pool('runtime',3),verifier=pool('verifier',2);
 const origin='https://lifeos.nirvanachow.com',grantId=randomUUID(),ownerId=fixture.ownerId,spaceId=fixture.spaceId;
 const oauth={resource:origin+'/api/platform/mcp',issuer:origin+'/api/platform/auth',grantId,scopes:['todo:read','todo:write','offline_access']};
 const config={baseURL:origin,ownerId,ownerEmail:fixture.email,secret:fixture.sessionSecret,databaseURL:'',sessionSeconds:1800};
 const ledger=new BusinessOAuthLedger(runtime as SqlPool,oauth,ownerId,spaceId),repository=new PostgresPlatformRepository(runtime as SqlPool,true,true,{organization:false,classification:false});
 const sessionId=randomUUID(),sessionToken='synthetic-oauth-session-'+randomUUID(),cookie='__Secure-lifeos-platform-candidate.session_token='+encodeURIComponent(sessionToken+'.'+createHmac('sha256',fixture.sessionSecret).update(sessionToken).digest('base64'));
 try{
  await assert.rejects(verifyBusinessOAuthPool(runtime as SqlPool,oauth,{ownerId,ownerEmail:fixture.email,spaceId}));
  await admin.query('INSERT INTO lifeos_agent.apikey(id,"configId","referenceId",key,enabled,"createdAt","updatedAt","expiresAt",metadata,permissions) VALUES($1,\'default\',$2,$3,true,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval \'2 hours\',$4,$5)',[grantId,ownerId,'synthetic-unusable-key-digest',JSON.stringify({spaceId}),JSON.stringify({todo:['read','write']})]);
  await admin.query('UPDATE lifeos_agent.oauth_business_control SET enabled=true,grant_id=$1,owner_email=$2,scopes=$3',[grantId,fixture.email,oauth.scopes]);
  await admin.query('INSERT INTO lifeos_platform.platform_session(id,token,"userId","expiresAt","mfaVerified") VALUES($1,$2,$3,clock_timestamp()+interval \'30 minutes\',true)',[sessionId,sessionToken,ownerId]);
  await verifyBusinessOAuthPool(runtime as SqlPool,oauth,{ownerId,ownerEmail:fixture.email,spaceId});
  await t.test('restricted runtime has exact schema/ACL and no direct binding/key access',async()=>{
   await assert.rejects(runtime.query('SELECT * FROM lifeos_agent.oauth_business_token'),{code:'42501'});
   await assert.rejects(runtime.query('SELECT * FROM lifeos_agent.apikey'),{code:'42501'});
  });
  const auth=createPlatformAuth(config,runtime,{requireMfa:true,businessOAuth:oauth,disableSessionRefresh:true});await auth.$context;
  const verify=async(token:string)=>{let claims:ReturnType<typeof validateBusinessClaims>=null;await requireMcpAuth(auth,(_r,value)=>{claims=validateBusinessClaims(value,oauth,ownerId);return new Response(null,{status:204});},{resource:oauth.resource,issuer:oauth.issuer})(new Request(oauth.resource,{headers:{authorization:'Bearer '+token}}));return claims;};
  const http=createBusinessOAuthHttp({origin,config:oauth,assertReady:()=>verifyBusinessOAuthPool(runtime as SqlPool,oauth,{ownerId,ownerEmail:fixture.email,spaceId}),owner:h=>readVerifiedOwnerSession(auth,config,h),handler:r=>auth.handler(r),verifyQuery:q=>verifyOAuthQueryParams(q,config.secret),verifyToken:verify,ledger});
  const {generateKeyPair,exportJWK,SignJWT}=await import('jose');const keys=await generateKeyPair('RS256'),clientId='https://oauth-fixture.example.test/client.json',callback='https://oauth-fixture.example.test/callback';
  await admin.query('INSERT INTO lifeos_platform.platform_oauth_client(id,"clientId",name,disabled,"skipConsent","tokenEndpointAuthMethod","redirectUris",scopes,"grantTypes","responseTypes","requirePKCE",jwks) VALUES($1,$2,$3,false,false,\'private_key_jwt\',$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,true,$8)',[randomUUID(),clientId,'Synthetic PG OAuth client',JSON.stringify([callback]),JSON.stringify(oauth.scopes),JSON.stringify(['authorization_code','refresh_token']),JSON.stringify(['code']),JSON.stringify({keys:[{...await exportJWK(keys.publicKey),kid:'fixture-pg-client',alg:'RS256',use:'sig'}]})]);
  await admin.query('INSERT INTO lifeos_platform.platform_oauth_client_resource(id,"clientId","resourceId") VALUES($1,$2,$3)',[randomUUID(),clientId,oauth.resource]);
  let previousAssertion='';const protocol=async(endpoint:string,body:Record<string,string>,replay=false)=>{
   const assertion=replay?previousAssertion:await new SignJWT({}).setProtectedHeader({alg:'RS256',kid:'fixture-pg-client'}).setIssuer(clientId).setSubject(clientId).setAudience(oauth.issuer+'/oauth2/'+endpoint).setIssuedAt().setExpirationTime('1m').setJti(randomUUID()).sign(keys.privateKey);previousAssertion=assertion;
   return http(new Request(oauth.issuer+'/oauth2/'+endpoint,{method:'POST',headers:{host:'lifeos.nirvanachow.com','content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,...(endpoint==='token'?{resource:oauth.resource}:{}),...body,client_assertion:assertion,client_assertion_type:'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'})}));
  };
  const issue=async()=>{
   const verifierValue='v'.repeat(43),params=new URLSearchParams({client_id:clientId,redirect_uri:callback,resource:oauth.resource,response_type:'code',scope:oauth.scopes.join(' '),state:randomUUID(),code_challenge:createHash('sha256').update(verifierValue).digest('base64url'),code_challenge_method:'S256',prompt:'consent'});
   const authorized=await http(new Request(oauth.issuer+'/oauth2/authorize?'+params,{headers:{host:'lifeos.nirvanachow.com',cookie,accept:'text/html'}}));assert.equal(authorized.status,302);
   const consentUrl=new URL(authorized.headers.get('location')!,origin);assert.equal(consentUrl.pathname,'/personal/oauth');
   const consent=await http(new Request(oauth.issuer+'/oauth2/consent',{method:'POST',headers:{host:'lifeos.nirvanachow.com',origin,'content-type':'application/json',cookie},body:JSON.stringify({accept:true,oauth_query:consentUrl.search.slice(1)})}));assert.equal(consent.status,200);
   const code=new URL((await consent.json()).url).searchParams.get('code');assert.ok(code);
   const token=await protocol('token',{grant_type:'authorization_code',code,redirect_uri:callback,code_verifier:verifierValue});assert.equal(token.status,200);return await token.json() as {access_token:string;refresh_token:string};
  };
  let tokens=await issue(),state=await ledger.read(tokenIdentity(tokens.access_token));assert.ok(state);
  await t.test('official PG schema signs JWTs and real assertion PK rejects replay before resource revocation',async()=>{
   assert.ok(await verify(tokens.access_token));const before=(await admin.query('SELECT count(*)::int AS count FROM lifeos_agent.oauth_business_token WHERE revoked')).rows[0].count;
   const first=await protocol('revoke',{token:tokens.access_token,token_type_hint:'access_token'});assert.equal(first.status,200);
   const replay=await protocol('revoke',{token:tokens.access_token,token_type_hint:'access_token'},true);assert.notEqual(replay.status,200);
   assert.equal((await admin.query('SELECT count(*)::int AS count FROM lifeos_agent.oauth_business_token WHERE revoked')).rows[0].count,before+1);assert.equal(await ledger.read(tokenIdentity(tokens.access_token)),null);
  });
  // Reset only the disposable native quota between independent scenarios.
  await admin.query('DELETE FROM lifeos_platform.platform_rate_limit');tokens=await issue();state=await ledger.read(tokenIdentity(tokens.access_token));assert.ok(state);
  const original=()=>readCurrentAgentGrant(verifier,grantId),current=async(fence:NonNullable<typeof state>['oauthFence'])=>{const value=await ledger.read(fence.tokenId);return value?intersectOAuthGrant(value,await original()):null;};
  const handler=createAgentHandler({enabled:true,mountPath:'/api/platform/agent',fenceWrites:true,modules:{organization:false,classification:false},config:{ownerId,spaceId,ownerEmail:fixture.email,baseURL:origin,databaseName:fixture.database,approval:'personal-manual-v1',allowedTypes:['todo']},repository,verify:async token=>{const claims=await verify(token);if(!claims)return null;const value=await ledger.read(tokenIdentity(token));return value?intersectOAuthGrant(value,await original()):null;},readCurrentGrant:async(_id,fence)=>fence?current(fence):original(),operationAvailable:()=>true,assertWritable:async()=>{}});
  const client=new HttpBusinessClient(origin,tokens.access_token,handler,new AbortController().signal);
  await t.test('OAuth create/update/original-ID/readback/CAS use the original writer and receipt',async()=>{
   const fields={title:'Synthetic OAuth PG task',notes:'Fixture only',dueOn:null,status:'open'};
   const created=await client.execute('createTodo',{fields,idempotencyKey:'oauth-pg-create-command'});assert.equal(created.ok,true);assert.equal(created.verification?.verified,true);
   const entry=(created.data as {entry:{id:string;sourceId:string;revision:number}}).entry;
   const updated=await client.execute('updateTodo',{id:entry.id,fields:{...fields,title:'Synthetic OAuth PG updated',personal:null},expectedRevision:entry.revision,idempotencyKey:'oauth-pg-update-command'});assert.equal(updated.ok,true);assert.equal(updated.verification?.verified,true);assert.equal((updated.data as {entry:{id:string}}).entry.id,entry.id);
   const replay=await client.execute('createTodo',{fields,idempotencyKey:'oauth-pg-create-command'});assert.equal(replay.ok,true);assert.equal((replay.data as {duplicate:boolean}).duplicate,true);
   const conflict=await client.execute('updateTodo',{id:entry.id,fields:{...fields,personal:null},expectedRevision:entry.revision,idempotencyKey:'oauth-pg-conflict-command'});assert.equal(conflict.status,409);
  });
  await t.test('OAuth gate serializes provider consent mutation before an old producer fence without deadlock',async()=>{
   const hold=await admin.connect();try{
    const blocker=(await hold.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;let writer=0;
    const observed:SqlPool={connect:async()=>{const client=await runtime.connect();writer=(await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;return client;}};
    const race=new PostgresPlatformRepository(observed,true,true,{organization:false,classification:false});
    await hold.query('BEGIN');await hold.query('UPDATE lifeos_platform.platform_oauth_consent SET scopes=$1::jsonb WHERE "clientId"=$2',[JSON.stringify(['todo:read','offline_access']),clientId]);
    const rejected=race.transaction(ownerId,randomUUID(),tx=>assertAgentTodoWriteGrant(tx,{grantId,ownerId,spaceId,oauthFence:state!.oauthFence},'createTodo'));void rejected.catch(()=>{});
    await waitBlocked(admin,()=>writer,blocker);await hold.query('COMMIT');await assert.rejects(rejected,{code:'WRITE_GRANT_REVOKED'});
   }finally{await hold.query('ROLLBACK').catch(()=>{});hold.release();}
   assert.equal(await ledger.read(state!.oauthFence.tokenId),null);
  });
  await admin.query('DELETE FROM lifeos_platform.platform_rate_limit');tokens=await issue();state=await ledger.read(tokenIdentity(tokens.access_token));assert.ok(state);
  await t.test('a scope reduction that locks the original grant first rejects an earlier OAuth writer after the wait',async()=>{
   const hold=await admin.connect();try{
    const blocker=(await hold.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;let writer=0;
    const observed:SqlPool={connect:async()=>{const client=await runtime.connect();writer=(await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;return client;}};
    const race=new PostgresPlatformRepository(observed,true,true,{organization:false,classification:false});
    await hold.query('BEGIN');await hold.query('UPDATE lifeos_agent.apikey SET permissions=$1 WHERE id=$2',[JSON.stringify({todo:['read']}),grantId]);
    const rejected=race.transaction(ownerId,randomUUID(),tx=>assertAgentTodoWriteGrant(tx,{grantId,ownerId,spaceId,oauthFence:state!.oauthFence},'createTodo'));void rejected.catch(()=>{});
    await waitBlocked(admin,()=>writer,blocker);await hold.query('COMMIT');await assert.rejects(rejected,{code:'WRITE_GRANT_REVOKED'});
    const current=intersectOAuthGrant(state!,await original());assert.ok(current);assert.equal(current.allowedOperationIds.includes('createTodo'),false);assert.equal(current.allowedOperationIds.includes('getTodo'),true);
   }finally{await hold.query('ROLLBACK').catch(()=>{});hold.release();}
   await admin.query('UPDATE lifeos_agent.apikey SET permissions=$1 WHERE id=$2',[JSON.stringify({todo:['read','write']}),grantId]);
  });
  await t.test('browser expiry/deletion preserves delegated refresh while grant expiry/revoke and MFA loss deny current authority',async()=>{
   await admin.query('UPDATE lifeos_platform.platform_session SET "expiresAt"=clock_timestamp()-interval \'1 second\' WHERE id=$1',[sessionId]);assert.ok(await ledger.read(state!.oauthFence.tokenId));
   await admin.query('DELETE FROM lifeos_platform.platform_session WHERE id=$1',[sessionId]);assert.ok(await ledger.read(state!.oauthFence.tokenId));
   const refreshed=await protocol('token',{grant_type:'refresh_token',refresh_token:tokens.refresh_token});assert.equal(refreshed.status,200);const refreshedTokens=await refreshed.json();assert.ok(await ledger.read(tokenIdentity(refreshedTokens.access_token)));
   await admin.query('UPDATE lifeos_agent.apikey SET "expiresAt"=clock_timestamp()-interval \'1 second\' WHERE id=$1',[grantId]);assert.equal(await original(),null);
   await admin.query('UPDATE lifeos_agent.apikey SET "expiresAt"=clock_timestamp()+interval \'1 hour\',enabled=false WHERE id=$1',[grantId]);assert.equal(await original(),null);
   await admin.query('UPDATE lifeos_agent.apikey SET enabled=true WHERE id=$1',[grantId]);
   await admin.query('UPDATE lifeos_platform.platform_two_factor SET verified=false WHERE "userId"=$1',[ownerId]);assert.equal(await ledger.read(tokenIdentity(refreshedTokens.access_token)),null);
  });
 }finally{await Promise.allSettled([admin.end(),runtime.end(),verifier.end()]);}
});
