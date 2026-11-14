import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {readBusinessPolicyCatalog} from '../src/agent-api/business-policy-postgres.ts';
import {verifyBusinessOAuthPool} from '../src/business-mcp-oauth/readiness.ts';
import {verifyFilePermissionPool} from '../src/file-handoff/readiness.ts';
import {sessionFreshnessSqlDigests,reviewedSessionBodyDigests} from '../src/agent-api/session-freshness-sql-digests.ts';

test('new readiness alternatives bind every changed body to the exact reviewed migration bytes',()=>{
 const sql=readFileSync(new URL('../db/0024_device_login_duration.proposed.sql',import.meta.url),'utf8');
 const actual=Object.fromEntries([...sql.matchAll(/CREATE OR REPLACE FUNCTION lifeos_agent\.(\w+)\([\s\S]*?AS \$\$([\s\S]*?)\$\$;/g)].map(([,name,body])=>[name,createHash('sha256').update(body).digest('hex')]));
 assert.deepEqual(sessionFreshnessSqlDigests,actual);
 assert.deepEqual(reviewedSessionBodyDigests('unreviewed_function','0'.repeat(64)),['0'.repeat(64)]);
});

// These are SQL-boundary unit tests. They do not execute PostgreSQL or qualify ACLs.
async function firstQuery(run:(pool:any)=>Promise<unknown>){
 let seen='';const stop=new Error('query boundary observed');
 const query=async(sql:string,values?:unknown[])=>{seen=sql+JSON.stringify(values);throw stop;};
 const pool={query,connect:async()=>({query,release(){}})};
 await assert.rejects(()=>run(pool),error=>error===stop);return seen;
}
test('business-policy readiness carries only the original and reviewed 0024 management-body digests',async()=>{
 const sent=await firstQuery(readBusinessPolicyCatalog);
 for(const hash of ['886aa98215c0fcf1fd085b0a0b6d16d4e42ba02b8297da34e1891df9933f0058','72272b10f49e2966bfdc5857a1263801b88f921cc9bb4012091aa3e2757c9295'])assert.ok(sent.includes(hash),hash);
 assert.ok(sent.includes('p.proowner=o.relowner')&&sent.includes('aclexplode'));
});
test('OAuth readiness retains old owner proof and admits the exact fresh-MFA owner proof',async()=>{
 const sent=await firstQuery(pool=>verifyBusinessOAuthPool(pool,{resource:'https://lifeos.nirvanachow.com/api/platform/mcp',issuer:'https://lifeos.nirvanachow.com/api/platform/auth',grantId:'synthetic-grant',scopes:['todo:read']},{ownerId:'synthetic-owner',ownerEmail:'owner@example.invalid',spaceId:'synthetic-space'}));
 for(const hash of ['9573b1587c70e2b7cc68acf08b30f8849548ef9d60a1983d01b4cfe654816432','bfa6b772a46b71c17b82ef2a8f8d8a031eda4eeb9373232e900d6ae7d64ed2bd'])assert.ok(sent.includes(hash),hash);
 assert.ok(sent.includes('f.proowner=m.relowner')&&sent.includes('aclexplode'));
});
test('file readiness checks its setter and both changed native identity helpers against exact reviewed bodies',async()=>{
 const sent=await firstQuery(pool=>verifyFilePermissionPool(pool,'lifeos_platform_candidate_runtime'));
 for(const hash of ['67bd0fa43cd20b09370f6444ff2aaddca8032300d33ccb1f76d94dcc15f82725','42001ce1da25437978bf95abd6f158dd36fd25305099a7c3717214a50cb68c82','99a4e5e0544c545449268dff2ccaf6f9e274a9b8470eed008f09b3500a49bca8','ebdc31bbb67ca43bba5946eb9348c9f532606f7fc8274c9e6c2187b25fd61088','bfa6b772a46b71c17b82ef2a8f8d8a031eda4eeb9373232e900d6ae7d64ed2bd'])assert.ok(sent.includes(hash),hash);
 assert.ok(sent.includes('f.proowner=m.relowner')&&sent.includes('aclexplode'));
});
