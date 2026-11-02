import{hashPassword,verifyPassword}from'better-auth/crypto';import{readPlatformConfig,type PlatformConfig}from'./config.ts';import type{SqlClient}from'./postgres.ts';
export const syntheticIdentities=Object.freeze([{id:'fixture-owner-a',name:'Synthetic owner A',email:'fixture@example.invalid',accountId:'fixture-account-a'},{id:'fixture-owner-b',name:'Synthetic owner B',email:'other@example.invalid',accountId:'fixture-account-b'}].map(value=>Object.freeze(value)));
export type SyntheticPasswords={ownerA:string;ownerB:string};
export type SyntheticBootstrapConfig={platform:PlatformConfig;databaseURL:string};
const unavailable=()=>Error('Synthetic bootstrap configuration unavailable');
export function requireSyntheticPlatformConfig(env:Record<string,string|undefined>):PlatformConfig{
 const config=readPlatformConfig(env),owner=syntheticIdentities[0];if(!config||config.ownerId!==owner.id||config.ownerEmail!==owner.email)throw unavailable();return config;
}
export function readSyntheticBootstrapConfig(env:Record<string,string|undefined>):SyntheticBootstrapConfig|null{
 if(env.LIFEOS_PLATFORM_BOOTSTRAP!=='synthetic-test-only')return null;
 if(env.LIFEOS_PLATFORM_BOOTSTRAP_APPROVAL!=='approved-isolated-fixtures')throw unavailable();
 const platform=requireSyntheticPlatformConfig(env),databaseURL=env.LIFEOS_PLATFORM_BOOTSTRAP_DATABASE_URL;if(!databaseURL)throw unavailable();
 try{const db=new URL(databaseURL),runtime=new URL(platform.databaseURL);if(!['postgres:','postgresql:'].includes(db.protocol)||db.hostname!=='127.0.0.1'||db.username!=='lifeos_platform_candidate_bootstrap'||!db.password||db.pathname!==runtime.pathname||(db.port||'5432')!==(runtime.port||'5432')||db.search||db.hash)throw unavailable();}catch{throw unavailable();}
 return{platform,databaseURL};
}
export function parseSyntheticPasswords(raw:Uint8Array):SyntheticPasswords{
 const fail=():never=>{throw Error('Invalid synthetic password input');};if(raw.byteLength>16384)return fail();
 try{const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='ownerA,ownerB')return fail();
  for(const key of ['ownerA','ownerB'])if(typeof value[key]!=='string'||Buffer.byteLength(value[key])<12||Buffer.byteLength(value[key])>128||/[\u0000-\u001f\u007f]/.test(value[key]))return fail();if(value.ownerA===value.ownerB)return fail();return{ownerA:value.ownerA,ownerB:value.ownerB};
 }catch{return fail();}
}
async function readFixtures(client:SqlClient){
 const [a,b]=syntheticIdentities;
 const foreign=await client.query(`SELECT
  EXISTS(SELECT 1 FROM lifeos_platform.platform_user u WHERE NOT((u.id=$1 AND u.name=$2 AND u.email=$3 AND u."emailVerified"=false) OR(u.id=$5 AND u.name=$6 AND u.email=$7 AND u."emailVerified"=false))) AS foreign_users,
  EXISTS(SELECT 1 FROM lifeos_platform.platform_account a WHERE NOT(((a.id=$4 AND a."userId"=$1 AND a."accountId"=$1) OR(a.id=$8 AND a."userId"=$5 AND a."accountId"=$5)) AND a."providerId"='credential' AND a.password IS NOT NULL)) AS foreign_accounts`,[a.id,a.name,a.email,a.accountId,b.id,b.name,b.email,b.accountId]);
 if(foreign.rows.length!==1||foreign.rows[0].foreign_users!==false||foreign.rows[0].foreign_accounts!==false)throw Error('Synthetic fixture conflict');
 return{users:(await client.query('SELECT id,name,email,"emailVerified" FROM lifeos_platform.platform_user WHERE id=ANY($1::text[])',[syntheticIdentities.map(f=>f.id)])).rows,accounts:(await client.query('SELECT id,"userId","accountId","providerId",password FROM lifeos_platform.platform_account WHERE id=ANY($1::text[])',[syntheticIdentities.map(f=>f.accountId)])).rows};
}
async function assertFixtures(rows:Awaited<ReturnType<typeof readFixtures>>,passwords:SyntheticPasswords):Promise<void>{
 const conflict=()=>Error('Synthetic fixture conflict');if(rows.users.length!==2||rows.accounts.length!==2)throw conflict();
 for(const [index,fixture]of syntheticIdentities.entries()){
  const u=rows.users.find(row=>row.id===fixture.id),a=rows.accounts.find(row=>row.id===fixture.accountId);
  if(!u||u.name!==fixture.name||u.email!==fixture.email||u.emailVerified!==false||!a||a.userId!==fixture.id||a.accountId!==fixture.id||a.providerId!=='credential'||typeof a.password!=='string')throw conflict();
  let matches=false;try{matches=await verifyPassword({hash:a.password,password:index===0?passwords.ownerA:passwords.ownerB});}catch{throw conflict();}if(!matches)throw conflict();
 }
}
export async function initializeSyntheticUsers(config:SyntheticBootstrapConfig,client:SqlClient,input:SyntheticPasswords):Promise<{status:'created'|'unchanged';users:2}>{
 const passwords=parseSyntheticPasswords(Buffer.from(JSON.stringify(input)));if(config.platform.ownerId!==syntheticIdentities[0].id||config.platform.ownerEmail!==syntheticIdentities[0].email)throw unavailable();let commitAttempted=false;
 try{
  await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtextextended('lifeos-synthetic-bootstrap-v1',0))");
  const rows=await readFixtures(client);
  if(rows.users.length||rows.accounts.length){await assertFixtures(rows,passwords);commitAttempted=true;await client.query('COMMIT');return{status:'unchanged',users:2};}
  const hashes=await Promise.all([hashPassword(passwords.ownerA),hashPassword(passwords.ownerB)]);
  for(const [index,fixture]of syntheticIdentities.entries()){
   await client.query('INSERT INTO lifeos_platform.platform_user(id,name,email,"emailVerified") VALUES($1,$2,$3,false)',[fixture.id,fixture.name,fixture.email]);
   await client.query('INSERT INTO lifeos_platform.platform_account(id,"userId","accountId","providerId",password) VALUES($1,$2,$2,$3,$4)',[fixture.accountId,fixture.id,'credential',hashes[index]]);
  }
  commitAttempted=true;await client.query('COMMIT');return{status:'created',users:2};
 }catch(error){await client.query('ROLLBACK').catch(()=>undefined);if(commitAttempted)throw Error('Synthetic initialization outcome uncertain');if(error instanceof Error&&error.message==='Synthetic fixture conflict')throw error;throw Error('Synthetic initialization unavailable');}
}
type IO={readInput():Promise<Uint8Array>;connect(config:SyntheticBootstrapConfig):Promise<{client:SqlClient;close():Promise<void>}>};
export async function runSyntheticBootstrap(env:Record<string,string|undefined>,io:IO):Promise<{status:'disabled'}|{status:'created'|'unchanged';users:2;readbackVerified:true}>{
 const config=readSyntheticBootstrapConfig(env);if(!config)return{status:'disabled'};
 const passwords=parseSyntheticPasswords(await io.readInput()),connection=await io.connect(config);let result:{status:'created'|'unchanged';users:2}|undefined;
 try{result=await initializeSyntheticUsers(config,connection.client,passwords);}finally{try{await connection.close();}catch{if(result)throw Error('Synthetic initialization outcome uncertain');}}
 try{const readback=await io.connect(config);try{await assertFixtures(await readFixtures(readback.client),passwords);}finally{await readback.close();}}catch{throw Error('Synthetic initialization outcome uncertain');}
 return{...result,readbackVerified:true};
}
