import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const root=process.env.LIFEOS_FULL_POLICY_BASELINE_ROOT?pathToFileURL(process.env.LIFEOS_FULL_POLICY_BASELINE_ROOT+'/'):new URL('../',import.meta.url);
const [{BusinessOAuthLedger},{sameOAuthFence},{lockCurrentAgentGrant}]=await Promise.all([
 import(new URL('src/business-mcp-oauth/ledger.ts',root).href),import(new URL('src/business-mcp-oauth/contracts.ts',root).href),import(new URL('src/platform/postgres.ts',root).href),
]);
const fence={tokenId:'a'.repeat(64),bindingId:'synthetic-policy-binding',bindingRevision:1,expiresAt:2000000000};
const policy='all-personal-business-v1' as const;
const config={resource:'https://lifeos.nirvanachow.com/api/platform/mcp',issuer:'https://lifeos.nirvanachow.com/api/platform/auth',grantId:'synthetic-policy-grant',scopes:['personal-business:all','offline_access']};
const full={grantId:config.grantId,ownerId:'synthetic-owner',spaceId:'synthetic-space',scopes:config.scopes,producerAuthorizationRevision:'classification-oauth-v1:'+'b'.repeat(64),oauthFence:{...fence,policy}};
// Unit ports characterize our query/decoder boundary only; these are not PG evidence.
function ledger(value:unknown,scopes=config.scopes){const queries:string[]=[];const pool={connect:async()=>({query:async(sql:string)=>{queries.push(sql);return{rows:[{value}]};},release(){}})};return{instance:new BusinessOAuthLedger(pool,{...config,scopes},full.ownerId,full.spaceId),queries};}
test('a full-policy state cannot be accepted from an unversioned old fence',async()=>{
 const port=ledger({...full,oauthFence:fence});assert.equal(await port.instance.read(fence.tokenId),null);
});
test('a policy state binds the policy-specific reader and exact version',async()=>{
 const port=ledger(full);assert.deepEqual(await port.instance.read(fence.tokenId),full);
 assert.equal(port.queries.length,1);assert.match(port.queries[0],/lifeos_agent\.read_policy_oauth_business_token\(/);
 assert.equal(await ledger({...full,oauthFence:{...fence,policy:'unknown-policy'}}).instance.read(fence.tokenId),null);
 assert.equal(await ledger({...full,producerAuthorizationRevision:undefined}).instance.read(fence.tokenId),null);
});
test('old narrow state still uses the original reader without adding policy',async()=>{
 const narrow={...full,scopes:['journal:read'],oauthFence:fence},port=ledger(narrow,['journal:read']);
 assert.deepEqual(await port.instance.read(fence.tokenId),narrow);assert.match(port.queries[0],/lifeos_agent\.read_oauth_business_token\(/);
 assert.equal(await ledger({...narrow,oauthFence:{...fence,policy}}).instance.read(fence.tokenId),null);
});
test('current authority cannot substitute a different policy for the same four old fence fields',()=>{
 assert.equal(sameOAuthFence(fence,{...fence,policy}),false);assert.equal(sameOAuthFence({...fence,policy},{...fence,policy}),true);
});
test('the same transaction holds the new OAuth fence and the original current-policy fence',async()=>{
 const queries:string[]=[];const client={query:async(sql:string)=>{queries.push(sql);return{rows:[{allowed:true}]};},release(){}};
 const grant={grantId:full.grantId,ownerId:full.ownerId,spaceId:full.spaceId,scopes:['journal:read'],operationId:'getJournal',businessDataPolicy:policy,oauthFence:full.oauthFence};
 assert.equal(await lockCurrentAgentGrant(client,full.ownerId,grant,['journal:read'],true),true);
 assert.equal(queries.length,2);assert.match(queries[0],/assert_policy_oauth_business_grant\(/);assert.match(queries[1],/assert_current_business_grant\(/);
});
test('an unknown or non-policy original grant cannot choose a policy SQL fence',async()=>{
 let count=0;const client={query:async()=>{count++;return{rows:[{allowed:true}]};},release(){}};
 const grant={grantId:full.grantId,ownerId:full.ownerId,spaceId:full.spaceId,scopes:['journal:read'],operationId:'getJournal',oauthFence:full.oauthFence};
 assert.equal(await lockCurrentAgentGrant(client,full.ownerId,grant,['journal:read'],true),false);
 assert.equal(await lockCurrentAgentGrant(client,full.ownerId,{...grant,businessDataPolicy:policy,oauthFence:{...fence,policy:'unreviewed'}},['journal:read'],true),false);
 assert.equal(count,0);
});
