import assert from 'node:assert/strict';import test from 'node:test';
import {emptyMediaPersonal,type MediaPersonalFields} from '../src/personal-media/domain.ts';
import {projectMediaEntries,projectMediaBoard,mediaProgressPercent,mediaSummary} from '../src/personal-media/projection.ts';
const title='内部合成书籍',space='internal-media-space',id='11111111-1111-4111-8111-111111111111',sourceId='22222222-2222-4222-8222-222222222222';
const fields:MediaPersonalFields={title,text:'内部合成笔记',occurredOn:null,personal:{...emptyMediaPersonal(),creators:['合成作者'],state:'in_progress',progress:{current:10,total:200,unit:'page'}}};
const entry=()=>({id,kind:'inbox',revision:2,syncState:'draft',externalStatus:null,draft:{...fields,disposition:'reference'},source:{id:sourceId,system:'website',externalId:id,version:1,original:{marker:'personal-manual-v1',spaceId:space,type:'media',input:{spaceId:space,confirmed:true,fields}}}} as any);
test('media projection only accepts exact confirmed current manual records from the requested space',()=>{
 assert.equal(projectMediaEntries([entry()],space,'合成作者').length,1);assert.equal(projectMediaEntries([entry()],space,'not present').length,0);assert.equal(projectMediaEntries([entry()],'other').length,0);
 const mutations=[(v:any)=>v.source.original.type='person',(v:any)=>v.source.original.input.confirmed=false,(v:any)=>v.source.system='apple',(v:any)=>v.source.version=2,(v:any)=>v.source.externalId=sourceId,(v:any)=>v.externalStatus='done',(v:any)=>v.draft.personal.state='unknown',(v:any)=>delete v.source.original.input.fields.personal.rating,(v:any)=>v.draft.disposition='pending',(v:any)=>v.revision=0];for(const mutate of mutations){const v=structuredClone(entry());mutate(v);assert.equal(projectMediaEntries([v],space).length,0);}
});
test('media board filtering does not count metadata as personal completion or mutate source rows',()=>{
 const records=[{id,revision:2,fields},{id:sourceId,revision:1,fields:{...fields,title:'内部合成电影',personal:{...emptyMediaPersonal('film'),state:'completed' as const}}}];const before=structuredClone(records);const all=projectMediaBoard(records);assert.equal(all.total,2);assert.equal(all.completed,1);assert.deepEqual(all.columns.map(c=>[c.state,c.records.length]),[['wish',0],['in_progress',1],['completed',1],['paused',0]]);assert.equal(projectMediaBoard(records,{kind:'book',search:'作者'}).total,1);assert.deepEqual(records,before);
});
test('media progress display preserves zero and only draws known in-progress amounts',()=>{
 assert.equal(mediaProgressPercent(fields.personal),5);assert.equal(mediaProgressPercent({...fields.personal,progress:{current:0,total:200,unit:'page'}}),0);assert.equal(mediaProgressPercent({...fields.personal,state:'completed'}),null);assert.equal(mediaProgressPercent({...fields.personal,progress:{current:1,total:null,unit:'page'}}),null);assert.ok(mediaSummary({...fields.personal,rating:0}).includes('个人评分 0 / 10'));
});
