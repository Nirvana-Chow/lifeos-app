import {Pool} from 'pg';
import {ownerEmailReset} from '../../src/personal-candidate/owner-email-reset.ts';
import {ownerRecoveryLock} from '../../src/personal-candidate/owner-recovery-lock.ts';
import type {SqlPool} from '../../src/platform/postgres.ts';
import {requireSyntheticPlatformConfig} from '../../src/platform/synthetic-bootstrap.ts';
const target='postgresql://lifeos_platform_candidate_runtime:fixture-ci-runtime-never-live@127.0.0.1:55439/lifeos_platform_test_local';
if(process.env.CI!=='true'||process.env.RUN_OWNER_RECOVERY_POSTGRES_TESTS!=='1'||process.env.LIFEOS_PLATFORM_TEST_APPROVAL!=='approved-isolated-fixtures'||process.env.LIFEOS_PLATFORM_TEST_DATABASE_URL!==target||!process.send)throw Error('Synthetic worker unavailable');
const config=requireSyntheticPlatformConfig(process.env),pool=new Pool({connectionString:target,max:3,connectionTimeoutMillis:2000,statement_timeout:5000,options:'-c search_path=pg_catalog,lifeos_platform'});
process.once('message',async(message:unknown)=>{try{
 if(!message||typeof message!=='object'||typeof (message as {code?:unknown}).code!=='string')throw Error('Invalid synthetic worker request');
 const handler=ownerEmailReset(config,pool,{enabled:true,withOwnerLock:ownerRecoveryLock(pool as SqlPool,config.ownerId),limit:async()=>{},delivery:{recipient:'owner@example.invalid',send:async()=>{throw Error('not used');}}});
 const request=new Request(config.baseURL+'/api/platform/personal/recover-password',{method:'POST',headers:{origin:config.baseURL,host:'127.0.0.1:3190','content-type':'application/json'},body:JSON.stringify({action:'finish',otp:(message as {code:string}).code,newPassword:'fixture-worker-new-password'})});
 const response=await handler(request);process.send?.({status:response.status});
 }catch{process.send?.({error:true});}finally{await pool.end();process.disconnect?.();}});
