import assert from 'node:assert/strict';
import test from 'node:test';
import {z} from 'zod';
import {agentOperations} from '../src/agent-api/capabilities.ts';
import {argumentSchema} from '../src/mcp-candidate/schemas.ts';
import {localDefinitions,intersectDefinitions,validateHostCall} from '../src/mcp-server-host-candidate/contracts.ts';
import {createMcpChannel,type BrokerPort} from '../src/mcp-server-host-candidate/channel.ts';

const fingerprint='a'.repeat(64),otherFingerprint='b'.repeat(64);
const id='00000000-0000-4000-8000-000000000001';
const catalog=()=>({apiVersion:'2',operations:structuredClone(localDefinitions)});
const one=()=>structuredClone(localDefinitions.find(op=>op.id==='createTodo')!);
function fixture(){
 const requests:Parameters<BrokerPort['request']>[0][]=[];let uses=0,prints=0;
 let currentFingerprint=fingerprint;
 let alter:(value:any)=>unknown=value=>value;
 const port:BrokerPort={beforeUse:async()=>{uses++;},fingerprint:async()=>{prints++;return currentFingerprint;},request:async(envelope)=>{
  requests.push(envelope);const rpc=JSON.parse(envelope.encoded);
  const result=rpc.method==='server/discover'?{resultType:'complete',supportedVersions:['2026-07-28'],capabilities:{tools:{}}}:rpc.params.name==='lifeos_discover'?{resultType:'complete',content:[],structuredContent:catalog()}:{resultType:'complete',content:[],structuredContent:{ok:true,status:200,data:{id}}};
  return alter({status:200,credentialFingerprint:currentFingerprint,data:{jsonrpc:'2.0',id:rpc.id,result}});
 }};
 return{channel:createMcpChannel(port),requests,get uses(){return uses;},get prints(){return prints;},alter:(fn:typeof alter)=>{alter=fn;},bind:(value:string)=>{currentFingerprint=value;}};
}

test('53 reviewed definitions retain every registry field and canonical schema, excluding other operations',()=>{
 const expected=[...['Journal','Calendar','Health','Person','Finance','Media','Career','Portfolio'].flatMap(name=>['snapshot','get','create','update'].map(verb=>verb+name)),
 'snapshotFeedback','getFeedback','createFeedback','snapshotStorageReviews','getStorageReview','createStorageReview','updateStorageReviewChecklist','updateStorageReviewDecision',
 'snapshotRequirements','getRequirement','createRequirement','updateRequirement','listTodos','snapshotTodos','getTodo','createTodo','updateTodo','snapshotOrganization','getOrganization','createOrganization','updateOrganization'];
 assert.equal(localDefinitions.length,53);assert.deepEqual(localDefinitions.map(op=>op.id).sort(),expected.sort());
 for(const definition of localDefinitions){const operation=agentOperations.find(op=>op.id===definition.id)!;assert.deepEqual(definition,{...operation,inputSchema:z.toJSONSchema(argumentSchema(operation))});}
 assert.deepEqual(intersectDefinitions(localDefinitions,catalog()).map(op=>op.id).sort(),expected);
 assert.deepEqual(intersectDefinitions(localDefinitions,{apiVersion:'2',operations:[one()]}).map(op=>op.id),['createTodo']);
 assert.deepEqual(intersectDefinitions(localDefinitions,{apiVersion:'2',operations:[]}),[]);
});

for(const [field,value] of Object.entries({method:'DELETE',path:'https://evil.invalid',module:'account',policyClass:'admin',requiredScopes:['todo:read'],description:'drift',scope:'todo:read',inputSchema:{type:'object'}})){
 test('same ID '+field+' drift closes discovery',()=>{const op:any=one();op[field]=value;assert.throws(()=>intersectDefinitions(localDefinitions,{apiVersion:'2',operations:[op]}));});
}
test('missing fields, extra constraints, duplicate IDs/scopes, malformed scopes and version fail closed',()=>{
 const bad:any[]=[];
 for(const key of Object.keys(one())){const op:any=one();delete op[key];bad.push({apiVersion:'2',operations:[op]});}
 const schema:any=one();schema.inputSchema.maxProperties=0;bad.push({apiVersion:'2',operations:[schema]});
 for(const requiredScopes of [['todo:write','todo:write'],['todo:write',null],['todo:write','payment:write']])bad.push({apiVersion:'2',operations:[{...one(),requiredScopes}]});
 bad.push({apiVersion:'2',operations:[one(),one()]},{apiVersion:'1',operations:[]},{apiVersion:'2',operations:[null]});
 for(const remote of bad)assert.throws(()=>intersectDefinitions(localDefinitions,remote));
 const reversed=structuredClone(localDefinitions.find(op=>op.id==='createJournal')!);(reversed.requiredScopes as string[]).reverse();
 assert.equal(intersectDefinitions(localDefinitions,{apiVersion:'2',operations:[reversed]}).length,1);
 assert.throws(()=>intersectDefinitions([one(),one()],catalog()));
});
test('unknown future/account/payment IDs never become locally executable',()=>{
 const unknown=['createFuture','payInvoice','changeAccount'].map(id=>({...one(),id,module:'future'}));
 assert.deepEqual(intersectDefinitions(localDefinitions,{apiVersion:'2',operations:unknown}),[]);
 for(const operationId of ['createFuture','payInvoice','changeAccount','discover','discoverV2','previewTodoClassification','updateRequirementExecution'])assert.throws(()=>validateHostCall(operationId,{}));
});
test('canonical native validation preserves original complete arguments and enforces semantic dates',()=>{
 const args={id,expectedRevision:1,idempotencyKey:'synthetic-host-001',fields:{title:'Task',notes:'',dueOn:null,status:'open',personal:null}};
 const validated=validateHostCall('updateTodo',args);
 assert.equal(validated.parsed.path,'/v1/todos/'+id);assert.equal(validated.parsed.key,'synthetic-host-001');
 assert.equal(validated.argsJSON,'{"expectedRevision":1,"fields":{"dueOn":null,"notes":"","personal":null,"status":"open","title":"Task"},"id":"00000000-0000-4000-8000-000000000001","idempotencyKey":"synthetic-host-001"}');assert.deepEqual(JSON.parse(validated.argsJSON),args);
 assert.throws(()=>validateHostCall('createTodo',{idempotencyKey:'synthetic-host-002',fields:{title:'Task',notes:'',dueOn:'2026-02-30',status:'open'}}));
});
test('illegal business arguments fail before broker use; contracts have no store or lock access',async()=>{
 const f=fixture();
 for(const [operationId,args] of [['getTodo',{id:'https://evil.invalid'}],['createTodo',{fields:{title:'Task'},idempotencyKey:'x'}],['getTodo',{id,headers:{authorization:'injected'}}],['payInvoice',{}]] as const){
  await assert.rejects(f.channel.call(operationId,args));assert.throws(()=>f.channel.prepareCall(operationId,args));
 }
 assert.equal(f.uses,0);assert.equal(f.prints,0);assert.equal(f.requests.length,0);
});
test('modern complete handshake, discover and exact prepared call use only fixed POST broker envelope',async()=>{
 const f=fixture();await f.channel.ready();await f.channel.discover();
 const encoded=f.channel.prepareCall('getTodo',{id});
 const result=await f.channel.sendPrepared(encoded,fingerprint);
 assert.equal(result.resultType,'complete');assert.equal(f.requests.at(-1)!.encoded,encoded);
 for(const request of f.requests){assert.deepEqual(Object.keys(request).sort(),['encoded','expectedCredentialFingerprint','method','path']);assert.equal(request.path,'/api/platform/mcp');assert.equal(request.method,'POST');assert.equal(request.expectedCredentialFingerprint,fingerprint);}
 assert.equal(f.uses,4);assert.equal(f.prints,4);
});
test('prepared bytes reject extra URLs, headers, redirects, tools, RPC methods, protocol and malformed IDs before broker',async()=>{
 const f=fixture();await f.channel.ready();const encoded=f.channel.prepareCall('getTodo',{id});const original=JSON.parse(encoded);
 const mutations=[(x:any)=>{x.url='https://evil.invalid';},(x:any)=>{x.params.headers={authorization:'x'};},(x:any)=>{x.params.redirect='follow';},(x:any)=>{x.params.name='https://evil.invalid/tool';},(x:any)=>{x.params.name='lifeos_retry';},(x:any)=>{x.method='initialize';},(x:any)=>{x.params._meta['io.modelcontextprotocol/protocolVersion']='2025-03-26';},(x:any)=>{x.id=null;},(x:any)=>{x.params.arguments.arguments.id='file:///etc/passwd';}];
 for(const mutate of mutations){const value=structuredClone(original);mutate(value);await assert.rejects(f.channel.sendPrepared(JSON.stringify(value),fingerprint));}
 await assert.rejects(f.channel.sendPrepared(' '+encoded,fingerprint));assert.equal(f.requests.length,1);assert.equal(f.uses,2);
});
for(const [name,mutate] of [
 ['wrong ID',(x:any)=>{x.data.id++;}],['wrong fingerprint',(x:any)=>{x.credentialFingerprint=otherFingerprint;}],['wrong JSONRPC version',(x:any)=>{x.data.jsonrpc='1.0';}],
 ['RPC error',(x:any)=>{delete x.data.result;x.data.error={code:-32603,message:'failure'};}],['incomplete result',(x:any)=>{x.data.result.resultType='task';}],['SDK malformed result',(x:any)=>{x.data.result.content='bad';}],
 ['oversize',(x:any)=>{x.data.result.content=[{type:'text',text:'x'.repeat(8*1024*1024)}];}],['redirect',(x:any)=>{x.status=302;}],['auth required',(x:any)=>{x.status=401;}],['auth denied',(x:any)=>{x.status=403;}],['unexpected header field',(x:any)=>{x.headers={};}]
] as const){test('channel rejects '+name+' without automatic retry',async()=>{const f=fixture();await f.channel.ready();f.alter(value=>{mutate(value);return value;});await assert.rejects(f.channel.call('getTodo',{id}));assert.equal(f.requests.length,2);});}
test('unsupported negotiated protocol rejects readiness',async()=>{const f=fixture();f.alter(value=>{value.data.result.supportedVersions=['2025-03-26'];return value;});await assert.rejects(f.channel.ready());});
test('changed fingerprint stops before sending; cancelled calls retain unknown and never retry',async()=>{
 const f=fixture();await f.channel.ready();const encoded=f.channel.prepareCall('getTodo',{id});f.bind(otherFingerprint);
 await assert.rejects(f.channel.sendPrepared(encoded,fingerprint));assert.equal(f.requests.length,1);
 const cancelled=new AbortController();cancelled.abort();await assert.rejects(f.channel.sendPrepared(encoded,fingerprint,cancelled.signal));assert.equal(f.requests.length,1);
});
test('128 KiB prepared envelope bound is enforced before broker',async()=>{
 const f=fixture();await assert.rejects(f.channel.sendPrepared('x'.repeat(131073),fingerprint));assert.equal(f.uses,0);
});
test('cancellation during broker request promptly reports unknown without retrying an uncertain call',{timeout:1000},async()=>{
 const f=fixture();await f.channel.ready();const controller=new AbortController();
 f.alter(()=>{controller.abort();return new Promise(()=>{});});
 await assert.rejects(f.channel.call('getTodo',{id},controller.signal),(error:unknown)=>{
  assert.ok(error instanceof Error);assert.equal((error as Error & {outcome:string}).outcome,'unknown');
  assert.equal((error as Error & {automaticRetry:boolean}).automaticRetry,false);return true;
 });
 assert.equal(f.requests.length,2);
});
test('preparing never sends and replay preserves the original RPC id and canonical arguments',async()=>{
 const f=fixture();await f.channel.ready();const before=f.requests.length;
 const encoded=f.channel.prepareCall('getTodo',{id});assert.equal(f.requests.length,before);
 await f.channel.sendPrepared(encoded,fingerprint);await f.channel.sendPrepared(encoded,fingerprint);
 assert.equal(f.requests.at(-1)!.encoded,encoded);assert.equal(f.requests.at(-2)!.encoded,encoded);
 assert.equal(JSON.parse(f.requests.at(-1)!.encoded).id,JSON.parse(encoded).id);
});

test('schema object key order is immaterial while required-array order remains part of the contract',()=>{
 const original=one();const reordered=Object.fromEntries(Object.entries(original).reverse());
 assert.equal(intersectDefinitions(localDefinitions,{apiVersion:'2',operations:[reordered]}).length,1);
 const changed:any=one();changed.inputSchema.required.reverse();
 assert.throws(()=>intersectDefinitions(localDefinitions,{apiVersion:'2',operations:[changed]}));
});
