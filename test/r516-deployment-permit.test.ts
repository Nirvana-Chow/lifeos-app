import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,chmodSync,symlinkSync,unlinkSync,rmSync,existsSync,realpathSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readWritePermit,assertWritePermit,activateWritePermit,revokeWritePermit} from '../src/deployment-candidate/write-permit.ts';

const binding={sourceSha:'a'.repeat(40),spaceId:'synthetic-space',configDigest:'b'.repeat(64)};
const now=new Date('2026-10-24T09:00:00Z');
function fixture(t:TestContext){const directory=mkdtempSync(join(realpathSync(tmpdir()),'r516-permit-'));chmodSync(directory,0o700);t.after(()=>rmSync(directory,{recursive:true,force:true}));return{directory,path:join(directory,'permit.json')};}
const document=()=>({version:1,...binding,activatedAt:now.toISOString(),expiresAt:'2026-10-24T09:05:00.000Z'});

test('request-time permit reload denies missing, revoked, expired and mismatched bindings',t=>{
 const {path}=fixture(t);assert.equal(readWritePermit(undefined,binding,now),false);assert.equal(readWritePermit(path,binding,now),false);
 writeFileSync(path,JSON.stringify(document()),{mode:0o600});assert.equal(readWritePermit(path,binding,now),true);
 for(const field of ['sourceSha','spaceId','configDigest'] as const)assert.equal(readWritePermit(path,{...binding,[field]:field==='spaceId'?'other':'c'.repeat(field==='sourceSha'?40:64)},now),false);
 assert.equal(readWritePermit(path,binding,new Date('2026-10-24T09:05:00Z')),false);
 writeFileSync(path,'{invalid');assert.equal(readWritePermit(path,binding,now),false);
 unlinkSync(path);assert.throws(()=>assertWritePermit(path,binding,now),{message:'WRITE_PERMIT_CLOSED'});
});
test('unsafe modes, symlinks, unknown fields and stale or future activation never grant writes',t=>{
 const {path,directory}=fixture(t);writeFileSync(path,JSON.stringify(document()),{mode:0o600});
 chmodSync(path,0o644);assert.equal(readWritePermit(path,binding,now),false);chmodSync(path,0o600);
 chmodSync(directory,0o777);assert.equal(readWritePermit(path,binding,now),false);chmodSync(directory,0o700);
 const target=join(directory,'target');writeFileSync(target,JSON.stringify(document()),{mode:0o600});unlinkSync(path);symlinkSync(target,path);assert.equal(readWritePermit(path,binding,now),false);unlinkSync(path);
 for(const extra of [{unknown:true},{activatedAt:'2026-10-24T09:01:00Z'},{expiresAt:'2026-10-25T09:00:00Z'},{version:2}]){writeFileSync(path,JSON.stringify({...document(),...extra}),{mode:0o600});assert.equal(readWritePermit(path,binding,now),false);}
 const alias=directory+'-alias';symlinkSync(directory,alias);t.after(()=>unlinkSync(alias));assert.equal(readWritePermit(join(alias,'permit.json'),binding,now),false);
 mkdirSync(join(directory,'nested'),{mode:0o700});writeFileSync(join(directory,'nested','permit.json'),JSON.stringify(document()),{mode:0o600});assert.equal(readWritePermit(join(directory,'nested','permit.json'),binding,now),true);assert.equal(readWritePermit(join(alias,'nested','permit.json'),binding,now),false);
});
test('activation atomically grants only after read-only health and final binding recheck; revocation reloads',async t=>{
 const {path}=fixture(t),events:string[]=[];
 await activateWritePermit(path,binding,{targetReadOnlyHealthy:async()=>{events.push('health');assert.equal(existsSync(path),false);return true;},recheck:async()=>{events.push('recheck');assert.equal(existsSync(path),false);return true;}},now);
 assert.deepEqual(events,['health','recheck']);assert.equal(readWritePermit(path,binding,now),true);assert.equal(JSON.parse(readFileSync(path,'utf8')).sourceSha,binding.sourceSha);
 revokeWritePermit(path);assert.equal(readWritePermit(path,binding,now),false);
 for(const stage of ['health','recheck']){await assert.rejects(activateWritePermit(path,binding,{targetReadOnlyHealthy:async()=>stage!=='health',recheck:async()=>false},now));assert.equal(existsSync(path),false);}
});
