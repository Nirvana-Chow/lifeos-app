import assert from 'node:assert/strict';
import test from 'node:test';

test('bearer boundary preserves API key limit and only admits a bounded compact JWT',async()=>{
 const api=await import('../src/business-mcp-oauth/boundary.ts').catch(()=>null);assert.ok(api,'OAuth boundary is implemented');
 assert.equal(api.readBusinessBearer('Bearer abc_def-123'),'abc_def-123');
 assert.equal(api.readBusinessBearer('Bearer '+ 'x'.repeat(257)),null);
 assert.equal(api.readBusinessBearer('Bearer abc.def.ghi'),'abc.def.ghi');
 for(const value of ['Bearer a..b','Bearer a.b.c.d','Bearer a.b.c=','Bearer a.b.☃','Bearer '+ 'a'.repeat(8192)+'.b.c'])assert.equal(api.readBusinessBearer(value),null);
});

test('OAuth activation is closed and fixed to the canonical resource, grant ID and approved scopes',async()=>{
 const api=await import('../src/business-mcp-oauth/boundary.ts').catch(()=>null);assert.ok(api);
 assert.equal(api.readBusinessOAuthConfig({},'https://lifeos.nirvanachow.com'),null);
 const env={LIFEOS_BUSINESS_MCP_OAUTH:'business-mcp-oauth-v1',LIFEOS_BUSINESS_MCP_GRANT_ID:'reviewed-grant',LIFEOS_BUSINESS_MCP_SCOPES:'todo:read todo:write offline_access'};
 assert.deepEqual(api.readBusinessOAuthConfig(env,'https://lifeos.nirvanachow.com'),{resource:'https://lifeos.nirvanachow.com/api/platform/mcp',issuer:'https://lifeos.nirvanachow.com/api/platform/auth',grantId:'reviewed-grant',scopes:['todo:read','todo:write','offline_access']});
 assert.throws(()=>api.readBusinessOAuthConfig(env,'https://attacker.example'));
 assert.throws(()=>api.readBusinessOAuthConfig({...env,LIFEOS_BUSINESS_MCP_SCOPES:'todo:write'},'https://lifeos.nirvanachow.com'));
 assert.throws(()=>api.readBusinessOAuthConfig({...env,LIFEOS_BUSINESS_MCP_SCOPES:'auth:read'},'https://lifeos.nirvanachow.com'));
});
