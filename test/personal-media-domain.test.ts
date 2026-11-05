import assert from 'node:assert/strict';
import test from 'node:test';
import * as media from '../src/personal-media/domain.ts';

const personal=()=>({type:'media',schemaVersion:1,mediaKind:'book',state:'wish',creators:[],isbn:null,external:{provider:'manual',id:null,url:null},startedOn:null,finishedOn:null,rating:null,progress:{current:null,total:null,unit:null},links:{project:null,domain:null,topics:[]}});
const fields=()=>({title:'  内部合成作品  ',text:'保留原文',occurredOn:null,personal:personal()});
test('media preserves unknown facts, metadata and explicit personal state independently',()=>{
 const p=media.normalizeMediaPersonalFields(fields());assert.equal(p.title,'内部合成作品');assert.equal(p.personal.state,'wish');assert.equal(p.personal.rating,null);assert.deepEqual(p.personal.progress,{current:null,total:null,unit:null});
 const v=fields();v.personal={...v.personal,state:'completed',finishedOn:null} as any;assert.equal(media.normalizeMediaPersonalFields(v).personal.finishedOn,null);
 assert.deepEqual(media.emptyMediaPersonal(),p.personal);
});
test('media requires complete exact fields and keeps identity and authority out of user input',()=>{
 for(const key of Object.keys(personal())) {const v=fields();delete (v.personal as any)[key];assert.throws(()=>media.normalizeMediaPersonalFields(v),key);}
 for(const key of ['text','occurredOn','personal']) {const v=fields();delete (v as any)[key];assert.throws(()=>media.normalizeMediaPersonalFields(v),key);}
 for(const extra of [{ownerId:'forged'},{source:'forged'},{metadata:{finished:true}}])assert.throws(()=>media.validateMediaPersonal({...personal(),...extra}));
 assert.throws(()=>media.normalizeMediaPersonalFields({...fields(),title:' '}));
});
test('media validates progress unit for each kind and never infers completion from 100 percent',()=>{
 const valid=[['book','page',0,500],['series','episode',2,10],['film','percent',100,100]] as const;
 for(const [mediaKind,unit,current,total] of valid){const p=media.validateMediaPersonal({...personal(),mediaKind,progress:{unit,current,total}});assert.equal(p.state,'wish');assert.equal(p.progress.current,current);}
 for(const progress of [{unit:null,current:1,total:null},{unit:'page',current:1.1,total:10},{unit:'page',current:11,total:10},{unit:'page',current:0,total:0},{unit:'percent',current:101,total:null},{unit:'percent',current:2,total:50},{unit:'episode',current:2,total:10}])assert.throws(()=>media.validateMediaPersonal({...personal(),progress}),JSON.stringify(progress));
 assert.throws(()=>media.validateMediaPersonal({...personal(),mediaKind:'film',progress:{unit:'page',current:1,total:20}}));
});
test('media validates actual dates, ratings, ISBN checksums and provider URLs without fetching',()=>{
 assert.equal(media.validateMediaPersonal({...personal(),isbn:'978-0-14-032872-1'}).isbn,'9780140328721');assert.equal(media.validateMediaPersonal({...personal(),isbn:'0-306-40615-2'}).isbn,'0306406152');
 for(const patch of [{creators:[null]},{isbn:'9780140328722'},{isbn:'1234567890'},{rating:NaN},{rating:10.1},{rating:-1},{startedOn:'2026-02-30'},{startedOn:'2026-05-02',finishedOn:'2026-05-01'},{external:{provider:'openlibrary',id:'OL123W',url:'https://evil.invalid/works/OL123W'}},{external:{provider:'manual',id:null,url:'javascript:alert(1)'}},{external:{provider:'imdb',id:'tt123',url:'https://www.imdb.com.evil.invalid/title/tt123/'}}])assert.throws(()=>media.validateMediaPersonal({...personal(),...patch}),JSON.stringify(patch));
 assert.equal(media.validateMediaPersonal({...personal(),rating:0}).rating,0);assert.equal(media.validateMediaPersonal({...personal(),external:{provider:'douban',id:'123',url:'https://book.douban.com/subject/123/'}}).external.provider,'douban');
});
test('media exposes only typed current reference pins and rejects duplicate topics',()=>{
 const ref={id:'11111111-1111-4111-8111-111111111111',sourceId:'22222222-2222-4222-8222-222222222222',revision:2};
 const p=media.validateMediaPersonal({...personal(),links:{project:ref,domain:null,topics:[ref]}});assert.deepEqual(media.mediaPersonalReferences(p).map(v=>v.type),['project','topic']);
 assert.throws(()=>media.validateMediaPersonal({...personal(),links:{project:null,domain:null,topics:[ref,ref]}}));assert.throws(()=>media.validateMediaPersonal({...personal(),links:{project:{...ref,revision:0},domain:null,topics:[]}}));
});
