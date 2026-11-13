import test from 'node:test';import assert from 'node:assert/strict';
const config={resource:'https://lifeos.nirvanachow.com/api/platform/mcp',issuer:'https://lifeos.nirvanachow.com/api/platform/auth',grantId:'approved-grant',scopes:['todo:read','todo:write','requirements:read','requirements:write','offline_access']};
const claims={iss:config.issuer,aud:config.resource,sub:'owner',azp:'https://client.example/metadata',client_id:'https://client.example/metadata',sid:'session',iat:1800000000,exp:1800000300,scope:'todo:read offline_access'};

test('verified-claim boundary rejects cross-resource, missing subject/client, invalid session shape, future and excessive-scope tokens',async()=>{
 const api=await import('../src/business-mcp-oauth/ledger.ts').catch(()=>null);assert.ok(api,'OAuth ledger implemented');
 assert.deepEqual(api.validateBusinessClaims(claims,config,'owner',1800000010),claims);
 for(const patch of [{aud:[config.resource,'https://other.example']},{iss:'https://other.example'},{azp:undefined},{client_id:'different'},{sub:'other'},{sid:99},{exp:1800000001},{iat:1800000100},{scope:'todo:read todo:write auth:read'}])assert.equal(api.validateBusinessClaims({...claims,...patch},config,'owner',1800000010),null);
 assert.ok(api.validateBusinessClaims({...claims,sid:undefined},config,'owner',1800000010),'A current delegated refresh does not require a live browser-session claim');
 assert.ok(api.validateBusinessClaims({...claims,sid:null},config,'owner',1800000010),'The provider preserves SQL ON DELETE SET NULL in refreshed JWTs');
});

test('OAuth resolver intersects current original grant with current token scopes and closed business operations',async()=>{
 const api=await import('../src/business-mcp-oauth/ledger.ts').catch(()=>null);assert.ok(api);
 const fence={tokenId:'a'.repeat(64),bindingId:'binding',bindingRevision:3,expiresAt:1800000300};
 const state={grantId:'approved-grant',ownerId:'owner',spaceId:'space',scopes:['todo:read','requirements:read','requirements:write'],oauthFence:fence};
 const grant={grantId:'approved-grant',ownerId:'owner',spaceId:'space',scopes:['todo:read','todo:write','requirements:read','requirements:write'] as const};
 const resolved=api.intersectOAuthGrant(state,grant);assert.ok(resolved);
 assert.deepEqual(resolved.scopes,['requirements:read','requirements:write','todo:read']);
 assert.equal(resolved.allowedOperationIds.includes('createTodo'),false);
 assert.equal(resolved.allowedOperationIds.includes('createRequirement'),true);
 for(const id of ['claimRequirementExecution','updateRequirementExecution','streamRequirementEvents','previewTodoClassification','commitTodoClassification','unknown'])assert.equal(resolved.allowedOperationIds.includes(id),false);
 assert.equal(api.intersectOAuthGrant(state,{...grant,spaceId:'other'}),null);
});

test('OAuth cannot acquire classification producer authority even with both preview scopes',async()=>{
 const api=await import('../src/business-mcp-oauth/ledger.ts');
 const grant={grantId:'grant',ownerId:'owner',spaceId:'space',scopes:['todo:read','organization:read'] as const};
 const result=api.intersectOAuthGrant({...grant,oauthFence:{tokenId:'a'.repeat(64),bindingId:'binding',bindingRevision:1,expiresAt:2000000000}},grant);assert.ok(result);
 assert.equal(result.allowedOperationIds.includes('previewTodoClassification'),false);
});
