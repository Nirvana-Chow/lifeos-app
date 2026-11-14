import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {policyOAuthBusinessMcpOperations} from '../src/agent-api/capabilities.ts';
import {policyOAuthSqlFingerprints} from '../src/business-mcp-oauth/policy-sql-fingerprints.ts';
const sql=await readFile(new URL('../db/0025_business_mcp_full_policy.proposed.sql',import.meta.url),'utf8');
test('proposed SQL reviewed operation snapshot matches the unique full-business source projection',()=>{
 const registrations=[...sql.matchAll(/^  \('([A-Za-z]+)',ARRAY\[([^\]]*)\]::text\[\]\)/gm)].map(([,id,scopes])=>[id,[...scopes.matchAll(/'([^']+)'/g)].map(match=>match[1])]);
 const expected=policyOAuthBusinessMcpOperations.filter(op=>op.module!=='fileHandoff').map(op=>[op.id,[...op.requiredScopes]]);
 assert.equal(registrations.length,59);assert.deepEqual(Object.fromEntries(registrations),Object.fromEntries(expected));
});
test('readiness fingerprints bind every new exact proposed function plus the unchanged original immutable guard',async()=>{
 const original=await readFile(new URL('../db/0012_todo_classification.proposed.sql',import.meta.url),'utf8');
 const functions=[...sql.matchAll(/CREATE FUNCTION ([a-z_]+\.[a-z_]+)\(([^)]*)\)([\s\S]*?)AS\s+\$\$([\s\S]*?)\$\$;/g)];
 const unchanged=[...original.matchAll(/CREATE FUNCTION (lifeos_platform\.classification_immutable)\(([^)]*)\)([\s\S]*?)AS\s+\$\$([\s\S]*?)\$\$;/g)];
 const signatures=[];
 for(const [,name,args,attributes,body]of [...functions,...unchanged]){
  const types=args.trim()?args.split(',').map(arg=>arg.trim().split(/\s+/).at(-1)).join(','):'';
  const signature=name+'('+types+')';signatures.push(signature);const pin=policyOAuthSqlFingerprints[signature as keyof typeof policyOAuthSqlFingerprints];
  assert.ok(pin,signature);assert.equal(pin.digest,createHash('sha256').update(body).digest('hex'),signature);
  assert.equal(pin.definer,attributes.includes('SECURITY DEFINER'));assert.equal(pin.volatility,attributes.includes('IMMUTABLE')?'i':attributes.includes('STABLE')?'s':'v');
 }
 assert.deepEqual(signatures.sort(),Object.keys(policyOAuthSqlFingerprints).sort());
});
