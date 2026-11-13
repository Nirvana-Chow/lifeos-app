import test from 'node:test';import assert from 'node:assert/strict';import {sha256} from '../src/file-handoff/contracts.ts';
test('the adopted native file transport retains the credential in its closure and rejects paths, rotation and redirects',async()=>{
 const module=await import('../src/file-handoff/native-transport.ts').catch(()=>null);assert.ok(module);
 const key='synthetic-private-closure-key',id='00000000-0000-4000-8000-000000000001';let reads=0,calls=0,redirect=false;
 const transport=module.createFileNativeTransport({credentialProvider:async()=>{reads++;return key;},credentialFingerprint:sha256(key)},async(input,init)=>{calls++;assert.equal(new URL(String(input)).origin,'https://lifeos.nirvanachow.com');assert.equal((init!.headers as Record<string,string>).authorization,'Bearer '+key);assert.equal(init!.redirect,'manual');assert.equal(init!.credentials,'omit');return redirect?new Response('',{status:302,headers:{location:'https://foreign.invalid'}}):Response.json({entry:{id}});});
 await assert.rejects(transport.nativeBinaryRequest('/v1/file-handoffs/../account/keys/content'));assert.equal(reads,0);
 await transport.nativeRequest('/v1/file-handoffs/'+id,'GET');assert.equal(calls,1);
 redirect=true;await assert.rejects(transport.nativeBinaryRequest('/v1/file-handoffs/'+id+'/content'));assert.equal(calls,2);
 const rotated=module.createFileNativeTransport({credentialProvider:async()=> 'different-private-key',credentialFingerprint:sha256(key)},async()=>{calls++;return Response.json({});});
 await assert.rejects(rotated.nativeBinaryRequest('/v1/file-handoffs/'+id+'/content'));assert.equal(calls,2);
});
