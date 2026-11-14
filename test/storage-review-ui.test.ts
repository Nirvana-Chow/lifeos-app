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
function treeFunctions(){return ['reviewTree','reviewProgress','reviewStateLabel'].map(fn).join('\n');}
test('exact dotted parent identities preserve source order and never group malformed or orphan IDs',()=>{
 const items=[{...item,id:'G43.01'}, {...item,id:'G43'}, {...item,id:'G43.01.02'}, {...item,id:'G44.01'}, {...item,id:'G43..bad'}, {...item,id:'G430.01'}];
 const tree=runInNewContext(treeFunctions()+'; reviewTree',{DECISIONS:{keep:'留',trash:'删除候选',defer:'暂缓'},STATUS:{pending:'待审',processed:'已处理',protected:'受保护'}})(items);
 const shape=tree.roots.map((node:any)=>[node.item.id,node.children.map((child:any)=>[child.item.id,child.children.map((leaf:any)=>leaf.item.id)])]);
 assert.deepEqual(JSON.parse(JSON.stringify(shape)),[['G43',[['G43.01',['G43.01.02']]]],['G44.01',[]],['G43..bad',[]],['G430.01',[]]]);
 assert.equal(items[0].id,'G43.01');
});
test('choice progress counts pending leaves while retaining historical parent decisions and processing status',()=>{
 const items=[{...item,id:'G43'}, {...item,id:'G43.01'}, {...item,id:'M1',kind:'media',body:'Upload verified backup complete'}, {...item,id:'DONE',status:'processed'}];
 const context={DECISIONS:{keep:'留',trash:'删除候选',defer:'暂缓'},STATUS:{pending:'待审',processed:'已处理',protected:'受保护'}};
 const result=runInNewContext(treeFunctions()+'; ({progress:reviewProgress, label:reviewStateLabel})',context);
 assert.deepEqual(JSON.parse(JSON.stringify(result.progress(items,new Map([['G43','trash'],['G43.01','keep'],['M1','trash']])))),{total:2,selected:2,keep:1,trash:1,defer:0,parentSelected:1});
 assert.match(result.label(items[2],'trash',false),/待处理/);
 assert.doesNotMatch(result.label(items[2],'trash',false),/已删除|已处理/);
 assert.match(result.label(items[0],'trash',true),/历史选择/);
 assert.match(result.label(items[3],null,false),/已处理/);
});
test('undecided child filtering retains parent context without counting or changing its saved choice',()=>{
 const items=[{...item,id:'G43'}, {...item,id:'G43.01'}, {...item,id:'G43.02'}, {...item,id:'G44.01'}];
 const choices=new Map([['G43','trash'],['G43.01','keep']]);
 const context={OWN:(v:object,k:string)=>Object.hasOwn(v,k),DECISIONS:{keep:'留',trash:'删除候选',defer:'暂缓'},KINDS:{folder:'文件夹'}};
 const project=runInNewContext(fn('reviewTree')+'\n'+fn('matches')+'\n'+fn('filterReviewTree')+'; filterReviewTree',context);
 const result=project(items,'','pending',choices,'Archives');
 assert.deepEqual(JSON.parse(JSON.stringify(result.map((row:any)=>[row.item.id,row.matched,row.children.map((child:any)=>child.item.id)]))),[['G43',false,['G43.02']],['G44.01',true,[]]]);
 assert.equal(choices.get('G43'),'trash');assert.equal(choices.size,2);
});
test('media evidence remains unverified even when its body or processed state mentions an upload',()=>{
 const label=runInNewContext(fn('reviewEvidence')+'; reviewEvidence');
 for(const status of ['pending','processed','protected'])assert.equal(label({...item,kind:'media',status,body:'Upload verified backup complete'}),'上传完成：未核实 · 独立恢复核验：未核实');
 assert.equal(label(item),'');
});
test('return navigation retains a busy or unconfirmed command and allows a settled review',()=>{
 const context:any={busy:false,pendingDecision:null,uncertain:false,synced:true,localSaved:true,choices:new Map(),pendingRetained:false,announce(){}};
 const guard=runInNewContext(fn('guardReviewNavigation')+'; guardReviewNavigation',context);
 let blocked=0;const event={preventDefault(){blocked++;}};
 guard(event);assert.equal(blocked,0);
 for(const key of ['busy','pendingDecision']){context[key]=true;guard(event);context[key]=false;}
 assert.equal(blocked,2);
});
test('only an explicit leave confirmation can abandon choices that failed local persistence',()=>{
 let confirms=0,blocked=0;let leave=false;
 const choices=new Map([['S-1','keep']]);
 const context={busy:false,pendingDecision:null,uncertain:false,synced:false,localSaved:false,choices,announce(){},confirm:()=>{confirms++;return leave;}};
 const guard=runInNewContext(fn('guardReviewNavigation')+'; guardReviewNavigation',context);
 const event={preventDefault(){blocked++;}};
 guard(event);assert.equal(blocked,1);assert.equal(confirms,1);assert.equal(choices.get('S-1'),'keep');
 leave=true;guard(event);assert.equal(blocked,1);assert.equal(confirms,2);
});
test('a retained unknown command can leave for return or login without being cleared or resent',()=>{
 let blocked=0,confirmed=0;
 const pending={id:'S-1',outcome:'unknown',command:{key:'original-key'}};
 const context:any={busy:false,pendingDecision:pending,uncertain:true,synced:true,localSaved:true,choices:new Map(),pendingRetained:true,retainPendingDecision:()=>true,announce(){},confirm:()=>{confirmed++;return true;}};
 const guard=runInNewContext(fn('guardReviewNavigation')+'; guardReviewNavigation',context);
 guard({preventDefault(){blocked++;}});assert.equal(blocked,0);assert.equal(confirmed,1);assert.equal(context.pendingDecision,pending);assert.equal(context.uncertain,true);
});
test('session recovery retains exact command bytes under its verified owner scope and rejects foreign or malformed records',()=>{
 const storage=new Map<string,string>();
 const context:any={REVIEW_API:'/api/platform/personal/storage-review',reviewScope:'["owner","space"]',syncStatus:'saved',uncertain:false,pendingRetained:false,pendingDecision:{id:'S-1',decision:'keep',checklistRevision:'synthetic-v1',scope:'["owner","space"]',outcome:'unknown',command:{url:'/api/platform/personal/storage-review',method:'PATCH',body:'{"expectedRevision":1,"checklistRevision":"synthetic-v1","id":"S-1","decision":"keep"}',key:'original-command-key'}},OWN:(v:object,k:string)=>Object.hasOwn(v,k),DECISIONS:{keep:'留',trash:'删除候选',defer:'暂缓'},sessionStorage:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)}};
 const functions=['reviewRecoveryKey','parsePendingReview','retainPendingDecision','restorePendingDecision'].map(fn).join('\n');
 const api=runInNewContext(functions+'; ({keep:retainPendingDecision,restore:restorePendingDecision})',context);
 const command=context.pendingDecision.command;assert.equal(api.keep(),true);context.pendingDecision=null;api.restore();assert.deepEqual(JSON.parse(JSON.stringify(context.pendingDecision.command)),command);assert.equal(context.pendingDecision.outcome,'unknown');
 context.reviewScope='["other","space"]';context.pendingDecision=null;api.restore();assert.equal(context.pendingDecision,null);
 context.reviewScope='["owner","space"]';const key=[...storage.keys()][0];const raw=JSON.parse(storage.get(key)!);raw.pending.command.url='https://foreign.invalid/';storage.set(key,JSON.stringify(raw));assert.throws(()=>api.restore());
});
test('retained checklist requests restore their original POST payload and independent match rule',()=>{
 const checklist={schema:1,revision:'synthetic-post-v1',items:[item]};
 const command={url:'/api/platform/personal/storage-review',method:'POST',body:JSON.stringify({expectedRevision:null,checklist}),key:'synthetic-post-key'};
 const pending={scope:'synthetic-scope',id:'__checklist__',decision:null,checklistRevision:checklist.revision,outcome:'new',command};
 const context={REVIEW_API:command.url,OWN:(v:object,k:string)=>Object.hasOwn(v,k),DECISIONS:{keep:'留',trash:'删除候选',defer:'暂缓'},KINDS:{folder:'文件夹'},STATUS:{pending:'待审'}};
 const api=runInNewContext(['parseReview','parsePendingReview','decisionMatches'].map(fn).join('\n')+'; ({parse:parsePendingReview,matches:decisionMatches})',context);
 const restored=api.parse(JSON.stringify({schema:1,scope:pending.scope,pending}),pending.scope);
 assert.equal(restored.outcome,'unknown');assert.deepEqual(JSON.parse(JSON.stringify(restored.command)),command);
 assert.equal(api.matches({revision:1,checklist},restored),true);assert.equal(api.matches({revision:2,checklist:{...checklist,revision:'other'}},restored),false);
});
test('owner generation changes reject a late review response without reviving old private state',async()=>{
 let finish!:(response:Response)=>void;
 const context:any={REVIEW_API:'/api/platform/personal/storage-review',reviewScope:'owner-scope',reviewGeneration:1,readReviewScope:async()=> 'owner-scope',AbortSignal,fetch:()=>new Promise<Response>(resolve=>{finish=resolve;}),parseSnapshot:(value:unknown)=>value};
 const request=runInNewContext(fn('requestReview')+'; requestReview',context);
 const response=request();context.reviewGeneration++;context.reviewScope=null;finish(Response.json({review:{private:'synthetic old owner'}}));
 await assert.rejects(response,{status:403});
});
test('group parents and unknown identities cannot send a decision while standalone folders remain writable',async()=>{
 const records=[{...item,id:'G43'}, {...item,id:'G43.01'}, {...item,id:'LEAF'}];let writes=0;
 const context:any={review:{items:records,revision:'v1'},pendingDecision:null,choices:new Map([['G43','trash']]),canEdit:()=>true,synced:false,store(){writes++;},render(){},focusDecision(){}};
 const choose=runInNewContext(fn('reviewTree')+'\n'+fn('choose')+'; choose',context);
 await choose(records[0],'keep');await choose({...item,id:'unknown'},'trash');
 assert.equal(writes,0);assert.equal(context.choices.get('G43'),'trash');
 await choose(records[2],'keep');assert.equal(writes,1);assert.equal(context.choices.get('LEAF'),'keep');
});
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
 const context:any={busy:false,remote:original,uncertain:false,sessionDenied:false,synced:true,pendingDecision:{id:'S-1',decision:'keep',checklistRevision:'synthetic-v1'},syncStatus:'saved',retainPendingDecision:()=>true,clearPendingDecision(){context.pendingDecision=null;},syncControls(){},announce:(s:string)=>notices.push(s),requestReview:async(method='GET')=>{if(method==='PATCH'&&status)throw Object.assign(Error('failure'),{status});if(method==='GET'&&readbackFails)throw Error('offline');return fresh;},useReview:(_:unknown,s:unknown)=>{shown=s;},isSessionDenial:()=>false,hideDeniedServerReview(){}};
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
 const storage=new Map<string,string>(),scope='["synthetic-owner","synthetic-space"]';
 let key=0,failRead=true,patchMode:'lost'|'conflict'|'receipt'|'reject'='lost';
 const snapshot=(revision:number,decision?:string)=>({revision,checklist:{revision:'wire-v1',items:[item,{...item,id:'S-2'}]},decisions:[...(decision?[{id:'S-1',decision}]:[]),{id:'S-2',decision:'trash'}]});
 let fresh=snapshot(1),receipt=snapshot(2,'keep');
 const context:any={REVIEW_API:'/api/platform/personal/storage-review',reviewScope:scope,reviewGeneration:0,recoveryBlocked:false,noteDraftCorrupt:false,loadNoteDrafts(){},pendingRetained:false,readReviewScope:async()=>scope,sessionStorage:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)},OWN:(v:object,k:string)=>Object.hasOwn(v,k),review:fresh.checklist,choices:new Map(),remote:fresh,synced:true,busy:false,uncertain:false,sessionDenied:false,localSaved:true,pendingDecision:null,syncStatus:'saved',AbortSignal,crypto:{randomUUID:()=>`synthetic-key-${++key}`},DECISIONS:{keep:'留',trash:'删除候选',defer:'暂缓'},
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
 const functions=['reviewRecoveryKey','parsePendingReview','retainPendingDecision','restorePendingDecision','clearPendingDecision','reviewTree','requestReview','writeServer','savePreview','choose','openServer','decisionMatches','freezeReviewCommand','retryDecision'].filter(name=>script.includes('function '+name+'(')).map(fn).join('\n');
 const handlers=['retry-decision','discard-decision'].map(id=>{const start=script.indexOf("byId('"+id+"').addEventListener(");return script.slice(start,script.indexOf('\n});',start)+4);}).join('\n');
 runInNewContext(functions+'\n'+handlers+'\nObject.assign(globalThis,{choose,openServer,savePreview});',context);
 const click=async(id:string)=>{await listeners.get(id)!();for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));};
 return{context,wire,notices,click,snapshot,setRead:(value:boolean)=>{failRead=value;},setPatch:(value:typeof patchMode)=>{patchMode=value;},setFresh:(value:any)=>{fresh=value;},setReceipt:(value:any)=>{receipt=value;}};
}
test('unknown response replay freezes original URL method body and key after mismatching fresh GET',async()=>{
 const f=recoveryFixture();await f.context.choose(item,'keep');assert.equal(f.context.uncertain,true);
 f.setRead(false);f.setFresh(f.snapshot(3,'defer'));await f.context.openServer();f.setPatch('receipt');await f.click('retry-decision');
 assert.equal(f.wire.length,2);assert.deepEqual(f.wire[1],f.wire[0]);assert.equal(f.context.choices.get('S-1'),'defer');assert.equal(f.context.choices.get('S-2'),'trash');assert.equal(f.context.pendingDecision,null);assert.ok(f.notices.some(value=>value.includes('原请求已确认')&&value.includes('最新')));
});
test('keeping unknown input never clears its frozen command and persistence failure sends no request',async()=>{
 const f=recoveryFixture();await f.context.choose(item,'keep');const original=f.context.pendingDecision.command;
 await f.click('discard-decision');assert.equal(f.context.pendingDecision.command,original);assert.equal(f.context.uncertain,true);assert.equal(f.wire.length,1);assert.equal(f.context.pendingRetained,true);
 const g=recoveryFixture();g.context.sessionStorage.setItem=()=>{throw Error('synthetic storage denied');};await g.context.choose(item,'keep');
 assert.equal(g.wire.length,0);assert.equal(g.context.pendingDecision.outcome,'new');assert.equal(g.context.pendingRetained,false);await g.click('discard-decision');assert.equal(g.context.pendingDecision,null);assert.equal(g.wire.length,0);
});
test('discarding an explicit rejection permits return while failed-read uncertainty still forbids edits',async()=>{
 const f=recoveryFixture(),methods:string[]=[],fetcher=f.context.fetch;f.context.fetch=(url:string,options:any)=>{methods.push(options.method);return fetcher(url,options);};f.setPatch('conflict');await f.context.choose(item,'keep');
 assert.equal(f.context.pendingDecision.outcome,'rejected');assert.equal(f.context.uncertain,true);await f.click('discard-decision');
 assert.equal(f.context.pendingDecision,null);assert.equal(f.context.uncertain,true);
 let prevented=0;const guard=runInNewContext(fn('guardReviewNavigation')+'; guardReviewNavigation',f.context);
 guard({preventDefault(){prevented++;}});assert.equal(prevented,0);
 assert.equal(runInNewContext(fn('canEdit')+'; canEdit',f.context)(),false);
 assert.deepEqual(methods,['PATCH','GET']);
});
test('a real retained POST followed by 503 and lost session storage cannot leave by discarding local choices',async()=>{
 const f=recoveryFixture(),methods:string[]=[];
 const checklist={schema:1,revision:'synthetic-post-v1',items:[item]};
 Object.assign(f.context,{synced:false,remote:null,localSaved:false,choices:new Map([['S-1','keep']]),review:checklist,TextEncoder,confirm:()=>true});
 f.context.requestReview=async(method='GET')=>{methods.push(method);if(method==='POST'){f.context.sessionStorage.getItem=()=>{throw Error('synthetic session lost');};f.context.sessionStorage.setItem=()=>{throw Error('synthetic session lost');};throw Object.assign(Error('synthetic missing receipt'),{status:503});}throw Error('synthetic read offline');};
 await f.context.savePreview();assert.deepEqual(methods,['POST','GET']);assert.equal(f.context.pendingDecision.outcome,'unknown');assert.equal(f.context.pendingRetained,false);assert.equal(f.context.uncertain,true);
 const original=f.context.pendingDecision.command;let prompts=0,prevented=0;f.context.confirm=()=>{prompts++;return true;};
 runInNewContext(fn('guardReviewNavigation')+'; guardReviewNavigation',f.context)({preventDefault(){prevented++;}});
 assert.equal(prevented,1);assert.equal(prompts,0);assert.equal(f.context.pendingDecision.command,original);assert.equal(f.context.uncertain,true);assert.deepEqual(methods,['POST','GET']);
});
test('an unretained unknown request blocks before a local-only-choice leave confirmation can discard its command',()=>{
 for(const retained of [false,true]){
  let prompts=0,prevented=0;
  const pending={id:'__checklist__',outcome:'unknown',command:{url:'/api/platform/personal/storage-review',method:'POST',body:'original-body',key:'original-key'}};
  const context:any={busy:false,synced:false,localSaved:false,choices:new Map([['S-1','keep']]),pendingDecision:pending,pendingRetained:retained,uncertain:true,retainPendingDecision:()=>false,announce(){},confirm:()=>{prompts++;return true;}};
  const guard=runInNewContext(fn('guardReviewNavigation')+'; guardReviewNavigation',context);
  guard({preventDefault(){prevented++;}});assert.equal(prevented,1);assert.equal(prompts,0);assert.equal(context.pendingDecision,pending);assert.equal(context.uncertain,true);assert.equal(context.choices.get('S-1'),'keep');
 }
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
