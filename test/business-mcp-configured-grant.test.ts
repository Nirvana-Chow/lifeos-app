import test from 'node:test';
import assert from 'node:assert/strict';
import {configuredOAuthGrantAvailable} from '../src/business-mcp-oauth/boundary.ts';
const owner={ownerId:'synthetic-owner',spaceId:'synthetic-space'};
const config={resource:'https://lifeos.nirvanachow.com/api/platform/mcp',issuer:'https://lifeos.nirvanachow.com/api/platform/auth',grantId:'synthetic-grant',scopes:['personal-business:all','offline_access']};
const full={...owner,grantId:config.grantId,businessDataPolicy:'all-personal-business-v1',scopes:['journal:read'],allowedOperationIds:['getJournal']};
test('full configured OAuth scope checks original policy and enabled operations rather than a literal marker in grant scopes',()=>{
 assert.equal(configuredOAuthGrantAvailable(config,full,owner),true);
 for(const grant of [null,{...full,businessDataPolicy:undefined},{...full,businessDataPolicy:'unknown'},{...full,allowedOperationIds:[]},{...full,allowedOperationIds:['claimRequirementExecution']}])assert.equal(configuredOAuthGrantAvailable(config,grant,owner),false);
});
test('configured authority is tied to the selected same original grant and owner-space',()=>{
 for(const grant of [{...full,grantId:'another'},{...full,ownerId:'another'},{...full,spaceId:'another'}])assert.equal(configuredOAuthGrantAvailable(config,grant,owner),false);
});
test('narrow configuration remains a scope subset without granting a full policy',()=>{
 const narrow={...full,businessDataPolicy:undefined,scopes:['todo:read'],allowedOperationIds:['getTodo']};
 assert.equal(configuredOAuthGrantAvailable({...config,scopes:['todo:read']},narrow,owner),true);
 assert.equal(configuredOAuthGrantAvailable({...config,scopes:['todo:read','todo:write']},narrow,owner),false);
});
test('configuring independent file access requires actual matching file proof and available file operations',()=>{
 const scopes=[...config.scopes,'file-handoff:read'],configured={...config,scopes};
 assert.equal(configuredOAuthGrantAvailable(configured,full,owner),false);
 const file={...full,scopes:[...full.scopes,'file-handoff:read'],allowedOperationIds:[...full.allowedOperationIds,'getFileHandoff'],fileHandoff:{version:'file-handoff-v1',revision:1,digest:'b'.repeat(64),scopes:['file-handoff:read'],consumer:null}};
 assert.equal(configuredOAuthGrantAvailable(configured,file,owner),true);
 assert.equal(configuredOAuthGrantAvailable({...configured,scopes:[...scopes,'file-handoff:write']},file,owner),false);
});
