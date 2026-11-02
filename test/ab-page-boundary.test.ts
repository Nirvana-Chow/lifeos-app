import test from 'node:test';
import assert from 'node:assert/strict';
import {pageAccess} from '../src/platform/page-access.ts';
test('private pages reject missing and foreign owner sessions; legacy login has a public destination',async()=>{
 const owner={userId:'owner',email:'owner@example.test'};
 assert.equal(await pageAccess('/review/admin',async()=>null),'/login');
 assert.equal(await pageAccess('/review/v5/articles/private',async()=>null),'/login');
 assert.equal(await pageAccess('/articles/private',async()=>null),'/login');
 assert.equal(await pageAccess('/candidate',async()=>null),'/login');
 assert.equal(await pageAccess('/review/admin',async()=>owner),null);
 assert.equal(await pageAccess('/review/admin/login',async()=>{throw Error('must not read');}),'/login');
 assert.equal(await pageAccess('/review/admin',async()=>{throw Error('DB unavailable');}),'/login');
});
test('canonical login preserves explicitly configured fixture mode and keeps absent or unapproved identities closed',async()=>{
 const {loginCapability}=await import('../src/platform/page-access.ts');
 assert.deepEqual(loginCapability(null,false,false),{mode:'closed',enabled:false});
 const fixture={baseURL:'http://127.0.0.1:3317',ownerId:'fixture-owner-a',ownerEmail:'fixture@example.invalid'};
 assert.deepEqual(loginCapability(fixture,false,false),{mode:'synthetic',enabled:true});
 assert.deepEqual(loginCapability({...fixture,ownerId:'real-owner'},false,false),{mode:'closed',enabled:false});
 assert.deepEqual(loginCapability({...fixture,baseURL:'https://personal.example.invalid'},true,true),{mode:'personal',enabled:true});
 assert.deepEqual(loginCapability({...fixture,baseURL:'https://personal.example.invalid'},true,false),{mode:'personal',enabled:false});
});
