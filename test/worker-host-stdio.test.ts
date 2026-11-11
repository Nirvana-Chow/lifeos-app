import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
for(const modern of [true,false])test(`assigned channel uses real official ${modern?'modern':'legacy'} stdio without a generic writer`,async()=>{
 const transport=new StdioClientTransport({command:process.execPath,args:[resolve('test/fixtures/worker-host-mcp-server.ts')],env:{NODE_ENV:'test'},stderr:'pipe'});let stderr='';transport.stderr?.on('data',b=>stderr+=String(b));
 const client=new Client({name:'synthetic-assigned-client',version:'1'},{versionNegotiation:{mode:modern?{pin:'2026-07-28'}:'legacy'}});
 try{
  await client.connect(transport);assert.deepEqual((await client.listTools()).tools.map(t=>t.name),['read_assigned','claim_assigned','renew_assigned','progress_assigned']);
  assert.equal((await client.callTool({name:'read_assigned',arguments:{}})).isError,false);
  for(const name of ['lifeos_call','lifeos_retry','__proto__'])assert.equal((await client.callTool({name,arguments:{}})).isError,true);
  const rejected=await client.callTool({name:'claim_assigned',arguments:{}});assert.equal(rejected.isError,true);assert.doesNotMatch(JSON.stringify(rejected),/fixture_private_error/);assert.doesNotMatch(stderr,/fixture_private_error/);
 }finally{await client.close();await transport.close();}
});
