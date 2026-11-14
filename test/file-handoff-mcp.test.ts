import test from 'node:test';import assert from 'node:assert/strict';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {createMcpHttpHandler} from '../src/mcp-http/handler.ts';import {fileHandoffOperations} from '../src/file-handoff/operations.ts';import {sha256} from '../src/file-handoff/contracts.ts';
const origin='https://lifeos.nirvanachow.com',id='00000000-0000-4000-8000-000000000001',sourceId='00000000-0000-4000-8000-000000000002';
test('the official MCP transport exposes a dedicated top-level file tool and prevents generic/binary/consumer bypasses',async t=>{
 let writes=0;const entry={id,revision:2,state:'ready',sourceFileId:'file_synthetic',name:'synthetic.txt',mimeType:'text/plain',target:{id:sourceId,sourceId,revision:1},retention:{kind:'retained'},sha256:sha256('synthetic'),bytes:9,createdAt:new Date().toISOString(),receivedAt:new Date().toISOString(),acknowledgments:{}};
 const handler=createMcpHttpHandler({enabled:true,origin,dispatch:async request=>{
  const url=new URL(request.url);if(url.pathname.endsWith('/v2/capabilities'))return Response.json({apiVersion:'2',operations:fileHandoffOperations});
  if(request.method==='POST'){writes++;assert.equal(url.pathname,'/api/platform/agent/v1/file-handoffs');return Response.json({entry,duplicate:false},{status:201});}
  assert.equal(url.pathname,'/api/platform/agent/v1/file-handoffs/'+id);return Response.json({entry});
 }});
 const client=new Client({name:'synthetic-file-tool',version:'1'},{versionNegotiation:{mode:{pin:'2026-07-28'}}});t.after(()=>client.close());
 await client.connect(new StreamableHTTPClientTransport(new URL(origin+'/api/platform/mcp'),{requestInit:{headers:{authorization:'Bearer synthetic-file-tool'}},fetch:async(input,init)=>{const request=new Request(input,init);request.headers.set('host','lifeos.nirvanachow.com');return handler(request);}}));
 const tools=(await client.listTools()).tools,tool=tools.find(tool=>tool.name==='lifeos_stage_file');assert.ok(tool);assert.deepEqual(tool._meta?.['openai/fileParams'],['file']);
 const args={file:{download_url:'https://synthetic.invalid/file',file_id:'file_synthetic',mime_type:'text/plain',file_name:'synthetic.txt'},requirementId:sourceId,retention:{kind:'retained'},idempotencyKey:'synthetic-file-original'};
 const result=await client.callTool({name:'lifeos_stage_file',arguments:args});assert.equal((result.structuredContent as any).ok,true);assert.equal((result.structuredContent as any).verification.verified,true);assert.equal(writes,1);
 const blocked=await client.callTool({name:'lifeos_call',arguments:{operationId:'stageFileHandoff',arguments:args}});assert.equal((blocked.structuredContent as any).status,403);assert.equal(writes,1);
 for(const operationId of ['downloadFileHandoff','acknowledgeFileHandoff'])assert.equal((await client.callTool({name:'lifeos_call',arguments:{operationId,arguments:{id}}})).isError,true);
});

test('an unknown official file call retains its safe handoff ID and dedicated original-command recovery contract',async t=>{
 const handler=createMcpHttpHandler({enabled:true,origin,dispatch:async request=>new URL(request.url).pathname.endsWith('/v2/capabilities')?Response.json({apiVersion:'2',operations:fileHandoffOperations}):Response.json({error:'FILE_HANDOFF_OUTCOME_UNKNOWN',outcome:'unknown',handoffId:id},{status:503})});
 const client=new Client({name:'synthetic-file-unknown',version:'1'},{versionNegotiation:{mode:{pin:'2026-07-28'}}});t.after(()=>client.close());await client.connect(new StreamableHTTPClientTransport(new URL(origin+'/api/platform/mcp'),{requestInit:{headers:{authorization:'Bearer synthetic-file-tool'}},fetch:async(input,init)=>{const request=new Request(input,init);request.headers.set('host','lifeos.nirvanachow.com');return handler(request);}}));
 const result=await client.callTool({name:'lifeos_stage_file',arguments:{file:{download_url:'https://synthetic.invalid/file',file_id:'file_synthetic'},requirementId:sourceId,retention:{kind:'retained'},idempotencyKey:'synthetic-file-original'}});
 assert.equal((result.structuredContent as any).outcome,'unknown');assert.equal((result.structuredContent as any).data.handoffId,id);assert.match((result.content as any)[0].text,/lifeos_stage_file/);assert.doesNotMatch((result.content as any)[0].text,/identical lifeos_call/);
});
