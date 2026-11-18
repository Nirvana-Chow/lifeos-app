import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {readPolicyFixtureSourcePins} from './helpers/business-mcp-policy-stage-pg.ts';

const originalLock='720bcc1103fdd7ef7f671612ef078ef6d74924724828dc09ce0072aa2b4b7909';
const patchedLock='a2397f23359e353dd011da547459b9b28accc4fb673fbdff0ea3e3fe1ef070a9';
const target='58dc2f6659154ac33c3c86b7ac320834045c1344';
const digest=(raw:Buffer)=>createHash('sha256').update(raw).digest('hex');
function manifest(lockSha256:string,sourceSha=target){
 return Buffer.from(JSON.stringify({sourceSha,lockSha256,files:{'package-lock.json':lockSha256,'package.json':'b'.repeat(64)}}));
}

test('the original full-policy fixture still accepts its reviewed historical lock',()=>{
 const sourceSha='68d4c7572f12baa1f4304db3aa792cfeb5119884';
 const raw=manifest(originalLock,sourceSha);
 assert.equal(readPolicyFixtureSourcePins(raw,originalLock).sourceSha,sourceSha);
 assert.throws(()=>readPolicyFixtureSourcePins(raw,originalLock,'f'.repeat(64)),/pinned full source inventory/);
});

test('the patched fixture accepts a matching reviewed source inventory and on-disk lock',()=>{
 const raw=manifest(patchedLock);
 assert.equal(readPolicyFixtureSourcePins(raw,patchedLock,digest(raw)).sourceSha,target);
 assert.throws(()=>readPolicyFixtureSourcePins(raw,originalLock,digest(raw)));
 assert.throws(()=>readPolicyFixtureSourcePins(raw,patchedLock),/pinned full source inventory/);
});

test('the reviewed inventory binds the target and each archived file before the new lock is used',()=>{
 const original=manifest(patchedLock);
 const expected=digest(original);
 const otherTarget=manifest(patchedLock,'1'.repeat(40));
 const otherFile=Buffer.from(original.toString().replace('b'.repeat(64),'c'.repeat(64)));
 assert.throws(()=>readPolicyFixtureSourcePins(otherTarget,patchedLock,expected),/pinned full source inventory/);
 assert.throws(()=>readPolicyFixtureSourcePins(otherFile,patchedLock,expected),/pinned full source inventory/);
});

test('a matched inventory digest cannot admit an unknown lock or disconnect the actual lock from its file entry',()=>{
 const unknown='d'.repeat(64);
 const raw=manifest(unknown);
 assert.throws(()=>readPolicyFixtureSourcePins(raw,unknown,digest(raw)),/Unreviewed full-policy fixture lock/);
 const inconsistent=Buffer.from(JSON.stringify({sourceSha:target,lockSha256:patchedLock,files:{'package-lock.json':unknown}}));
 assert.throws(()=>readPolicyFixtureSourcePins(inconsistent,patchedLock,digest(inconsistent)));
});
