import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {readReviewConfig,loadReviewEnvironment} from '../src/platform/private-config.ts';
const base={LIFEOS_PLATFORM_CANDIDATE:'1',LIFEOS_PLATFORM_TARGET:'isolated-test',LIFEOS_PLATFORM_BASE_URL:'https://review.example.test',LIFEOS_PLATFORM_TRANSPORT:'https-origin',LIFEOS_PLATFORM_HTTPS_HOST:'review.example.test',LIFEOS_PLATFORM_OWNER_ID:'personal-review-user',LIFEOS_PLATFORM_OWNER_EMAIL:'owner@example.test',LIFEOS_PLATFORM_SECRET:'synthetic-only-not-real-secret-000000000000',LIFEOS_PLATFORM_TEST_DATABASE_URL:'postgresql://lifeos_platform_candidate_runtime:synthetic-not-real@127.0.0.1:55432/lifeos_platform_test_local'};
const personal={LIFEOS_PERSONAL_ENABLED:'1',LIFEOS_PERSONAL_APPROVED:'personal-manual-v1',LIFEOS_PERSONAL_OWNER_ID:base.LIFEOS_PLATFORM_OWNER_ID,LIFEOS_PERSONAL_OWNER_EMAIL:base.LIFEOS_PLATFORM_OWNER_EMAIL,LIFEOS_PERSONAL_SPACE_ID:'personal-review-space',LIFEOS_PERSONAL_DATABASE_NAME:'lifeos_platform_test_local',LIFEOS_PERSONAL_ALLOWED_TYPES:'todo,journal'};
function config<T>(value:object,fn:(path:string)=>T):T{const dir=mkdtempSync(join(tmpdir(),'lifeos-r516-runtime-')),path=join(dir,'runtime.json');try{writeFileSync(path,JSON.stringify(value),{mode:0o600});return fn(path);}finally{rmSync(dir,{recursive:true,force:true});}}
test('personal protected startup requires exact complete binding; ordinary fixture restriction stays closed',()=>{
 config({...base,...personal},path=>assert.equal(readReviewConfig(path).LIFEOS_PERSONAL_SPACE_ID,'personal-review-space'));
 for(const change of [{LIFEOS_PERSONAL_ENABLED:'0'},{LIFEOS_PERSONAL_APPROVED:'yes'},{LIFEOS_PERSONAL_OWNER_ID:'different-user'},{LIFEOS_PERSONAL_DATABASE_NAME:'lifeos_other'},{LIFEOS_PERSONAL_ALLOWED_TYPES:'todo,journal,finance'},{LIFEOS_PLATFORM_TRANSPORT:'loopback'}])config({...base,...personal,...change},path=>assert.throws(()=>readReviewConfig(path),/Isolated review configuration unavailable/));
 config(base,path=>assert.throws(()=>readReviewConfig(path)));
});
test('absence of protected personal flag clears inherited enable instead of activating personal space',()=>{
 const fixture={...base,LIFEOS_PLATFORM_OWNER_ID:'fixture-owner-a',LIFEOS_PLATFORM_OWNER_EMAIL:'fixture@example.invalid'};
 config(fixture,path=>{const inherited:Record<string,string|undefined>={...personal};loadReviewEnvironment(path,inherited);assert.equal(inherited.LIFEOS_PERSONAL_ENABLED,undefined);assert.equal(inherited.LIFEOS_PERSONAL_SPACE_ID,undefined);assert.equal(inherited.LIFEOS_PLATFORM_OWNER_ID,'fixture-owner-a');});
});
import {createPersonalPlatformHandler,personalPermitBinding} from '../src/personal-candidate/runtime-http.ts';
import {readPersonalConfig} from '../src/personal-candidate/config.ts';
import {MemoryPort} from './helpers/platform.ts';
const configValue=readPersonalConfig({...base,...personal},{ownerId:base.LIFEOS_PLATFORM_OWNER_ID,ownerEmail:base.LIFEOS_PLATFORM_OWNER_EMAIL,baseURL:base.LIFEOS_PLATFORM_BASE_URL,databaseURL:base.LIFEOS_PLATFORM_TEST_DATABASE_URL})!;
function runtime(session:{userId:string;email:string}|null={userId:configValue.ownerId,email:configValue.ownerEmail},write=true){let touched=0;const repo=new MemoryPort(),handler=createPersonalPlatformHandler({repository:repo,config:configValue,storageVerified:true,sessions:{read:async()=>session},assertWritable:async()=>{touched++;if(!write)throw Error('synthetic-secret-must-not-escape');}});return{handler,repo,get touched(){return touched;},request:async(path:string,method='GET',body?:unknown)=>{const r=await handler(new Request(configValue.baseURL+'/api/platform/'+path,{method,headers:{host:new URL(configValue.baseURL).host,origin:configValue.baseURL,...(body?{'content-type':'application/json','idempotency-key':'personal-root-command'}:{})},...(body?{body:JSON.stringify(body)}:{})}));return{status:r.status,body:await r.json()};}};}
test('manual runtime availability contains no identity and keeps anonymous/foreign identities out of business APIs',async()=>{
 const anon=runtime(null),available=await anon.request('personal/availability');assert.equal(available.status,200);assert.equal(available.body.configured,true);assert.equal('ownerId'in available.body,false);assert.equal((await anon.request('personal/status')).status,401);assert.equal((await anon.request('personal/todo')).status,401);
 const foreign=runtime({userId:'different-owner',email:configValue.ownerEmail});assert.equal((await foreign.request('personal/status')).status,403);
 const owner=runtime();assert.equal((await owner.request('personal/status')).body.scope,'personal-manual-candidate');for(const route of ['todos','finance','capture/confirm','ai/settings','calendar','inbox'])assert.equal((await owner.request(route)).status,404);
});
test('missing permit reports read-only capability and cannot save via personal or legacy endpoints',async()=>{
 const app=runtime(undefined,false);const status=await app.request('personal/status');assert.equal(status.body.writable,false);assert.doesNotMatch(JSON.stringify(status),/synthetic-secret/);
 const saved=await app.request('personal/todo','POST',{spaceId:configValue.spaceId,confirmed:true,fields:{title:'synthetic manual task',notes:'',dueOn:null,status:'open'}});assert.equal(saved.status,503);assert.equal((await app.repo.list(configValue.ownerId,'todo')).length,0);assert.equal((await app.request('todos','POST',{title:'bypass'})).status,404);
});
test('permit binding changes with identity/space/origin and excludes raw credentials',()=>{
 const a=personalPermitBinding(configValue,'a'.repeat(40)),b=personalPermitBinding({...configValue,spaceId:'another-approved-space'},'a'.repeat(40));assert.notEqual(a.configDigest,b.configDigest);assert.equal(a.configDigest.length,64);assert.doesNotMatch(JSON.stringify(a),/password|synthetic-not-real|owner@example/);
});
import {createPlatformAuth,authRequest} from '../src/platform/auth.ts';
import {readPlatformConfig} from '../src/platform/config.ts';
test('personal Better Auth session creation rechecks revoked permit and disables sliding refresh',async()=>{
 const config=readPlatformConfig(base)!;let checked=0;
 const auth=createPlatformAuth(config,memoryAdapter({}),{disableSessionRefresh:true,assertSessionWrite:async()=>{checked++;throw Error('synthetic-private-cause');}});
 assert.equal(auth.options.session?.disableSessionRefresh,true);
 const hook=auth.options.databaseHooks!.session!.create!.before!;
 const context={context:{internalAdapter:{findUserById:async()=>({id:config.ownerId,email:config.ownerEmail})}}};
 const result=await hook({userId:config.ownerId,expiresAt:new Date(Date.now()+1000)} as never,context as never);
 assert.equal(result,false);assert.equal(checked,1);
});

test('pinned HTTPS loopback proxy reaches personal business endpoints after origin boundary',async()=>{
 const app=runtime(),response=await app.handler(new Request('http://127.0.0.1:3002/api/platform/personal/todo',{method:'POST',headers:{host:'review.example.test','x-forwarded-host':'review.example.test','x-forwarded-proto':'https','x-forwarded-port':'443',origin:configValue.baseURL,'content-type':'application/json','idempotency-key':'personal-proxy-command'},body:JSON.stringify({spaceId:configValue.spaceId,confirmed:true,fields:{title:'Synthetic proxy task',notes:'',dueOn:null,status:'open'}})}));assert.equal(response.status,201,await response.text());
});
import {memoryAdapter} from 'better-auth/adapters/memory';
import {hashPassword} from 'better-auth/crypto';
test('personal readonly auth GET performs zero adapter DML including expired session cleanup and rate limit',async()=>{
 const config=readPlatformConfig(base)!,now=new Date(),password='Synthetic-only-password-r516';
 const db:Record<string,Record<string,unknown>[]>={platform_user:[{id:config.ownerId,name:'Synthetic personal review',email:config.ownerEmail,emailVerified:false,createdAt:now,updatedAt:now}],platform_account:[{id:'synthetic-account-r516',accountId:config.ownerId,providerId:'credential',userId:config.ownerId,password:await hashPassword(password),createdAt:now,updatedAt:now}],platform_session:[],platform_verification:[],platform_rate_limit:[]};
 const normal=createPlatformAuth(config,memoryAdapter(db)),login=await authRequest(new Request(config.baseURL+'/api/platform/auth/sign-in/email',{method:'POST',headers:{host:new URL(config.baseURL).host,origin:config.baseURL,'content-type':'application/json'},body:JSON.stringify({email:config.ownerEmail,password,rememberMe:false})}),config,r=>normal.handler(r));assert.equal(login.status,200);
 const cookie=login.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');db.platform_session[0].expiresAt=new Date(Date.now()-1000);const before=JSON.stringify(db),factory=memoryAdapter(db);let dml=0;
 const spy:typeof factory=options=>new Proxy(factory(options),{get(target,key,receiver){const value=Reflect.get(target,key,receiver);if(['create','update','updateMany','delete','deleteMany'].includes(String(key))&&typeof value==='function')return(...args:unknown[])=>{dml++;return Reflect.apply(value,target,args);};return value;}});
 const readonly=createPlatformAuth(config,spy,{readOnlySessions:true,disableSessionRefresh:true});
 const read=await authRequest(new Request(config.baseURL+'/api/platform/auth/get-session',{headers:{host:new URL(config.baseURL).host,cookie}}),config,r=>readonly.handler(r));assert.equal(read.status,200);assert.equal(await read.json(),null);assert.equal(await (await import('../src/platform/auth.ts')).readOwnerPrincipal(readonly,config,new Headers({cookie})),null);assert.equal(dml,0);assert.equal(JSON.stringify(db),before);
});
test('sign-in POST rechecks permit after a slow body before native limiter dispatch',async()=>{
 let allow=true,calls=0,checked=0;let streamController:ReadableStreamDefaultController<Uint8Array>;
 const body=new ReadableStream<Uint8Array>({start(c){streamController=c;}}),config=readPlatformConfig(base)!;
 const request=new Request(config.baseURL+'/api/platform/auth/sign-in/email',{method:'POST',headers:{host:new URL(config.baseURL).host,origin:config.baseURL,'content-type':'application/json'},body,duplex:'half'} as RequestInit);
 const operation=authRequest(request,config,async()=>{calls++;return Response.json({ok:true});},{assertWrite:async()=>{checked++;if(!allow)throw new (await import('../src/platform/domain.ts')).PlatformError(503,'PERSONAL_WRITES_LOCKED','closed');}});
 await new Promise(resolve=>setImmediate(resolve));allow=false;streamController!.enqueue(new TextEncoder().encode('{}'));streamController!.close();const response=await operation;assert.equal(response.status,503);assert.equal(calls,0);assert.equal(checked,2);
});

test('personal session updates refuse revoked permit while revocation remains available',async()=>{
 let checked=0;const auth=createPlatformAuth(readPlatformConfig(base)!,memoryAdapter({}),{assertSessionWrite:async()=>{checked++;throw Error('synthetic-closed');}}),hooks=auth.options.databaseHooks!.session!;
 assert.equal(await hooks.update!.before!(),false);assert.equal(await hooks.delete!.before!(),undefined);assert.equal(checked,1);
});
test('malformed optional recovery approval cannot close unrelated personal startup',()=>{config({...base,...personal,LIFEOS_PERSONAL_RECOVERY_APPROVAL:{wrong:true}},path=>{const value=readReviewConfig(path);assert.equal(value.LIFEOS_PERSONAL_SPACE_ID,'personal-review-space');assert.equal(value.LIFEOS_PERSONAL_RECOVERY_APPROVAL,undefined);});});

test('protected personal target selects only the already validated explicit database; nonpersonal remains local',()=>{
 const name='lifeos_platform_test_synthetic_release',value={...base,...personal,LIFEOS_PERSONAL_DATABASE_NAME:name,LIFEOS_PLATFORM_TEST_DATABASE_URL:base.LIFEOS_PLATFORM_TEST_DATABASE_URL.replace('/lifeos_platform_test_local','/'+name)};
 config(value,path=>{assert.equal(readReviewConfig(path).LIFEOS_PERSONAL_DATABASE_NAME,name);const inherited:Record<string,string|undefined>={LIFEOS_PERSONAL_BOOTSTRAP:'1'};loadReviewEnvironment(path,inherited);assert.equal(inherited.LIFEOS_PERSONAL_DATABASE_NAME,name);assert.equal(inherited.LIFEOS_PERSONAL_BOOTSTRAP,undefined);});
 for(const delta of [{LIFEOS_PERSONAL_APPROVED:''},{LIFEOS_PERSONAL_OWNER_ID:'changed-owner'},{LIFEOS_PLATFORM_TEST_DATABASE_URL:value.LIFEOS_PLATFORM_TEST_DATABASE_URL+'_mismatch'},{LIFEOS_PLATFORM_TEST_DATABASE_URL:value.LIFEOS_PLATFORM_TEST_DATABASE_URL+'?sslmode=disable'},{LIFEOS_PLATFORM_TEST_DATABASE_URL:value.LIFEOS_PLATFORM_TEST_DATABASE_URL+'#fragment'},{LIFEOS_PLATFORM_TEST_DATABASE_URL:value.LIFEOS_PLATFORM_TEST_DATABASE_URL.replace(':55432',':5432')},{LIFEOS_PLATFORM_TEST_DATABASE_URL:value.LIFEOS_PLATFORM_TEST_DATABASE_URL.replace('127.0.0.1','localhost')},{LIFEOS_PLATFORM_TEST_DATABASE_URL:value.LIFEOS_PLATFORM_TEST_DATABASE_URL.replace('candidate_runtime','candidate_owner')}])config({...value,...delta},path=>assert.throws(()=>readReviewConfig(path)));
 config({...base,LIFEOS_PLATFORM_OWNER_ID:'fixture-owner-a',LIFEOS_PLATFORM_OWNER_EMAIL:'fixture@example.invalid',LIFEOS_PLATFORM_TEST_DATABASE_URL:value.LIFEOS_PLATFORM_TEST_DATABASE_URL},path=>assert.throws(()=>readReviewConfig(path)));
});
