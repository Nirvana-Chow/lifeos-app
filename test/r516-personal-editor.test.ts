import test from 'node:test';import assert from 'node:assert/strict';
import {editorFromCommand,editorFromEntry} from '../src/personal-candidate/editor.ts';
import {makePersonalCommand} from '../src/personal-candidate/client.ts';
import type {PublicEntry} from '../src/platform/contracts.ts';
const binding={ownerId:'personal-review-user',spaceId:'personal-review-space'};
const command=makePersonalCommand(binding,'journal',null,{title:'Synthetic diary',text:'Synthetic body',occurredOn:null},'synthetic-editor-key',true);
const entry:PublicEntry={id:'11111111-1111-4111-8111-111111111111',kind:'inbox',draft:{title:'Synthetic diary',text:'Synthetic body',occurredOn:null,disposition:'reference'},source:{id:'22222222-2222-4222-8222-222222222222',system:'website',externalId:'11111111-1111-4111-8111-111111111111',version:1,asOf:'2026-10-24T00:00:00.000Z',original:{marker:'personal-manual-v1',spaceId:binding.spaceId,type:'journal',input:command.body}},revision:2,createdAt:'2026-10-24T00:00:00.000Z',updatedAt:'2026-10-24T00:01:00.000Z',syncState:'draft',externalStatus:null};
test('uncertain journal recovery hydrates correct editor type and original fields',()=>{const editor=editorFromCommand(command);assert.equal(editor.type,'journal');assert.deepEqual(editor.fields,{title:'Synthetic diary',text:'Synthetic body',date:'',status:'open'});});
test('saved journal projection keeps journal route and resets stale displayed history',()=>{const editor=editorFromEntry(entry,binding.spaceId);assert.equal(editor.type,'journal');assert.equal(editor.fields.text,'Synthetic body');assert.deepEqual(editor.history,[]);assert.throws(()=>editorFromEntry(entry,'foreign-space'));});
