import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {betterAuth} from 'better-auth';
import {apiKey,defaultKeyHasher} from '@better-auth/api-key';
import {articleFenceReady} from '../src/personal-article/agent-permission.ts';
import {readAgentBusinessModules} from '../src/agent-api/config.ts';
import {readCurrentAgentGrant} from '../src/agent-api/runtime.ts';
import {createAgentHandler} from '../src/agent-api/http.ts';
import {PostgresPlatformRepository,verifyRestrictedPool,type SqlPool} from '../src/platform/postgres.ts';

test('OPT-IN isolated restricted PostgreSQL qualifies dedicated Article credentials and the native CAS writer',{
 skip:process.env.RUN_ARTICLE_AGENT_PG!=='1'&&'Requires a new disposable PostgreSQL 17 fixture',
 timeout:30_000,
},async()=>{
 const port=Number(process.env.LIFEOS_ARTICLE_FIXTURE_PORT);
 assert.ok(Number.isInteger(port)&&port>=1024&&port<=65535);
 const database='lifeos_platform_test_local',runtimeRole='lifeos_platform_candidate_runtime',verifierRole='lifeos_agent_verifier';
 const options={host:'127.0.0.1',database,port,max:2,statement_timeout:5000};
 const admin=new Pool({...options,user:'postgres',password:'fixture-only-admin-168',max:1});
 const runtime=new Pool({...options,user:runtimeRole,password:'article-fixture-runtime'});
 const verifier=new Pool({...options,user:verifierRole,password:'article-fixture-verifier',options:'-c search_path=lifeos_agent,pg_catalog'});
 const owner='article-synthetic-owner',foreign='article-synthetic-foreign',space='article-synthetic-space';
 const baseURL='https://article.example.test';
 const config={ownerId:owner,ownerEmail:'owner@example.test',spaceId:space,databaseName:database,allowedTypes:['todo','journal'],articleEnabled:true,approval:'personal-manual-v1',baseURL} as const;
 try{
  const found=(await admin.query(`SELECT current_database() AS database, current_user AS role,
    current_setting('server_version_num')::int AS version,
    to_regnamespace('lifeos_platform') AS platform,to_regnamespace('lifeos_agent') AS agent`)).rows[0];
  assert.deepEqual({...found,version:Math.floor(found.version/10000)},{database,role:'postgres',version:17,platform:null,agent:null});
  for(const [role,password] of [[runtimeRole,'article-fixture-runtime'],[verifierRole,'article-fixture-verifier'],['lifeos_agent_issuer','article-fixture-issuer']])
   await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`);
  await admin.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC; SET lifeos.calendar_migration_approved='1'; SET lifeos.chat_migration_approved='1'");
  const migrate=(file:string)=>admin.query(readFileSync(new URL('../db/'+file,import.meta.url),'utf8'));
  for(const file of ['0001_platform_candidate.sql','0002_platform_inbox.sql','0003_ai_settings.proposed.sql','0004_calendar.proposed.sql','0005_ai_chat.proposed.sql'])await migrate(file);
  await admin.query("ALTER TABLE lifeos_platform.platform_session ADD COLUMN \"mfaVerified\" boolean NOT NULL DEFAULT false; SET lifeos.agent_migration_approved='1'; SET lifeos.agent_expected_database='lifeos_platform_test_local'");
  await migrate('0006_agent_api.proposed.sql');
  await verifyRestrictedPool(runtime as SqlPool);
  assert.equal(await articleFenceReady(runtime),false);
  await admin.query("SET lifeos.article_agent_migration_approved='1'");
  await migrate('0027_article_agent_grants.proposed.sql');
  assert.equal(await articleFenceReady(runtime),true);
  assert.equal(await articleFenceReady(verifier),false);
  await assert.rejects(runtime.query('SELECT id FROM lifeos_agent.apikey'),{code:'42501'});
  for(const id of [owner,foreign])await admin.query('INSERT INTO lifeos_platform.platform_user(id,name,email) VALUES($1,$1,$2)',[id,id+'@example.test']);
  const seed=async(actions:string[],binding=owner,metadata:unknown={spaceId:space,articleAccess:'article-v1'},permissions:unknown={article:actions})=>{
   const token='synthetic-article-'+randomUUID(),id=randomUUID();
   await admin.query(`INSERT INTO lifeos_agent.apikey(id,"configId","referenceId",key,enabled,"createdAt","updatedAt","expiresAt",metadata,permissions)
    VALUES($1,'default',$2,$3,true,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '1 hour',$4,$5)`,
    [id,binding,await defaultKeyHasher(token),JSON.stringify(metadata),JSON.stringify(permissions)]);
   return {token,id};
  };
  const writer=await seed(['read','write']),reader=await seed(['read']),other=await seed(['read','write'],foreign);
  const legacy=await seed([],owner,{spaceId:space},{todo:['read','write']});
  const rogue=await seed([],owner,{spaceId:space,articleAccess:'article-v1'},{article:['read'],todo:['read']});
  const auth=betterAuth({baseURL,secret:'synthetic-article-native-api-secret-168',database:verifier,logger:{disabled:true},telemetry:{enabled:false},
   plugins:[apiKey({enableSessionForAPIKeys:false,enableMetadata:true,startingCharactersConfig:{shouldStore:false}})]});
  const active=readAgentBusinessModules({LIFEOS_AGENT_ARTICLE:'article-v1'},config);
  const repository=new PostgresPlatformRepository(runtime as SqlPool,true,true,active);
  const handler=(enabled:boolean)=>createAgentHandler({config,repository,enabled:true,fenceWrites:true,
   modules:enabled?active:readAgentBusinessModules({},config),operationAvailable:()=>articleFenceReady(runtime),
   assertWritable:async()=>{},readCurrentGrant:id=>readCurrentAgentGrant(verifier,id,undefined,false,enabled),
   verify:async token=>{const result=await auth.api.verifyApiKey({body:{key:token}});
    return result.valid&&result.key?readCurrentAgentGrant(verifier,result.key.id,undefined,false,enabled):null;},
  });
  const send=async(token:string,path:string,method='GET',body?:unknown,key=randomUUID(),enabled=true)=>{
   const response=await handler(enabled)(new Request(baseURL+path,{method,
    headers:{host:'article.example.test',origin:baseURL,authorization:'Bearer '+token,'content-type':'application/json','idempotency-key':key},
    ...(body?{body:JSON.stringify(body)}:{})}));
   return {status:response.status,body:await response.json()};
  };
  const discover=async(token:string)=>(await send(token,'/v2/capabilities')).body.operations.map((operation:{id:string})=>operation.id).sort();
  assert.deepEqual(await discover(writer.token),['createArticle','discoverV2','getArticle','snapshotArticle','updateArticle']);
  assert.deepEqual(await discover(reader.token),['discoverV2','getArticle','snapshotArticle']);
  assert.equal((await discover(legacy.token)).some((id:string)=>id.endsWith('Article')),false);
  assert.equal((await send(rogue.token,'/v2/capabilities')).status,401);
  const path='/v1/records/article';
  const fields={title:'Synthetic article',text:'Full literal source.\n\nSecond paragraph.',occurredOn:null,personal:{type:'article',schemaVersion:1,attribution:'excerpt',author:null,sourceURL:'https://source.example.test/article'}};
  const key=randomUUID();
  assert.equal((await send(writer.token,path+'/snapshot','GET',undefined,key,false)).status,404);
  assert.equal((await send(reader.token,path,'POST',{fields})).status,403);
  assert.equal((await send(other.token,path+'/snapshot')).status,403);
  const first=await send(writer.token,path,'POST',{fields},key);
  assert.equal(first.status,201,JSON.stringify(first.body));
  const {id,sourceId}=first.body.entry;
  assert.deepEqual((await send(reader.token,path+'/'+id)).body.entry,{type:'article',id,sourceId,revision:1,fields});
  const updated={...fields,text:'Revised full text.'};
  assert.equal((await send(writer.token,path+'/'+id,'PATCH',{fields:updated,expectedRevision:1})).status,200);
  assert.equal((await send(writer.token,path+'/'+id,'PATCH',{fields,expectedRevision:1})).status,409);
  assert.deepEqual((await send(reader.token,path+'/snapshot')).body.items,[{type:'article',id,sourceId,revision:2,fields:updated}]);
  assert.equal((await send(writer.token,path,'POST',{fields},key)).body.duplicate,true);
  assert.equal(await repository.get(foreign,'inbox',id),null);
  assert.equal((await runtime.query('SELECT count(*)::int n FROM lifeos_platform.platform_record')).rows[0].n,0);
  const socket=await runtime.connect();
  try{
   await socket.query('BEGIN');
   const lock=(credential:string,ownerId:string,spaceId:string,scopes:string[],operation:string)=>socket.query('SELECT lifeos_agent.assert_article_grant($1,$2,$3,$4,$5) allowed',[credential,ownerId,spaceId,scopes,operation]).then(result=>result.rows[0].allowed);
   const write=['article:read','article:write'];
   assert.equal(await lock(writer.id,owner,space,write,'updateArticle'),true);
   assert.equal(await lock(reader.id,owner,space,write,'updateArticle'),false);
   assert.equal(await lock(writer.id,foreign,space,write,'updateArticle'),false);
   assert.equal(await lock(writer.id,owner,'another-space',write,'updateArticle'),false);
   assert.equal(await lock(writer.id,owner,space,write,'updateTodo'),false);
   const revoke=await admin.connect();
   try{
    await revoke.query('BEGIN');
    await revoke.query("SET LOCAL lock_timeout='200ms'");
    await assert.rejects(revoke.query('UPDATE lifeos_agent.apikey SET enabled=false WHERE id=$1',[writer.id]),{code:'55P03'});
   }finally{await revoke.query('ROLLBACK');revoke.release();}
  }finally{await socket.query('ROLLBACK');socket.release();}
  await admin.query('UPDATE lifeos_agent.apikey SET enabled=false WHERE id=$1',[writer.id]);
  assert.equal((await send(writer.token,path,'POST',{fields},key)).status,401);
  assert.deepEqual((await send(reader.token,path+'/snapshot')).body.items,[{type:'article',id,sourceId,revision:2,fields:updated}]);
  console.log('ARTICLE_AGENT_PG_PASS dedicated read/write discovery, restricted roles, source readback, CAS, exact replay, lock and revocation');
 }finally{await Promise.all([admin.end(),runtime.end(),verifier.end()]);}
});
