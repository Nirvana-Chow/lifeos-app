// Prepared only: no default account, database, secret or automatic migration.
import{readSync}from'node:fs';import{runSyntheticBootstrap}from'../src/platform/synthetic-bootstrap.ts';import{verifyRestrictedPool,type SqlPool,type SqlClient}from'../src/platform/postgres.ts';import{assertDependencyLock}from'./dependency-lock.mjs';
async function main(){
 if(process.argv.length!==2){console.log(JSON.stringify({status:'blocked',code:'ARGUMENTS_NOT_SUPPORTED'}));process.exitCode=1;return;}
 const result=await runSyntheticBootstrap(process.env,{
  readInput:async()=>{const chunks:Buffer[]=[];let size=0;for(;;){const chunk=Buffer.alloc(4096),count=readSync(3,chunk,0,chunk.length,null);if(!count)break;size+=count;if(size>16384)throw Error('Invalid synthetic password input');chunks.push(chunk.subarray(0,count));}return Buffer.concat(chunks);},
  connect:async config=>{
   assertDependencyLock();const{Pool}=await import('pg'),pool=new Pool({connectionString:config.databaseURL,max:1,connectionTimeoutMillis:2000,statement_timeout:5000,idle_in_transaction_session_timeout:5000,lock_timeout:2000,options:'-c search_path=pg_catalog,lifeos_platform'});
   try{await verifyRestrictedPool(pool as SqlPool,'synthetic-bootstrap');const client=await pool.connect();return{client:client as SqlClient,close:async()=>{client.release();await pool.end();}};}catch{await pool.end();throw Error('Synthetic initialization unavailable');}
  },
 });console.log(JSON.stringify(result));
}
main().catch(error=>{const uncertain=error instanceof Error&&error.message==='Synthetic initialization outcome uncertain',conflict=error instanceof Error&&error.message==='Synthetic fixture conflict';console.log(JSON.stringify({status:uncertain?'uncertain':'blocked',code:uncertain?'READBACK_REQUIRED':conflict?'FIXTURE_CONFLICT':'BOOTSTRAP_UNAVAILABLE'}));process.exitCode=1;});
