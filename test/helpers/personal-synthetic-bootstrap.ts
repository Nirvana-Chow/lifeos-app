// Test-only initialization. This file is excluded from the image build context.
import {Pool} from 'pg';
import {hashPassword,verifyPassword} from 'better-auth/crypto';
import {verifyRestrictedPool,type SqlPool} from '../../src/platform/postgres.ts';
import {readPlatformConfig} from '../../src/platform/config.ts';
import {readPersonalConfig} from '../../src/personal-candidate/config.ts';
const target='postgresql://lifeos_platform_candidate_runtime:fixture-ci-runtime-never-live@127.0.0.1:55432/lifeos_platform_test_local';
const bootstrap='postgresql://lifeos_platform_candidate_bootstrap:fixture-ci-bootstrap-never-live@127.0.0.1:55432/lifeos_platform_test_local';
const deny=()=>Error('SYNTHETIC_BOOTSTRAP_DENIED');
export function readSyntheticIdentity(env:Record<string,string|undefined>){
 if(env.CI!=='true'||env.GITHUB_ACTIONS!=='true'||env.LIFEOS_FIXTURE_FRESH!=='approved-isolated-fixture'||env.LIFEOS_PLATFORM_TEST_DATABASE_URL!==target)throw deny();
 const identities=[{ownerId:'personal-review-user',email:'owner@example.test',spaceId:'personal-review-space',password:'fixture-personal-initial-password'},{ownerId:'synthetic-foreign-user',email:'foreign@example.test',spaceId:'synthetic-foreign-space',password:'fixture-personal-foreign-password'}];
 const identity=identities.find(i=>i.ownerId===env.LIFEOS_PERSONAL_OWNER_ID&&i.email===env.LIFEOS_PERSONAL_OWNER_EMAIL&&i.spaceId===env.LIFEOS_PERSONAL_SPACE_ID);if(!identity)throw deny();return Object.freeze(identity);
}
export async function runPersonalSyntheticBootstrap(runtime:Record<string,string|undefined>):Promise<{status:'created';readbackVerified:true}>{
 if(process.platform!=='linux'||process.env.CI!=='true'||process.env.GITHUB_ACTIONS!=='true'||process.env.LIFEOS_FIXTURE_FRESH!=='approved-isolated-fixture'||process.env.LIFEOS_PLATFORM_TEST_DATABASE_URL!==target)throw deny();
 const env={...process.env,...runtime},identity=readSyntheticIdentity(env),platform=readPlatformConfig(runtime),personal=platform&&readPersonalConfig(runtime,platform);
 if(!platform||!personal||platform.ownerId!==identity.ownerId||platform.ownerEmail!==identity.email||personal.spaceId!==identity.spaceId)throw deny();
 const accountId='personal-credential-'+identity.ownerId;
 const options={max:1,connectionTimeoutMillis:2000,statement_timeout:5000,options:'-c search_path=pg_catalog,lifeos_platform'};
 const pool=new Pool({...options,connectionString:bootstrap});let committed=false;
 try{
  await verifyRestrictedPool(pool as SqlPool,'synthetic-bootstrap');const client=await pool.connect();
  try{
   await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtextextended('synthetic-personal-bootstrap-v1',0))");
   const existing=await client.query('SELECT id FROM lifeos_platform.platform_user WHERE id=$1 OR lower(email)=$2',[identity.ownerId,identity.email]);
   if(existing.rows.length!==0)throw deny();
   const hash=await hashPassword(identity.password);
   await client.query('INSERT INTO lifeos_platform.platform_user(id,name,email,"emailVerified") VALUES($1,$2,$3,false)',[identity.ownerId,'Synthetic owner',identity.email]);
   await client.query('INSERT INTO lifeos_platform.platform_account(id,"userId","accountId","providerId",password) VALUES($1,$2,$2,$3,$4)',[accountId,identity.ownerId,'credential',hash]);
   await client.query('COMMIT');committed=true;
  }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}
 }finally{await pool.end();}
 // A new independent restricted runtime pool proves committed identity and hash.
 const reader=new Pool({...options,connectionString:target});
 try{
  if(!committed)throw deny();await verifyRestrictedPool(reader as SqlPool);
  const users=(await reader.query('SELECT id,name,email,"emailVerified" FROM lifeos_platform.platform_user WHERE id=$1 OR lower(email)=$2',[identity.ownerId,identity.email])).rows;
  const accounts=(await reader.query('SELECT id,"userId","accountId","providerId",password FROM lifeos_platform.platform_account WHERE id=$1 OR "userId"=$2',[accountId,identity.ownerId])).rows;
  const user=users[0],account=accounts[0];
  if(users.length!==1||accounts.length!==1||user.id!==identity.ownerId||user.name!=='Synthetic owner'||user.email!==identity.email||user.emailVerified!==false||account.id!==accountId||account.userId!==identity.ownerId||account.accountId!==identity.ownerId||account.providerId!=='credential'||!await verifyPassword({hash:account.password,password:identity.password}))throw deny();
 }finally{await reader.end();}
 return {status:'created',readbackVerified:true};
}
