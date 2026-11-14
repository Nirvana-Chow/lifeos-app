import test from 'node:test';
import assert from 'node:assert/strict';
import {agentOperations} from '../src/agent-api/capabilities.ts';
import {isOAuthBusinessOperation} from '../src/business-mcp-oauth/boundary.ts';
import {verifyBusinessOAuthPool} from '../src/business-mcp-oauth/readiness.ts';
const owner={ownerId:'synthetic-owner',spaceId:'synthetic-space',ownerEmail:'synthetic@example.test'};
const config={resource:'https://lifeos.nirvanachow.com/api/platform/mcp',issuer:'https://lifeos.nirvanachow.com/api/platform/auth',grantId:'synthetic-policy-grant',scopes:['personal-business:all','offline_access']};
// Unit query boundary, not a database fixture. Actual SQL/role/body checks need PG.
function pool(scopes:readonly string[],policy:Record<string,unknown>){
 let policyReads=0;
 const old={role:true,restricted:true,functions_safe:true,private_ledger:true,provider_tables:true,statement_gates:true,invalidation:true,code_guard:true,security_reset:true,version:true};
 const activation={enabled:true,...owner,grantId:config.grantId,resource:config.resource,issuer:config.issuer,scopes,operations:Object.fromEntries(agentOperations.filter(op=>isOAuthBusinessOperation(op.id)&&op.module!=='fileHandoff').map(op=>[op.id,[...op.requiredScopes]]))};
 return{connection:{connect:async()=>({query:async(sql:string)=>{
  if(sql.includes('oauth_policy_')){policyReads++;return{rows:[policy],rowCount:1};}
  return{rows:sql.includes(' AS value')?[{value:activation}]:[old],rowCount:1};
 },release(){}})},policyReads:()=>policyReads};
}
test('full-policy OAuth refuses an otherwise ready original0021 schema',async()=>{
 const port=pool(config.scopes,{role:true,restricted:true,functions_safe:false,version:false,current:false});
 await assert.rejects(verifyBusinessOAuthPool(port.connection,config,owner),/BUSINESS_MCP_POLICY_SCHEMA_UNAVAILABLE/);
});
test('old narrow consent remains usable without the new policy migration',async()=>{
 const scopes=['journal:read'],port=pool(scopes,{});await verifyBusinessOAuthPool(port.connection,{...config,scopes},owner);
 assert.equal(port.policyReads(),0);
});
test('full policy needs every explicit new readiness result, not an empty positive row',async()=>{
 for(const row of [{},{role:true,restricted:true,functions_safe:true,producer_safe:true,version:true,current:false},{role:false,restricted:true,functions_safe:true,producer_safe:true,version:true,current:true}]){
  await assert.rejects(verifyBusinessOAuthPool(pool(config.scopes,row).connection,config,owner),/BUSINESS_MCP_POLICY_SCHEMA_UNAVAILABLE/);
 }
 const port=pool(config.scopes,{role:true,restricted:true,functions_safe:true,producer_safe:true,version:true,current:true});
 await verifyBusinessOAuthPool(port.connection,config,owner);assert.equal(port.policyReads(),1);
});
