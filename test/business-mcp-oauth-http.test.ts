import assert from 'node:assert/strict';import test from 'node:test';
const origin='https://lifeos.nirvanachow.com',config={resource:origin+'/api/platform/mcp',issuer:origin+'/api/platform/auth',grantId:'reviewed-grant',scopes:['todo:read','offline_access']};
const claims={iss:config.issuer,aud:config.resource,sub:'owner',azp:'https://client.example/meta',client_id:'https://client.example/meta',sid:'session',iat:1800000000,exp:1800000300,scope:'todo:read offline_access'};
const request=(path:string,body:unknown,originHeader=origin)=>new Request(origin+'/api/platform/auth/'+path,{method:'POST',headers:{host:'lifeos.nirvanachow.com',origin:originHeader,'content-type':'application/json'},body:JSON.stringify(body)});
test('OAuth owner endpoints require current MFA and same-origin JSON before official dispatch',async()=>{
 const api=await import('../src/business-mcp-oauth/http.ts').catch(()=>null);assert.ok(api);
 let ready=false,calls=0;const handler=api.createBusinessOAuthHttp({origin,config,assertReady:async()=>{},owner:async()=>ready?{sessionRef:'session'}:null,handler:async()=>{calls++;return Response.json({redirect:true,url:'/personal/oauth'});},verifyToken:async()=>claims,ledger:{register:async()=>null,approve:async()=>{},revoke:async()=>{}}});
 assert.equal((await handler(request('oauth2/consent',{accept:true,oauth_query:'signed'}))).status,401);
 ready=true;assert.equal((await handler(request('oauth2/continue',{postLogin:true,oauth_query:'signed'},'https://evil.example'))).status,403);
 assert.equal((await handler(request('oauth2/register',{}))).status,404);assert.equal(calls,0);
});
test('a provider-issued token is withheld if ledger registration fails; consumed codes are never silently retried',async()=>{
 const api=await import('../src/business-mcp-oauth/http.ts').catch(()=>null);assert.ok(api);
 let calls=0;const handler=api.createBusinessOAuthHttp({origin,config,assertReady:async()=>{},owner:async()=>null,handler:async()=>{calls++;return Response.json({access_token:'signed.jwt.token',token_type:'Bearer',expires_in:300});},verifyToken:async()=>claims,ledger:{register:async()=>{throw Error('revoked');},approve:async()=>{},revoke:async()=>{}}});
 const form=new URLSearchParams({grant_type:'authorization_code',client_id:claims.azp,code:'synthetic-code',code_verifier:'x'.repeat(43),resource:config.resource});
 const result=await handler(new Request(config.issuer+'/oauth2/token',{method:'POST',headers:{host:'lifeos.nirvanachow.com','content-type':'application/x-www-form-urlencoded'},body:form}));
 assert.equal(result.status,503);assert.equal((await result.text()).includes('signed.jwt.token'),false);assert.equal(calls,1);
});

test('metadata advertises only the implemented client authentication and HEAD stays body-free',async()=>{
 const api=await import('../src/business-mcp-oauth/http.ts');
 const handler=api.createBusinessOAuthHttp({origin,config,assertReady:async()=>{},owner:async()=>null,handler:async request=>request.method==='HEAD'?new Response(null):Response.json({issuer:config.issuer,token_endpoint:config.issuer+'/oauth2/token',code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none','private_key_jwt','client_secret_basic'],introspection_endpoint:config.issuer+'/oauth2/introspect'}),verifyToken:async()=>null,ledger:{register:async()=>null,approve:async()=>{},revoke:async()=>{}}});
 const headers={host:'lifeos.nirvanachow.com'};
 const value=await(await handler(new Request(origin+'/.well-known/oauth-authorization-server/api/platform/auth',{headers}))).json();
 assert.deepEqual(value.token_endpoint_auth_methods_supported,['none','private_key_jwt']);assert.equal(value.introspection_endpoint,undefined);assert.equal(value.token_endpoint,config.issuer+'/oauth2/token');assert.deepEqual(value.code_challenge_methods_supported,['S256']);
 const head=await handler(new Request(origin+'/.well-known/oauth-protected-resource/api/platform/mcp',{method:'HEAD',headers}));assert.equal(head.status,200);assert.equal(await head.text(),'');
});

test('duplicate token form parameters are rejected as a request error before provider or ledger',async()=>{
 const api=await import('../src/business-mcp-oauth/http.ts');let dispatches=0;
 const handler=api.createBusinessOAuthHttp({origin,config,assertReady:async()=>{},owner:async()=>null,handler:async()=>{dispatches++;return new Response(null);},verifyToken:async()=>null,ledger:{register:async()=>null,approve:async()=>{},revoke:async()=>{}}});
 const result=await handler(new Request(config.issuer+'/oauth2/token',{method:'POST',headers:{host:'lifeos.nirvanachow.com','content-type':'application/x-www-form-urlencoded'},body:'client_id=one&client_id=two&grant_type=authorization_code'}));
 assert.equal(result.status,400);assert.equal(dispatches,0);
});
