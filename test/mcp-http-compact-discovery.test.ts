import assert from 'node:assert/strict';
import test from 'node:test';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {agentOperations} from '../src/agent-api/capabilities.ts';
import {createMcpHttpHandler} from '../src/mcp-http/handler.ts';

const origin='https://lifeos.nirvanachow.com';
const excluded=new Set(['discover','discoverV2','commitTodoClassification','previewTodoClassification','claimRequirementExecution','updateRequirementExecution']);
const catalog53=agentOperations.filter(operation=>!excluded.has(operation.id));
const catalog5=catalog53.filter(operation=>operation.module==='todo');
async function fixture(operations:typeof catalog53){
 let current=operations,requests=0;
 const handler=createMcpHttpHandler({enabled:true,origin,dispatch:async request=>{
  assert.equal(new URL(request.url).pathname,'/api/platform/agent/v2/capabilities');
  assert.equal(request.method,'GET');requests++;
  return Response.json({apiVersion:'2',operations:current});
 }});
 const client=new Client({name:'synthetic-compact-catalog',version:'1'},{versionNegotiation:{mode:{pin:'2026-07-28'}}});
 await client.connect(new StreamableHTTPClientTransport(new URL(origin+'/api/platform/mcp'),{requestInit:{headers:{authorization:'Bearer synthetic-compact-catalog'}},fetch:async(input,init)=>{
  const request=new Request(input,init);request.headers.set('host',new URL(origin).host);return handler(request);
 }}));
 requests=0;
 const rpc=(method:string,params:Record<string,unknown>):Promise<any>=>method==='tools/list'?client.listTools():client.callTool(params as any);
 return{rpc,close:()=>client.close(),set:(next:typeof catalog53)=>{current=next;},requests:()=>requests};
}

for(const [count,operations] of [[5,catalog5],[53,catalog53]] as const)test(`offline ${count}-operation catalog retains full schemas with optional compact projections`,async t=>{
 assert.equal(operations.length,count);
 const f=await fixture(operations);t.after(()=>f.close());
 const full=await f.rpc('tools/call',{name:'lifeos_discover',arguments:{}});
 const index=await f.rpc('tools/call',{name:'lifeos_discover',arguments:{view:'index'}});
 const selected=await f.rpc('tools/call',{name:'lifeos_discover',arguments:{operationId:'getTodo'}});
 const listed=await f.rpc('tools/list',{});
 assert.equal(full.structuredContent.operations.length,count);
 assert.deepEqual(index.structuredContent.operations,operations.map(({id,module,method,description})=>({id,module,method,description})));
 assert.deepEqual(selected.structuredContent.operation,full.structuredContent.operations.find((operation:any)=>operation.id==='getTodo'));
 assert.deepEqual(listed.tools.map((tool:any)=>tool.name),['lifeos_discover','lifeos_call']);
 assert.equal(listed.tools[1].inputSchema.oneOf.length,count);
 for(const operation of full.structuredContent.operations){
  assert.deepEqual(listed.tools[1].inputSchema.oneOf.find((branch:any)=>branch.properties.operationId.const===operation.id).properties.arguments,operation.inputSchema);
 }
 assert.equal(f.requests(),8,'retain preflight and handler freshness on every request');
 const bytes=(value:unknown)=>Buffer.byteLength(JSON.stringify(value));
 assert.ok(bytes(index)<bytes(full));
 t.diagnostic(JSON.stringify({syntheticOperations:count,fullDiscoveryBytes:bytes(full),indexDiscoveryBytes:bytes(index),selectedGetTodoBytes:bytes(selected),toolsListBytes:bytes(listed)}));
 f.set(operations.filter(operation=>operation.id!=='getTodo'));
 const revoked=await f.rpc('tools/call',{name:'lifeos_discover',arguments:{operationId:'getTodo'}});
 assert.deepEqual(revoked.structuredContent,{ok:false,status:403,error:'OPERATION_UNAVAILABLE'});
});
