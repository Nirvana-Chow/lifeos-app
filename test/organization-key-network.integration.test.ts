import assert from 'node:assert/strict';
import test from 'node:test';
import {spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {lstat,readFile,unlink,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {hashPassword} from 'better-auth/crypto';
import {betterAuth} from 'better-auth';
import {apiKey} from '@better-auth/api-key';
import {createPlatformAuth,authRequest,readOwnerMfaState,readOwnerPrincipal} from '../src/platform/auth.ts';
import {ownerRecoveryLock} from '../src/personal-candidate/owner-recovery-lock.ts';
import type {SqlPool} from '../src/platform/postgres.ts';
import type {KeySummary} from '../src/agent-api/key-issuer.ts';
import {callKeyIssuer} from '../src/agent-api/key-web.ts';
import {syntheticOwnerTotp,mergeSyntheticAuthCookies} from './helpers/owner-mfa-fixture.ts';
import {assertOrganizationCIContext,prepareOrganizationFixture,fixture,fixturePool,fixtureManagerURL} from './helpers/organization-stage-pg.ts';

const directory='/run/lifeos-agent-issuer',socketPath=directory+'/control.sock',configPath=directory+'/synthetic-ci.json';
const endpoint='http://127.0.0.1:3002',keyPath='/api/platform/account/api-keys';
async function stop(child:ChildProcess|undefined){
  if(child&&child.exitCode===null&&child.signalCode===null){const closed=once(child,'exit');child.kill('SIGTERM');await closed;}
}

// Removing the mounted PATCH export, socket setScopes route, native MFA requirement,
// or CAS/readback preservation must fail this actual process/HTTP/PG lifecycle.
test('OPT-IN native TOTP same-key scope lifecycle through mounted Next PATCH and private issuer socket',{
  skip:process.env.RUN_ORGANIZATION_NETWORK_TESTS!=='1'&&'Actual isolated CI Next/PG fixture not requested',timeout:90000,
},async()=>{
  await assertOrganizationCIContext();
  await prepareOrganizationFixture();
  const stat=await lstat(directory);
  assert.ok(stat.isDirectory()&&!stat.isSymbolicLink());assert.equal(stat.mode&0o777,0o700);assert.equal(stat.uid,process.getuid?.());
  for(const path of [socketPath,configPath])assert.equal(await lstat(path).catch(error=>{if(error.code==='ENOENT')return null;throw error;}),null,'Refuse to replace another issuer fixture');
  assert.ok((await readFile('.next/BUILD_ID','utf8')).trim(),'The exact source must already be built');
  const admin=fixturePool('admin'),runtime=fixturePool('runtime'),verifier=fixturePool('verifier');
  let issuer:ChildProcess|undefined,next:ChildProcess|undefined,createdConfig=false;
  const password='fixture-organization-native-password-only';
  const config={baseURL:fixture.origin,ownerId:fixture.ownerId,ownerEmail:fixture.email,secret:fixture.sessionSecret,
    databaseURL:'postgresql://lifeos_platform_candidate_runtime:fixture-ci-runtime-never-live@127.0.0.1:55440/'+fixture.database,sessionSeconds:1800};
  try{
    // First and only enrollment on this independent CI service. Never reset another fixture.
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM lifeos_platform.platform_two_factor WHERE "userId"=$1',[fixture.ownerId])).rows[0].n,0);
    await admin.query('INSERT INTO lifeos_platform.platform_account(id,"accountId","providerId","userId",password) VALUES($1,$2,\'credential\',$2,$3)',
      ['organization-native-account',fixture.ownerId,await hashPassword(password)]);
    const auth=createPlatformAuth(config,runtime,{requireMfa:true,disableSessionRefresh:true});
    const context=await auth.$context;
    const guards={requireMfa:true,readMfaState:(headers:Headers)=>readOwnerMfaState(auth,config,headers),
      withOwnerLock:ownerRecoveryLock(runtime as SqlPool,fixture.ownerId),
      trustedDeviceCookieNames:[context.createAuthCookie('trust_device').name,'__Secure-'+context.createAuthCookie('trust_device').name],
      sessionCookieNames:[context.authCookies.sessionToken.name],twoFactorCookieNames:[context.createAuthCookie('two_factor').name]};
    const authenticate=(path:string,body:Record<string,unknown>,cookie='')=>authRequest(new Request(fixture.origin+'/api/platform/auth/'+path,{
      method:'POST',headers:{host:new URL(fixture.origin).host,origin:fixture.origin,'content-type':'application/json',cookie},body:JSON.stringify(body),
    }),config,request=>auth.handler(request),guards);
    const login=await authenticate('sign-in/email',{email:fixture.email,password});assert.equal(login.status,200);
    const passwordCookie=mergeSyntheticAuthCookies(login);
    assert.equal(await readOwnerPrincipal(auth,config,new Headers({cookie:passwordCookie})),null);

    await writeFile(configPath,JSON.stringify({socketPath,baseURL:fixture.origin,databaseURL:fixtureManagerURL(),ownerId:fixture.ownerId,
      ownerEmail:fixture.email,spaceId:fixture.spaceId,sessionSecret:fixture.sessionSecret,agentSecret:fixture.agentSecret,businessScopes:'organization-v1'}),{mode:0o600,flag:'wx'});
    createdConfig=true;
    issuer=spawn(process.execPath,['src/agent-api/key-issuer-server.ts',configPath],{env:{PATH:process.env.PATH,NODE_ENV:'test'},stdio:'ignore'});
    let socketReady=false;
    for(let i=0;i<100;i++){
      const socket=await lstat(socketPath).catch(()=>null);
      if(socket){assert.ok(socket.isSocket());assert.equal(socket.mode&0o777,0o660);socketReady=true;break;}
      assert.equal(issuer.exitCode,null,'Issuer exited before readiness');await delay(50);
    }
    assert.ok(socketReady,'Private issuer socket was not ready');
    next=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3002'],{
      env:{PATH:process.env.PATH,NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',LIFEOS_PLATFORM_CANDIDATE:'1',
        LIFEOS_PLATFORM_TARGET:'isolated-test',LIFEOS_PLATFORM_BASE_URL:fixture.origin,LIFEOS_PLATFORM_TRANSPORT:'https-origin',
        LIFEOS_PLATFORM_HTTPS_HOST:new URL(fixture.origin).hostname,LIFEOS_PLATFORM_OWNER_ID:fixture.ownerId,LIFEOS_PLATFORM_OWNER_EMAIL:fixture.email,
        LIFEOS_PLATFORM_SECRET:fixture.sessionSecret,LIFEOS_PLATFORM_TEST_DATABASE_URL:config.databaseURL,LIFEOS_AGENT_KEY_MANAGEMENT:'1'},stdio:'ignore',
    });
    const send=(path:string,method='GET',body?:unknown,cookie='',extra:Record<string,string>={})=>fetch(endpoint+path,{
      method,redirect:'manual',signal:AbortSignal.timeout(10000),headers:{host:new URL(fixture.origin).host,origin:fixture.origin,
        'x-forwarded-host':new URL(fixture.origin).host,'x-forwarded-proto':'https','x-forwarded-port':'443',cookie,
        ...(body===undefined?{}:{'content-type':'application/json'}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)}),
    });
    let ready=false;
    for(let i=0;i<100;i++){
      const response=await send(keyPath).catch(()=>null);
      if(response?.status===401){ready=true;break;}
      assert.equal(next.exitCode,null,'Next exited before mounted route readiness');await delay(100);
    }
    assert.ok(ready,'Mounted key-management route did not become ready');
    const create={name:'Synthetic native same-key organization access',scopes:['todo:read'],expiresInDays:7};
    assert.equal((await send(keyPath,'POST',create,passwordCookie)).status,401,'Password-only native session cannot create grants');
    const enabled=await authenticate('two-factor/enable',{password,method:'totp'},passwordCookie);assert.equal(enabled.status,200);
    const verified=await authenticate('two-factor/verify-totp',{code:await syntheticOwnerTotp(auth,fixture.ownerId)},mergeSyntheticAuthCookies(enabled,passwordCookie));
    assert.equal(verified.status,200);const cookie=mergeSyntheticAuthCookies(verified,passwordCookie);
    assert.equal((await readOwnerPrincipal(auth,config,new Headers({cookie})))?.userId,fixture.ownerId);
    assert.deepEqual((await admin.query('SELECT "twoFactorEnabled" AS enabled,(SELECT verified FROM lifeos_platform.platform_two_factor WHERE "userId"=$1) AS verified FROM lifeos_platform.platform_user WHERE id=$1',[fixture.ownerId])).rows,[{enabled:true,verified:true}]);
    const response=await send(keyPath,'POST',create,cookie);assert.equal(response.status,201);
    let {grant,key}=await response.json() as {grant:KeySummary;key:string};
    assert.match(grant.grantDigest??'',/^[a-f0-9]{64}$/);
    const originalGrant=grant,initialDigest=grant.grantDigest;
    const identity=async()=>(await admin.query('SELECT id,key,"referenceId",metadata,"createdAt","expiresAt" FROM lifeos_agent.apikey WHERE id=$1',[grant.id])).rows[0];
    const originalIdentity=await identity();
    const keyAuth=betterAuth({baseURL:fixture.origin,secret:fixture.agentSecret,database:verifier,telemetry:{enabled:false},logger:{disabled:true},
      plugins:[apiKey({enableSessionForAPIKeys:false,enableMetadata:true,startingCharactersConfig:{shouldStore:false}})]});
    const verify=()=>keyAuth.api.verifyApiKey({body:{key}});
    assert.equal((await verify()).valid,true);
    const listed=await (await send(keyPath,'GET',undefined,cookie)).json();
    assert.equal(listed.keys.find((value:KeySummary)=>value.id===grant.id).grantDigest,initialDigest,'Usage leaves scope digest unchanged');
    assert.ok(listed.availableScopes.includes('organization:read'));
    const path=keyPath+'/'+grant.id+'/scopes';
    const body={expectedGrantDigest:initialDigest,scopes:['todo:read','organization:read','organization:write']};
    assert.equal((await send(path,'PATCH',body,passwordCookie)).status,401);
    assert.equal((await send(path,'PATCH',body,cookie,{authorization:'Bearer '+key})).status,401);
    assert.equal((await send(path,'PATCH',body,cookie,{origin:'https://foreign.example.test'})).status,403);
    assert.equal((await send(path,'PATCH',{...body,ownerId:'foreign-owner'},cookie)).status,400);
    const changed=await send(path,'PATCH',body,cookie);assert.equal(changed.status,200,'Actual mounted PATCH reaches the real socket setScopes operation');
    const changedBody=await changed.json();assert.deepEqual(Object.keys(changedBody),['grant']);grant=changedBody.grant;
    assert.deepEqual(grant.scopes,body.scopes);assert.notEqual(grant.grantDigest,initialDigest);
    assert.equal(grant.id,originalGrant.id);assert.equal(grant.expiresAt,originalGrant.expiresAt);
    assert.ok(JSON.stringify(await identity())===JSON.stringify(originalIdentity),'Scope update preserves secret, identity and expiry');
    const verifiedKey=await verify();assert.equal(verifiedKey.valid,true);assert.deepEqual(verifiedKey.key?.permissions,{todo:['read'],organization:['read','write']});
    assert.equal((await send(path,'PATCH',body,cookie)).status,409,'Stale digest rejected by mounted route');
    assert.deepEqual((await (await send(keyPath,'GET',undefined,cookie)).json()).keys.find((value:KeySummary)=>value.id===grant.id),grant);
    // Direct socket operation proves its independently registered POST route and exact input codec.
    const reduced=await callKeyIssuer(socketPath,'setScopes',cookie,{id:grant.id,expectedGrantDigest:grant.grantDigest,scopes:['todo:read']});
    assert.equal(reduced.status,200);grant=(await reduced.json()).grant;
    assert.deepEqual((await verify()).key?.permissions,{todo:['read']});
    assert.deepEqual((await (await send(keyPath,'GET',undefined,cookie)).json()).keys.find((value:KeySummary)=>value.id===grant.id),grant);
    const audit=(await admin.query('SELECT before_permissions,after_permissions FROM lifeos_agent.grant_scope_audit WHERE grant_id=$1 ORDER BY changed_at',[grant.id])).rows;
    assert.equal(audit.length,2);assert.deepEqual(audit[1].after_permissions,{todo:['read']});
    assert.equal((await send(keyPath+'/'+grant.id,'DELETE',undefined,cookie)).status,204);
    assert.equal((await verify()).valid,false);
    assert.equal((await send(path,'PATCH',{expectedGrantDigest:grant.grantDigest,scopes:body.scopes},cookie)).status,403);
    assert.ok(JSON.stringify(await identity())===JSON.stringify(originalIdentity),'Revoke also preserves the original secret and expiry');
  }finally{
    await stop(next);await stop(issuer);
    if(createdConfig){await unlink(configPath);await unlink(socketPath).catch(error=>{if(error.code!=='ENOENT')throw error;});}
    await Promise.all([admin.end(),runtime.end(),verifier.end()]);
  }
});
