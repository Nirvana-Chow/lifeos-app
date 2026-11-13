import test from 'node:test';import assert from 'node:assert/strict';import {Client,InMemoryTransport} from '@modelcontextprotocol/client';
import {createLifeOSMcpServer} from '../src/mcp-candidate/tools.ts';import {LifeOSApiClient} from '../src/mcp-candidate/client.ts';import {fileHandoffOperations} from '../src/file-handoff/operations.ts';
test('native file receive is an explicit adopted tool while generic file writes cannot bypass actual download verification',async t=>{
 const api=new LifeOSApiClient({origin:'https://synthetic.example.test',credentialProvider:async()=> 'synthetic',fileHandoff:'file-handoff-v1'},async()=>Response.json({apiVersion:'2',operations:fileHandoffOperations}));let received=0;
 const receiver={available:async()=>true,receive:async()=>{received++;return{file:{id:'00000000-0000-4000-8000-000000000001',filename:'original.txt',sha256:'a'.repeat(64),bytes:7},acknowledgment:{ok:true,status:200}};}};
 const server=createLifeOSMcpServer({client:api,fileReceiver:receiver} as any),client=new Client({name:'synthetic-native-file',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);t.after(async()=>{await client.close();await server.close();});
 const tools=(await client.listTools()).tools;assert.ok(tools.some(tool=>tool.name==='lifeos_receive_file'));
 const id='00000000-0000-4000-8000-000000000001';
 assert.equal((await client.callTool({name:'lifeos_call',arguments:{operationId:'acknowledgeFileHandoff',arguments:{id,expectedRevision:2,sha256:'a'.repeat(64),bytes:7,idempotencyKey:'synthetic-forged-confirmation'}}})).isError,true);assert.equal(received,0);
 const result=await client.callTool({name:'lifeos_receive_file',arguments:{id,filename:'original.txt',idempotencyKey:'synthetic-verified-receive'}});assert.equal(result.isError,false);assert.equal(received,1);
 assert.equal((await client.callTool({name:'lifeos_receive_file',arguments:{id,filename:'../outside',idempotencyKey:'synthetic-denied-receive'}})).isError,true);assert.equal(received,1);
});
