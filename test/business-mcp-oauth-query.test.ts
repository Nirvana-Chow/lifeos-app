import test from 'node:test';import assert from 'node:assert/strict';
const config={resource:'https://lifeos.nirvanachow.com/api/platform/mcp',issuer:'https://lifeos.nirvanachow.com/api/platform/auth',grantId:'grant',scopes:['todo:read','offline_access']};
const query=new URLSearchParams({client_id:'https://client.example/meta',redirect_uri:'https://client.example/callback',resource:config.resource,scope:'todo:read offline_access',code_challenge_method:'S256',code_challenge:'x'.repeat(43),sig:'signature',exp:'2000000000'}).toString();
test('consent query requires the official verifier and exact resource/scope/PKCE before displaying any client',async()=>{
 const api=await import('../src/business-mcp-oauth/query.ts').catch(()=>null);assert.ok(api);
 assert.equal(await api.readSignedOAuthQuery(query,config,async()=>false),null);
 const result=await api.readSignedOAuthQuery(query,config,async()=>true);assert.ok(result);assert.equal(result.clientId,'https://client.example/meta');
 for(const value of [query+'&client_id=https://evil.example/meta',query+'&resource=https://evil.example',query.replace('S256','plain'),query.replace('todo%3Aread','auth%3Aread')])assert.equal(await api.readSignedOAuthQuery(value,config,async()=>true),null);
});
test('OAuth continuation only accepts provider-relative destinations or the signed exact callback with issuer',async()=>{
 const api=await import('../src/business-mcp-oauth/query.ts').catch(()=>null);assert.ok(api);
 assert.equal(api.validOAuthRedirect('https://evil.example/callback?code=x',query,config),false);
 assert.equal(api.validOAuthRedirect('https://client.example/other?code=x&iss='+encodeURIComponent(config.issuer),query,config),false);
 assert.equal(api.validOAuthRedirect('https://client.example/callback?code=x&iss='+encodeURIComponent(config.issuer),query,config),true);
 assert.equal(api.validOAuthRedirect('/personal/oauth?sig=new',query,config),true);
 assert.equal(api.validOAuthRedirect('/personal?next=https://evil.example',query,config),false);
});
