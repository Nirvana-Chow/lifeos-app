import test from 'node:test';
import assert from 'node:assert/strict';
import {ownerModules,readReleaseNotice} from '../src/ui-review/owner-modules.ts';
const scope=JSON.stringify(['owner-a','space-a']);
const status={scope:'personal-manual-candidate',ownerId:'owner-a',spaceId:'space-a',storageVerified:true,calendarEnabled:true,requirementsEnabled:true,requirementSupportEnabled:true,writable:true};
test('owner module links require verified status, exact available flags and the current owner scope',()=>{
 assert.deepEqual(ownerModules(null,scope),[]);
 assert.deepEqual(ownerModules({...status,storageVerified:false},scope),[]);
 assert.deepEqual(ownerModules({...status,ownerId:'owner-b'},scope),[]);
 assert.deepEqual(ownerModules({...status,calendarEnabled:false,requirementSupportEnabled:false},scope).map(x=>x.id),['cooking']);
 assert.deepEqual(ownerModules({...status,requirementsEnabled:false},scope).map(x=>x.id),['cooking','calendar']);
 assert.deepEqual(ownerModules(status,scope).map(x=>x.href),['/personal/cooking','/personal/schedule','/personal/requirements/roadmap','/personal/requirements/feedback','/personal/requirements/updates']);
});
const sha='a'.repeat(40),other='b'.repeat(40),record={id:'synthetic',sourceSha:sha,sourceURL:'https://github.com/Nirvana-Chow/lifeos-app/commit/'+sha,title:'Synthetic source note',changes:['Verified change'],requirementIds:['LO-VERSION-001'],runningExactSource:true};
const notes={scope:'public-source-records',current:{sourceSha:sha,sourceTreeDigest:'c'.repeat(64),buildId:'synthetic-build'},records:[record,{...record,id:'other',sourceSha:other,sourceURL:'https://github.com/Nirvana-Chow/lifeos-app/commit/'+other,runningExactSource:false}],ownerAccepted:false,visualQualification:'not-attested',preferencesEnabled:true,readState:{sourceSha:sha,seen:false,id:null,revision:null}};
test('release notice uses only an actual unread running source and never announces historical notes as deployed',()=>{
 assert.deepEqual(readReleaseNotice(notes)?.records.map(x=>x.id),['synthetic']);
 for(const value of [{...notes,current:null,readState:null},{...notes,preferencesEnabled:false},{...notes,readState:{...notes.readState,seen:true}},{...notes,readState:{...notes.readState,sourceSha:other}},{...notes,ownerAccepted:true}])assert.equal(readReleaseNotice(value),null);
 assert.equal(readReleaseNotice({...notes,records:notes.records.slice(1)})?.records.length,0);
 assert.equal(readReleaseNotice({...notes,records:[{...record,sourceURL:'https://example.invalid/'}]}),null);
});

test('new business links appear only for the exact verified module flags',()=>{
 const flags={mediaEnabled:true,careerEnabled:true,portfolioEnabled:true};
 const expected=['/personal/cooking','/personal/media','/personal/career','/personal/portfolio'];
 assert.deepEqual(ownerModules({...status,calendarEnabled:false,requirementsEnabled:false,...flags},scope).map(row=>row.href),expected);
 assert.deepEqual(ownerModules({...status,storageVerified:false,...flags},scope),[]);
 for(const key of Object.keys(flags))assert.equal(ownerModules({...status,[key]:false},scope).some(row=>expected.slice(1).includes(row.href)),false);
});

test('owner search link requires verified scope and an advertised readable owner record type',()=>{
 const enabled={...status,allowedTypes:['todo','journal']};
 assert.deepEqual(ownerModules(enabled,scope).find(link=>link.id==='search'),{id:'search',label:'搜索本人记录',href:'/personal/search'});
 for(const value of [status,{...enabled,storageVerified:false},{...enabled,allowedTypes:[]},{...enabled,allowedTypes:['unknown']},{...enabled,ownerId:'owner-b'}])assert.equal(ownerModules(value,scope).some(link=>link.id==='search'),false);
});
