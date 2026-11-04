import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {collectBundle} from '../scripts/client-bundle-evidence.mjs';
const sha='a'.repeat(40);
function fixture(){const root=mkdtempSync(join(tmpdir(),'bundle-test-'));mkdirSync(join(root,'.next/static/chunks'),{recursive:true});writeFileSync(join(root,'.next/BUILD_ID'),'build-1\n');writeFileSync(join(root,'package-lock.json'),'abc');writeFileSync(join(root,'.image-source-proof.json'),JSON.stringify({sourceSha:sha,sourceTreeDigest:'b'.repeat(64),files:[{path:'package-lock.json',sha256:'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'}]}));writeFileSync(join(root,'.next/static/chunks/a.js'),'abc');writeFileSync(join(root,'.next/static/chunks/b.js'),'abc');writeFileSync(join(root,'.next/static/chunks/ignored.css'),'not js');return root;}
test('inventories only static JS paths, hashes, byte totals and deterministic gzip',()=>{const root=fixture();try{const data=collectBundle(root,sha);assert.equal(data.sourceSha,sha);assert.equal(data.buildId,'build-1');assert.equal(data.lockSha256,'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');assert.deepEqual(data.files.map((x:{path:string})=>x.path),['chunks/a.js','chunks/b.js']);assert.equal(data.files[0].sha256,createHash('sha256').update('abc').digest('hex'));assert.equal(data.files[0].bytes,3);assert.equal(data.files[0].gzipBytes,gzipSync('abc',{level:9}).length);assert.equal(data.totalBytes,6);assert.equal(data.totalGzipBytes,2*gzipSync('abc',{level:9}).length);}finally{rmSync(root,{recursive:true,force:true});}});
test('rejects mismatched source and static symlinks',()=>{const root=fixture();try{assert.throws(()=>collectBundle(root,'c'.repeat(40)));symlinkSync('/etc/passwd',join(root,'.next/static/chunks/link.js'));assert.throws(()=>collectBundle(root,sha));}finally{rmSync(root,{recursive:true,force:true});}});

test('rejects a lock that differs from the image source proof',()=>{const root=fixture();try{writeFileSync(join(root,'package-lock.json'),'changed');assert.throws(()=>collectBundle(root,sha));}finally{rmSync(root,{recursive:true,force:true});}});
