import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {reviewDocument} from '../app/personal/storage-review/document.ts';
const script=reviewDocument.match(/<script>([\s\S]*?)<\/script>/)![1]!;
function fn(name:string){const start=script.indexOf('function '+name+'(');assert.ok(start>=0,'missing '+name);return(script.slice(start-6,start)==='async '?'async ':'')+script.slice(start,script.indexOf('\n}',start)+2);}
const item={id:'N-1',title:'Synthetic',kind:'file',status:'protected'};
test('note recovery retains exact raw text, URL body and key, without treating it as a decision',()=>{
 const scope='synthetic-owner-space',body={expectedRevision:2,checklistRevision:'v1',id:item.id,note:'  原文\n要求  '};
 const pending={scope,id:item.id,decision:null,checklistRevision:'v1',outcome:'unknown',command:{url:'/api/platform/personal/storage-review/notes',method:'PATCH',body:JSON.stringify(body),key:'synthetic-note-key'}};
 const parse=runInNewContext(fn('parsePendingReview')+'; parsePendingReview',{REVIEW_API:'/api/platform/personal/storage-review'});
 assert.deepEqual(JSON.parse(JSON.stringify(parse(JSON.stringify({schema:1,scope,pending}),scope))),pending);
 assert.throws(()=>parse(JSON.stringify({schema:1,scope,pending:{...pending,command:{...pending.command,url:'https://foreign.invalid'}}}),scope));
 assert.throws(()=>parse(JSON.stringify({schema:1,scope,pending:{...pending,command:{...pending.command,body:JSON.stringify({...body,decision:'trash'})}}}),scope));
});
test('note result matching allows a no-op receipt at the same revision and refuses changed text/item/checklist',()=>{
 const body={expectedRevision:2,checklistRevision:'v1',id:item.id,note:'exact text'},pending={id:item.id,checklistRevision:'v1',decision:null,command:{url:'/api/platform/personal/storage-review/notes',method:'PATCH',body:JSON.stringify(body)}};
 const match=runInNewContext(fn('decisionMatches')+'; decisionMatches',{REVIEW_API:'/api/platform/personal/storage-review'});
 const snapshot={revision:2,checklist:{revision:'v1',items:[item]},notes:[{id:item.id,note:'exact text'}],decisions:[]};
 assert.equal(match(snapshot,pending),true);
 for(const next of [{...snapshot,notes:[]},{...snapshot,notes:[{id:item.id,note:'exact text '}]},{...snapshot,checklist:{revision:'v2',items:[item]}},{...snapshot,checklist:{revision:'v1',items:[]}}])assert.equal(match(next,pending),false);
});
test('owner-scoped unsent drafts preserve text across refresh and never write when session retention fails',()=>{
 const storage=new Map<string,string>(),scope='synthetic-owner-space';
 const context:any={reviewScope:scope,noteDraftScope:scope,noteDrafts:new Map(),noteDraftsReliable:true,review:{revision:'v1'},remote:{revision:2},sessionStorage:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value)},announce(){}};
 const api=runInNewContext(['noteDraftKey','retainNoteDrafts','loadNoteDrafts','updateNoteDraft'].map(fn).join('\n')+'; ({update:updateNoteDraft,load:loadNoteDrafts})',context);
 assert.equal(api.update(item.id,'  原文\n要求  '),true);context.noteDrafts=new Map();context.noteDraftScope=null;api.load(scope);
 assert.equal(context.noteDrafts.get(item.id).note,'  原文\n要求  ');
 api.load('foreign-owner-space');assert.equal(context.noteDrafts.size,0);
 context.reviewScope=scope;api.load(scope);context.sessionStorage.setItem=()=>{throw Error('synthetic storage denied');};assert.equal(api.update(item.id,'unsent draft'),false);assert.equal(context.noteDrafts.get(item.id).note,'unsent draft');
});
test('an unsent draft keeps its original CAS revision after a refreshed remote snapshot',async()=>{
 let written:any;
 const context:any={synced:true,canEdit:()=>true,pendingDecision:null,reviewScope:'synthetic-space',review:{revision:'v1',items:[item]},remote:{revision:7},noteDrafts:new Map([[item.id,{note:'original draft',checklistRevision:'v1',expectedRevision:2}]]),retainNoteDrafts:()=>true,retainPendingDecision:()=>true,REVIEW_API:'/api/platform/personal/storage-review',freezeReviewCommand:(method:string,body:unknown,url:string)=>({method,body:JSON.stringify(body),url,key:'synthetic-note-key'}),writeServer:async(_method:string,body:unknown)=>{written=body;}};
 const save=runInNewContext(fn('saveNote')+'; saveNote',context);await save(item,'original draft');assert.equal(written.expectedRevision,2);
});
