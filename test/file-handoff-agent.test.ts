import test from 'node:test';import assert from 'node:assert/strict';
import {createAgentHandler} from '../src/agent-api/http.ts';
import {extendFileGrant,fileActor} from '../src/file-handoff/authorization.ts';
import {sha256} from '../src/file-handoff/contracts.ts';
const origin='https://synthetic-files.example.test',id='00000000-0000-4000-8000-000000000001',sourceId='00000000-0000-4000-8000-000000000002',bytes=Buffer.from('native Agent original bytes');
const entry={id,revision:2,state:'ready',sourceFileId:'file_synthetic',name:'synthetic.txt',mimeType:'text/plain',target:{id:sourceId,sourceId,revision:1},retention:{kind:'retained'},sha256:sha256(bytes),bytes:bytes.length,createdAt:new Date().toISOString(),receivedAt:new Date().toISOString(),acknowledgments:{}};
test('native Agent file operations require the independent grant and return actual binary through the original boundary',async()=>{
 let dispatches=0;const base={grantId:'synthetic-grant',ownerId:'synthetic-owner',spaceId:'synthetic-space',scopes:['todo:read'] as const},permission={version:'file-handoff-v1',revision:1,digest:'a'.repeat(64),scopes:['file-handoff:read','file-handoff:write'],consumer:'codex'};
 const grant=extendFileGrant(base,permission,true),config={ownerId:base.ownerId,ownerEmail:'owner@example.test',spaceId:base.spaceId,baseURL:origin,databaseName:'lifeos_platform_test_local',approval:'personal-manual-v1',allowedTypes:['todo','journal'],requirementsEnabled:true};
 const fileRuntime={ready:async()=>true,forAgent:(actor:Parameters<typeof fileActor>[0])=>({actor:fileActor(actor),service:{stage:async()=>{dispatches++;return{entry,duplicate:false};},get:async()=>{dispatches++;return{entry,cleanupEligible:false};},download:async()=>{dispatches++;return{entry,bytes};}}})};
 const create=(current:typeof base|typeof grant)=>createAgentHandler({enabled:true,mountPath:'/api/platform/agent',fenceWrites:true,config,repository:{},modules:{organization:false,classification:false,fileHandoff:true},fileHandoff:fileRuntime,verify:async()=>current,readCurrentGrant:async()=>current,assertWritable:async()=>{},operationAvailable:()=>true} as any);
 const request=(tail:string,method='GET',body?:unknown)=>new Request(origin+'/api/platform/agent'+tail,{method,headers:{host:'synthetic-files.example.test',authorization:'Bearer synthetic-files-key','content-type':'application/json','idempotency-key':'synthetic-file-command'},...(body?{body:JSON.stringify(body)}:{})});
 const legacy=create(base),catalog=await(await legacy(request('/v2/capabilities'))).json();assert.equal(catalog.operations.some((op:any)=>op.module==='fileHandoff'),false);
 assert.equal((await legacy(request('/v1/file-handoffs/'+id+'/content'))).status,403);assert.equal(dispatches,0);
 const handler=create(grant),result=await handler(request('/v1/file-handoffs/'+id+'/content'));assert.equal(result.status,200);assert.deepEqual(Buffer.from(await result.arrayBuffer()),bytes);assert.equal(dispatches,1);
 const authorized=await(await handler(request('/v2/capabilities'))).json();assert.equal(authorized.operations.filter((op:any)=>op.module==='fileHandoff').length,4);
});
