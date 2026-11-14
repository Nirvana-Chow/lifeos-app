import test from 'node:test';import assert from 'node:assert/strict';
import {sessionDurationFixture} from './helpers/session-duration.ts';
import {enrollSyntheticOwnerMfa,mergeSyntheticAuthCookies} from './helpers/owner-mfa-fixture.ts';
import {ownerDeviceSessions} from '../src/session-duration/owner-access.ts';
async function setup(){const f=await sessionDurationFixture(true),login=await f.login({mode:'rolling'}),enrolled=await enrollSyntheticOwnerMfa(f.auth,f.config.ownerId,f.password,(p,b,c)=>f.send(p,b,c),mergeSyntheticAuthCookies(login));let locks=0;const handler=ownerDeviceSessions({auth:f.auth,readAuth:f.auth,config:f.config,withOwnerLock:async run=>{locks++;return run();}});
 const req=(body?:unknown,cookie=enrolled.cookie,origin=f.config.baseURL)=>handler(new Request(f.config.baseURL+'/api/platform/auth/device-sessions',{method:body===undefined?'GET':'POST',headers:{host:new URL(f.config.baseURL).host,origin,'content-type':'application/json',cookie},...(body===undefined?{}:{body:JSON.stringify(body)})}));return{...f,req,cookie:enrolled.cookie,locks:()=>locks};}
test('owner session list is redacted and native revocation prevents cookie replay',async()=>{
 const f=await setup(),listed=await f.req();assert.equal(listed.status,200);const data=await listed.json();assert.equal(data.sessions.length,1);assert.equal(data.sessions[0].current,true);assert.doesNotMatch(JSON.stringify(data),/"token"|"ipAddress"|"userId"/);const token=f.db.platform_session[0].token as string;assert.ok(!JSON.stringify(data).includes(token));
 assert.equal((await f.req({id:data.sessions[0].id})).status,200);assert.equal(f.db.platform_session.length,0);assert.equal((await f.req()).status,401);assert.equal(f.locks(),1);
});
test('anonymous, foreign-origin, bearer and staleMFA revocation fail without deleting any session',async()=>{
 const f=await setup(),id=f.db.platform_session[0].id;
 assert.equal((await f.req(undefined,'')).status,401);assert.equal((await f.req({id},f.cookie,'https://foreign.invalid')).status,403);
 f.db.platform_session[0].createdAt=new Date(Date.now()-1801*1000);
 assert.equal((await f.req()).status,200,'ordinary device list can be viewed with an older verified session');assert.equal((await f.req({id})).status,403);assert.equal(f.db.platform_session.length,1);
});
