import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:https';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {createAgentHandler} from '../src/agent-api/http.ts';
import {MemoryPort} from './helpers/platform.ts';
import {agentOperations} from '../src/agent-api/capabilities.ts';
import {calendarFields} from './helpers/personal-calendar-port.ts';
import {emptyHealthFields} from '../src/personal-health/presentation.ts';
import {emptyPersonPersonal} from '../src/personal-people/model.ts';
const secret='synthetic-stdio-provider-key';
// Missing generic operation dispatch, frozen recovery or fresh catalog denial breaks real protocol consumers.
for(const modern of [true,false])test(`official client ${modern?'modern':'legacy'} stdio uses native HTTPS writer, frozen retry and current grants`,async()=>{
 const dir=await mkdtemp(join(tmpdir(),'lifeos-mcp-native-'));let server:ReturnType<typeof createServer>|undefined;
 try{
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost'],{stdio:'ignore'});
  let handler:(r:Request)=>Promise<Response>=async()=>new Response('',{status:503});
  let lost=false,redirect=false,revoked=false,writable=true,allBusiness=false;let posts=0;let forbiddenRequests=0;const requests:string[]=[];
  server=createServer({key:await readFile(join(dir,'key.pem')),cert:await readFile(join(dir,'cert.pem'))},async(req,res)=>{
   requests.push(req.method+' '+req.url);
   if(req.url==='/forbidden-redirect'){forbiddenRequests++;res.end('{}');return;}
   const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk);
   if(redirect&&req.url?.endsWith('/todos')){res.writeHead(302,{location:'https://127.0.0.1:'+String((server!.address() as {port:number}).port)+'/forbidden-redirect'});res.end();return;}
   const request=new Request('https://'+req.headers.host+req.url,{method:req.method,headers:Object.fromEntries(Object.entries(req.headers).filter((e):e is [string,string]=>typeof e[1]==='string')),...(chunks.length?{body:Buffer.concat(chunks)}:{})});
   const response=await handler(request);if(req.method==='POST'||req.method==='PATCH'){posts++;if(lost){lost=false;req.socket.destroy();return;}}
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise<void>(done=>server!.listen(0,'127.0.0.1',done));const port=(server.address() as {port:number}).port,origin='https://127.0.0.1:'+port;
  const repository=new MemoryPort();repository.readCurrentSnapshot=async()=>structuredClone([...repository.rows.values()]);
  const transaction=repository.transaction.bind(repository);repository.transaction=(owner,key,run)=>transaction(owner,key,tx=>run({...tx,lockRecordIdentity:async()=>{},lockAgentGrant:async()=>!revoked}));
  const grant=()=>({grantId:'synthetic-grant',ownerId:'synthetic-owner',spaceId:'synthetic-space',scopes:allBusiness?[...new Set(agentOperations.flatMap(op=>op.requiredScopes))]:writable?['todo:read','todo:write'] as const:['todo:read'] as const,...(allBusiness?{businessDataPolicy:'all-personal-business-v1' as const,allowedOperationIds:agentOperations.filter(op=>op.module!=='catalog').map(op=>op.id)}:{})});
  handler=createAgentHandler({enabled:true,mountPath:'/api/platform/agent',fenceWrites:true,modules:{organization:true,classification:false,personalRecords:true,businessDataPolicy:true,requirements:true},repository,config:{ownerId:'synthetic-owner',spaceId:'synthetic-space',ownerEmail:'fixture@example.invalid',databaseName:'fixture',approval:'personal-manual-v1',allowedTypes:['todo','journal','project','domain','topic'],requirementsEnabled:true,requirementSupportEnabled:true,calendarEnabled:true,healthEnabled:true,peopleEnabled:true,financeEnabled:true,baseURL:origin},verify:async key=>key===secret&&!revoked?grant():null,readCurrentGrant:async()=>revoked?null:grant(),operationAvailable:()=>true,assertWritable:async()=>{}});
  const transport=new StdioClientTransport({command:process.execPath,args:[resolve('test/helpers/lifeos-mcp-child.ts'),origin],env:{NODE_EXTRA_CA_CERTS:join(dir,'cert.pem')},stderr:'pipe'});let stderr='';transport.stderr?.on('data',chunk=>{stderr+=chunk;});
  const client=new Client({name:'synthetic-mcp-qualification',version:'1'},{versionNegotiation:{mode:modern?{pin:'2026-07-28'}:'legacy'}});
  try{
   await client.connect(transport);assert.equal(client.getNegotiatedProtocolVersion(),modern?'2026-07-28':'2025-11-25');
   const list=await client.listTools();assert.deepEqual(list.tools.map(t=>t.name),['lifeos_discover','lifeos_call','lifeos_retry']);
   const discover=await client.callTool({name:'lifeos_discover',arguments:{}});assert.equal(discover.isError,false);
   const catalog=discover.structuredContent as {apiVersion:string;operations:{id:string}[]};assert.equal(catalog.apiVersion,'2');assert.ok(catalog.operations.some(op=>op.id==='createTodo'));assert.equal(catalog.operations.some(op=>/approve|security|key/i.test(op.id)),false);
   const fields={title:'Synthetic MCP task',notes:'',dueOn:null,status:'open'};
   const created=await client.callTool({name:'lifeos_call',arguments:{operationId:'createTodo',arguments:{fields,idempotencyKey:'synthetic-stdio-create'}}});
   const result=created.structuredContent as {ok:boolean;data:{entry:{id:string;revision:number}};readback:{ok:boolean;data:{id:string}}};assert.equal(result.ok,true);assert.equal(result.readback.ok,true);assert.equal(result.readback.data.id,result.data.entry.id);assert.equal(repository.rows.size,1);
   lost=true;const unknown=await client.callTool({name:'lifeos_call',arguments:{operationId:'updateTodo',arguments:{id:result.data.entry.id,fields:{...fields,status:'done',personal:null},expectedRevision:1,idempotencyKey:'synthetic-stdio-update'}}});
   const pending=unknown.structuredContent as {outcome:string;recovery:{requestId:string};readback:{ok:boolean;data:{revision:number}}};assert.equal(pending.outcome,'unknown');assert.equal(pending.readback.ok,true);assert.equal(pending.readback.data.revision,2);
   const retry=await client.callTool({name:'lifeos_retry',arguments:{requestId:pending.recovery.requestId}});assert.equal((retry.structuredContent as {data:{duplicate:boolean}}).data.duplicate,true);assert.equal(repository.rows.size,1);assert.equal([...repository.rows.values()][0].revision,2);assert.equal(posts,3);
   // The provider/key is unchanged when the existing explicitly selected all-business policy expands discovery.
   allBusiness=true;
   const examples=[
    ['createJournal',{title:'Synthetic journal',text:'Text',occurredOn:null,personal:null}],
    ['createCalendar',calendarFields],['createHealth',{...emptyHealthFields('body','Asia/Shanghai'),title:'Synthetic body'}],
    ['createPerson',{title:'Synthetic person',text:'',occurredOn:null,personal:emptyPersonPersonal()}],
    ['createFinance',{kind:'expense',amountMinor:123,currency:'CNY',occurredOn:'2026-11-05',category:null,fromAccountRef:null,toAccountRef:null,originalEntryId:null,notes:'Synthetic'}],
    ['createFeedback',{title:'Synthetic feedback',text:'Feedback',sourceLabel:null}],
    ['createRequirement',{title:'Synthetic requirement',body:'Purpose',phaseId:'business',priority:'P1',plannedStartOn:null,plannedEndOn:null,workflow:{state:'planned',purpose:'Record',nextStep:'Review'}}],
   ] as const;
   for(const [operationId,fields] of examples){const saved=await client.callTool({name:'lifeos_call',arguments:{operationId,arguments:{fields,idempotencyKey:'synthetic-parity-'+operationId}}});const value=saved.structuredContent as {ok:boolean;readback:{ok:boolean}};assert.equal(value.ok,true,operationId+JSON.stringify(value));assert.equal(value.readback.ok,true,operationId);}
   allBusiness=false;const afterParity=posts;assert.equal(afterParity,10);
   const before=requests.length;const injection=await client.callTool({name:'lifeos_call',arguments:{operationId:'listTodos',arguments:{host:'https://evil.invalid',headers:{authorization:secret}}}});assert.equal(injection.isError,true);assert.equal(JSON.stringify(injection).includes(secret),false);assert.equal(requests.length-before,1);
   redirect=true;const redirected=await client.callTool({name:'lifeos_call',arguments:{operationId:'listTodos',arguments:{}}});assert.equal(redirected.isError,true);assert.equal(forbiddenRequests,0);redirect=false;
   writable=false;const readonly=await client.listTools();assert.equal(readonly.tools.some(t=>t.name==='lifeos_retry'),false);
   const deniedWrite=await client.callTool({name:'lifeos_call',arguments:{operationId:'createTodo',arguments:{fields,idempotencyKey:'synthetic-readonly'}}});assert.equal(deniedWrite.isError,true);assert.equal(posts,afterParity);writable=true;
   lost=true;const pendingAgain=await client.callTool({name:'lifeos_call',arguments:{operationId:'updateTodo',arguments:{id:result.data.entry.id,fields:{...fields,status:'open',personal:null},expectedRevision:2,idempotencyKey:'synthetic-revoke-retry'}}});
   const recovery=(pendingAgain.structuredContent as {recovery:{requestId:string}}).recovery;assert.ok(recovery.requestId);assert.equal(posts,afterParity+1);
   revoked=true;const stoppedRetry=await client.callTool({name:'lifeos_retry',arguments:{requestId:recovery.requestId}});assert.equal(stoppedRetry.isError,true);assert.equal((stoppedRetry.structuredContent as {outcome:string}).outcome,'unknown');assert.equal(posts,afterParity+1);
   await assert.rejects(client.listTools(),/API_DISCOVERY_UNAVAILABLE/);const denied=await client.callTool({name:'lifeos_call',arguments:{operationId:'listTodos',arguments:{}}});assert.equal(denied.isError,true);assert.equal((denied.structuredContent as {status:number}).status,401);
   assert.equal(stderr.includes(secret),false);
  }finally{await client.close();await transport.close();}
 }finally{server?.closeAllConnections();if(server)await new Promise<void>(done=>server!.close(()=>done()));await rm(dir,{recursive:true,force:true});}
});
test('default executable closes without inspecting credentials, env or the host',()=>{
 let failed:unknown;try{execFileSync(process.execPath,[resolve('scripts/lifeos-mcp.ts')],{env:{NODE_ENV:'test',LIFEOS_MCP_KEY:secret},stdio:'pipe'});}catch(e){failed=e;}
 assert.ok(failed);const result=failed as {status:number;stdout:Buffer;stderr:Buffer};assert.equal(result.status,1);assert.equal(result.stdout.toString(),'');assert.equal(result.stderr.toString(),'MCP_CREDENTIAL_RUNTIME_UNAVAILABLE\n');
});
