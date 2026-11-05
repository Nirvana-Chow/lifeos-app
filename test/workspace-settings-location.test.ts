import test from 'node:test';
import assert from 'node:assert/strict';
import * as nav from '../src/workbench/private-navigation.ts';

test('finite settings location retains a canonical background and rejects arbitrary projections',()=>{
 const read=(nav as any).readWorkspaceLocation,href=(nav as any).workspaceLocationHref;
 assert.equal(typeof read,'function','finite workspace location parser is required');
 assert.deepEqual(read({page:'settings'}),{page:'overview',modal:'settings',panel:'general'});
 assert.deepEqual(read({page:'tasks',modal:'settings',panel:'api-keys'}),{page:'tasks',modal:'settings',panel:'api-keys'});
 assert.deepEqual(read({page:'projects',modal:'settings',panel:'/account/password',returnTo:'https://untrusted.invalid'}),{page:'projects',modal:'settings',panel:'general'});
 assert.deepEqual(read({page:'constructor',modal:'constructor',panel:'api-keys'}),{page:'overview'});
 assert.equal(href(read({page:'tasks',modal:'settings',panel:'security'})),'/personal?page=tasks&modal=settings&panel=security');
 assert.equal(href(read({page:'settings'})),'/personal?modal=settings&panel=general');
 assert.equal(nav.workspaceHref('settings'),'/personal?modal=settings&panel=general');
});

test('all personal sidebar adapters use the matters label while canonical todo IDs stay stable',()=>{
 assert.equal(nav.privateNavigation.find(item=>item.id==='todos')?.title,'事项');
 assert.equal(nav.privateHrefs.todos,'/personal?page=tasks');
});

test('classification location accepts only a finite UUID and preserves the background',()=>{
 const id='11111111-1111-4111-8111-111111111111';
 const location=nav.readWorkspaceLocation({page:'tasks',modal:'classification',planId:id});
 assert.deepEqual(location,{page:'tasks',modal:'classification',planId:id});
 assert.equal(nav.workspaceLocationHref(location),'/personal?page=tasks&modal=classification&planId='+id);
 for(const planId of [undefined,['11111111-1111-4111-8111-111111111111'],'/login','https://example.org','not-a-uuid'])assert.deepEqual(nav.readWorkspaceLocation({page:'tasks',modal:'classification',planId}),{page:'tasks'});
});
