import {memoryAdapter} from 'better-auth/adapters/memory';
import {hashPassword} from 'better-auth/crypto';
import {createPlatformAuth,authRequest,readOwnerMfaState} from '../../src/platform/auth.ts';
import {enrollSyntheticOwnerMfa,mergeSyntheticAuthCookies} from './owner-mfa-fixture.ts';

export const managedFixtureConfig={baseURL:'https://lifeos.nirvanachow.com',ownerId:'managed-fixture-owner',ownerEmail:'managed-owner@example.invalid',secret:'Synthetic-only-managed-client-secret-00000000',databaseURL:'',sessionSeconds:1800};
export const managedFixtureOAuth={resource:managedFixtureConfig.baseURL+'/api/platform/mcp',issuer:managedFixtureConfig.baseURL+'/api/platform/auth',grantId:'synthetic-reviewed-grant',scopes:['todo:read','todo:write','offline_access']};
export const managedFixtureCallback='https://chatgpt.com/connector/oauth/fixtureCallback1';

export async function managedClientFixture(){
 const config={...managedFixtureConfig},oauth={...managedFixtureOAuth,scopes:[...managedFixtureOAuth.scopes]},now=new Date(),password='Synthetic-only-managed-password-0001';
 const db:Record<string,Record<string,unknown>[]>={platform_user:[{id:config.ownerId,name:'Synthetic owner',email:config.ownerEmail,emailVerified:false,twoFactorEnabled:false,createdAt:now,updatedAt:now}],platform_account:[{id:'managed-fixture-account',accountId:config.ownerId,providerId:'credential',userId:config.ownerId,password:await hashPassword(password),createdAt:now,updatedAt:now}],platform_session:[],platform_verification:[],platform_rate_limit:[],platform_two_factor:[],platform_oauth_client:[],platform_oauth_resource:[],platform_oauth_client_resource:[],platform_oauth_refresh_token:[],platform_oauth_access_token:[],platform_oauth_consent:[],platform_oauth_client_assertion:[],platform_oauth_jwks:[]};
 const auth=createPlatformAuth(config,memoryAdapter(db),{requireMfa:true,businessOAuth:oauth,disableSessionRefresh:true});await auth.$context;
 const native=async(path:string,body:Record<string,unknown>,cookie='')=>{
  const context=await auth.$context;
  return authRequest(new Request(oauth.issuer+'/'+path,{method:'POST',headers:{host:'lifeos.nirvanachow.com',origin:config.baseURL,'content-type':'application/json',cookie},body:JSON.stringify(body)}),config,r=>auth.handler(r),{requireMfa:true,readMfaState:h=>readOwnerMfaState(auth,config,h),withOwnerLock:async run=>run(),trustedDeviceCookieNames:[context.createAuthCookie('trust_device').name],sessionCookieNames:[context.authCookies.sessionToken.name],twoFactorCookieNames:[context.createAuthCookie('two_factor').name]});
 };
 const passwordOnly=await native('sign-in/email',{email:config.ownerEmail,password}),passwordCookie=mergeSyntheticAuthCookies(passwordOnly);
 const enrolled=await enrollSyntheticOwnerMfa(auth,config.ownerId,password,native,passwordCookie);
 return {config,oauth,db,auth,native,cookie:enrolled.cookie,passwordCookie};
}
