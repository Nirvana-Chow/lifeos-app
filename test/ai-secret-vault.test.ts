import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,chmodSync,symlinkSync,rmSync} from 'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';
import{createAISecretVault,loadAISecretVault}from'../src/platform/ai-secret-vault.ts';
const master={keyId:'fixture-master',key:Buffer.alloc(32,7)},secret='fixture-provider-secret-never-a-real-key';
test('vault encrypts at rest, authenticates owner/provider and rejects tampering',()=>{
 const vault=createAISecretVault(master),a=vault.seal('fixture-owner-a','volcengine-ark',secret),b=vault.seal('fixture-owner-a','volcengine-ark',secret);
 assert.ok(!JSON.stringify(a).includes(secret));assert.notEqual(a.iv,b.iv);assert.equal(vault.open('fixture-owner-a','volcengine-ark',a),secret);
 assert.throws(()=>vault.open('fixture-owner-b','volcengine-ark',a));assert.throws(()=>vault.open('fixture-owner-a','other-provider',a));
 assert.throws(()=>vault.open('fixture-owner-a','volcengine-ark',{...a,ciphertext:Buffer.from('tampered').toString('base64')}));
 assert.throws(()=>createAISecretVault({keyId:'other-master',key:Buffer.alloc(32,8)}).open('fixture-owner-a','volcengine-ark',a));
});
test('master loader accepts only a canonical fixed synthetic key in an owner-only regular file',()=>{
 const dir=mkdtempSync(join(tmpdir(),'lifeos-ai-vault-fixture-'));try{
  const file=join(dir,'fixture.json'),link=join(dir,'link.json');writeFileSync(file,JSON.stringify({version:1,keyId:master.keyId,key:master.key.toString('base64')}),{mode:0o600});
  const vault=loadAISecretVault(file),sealed=vault.seal('fixture-owner-a','volcengine-ark',secret);assert.equal(vault.open('fixture-owner-a','volcengine-ark',sealed),secret);
  symlinkSync(file,link);assert.throws(()=>loadAISecretVault(link));chmodSync(file,0o644);assert.throws(()=>loadAISecretVault(file));
  chmodSync(file,0o600);writeFileSync(file,JSON.stringify({version:1,keyId:master.keyId,key:'not-base64'}));assert.throws(()=>loadAISecretVault(file));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
