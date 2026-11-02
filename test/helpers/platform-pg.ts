import{readSync}from'node:fs';import{Pool}from'pg';import{parseSyntheticPasswords,requireSyntheticPlatformConfig,type SyntheticPasswords}from'../../src/platform/synthetic-bootstrap.ts';
export function validateAcceptanceEnvironment(env:Record<string,string|undefined>,args:readonly string[]){
 if(env.LIFEOS_PLATFORM_TEST_APPROVAL!=='approved-isolated-fixtures'||!args.includes('--test-isolation=none')||(env.RUN_PLATFORM_AUTH_POSTGRES_TESTS==='1'&&env.RUN_PLATFORM_NETWORK_TESTS==='1'))throw Error('Approved synthetic target and separate dedicated acceptance runner required');
 return requireSyntheticPlatformConfig(env);
}
let passwords:SyntheticPasswords|undefined;
export function acceptancePasswords():SyntheticPasswords{
 if(passwords)return passwords;const chunks:Buffer[]=[];let size=0;
 for(;;){const part=Buffer.alloc(4096),count=readSync(3,part,0,part.length,null);if(!count)break;size+=count;if(size>16384)throw Error('Invalid synthetic password input');chunks.push(part.subarray(0,count));}
 passwords=parseSyntheticPasswords(Buffer.concat(chunks));return passwords;
}
export function acceptancePool(databaseURL:string){return new Pool({connectionString:databaseURL,max:3,connectionTimeoutMillis:2000,statement_timeout:5000,idle_in_transaction_session_timeout:5000,lock_timeout:2000,options:'-c search_path=pg_catalog,lifeos_platform'});}
