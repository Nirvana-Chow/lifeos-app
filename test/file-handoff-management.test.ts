import test from 'node:test';import assert from 'node:assert/strict';
import {createKeyIssuer} from '../src/agent-api/key-issuer.ts';import {createKeyManagementHandler} from '../src/agent-api/key-web.ts';
const input={id:'synthetic-key',version:'file-handoff-v1',expectedGrantDigest:'a'.repeat(64),expectedFileRevision:0,scopes:['file-handoff:read','file-handoff:write'],consumer:'codex'};
test('file permissions require current owner MFA and a separate explicit versioned CAS command',async()=>{
 let writes=0;
 const deps={authenticate:async(cookie:string)=>cookie==='synthetic-owner-cookie',list:async()=>({keys:[]}),issue:async()=>{throw Error('not used');},revoke:async()=>false,fileHandoffAvailable:async()=>true,setFileHandoff:async(value:unknown)=>{writes++;assert.deepEqual(value,input);return{id:'synthetic-key',name:'Synthetic original key',scopes:['todo:read'] as const,status:'active' as const,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString()};}};
 const issuer=createKeyIssuer(deps);
 assert.equal((await issuer('setFileHandoff' as never,'ordinary-business-key',input)).status,401);
 assert.equal((await issuer('setFileHandoff' as never,'synthetic-owner-cookie',{...input,version:'future'})).status,400);assert.equal(writes,0);
 const result=await issuer('setFileHandoff' as never,'synthetic-owner-cookie',input);assert.equal(result.status,200);assert.equal(writes,1);assert.deepEqual((result.body as any).grant.scopes,['todo:read']);
});
test('the original owner management HTTP boundary refuses a bearer or cross-origin file privilege change',async()=>{
 let calls=0;const origin='https://synthetic.example.test',path=origin+'/api/platform/account/api-keys/synthetic-key/file-handoff';
 const handler=createKeyManagementHandler(origin,async(operation,cookie,value)=>{calls++;assert.equal(operation,'setFileHandoff');assert.equal(cookie,'synthetic-owner-cookie');assert.deepEqual(value,input);return Response.json({grant:{id:'synthetic-key'}});});
 const{id:_,...body}=input;
 const request=(headers:Record<string,string>)=>new Request(path,{method:'PATCH',headers:{host:'synthetic.example.test',origin,'content-type':'application/json',cookie:'synthetic-owner-cookie',...headers},body:JSON.stringify(body)});
 assert.equal((await handler(request({authorization:'Bearer synthetic-business-key'}))).status,401);assert.equal((await handler(request({origin:'https://foreign.example.test'}))).status,403);assert.equal(calls,0);
 assert.equal((await handler(request({}))).status,200);assert.equal(calls,1);
});
