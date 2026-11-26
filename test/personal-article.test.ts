import assert from 'node:assert/strict';
import test from 'node:test';
import {createAgentHandler} from '../src/agent-api/http.ts';
import {agentCapabilityOperations,businessMcpOperations,oauthBusinessMcpOperations} from '../src/agent-api/capabilities.ts';
import {readCurrentAgentGrant,agentOperationAvailable} from '../src/agent-api/runtime.ts';
import {readBusinessPolicyCatalog} from '../src/agent-api/business-policy-postgres.ts';
import {assertAgentGrant} from '../src/agent-api/grant-fence.ts';
import {lockCurrentAgentGrant,type SqlClient} from '../src/platform/postgres.ts';
import type {PersonalConfig} from '../src/personal-candidate/config.ts';
import {createPersonalPlatformHandler,personalPermitBinding} from '../src/personal-candidate/runtime-http.ts';
import {MemoryPort} from './helpers/platform.ts';

const origin='https://article.example.test';
const config={
  ownerId:'synthetic-article-owner',ownerEmail:'article@example.test',spaceId:'synthetic-article-space',
  baseURL:origin,databaseName:'lifeos_platform_test_local',approval:'personal-manual-v1',
  allowedTypes:['todo','journal'],articleEnabled:true,businessWriteMode:'owner-managed',
} as const satisfies PersonalConfig;
const text='  第一段正文。\n\n第二段正文。  ';
const fields={
  title:' 合成文章 ',text,occurredOn:null,
  personal:{type:'article',schemaVersion:1,author:' 合成作者 ',sourceURL:null,attribution:'original'},
};
const keyed='article-first-command';

function setup(options:{enabled?:boolean;storageVerified?:boolean;writable?:boolean;authorized?:boolean}={}) {
  const repo=new MemoryPort();
  repo.readCurrentSnapshot=async owner=>structuredClone([...repo.rows.values()].filter(row=>row.ownerId===owner));
  const handler=createPersonalPlatformHandler({
    repository:repo,config:{...config,articleEnabled:options.enabled===false?undefined:true},
    storageVerified:options.storageVerified!==false,
    sessions:{read:async()=>options.authorized===false?null:{userId:config.ownerId,email:config.ownerEmail}},
    assertWritable:async()=>{if(options.writable===false)throw Error('synthetic write unavailable');},
  });
  return {repo,send:(path:string,method='GET',input?:unknown,key=crypto.randomUUID() as string)=>request(handler,'/api/platform/personal/'+path,method,input,key)};
}

function request(handler:(request:Request)=>Promise<Response>,path:string,method='GET',input?:unknown,key=crypto.randomUUID() as string) {
  return handler(new Request(origin+path,{
    method,headers:{host:'article.example.test',origin,authorization:'Bearer synthetic-article-key','content-type':'application/json','idempotency-key':key},
    ...(input===undefined?{}:{body:JSON.stringify(input)}),
  }));
}

const command=(value:unknown=fields)=>({spaceId:config.spaceId,confirmed:true,fields:value});

test('owner article saves readable body and exact initial source through detail, CAS history and original-command replay',async()=>{
  const {repo,send}=setup();
  const status=await(await send('status')).json();
  assert.equal(status.articleEnabled,true);
  const first=await send('article','POST',command(),keyed);
  assert.equal(first.status,201);
  const {entry}=await first.json(), path='article/'+entry.id;
  assert.equal(entry.draft.title,'合成文章');
  assert.equal(entry.draft.text,text);
  assert.equal(entry.draft.personal.author,'合成作者');
  assert.deepEqual(entry.source.original.input.fields,fields);
  assert.deepEqual((await(await send(path)).json()).entry,entry);

  const patch={...command({...fields,text:'新的一版正文。',personal:{...fields.personal,author:null,sourceURL:'https://source.example.test/article'}}),expectedRevision:1};
  assert.equal((await send(path,'PATCH',patch)).status,200);
  assert.equal((await send(path,'PATCH',patch)).status,409);
  const history=await(await send(path+'/history')).json();
  assert.deepEqual(history.items.map((row:{revision:number})=>row.revision),[2,1]);
  assert.equal(history.items[0].draft.text,'新的一版正文。');
  assert.equal(history.items[0].draft.personal.sourceURL,'https://source.example.test/article');
  assert.deepEqual(history.items[0].source,entry.source);
  assert.deepEqual(history.items[1],entry);

  const recovered=await send('article','POST',command(),keyed);
  assert.equal(recovered.status,200);
  assert.deepEqual(await recovered.json(),{entry,duplicate:true});
  assert.equal((await send('article','POST',command({...fields,text:'changed original command'}),keyed)).status,409);
  assert.equal(repo.rows.size,1);
  assert.equal(repo.historyRows.length,2);
  assert.equal(repo.receipts.size,2);
});

test('article fails closed for missing source, blank body, unsafe names or URLs and inactive owner boundaries',async()=>{
  const {repo,send}=setup();
  const missingSource={...fields.personal,author:' \u3000 ',sourceURL:null};
  for(const input of [
    {...fields,text:' \n\t '},
    {...fields,personal:missingSource},
    {...fields,personal:{...missingSource,sourceURL:'https://name:password@source.example.test/'}},
    {...fields,personal:{...missingSource,sourceURL:'javascript:example()'}},
    {...fields,personal:{...missingSource,sourceURL:'https://source.example.test/a\tb'}},
    {...fields,personal:{...fields.personal,author:'first\nsecond'}},
  ]) assert.equal((await send('article','POST',command(input))).status,400);
  assert.equal((await send('article','POST',{...command(),confirmed:false})).status,403);
  assert.equal(repo.rows.size,0);
  assert.equal(repo.historyRows.length,0);
  assert.equal(repo.receipts.size,0);

  for(const [options,status] of [[{enabled:false},404],[{storageVerified:false},503],[{authorized:false},401]] as const) {
    const instance=setup(options);
    assert.equal((await instance.send('article/snapshot')).status,status);
    assert.equal(instance.repo.rows.size,0);
  }
  assert.equal((await setup({writable:false}).send('article','POST',command())).status,503);
  const {articleEnabled:_,...disabled}=config;
  assert.deepEqual(personalPermitBinding({...disabled,articleEnabled:undefined},'a'.repeat(40)),personalPermitBinding(disabled,'a'.repeat(40)));
  assert.notEqual(personalPermitBinding(config,'a'.repeat(40)).configDigest,personalPermitBinding(disabled,'a'.repeat(40)).configDigest);
});

test('an enabled Article registry cannot expand existing real grant resolution, discovery or transaction authority',async()=>{
  const {repo}=setup();
  const operationIds=['snapshotArticle','getArticle','createArticle','updateArticle'];
  const ordinaryIds=['getTodo','updateTodo'];
  const registered=agentCapabilityOperations.filter(op=>[...ordinaryIds,...operationIds].includes(op.id));
  const storedGrant={
    id:'synthetic-article-grant',referenceId:config.ownerId,enabled:true,
    metadata:{spaceId:config.spaceId,businessDataPolicy:'all-personal-business-v1'},
    permissions:{todo:['read','write']},
    expiresAt:new Date(Date.now()+60_000).toISOString(),
  };
  const grantStore={query:async(sql:string,values?:unknown[])=>{
    if(sql.includes('FROM lifeos_agent.apikey WHERE id')) {
      assert.deepEqual(values,[storedGrant.id]);
      return {rows:[storedGrant]};
    }
    if(sql.includes(' AS functions_safe,'))return {rows:[{functions_safe:true,registry_safe:true}]};
    assert.equal(sql,'SELECT lifeos_agent.business_policy_catalog() AS catalog');
    return {rows:[{catalog:{
      version:'all-personal-business-v1',enabled:true,
      operations:registered.map(op=>({id:op.id,requiredScopes:op.requiredScopes,enabled:true})),
    }}]};
  }};
  const catalog=await readBusinessPolicyCatalog(grantStore);
  assert.ok(operationIds.every(id=>catalog.operations.some(op=>op.id===id&&op.enabled)));
  const current=()=>readCurrentAgentGrant(grantStore,storedGrant.id,async()=>({
    ownerId:config.ownerId,spaceId:config.spaceId,policyEnabled:catalog.enabled,registry:agentCapabilityOperations,
    operationAvailable:id=>catalog.operations.some(op=>op.id===id&&op.enabled),
  }));
  const grant=await current();
  assert.ok(grant);
  assert.deepEqual(grant.scopes,['todo:read','todo:write']);
  assert.deepEqual([...(grant.allowedOperationIds??[])].sort(),[...ordinaryIds].sort());
  assert.equal(businessMcpOperations.some(op=>String(op.module)==='article'),false);
  assert.equal(oauthBusinessMcpOperations.some(op=>String(op.module)==='article'),false);

  const modules={organization:false,classification:false,personalRecords:true,businessDataPolicy:true};
  assert.equal(agentOperationAvailable('getArticle',config,true,modules),false);
  assert.equal(agentOperationAvailable('getTodo',config,true,modules),true);
  const handler=createAgentHandler({
    enabled:true,modules,config,repository:repo,fenceWrites:true,verify:current,readCurrentGrant:current,
    operationAvailable:id=>catalog.operations.some(op=>op.id===id&&op.enabled),assertWritable:async()=>{},
  });
  const discovery=await request(handler,'/v2/capabilities');
  assert.equal(discovery.status,200);
  assert.deepEqual((await discovery.json()).operations.map((op:{id:string})=>op.id).sort(),['discoverV2',...ordinaryIds].sort());
  assert.equal((await request(handler,'/v1/records/article/snapshot')).status,404);
  assert.equal((await request(handler,'/v1/records/article','POST',{fields})).status,404);
  assert.equal(repo.rows.size,0);

  const sqlCalls:{sql:string;args?:unknown[]}[]=[];
  const client={
    query:async(sql:string,args?:unknown[])=>{sqlCalls.push({sql,args});return{rows:[{allowed:true}],rowCount:1};},
    release:()=>{},
  } as SqlClient;
  const articleScopes=['article:read','article:write'] as const;
  await assert.rejects(assertAgentGrant({
    lockAgentGrant:(binding,scopes)=>lockCurrentAgentGrant(client,config.ownerId,binding,scopes,true),
  } as Parameters<typeof assertAgentGrant>[0],grant,articleScopes,'createArticle'),{code:'GRANT_OPERATION_INVALID'});
  assert.equal(await lockCurrentAgentGrant(client,config.ownerId,{...grant,operationId:'createArticle'},articleScopes,true),false);
  assert.equal(await lockCurrentAgentGrant(client,config.ownerId,{...grant,operationId:'createArticle'},['todo:read','todo:write'],true),false);
  assert.equal(sqlCalls.length,0);
  assert.equal(await lockCurrentAgentGrant(client,config.ownerId,{...grant,operationId:'updateTodo'},['todo:write'],true),true);
  assert.match(sqlCalls[0].sql,/lifeos_agent\.assert_current_business_grant/);
  assert.equal(sqlCalls[0].args?.at(-1),'updateTodo');
});
