import test from 'node:test';import assert from 'node:assert/strict';
import {createPersonalPlatformHandler} from '../src/personal-candidate/runtime-http.ts';import {AuthorityService} from '../src/agent-authority/service.ts';import {MemoryPort} from './helpers/platform.ts';
const origin='https://synthetic-files.example.test',id='00000000-0000-4000-8000-000000000001',bytes=Buffer.from('actual website original');
const config={ownerId:'synthetic-owner',ownerEmail:'owner@example.test',spaceId:'synthetic-space',databaseName:'synthetic',baseURL:origin,approval:'personal-manual-v1',allowedTypes:['todo','journal'],requirementsEnabled:true} as const;
test('the actual website entry requires current native MFA, same-origin acknowledgment and trusted consumer binding',async()=>{
 let authenticated=true,mfa=true,writable=true,dispatches=0;
 const authority=new AuthorityService({ownerId:config.ownerId,spaceId:config.spaceId,verifyOwner:async()=>mfa?{ownerId:config.ownerId,spaceId:config.spaceId,sessionRef:'synthetic-session'}:null,verifyAgent:async()=>null});
 const runtime={forOwner:(actor:any)=>{assert.equal(actor.kind,'owner-session');return{actor:{consumer:'website'},service:{get:async()=>{dispatches++;return{entry:{id},cleanupEligible:false};},download:async()=>{dispatches++;return{entry:{name:'synthetic.txt',mimeType:'text/plain',sha256:'a'.repeat(64),revision:2},bytes};},acknowledge:async(actor:any)=>{assert.equal(actor.consumer,'website');dispatches++;return{entry:{id},duplicate:false};}}};}};
 const options={repository:new MemoryPort(),config,sessions:{read:async()=>authenticated?{userId:config.ownerId,email:config.ownerEmail}:null},storageVerified:true,fileHandoff:{runtime,authority},assertWritable:async()=>{if(!writable)throw Error('locked');}};
 const handler=createPersonalPlatformHandler(options as any),send=(tail='',method='GET',body?:unknown,extra:Record<string,string>={})=>handler(new Request(origin+'/api/platform/personal/file-handoffs/'+id+tail,{method,headers:{host:'synthetic-files.example.test',origin,'content-type':'application/json','idempotency-key':'synthetic-website-ack',...extra},...(body?{body:JSON.stringify(body)}:{})}));
 authenticated=false;assert.equal((await send()).status,401);authenticated=true;mfa=false;assert.equal((await send()).status,403);mfa=true;assert.equal((await send('','GET',undefined,{authorization:'Bearer synthetic'})).status,403);assert.equal(dispatches,0);
 const ack={expectedRevision:2,sha256:'a'.repeat(64),bytes:bytes.length};assert.equal((await send('/acknowledgments','POST',ack,{origin:'https://foreign.example.test'})).status,403);assert.equal(dispatches,0);
 assert.equal((await send('/acknowledgments','POST',{...ack,consumer:'codex'})).status,400);assert.equal(dispatches,0);
 const download=await send('/content');assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);assert.equal((await send('/acknowledgments','POST',ack)).status,200);assert.equal(dispatches,2);
 writable=false;assert.equal((await send('/acknowledgments','POST',ack)).status,503);assert.equal(dispatches,2);
 const closed=createPersonalPlatformHandler({...options,fileHandoff:undefined} as any);assert.equal((await closed(new Request(origin+'/api/platform/personal/file-handoffs/'+id,{headers:{host:'synthetic-files.example.test'}}))).status,404);
});
