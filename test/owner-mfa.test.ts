import test from 'node:test';
import assert from 'node:assert/strict';
import {memoryAdapter} from 'better-auth/adapters/memory';
import {hashPassword} from 'better-auth/crypto';
import {APIError} from 'better-auth/api';
import * as authentication from '../src/platform/auth.ts';
import {enrollSyntheticOwnerMfa,syntheticOwnerTotp,mergeSyntheticAuthCookies as cookies} from './helpers/owner-mfa-fixture.ts';
import {readPlatformConfig} from '../src/platform/config.ts';

const password='Synthetic-only-MFA-password-0001';
async function fixture(){
 const config=readPlatformConfig({LIFEOS_PLATFORM_CANDIDATE:'1',LIFEOS_PLATFORM_TARGET:'isolated-test',LIFEOS_PLATFORM_BASE_URL:'http://127.0.0.1:3190',LIFEOS_PLATFORM_OWNER_ID:'fixture-owner-mfa',LIFEOS_PLATFORM_OWNER_EMAIL:'fixture-mfa@example.invalid',LIFEOS_PLATFORM_SECRET:'fixture-only-mfa-not-live-secret-000000000',LIFEOS_PLATFORM_TEST_DATABASE_URL:'postgresql://lifeos_platform_candidate_runtime:fixture-not-live@127.0.0.1:55432/lifeos_platform_test_fixture'})!;
 const now=new Date(),db:Record<string,Record<string,unknown>[]>={platform_user:[{id:config.ownerId,name:'Synthetic MFA owner',email:config.ownerEmail,emailVerified:false,image:null,twoFactorEnabled:false,createdAt:now,updatedAt:now}],platform_account:[{id:'fixture-mfa-account',accountId:config.ownerId,providerId:'credential',userId:config.ownerId,password:await hashPassword(password),createdAt:now,updatedAt:now}],platform_session:[],platform_verification:[],platform_rate_limit:[],platform_two_factor:[]};
 const security={requireMfa:true,disableSessionRefresh:true};
 const auth=authentication.createPlatformAuth(config,memoryAdapter(db),security);
 let lock=Promise.resolve();
 const withOwnerLock=async<T>(run:()=>Promise<T>):Promise<T>=>{const previous=lock;let release!:()=>void;lock=new Promise<void>(resolve=>{release=resolve;});await previous;try{return await run();}finally{release();}};
 const send=async(path:string,body:Record<string,unknown>={},cookie='',origin=config.baseURL,method='POST')=>{
  const context=await auth.$context,native=context.createAuthCookie('trust_device').name;
  const guards={requireMfa:true,readMfaState:(headers:Headers)=>authentication.readOwnerMfaState(auth,config,headers),withOwnerLock,trustedDeviceCookieNames:[native,native.replace(/^__Secure-/,''),'__Secure-'+native.replace(/^__Secure-/,'')],sessionCookieNames:[context.authCookies.sessionToken.name],twoFactorCookieNames:[context.createAuthCookie('two_factor').name]};
  return authentication.authRequest(new Request(config.baseURL+'/api/platform/auth/'+path,{method,headers:{host:'127.0.0.1:3190',...(method==='POST'?{origin,'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(method==='POST'?{body:JSON.stringify(body)}:{})}),config,r=>auth.handler(r),guards);
 };
 const login=(cookie='')=>send('sign-in/email',{email:config.ownerEmail,password},cookie);
 const getSession=(cookie='')=>send('get-session',{},cookie,config.baseURL,'GET');
 return{config,auth,db,send,login,getSession};
}

test('MFA anonymous session probe stays cookie-free when no trusted-device cookie was sent',async()=>{
 const f=await fixture();
 for(const cookie of ['', 'unrelated=fixture-value; lifeos-platform-candidate.trust_device_other=fixture-value']){
  const response=await f.getSession(cookie);
  assert.equal(response.status,200);assert.equal(await response.json(),null);
  assert.equal(response.headers.get('set-cookie'),null,'anonymous probe must not create or expire cookies absent from its request');
 }
});

test('MFA session expires only received trusted-device cookie names and deduplicates repeated names',async()=>{
 const f=await fixture();
 const response=await f.getSession('lifeos-platform-candidate.trust_device=historical-one; unrelated=fixture-value; __Secure-lifeos-platform-candidate.trust_device=historical-two; lifeos-platform-candidate.trust_device=historical-duplicate');
 assert.equal(response.status,200);assert.equal(await response.json(),null);
 assert.deepEqual(response.headers.getSetCookie(),[
  'lifeos-platform-candidate.trust_device=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict',
  '__Secure-lifeos-platform-candidate.trust_device=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict; Secure',
 ]);
});

test('MFA password-only owner session cannot read private principal, even with forged assurance input',async()=>{
 const f=await fixture(),signed=await f.send('sign-in/email',{email:f.config.ownerEmail,password,mfaVerified:true,twoFactorEnabled:true});
 assert.equal(signed.status,200);
 const cookie=cookies(signed);
 assert.ok(cookie.length>0);
 assert.equal(await authentication.readOwnerPrincipal(f.auth,f.config,new Headers({cookie})),null,'password alone must never satisfy personal access');
 assert.equal(f.db.platform_session[0]?.mfaVerified,false);
 const payload=await signed.json();assert.equal(Object.hasOwn(payload,'token'),false);
});

test('MFA enable requires password owner session and preserves closed private gate before correct TOTP',async()=>{
 const f=await fixture(),signed=await f.login(),cookie=cookies(signed);
 assert.equal((await f.send('two-factor/enable',{password,method:'totp'})).status,401);
 assert.equal((await f.send('two-factor/enable',{password:'Wrong-synthetic-MFA-password',method:'totp'},cookie)).status,400);
 const enabled=await f.send('two-factor/enable',{password,method:'totp'},cookie);assert.equal(enabled.status,200);
 const body=await enabled.json();assert.equal(new URL(body.totpURI).protocol,'otpauth:');assert.equal(body.backupCodes.length,10);
 assert.equal(f.db.platform_user[0].twoFactorEnabled,false);assert.equal(f.db.platform_two_factor[0].verified,false);
 assert.equal(await authentication.readOwnerPrincipal(f.auth,f.config,new Headers({cookie})),null);
 assert.equal((await f.send('two-factor/verify-totp',{code:'not-a-TOTP'},cookie)).status,401);
 assert.equal(await authentication.readOwnerPrincipal(f.auth,f.config,new Headers({cookie})),null);
});

test('MFA body and same-origin boundaries reject bypass fields before native writes',async()=>{
 const f=await fixture(),signed=await f.login(),cookie=cookies(signed);
 for(const body of [{password,method:'otp'},{password,method:'totp',issuer:'Unapproved'},{password,method:'totp',trustDevice:true}])assert.equal((await f.send('two-factor/enable',body,cookie)).status,400);
 for(const body of [{code:'not-a-TOTP',trustDevice:true},{code:'not-a-TOTP',disableSession:false},{code:'not-a-TOTP',mfaVerified:true}])assert.equal((await f.send('two-factor/verify-totp',body,cookie)).status,400);
 assert.equal((await f.send('two-factor/enable',{password,method:'totp'},cookie,'https://foreign.invalid')).status,403);
 assert.equal(f.db.platform_two_factor.length,0);
 for(const path of ['two-factor/disable','two-factor/send-otp','two-factor/get-totp-uri','two-factor/generate-backup-codes','two-factor/view-backup-codes','totp/generate'])assert.equal((await f.send(path,{},cookie)).status,404);
});

test('MFA guard without state or serialization callback fails closed',async()=>{
 const f=await fixture(),request=()=>new Request(f.config.baseURL+'/api/platform/auth/sign-in/email',{method:'POST',headers:{host:'127.0.0.1:3190',origin:f.config.baseURL,'content-type':'application/json'},body:JSON.stringify({email:f.config.ownerEmail,password})});
 const guards={requireMfa:true};assert.equal((await authentication.authRequest(request(),f.config,r=>f.auth.handler(r),guards)).status,503);assert.equal(f.db.platform_session.length,0);
});

test('MFA native first verification rotates session and never elevates a parallel password-only session',async()=>{
 const f=await fixture(),a=await f.login(),b=await f.login(),cookieA=cookies(a),cookieB=cookies(b);
 const bound=await enrollSyntheticOwnerMfa(f.auth,f.config.ownerId,password,f.send,cookieA);
 assert.notEqual(bound.cookie,cookieA);
 assert.equal((await authentication.readOwnerPrincipal(f.auth,f.config,new Headers({cookie:bound.cookie})))?.userId,f.config.ownerId);
 assert.equal(await authentication.readOwnerPrincipal(f.auth,f.config,new Headers({cookie:cookieA})),null);
 assert.equal(await authentication.readOwnerPrincipal(f.auth,f.config,new Headers({cookie:cookieB})),null);
 assert.equal((await authentication.readOwnerMfaState(f.auth,f.config,new Headers({cookie:cookieB}))).kind,'relogin');
 assert.equal((await f.send('two-factor/verify-totp',{code:await syntheticOwnerTotp(f.auth,f.config.ownerId)},cookieB)).status,401);
 assert.equal((await f.send('two-factor/enable',{password,method:'totp'},bound.cookie)).status,401);
 assert.equal(f.db.platform_two_factor.length,1);assert.equal(f.db.platform_two_factor[0].verified,true);
 assert.equal(f.db.platform_session.filter(row=>row.mfaVerified===true).length,1);
});

test('MFA enrolled password login returns native challenge and TOTP consumes it exactly once',async()=>{
 const f=await fixture(),first=await f.login();await enrollSyntheticOwnerMfa(f.auth,f.config.ownerId,password,f.send,cookies(first));
 const signed=await f.login();assert.equal(signed.status,200);const body=await signed.json();assert.equal(body.twoFactorRedirect,true);assert.deepEqual(body.twoFactorMethods,['totp']);assert.equal(Object.hasOwn(body,'token'),false);
 const challenge=cookies(signed);assert.ok(challenge.includes('.two_factor='));assert.ok(!challenge.includes('.session_token='));
 assert.equal(await authentication.readOwnerPrincipal(f.auth,f.config,new Headers({cookie:challenge})),null);
 const verified=await f.send('two-factor/verify-totp',{code:await syntheticOwnerTotp(f.auth,f.config.ownerId)},challenge);assert.equal(verified.status,200);
 const payload=await verified.json();assert.equal(Object.hasOwn(payload,'token'),false);
 assert.equal((await authentication.readOwnerPrincipal(f.auth,f.config,new Headers({cookie:cookies(verified,challenge)})))?.userId,f.config.ownerId);
 assert.ok(verified.headers.getSetCookie().some(value=>value.includes('.two_factor=;')));assert.ok(verified.headers.getSetCookie().some(value=>value.includes('.session_token=')&&!value.includes('.session_token=;')));
 assert.equal((await f.send('two-factor/verify-totp',{code:await syntheticOwnerTotp(f.auth,f.config.ownerId)},challenge)).status,401);
});

test('MFA native backup code cannot bypass first binding and is one-time across concurrent challenges',async()=>{
 const f=await fixture(),first=await f.login(),cookie=cookies(first),enabled=await f.send('two-factor/enable',{password,method:'totp'},cookie);assert.equal(enabled.status,200);const body=await enabled.json();
 assert.equal((await f.send('two-factor/verify-backup-code',{code:body.backupCodes[0]},cookie)).status,401);
 const verified=await f.send('two-factor/verify-totp',{code:await syntheticOwnerTotp(f.auth,f.config.ownerId)},cookie);assert.equal(verified.status,200);
 const a=cookies(await f.login()),b=cookies(await f.login());
 const results=await Promise.all([f.send('two-factor/verify-backup-code',{code:body.backupCodes[0]},a),f.send('two-factor/verify-backup-code',{code:body.backupCodes[0]},b)]);
 assert.equal(results.filter(response=>response.status===200).length,1);assert.equal(results.filter(response=>response.status===401).length,1);
 const winner=results.findIndex(response=>response.status===200);assert.equal((await authentication.readOwnerPrincipal(f.auth,f.config,new Headers({cookie:cookies(results[winner],winner===0?a:b)})))?.userId,f.config.ownerId);
});

test('MFA expired native challenge and changed owner identity fail closed',async()=>{
 const f=await fixture(),first=await f.login();const bound=await enrollSyntheticOwnerMfa(f.auth,f.config.ownerId,password,f.send,cookies(first));
 const pending=cookies(await f.login());for(const row of f.db.platform_verification)if(String(row.identifier).startsWith('2fa-'))row.expiresAt=new Date(0);
 assert.equal((await f.send('two-factor/verify-totp',{code:await syntheticOwnerTotp(f.auth,f.config.ownerId)},pending)).status,401);
 f.db.platform_user[0].email='changed@example.invalid';assert.equal(await authentication.readOwnerPrincipal(f.auth,f.config,new Headers({cookie:bound.cookie})),null);
});

test('MFA factor rows are mandatory even when session assurance and enabled flag are true',async()=>{
 const f=await fixture(),first=await f.login(),bound=await enrollSyntheticOwnerMfa(f.auth,f.config.ownerId,password,f.send,cookies(first));
 const headers=new Headers({cookie:bound.cookie}),factor=f.db.platform_two_factor[0];
 factor.verified=false;assert.equal((await authentication.readOwnerMfaState(f.auth,f.config,headers)).kind,'incomplete');assert.equal(await authentication.readOwnerPrincipal(f.auth,f.config,headers),null);
 factor.verified=true;f.db.platform_two_factor.push({...factor,id:'synthetic-duplicate-factor'});assert.equal((await authentication.readOwnerMfaState(f.auth,f.config,headers)).kind,'unavailable');assert.equal(await authentication.readOwnerPrincipal(f.auth,f.config,headers),null);
 f.db.platform_two_factor.length=0;assert.equal((await authentication.readOwnerMfaState(f.auth,f.config,headers)).kind,'unavailable');assert.equal(await authentication.readOwnerPrincipal(f.auth,f.config,headers),null);
});

test('MFA native partial verified-row failure cannot expose private data through a newly minted session',async()=>{
 const f=await fixture(),signed=await f.login(),cookie=cookies(signed);assert.equal((await f.send('two-factor/enable',{password,method:'totp'},cookie)).status,200);
 const context=await f.auth.$context,update=context.adapter.update.bind(context.adapter);let failed=false;
 context.adapter.update=async args=>{if(args.model==='twoFactor'&&(args.update as Record<string,unknown>).verified===true){failed=true;throw new APIError('INTERNAL_SERVER_ERROR',{message:'Synthetic final verified update failure',code:'SYNTHETIC_VERIFIED_FAILURE'});}return update(args);};
 const response=await f.send('two-factor/verify-totp',{code:await syntheticOwnerTotp(f.auth,f.config.ownerId)},cookie);
 assert.ok(response.status>=400);assert.equal(failed,true);assert.equal(f.db.platform_user[0].twoFactorEnabled,true);assert.equal(f.db.platform_two_factor[0].verified,false);assert.ok(f.db.platform_session.some(row=>row.mfaVerified===true));
 const partialCookie=cookies(response,cookie);assert.equal(await authentication.readOwnerPrincipal(f.auth,f.config,new Headers({cookie:partialCookie})),null);assert.equal((await authentication.readOwnerMfaState(f.auth,f.config,new Headers({cookie:partialCookie}))).kind,'incomplete');
 assert.equal((await f.send('two-factor/enable',{password,method:'totp'},partialCookie)).status,401);
 context.adapter.update=update;
 const retry=await f.send('two-factor/verify-totp',{code:await syntheticOwnerTotp(f.auth,f.config.ownerId)},partialCookie);assert.equal(retry.status,200);
 assert.equal((await authentication.readOwnerPrincipal(f.auth,f.config,new Headers({cookie:cookies(retry,partialCookie)})))?.userId,f.config.ownerId);
});

test('MFA password reset preserves the native factor, revokes sessions and requires the second factor again',async()=>{
 const f=await fixture(),signed=await f.login(),bound=await enrollSyntheticOwnerMfa(f.auth,f.config.ownerId,password,f.send,cookies(signed));
 const factorBefore={...f.db.platform_two_factor[0]};let resetCode='';const reset=authentication.createPlatformAuth(f.config,memoryAdapter(f.db),{ownerPasswordResetDelivery:async data=>{resetCode=data.token;}});
 await reset.api.requestPasswordReset({body:{email:f.config.ownerEmail}});assert.ok(resetCode.length>0);
 await reset.api.resetPassword({body:{token:resetCode,newPassword:'Synthetic-only-MFA-recovered-password'}});resetCode='';
 assert.ok(JSON.stringify(f.db.platform_two_factor[0])===JSON.stringify(factorBefore),'Native factor is unchanged by reset');assert.equal(f.db.platform_user[0].twoFactorEnabled,true);assert.equal(f.db.platform_session.length,0);assert.equal(await authentication.readOwnerPrincipal(f.auth,f.config,new Headers({cookie:bound.cookie})),null);
 const fresh=await f.send('sign-in/email',{email:f.config.ownerEmail,password:'Synthetic-only-MFA-recovered-password'});assert.equal(fresh.status,200);assert.equal((await fresh.json()).twoFactorRedirect,true);
 const challenge=cookies(fresh),verified=await f.send('two-factor/verify-totp',{code:await syntheticOwnerTotp(f.auth,f.config.ownerId)},challenge);assert.equal(verified.status,200);assert.equal((await authentication.readOwnerPrincipal(f.auth,f.config,new Headers({cookie:cookies(verified,challenge)})))?.userId,f.config.ownerId);
});

for(const [label,whitespace]of [['canonical',''],['space',' '],['tab','\t']])test('MFA valid historical native trust-device cookie is stripped and expired instead of bypassing challenge: '+label,async()=>{
 const f=await fixture(),signed=await f.login();await enrollSyntheticOwnerMfa(f.auth,f.config.ownerId,password,f.send,cookies(signed));
 const challenge=cookies(await f.login());
 // Create the historical cookie with the real native endpoint, bypassing only our new HTTP policy for this synthetic fixture.
 const trusted=await f.auth.handler(new Request(f.config.baseURL+'/api/platform/auth/two-factor/verify-totp',{method:'POST',headers:{host:'127.0.0.1:3190',origin:f.config.baseURL,'content-type':'application/json',cookie:challenge},body:JSON.stringify({code:await syntheticOwnerTotp(f.auth,f.config.ownerId),trustDevice:true})}));assert.equal(trusted.status,200);
 const trustName=(await f.auth.$context).createAuthCookie('trust_device').name,trustPair=cookies(trusted).split('; ').find(pair=>pair.startsWith(trustName+'='));assert.ok(trustPair);
 const login=await f.login(trustPair.replace('=',whitespace+'='));assert.equal(login.status,200);assert.equal((await login.json()).twoFactorRedirect,true);assert.ok(login.headers.getSetCookie().some(value=>value.startsWith(trustName+'=;')&&value.includes('Max-Age=0')));
 assert.equal(login.headers.getSetCookie().filter(value=>value.includes('.trust_device=')).length,1,'only the received historical name is expired');
 assert.ok(!cookies(login).includes('.session_token='));assert.equal(await authentication.readOwnerPrincipal(f.auth,f.config,new Headers({cookie:cookies(login)})),null);
});

test('MFA foreign session cannot be treated as an anonymous native challenge',async()=>{
 const f=await fixture(),now=new Date();f.db.platform_user.push({id:'fixture-foreign-mfa',email:'foreign-mfa@example.invalid',name:'Synthetic foreign',createdAt:now,updatedAt:now,emailVerified:false,twoFactorEnabled:false});f.db.platform_account.push({id:'fixture-foreign-account',accountId:'fixture-foreign-mfa',userId:'fixture-foreign-mfa',providerId:'credential',password:await hashPassword(password),createdAt:now,updatedAt:now});
 const foreignConfig={...f.config,ownerId:'fixture-foreign-mfa',ownerEmail:'foreign-mfa@example.invalid'},foreign=authentication.createPlatformAuth(foreignConfig,memoryAdapter(f.db),{requireMfa:true});
 const response=await foreign.handler(new Request(f.config.baseURL+'/api/platform/auth/sign-in/email',{method:'POST',headers:{host:'127.0.0.1:3190',origin:f.config.baseURL,'content-type':'application/json'},body:JSON.stringify({email:foreignConfig.ownerEmail,password})}));assert.equal(response.status,200);
 const foreignCookie=cookies(response);assert.equal((await authentication.readOwnerMfaState(f.auth,f.config,new Headers({cookie:foreignCookie}))).kind,'anonymous');
 assert.equal((await f.send('two-factor/verify-totp',{code:'not-a-TOTP'},foreignCookie+'; lifeos-platform-candidate.two_factor=forged')).status,401);assert.equal(f.db.platform_two_factor.length,0);
});

test('MFA native session response removes bearer data while preserving private cache and every cookie',async()=>{
 const f=await fixture(),signed=await f.login(),bound=await enrollSyntheticOwnerMfa(f.auth,f.config.ownerId,password,f.send,cookies(signed));
 const context=await f.auth.$context,native=context.createAuthCookie('trust_device').name;
 const guards={requireMfa:true,readMfaState:(headers:Headers)=>authentication.readOwnerMfaState(f.auth,f.config,headers),withOwnerLock:async<T>(run:()=>Promise<T>)=>run(),trustedDeviceCookieNames:[native],sessionCookieNames:[context.authCookies.sessionToken.name],twoFactorCookieNames:[context.createAuthCookie('two_factor').name]};
 let nativeHeaders=new Headers();
 const nativeHandler=async(request:Request)=>{const response=await f.auth.handler(request);nativeHeaders=new Headers(response.headers);return response;};
 const response=await authentication.authRequest(new Request(f.config.baseURL+'/api/platform/auth/get-session',{headers:{host:'127.0.0.1:3190',cookie:bound.cookie}}),f.config,nativeHandler,guards);
 assert.equal(response.status,200);const payload=await response.json();assert.equal(Object.hasOwn(payload.session,'token'),false);assert.equal(payload.user.id,f.config.ownerId);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('vary'),'Cookie');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 assert.equal(response.headers.get('set-cookie'),null,'a normal session read does not invent trusted-device expirations');
 for(const[name,value]of nativeHeaders)if(!['cache-control','vary','x-content-type-options','content-length','set-cookie'].includes(name))assert.equal(response.headers.get(name),value);
 const challenge=cookies(await f.login());
 const verified=await authentication.authRequest(new Request(f.config.baseURL+'/api/platform/auth/two-factor/verify-totp',{method:'POST',headers:{host:'127.0.0.1:3190',origin:f.config.baseURL,'content-type':'application/json',cookie:challenge},body:JSON.stringify({code:await syntheticOwnerTotp(f.auth,f.config.ownerId)})}),f.config,nativeHandler,guards);
 assert.equal(verified.status,200);assert.ok(nativeHeaders.getSetCookie().length>0);
 assert.ok(JSON.stringify(verified.headers.getSetCookie())===JSON.stringify(nativeHeaders.getSetCookie()),'native challenge deletion and session cookies are preserved verbatim');
 for(const[name,value]of nativeHeaders)if(!['cache-control','vary','x-content-type-options','content-length','set-cookie'].includes(name))assert.equal(verified.headers.get(name),value);
 const verifiedBody=await verified.json();assert.equal(Object.hasOwn(verifiedBody,'token'),false);
});

// Characterize the already-covered partial factor state using the real native backup endpoint.
test('native backup HTTP200 with an enabled but unverified factor still needs canonical incomplete recovery',async()=>{
 const f=await fixture(),first=await f.login(),bound=await enrollSyntheticOwnerMfa(f.auth,f.config.ownerId,password,f.send,cookies(first));
 f.db.platform_two_factor[0].verified=false; // Same enabled/unverified dimensions retained by the partial-update failure case above.
 const signed=await f.login();assert.equal(signed.status,200);assert.equal((await signed.json()).twoFactorRedirect,true);const challenge=cookies(signed);
 const response=await f.send('two-factor/verify-backup-code',{code:bound.backupCodes[0],trustDevice:false},challenge);assert.equal(response.status,200);
 const headers=new Headers({cookie:cookies(response,challenge)});assert.equal((await authentication.readOwnerMfaState(f.auth,f.config,headers)).kind,'incomplete');assert.equal(await authentication.readOwnerPrincipal(f.auth,f.config,headers),null);
});

test('every private business alias uses the native owner MFA principal gate before module rendering',async()=>{
 const {readFileSync}=await import('node:fs'),ts=(await import('typescript')).default,map=await import('../src/workbench/private-navigation.ts');
 const f=await fixture();let cookie='',config=f.config,rendered=0;
 const jsx=(type:unknown,props:unknown)=>{rendered++;return{type,props};};
 const imports:Record<string,unknown>={
  'react/jsx-runtime':{jsx,jsxs:jsx},'next/headers':{headers:async()=>new Headers(cookie?{cookie}:{})},
  'next/navigation':{redirect:(url:string)=>{throw Error('REDIRECT '+url);},notFound:()=>{throw Error('NOT_FOUND');}},
  '../../../src/platform/runtime':{readPlatformPagePrincipal:(headers:Headers)=>authentication.readOwnerPrincipal(f.auth,config,headers)},
  '../../../src/workbench/private-navigation':map,'../../../src/workbench/shell':{WorkbenchShell:'shell'},
  '../../../src/workbench/draft-workspace':{BasicWorkspace:'basic',DraftEditor:'draft'},'../../../src/workbench/domain':{DomainPage:'domain'},'../../../src/ui-review/workspace':{LifeOSWorkspace:'workspace'},'../../../src/personal-candidate/privacy':{PrivacyBoundary:'privacy'},
 };
 const m={exports:{} as {default:(props:unknown)=>Promise<unknown>}};
 new Function('require','module','exports',ts.transpileModule(readFileSync('app/personal/[...section]/page.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText)((name:string)=>{assert.ok(name in imports,name);return imports[name];},m,m.exports);
 const aliases=map.privateNavigation.filter(item=>!item.href.includes('?')&&item.href!=='/personal'),props=(href:string)=>({params:Promise.resolve({section:href.slice('/personal/'.length).split('/')}),searchParams:Promise.resolve({mode:'synthetic-review',owner:'forged'})});
 const denied=async()=>{rendered=0;for(const item of aliases)await assert.rejects(m.exports.default(props(item.href)),/REDIRECT \/login/);assert.equal(rendered,0,'denied principals must never construct module elements');};
 await denied();cookie='lifeos-platform-candidate.session_token=forged';await denied();
 const signed=await f.login();assert.equal(signed.status,200);cookie=cookies(signed);await denied();
 const passwordCookie=cookie,enrolled=await enrollSyntheticOwnerMfa(f.auth,f.config.ownerId,password,(path,body,value)=>f.send(path,body,value),cookie);cookie=enrolled.cookie;
 for(const item of aliases)await assert.doesNotReject(m.exports.default(props(item.href)));assert.ok(rendered>0);
 const readyCookie=cookie;cookie=passwordCookie;await denied();cookie=readyCookie;
 for(const override of [{ownerId:'another-owner'},{ownerEmail:'another-owner@example.invalid'}]){config={...f.config,...override};await denied();}config=f.config;
 const verified=f.db.platform_two_factor[0].verified;f.db.platform_two_factor[0].verified=false;await denied();f.db.platform_two_factor[0].verified=verified;
 for(const session of f.db.platform_session)session.expiresAt=new Date(0);await denied();
});
