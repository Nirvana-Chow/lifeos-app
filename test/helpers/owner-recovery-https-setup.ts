import {readFileSync,writeFileSync} from 'node:fs';
import {request} from 'node:https';
import {Pool} from 'pg';
import {fixtureCaddyfile,fixtureLookup,fixtureErrorCode} from './owner-recovery-https-config.ts';
import {readReviewConfig} from '../../src/platform/private-config.ts';
import {runPersonalSyntheticBootstrap} from './personal-synthetic-bootstrap.ts';

const target='postgresql://lifeos_platform_candidate_runtime:fixture-ci-runtime-never-live@127.0.0.1:55432/lifeos_platform_test_local';
if(process.env.CI!=='true'||process.env.LIFEOS_FIXTURE_FRESH!=='approved-isolated-fixture'||process.env.LIFEOS_PLATFORM_TEST_DATABASE_URL!==target||process.platform!=='linux'||process.env.GITHUB_ACTIONS!=='true'||!process.env.RUNNER_TEMP)throw Error('Exact isolated CI target required');
const runtime='/run/lifeos-platform/runtime.json';
const env={LIFEOS_PLATFORM_CANDIDATE:'1',LIFEOS_PLATFORM_TARGET:'isolated-test',LIFEOS_PLATFORM_BASE_URL:'https://review.example.test',LIFEOS_PLATFORM_TRANSPORT:'https-origin',LIFEOS_PLATFORM_HTTPS_HOST:'review.example.test',LIFEOS_PLATFORM_OWNER_ID:'personal-review-user',LIFEOS_PLATFORM_OWNER_EMAIL:'owner@example.test',LIFEOS_PLATFORM_SECRET:'fixture-ci-session-key-never-live-00000000',LIFEOS_PLATFORM_TEST_DATABASE_URL:target,LIFEOS_PERSONAL_ENABLED:'1',LIFEOS_PERSONAL_APPROVED:'personal-manual-v1',LIFEOS_PERSONAL_OWNER_ID:'personal-review-user',LIFEOS_PERSONAL_OWNER_EMAIL:'owner@example.test',LIFEOS_PERSONAL_SPACE_ID:'personal-review-space',LIFEOS_PERSONAL_DATABASE_NAME:'lifeos_platform_test_local',LIFEOS_PERSONAL_ALLOWED_TYPES:'todo,journal',LIFEOS_PERSONAL_ACCOUNT_ACCESS:'owner-password-v1',LIFEOS_PERSONAL_READONLY_LOGIN:'owner-session-v1',LIFEOS_PERSONAL_BUSINESS_WRITES:'owner-managed-v1'};
const mode=process.argv[2];
if(mode==='reset-disposable-schema'){
 // The separate 55432 CI service is disposable. Never reset the 55439 recovery service.
 const pool=new Pool({host:'127.0.0.1',port:55432,user:'postgres',password:'fixture-ci-admin-never-live',database:'lifeos_platform_test_local',max:1});
 try{
  const target=(await pool.query('SELECT current_database() AS db,current_user AS role,version() AS version')).rows[0];
  if(target.db!=='lifeos_platform_test_local'||target.role!=='postgres'||!target.version.startsWith('PostgreSQL 17.11 '))throw Error('Unexpected disposable target');
  await pool.query('DROP SCHEMA IF EXISTS lifeos_platform CASCADE');
  await pool.query('DROP ROLE IF EXISTS lifeos_platform_candidate_runtime');await pool.query('DROP ROLE IF EXISTS lifeos_platform_candidate_bootstrap');
 }finally{await pool.end();}
}
else if(mode==='runtime'||mode==='runtime-permit'||mode==='runtime-workspace'){const value:Record<string,string>={...env};if(mode==='runtime-workspace'){value.LIFEOS_PERSONAL_B_CANDIDATE='project-domain-v1';value.LIFEOS_PERSONAL_ALLOWED_TYPES='todo,journal,project,domain,topic';}if(mode==='runtime-permit'){delete (value as Partial<typeof env>).LIFEOS_PERSONAL_READONLY_LOGIN;delete (value as Partial<typeof env>).LIFEOS_PERSONAL_BUSINESS_WRITES;}writeFileSync(runtime,JSON.stringify(value),{mode:0o600,flag:'wx'});}
else if(mode==='bootstrap'||mode==='bootstrap-foreign'){
 const loaded=readReviewConfig(runtime),selected=mode==='bootstrap'?loaded:{...loaded,LIFEOS_PLATFORM_OWNER_ID:'synthetic-foreign-user',LIFEOS_PLATFORM_OWNER_EMAIL:'foreign@example.test',LIFEOS_PERSONAL_OWNER_ID:'synthetic-foreign-user',LIFEOS_PERSONAL_OWNER_EMAIL:'foreign@example.test',LIFEOS_PERSONAL_SPACE_ID:'synthetic-foreign-space'};
 const result=await runPersonalSyntheticBootstrap(selected);if(result.status!=='created'||!result.readbackVerified)throw Error('Synthetic bootstrap failed');
}else if(mode==='caddy'){
 const browser=process.env.OWNER_HTTPS_SCENARIO==='browser'||process.env.OWNER_HTTPS_SCENARIO==='journal';
 if(browser&&(process.platform!=='linux'||process.env.GITHUB_ACTIONS!=='true'||process.env.RUN_OWNER_RECOVERY_BROWSER_TESTS!=='1'))throw Error('BROWSER_FIXTURE_UNAVAILABLE');
 writeFileSync(process.env.RUNNER_TEMP+'/recovery-tls/Caddyfile',fixtureCaddyfile(readFileSync('test/fixtures/Caddyfile.synthetic','utf8'),'/fixture/server.crt','/fixture/server.key'),{mode:0o600,flag:'wx'});
}
else if(mode==='wait'){
 let ready=false,last='NOT_ATTEMPTED';for(let i=0;i<40&&!ready;i++){ready=await new Promise<boolean>(resolve=>{const r=request('https://review.example.test/login',{port:14443,servername:'review.example.test',ca:readFileSync(process.env.RUNNER_TEMP+'/recovery-tls/ca.crt'),...fixtureLookup,headers:{host:'review.example.test'},timeout:1000},res=>{res.resume();last='HTTP_'+String(res.statusCode??0);resolve(res.statusCode===200);});r.on('error',error=>{last='TRANSPORT_'+fixtureErrorCode(error);resolve(false);});r.on('timeout',()=>r.destroy(Object.assign(Error('timeout'),{code:'ETIMEDOUT'})));r.end();});if(!ready)await new Promise(r=>setTimeout(r,500));}if(!ready)throw Error('Synthetic HTTPS listener unavailable: '+last);
}else throw Error('Unsupported fixture operation');
