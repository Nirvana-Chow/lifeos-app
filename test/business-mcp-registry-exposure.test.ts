import test from 'node:test';
import assert from 'node:assert/strict';
import * as capabilities from '../src/agent-api/capabilities.ts';
import {isBusinessMcpOperation} from '../src/mcp-http/business-policy.ts';
import {isOAuthBusinessOperation} from '../src/business-mcp-oauth/boundary.ts';

type Candidate={id:string;module:string;method:string;path:string;policyClass?:string;requiredScopes:readonly string[];mcpExposure?:string};
function project(registry:readonly Candidate[],oauth=false):readonly Candidate[]{
 const fn=(capabilities as unknown as {projectMcpBusinessOperations?:unknown}).projectMcpBusinessOperations;
 assert.equal(typeof fn,'function','MCP must project the source API registry rather than maintain a duplicate ID list');
 return (fn as (registry:readonly Candidate[],oauth:boolean)=>readonly Candidate[])(registry,oauth);
}
test('new reviewed business source operations project automatically without a second ID inventory',()=>{
 const future={id:'getFuturePersonalRecord',module:'futureRecord',method:'GET',path:'/v1/future-records/{id}',policyClass:'personal-business-data',requiredScopes:['future-record:read'],mcpExposure:'business-json'};
 assert.deepEqual(project([future]).map(op=>op.id),['getFuturePersonalRecord']);
 assert.deepEqual(project([future],true).map(op=>op.id),['getFuturePersonalRecord']);
 assert.equal(Object.hasOwn(project([future])[0],'mcpExposure'),false,'Implementation metadata stays out of wire contracts');
});
test('a shared ordinary scope or policy class never exposes unreviewed, engineering or protected operations',()=>{
 const base={module:'requirements',method:'PATCH',path:'/v1/requirements/{id}',policyClass:'personal-business-data',requiredScopes:['requirements:read','requirements:write']};
 assert.deepEqual(project([{...base,id:'unknown'},{...base,id:'claim',mcpExposure:'engineering'},{...base,id:'commit',mcpExposure:'owner-review'},{...base,id:'unknown-mode',mcpExposure:'unreviewed'}]),[]);
 assert.deepEqual(project([{...base,id:'wrong-class',policyClass:'account-security',mcpExposure:'business-json'}]),[]);
});
test('dedicated file JSON and native byte/ack operations retain distinct exposure',()=>{
 assert.equal(isBusinessMcpOperation('stageFileHandoff'),true);assert.equal(isBusinessMcpOperation('getFileHandoff'),true);
 assert.equal(isBusinessMcpOperation('downloadFileHandoff'),false);assert.equal(isBusinessMcpOperation('acknowledgeFileHandoff'),false);
 const base={module:'fileHandoff',method:'GET',path:'/v1/file-handoffs/{id}',policyClass:'explicit-file-handoff',requiredScopes:['file-handoff:read']};
 assert.equal(project([{...base,id:'synthetic-file-json',mcpExposure:'explicit-file'}]).length,1);
 assert.deepEqual(project([{...base,id:'synthetic-native-file',mcpExposure:'native'}]),[]);
 assert.deepEqual(project([{...base,id:'wrong-business-annotation',mcpExposure:'business-json'}]),[]);
});
test('preview remains an explicit unfinished OAuth provenance path, not silently classified as nonbusiness',()=>{
 assert.equal(isBusinessMcpOperation('previewTodoClassification'),true);assert.equal(isOAuthBusinessOperation('previewTodoClassification'),false);
 assert.equal(isOAuthBusinessOperation('previewTodoClassification',true),true);assert.equal(isOAuthBusinessOperation('commitTodoClassification',true),false);
 const preview={id:'synthetic-preview',module:'classification',method:'POST',path:'/v1/preview',policyClass:'personal-business-data',requiredScopes:['todo:read'],mcpExposure:'business-preview'};
 assert.equal(project([preview]).length,1);assert.deepEqual(project([preview],true),[]);
});
test('registry annotations do not alter existing Agent API or SDK wire definitions',()=>{
 const registry=(capabilities as unknown as {agentOperationRegistry?:readonly Candidate[]}).agentOperationRegistry;
 assert.ok(registry);assert.equal(registry.length,68);
 for(const operation of capabilities.agentOperations)assert.equal(Object.hasOwn(operation,'mcpExposure'),false);
 assert.deepEqual(project(registry).map(op=>op.id),capabilities.agentOperations.filter(op=>isBusinessMcpOperation(op.id)).map(op=>op.id));
 assert.deepEqual(project(registry,true).map(op=>op.id),capabilities.agentOperations.filter(op=>isOAuthBusinessOperation(op.id)).map(op=>op.id));
});
