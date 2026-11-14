import test from 'node:test';import assert from 'node:assert/strict';import {memoryAdapter} from 'better-auth/adapters/memory';
import {createPlatformAuth,readOwnerPrincipal,readVerifiedOwnerSession} from '../src/platform/auth.ts';
import {ownerAccountAccess} from '../src/personal-candidate/account-access.ts';import {sessionDurationFixture} from './helpers/session-duration.ts';import {enrollSyntheticOwnerMfa,mergeSyntheticAuthCookies} from './helpers/owner-mfa-fixture.ts';
test('native password change revokes a rememberedMFA session and expires its browser cookie',async()=>{
 const f=await sessionDurationFixture(true),first=await f.login({mode:'rolling'}),enrolled=await enrollSyntheticOwnerMfa(f.auth,f.config.ownerId,f.password,(p,b,c)=>f.send(p,b,c),mergeSyntheticAuthCookies(first));
 const access=ownerAccountAccess(f.config,f.auth,{enabled:true,withOwnerLock:async run=>run(),readOwner:async headers=>(await readVerifiedOwnerSession(f.auth,f.config,headers))?.principal.userId??null});
 const response=await access(new Request(f.config.baseURL+'/api/platform/personal/password',{method:'POST',headers:{host:new URL(f.config.baseURL).host,origin:f.config.baseURL,'content-type':'application/json',cookie:enrolled.cookie},body:JSON.stringify({mode:'change',currentPassword:f.password,newPassword:'Synthetic-changed-duration-password-002'})}));
 assert.equal(response.status,200);assert.equal(f.db.platform_session.length,0);assert.equal(await readOwnerPrincipal(f.auth,f.config,new Headers({cookie:enrolled.cookie})),null);assert.ok(response.headers.getSetCookie().some(cookie=>/session_token=.*Max-Age=0/.test(cookie)));
});
test('native owner recovery revokes persistent sessions and consumes the reset token once',async()=>{
 const f=await sessionDurationFixture(true),first=await f.login({mode:'rolling'}),enrolled=await enrollSyntheticOwnerMfa(f.auth,f.config.ownerId,f.password,(p,b,c)=>f.send(p,b,c),mergeSyntheticAuthCookies(first));let resetToken='';
 const recovery=createPlatformAuth(f.config,memoryAdapter(f.db),{requireMfa:true,sessionDuration:true,disableSessionRefresh:true,ownerPasswordResetDelivery:async data=>{assert.equal(data.userId,f.config.ownerId);resetToken=data.token;}});
 await recovery.api.requestPasswordReset({body:{email:f.config.ownerEmail,redirectTo:f.config.baseURL+'/account/recover'}});assert.ok(resetToken);
 await recovery.api.resetPassword({body:{token:resetToken,newPassword:'Synthetic-recovered-duration-password-003'}});assert.equal(f.db.platform_session.length,0);assert.equal(await readOwnerPrincipal(f.auth,f.config,new Headers({cookie:enrolled.cookie})),null);
 await assert.rejects(recovery.api.resetPassword({body:{token:resetToken,newPassword:'Synthetic-recovered-duration-password-004'}}));
});
