import assert from 'node:assert/strict';
import test from 'node:test';
import {PlatformError} from '../src/platform/domain.ts';
import type {FieldObservations,JsonValue,NativeCapabilities,NativeIdentity,ScanCoverage} from '../src/apple-sync-candidate/contracts.ts';
import {mergeFields,isVerifiedEcho,checkWriteCapabilities,assessMissing} from '../src/apple-sync-candidate/reconcile.ts';

const known=(value:JsonValue)=>({kind:'known' as const,value});
const unavailable={kind:'unavailable' as const,reason:'not-exported'};
const capabilities:NativeCapabilities={protocolVersion:1,adapterId:'synthetic',adapterVersion:'1',platform:'synthetic',fullSnapshot:{reminder:true,event:true},writableFields:{reminder:['title','notes','due','alarms','status'],event:['title','status','cancelled','attendees','organizer','recurrence']},preserveUnchanged:true,scopes:['single','occurrence','future','series'],nativeEventCancellationWrite:false,invitationWrite:false};
const identity:NativeIdentity={storeEpoch:'epoch:one',sourceId:'source:one',containerId:'calendar:one',itemId:'item:one',externalId:null,aliases:[],seriesId:null,originalOccurrenceDate:null};
const coverage:ScanCoverage={storeEpoch:'epoch:one',accountSetHash:'accounts:one',containerIds:['calendar:one','calendar:two'],complete:true,permissions:'full',window:null,truncated:false,filtered:false};

test('independent server and native edits combine and emit only destination changes',()=>{
 const base={title:known('old'),notes:known('old notes'),status:known('open')};
 const result=mergeFields(base,{...base,title:known('web')},{...base,notes:known('phone')});
 assert.deepEqual(result,{fields:{title:known('web'),notes:known('phone'),status:known('open')},conflicts:[],toServer:{notes:known('phone')},toNative:{title:known('web')}});
});

test('concurrent same-field differences retain all evidence and prevent propagation',()=>{
 const result=mergeFields({title:known('old')},{title:known('web')},{title:known('phone')});
 assert.deepEqual(result.conflicts,[{field:'title',reason:'concurrent-change',base:known('old'),server:known('web'),native:known('phone')}]);
 assert.equal(result.fields.title.kind,'unavailable');assert.deepEqual(result.toServer,{});assert.deepEqual(result.toNative,{});
});

test('unchanged and equal concurrent changes produce no writes or conflict',()=>{
 for(const current of ['old','same new'])assert.deepEqual(mergeFields({title:known('old')},{title:known(current)},{title:known(current)}),{fields:{title:known(current)},conflicts:[],toServer:{},toNative:{}});
 assert.deepEqual(mergeFields({},{title:known('new')},{title:known('new')}),{fields:{title:known('new')},conflicts:[],toServer:{},toNative:{}});
});

test('explicit null propagates only with a comparable known baseline',()=>{
 const result=mergeFields({due:known('2026-11-03')},{due:known(null)},{due:known('2026-11-03')});
 assert.deepEqual(result.fields,{due:known(null)});assert.deepEqual(result.toNative,{due:known(null)});assert.deepEqual(result.toServer,{});assert.deepEqual(result.conflicts,[]);
});

test('missing and unavailable sides or baseline never prove a destructive or new-field write',()=>{
 const cases:[FieldObservations,FieldObservations,FieldObservations][]=[
  [{due:known(null)},{due:known('new')},{due:unavailable}],
  [{due:known(null)},{},{due:known('new')}],
  [{},{due:known(null)},{}],
  [{},{due:known('web')},{due:known('phone')}],
  [{due:unavailable},{due:known(null)},{due:known('new')}],
 ];
 for(const args of cases){const result=mergeFields(...args);assert.equal(result.conflicts.length,1);assert.equal(result.conflicts[0].reason,'unavailable');assert.deepEqual(result.toServer,{});assert.deepEqual(result.toNative,{});assert.equal(result.fields.due.kind,'unavailable');}
 const result=mergeFields({due:known(null)},{due:known('new')},{});assert.deepEqual(result.conflicts[0].native,{kind:'unavailable',reason:'missing'});
});

test('recurrence and alarm structures are atomic and input snapshots remain immutable',()=>{
 const base={recurrence:known([{frequency:'weekly',days:['MO']}]),alarms:known([{minutes:-5}])};
 const server={recurrence:known([{frequency:'weekly',days:['TU']}]),alarms:base.alarms};
 const native={recurrence:known([{frequency:'daily',days:['MO']}]),alarms:known([{minutes:-10}])};
 const original=structuredClone({base,server,native}),result=mergeFields(base,server,native);
 assert.deepEqual(result.conflicts.map(c=>c.field),['recurrence']);assert.deepEqual(result.toServer,{alarms:known([{minutes:-10}])});assert.deepEqual(result.toNative,{});assert.deepEqual({base,server,native},original);
 (result.fields.alarms as {kind:'known';value:any}).value[0].minutes=-100;
 assert.deepEqual(native.alarms,known([{minutes:-10}]));
});

test('verified echo requires marker, revision and semantic hash, with valid protocol values',()=>{
 const marker={mutationId:'synthetic-command',revision:2,payloadHash:'a'.repeat(64)};
 assert.equal(isVerifiedEcho(marker,{...marker}),true);
 for(const patch of [{mutationId:'other'},{revision:3},{payloadHash:'b'.repeat(64)},{revision:NaN},{revision:0},{revision:1.5},{payloadHash:'invalid'},{mutationId:''}])assert.equal(isVerifiedEcho(marker,{...marker,...patch}),false);
 assert.equal(isVerifiedEcho({...marker,payloadHash:'invalid'},{...marker,payloadHash:'invalid'}),false);
});

test('writes require full preservation, known supported fields and explicit recurrence scope',()=>{
 assert.deepEqual(checkWriteCapabilities('reminder',{title:known('new')},capabilities),{allowed:true,reasons:[]});
 assert.equal(checkWriteCapabilities('event',{recurrence:known([{frequency:'daily'}])},capabilities,'occurrence').allowed,true);
 const blocked=[
  checkWriteCapabilities('reminder',{title:known('new')},{...capabilities,fullSnapshot:{reminder:false,event:true}}),
  checkWriteCapabilities('reminder',{title:known('new')},{...capabilities,preserveUnchanged:false}),
  checkWriteCapabilities('reminder',{title:unavailable},capabilities),
  checkWriteCapabilities('reminder',{unadvertised:known(null)},capabilities),
  checkWriteCapabilities('event',{title:known('new')},{...capabilities,scopes:['single']},'series'),
 ];for(const result of blocked){assert.equal(result.allowed,false);assert.ok(result.reasons.length);}
 assert.deepEqual(checkWriteCapabilities('reminder',{}, {...capabilities,preserveUnchanged:false,fullSnapshot:{reminder:false,event:false}}),{allowed:true,reasons:[]});
 assert.throws(()=>checkWriteCapabilities('reminder',{},{} as NativeCapabilities),PlatformError);
});

test('native cancellation and invitation writes stay blocked even when advertised',()=>{
 for(const patch of [{cancelled:known(true)},{status:known('cancelled')},{attendees:known([])},{organizer:known(null)}] as FieldObservations[])assert.equal(checkWriteCapabilities('event',patch,capabilities).allowed,false);
 assert.equal(checkWriteCapabilities('event',{status:known('confirmed')},capabilities).allowed,true);
});

test('only proven absence in complete comparable coverage produces a candidate',()=>{
 assert.deepEqual(assessMissing(identity,coverage,{...coverage,containerIds:[...coverage.containerIds].reverse()},{status:'absent',identityReconciled:true}),{candidate:true,reason:'verified-absence-candidate'});
 for(const status of ['present','ambiguous','unavailable'] as const)assert.equal(assessMissing(identity,coverage,coverage,{status,identityReconciled:true}).candidate,false);
 assert.equal(assessMissing(identity,coverage,coverage,{status:'absent',identityReconciled:false}).candidate,false);
 const patches:Partial<ScanCoverage>[]=[{complete:false},{permissions:'limited'},{permissions:'denied'},{truncated:true},{filtered:true},{window:{from:'2026-11-01',to:'2026-12-01'}},{storeEpoch:'epoch:changed'},{accountSetHash:'accounts:changed'},{containerIds:['calendar:one']},{containerIds:['calendar:two']}];
 for(const patch of patches){assert.equal(assessMissing(identity,coverage,{...coverage,...patch},{status:'absent',identityReconciled:true}).candidate,false);assert.equal(assessMissing(identity,{...coverage,...patch},coverage,{status:'absent',identityReconciled:true}).candidate,false);}
 assert.equal(assessMissing({...identity,storeEpoch:'epoch:old'},coverage,coverage,{status:'absent',identityReconciled:true}).candidate,false);
});

test('plain-object inherited names are missing observations, never native evidence',()=>{
 const result=mergeFields({toString:known('old')},{toString:known('changed')},{});
 assert.equal(result.conflicts.length,1);assert.deepEqual(result.conflicts[0].native,{kind:'unavailable',reason:'missing'});
 assert.deepEqual(result.toServer,{});assert.deepEqual(result.toNative,{});
});
