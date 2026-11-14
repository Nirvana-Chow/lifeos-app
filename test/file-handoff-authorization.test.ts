import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveBusinessPolicyGrant} from '../src/agent-api/business-policy.ts';
import {fileHandoffOperations} from '../src/file-handoff/operations.ts';

test('existing all-business policy never acquires any new file operation or scope',()=>{
 const grant=resolveBusinessPolicyGrant({id:'synthetic-key',referenceId:'synthetic-owner',metadata:{spaceId:'synthetic-space',businessDataPolicy:'all-personal-business-v1'},permissions:{todo:['read']},enabled:true,expiresAt:new Date(Date.now()+3600000)}, {ownerId:'synthetic-owner',spaceId:'synthetic-space',now:Date.now(),policyEnabled:true,registry:fileHandoffOperations,operationAvailable:()=>true});
 assert.deepEqual(grant?.scopes,[]);assert.deepEqual(grant?.allowedOperationIds,[]);
});
test('only an independently enabled, exact versioned file permission extends the original grant',async()=>{
 const module=await import('../src/file-handoff/authorization.ts').catch(()=>null);assert.ok(module,'actual file authorization composition must exist');
 const base={grantId:'synthetic-key',ownerId:'synthetic-owner',spaceId:'synthetic-space',scopes:['todo:read'],allowedOperationIds:['snapshotTodos']};
 const permission={version:'file-handoff-v1',revision:1,digest:'a'.repeat(64),scopes:['file-handoff:read','file-handoff:write'],consumer:'codex'};
 assert.deepEqual(module.extendFileGrant(base,permission,false),base);assert.deepEqual(module.extendFileGrant(base,{...permission,version:'future-version'},true),base);
 const extended=module.extendFileGrant(base,permission,true);assert.deepEqual(extended.scopes,['todo:read','file-handoff:read','file-handoff:write']);assert.equal(extended.fileHandoff!.consumer,'codex');
 assert.equal(module.fileActor(extended).authorityRef,module.fileActor({...extended,oauthFence:{tokenId:'b'.repeat(64),bindingId:'new-binding',bindingRevision:99,expiresAt:999}}).authorityRef);
 assert.equal(module.fileActor({...extended,oauthFence:{tokenId:'b'.repeat(64)}}).consumer,undefined);
 assert.throws(()=>module.fileActor(base));
});

test('file OAuth consent and token publication use the same-transaction permission wrappers, while legacy SQL stays unchanged',async()=>{
 const {BusinessOAuthLedger,intersectOAuthGrant}=await import('../src/business-mcp-oauth/ledger.ts');
 const queries:string[]=[],state={grantId:'synthetic-key',ownerId:'synthetic-owner',spaceId:'synthetic-space',scopes:['file-handoff:read'],oauthFence:{tokenId:'b'.repeat(64),bindingId:'synthetic-binding',bindingRevision:1,expiresAt:2000000000}};
 const pool={connect:async()=>({query:async(sql:string)=>{queries.push(sql);return{rows:[{value:sql.includes('approve_')?true:state}],rowCount:1};},release:()=>{}})};
 const config={issuer:'https://lifeos.nirvanachow.com/api/platform/auth',resource:'https://lifeos.nirvanachow.com/api/platform/mcp',grantId:state.grantId,scopes:['file-handoff:read','offline_access']};
 const ledger=new BusinessOAuthLedger(pool,config,state.ownerId,state.spaceId);
 await ledger.approve('synthetic-session','synthetic-client',state.scopes);await ledger.register('synthetic-token',{} as never,'refresh_token');
 assert.match(queries[0],/approve_file_handoff_oauth_binding/);assert.match(queries[1],/register_file_handoff_oauth_token/);
 const permission={version:'file-handoff-v1' as const,revision:1,digest:'a'.repeat(64),scopes:['file-handoff:read','file-handoff:write'] as ('file-handoff:read'|'file-handoff:write')[],consumer:'codex' as const};
 const grant={grantId:state.grantId,ownerId:state.ownerId,spaceId:state.spaceId,scopes:permission.scopes,fileHandoff:permission};
 const narrowed=intersectOAuthGrant(state,grant)!;assert.deepEqual(narrowed.fileHandoff!.scopes,['file-handoff:read']);assert.deepEqual(narrowed.allowedOperationIds,['getFileHandoff']);
 queries.length=0;const old=new BusinessOAuthLedger(pool,{...config,scopes:['todo:read']},state.ownerId,state.spaceId);
 await old.approve('synthetic-session','synthetic-client',['todo:read']);await old.register('synthetic-token',{} as never,'refresh_token');
 assert.match(queries[0],/approve_oauth_business_binding/);assert.match(queries[1],/register_oauth_business_token/);
});
