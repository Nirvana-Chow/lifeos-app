import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryPort} from './helpers/platform.ts';
import {agentOperations} from '../src/agent-api/capabilities.ts';
import {createAgentHandler} from '../src/agent-api/http.ts';
import {HttpBusinessClient} from '../src/mcp-http/business-client.ts';
import {argumentSchema,parseArguments} from '../src/mcp-candidate/schemas.ts';

const origin='https://lifeos.nirvanachow.com',ownerId='synthetic-note-owner',spaceId='synthetic-note-space';
const checklist={schema:1,revision:'synthetic-note-checklist',context:{summary:'Synthetic only'},items:[{id:'S-1',title:'Synthetic item',body:'No actual paths',question:'',group:'Synthetic',kind:'file',status:'pending'}]};
function setup(){
 const repository=new MemoryPort(),transaction=repository.transaction.bind(repository);let fenced=true,lost=false;
 repository.readCurrentSnapshot=async()=>structuredClone([...repository.rows.values()]);
 repository.transaction=(owner,key,run)=>transaction(owner,key,tx=>run({...tx,lockRecordIdentity:async()=>{},lockAgentGrant:async()=>fenced}));
 const operations=agentOperations.filter(op=>'policyClass'in op&&op.policyClass==='personal-business-data');
 const grant={grantId:'synthetic-note-grant',ownerId,spaceId,businessDataPolicy:'all-personal-business-v1' as const,allowedOperationIds:operations.map(op=>op.id),scopes:[...new Set(operations.flatMap(op=>op.requiredScopes))]};
 const handler=createAgentHandler({enabled:true,mountPath:'/api/platform/agent',fenceWrites:true,modules:{organization:false,classification:false,businessDataPolicy:true,storageReview:true},repository,
  config:{ownerId,spaceId,baseURL:origin,ownerEmail:'synthetic-note@example.test',databaseName:'fixture',approval:'personal-manual-v1',allowedTypes:['todo','journal']},
  verify:async token=>token==='synthetic-note-token'?grant:null,readCurrentGrant:async()=>grant,operationAvailable:()=>true,assertWritable:async()=>{}});
 const dispatch=async(request:Request)=>{const response=await handler(request);if(lost&&request.method==='PATCH'&&new URL(request.url).pathname.endsWith('/notes')){lost=false;throw Error('Synthetic response lost after writer commit');}return response;};
 const client=new HttpBusinessClient(origin,'synthetic-note-token',dispatch,new AbortController().signal);
 return {repository,client,setFence:(value:boolean)=>{fenced=value;},loseNext:()=>{lost=true;}};
}
async function create(f:ReturnType<typeof setup>){
 const result=await f.client.execute('createStorageReview',{fields:{checklist},idempotencyKey:'synthetic-note-create'});
 assert.equal(result.verification?.verified,true,JSON.stringify(result));
 return (result.data as {entry:{id:string}}).entry.id;
}
test('note discovery schema and canonical parser retain raw text and exact command fields',()=>{
 const op=agentOperations.find(op=>op.id==='updateStorageReviewNote')!;
 const args={id:'00000000-0000-4000-8000-000000000001',expectedRevision:1,fields:{checklistRevision:checklist.revision,itemId:'S-1',note:'  原文\n  '},idempotencyKey:'synthetic-note-schema'};
 assert.equal(argumentSchema(op).safeParse(args).success,true);
 assert.equal(parseArguments(op,args).path,'/v1/storage-reviews/'+args.id+'/notes');
 assert.deepEqual(parseArguments(op,args).body,{expectedRevision:1,fields:args.fields});
 for(const fields of [{...args.fields,ownerId:'injected-owner'},{...args.fields,note:'x'.repeat(8001)}])assert.equal(argumentSchema(op).safeParse({...args,fields}).success,false);
 assert.equal(argumentSchema(op).safeParse({...args,expectedRevision:0}).success,false);
});
test('HTTP MCP notes save raw text, clear exactly, and independently observe a later revision',async()=>{
 const f=setup(),id=await create(f),raw='  先确认云端\n再处理  ';
 const args={id,expectedRevision:1,fields:{checklistRevision:checklist.revision,itemId:'S-1',note:raw},idempotencyKey:'synthetic-note-save'};
 const saved=await f.client.execute('updateStorageReviewNote',args);
 assert.equal(saved.verification?.verified,true,JSON.stringify(saved));
 assert.deepEqual((saved.data as any).entry.fields.notes,[{id:'S-1',note:raw}]);
 assert.deepEqual((saved.readback?.data as any).entry.fields.decisions,[]);
 const cleared=await f.client.execute('updateStorageReviewNote',{...args,expectedRevision:2,fields:{...args.fields,note:''},idempotencyKey:'synthetic-note-clear'});
 assert.equal(cleared.verification?.verified,true,JSON.stringify(cleared));assert.deepEqual((cleared.readback?.data as any).entry.fields.notes,[]);
 const historical=await f.client.execute('updateStorageReviewNote',args);
 assert.equal((historical.data as any).duplicate,true);assert.equal((historical.data as any).entry.revision,2);
 assert.equal((historical.readback?.data as any).entry.revision,3);assert.equal(historical.verification?.verified,false);
 assert.equal(f.repository.historyRows.length,3);
});
test('lost note response preserves the original key; replay never duplicates and a failed fence never writes',async()=>{
 const f=setup(),id=await create(f),args={id,expectedRevision:1,fields:{checklistRevision:checklist.revision,itemId:'S-1',note:'   '},idempotencyKey:'synthetic-note-unknown'};
 f.loseNext();const unknown=await f.client.execute('updateStorageReviewNote',args);
 assert.equal(unknown.outcome,'unknown');assert.deepEqual(unknown.retry,{operationId:'updateStorageReviewNote',idempotencyKey:args.idempotencyKey,requireSameArguments:true});
 assert.equal(f.repository.historyRows.length,2);
 const replay=await f.client.execute('updateStorageReviewNote',args);assert.equal(replay.verification?.verified,true,JSON.stringify(replay));assert.equal((replay.data as any).duplicate,true);assert.deepEqual((replay.readback?.data as any).entry.fields.notes,[{id:'S-1',note:'   '}]);
 assert.equal(f.repository.historyRows.length,2);f.setFence(false);
 const denied=await f.client.execute('updateStorageReviewNote',{...args,expectedRevision:2,fields:{...args.fields,note:'Denied'},idempotencyKey:'synthetic-note-revoked'});
 assert.equal(denied.status,403);assert.equal(f.repository.historyRows.length,2);
});
