import test from 'node:test';
import assert from 'node:assert/strict';
import {PlatformError,validateInbox} from '../src/platform/domain.ts';

const records=[
 {type:'learning',syntheticOnly:true,topic:'Synthetic topic',status:'planned',nextStep:null,resourceURL:null},
 {type:'career',syntheticOnly:true,evidence:'Synthetic evidence',nextStep:null},
 {type:'mood',syntheticOnly:true,label:'Self-reported synthetic calm',intensity:null},
 {type:'article',syntheticOnly:true,author:null,attribution:'summary',sourceURL:null},
 {type:'resource',syntheticOnly:true,url:'https://example.invalid/reference',author:null},
];
const inbox=(record:unknown)=>validateInbox({title:'Synthetic reference',text:'Synthetic text',occurredOn:null,disposition:'reference',record});
const invalid=(run:()=>unknown)=>assert.throws(run,(e:unknown)=>e instanceof PlatformError&&e.status===400);

test('all five strict typed metadata variants survive the existing inbox validator',()=>{
 for(const record of records)assert.deepEqual(inbox(record).record,record);
 assert.deepEqual(validateInbox({title:'Legacy inbox'}),{title:'Legacy inbox',text:'',occurredOn:null,disposition:'pending'});
});
test('optional absent and blank values remain unknown without invented author, intensity, next step or URL',()=>{
 assert.deepEqual(inbox({type:'learning',syntheticOnly:true,topic:'Topic',status:'active',nextStep:'  ',resourceURL:''}).record,{type:'learning',syntheticOnly:true,topic:'Topic',status:'active',nextStep:null,resourceURL:null});
 assert.deepEqual(inbox({type:'article',syntheticOnly:true,attribution:'excerpt'}).record,{type:'article',syntheticOnly:true,author:null,attribution:'excerpt',sourceURL:null});
 assert.deepEqual(inbox({type:'mood',syntheticOnly:true,label:'Self-report',intensity:''}).record,{type:'mood',syntheticOnly:true,label:'Self-report',intensity:null});
});
test('unknown fields, cross-category metadata, inferred status/mood, invalid scalar ranges and unsafe URLs fail closed',()=>{
 for(const record of [null,[],{},...records.map(r=>({...r,syntheticOnly:false})),...records.map(r=>({...r,unknown:'not allowed'})),
  {...records[0],status:'in_progress'},{...records[0],status:null},{...records[0],topic:''},{...records[1],evidence:''},
  {...records[2],label:''},{...records[2],intensity:0},{...records[2],intensity:6},{...records[2],intensity:1.5},{...records[2],intensity:'3'},
  {...records[3],attribution:'inferred'},{...records[3],evidence:'wrong category'},
  ...['javascript:alert(1)','data:text/html,hi','file:///tmp/a','ftp://example.invalid/a','https://user:pass@example.invalid/','https://example.invalid/\npath','https://example.invalid/\n','https://example.invalid/\u0000','https://example.invalid/\\path','http://','https:example.invalid','//example.invalid',''].map(url=>({...records[4],url})),
  {...records[0],topic:'x'.repeat(241)},{...records[1],nextStep:'x'.repeat(4001)},{...records[3],author:'x'.repeat(241)},
 ])invalid(()=>inbox(record));
 invalid(()=>validateInbox({title:'Synthetic',record:records[0],disposition:'pending'}));
});
