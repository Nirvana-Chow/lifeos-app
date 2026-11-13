import assert from 'node:assert/strict';import test from 'node:test';import {randomUUID,createHmac,createHash} from 'node:crypto';import {setTimeout as delay} from 'node:timers/promises';
import type {PlatformAuth} from '../src/platform/auth.ts';import {createPlatformAuth,readVerifiedOwnerSession} from '../src/platform/auth.ts';
import {ownerRecoveryLock} from '../src/personal-candidate/owner-recovery-lock.ts';
import {createManagedClientHandler} from '../src/business-mcp-oauth/managed-client-http.ts';import {registerManagedClient,readManagedClient} from '../src/business-mcp-oauth/managed-client.ts';
import {verifyBusinessOAuthPool} from '../src/business-mcp-oauth/readiness.ts';
import {BusinessOAuthLedger,validateBusinessClaims,intersectOAuthGrant,tokenIdentity} from '../src/business-mcp-oauth/ledger.ts';import {createBusinessOAuthHttp} from '../src/business-mcp-oauth/http.ts';
import {managedChatGptClientId} from '../src/business-mcp-oauth/managed-client-contract.ts';import {requireMcpAuth} from '@better-auth/mcp';import {verifyOAuthQueryParams} from '@better-auth/oauth-provider';
import {readCurrentAgentGrant} from '../src/agent-api/runtime.ts';import {createAgentHandler} from '../src/agent-api/http.ts';import {PostgresPlatformRepository} from '../src/platform/postgres.ts';import {HttpBusinessClient} from '../src/mcp-http/business-client.ts';
import {prepareBusinessOAuthFixture} from './helpers/business-mcp-oauth-stage-pg.ts';import {requirementsFixture as f,requirementsFixturePool as pool} from './helpers/requirements-stage-pg.ts';

test('OPT-IN fresh PG fixed managed registration has real uniqueness unknown recovery MFA serialization and max3 pool capacity',{
 skip:process.env.RUN_BUSINESS_MCP_MANAGED_CLIENT_POSTGRES_TESTS!=='1'&&'Separate fresh SSH-loopback managed-client PG qualification required; not executed',timeout:30000,
},async t=>{
 await prepareBusinessOAuthFixture();const admin=pool('admin',2),runtime=pool('runtime',3),verifier=pool('verifier',1),ownerId=f.ownerId,spaceId=f.spaceId,grantId=randomUUID();
 const origin='https://lifeos.nirvanachow.com',oauth={resource:origin+'/api/platform/mcp',issuer:origin+'/api/platform/auth',grantId,scopes:['todo:read','todo:write','offline_access']},config={baseURL:origin,ownerId,ownerEmail:f.email,secret:f.sessionSecret,databaseURL:'',sessionSeconds:1800};
 const sessionToken='synthetic-managed-session-'+randomUUID(),cookie='__Secure-lifeos-platform-candidate.session_token='+encodeURIComponent(sessionToken+'.'+createHmac('sha256',f.sessionSecret).update(sessionToken).digest('base64'));
 const command={callback:'https://chatgpt.com/connector/oauth/fixturePGcallback1',commandId:randomUUID()},headers=new Headers({host:'lifeos.nirvanachow.com',origin,cookie,'x-platform-client':'127.0.0.1'});
 try{
  await admin.query('INSERT INTO lifeos_agent.apikey(id,"configId","referenceId",key,enabled,"createdAt","updatedAt","expiresAt",metadata,permissions) VALUES($1,\'default\',$2,$3,true,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval \'2 hours\',$4,$5)',[grantId,ownerId,'synthetic-managed-unusable-digest',JSON.stringify({spaceId}),JSON.stringify({todo:['read','write']})]);
  await admin.query('UPDATE lifeos_agent.oauth_business_control SET enabled=true,grant_id=$1,owner_email=$2,scopes=$3',[grantId,f.email,oauth.scopes]);
  await admin.query('INSERT INTO lifeos_platform.platform_session(id,token,"userId","expiresAt","mfaVerified") VALUES($1,$2,$3,clock_timestamp()+interval \'30 minutes\',true)',[randomUUID(),sessionToken,ownerId]);
  const auth=createPlatformAuth(config,runtime,{requireMfa:true,businessOAuth:oauth,disableSessionRefresh:true}),readAuth=createPlatformAuth(config,runtime,{requireMfa:true,disableSessionRefresh:true,readOnlySessions:true});await auth.$context;
  const ready=()=>verifyBusinessOAuthPool(runtime,oauth,{ownerId,ownerEmail:f.email,spaceId}),lock=ownerRecoveryLock(runtime,ownerId);
  const handler=createManagedClientHandler({auth,config:oauth,platform:config,owner:h=>readVerifiedOwnerSession(readAuth,config,h),assertReady:ready,withOwnerLock:lock});
  const request=(method:string,body=command)=>handler(new Request(origin+'/api/platform/business-mcp/client',{method,headers:{...Object.fromEntries(headers),'content-type':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{})}));
  await t.test('fixed missing SDK projection remains absent without CIMD discovery',async()=>{assert.deepEqual(await readManagedClient(auth,oauth,ownerId),{registered:false});assert.equal((await request('GET')).status,200);});
  await t.test('two real transactions arbitrate fixed ID uniqueness and recover a lost successful response',async()=>{
   const hold=await admin.connect();try{
    await hold.query('BEGIN');await hold.query('LOCK TABLE lifeos_platform.platform_oauth_client IN SHARE MODE');
    const lost={...auth,api:{...auth.api,adminCreateOAuthClient:Object.assign(async(args:Parameters<typeof auth.api.adminCreateOAuthClient>[0])=>{await auth.api.adminCreateOAuthClient(args);throw Error('Synthetic post-commit response lost');},auth.api.adminCreateOAuthClient)}} satisfies PlatformAuth;
    const first=registerManagedClient(lost,oauth,ownerId,headers,command),second=registerManagedClient(auth,oauth,ownerId,headers,command);void first.catch(()=>{});void second.catch(()=>{});
    const deadline=Date.now()+4000;let blocked=0;while(Date.now()<deadline){blocked=(await hold.query("SELECT count(*)::int AS count FROM pg_locks WHERE relation='lifeos_platform.platform_oauth_client'::regclass AND mode='RowExclusiveLock' AND NOT granted")).rows[0].count;if(blocked===2)break;await delay(10);}assert.equal(blocked,2,'Both actual provider transactions must reach the insert lock barrier');
    await hold.query('COMMIT');const values=await Promise.all([first,second]);assert.ok(values.every(v=>v.state.registered&&v.state.commandId===command.commandId));
   }finally{await hold.query('ROLLBACK').catch(()=>{});hold.release();}
   assert.equal((await admin.query('SELECT count(*)::int AS count FROM lifeos_platform.platform_oauth_client')).rows[0].count,1);assert.equal((await admin.query('SELECT count(*)::int AS count FROM lifeos_platform.platform_oauth_client_resource')).rows[0].count,1);
  });
  await t.test('owner HTTP duplicate and independent GET preserve configuration without any consent or token',async()=>{
   const duplicate=await request('POST');assert.equal(duplicate.status,200);assert.equal((await duplicate.json()).duplicate,true);
   const readback=await request('GET');assert.equal(readback.status,200);assert.equal((await readback.json()).configuration.commandId,command.commandId);
   assert.equal((await request('POST',{...command,commandId:randomUUID()})).status,409);
   for(const table of ['platform_oauth_consent','platform_oauth_access_token','platform_oauth_refresh_token'])assert.equal((await admin.query('SELECT count(*)::int AS count FROM lifeos_platform.'+table)).rows[0].count,0);
   assert.ok(runtime.totalCount<=3);
  });
  await t.test('registered provided none uses signed consent S256 and the original CRUD writer and current-grant fence',async()=>{
   const ledger=new BusinessOAuthLedger(runtime,oauth,ownerId,spaceId);
   const verify=async(token:string):Promise<ReturnType<typeof validateBusinessClaims>>=>{let claims:ReturnType<typeof validateBusinessClaims>=null;await requireMcpAuth(auth,(_r,value)=>{claims=validateBusinessClaims(value,oauth,ownerId);return new Response(null,{status:204});},{resource:oauth.resource,issuer:oauth.issuer})(new Request(oauth.resource,{headers:{authorization:'Bearer '+token}}));return claims;};
   const http=createBusinessOAuthHttp({origin,config:oauth,assertReady:ready,owner:h=>readVerifiedOwnerSession(readAuth,config,h),handler:r=>auth.handler(r),verifyQuery:q=>verifyOAuthQueryParams(q,config.secret),verifyToken:verify,ledger});
   const codeVerifier='v'.repeat(43),params=new URLSearchParams({client_id:managedChatGptClientId,redirect_uri:command.callback,resource:oauth.resource,response_type:'code',scope:oauth.scopes.join(' '),state:randomUUID(),code_challenge:createHash('sha256').update(codeVerifier).digest('base64url'),code_challenge_method:'S256',prompt:'consent'});
   const authorize=await http(new Request(oauth.issuer+'/oauth2/authorize?'+params,{headers:{host:'lifeos.nirvanachow.com',cookie,accept:'text/html'}}));assert.equal(authorize.status,302);
   const consentURL=new URL(authorize.headers.get('location')!,origin);assert.equal(consentURL.pathname,'/personal/oauth');
   const consent=await http(new Request(oauth.issuer+'/oauth2/consent',{method:'POST',headers:{host:'lifeos.nirvanachow.com',origin,cookie,'content-type':'application/json'},body:JSON.stringify({accept:true,oauth_query:consentURL.search.slice(1)})}));assert.equal(consent.status,200);
   const code=new URL((await consent.json()).url).searchParams.get('code');assert.ok(code);
   const response=await http(new Request(oauth.issuer+'/oauth2/token',{method:'POST',headers:{host:'lifeos.nirvanachow.com','content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:managedChatGptClientId,grant_type:'authorization_code',code,redirect_uri:command.callback,resource:oauth.resource,code_verifier:codeVerifier})}));assert.equal(response.status,200);
   const token=(await response.json()).access_token;assert.equal(typeof token,'string');assert.ok(await verify(token));const state=await ledger.read(tokenIdentity(token));assert.ok(state);
   const original=()=>readCurrentAgentGrant(verifier,grantId),current=async()=>{const value=await ledger.read(tokenIdentity(token));return value?intersectOAuthGrant(value,await original()):null;};
   const agent=createAgentHandler({enabled:true,mountPath:'/api/platform/agent',fenceWrites:true,modules:{organization:false,classification:false},config:{ownerId,ownerEmail:f.email,spaceId,baseURL:origin,databaseName:f.database,approval:'personal-manual-v1',allowedTypes:['todo']},repository:new PostgresPlatformRepository(runtime,true,true,{organization:false,classification:false}),verify:async raw=>{const claims=await verify(raw);if(!claims)return null;const value=await ledger.read(tokenIdentity(raw));return value&&value.oauthFence.expiresAt===claims.exp?intersectOAuthGrant(value,await original()):null;},readCurrentGrant:async(id,fence)=>{if(id!==grantId||!fence)return null;const value=await ledger.read(fence.tokenId);return value&&value.oauthFence.bindingId===fence.bindingId&&value.oauthFence.bindingRevision===fence.bindingRevision?intersectOAuthGrant(value,await original()):null;},operationAvailable:()=>true,assertWritable:async()=>{}});
   const client=new HttpBusinessClient(origin,token,agent,new AbortController().signal),fields={title:'Synthetic managed none task',notes:'Fixture only',dueOn:null,status:'open'};
   const created=await client.execute('createTodo',{fields,idempotencyKey:'managed-none-create-'+randomUUID()});assert.equal(created.ok,true);assert.equal(created.verification?.verified,true);
   const entry=(created.data as {entry:{id:string;revision:number}}).entry;
   const updated=await client.execute('updateTodo',{id:entry.id,fields:{...fields,title:'Synthetic managed none updated',personal:null},expectedRevision:entry.revision,idempotencyKey:'managed-none-update-'+randomUUID()});assert.equal(updated.ok,true);assert.equal(updated.verification?.verified,true);assert.equal((updated.data as {entry:{id:string}}).entry.id,entry.id);
   const fetched=await client.execute('getTodo',{id:entry.id});assert.equal(fetched.ok,true);
   await admin.query('UPDATE lifeos_agent.apikey SET enabled=false WHERE id=$1',[grantId]);assert.equal(await current(),null);
   const denied=await agent(new Request(origin+'/api/platform/agent/v1/todos/'+entry.id,{headers:{host:'lifeos.nirvanachow.com',authorization:'Bearer '+token}}));
   assert.equal(denied.status,401);assert.deepEqual(await denied.json(),{error:'AUTH_REQUIRED'});
   assert.deepEqual(await client.execute('getTodo',{id:entry.id}),{ok:false,status:403,error:'API_DISCOVERY_UNAVAILABLE'});
   await admin.query('UPDATE lifeos_agent.apikey SET enabled=true WHERE id=$1',[grantId]);
  });
  await t.test('the original maintenance lock and current MFA prevent registration reads or changes during reset',async()=>{
   await lock(async()=>{await admin.query('UPDATE lifeos_platform.platform_two_factor SET verified=false WHERE "userId"=$1',[ownerId]);const busy=await request('POST');assert.equal(busy.status,409);assert.equal((await busy.json()).error.code,'OWNER_ACCOUNT_BUSY');});
   assert.equal((await request('POST')).status,401);assert.equal((await request('GET')).status,401);
   await admin.query('UPDATE lifeos_platform.platform_two_factor SET verified=true WHERE "userId"=$1',[ownerId]);
   assert.equal((await request('GET')).status,200);assert.ok(runtime.totalCount<=3);
  });
 }finally{await Promise.allSettled([admin.end(),runtime.end(),verifier.end()]);}
});
