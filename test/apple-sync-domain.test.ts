import assert from 'node:assert/strict';
import test from 'node:test';
import {PlatformError} from '../src/platform/domain.ts';
import {canonicalDigest,validateObservations,validateNativeIdentity,validateCapabilities,validateCoverage} from '../src/apple-sync-candidate/domain.ts';

const identity={storeEpoch:'synthetic-store',sourceId:'source:opaque',containerId:'calendar/opaque',itemId:'local:id',externalId:null,aliases:['old:item'],seriesId:'series:one',originalOccurrenceDate:'2026-11-03T09:00:00+08:00'};
const capabilities={protocolVersion:1,adapterId:'synthetic',adapterVersion:'1.0',platform:'synthetic',fullSnapshot:{reminder:true,event:true},writableFields:{reminder:['title','notes'],event:['title']},preserveUnchanged:true,scopes:['single','occurrence'],nativeEventCancellationWrite:false,invitationWrite:false};
const coverage={storeEpoch:'synthetic-store',accountSetHash:'synthetic-accounts',containerIds:['calendar/opaque'],complete:true,permissions:'full',window:null,truncated:false,filtered:false};
const invalid=(run:()=>unknown)=>assert.throws(run,(error:unknown)=>error instanceof PlatformError&&error.status===400&&/^INVALID_SYNC_/.test(error.code)&&!error.message.includes('private-content'));

test('semantic digest is SHA256 of recursively sorted JSON and preserves null and array order',()=>{
 assert.equal(canonicalDigest({b:2,a:1}),'43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777');
 assert.equal(canonicalDigest({z:[{b:2,a:1}],a:null}),canonicalDigest({a:null,z:[{a:1,b:2}]}));
 assert.notEqual(canonicalDigest(null),canonicalDigest('null'));
 assert.notEqual(canonicalDigest([1,2]),canonicalDigest([2,1]));
});

test('non-JSON, prototype pollution, accessors, cycles and excessive payloads are rejected safely',()=>{
 const cycle:any={};cycle.self=cycle;
 const accessor=Object.defineProperty({},'secret',{get(){throw Error('private-content');},enumerable:true});
 let deep:unknown=null;for(let i=0;i<100;i++)deep=[deep];
 for(const value of [undefined,NaN,Infinity,1n,()=>0,new Date(),new Map(),cycle,accessor,deep,JSON.parse('{"__proto__":{}}'),{nested:{constructor:'private-content'}},Object.create({inherited:true}),{[Symbol('x')]:1},[,,],{x:'a'.repeat(2_000_000)},Array(50_001).fill(1)]) invalid(()=>canonicalDigest(value));
});

test('observations retain explicit null and unavailable reasons without defaulting missing fields',()=>{
 const input={due:{kind:'known',value:null},alarm:{kind:'unavailable',reason:'not-exported'},notes:{kind:'known',value:{nested:[1,false]}}};
 const output=validateObservations(input);assert.deepEqual(output,input);assert.ok(!('title' in output));
 (input.notes.value.nested as (number|boolean)[]).push(2);assert.deepEqual(output.notes,{kind:'known',value:{nested:[1,false]}});
 for(const value of [{a:null},{a:{kind:'known'}},{a:{kind:'known',value:undefined}},{a:{kind:'unavailable',reason:''}},{a:{kind:'known',value:null,extra:true}},JSON.parse('{"__proto__":{"kind":"known","value":null}}')])invalid(()=>validateObservations(value));
});

test('identity accepts opaque IDs and preserves aliases and original occurrence date',()=>{
 assert.deepEqual(validateNativeIdentity(identity),identity);
 assert.equal(validateNativeIdentity({...identity,originalOccurrenceDate:'2026-11-03'}).originalOccurrenceDate,'2026-11-03');
 for(const patch of [{itemId:''},{itemId:'x'.repeat(5000)},{aliases:['x','x']},{originalOccurrenceDate:'2026-02-30'},{originalOccurrenceDate:'2026-11-03T09:00:00'},{editedStart:'2026-11-04'},{externalId:undefined},{aliases:null}])invalid(()=>validateNativeIdentity({...identity,...patch}));
});

test('capability contract rejects unknown versions, flags, scopes and implicit permissions',()=>{
 assert.deepEqual(validateCapabilities(capabilities),capabilities);
 for(const patch of [{protocolVersion:2},{nativeEventCancellationWrite:true},{invitationWrite:true},{preserveUnchanged:undefined},{scopes:['unknown']},{fullSnapshot:{reminder:true,event:true,extra:true}},{writableFields:{reminder:['title','title'],event:[]}},{permission:true}])invalid(()=>validateCapabilities({...capabilities,...patch}));
});

test('coverage is strict about completeness, containers and explicit time windows',()=>{
 assert.deepEqual(validateCoverage(coverage),coverage);
 assert.deepEqual(validateCoverage({...coverage,window:{from:'2026-11-01',to:'2026-12-01'}}).window,{from:'2026-11-01',to:'2026-12-01'});
 for(const patch of [{complete:1},{containerIds:['x','x']},{permissions:'unknown'},{window:{from:'2026-12-01',to:'2026-11-01'}},{window:{from:'2026-02-30',to:'2026-03-01'}},{accountSetHash:''},{window:undefined},{extra:1}])invalid(()=>validateCoverage({...coverage,...patch}));
});

test('array subclasses and aggregate JSON payload overflow cannot masquerade as bounded evidence',()=>{
 class ForeignArray extends Array<number>{}
 invalid(()=>canonicalDigest(new ForeignArray(1,2)));
 invalid(()=>canonicalDigest(Array.from({length:32},()=> 'x'.repeat(40_000))));
});

test('untrusted object reflection failures surface only a stable safe validation error',()=>{
 const hostile=new Proxy({},{ownKeys(){throw Error('private-content');}});
 invalid(()=>canonicalDigest(hostile));invalid(()=>validateObservations(hostile));
});
