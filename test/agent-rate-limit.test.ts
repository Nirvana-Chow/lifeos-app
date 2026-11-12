import assert from 'node:assert/strict';
import test from 'node:test';
import {betterAuth} from 'better-auth';
import {memoryAdapter} from 'better-auth/adapters/memory';
import {apiKey} from '@better-auth/api-key';
import {createAgentHandler} from '../src/agent-api/http.ts';
import {AgentRateLimitError} from '../src/agent-api/rate-limit.ts';
import {PlatformError} from '../src/platform/domain.ts';
import {MemoryPort} from './helpers/platform.ts';

const baseURL='http://127.0.0.1:3190';
const config={ownerId:'synthetic-rate-owner',ownerEmail:'fixture@example.invalid',spaceId:'synthetic-rate-space',baseURL,databaseName:'fixture',allowedTypes:['todo'],approval:'personal-manual-v1'} as const;
const sentinel='synthetic-private-plugin-message-and-key';
function fixture(error:Error,enabled=true){
 const repository=new MemoryPort();let verifications=0,writes=0;
 const handler=createAgentHandler({config,repository,enabled,verify:async()=>{verifications++;throw error;},readCurrentGrant:async()=>null,assertWritable:async()=>{writes++;}});
 const send=(method='GET')=>handler(new Request(baseURL+(method==='GET'?'/v2/capabilities':'/v1/todos'),{method,headers:{host:'127.0.0.1:3190',authorization:'Bearer synthetic-rate-only',...(method==='POST'?{'content-type':'application/json','idempotency-key':'synthetic-limited-write'}:{})},...(method==='POST'?{body:JSON.stringify({fields:{title:'Synthetic',notes:'',dueOn:null,status:'open'}})}:{})}));
 return{repository,send,verifications:()=>verifications,writes:()=>writes};
}
async function assertLimited(response:Response,seconds:string|null){
 assert.equal(response.status,429);
 assert.equal(response.headers.get('retry-after'),seconds);
 assert.equal(response.headers.get('cache-control'),'private, no-store');
 assert.equal(response.headers.get('vary'),'Authorization');
 assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 assert.deepEqual(await response.json(),{error:'RATE_LIMITED'});
}

for(const [ms,seconds] of [[0,'0'],[0.1,'1'],[1,'1'],[999,'1'],[1000,'1'],[1000.1,'2'],[3599999.9,'3600'],[3600000,'3600']] as const){
 test('native RATE_LIMITED milliseconds produce bounded Retry-After: '+ms,async()=>{
  const f=fixture(new AgentRateLimitError({code:'RATE_LIMITED',message:sentinel,details:{tryAgainIn:ms,privateValue:sentinel},key:sentinel}));
  await assertLimited(await f.send(),seconds);
  assert.equal(f.verifications(),1);assert.equal(f.repository.reads,0);assert.equal(f.repository.rows.size,0);
 });
}
const invalid:readonly unknown[]=[undefined,null,-1,-0.1,3600000.1,Infinity,-Infinity,NaN,'30000',true,{},[],1n];
for(const [index,ms] of invalid.entries()){
 test('invalid or absent milliseconds do not invent a Retry-After: '+index,async()=>{
  const f=fixture(new AgentRateLimitError({code:'RATE_LIMITED',details:{tryAgainIn:ms},message:sentinel}));
  await assertLimited(await f.send(),null);
  assert.equal(f.verifications(),1);assert.equal(f.repository.reads,0);
 });
}
for(const [index,error] of [undefined,null,{},[],{code:'RATE_LIMITED'},{code:'RATE_LIMITED',details:null},{code:'RATE_LIMITED',details:'30000'},{code:'OTHER',details:{tryAgainIn:30000}}].entries()){
 test('missing or unrelated native details do not produce a hint: '+index,async()=>{
  await assertLimited(await fixture(new AgentRateLimitError(error)).send(),null);
 });
}
test('limited writes remain blocked and are not automatically retried',async()=>{
 const f=fixture(new AgentRateLimitError({code:'RATE_LIMITED',details:{tryAgainIn:30001}}));
 await assertLimited(await f.send('POST'),'31');
 assert.equal(f.verifications(),1);assert.equal(f.writes(),0);assert.equal(f.repository.reads,0);assert.equal(f.repository.events.length,0);assert.equal(f.repository.receipts.size,0);
});
test('ordinary errors and disabled routes cannot acquire a rate hint',async()=>{
 for(const status of [401,403,429,503]){
  const code=status===429?'RATE_LIMITED':'FIXTURE_REJECTED';
  const error=Object.assign(new PlatformError(status,code,sentinel),{retryAfterSeconds:30,details:{tryAgainIn:30000}});
  const response=await fixture(error).send();
  assert.equal(response.status,status);assert.equal(response.headers.get('retry-after'),null);assert.deepEqual(await response.json(),{error:code});
 }
 const disabled=fixture(new AgentRateLimitError({code:'RATE_LIMITED',details:{tryAgainIn:30000}}),false);
 assert.equal((await disabled.send()).status,404);assert.equal(disabled.verifications(),0);
});

test('installed native API-key verifier returns millisecond details through its public API',async()=>{
 const ownerId='synthetic-rate-library-owner',now=new Date();
 const database:Record<string,Record<string,unknown>[]>={user:[{id:ownerId,name:'Synthetic',email:'rate-library@example.invalid',emailVerified:false,createdAt:now,updatedAt:now}],apikey:[],session:[],account:[],verification:[]};
 const auth=betterAuth({baseURL,secret:'synthetic-only-rate-limit-secret-000000000000',database:memoryAdapter(database),logger:{disabled:true},telemetry:{enabled:false},plugins:[apiKey({enableSessionForAPIKeys:false,enableMetadata:true,startingCharactersConfig:{shouldStore:false}})]});
 await auth.$context;
 const issued=await auth.api.createApiKey({body:{userId:ownerId,rateLimitEnabled:true,rateLimitTimeWindow:60000,rateLimitMax:1}});
 assert.equal((await auth.api.verifyApiKey({body:{key:issued.key}})).valid,true);
 const limited=await auth.api.verifyApiKey({body:{key:issued.key}});
 assert.equal(limited.valid,false);assert.equal(limited.error?.code,'RATE_LIMITED');
 const error:unknown=limited.error;
 assert.ok(error&&typeof error==='object'&&'details' in error);
 const details=error.details;assert.ok(details&&typeof details==='object'&&'tryAgainIn' in details);
 const ms=details.tryAgainIn;assert.ok(typeof ms==='number'&&ms>1000&&ms<=60000,'the installed plugin must expose milliseconds, not seconds');
 await assertLimited(await fixture(new AgentRateLimitError(error)).send(),String(Math.ceil(ms/1000)));
});
