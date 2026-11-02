import test from'node:test';import assert from'node:assert/strict';import{hashPassword,verifyPassword}from'better-auth/crypto';
import{execFileSync}from'node:child_process';
import{runSyntheticBootstrap,readSyntheticBootstrapConfig,parseSyntheticPasswords,initializeSyntheticUsers}from'../src/platform/synthetic-bootstrap.ts';import type{SqlClient}from'../src/platform/postgres.ts';
const env={LIFEOS_PLATFORM_CANDIDATE:'1',LIFEOS_PLATFORM_TARGET:'isolated-test',LIFEOS_PLATFORM_BASE_URL:'http://127.0.0.1:3190',LIFEOS_PLATFORM_OWNER_ID:'fixture-owner-a',LIFEOS_PLATFORM_OWNER_EMAIL:'fixture@example.invalid',LIFEOS_PLATFORM_SECRET:'fixture-only-not-a-live-secret-000000000',LIFEOS_PLATFORM_TEST_DATABASE_URL:'postgres://lifeos_platform_candidate_runtime:fixture-only@127.0.0.1:55433/lifeos_platform_test_fixture',LIFEOS_PLATFORM_BOOTSTRAP:'synthetic-test-only',LIFEOS_PLATFORM_BOOTSTRAP_APPROVAL:'approved-isolated-fixtures',LIFEOS_PLATFORM_BOOTSTRAP_DATABASE_URL:'postgres://lifeos_platform_candidate_bootstrap:fixture-only@127.0.0.1:55433/lifeos_platform_test_fixture'};
const passwords={ownerA:'Synthetic-only-password-A-0001',ownerB:'Synthetic-only-password-B-0001'};
function driver(responses:Record<string,unknown>[][]=[],failure='',foreign=false){
 const calls:{sql:string;values:unknown[]}[]=[];let released=0;const client:SqlClient={query:async(sql,values=[])=>{calls.push({sql,values});if(failure&&sql.includes(failure))throw Error('fixture-private-connection-and-password');return{rows:sql.includes('AS foreign_users')?[{foreign_users:foreign,foreign_accounts:foreign}]:/FROM lifeos_platform\.platform_(user|account)/.test(sql)?responses.shift()??[]:[],rowCount:1};},release:()=>{released++;}};return{client,calls,released:()=>released};
}
test('bootstrap is disabled before reading password input or opening any connection',async()=>{
 const io={readInput:async()=>{throw Error('input must not be read');},connect:async()=>{throw Error('database must not be opened');}};
 assert.deepEqual(await runSyntheticBootstrap({},io),{status:'disabled'});assert.equal(readSyntheticBootstrapConfig({...env,LIFEOS_PLATFORM_BOOTSTRAP:undefined}),null);
});
test('enabled bootstrap rejects missing approval, real identities, privileged or different database targets',()=>{
 assert.ok(readSyntheticBootstrapConfig(env));
 for(const extra of [{LIFEOS_PLATFORM_BOOTSTRAP_APPROVAL:''},{LIFEOS_PLATFORM_OWNER_ID:'actual-owner'},{LIFEOS_PLATFORM_OWNER_EMAIL:'real@example.com'},{LIFEOS_PLATFORM_BOOTSTRAP_DATABASE_URL:'postgres://postgres:fixture@127.0.0.1:55433/lifeos_platform_test_fixture'},{LIFEOS_PLATFORM_BOOTSTRAP_DATABASE_URL:'postgres://lifeos_platform_candidate_bootstrap:fixture@127.0.0.1:55433/lifeos_platform_test_other'},{LIFEOS_PLATFORM_BOOTSTRAP_DATABASE_URL:'postgres://lifeos_platform_candidate_bootstrap:fixture@127.0.0.1:55434/lifeos_platform_test_fixture'}])assert.throws(()=>readSyntheticBootstrapConfig({...env,...extra}),/Synthetic bootstrap configuration unavailable/);
});
test('secret JSON input is bounded and rejects unknown fields, short, identical or malformed passwords',()=>{
 assert.deepEqual(parseSyntheticPasswords(Buffer.from(JSON.stringify(passwords))),passwords);
 for(const raw of ['{bad',JSON.stringify({...passwords,ownerId:'override'}),JSON.stringify({...passwords,ownerA:'short'}),JSON.stringify({...passwords,ownerB:passwords.ownerA}),' '.repeat(16385)])assert.throws(()=>parseSyntheticPasswords(Buffer.from(raw)),/Invalid synthetic password input/);
});
test('empty auth storage receives only the fixed synthetic pair and password hashes in one transaction',async()=>{
 const d=driver([[],[]]),result=await initializeSyntheticUsers(readSyntheticBootstrapConfig(env)!,d.client,passwords);
 assert.deepEqual(result,{status:'created',users:2});assert.equal(d.calls[0].sql,'BEGIN');assert.equal(d.calls.at(-1)?.sql,'COMMIT');
 const users=d.calls.filter(c=>c.sql.startsWith('INSERT INTO lifeos_platform.platform_user'));assert.deepEqual(users.map(c=>c.values.slice(0,3)),[['fixture-owner-a','Synthetic owner A','fixture@example.invalid'],['fixture-owner-b','Synthetic owner B','other@example.invalid']]);
 const accounts=d.calls.filter(c=>c.sql.startsWith('INSERT INTO lifeos_platform.platform_account'));assert.equal(accounts.length,2);assert.ok(await verifyPassword({hash:accounts[0].values[3] as string,password:passwords.ownerA}));assert.ok(await verifyPassword({hash:accounts[1].values[3] as string,password:passwords.ownerB}));assert.ok(d.calls.every(c=>!c.sql.includes(passwords.ownerA)&&!c.sql.includes(passwords.ownerB)));assert.doesNotMatch(JSON.stringify(result),/password|token|secret/i);
});
test('exact existing fixtures return unchanged without resetting accounts; conflicting or partial fixtures roll back',async()=>{
 const users=[{id:'fixture-owner-a',name:'Synthetic owner A',email:'fixture@example.invalid',emailVerified:false},{id:'fixture-owner-b',name:'Synthetic owner B',email:'other@example.invalid',emailVerified:false}],accounts=[{id:'fixture-account-a',userId:'fixture-owner-a',accountId:'fixture-owner-a',providerId:'credential',password:await hashPassword(passwords.ownerA)},{id:'fixture-account-b',userId:'fixture-owner-b',accountId:'fixture-owner-b',providerId:'credential',password:await hashPassword(passwords.ownerB)}];
 const d=driver([users,accounts]);assert.deepEqual(await initializeSyntheticUsers(readSyntheticBootstrapConfig(env)!,d.client,passwords),{status:'unchanged',users:2});assert.ok(!d.calls.some(c=>/^(INSERT|UPDATE|DELETE)/.test(c.sql)));
 for(const rows of [[users.slice(0,1),accounts],[users.map((u,i)=>i?u:{...u,email:'other-real@example.invalid'}),accounts],[users,accounts.map((a,i)=>i?a:{...a,password:'invalid-fixture-hash'})]]){const bad=driver(rows);await assert.rejects(initializeSyntheticUsers(readSyntheticBootstrapConfig(env)!,bad.client,passwords),/Synthetic fixture conflict/);assert.equal(bad.calls.at(-1)?.sql,'ROLLBACK');assert.ok(!bad.calls.some(c=>/^(INSERT|UPDATE|DELETE)/.test(c.sql)));}
});
test('a failed account write rolls back and masks driver details',async()=>{
 const d=driver([[],[]],'INSERT INTO lifeos_platform.platform_account');await assert.rejects(initializeSyntheticUsers(readSyntheticBootstrapConfig(env)!,d.client,passwords),e=>e instanceof Error&&e.message==='Synthetic initialization unavailable');assert.equal(d.calls.at(-1)?.sql,'ROLLBACK');assert.ok(!d.calls.some(c=>c.sql==='COMMIT'));
});
test('foreign auth rows stop at boolean metadata without reading any foreign credential columns',async()=>{
 const d=driver([], '',true);await assert.rejects(initializeSyntheticUsers(readSyntheticBootstrapConfig(env)!,d.client,passwords),/Synthetic fixture conflict/);assert.ok(!d.calls.some(c=>c.sql.startsWith('SELECT id,')));assert.ok(!d.calls.some(c=>c.sql.startsWith('INSERT')));assert.equal(d.calls.at(-1)?.sql,'ROLLBACK');
});
test('enabled orchestration reads back through a new connection and never retries an uncertain commit',async()=>{
 const users=[{id:'fixture-owner-a',name:'Synthetic owner A',email:'fixture@example.invalid',emailVerified:false},{id:'fixture-owner-b',name:'Synthetic owner B',email:'other@example.invalid',emailVerified:false}],accounts=[{id:'fixture-account-a',userId:'fixture-owner-a',accountId:'fixture-owner-a',providerId:'credential',password:await hashPassword(passwords.ownerA)},{id:'fixture-account-b',userId:'fixture-owner-b',accountId:'fixture-owner-b',providerId:'credential',password:await hashPassword(passwords.ownerB)}];
 const writes=driver([[],[]]),reads=driver([users,accounts]);let connects=0,closes=0;
 const io={readInput:async()=>Buffer.from(JSON.stringify(passwords)),connect:async()=>({client:connects++===0?writes.client:reads.client,close:async()=>{closes++;}})};
 assert.deepEqual(await runSyntheticBootstrap(env,io),{status:'created',users:2,readbackVerified:true});assert.equal(connects,2);assert.equal(closes,2);assert.ok(reads.calls.every(c=>c.sql.startsWith('SELECT')));
 const first=driver([[],[]]);let attempts=0;
 await assert.rejects(runSyntheticBootstrap(env,{readInput:io.readInput,connect:async()=>{attempts++;if(attempts>1)throw Error('fixture-private-connection');return{client:first.client,close:async()=>{}};}}),e=>e instanceof Error&&e.message==='Synthetic initialization outcome uncertain');assert.equal(attempts,2);assert.equal(first.calls.filter(c=>c.sql==='COMMIT').length,1);
});
test('CLI default-off starts without FD3 or database and rejects secret command-line arguments without echo',()=>{
 const options={cwd:process.cwd(),env:{PATH:process.env.PATH,NODE_ENV:'test'} as NodeJS.ProcessEnv,encoding:'utf8' as const};
 assert.deepEqual(JSON.parse(execFileSync(process.execPath,['scripts/platform-synthetic-bootstrap.ts'],options)),{status:'disabled'});
 try{execFileSync(process.execPath,['scripts/platform-synthetic-bootstrap.ts','--password=fixture-only-not-a-live-password'],options);assert.fail('arguments must fail');}catch(e){const output=(e as {stdout?:string}).stdout??'';assert.doesNotMatch(output,/fixture-only-not-a-live-password/);assert.equal(JSON.parse(output).code,'ARGUMENTS_NOT_SUPPORTED');}
});
