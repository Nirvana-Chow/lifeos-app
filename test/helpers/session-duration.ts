import {memoryAdapter} from 'better-auth/adapters/memory';
import {hashPassword} from 'better-auth/crypto';
import {createPlatformAuth,readOwnerPrincipal,readVerifiedOwnerSession} from '../../src/platform/auth.ts';
import {readPlatformConfig} from '../../src/platform/config.ts';
import {mergeSyntheticAuthCookies,enrollSyntheticOwnerMfa,syntheticOwnerTotp} from './owner-mfa-fixture.ts';
const day=86400;
export async function sessionDurationFixture(mfa=false){
 const config=readPlatformConfig({LIFEOS_PLATFORM_CANDIDATE:'1',LIFEOS_PLATFORM_TARGET:'isolated-test',LIFEOS_PLATFORM_BASE_URL:'http://127.0.0.1:32142',LIFEOS_PLATFORM_OWNER_ID:'fixture-owner',LIFEOS_PLATFORM_OWNER_EMAIL:'fixture@example.invalid',LIFEOS_PLATFORM_SECRET:'synthetic-duration-secret-never-production-0000',LIFEOS_PLATFORM_TEST_DATABASE_URL:'postgresql://lifeos_platform_candidate_runtime:fixture@127.0.0.1:55432/lifeos_platform_test_fixture'})!;
 const now=new Date(),password='Synthetic-duration-password-001';
 const db:Record<string,Record<string,unknown>[]>={platform_user:[{id:config.ownerId,email:config.ownerEmail,name:'Fixture owner',emailVerified:false,createdAt:now,updatedAt:now,twoFactorEnabled:false}],platform_account:[{id:'fixture-account',accountId:config.ownerId,userId:config.ownerId,providerId:'credential',password:await hashPassword(password),createdAt:now,updatedAt:now}],platform_session:[],platform_verification:[],platform_rate_limit:[],platform_two_factor:[]};
 const auth=createPlatformAuth(config,memoryAdapter(db),{requireMfa:mfa,sessionDuration:true});
 const send=(path:string,body:Record<string,unknown>={},cookie='',method='POST',target=auth)=>target.handler(new Request(config.baseURL+'/api/platform/auth/'+path,{method,headers:{origin:config.baseURL,'content-type':'application/json',cookie},...(method==='POST'?{body:JSON.stringify(body)}:{})}));
 const login=(duration?:unknown)=>send('sign-in/email',{email:config.ownerEmail,password,rememberMe:true,...(duration===undefined?{}:{sessionDuration:duration})});
 return{auth,config,db,password,send,login};
}
