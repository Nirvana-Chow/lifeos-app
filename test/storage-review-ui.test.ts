import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import {reviewDocument} from '../app/personal/storage-review/document.ts';
const script=reviewDocument.match(/<script>([\s\S]*?)<\/script>/)![1]!;
function fn(name:string){const start=script.indexOf('function '+name+'(');assert.ok(start>=0);return (script.slice(start-6,start)==='async '?'async ':'')+script.slice(start,script.indexOf('\n}',start)+2);}
const item={id:'S-1',title:'Synthetic archive',group:'Archives',body:'Verified 2 GiB',question:'Review?',kind:'folder',status:'pending'};
test('selected and group filters distinguish undecided from defer',()=>{
 const matches=runInNewContext(fn('matches')+'; matches',{OWN:(v:object,k:string)=>Object.hasOwn(v,k),DECISIONS:{keep:'留',trash:'删除候选',defer:'暂缓'},KINDS:{folder:'文件夹'}});
 assert.equal(matches(item,'','selected',new Map([['S-1','defer']]),'Archives'),true);
 assert.equal(matches(item,'','pending',new Map([['S-1','defer']]),'Archives'),false);
 assert.equal(matches(item,'','selected',new Map(),'Archives'),false);
 assert.equal(matches(item,'','all',new Map(),'Other'),false);
});
async function writeCase(status:number|null,readbackFails=false){
 const original={revision:1,checklist:{revision:'synthetic-v1'},decisions:[]};
 const fresh={...original,revision:2};const notices:string[]=[];let shown:unknown;
 const context:any={busy:false,remote:original,uncertain:false,sessionDenied:false,synced:true,pendingDecision:{id:'S-1',decision:'keep',checklistRevision:'synthetic-v1'},syncStatus:'saved',syncControls(){},announce:(s:string)=>notices.push(s),requestReview:async(method='GET')=>{if(method==='PATCH'&&status)throw Object.assign(Error('failure'),{status});if(method==='GET'&&readbackFails)throw Error('offline');return fresh;},useReview:(_:unknown,s:unknown)=>{shown=s;},isSessionDenial:()=>false,hideDeniedServerReview(){}};
 await runInNewContext(fn('writeServer')+'; writeServer',context)('PATCH',{},()=>false);
 return {context,notices,shown};
}
test('conflicting readback keeps attempted decision for explicit retry',async()=>{
 const {context,shown}=await writeCase(409);
 assert.equal(context.pendingDecision?.decision,'keep');assert.equal(context.syncStatus,'error');assert.ok(shown);assert.equal(context.busy,false);
});
test('failed readback preserves attempted decision and marks uncertainty',async()=>{
 const {context}=await writeCase(503,true);assert.equal(context.pendingDecision?.decision,'keep');assert.equal(context.uncertain,true);assert.equal(context.syncStatus,'error');
});
test('desktop ledger and mobile cards retain scoped controls',()=>{
 assert.match(reviewDocument,/id="group-filter"/);assert.match(reviewDocument,/value="selected"/);assert.match(reviewDocument,/id="retry-decision"/);assert.match(reviewDocument,/id="discard-decision"/);assert.match(reviewDocument,/min\(1480px/);assert.match(reviewDocument,/说明与空间依据/);
});
