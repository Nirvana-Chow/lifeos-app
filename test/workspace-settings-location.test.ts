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
