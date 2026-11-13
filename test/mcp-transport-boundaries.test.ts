import assert from 'node:assert/strict';
import test,{type TestContext} from 'node:test';
import {mkdtempSync,rmSync,readdirSync,readFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DurableStore} from '../src/mcp-candidate/native-store.mjs';
import {LifeOSApiClient} from '../src/mcp-candidate/client.ts';
import {agentOperations} from '../src/agent-api/capabilities.ts';
import {parseArguments} from '../src/mcp-candidate/schemas.ts';
import {createMcpChannel,type BrokerPort} from '../src/mcp-server-host-candidate/channel.ts';
import {DurableMcpClient} from '../src/mcp-server-host-candidate/client.ts';
import {canonicalJSON,localDefinitions} from '../src/mcp-server-host-candidate/contracts.ts';
import {decodeFixedBrokerChildResult} from '../src/mcp-server-host-candidate/broker-result.ts';
const fp='a'.repeat(64),fields={title:'Synthetic boundary journal',text:'Fixture only',occurredOn:null,personal:null};
const id='71111111-1111-4111-8111-111111111111',sourceId='72222222-2222-4222-8222-222222222222';
function temp(t:TestContext){const dir=mkdtempSync(join(tmpdir(),'lifeos-wave15-synthetic-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}
function snapshot(dir:string,requestId:string){const file=join(dir,requestId+'.json');return{inode:statSync(file).ino,bytes:readFileSync(file).toString('base64'),receipt:JSON.parse(readFileSync(file,'utf8')).receipt};}
function rows(dir:string):any[]{return readdirSync(dir).filter(n=>n.endsWith('.json')).map(n=>JSON.parse(readFileSync(join(dir,n),'utf8')));}
function track(store:DurableStore){const calls:string[]=[];for(const name of ['prepare','unknown','rejected','receipt','finish','settled'] as const){const old=store[name].bind(store);(store as any)[name]=(...args:any[])=>{calls.push(name);return (old as any)(...args);};}return calls;}
async function seed(store:DurableStore,transport:unknown,state:string){const requestId=randomUUID(),args={fields,idempotencyKey:'synthetic-boundary-'+requestId},op=agentOperations.find(o=>o.id==='createJournal')!,parsed=parseArguments(op,args);const request={requestId,operationId:op.id,argsJSON:canonicalJSON(args),path:transport===undefined?parsed.path:'/api/platform/mcp',encoded:JSON.stringify(parsed.body),key:parsed.key!,...(transport===undefined?{}:{transport})};const receipt={status:201,data:{entry:{id,sourceId,revision:1,fields}}};await store.exclusive(async()=>{store.prepare(request);if(state==='unknown')store.unknown(requestId);if(state==='receipt-confirmed'||state==='complete')store.receipt(requestId,receipt);if(state==='complete')store.finish(requestId,{ok:true,...receipt});});return{requestId,args};}
for(const transport of ['server-mcp-v1','future-foreign-v9','',null])for(const state of ['prepared','unknown','receipt-confirmed','complete'])test(`REST retry refuses tagged ${String(transport)} ${state} before any provider/send/settlement/transition`,async t=>{
 const dir=temp(t),store=new DurableStore(dir,fp),{requestId}=await seed(store,transport,state),before=snapshot(dir,requestId),transitions=track(store);let uses=0,catalog=0,business=0;
 const client=new LifeOSApiClient({origin:'https://lifeos.nirvanachow.com',durable:store,beforeUse:async()=>{uses++;},nativeRequest:async path=>{if(path==='/v2/capabilities'){catalog++;return{status:200,credentialFingerprint:fp,data:{apiVersion:'2',operations:agentOperations}};}business++;return{status:403,credentialFingerprint:fp,data:{error:'SYNTHETIC_DENIED'}};}});
 const result=await client.retry(requestId);t.diagnostic(JSON.stringify({result,uses,catalog,business,transitions,inodeUnchanged:snapshot(dir,requestId).inode===before.inode,bytesUnchanged:snapshot(dir,requestId).bytes===before.bytes,receiptUnchanged:JSON.stringify(snapshot(dir,requestId).receipt)===JSON.stringify(before.receipt)}));assert.equal(result.status,409);assert.equal(result.error,'FOREIGN_TRANSPORT_RECOVERY_REQUIRED');assert.equal(uses,0);assert.equal(catalog,0);assert.equal(business,0);assert.deepEqual(transitions,[]);assert.deepEqual(snapshot(dir,requestId),before);
});
for(const state of ['prepared','unknown','receipt-confirmed','complete'])test(`legacy untagged REST ${state} still restores exact command`,async t=>{
 const dir=temp(t),store=new DurableStore(dir,fp),{requestId}=await seed(store,undefined,state);let writes=0;
 const client=new LifeOSApiClient({origin:'https://lifeos.nirvanachow.com',durable:store,beforeUse:async()=>{},nativeRequest:async(path,method)=>{if(path==='/v2/capabilities')return{status:200,credentialFingerprint:fp,data:{apiVersion:'2',operations:agentOperations}};if(method==='POST')writes++;return{status:method==='POST'?201:200,credentialFingerprint:fp,data:{entry:{id,sourceId,revision:1,fields}}};}});
 const result=await client.retry(requestId);assert.equal(result.ok,true);assert.equal(result.verification?.verified,true);assert.equal(writes,['receipt-confirmed','complete'].includes(state)?0:1);assert.equal(rows(dir)[0].state,'complete');
});
type Mode={phase?:'startup'|'catalog'|'write';outer?:unknown;retry?:unknown;hint?:boolean;nonzero?:boolean;inner?:boolean;cancel?:boolean;wrongFingerprint?:boolean;extra?:boolean};
function mcp(t:TestContext,mode:Mode={}){
 const dir=temp(t),store=new DurableStore(dir,fp),abort=new AbortController();let requests=0,writes=0,submissions=0;const sent:string[]=[];
 const fixedChild=async(output:unknown,exitCode:number,cancelAfterSubmit:boolean,signal?:AbortSignal):Promise<unknown>=>{
  // The only spawned executable is the current Node, with this exact new synthetic fixture.
  const child=spawn(process.execPath,[fileURLToPath(new URL('./helpers/mcp-transport-synthetic-child.mjs',import.meta.url))],{env:{PATH:'/usr/bin:/bin',NODE_ENV:'test'},stdio:['pipe','pipe','pipe']});let text='',stderr='';
  const stop=()=>child.kill('SIGKILL');signal?.addEventListener('abort',stop,{once:true});
  return new Promise((resolve,reject)=>{child.stdout.on('data',part=>{text+=part;if(cancelAfterSubmit&&text.includes('SYNTHETIC_SUBMITTED')){submissions++;abort.abort();}});child.stderr.on('data',part=>{stderr+=part;});child.on('error',reject);child.on('close',code=>{signal?.removeEventListener('abort',stop);if(signal?.aborted||cancelAfterSubmit)return reject(Error('REMOTE_REQUEST_CANCELLED_UNCONFIRMED'));if(stderr)return reject(Error('NATIVE_STDERR_REJECTED'));try{resolve(decodeFixedBrokerChildResult(code??1,text));}catch(error){reject(error);}});child.stdin.end(JSON.stringify({output,exitCode,cancelAfterSubmit}));});
 };
 const port:BrokerPort={beforeUse:async signal=>{signal?.throwIfAborted();},fingerprint:async()=>fp,request:async(envelope,signal)=>{
  requests++;const rpc=JSON.parse(envelope.encoded),phase=rpc.method==='server/discover'?'startup':rpc.params.name==='lifeos_discover'?'catalog':'write';let result:any;
  if(phase==='startup')result={resultType:'complete',supportedVersions:['2026-07-28'],capabilities:{tools:{}}};
  else if(phase==='catalog')result={resultType:'complete',content:[],structuredContent:{apiVersion:'2',operations:localDefinitions}};
  else{writes++;sent.push(envelope.encoded);assert.ok(rows(dir).some(row=>row.request.encoded===envelope.encoded));result={resultType:'complete',content:[],isError:true,structuredContent:{ok:false,status:429,error:'RATE_LIMITED',...(mode.hint?{retryAfterSeconds:mode.retry}:{})}};}
  const active=phase===(mode.phase??'write');let output:any={status:200,credentialFingerprint:mode.wrongFingerprint&&active?'b'.repeat(64):fp,data:{jsonrpc:'2.0',id:rpc.id,result}};
  if(active&&mode.outer!==undefined)output={...output,status:mode.outer,data:{error:'SYNTHETIC_PRIVATE_BODY'},...(mode.hint?{retryAfterSeconds:mode.retry}:{})};
  if(active&&mode.nonzero)output={status:mode.outer??429,error:'BROKER_HTTP_REJECTED',...(mode.hint?{retryAfterSeconds:mode.retry}:{}),...(mode.extra?{data:{secret:'SYNTHETIC_PRIVATE_BODY'}}:{})};
  return fixedChild(output,active&&mode.nonzero?1:0,active&&Boolean(mode.cancel),AbortSignal.any([signal!,abort.signal]));
 }};
 const channel=createMcpChannel(port),client=new DurableMcpClient({channel,store});return{dir,store,client,channel,sent,get requests(){return requests;},get writes(){return writes;},get submissions(){return submissions;}};
}
for(const phase of ['startup','catalog','write'] as const)for(const nonzero of [false,true])test(`outer429 ${phase} ${nonzero?'nonzero broker':'bound response'} retains bounded wait without retry`,async t=>{
 const f=mcp(t,{phase,outer:429,retry:17,hint:true,nonzero});const result=await f.client.execute('createJournal',{fields,idempotencyKey:'synthetic-outer429-'+randomUUID()});assert.equal(result.status,429);assert.equal(result.retryAfterSeconds,17);assert.equal(result.ok,false);assert.equal(f.requests,phase==='startup'?1:phase==='catalog'?2:3);assert.equal(f.writes,phase==='write'?1:0);assert.equal(rows(f.dir).length,phase==='write'?1:0);assert.equal(JSON.stringify(result).includes('SYNTHETIC_PRIVATE_BODY'),false);assert.equal(result.outcome,undefined);
});
for(const hint of [0,3600,undefined,-1,3601,1.5,'17',null,Infinity,NaN])for(const inner of [false,true])test(`${inner?'inner':'outer'}429 safe retryAfterSeconds ${String(hint)}`,async t=>{
 const f=mcp(t,{outer:inner?undefined:429,retry:hint,hint:true,inner});const r=await f.client.execute('createJournal',{fields,idempotencyKey:'synthetic-hint-'+randomUUID()});assert.equal(r.status,429);if(typeof hint==='number'&&Number.isInteger(hint)&&hint>=0&&hint<=3600)assert.equal(r.retryAfterSeconds,hint);else assert.equal(Object.hasOwn(r,'retryAfterSeconds'),false);assert.equal(f.writes,1);assert.equal(r.outcome,undefined);
});
for(const status of [-1,0,99,600,429.5,'429',null])test(`unverified outer status ${String(status)} is not adopted`,async t=>{const f=mcp(t,{outer:status,retry:11,hint:true});const r=await f.client.execute('createJournal',{fields,idempotencyKey:'synthetic-status-'+randomUUID()});assert.equal(r.status,0);assert.equal(r.retryAfterSeconds,undefined);assert.equal(r.outcome,'unknown');assert.equal(f.writes,1);});
test('bound response wrong fingerprint does not inherit status/hint',async t=>{const f=mcp(t,{outer:429,retry:17,hint:true,wrongFingerprint:true});const r=await f.client.execute('createJournal',{fields,idempotencyKey:'synthetic-binding-'+randomUUID()});assert.equal(r.status,403);assert.equal(r.error,'CREDENTIAL_BINDING_CHANGED');assert.equal(r.retryAfterSeconds,undefined);});
test('nonzero child extra body is rejected and no success binding fabricated',async t=>{const f=mcp(t,{outer:429,retry:17,hint:true,nonzero:true,extra:true});const r=await f.client.execute('createJournal',{fields,idempotencyKey:'synthetic-extra-'+randomUUID()});assert.equal(r.status,0);assert.equal(r.retryAfterSeconds,undefined);assert.equal(r.outcome,'unknown');assert.equal(JSON.stringify(r).includes('SYNTHETIC_PRIVATE_BODY'),false);});
test('generic thrown status properties are not trusted HTTP proof',async t=>{const f=mcp(t);const channel=createMcpChannel({beforeUse:async()=>{},fingerprint:async()=>fp,request:async()=>{throw Object.assign(Error('ARBITRARY_BODY'),{status:429,retryAfterSeconds:17});}});await assert.rejects(channel.ready(),(e:any)=>e.status===0&&e.retryAfterSeconds===undefined&&!e.message.includes('ARBITRARY_BODY'));});
test('post-submit synthetic child cancellation stays unknown once with exact saved envelope/key',async t=>{const f=mcp(t,{cancel:true});const key='synthetic-cancel-'+randomUUID();const r=await f.client.execute('createJournal',{fields,idempotencyKey:key});assert.equal(r.status,0);assert.equal(r.outcome,'unknown');assert.equal(r.retryAfterSeconds,undefined);assert.equal(f.submissions,1);assert.equal(f.writes,1);assert.equal(f.requests,3);const [row]=rows(f.dir);assert.equal(row.state,'unknown');assert.equal(row.request.encoded,f.sent[0]);assert.equal(row.request.key,key);assert.equal(row.receipt,undefined);});
for(const transport of [undefined,'future-foreign-v9'])for(const state of ['prepared','unknown','receipt-confirmed','complete'])test(`MCP refuses ${String(transport)} ${state} without journal transition/business send`,async t=>{const f=mcp(t),{requestId,args}=await seed(f.store,transport,state),before=snapshot(f.dir,requestId),transitions=track(f.store);const r=await f.client.execute('createJournal',args);assert.equal(r.status,409);assert.equal(r.error,'LEGACY_HOST_RECOVERY_REQUIRED');assert.deepEqual(snapshot(f.dir,requestId),before);assert.deepEqual(transitions,[]);assert.equal(f.writes,0);});
// Named-source contract: BrokerCommand.swift emits this exact error on exit 1 only.
test('fixed child accepts only verified BROKER_HTTP_REJECTED on exit 1; other uppercase codes stay generic',()=>{
 for(const error of ['ARBITRARY_HTTP_ERROR','HTTP_STATUS_REJECTED','CREDENTIAL_UNAVAILABLE','CREDENTIAL_BINDING_CHANGED'])assert.throws(()=>decodeFixedBrokerChildResult(1,JSON.stringify({error,status:429,retryAfterSeconds:17})),(e:any)=>e.status===undefined&&e.retryAfterSeconds===undefined);
 for(const code of [2,78,-1])assert.throws(()=>decodeFixedBrokerChildResult(code,JSON.stringify({error:'BROKER_HTTP_REJECTED',status:429,retryAfterSeconds:17})),(e:any)=>e.status===undefined&&e.retryAfterSeconds===undefined);
 for(const status of [0,200,201,299,'429',429.5,600])assert.throws(()=>decodeFixedBrokerChildResult(1,JSON.stringify({error:'BROKER_HTTP_REJECTED',status,retryAfterSeconds:17})),(e:any)=>e.status===undefined&&e.retryAfterSeconds===undefined);
});
for(const hint of [-1,3601,1.5,'17',null])test(`nonzero BROKER_HTTP_REJECTED discards invalid hint ${String(hint)}`,async t=>{const f=mcp(t,{outer:429,retry:hint,hint:true,nonzero:true});const r=await f.client.execute('createJournal',{fields,idempotencyKey:'synthetic-nonzero-invalid-'+randomUUID()});assert.equal(r.status,429);assert.equal(Object.hasOwn(r,'retryAfterSeconds'),false);assert.equal(f.writes,1);});
test('bound outer429 without hint retains status as it already did upstream',async t=>{const f=mcp(t,{outer:429});const r=await f.client.execute('createJournal',{fields,idempotencyKey:'synthetic-nohint-'+randomUUID()});assert.equal(r.status,429);assert.equal(Object.hasOwn(r,'retryAfterSeconds'),false);assert.equal(f.writes,1);});
for(const status of [401,403,503])test(`named nonzero HTTP ${status} retains status without success fingerprint/retry`,async t=>{const f=mcp(t,{outer:status,nonzero:true});const r=await f.client.execute('createJournal',{fields,idempotencyKey:'synthetic-http-'+randomUUID()});assert.equal(r.status,status);assert.equal(r.ok,false);assert.equal(f.writes,1);assert.equal(r.retryAfterSeconds,undefined);assert.equal(r.outcome,status===503?'unknown':undefined);assert.equal(Object.hasOwn(r,'credentialFingerprint'),false);assert.equal(rows(f.dir)[0].receipt,undefined);});
