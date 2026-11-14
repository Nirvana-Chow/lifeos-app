import test from 'node:test';import assert from 'node:assert/strict';
test('an unknown owner permission change stays unknown until a monotonic current read resolves its CAS window',async()=>{
 const api=await import('../src/file-handoff/permission-client.ts').catch(()=>null);assert.ok(api);
 const pending={id:'synthetic-key',version:'file-handoff-v1',expectedGrantDigest:'a'.repeat(64),expectedFileRevision:0,scopes:['file-handoff:read'],consumer:null};
 const grant={id:'synthetic-key',grantDigest:'a'.repeat(64),status:'active'};
 assert.equal(api.permissionReadback(pending,grant),'unknown');
 const fileHandoff={version:'file-handoff-v1',revision:1,digest:'b'.repeat(64),scopes:['file-handoff:read'],consumer:null};
 assert.equal(api.permissionReadback(pending,{...grant,fileHandoff}),'observed');
 assert.equal(api.permissionReadback(pending,{...grant,fileHandoff:{...fileHandoff,revision:2}}),'conflict');
 assert.equal(api.permissionReadback(pending,{...grant,status:'revoked'}),'stopped');
 assert.equal(api.permissionReadback({...pending,expectedFileRevision:1},{...grant,fileHandoff}),'observed','an already matching no-op permission is the current effective state');
});
