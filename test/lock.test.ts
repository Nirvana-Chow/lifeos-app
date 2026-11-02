import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync } from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
// Controlled lock-shape fixtures only, never dependency installs or deliverable locks.
const integrity='sha512-'+Buffer.alloc(64).toString('base64');
const manifest={dependencies:{a:'1.0.0',b:'1.0.0'},devDependencies:{}};
function pkg(name:string){return {version:'1.0.0',resolved:`https://registry.npmjs.org/${name}/-/${name}-1.0.0.tgz`,integrity};}
function check(lock:unknown){const dir=mkdtempSync(join(tmpdir(),'lifeos-lock-test-'));try{mkdirSync(join(dir,'scripts'));writeFileSync(join(dir,'scripts/dependency-lock.mjs'),readFileSync(new URL('../scripts/dependency-lock.mjs',import.meta.url)));writeFileSync(join(dir,'scripts/require-lock.mjs'),readFileSync(new URL('../scripts/require-lock.mjs',import.meta.url)));writeFileSync(join(dir,'package.json'),JSON.stringify(manifest));if(lock)writeFileSync(join(dir,'package-lock.json'),JSON.stringify(lock));return spawnSync(process.execPath,[join(dir,'scripts/require-lock.mjs')],{encoding:'utf8'}).status;}finally{rmSync(dir,{recursive:true,force:true});}}
function baseline(){return {lockfileVersion:3,packages:{'':{dependencies:{b:'1.0.0',a:'1.0.0'},devDependencies:{}},'node_modules/a':pkg('a'),'node_modules/b':pkg('b')}};}
test('lock gate accepts semantically identical root mappings regardless of key order',()=>assert.equal(check(baseline()),0));
test('lock gate rejects missing lock, malformed integrity and off-registry transitive source',()=>{assert.equal(check(null),1);const invalid=baseline();invalid.packages[''].dependencies=manifest.dependencies;invalid.packages['node_modules/a'].integrity='not-an-SRI-digest';assert.equal(check(invalid),1);const external=baseline();external.packages[''].dependencies=manifest.dependencies;(external.packages as any)['node_modules/nested']={...pkg('nested'),resolved:'https://evil.test/file.tgz'};assert.equal(check(external),1);});
test('lock gate rejects missing required transitive package even with matching direct pins',()=>{const incomplete=baseline();incomplete.packages[''].dependencies=manifest.dependencies;(incomplete.packages['node_modules/a'] as any).dependencies={missing:'^1.0.0'};assert.equal(check(incomplete),1);});
test('official bundled dependencies are covered only by their verified declaring parent tarball',()=>{const l=baseline() as any;l.packages['node_modules/a'].bundleDependencies=['inside'];l.packages['node_modules/a'].dependencies={inside:'1.0.0'};l.packages['node_modules/a/node_modules/inside']={version:'1.0.0',inBundle:true};assert.equal(check(l),0);delete l.packages['node_modules/a'].bundleDependencies;assert.equal(check(l),1);l.packages['node_modules/a'].bundleDependencies=['inside'];l.packages['node_modules/a/node_modules/inside'].resolved='https://evil.test/file.tgz';assert.equal(check(l),1);delete l.packages['node_modules/a/node_modules/inside'].resolved;l.packages['node_modules/a'].integrity='invalid';assert.equal(check(l),1);});
