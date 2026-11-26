import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {betterAuth} from 'better-auth';
import {apiKey,defaultKeyHasher} from '@better-auth/api-key';
import {createAgentHandler} from '../src/agent-api/http.ts';
import {agentCapabilityOperations,businessMcpOperations} from '../src/agent-api/capabilities.ts';
import {readAgentBusinessModules} from '../src/agent-api/config.ts';
import {agentOperationAvailable,readCurrentAgentGrant} from '../src/agent-api/runtime.ts';
import {assertLearningWriteFence,learningFenceReady} from '../src/personal-learning/agent-permission.ts';
import {handleLearningRequest} from '../src/personal-learning/http.ts';
import {PostgresLearningRepository,verifyLearningPostgres} from '../src/personal-learning/postgres.ts';
import {LearningService} from '../src/personal-learning/service.ts';
import {PlatformError} from '../src/platform/domain.ts';
import {PostgresPlatformRepository,type SqlPool} from '../src/platform/postgres.ts';
import {DraftService} from '../src/platform/service.ts';
import {RecordsService} from '../src/records-candidate/service.ts';

test('OPT-IN learning credentials, web, and the original Agent router share the restricted PostgreSQL writer',{
 skip:process.env.RUN_LEARNING_AGENT_PG!=='1'&&'Requires an approved new disposable PostgreSQL 17 fixture',timeout:45000,
},async t=>{
 const port=Number(process.env.LEARNING_FIXTURE_PG_PORT);
 assert.ok(Number.isInteger(port)&&port>=1024&&port<=65535);
 const database='lifeos_platform_test_local',ownerId='learning-fixture-owner',spaceId='learning-fixture-space';
 const binding={ownerId,spaceId};
 const options={host:'127.0.0.1',database,port,max:4,statement_timeout:5000};
 const admin=new Pool({...options,user:'postgres',password:'fixture-ci-admin-never-live',max:1});
 const runtime=new Pool({...options,user:'lifeos_platform_candidate_runtime',password:'fixture-ci-runtime-never-live'});
 const verifier=new Pool({...options,user:'lifeos_agent_verifier',password:'learning-fixture-verifier',options:'-c search_path=lifeos_agent,pg_catalog'});
 t.after(async()=>{await Promise.all([admin.end(),runtime.end(),verifier.end()]);});
 const target=(await admin.query(`SELECT current_database() AS database,current_user AS role,
  current_setting('server_version_num')::int AS version,
  to_regnamespace('lifeos_platform') AS platform,to_regnamespace('lifeos_agent') AS agent`)).rows[0];
 assert.deepEqual(target,{database,role:'postgres',version:170011,platform:null,agent:null});
 for(const [role,password] of [['lifeos_platform_candidate_runtime','fixture-ci-runtime-never-live'],['lifeos_agent_verifier','learning-fixture-verifier'],['lifeos_agent_issuer','learning-fixture-issuer']]) {
  await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`);
 }
 await admin.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC; SET lifeos.calendar_migration_approved='1'; SET lifeos.chat_migration_approved='1'");
 const migrate=(name:string)=>admin.query(readFileSync(new URL('../db/'+name,import.meta.url),'utf8'));
 for(const name of ['0001_platform_candidate.sql','0002_platform_inbox.sql','0003_ai_settings.proposed.sql','0004_calendar.proposed.sql','0005_ai_chat.proposed.sql'])await migrate(name);
 await admin.query(`ALTER TABLE lifeos_platform.platform_session ADD COLUMN "mfaVerified" boolean NOT NULL DEFAULT false;
  SET lifeos.agent_migration_approved='1'; SET lifeos.agent_expected_database='lifeos_platform_test_local';
  SET lifeos.learning_migration_approved='learning-vocabulary-v1';
  SET lifeos.agent_expected_owner='learning-fixture-owner'; SET lifeos.agent_expected_space='learning-fixture-space';
  INSERT INTO lifeos_platform.platform_user(id,name,email) VALUES ('learning-fixture-owner','Synthetic','learning@example.test')`);
 await migrate('0006_agent_api.proposed.sql');
 await migrate('0027_learning_vocabulary.proposed.sql');
 await verifyLearningPostgres(runtime as SqlPool);
 assert.equal(await learningFenceReady(runtime),false);

 const repository=new PostgresPlatformRepository(runtime as SqlPool,true,true);
 const oldRecords=new RecordsService(new DraftService(repository));
 const oldResource=await oldRecords.create(ownerId,'resource',{title:'Synthetic original collection',text:'original material',occurredOn:null,confirmed:true,syntheticOnly:true,
  record:{type:'resource',syntheticOnly:true,url:'https://resource.example.test/item',author:null}},'learning-original-collection');
 const oldValue=await oldRecords.get(ownerId,'resource',oldResource.entry.id,{includeSynthetic:true});
 const seed=async(metadata:unknown,permissions:unknown)=>{
  const token='synthetic-learning-'+randomUUID(),id=randomUUID();
  await admin.query(`INSERT INTO lifeos_agent.apikey(id,"configId","referenceId",key,enabled,"createdAt","updatedAt","expiresAt",metadata,permissions)
    VALUES($1,'default',$2,$3,true,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '1 hour',$4,$5)`,
   [id,ownerId,await defaultKeyHasher(token),JSON.stringify(metadata),JSON.stringify(permissions)]);
  return {token,id};
 };
 const writer=await seed({spaceId,learningAccess:'learning-v1'},{learning:['read','write']});
 const reader=await seed({spaceId,learningAccess:'learning-v1'},{learning:['read']});
 const legacy=await seed({spaceId},{todo:['read','write']});
 const wide=await seed({spaceId,businessDataPolicy:'all-personal-business-v1'},{todo:['read','write']});
 const mixed=await seed({spaceId,learningAccess:'learning-v1'},{learning:['read'],todo:['read']});
 const foreign=await seed({spaceId:'different-learning-space',learningAccess:'learning-v1'},{learning:['read','write']});
 const policyOptions=async()=>({...binding,policyEnabled:true,registry:agentCapabilityOperations,operationAvailable:()=>true});
 const ownerLearning=new LearningService(new PostgresLearningRepository(runtime as SqlPool));
 let origin:string, router:ReturnType<typeof createAgentHandler>,enabled=false,lose=false,revokeBeforeFence=false;
 const server=createServer(async(incoming,outgoing)=>{
  try{
   const chunks:Buffer[]=[];
   for await(const chunk of incoming)chunks.push(chunk);
   const method=incoming.method!;
   const request=new Request(origin+incoming.url,{method,headers:incoming.headers as Record<string,string>,
    ...(method==='POST'?{body:Buffer.concat(chunks)}:{})});
   const webPath=new URL(request.url).pathname==='/personal/learning/data';
   const response=webPath?await handleLearningRequest(request,enabled?{baseURL:origin,service:ownerLearning,authorize:async req=>{
    if(req.headers.get('x-synthetic-owner')!=='yes')throw new PlatformError(403,'DENIED','Synthetic only');
    return {binding,writable:true};
   }}:null):await router(request);
   if(lose&&method==='POST'&&response.ok){lose=false;outgoing.destroy();return;}
   outgoing.writeHead(response.status,Object.fromEntries(response.headers));outgoing.end(Buffer.from(await response.arrayBuffer()));
  }catch{outgoing.writeHead(500).end();}
 });
 server.listen(0,'127.0.0.1');
 await once(server,'listening');
 t.after(async()=>{server.close();await once(server,'close');});
 origin='http://127.0.0.1:'+(server.address() as AddressInfo).port;
 const config={...binding,ownerEmail:'learning@example.test',databaseName:database,allowedTypes:['todo'],approval:'personal-manual-v1',businessWriteMode:'owner-managed',baseURL:origin} as const;
 const auth=betterAuth({baseURL:origin,secret:'synthetic-learning-agent-fixture-secret-only',database:verifier,logger:{disabled:true},telemetry:{enabled:false},
  plugins:[apiKey({enableSessionForAPIKeys:false,enableMetadata:true,startingCharactersConfig:{shouldStore:false}})]});
 const setRouter=(active:boolean)=>{
  enabled=active;
  const modules=readAgentBusinessModules(active?{LIFEOS_AGENT_LEARNING:'learning-v1',LIFEOS_PERSONAL_LEARNING:'learning-vocabulary-v1'}:{},config);
  const current=(id:string)=>readCurrentAgentGrant(verifier,id,policyOptions,false,false,active);
  router=createAgentHandler({config,repository,enabled:true,modules,fenceWrites:true,mountPath:'/api/platform/agent',
   operationAvailable:id=>agentOperationAvailable(id,config,true,modules),assertWritable:async()=>{},readCurrentGrant:current,
   verify:async token=>{const result=await auth.api.verifyApiKey({body:{key:token}});return result.valid&&result.key?current(result.key.id):null;},
   learning:{ready:async()=>{await verifyLearningPostgres(runtime as SqlPool);return learningFenceReady(runtime);},
    forAgent:(grant,op,scopes)=>new LearningService(new PostgresLearningRepository(runtime as SqlPool,
     async(client,selected)=>{
      if(revokeBeforeFence){
       revokeBeforeFence=false;
       await admin.query('UPDATE lifeos_agent.apikey SET enabled=false WHERE id=$1',[grant.grantId]);
      }
      await assertLearningWriteFence(client,selected,grant.grantId,op,scopes);
     }))},
  });
 };
 const root='/v1/learning/cards';
 const api=(token:string,path:string,body?:unknown,key=randomUUID())=>fetch(origin+'/api/platform/agent'+path,{
  method:body?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json','idempotency-key':key},
  ...(body?{body:JSON.stringify(body)}:{}),
 });
 const web=(query='')=>fetch(origin+'/personal/learning/data'+query,{headers:{'x-synthetic-owner':'yes'}});
 const discovery=async(token:string)=>(await (await api(token,'/v2/capabilities')).json()).operations
  .filter((op:{module:string})=>op.module==='learning').map((op:{id:string})=>op.id).sort();
 setRouter(false);
 assert.deepEqual(await discovery(legacy.token),[]);
 assert.equal((await api(legacy.token,root)).status,404);
 assert.equal((await web()).status,404);
 setRouter(true);
 assert.deepEqual(await discovery(writer.token),[]);
 assert.equal((await api(writer.token,root)).status,503);
 await admin.query("SET lifeos.learning_agent_migration_approved='1'");
 await migrate('0028_learning_agent_grants.proposed.sql');
 assert.equal(await learningFenceReady(runtime),true);
 assert.equal(await learningFenceReady(verifier),false);
 await assert.rejects(runtime.query('SELECT id FROM lifeos_agent.apikey'),{code:'42501'});
 assert.deepEqual(await discovery(writer.token),['appendLearningReview','createLearningCard','getLearningCard','getLearningReview','snapshotLearningCards']);
 assert.deepEqual(await discovery(reader.token),['getLearningCard','getLearningReview','snapshotLearningCards']);
 for(const key of [legacy,wide]){
  assert.deepEqual(await discovery(key.token),[]);
  assert.equal((await api(key.token,root,{confirmed:true,front:'Denied',back:'Denied'})).status,403);
 }
 assert.equal((await api(mixed.token,'/v2/capabilities')).status,401);
 assert.equal((await api(foreign.token,root)).status,403);
 assert.equal(businessMcpOperations.some(op=>op.module==='learning'),false);

 const create={confirmed:true,front:'Synthetic word',back:'Synthetic meaning'};
 assert.equal((await api(reader.token,root,create)).status,403);
 assert.equal((await api(writer.token,root,{...create,confirmed:false})).status,400);
 revokeBeforeFence=true;
 assert.equal((await api(writer.token,root,create)).status,403);
 assert.deepEqual((await (await web()).json()).cards,[]);
 await admin.query('UPDATE lifeos_agent.apikey SET enabled=true WHERE id=$1',[writer.id]);
 const createKey=randomUUID();
 const made=await api(writer.token,root,create,createKey);
 assert.equal(made.status,200);
 const card=await made.json();
 assert.deepEqual(await (await api(writer.token,root,create,createKey)).json(),card);
 const shown=await (await web('?card='+card.id)).json();
 assert.equal(shown.card.front,create.front);
 assert.equal(shown.schedule,null);
 const body={confirmed:true,cardRevision:1,previousId:null,rating:'recalled'};
 const reviewKey=randomUUID(),reviewPath=root+'/'+card.id+'/reviews';
 lose=true;
 await assert.rejects(api(writer.token,reviewPath,body,reviewKey));
 await admin.query('UPDATE lifeos_agent.apikey SET enabled=false WHERE id=$1',[writer.id]);
 assert.equal((await api(writer.token,reviewPath,body,reviewKey)).status,401);
 const recovered=await (await web('?card='+card.id)).json();
 assert.equal(recovered.history.length,1);
 await admin.query('UPDATE lifeos_agent.apikey SET enabled=true WHERE id=$1',[writer.id]);
 const replay=await api(writer.token,reviewPath,body,reviewKey);
 assert.equal(replay.status,200);
 const receipt=await replay.json();
 const proof=await (await api(reader.token,reviewPath+'/'+receipt.id)).json();
 assert.deepEqual(proof.review,recovered.history[0]);
 assert.equal(proof.schedule.nextDueAt,recovered.schedule.nextDueAt);
 assert.equal((await api(writer.token,reviewPath,body)).status,409);
 assert.equal((await (await api(reader.token,root)).json()).cards[0].history.length,1);
 const webScope=(await (await web()).json()).scope;
 const webCreated=await fetch(origin+'/personal/learning/data',{
  method:'POST',headers:{origin,'x-synthetic-owner':'yes','x-learning-scope':webScope,'idempotency-key':randomUUID(),'content-type':'application/json'},
  body:JSON.stringify({kind:'create',confirmed:true,front:'Synthetic web word',back:'Synthetic web meaning'}),
 });
 assert.equal(webCreated.status,200);
 const fromWeb=await webCreated.json();
 assert.equal((await (await api(reader.token,root+'/'+fromWeb.cardId)).json()).card.front,'Synthetic web word');
 assert.deepEqual(await oldRecords.get(ownerId,'resource',oldValue.id,{includeSynthetic:true}),oldValue);
});
