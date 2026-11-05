import assert from 'node:assert/strict';import test from 'node:test';
import {emptyMediaPersonal} from '../src/personal-media/domain.ts';
import * as m from '../src/personal-media/metadata.ts';
test('Open Library adapter builds only a bounded explicit search URL on the fixed official host',()=>{
 const r=m.buildOpenLibrarySearchRequest({query:' 内部测试书名 '});const url=new URL(r.url);assert.equal(url.origin,'https://openlibrary.org');assert.equal(url.pathname,'/search.json');assert.equal(url.searchParams.get('q'),'内部测试书名');assert.equal(url.searchParams.get('limit'),'5');assert.equal(url.searchParams.get('fields'),'key,title,author_name,isbn');
 const isbn=new URL(m.buildOpenLibrarySearchRequest({query:'978-0-14-032872-1',mode:'isbn'}).url);assert.equal(isbn.searchParams.get('isbn'),'9780140328721');assert.equal(isbn.searchParams.has('q'),false);
 for(const value of [{query:''},{query:'x',limit:100},{query:'invalid',mode:'isbn'},{query:'x',url:'https://evil.invalid'}])assert.throws(()=>m.buildOpenLibrarySearchRequest(value as any));
});
test('Open Library parsing drops malformed candidates and never chooses an arbitrary edition ISBN',()=>{
 const input={numFound:3,docs:[{key:'/works/OL123W',title:'内部合成作品',author_name:['合成作者'],isbn:['9780140328721'],read:true,rating:10},{key:'OL123W',title:'重复作品'},{key:'//evil.invalid/123',title:'无效来源'},{key:'/works/OL124W',title:' '}]};const rows=m.parseOpenLibrarySearchResponse(input);assert.equal(rows.length,1);assert.equal(rows[0].isbn,null);assert.deepEqual(rows[0].creators,['合成作者']);assert.equal(rows[0].url,'https://openlibrary.org/works/OL123W');assert.equal(Object.hasOwn(rows[0],'rating'),false);
 const request=m.buildOpenLibrarySearchRequest({query:'9780140328721',mode:'isbn'});assert.equal(m.parseOpenLibrarySearchResponse(input,request)[0].isbn,'9780140328721');assert.throws(()=>m.parseOpenLibrarySearchResponse({docs:{}}));
});
test('explicit metadata selection only changes work facts and retains all owner history and references',()=>{
 const fields={title:'旧名称',text:'个人笔记',occurredOn:'2026-11-05',personal:{...emptyMediaPersonal(),state:'paused' as const,startedOn:'2026-11-01',rating:0,progress:{current:50,total:200,unit:'page' as const}}};const before=structuredClone(fields);const candidate={provider:'openlibrary' as const,id:'OL123W',url:'https://openlibrary.org/works/OL123W',title:'内部合成作品',creators:['合成作者'],isbn:null};const applied=m.applyMediaMetadata(fields,candidate);assert.equal(applied.title,'内部合成作品');assert.equal(applied.personal.state,'paused');assert.equal(applied.personal.finishedOn,null);assert.equal(applied.personal.rating,0);assert.deepEqual(applied.personal.progress,{current:50,total:200,unit:'page'});assert.equal(applied.text,'个人笔记');assert.deepEqual(fields,before);assert.throws(()=>m.applyMediaMetadata({...fields,personal:emptyMediaPersonal('film')},candidate));assert.throws(()=>m.applyMediaMetadata(fields,{...candidate,state:'completed'} as any));
});
