import test from 'node:test';
import assert from 'node:assert/strict';
import {readBusinessOAuthConfig} from '../src/business-mcp-oauth/boundary.ts';
import {intersectOAuthGrant,type OAuthState,type OriginalGrant} from '../src/business-mcp-oauth/ledger.ts';

const marker='personal-business:all';
const origin='https://lifeos.nirvanachow.com';
const env={LIFEOS_BUSINESS_MCP_OAUTH:'business-mcp-oauth-v1',LIFEOS_BUSINESS_MCP_GRANT_ID:'synthetic-full-policy-grant',LIFEOS_BUSINESS_MCP_SCOPES:marker+' offline_access'};
const state:OAuthState={grantId:'synthetic-full-policy-grant',ownerId:'synthetic-owner',spaceId:'synthetic-space',scopes:[marker,'offline_access'],producerAuthorizationRevision:'classification-oauth-v1:'+'c'.repeat(64),oauthFence:{tokenId:'a'.repeat(64),bindingId:'synthetic-binding',bindingRevision:1,expiresAt:2000000000,policy:'all-personal-business-v1'}};
const grant:OriginalGrant={grantId:state.grantId,ownerId:state.ownerId,spaceId:state.spaceId,businessDataPolicy:'all-personal-business-v1',scopes:['todo:read','todo:write','journal:read','requirements:read','requirements:write'],allowedOperationIds:['getJournal','createTodo','getRequirement','claimRequirementExecution']};

test('explicit full-personal-business consent is a separate supported OAuth scope',()=>{
 assert.deepEqual(readBusinessOAuthConfig(env,origin)?.scopes,[marker,'offline_access']);
 assert.throws(()=>readBusinessOAuthConfig({...env,LIFEOS_BUSINESS_MCP_SCOPES:marker+' todo:read'},origin));
 assert.throws(()=>readBusinessOAuthConfig({...env,LIFEOS_BUSINESS_MCP_SCOPES:marker+' file-handoff:read'},origin));
});
test('full-policy token intersects actual original reviewed operations and excludes engineering',()=>{
 const actual=intersectOAuthGrant(state,grant);assert.ok(actual);
 assert.deepEqual([...actual.allowedOperationIds].sort(),['createTodo','getJournal','getRequirement']);
 assert.deepEqual(actual.scopes,['journal:read','requirements:read','todo:read','todo:write']);
 assert.equal(actual.businessDataPolicy,'all-personal-business-v1');
 assert.deepEqual(actual.oauthFence,state.oauthFence);
});
test('only the new full-policy producer binding admits preview, never owner approval or commit',()=>{
 const original={...grant,scopes:[...grant.scopes,'organization:read' as const],allowedOperationIds:[...grant.allowedOperationIds!,'previewTodoClassification','commitTodoClassification']};
 const actual=intersectOAuthGrant(state,original);assert.ok(actual);assert.ok(actual.allowedOperationIds.includes('previewTodoClassification'));assert.ok(!actual.allowedOperationIds.includes('commitTodoClassification'));assert.equal(actual.authorizationRevision,state.producerAuthorizationRevision);
 assert.equal(intersectOAuthGrant({...state,producerAuthorizationRevision:undefined},original),null);
 assert.equal(intersectOAuthGrant({...state,producerAuthorizationRevision:'a'.repeat(64)},original),null);
});
test('a full-policy token cannot convert a narrow or unknown-policy original grant',()=>{
 const {businessDataPolicy:_,...narrow}=grant;
 assert.equal(intersectOAuthGrant(state,narrow),null);
 assert.equal(intersectOAuthGrant(state,{...grant,businessDataPolicy:'unreviewed-policy' as never}),null);
 assert.equal(intersectOAuthGrant(state,{...grant,grantId:'another-grant'}),null);
 assert.equal(intersectOAuthGrant({...state,oauthFence:{...state.oauthFence,policy:undefined}},grant),null,'Full scope needs the SQL policy fence, not an old binding with the same four fields');
});
test('narrow OAuth consent stays narrow when the original grant has full policy',()=>{
 const actual=intersectOAuthGrant({...state,scopes:['journal:read'],oauthFence:{...state.oauthFence,policy:undefined}},grant);assert.ok(actual);
 assert.deepEqual(actual.scopes,['journal:read']);assert.deepEqual(actual.allowedOperationIds,['getJournal']);
 assert.equal(intersectOAuthGrant({...state,scopes:['journal:read']},grant),null,'A narrow token cannot select a full-policy SQL fence');
});
test('current revocation or module unavailability removes full-policy authority',()=>{
 assert.equal(intersectOAuthGrant(state,null),null);
 assert.equal(intersectOAuthGrant(state,{...grant,allowedOperationIds:[]}),null);
 const actual=intersectOAuthGrant(state,{...grant,scopes:['journal:read'],allowedOperationIds:['getJournal']});assert.ok(actual);
 assert.deepEqual(actual.allowedOperationIds,['getJournal']);assert.deepEqual(actual.scopes,['journal:read']);
});
test('full-personal-business does not infer an independent file permission',()=>{
 const actual=intersectOAuthGrant(state,{...grant,scopes:[...grant.scopes,'file-handoff:read'],allowedOperationIds:[...grant.allowedOperationIds!,'getFileHandoff']});assert.ok(actual);
 assert.ok(!actual.scopes.includes('file-handoff:read'));assert.ok(!actual.allowedOperationIds.includes('getFileHandoff'));
 assert.equal(intersectOAuthGrant({...state,scopes:[marker,'todo:read']},grant),null);
});
test('separately consented file access is intersected with the current independent file permission',()=>{
 const fileHandoff={version:'file-handoff-v1' as const,revision:1,digest:'b'.repeat(64),scopes:['file-handoff:read','file-handoff:write'] as const,consumer:'codex' as const};
 const original={...grant,scopes:[...grant.scopes,...fileHandoff.scopes],allowedOperationIds:[...grant.allowedOperationIds!,'getFileHandoff','stageFileHandoff'],fileHandoff:{...fileHandoff,scopes:[...fileHandoff.scopes]}};
 const actual=intersectOAuthGrant({...state,scopes:[...state.scopes,'file-handoff:read']},original);assert.ok(actual);
 assert.ok(actual.allowedOperationIds.includes('getFileHandoff'));assert.ok(!actual.allowedOperationIds.includes('stageFileHandoff'));
 assert.deepEqual(actual.fileHandoff?.scopes,['file-handoff:read']);assert.ok(!actual.scopes.includes('file-handoff:write'));
 const ordinary=intersectOAuthGrant(state,original);assert.ok(ordinary);assert.equal(ordinary.fileHandoff,undefined);assert.ok(!ordinary.scopes.includes('file-handoff:read'));
});
