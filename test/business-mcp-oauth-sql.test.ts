import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync}from'node:fs';import {createHash}from'node:crypto';
import {oauthSqlFingerprints}from'../src/business-mcp-oauth/sql-fingerprints.ts';
test('activation readiness binds the exact proposed OAuth function bodies consumed by the grant fence',()=>{
 const source=readFileSync(new URL('../db/0021_business_mcp_oauth.proposed.sql',import.meta.url),'utf8');
 const actual=Object.fromEntries([...source.matchAll(/CREATE FUNCTION lifeos_agent\.(\w+)\([\s\S]*?AS \$\$([\s\S]*?)\$\$;/g)].map(([,name,body])=>[name,createHash('sha256').update(body).digest('hex')]));
 assert.deepEqual(actual,oauthSqlFingerprints);
});
