import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import {handleStorageReviewRequest} from '../src/storage-review/http.ts';
import {StorageReviewService} from '../src/storage-review/service.ts';
import {MemoryPort} from './helpers/platform.ts';
import type {PlatformRepository,Transaction} from '../src/platform/contracts.ts';
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

function recoveryFixture(){
 const nodes=new Map<string,any>(),listeners=new Map<string,Function>(),wire:any[]=[],notices:string[]=[];
 let key=0,failRead=true,patchMode:'lost'|'conflict'|'receipt'|'reject'='lost';
 const snapshot=(revision:number,decision?:string)=>({revision,checklist:{revision:'wire-v1',items:[item,{...item,id:'S-2'}]},decisions:[...(decision?[{id:'S-1',decision}]:[]),{id:'S-2',decision:'trash'}]});
 let fresh=snapshot(1),receipt=snapshot(2,'keep');
 const context:any={REVIEW_API:'/api/platform/personal/storage-review',review:fresh.checklist,choices:new Map(),remote:fresh,synced:true,busy:false,uncertain:false,sessionDenied:false,localSaved:true,pendingDecision:null,syncStatus:'saved',AbortSignal,crypto:{randomUUID:()=>`synthetic-key-${++key}`},DECISIONS:{keep:'留',trash:'删除候选',defer:'暂缓'},
  byId:(id:string)=>{if(!nodes.has(id))nodes.set(id,{value:'',disabled:false,focus(){},addEventListener:(_:string,fn:Function)=>listeners.set(id,fn)});return nodes.get(id);},syncControls(){},render(){},focusDecision(){},canEdit:()=>!context.busy&&!context.uncertain,announce:(value:string)=>notices.push(value),isSessionDenial:()=>false,hideDeniedServerReview(){},parseSnapshot:(value:unknown)=>value,
  useReview:(review:any,s:any)=>{context.review=review;context.choices=new Map(s.decisions.map((row:any)=>[row.id,row.decision]));},
  fetch:async(url:string,options:any)=>{
   if(options.method==='GET'){if(failRead)throw Error('synthetic GET lost');return Response.json({review:fresh});}
   wire.push({url,method:options.method,body:options.body,key:options.headers['Idempotency-Key']});
   if(patchMode==='lost')throw Error('synthetic response lost');
   if(patchMode==='conflict'||patchMode==='reject')return Response.json({error:'synthetic rejection'},{status:patchMode==='conflict'?409:400});
   return Response.json({review:receipt});
  },
 };
 const functions=['requestReview','writeServer','choose','openServer','decisionMatches','freezeReviewCommand','retryDecision'].filter(name=>script.includes('function '+name+'(')).map(fn).join('\n');
 const handlers=['retry-decision','discard-decision'].map(id=>{const start=script.indexOf("byId('"+id+"').addEventListener(");return script.slice(start,script.indexOf('\n});',start)+4);}).join('\n');
 runInNewContext(functions+'\n'+handlers+'\nObject.assign(globalThis,{choose,openServer});',context);
 const click=async(id:string)=>{await listeners.get(id)!();for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));};
 return{context,wire,notices,click,snapshot,setRead:(value:boolean)=>{failRead=value;},setPatch:(value:typeof patchMode)=>{patchMode=value;},setFresh:(value:any)=>{fresh=value;},setReceipt:(value:any)=>{receipt=value;}};
}
test('unknown response replay freezes original URL method body and key after mismatching fresh GET',async()=>{
 const f=recoveryFixture();await f.context.choose(item,'keep');assert.equal(f.context.uncertain,true);
 f.setRead(false);f.setFresh(f.snapshot(3,'defer'));await f.context.openServer();f.setPatch('receipt');await f.click('retry-decision');
 assert.equal(f.wire.length,2);assert.deepEqual(f.wire[1],f.wire[0]);assert.equal(f.context.choices.get('S-1'),'defer');assert.equal(f.context.choices.get('S-2'),'trash');assert.equal(f.context.pendingDecision,null);assert.ok(f.notices.some(value=>value.includes('原请求已确认')&&value.includes('最新')));
});
test('first explicit 409 allows owner rebase with fresh revision and new key; cancel never writes',async()=>{
 const f=recoveryFixture();f.setRead(false);f.setPatch('conflict');f.setFresh(f.snapshot(2,'defer'));await f.context.choose(item,'keep');
 f.setPatch('receipt');f.setFresh(f.snapshot(3,'keep'));f.setReceipt(f.snapshot(3,'keep'));await f.click('retry-decision');
 assert.equal(JSON.parse(f.wire[1].body).expectedRevision,2);assert.notEqual(f.wire[1].key,f.wire[0].key);assert.equal(f.context.choices.get('S-2'),'trash');
 f.setPatch('conflict');await f.context.choose(item,'trash');const count=f.wire.length;await f.click('discard-decision');assert.equal(f.wire.length,count);assert.equal(f.context.pendingDecision,null);
});
test('4xx after a prior unknown cannot reclassify original command as rejected or mint a new key',async()=>{
 const f=recoveryFixture();await f.context.choose(item,'keep');f.setRead(false);f.setFresh(f.snapshot(3,'defer'));await f.context.openServer();f.setPatch('reject');await f.click('retry-decision');
 assert.equal(f.context.pendingDecision?.outcome,'unknown');f.setPatch('conflict');await f.click('retry-decision');assert.equal(f.context.pendingDecision?.outcome,'unknown');assert.equal(f.wire.length,3);assert.deepEqual(f.wire[1],f.wire[0]);assert.deepEqual(f.wire[2],f.wire[0]);
});


test('actual synthetic handler replays historical receipt without overwriting later same-row or other-row decisions',async()=>{
 const memory=new MemoryPort(),owner='synthetic-wire-owner';
 const repository=new Proxy(memory as PlatformRepository,{get(target,key,receiver){
  if(key!=='transaction')return Reflect.get(target,key,receiver);
  return <T>(recordOwner:string,commandKey:string,run:(tx:Transaction)=>Promise<T>)=>memory.transaction(recordOwner,commandKey,tx=>run({...tx,lockRecordIdentity:async()=>{}}));
 }});
 const service=new StorageReviewService(repository,{ownerId:owner,spaceId:'synthetic-wire-space'});
 const checklist={schema:1 as const,revision:'wire-v1',context:{summary:'Synthetic only'},items:[item,{...item,id:'S-2'}]};
 const saved=await service.saveChecklist(owner,{expectedRevision:null,checklist},'synthetic-wire-create');
 const f=recoveryFixture();f.context.remote=saved;f.context.review=saved.checklist;let lose=true,readFails=true;
 f.context.fetch=async(url:string,options:any)=>{
  if(options.method==='GET'&&readFails)throw Error('synthetic GET offline');
  if(options.method==='PATCH')f.wire.push({url,method:options.method,body:options.body,key:options.headers['Idempotency-Key']});
  const origin='https://synthetic.example.test';
  const response=await handleStorageReviewRequest(new Request(origin+url,{...options,headers:{...options.headers,origin,host:'synthetic.example.test'}}),{ownerId:owner,baseURL:origin,service,assertOwner:async()=>{},assertWritable:async()=>{}});
  if(options.method==='PATCH'&&lose){lose=false;throw Error('synthetic committed response lost');}
  assert.ok(response);return response;
 };
 await f.context.choose(item,'keep');assert.equal(f.context.pendingDecision.outcome,'unknown');
 await service.saveDecision(owner,{expectedRevision:2,checklistRevision:'wire-v1',id:'S-2',decision:'trash'},'synthetic-other-row');
 await service.saveDecision(owner,{expectedRevision:3,checklistRevision:'wire-v1',id:'S-1',decision:'defer'},'synthetic-later-same-row');
 readFails=false;await f.context.openServer();await f.click('retry-decision');
 assert.deepEqual(f.wire[1],f.wire[0]);assert.equal(f.context.pendingDecision,null);assert.equal(f.context.remote.revision,4);assert.equal(f.context.choices.get('S-1'),'defer');assert.equal(f.context.choices.get('S-2'),'trash');
 const final=await service.get(owner);assert.equal(final!.revision,4);assert.equal(memory.historyRows.length,4,'replayed receipt must not create a new write');
});
