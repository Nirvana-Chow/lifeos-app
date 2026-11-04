import {readCurrentAgentGrant} from '../src/agent-api/runtime.ts';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {lstat, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import test from 'node:test';
import {betterAuth} from 'better-auth';
import {createAuthEndpoint} from 'better-auth/api';
import {apiKey} from '@better-auth/api-key';
import {Pool} from 'pg';
import {createPostgresKeyIssuer, readKeyIssuerConfig, type KeySummary} from '../src/agent-api/key-issuer.ts';
import {callKeyIssuer,createKeyManagementHandler} from '../src/agent-api/key-web.ts';
import {createAgentHandler} from '../src/agent-api/http.ts';
import type {AgentScope} from '../src/agent-api/capabilities.ts';
import {PostgresPlatformRepository, type SqlPool} from '../src/platform/postgres.ts';

const origin='https://agent-management.example.test';
const databaseName='lifeos_platform_test_local';
const ownerId='agent-management-owner';
const foreignId='agent-management-foreign';
const ownerEmail=ownerId+'@example.test';
const spaceId='synthetic-agent-management-space';
const sessionSecret='fixture-management-session-never-live-0000';
const agentSecret='fixture-management-agent-key-never-live-0000';

function fixtureURL(raw: string|undefined,role:string,password:string) {
  if (!raw) throw Error('Missing disposable management fixture');
  const url=new URL(raw);
  if (url.protocol!=='postgresql:'||url.hostname!=='127.0.0.1'||url.port!=='55439'||url.username!==role||
      url.password!==password||url.pathname!=='/'+databaseName||url.search||url.hash) throw Error('Unexpected management fixture target');
  return url.href;
}

// Uses Better Auth's native signing format and secure session cookie name.
// The synthetic session row is seeded with the same MFA fields as production.
const cookieAuth=betterAuth({
  baseURL:origin,secret:sessionSecret,telemetry:{enabled:false},logger:{disabled:true},
  advanced:{cookiePrefix:'lifeos-platform-candidate',useSecureCookies:true},
  plugins:[{id:'fixture-management-cookie',endpoints:{fixtureCookie:createAuthEndpoint.serverOnly({method:'POST'},
    async ctx=>{
      const token=ctx.headers?.get('x-fixture-token');
      if (!token) throw Error('Missing synthetic token');
      await ctx.setSignedCookie(ctx.context.authCookies.sessionToken.name,token,ctx.context.secret);
      return ctx.json({});
    })}}],
});
async function cookie(token: string): Promise<string> {
  const {headers}=await cookieAuth.api.fixtureCookie({headers:new Headers({'x-fixture-token':token}),returnHeaders:true});
  const value=headers.getSetCookie()[0]?.split(';')[0];
  if (!value) throw Error('Missing synthetic signed cookie');
  return value;
}

test('OPT-IN native-cookie owner MFA manages real PostgreSQL grants and uses the Agent write fence',{
  skip:process.env.RUN_AGENT_KEY_MANAGEMENT_POSTGRES_TESTS!=='1' && 'No approved isolated key management PostgreSQL target',
  timeout:30000,
},async()=>{
  const adminURL=fixtureURL(process.env.LIFEOS_AGENT_TEST_ADMIN_DATABASE_URL,'postgres','fixture-ci-admin-never-live');
  const managerURL=fixtureURL(process.env.LIFEOS_AGENT_TEST_MANAGER_DATABASE_URL,'lifeos_agent_key_manager','fixture-agent-manager-never-live');
  const runtimeURL=fixtureURL(process.env.LIFEOS_PLATFORM_TEST_DATABASE_URL,'lifeos_platform_candidate_runtime','fixture-ci-runtime-never-live');
  const verifierURL=fixtureURL(process.env.LIFEOS_AGENT_TEST_KEY_DATABASE_URL,'lifeos_agent_verifier','fixture-agent-verifier-never-live');
  const admin=new Pool({connectionString:adminURL,max:1});
  const manager=new Pool({connectionString:managerURL,max:1});
  const runtime=new Pool({connectionString:runtimeURL,max:2});
  const verifier=new Pool({connectionString:verifierURL,max:1,options:'-c search_path=lifeos_agent,pg_catalog'});
  let issuer: Awaited<ReturnType<typeof createPostgresKeyIssuer>>|undefined;
  const ready=randomUUID().replaceAll('-',''),incomplete=randomUUID().replaceAll('-',''),
    expired=randomUUID().replaceAll('-',''),foreign=randomUUID().replaceAll('-','');
  try {
    const {rows:[target]}=await admin.query('SELECT current_database() AS database,current_user AS role,version() AS version');
    assert.equal(target.database,databaseName);
    assert.equal(target.role,'postgres');
    assert.match(target.version,/^PostgreSQL 17\.11 /);
    for (const id of [ownerId,foreignId]) {
      await admin.query('INSERT INTO lifeos_platform.platform_user (id,name,email,"twoFactorEnabled") VALUES ($1,$1,$2,true)',[id,id+'@example.test']);
      await admin.query('INSERT INTO lifeos_platform.platform_two_factor (id,secret,"backupCodes","userId",verified) VALUES ($1,$2,$3,$4,true)',
        [randomUUID(),'synthetic-unused-factor','synthetic-unused-backup',id]);
    }
    for (const [token,id,verified,valid] of [[ready,ownerId,true,true],[incomplete,ownerId,false,true],[expired,ownerId,true,false],[foreign,foreignId,true,true]] as const)
      await admin.query(`INSERT INTO lifeos_platform.platform_session (id,token,"userId","expiresAt","mfaVerified")
        VALUES ($1,$2,$3,clock_timestamp()+$4::interval,$5)`,[randomUUID(),token,id,valid?'1 hour':'-1 hour',verified]);
    const grantAuth=betterAuth({baseURL:origin,secret:agentSecret,database:verifier,telemetry:{enabled:false},logger:{disabled:true},
      plugins:[apiKey({enableSessionForAPIKeys:false,enableMetadata:true,startingCharactersConfig:{shouldStore:false}})]});
    const config=readKeyIssuerConfig({socketPath:'/tmp/lifeos-agent-key-issuer.sock',baseURL:origin,databaseURL:managerURL,
      ownerId,ownerEmail,spaceId,sessionSecret,agentSecret});
    issuer=await createPostgresKeyIssuer(config);
    const handle=issuer.handle;
    const good=await cookie(ready);
    const create={name:'Synthetic 40-character managed todo key!',scopes:['todo:read','todo:write'],expiresInDays:365};
    for (const token of [incomplete,expired,foreign]) assert.equal((await handle('create',await cookie(token),create)).status,401);
    assert.equal((await handle('create',good.replace(ready,foreign),create)).status,401);
    assert.equal((await handle('create',good,{...create,expiresInDays:366})).status,400);
    await assert.rejects(manager.query('SELECT token FROM lifeos_platform.platform_session'),{code:'42501'});

    const created=await handle('create',good,create);
    assert.equal(created.status,201);
    const {grant,key}=created.body as {grant:KeySummary;key:string};
    assert.equal(grant.status,'active');
    assert.equal(grant.name,create.name);
    assert.deepEqual(grant.scopes,create.scopes);
    assert.ok(Date.parse(grant.expiresAt ?? "")-Date.now()<=365*86400*1000);
    assert.deepEqual((await handle('list',good,{})).body,{keys:[grant]});
    const socketDirectory=await mkdtemp('/tmp/lifeos-key-issuer-ci-');
    const socketPath=join(socketDirectory,'issuer.sock');
    const configPath=join(socketDirectory,'issuer.json');
    let child: ReturnType<typeof spawn>|undefined;
    try {
      await writeFile(configPath,JSON.stringify({socketPath,baseURL:origin,databaseURL:managerURL,
        ownerId,ownerEmail,spaceId,sessionSecret,agentSecret}),{mode:0o600});
      child=spawn(process.execPath,['src/agent-api/key-issuer-server.ts',configPath],{
        env:{PATH:process.env.PATH,NODE_ENV:'test'},stdio:'ignore',
      });
      let ready=false;
      for (let i=0;i<100;i++) {
        const stat=await lstat(socketPath).catch(()=>null);
        if (stat) {assert.ok(stat.isSocket());assert.equal(stat.mode&0o777,0o660);ready=true;break;}
        if (child.exitCode!==null) break;
        await delay(50);
      }
      assert.ok(ready,'Private issuer socket did not start');
      const bridge=createKeyManagementHandler(origin,(operation,session,body)=>callKeyIssuer(socketPath,operation,session,body));
      const result=await bridge(new Request(origin+'/api/platform/account/api-keys',{
        headers:{host:new URL(origin).host,cookie:good},
      }));
      assert.equal(result.status,200);
      assert.deepEqual(await result.json(),{keys:[grant]});
    } finally {
      if (child && child.exitCode===null && child.signalCode===null) {
        const closed=once(child,'exit');
        child.kill('SIGTERM');
        await closed;
      }
      await rm(socketDirectory,{recursive:true,force:true});
    }

    const otherSpace='synthetic-other-management-space';
    for (const [grantOwner,grantSpace] of [[foreignId,spaceId],[ownerId,otherSpace]]) {
      const otherId=randomUUID();
      await admin.query(`INSERT INTO lifeos_agent.apikey
        (id,"configId","referenceId",key,enabled,"createdAt","updatedAt","expiresAt",metadata,permissions)
        VALUES ($1,'default',$2,$1,true,now(),now(),now()-interval '1 second',$3,'{"todo":["read"]}')`,
      [otherId,grantOwner,JSON.stringify({spaceId:grantSpace})]);
      assert.equal((await manager.query('SELECT id FROM lifeos_agent.apikey WHERE id=$1',[otherId])).rowCount,0);
      assert.equal((await manager.query('UPDATE lifeos_agent.apikey SET enabled=false WHERE id=$1',[otherId])).rowCount,0);
      assert.equal((await manager.query('DELETE FROM lifeos_agent.apikey WHERE id=$1',[otherId])).rowCount,0);
      assert.equal((await handle('revoke',good,{id:otherId})).status,404);
      await assert.rejects(manager.query(`INSERT INTO lifeos_agent.apikey
        (id,"configId","referenceId",key,enabled,"createdAt","updatedAt","expiresAt",metadata,permissions,
         "rateLimitEnabled","rateLimitTimeWindow","rateLimitMax")
        VALUES ($1,'default',$2,$1,true,now(),now(),now()+interval '1 day',$3,'{"todo":["read"]}',true,60000,20)`,
      [randomUUID(),grantOwner,JSON.stringify({spaceId:grantSpace})]),{code:'42501'});
    }
    assert.deepEqual((await handle('list',good,{})).body,{keys:[grant]});
    await assert.rejects(manager.query('SELECT owner_id FROM lifeos_agent.key_management_binding'),{code:'42501'});
    assert.equal((await manager.query('SELECT lifeos_agent.verify_management_session($1,$2,$3) AS allowed',
      [foreign,foreignId,foreignId+'@example.test'])).rows[0].allowed,false);
    assert.equal((await manager.query('DELETE FROM lifeos_agent.apikey WHERE id=$1',[grant.id])).rowCount,0);
    await assert.rejects(manager.query('UPDATE lifeos_agent.apikey SET "expiresAt"=now() WHERE id=$1',[grant.id]),{code:'42501'});
    let revokeBeforeFence=false;
    const agent=createAgentHandler({
      enabled:true,fenceWrites:true,config:{ownerId,ownerEmail,spaceId,databaseName,baseURL:origin,
        allowedTypes:['todo'],approval:'personal-manual-v1'},
      repository:new PostgresPlatformRepository(runtime as SqlPool,true,true),
      readCurrentGrant:id=>readCurrentAgentGrant(verifier,id),
      assertWritable:async()=>{
        if (revokeBeforeFence) assert.equal((await handle('revoke',good,{id:grant.id})).status,204);
      },
      verify:async token=>{
        const result=await grantAuth.api.verifyApiKey({body:{key:token}});
        if (!result.valid || !result.key) return null;
        return {grantId:result.key.id,ownerId:result.key.referenceId,spaceId:String(result.key.metadata?.spaceId),
          scopes:(result.key.permissions?.todo??[]).map(scope=>'todo:'+scope) as AgentScope[]};
      },
    });
    const write=()=>agent(new Request(origin+'/v1/todos',{method:'POST',headers:{
      host:new URL(origin).host,authorization:'Bearer '+key,'content-type':'application/json','idempotency-key':randomUUID(),
    },body:JSON.stringify({fields:{title:'Synthetic managed grant todo',status:'open',notes:'',dueOn:null}})}));
    assert.equal((await write()).status,201);
    revokeBeforeFence=true;
    assert.equal((await write()).status,403);
    assert.equal((await write()).status,401);
    assert.deepEqual((await handle('list',good,{})).body,{keys:[{...grant,status:'revoked'}]});

    await admin.query(`INSERT INTO lifeos_agent.apikey
      (id,"configId","referenceId",key,enabled,"createdAt","updatedAt","expiresAt",metadata,permissions)
      SELECT 'synthetic-page-'||n,'default',$1,'synthetic-page-digest-'||n,false,
        now()+interval '1 minute',now(),now()+interval '1 day',$2,'{"todo":["read"]}'
      FROM generate_series(1,100) n`,[ownerId,JSON.stringify({spaceId})]);

    const legacyId='synthetic-legacy-null-enabled';
    await admin.query(`INSERT INTO lifeos_agent.apikey
      (id,"configId","referenceId",key,enabled,"createdAt","updatedAt","expiresAt",metadata,permissions)
      VALUES ($1,'default',$2,$1,NULL,now()-interval '1 day',now(),NULL,$3,'{"todo":["read"]}')`,
    [legacyId,ownerId,JSON.stringify({spaceId})]);
    const firstPage=(await handle('list',good,{})).body as {keys:KeySummary[];nextCursor:string};
    assert.equal(firstPage.keys.length,100);
    assert.ok(firstPage.nextCursor);
    assert.ok(!firstPage.keys.some(row=>row.id===grant.id));
    const secondPage=(await handle('list',good,{cursor:firstPage.nextCursor})).body as {keys:KeySummary[];nextCursor?:string};
    assert.equal(secondPage.nextCursor,undefined);
    assert.deepEqual(secondPage.keys[0],{...grant,status:'revoked'});
    assert.equal(secondPage.keys[1].id,legacyId);
    assert.equal(secondPage.keys[1].status,'active');
    assert.equal((await handle('revoke',good,{id:legacyId})).status,204);
    await admin.query('UPDATE lifeos_platform.platform_two_factor SET verified=false WHERE "userId"=$1',[ownerId]);
    assert.equal((await handle('list',good,{})).status,401);
  } finally {
    await Promise.all([issuer?.close(),admin.end(),manager.end(),runtime.end(),verifier.end()]);
  }
});
