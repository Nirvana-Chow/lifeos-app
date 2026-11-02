import{test}from'node:test';import assert from'node:assert/strict';
import{resolveTaskTarget,taskCellFields,receiptEditor,taskReceiptMatchesSubmission}from'../src/personal-candidate/task-editor-state.ts';
const task={id:'task-one',revision:3},fields={title:'Title',text:'Body',date:'',status:'open' as const,personal:{domain:null,project:{id:'11111111-1111-4111-8111-111111111111',sourceId:'22222222-2222-4222-8222-222222222222',revision:2},topics:[]}};
test('missing and stale task targets stay missing rather than falling back to create',()=>{
 assert.deepEqual(resolveTaskTarget('missing',false,[]),{mode:'missing',id:'missing'});
 assert.deepEqual(resolveTaskTarget(undefined,true,[]),{mode:'create'});
 assert.deepEqual(resolveTaskTarget(task.id,false,[task]),{mode:'edit',task});
 assert.deepEqual(taskCellFields(fields,'status','已完成'),{...fields,status:'done'});assert.deepEqual(taskCellFields(fields,'due','2026-11-03'),{...fields,date:'2026-11-03'});assert.equal(fields.status,'open');
 assert.throws(()=>taskCellFields(fields,'status','unknown'));assert.throws(()=>taskCellFields(fields,'due','2026-02-31'));
});
// Catches a second native local write after authoritative receipt filters/reorders a row.
test('native validation captures stable task, awaits receipt and always forbids native local commit',async()=>{
 let current={...task},released=false,cancelled=0,saves=0;let release!:(value:any)=>void;const requests:any[]=[];
 const native={onStart:()=>{},onEnd:()=>{},getValue:()=>'',isEditorElement:()=>false};
 const editor=receiptEditor(native,{capture:()=>({task:{...current},fields}),save:async(t,f)=>{saves++;requests.push([t,f]);return await new Promise(r=>release=r);},active:()=>!released,cancel:()=>cancelled++,style:()=>{}});
 assert.equal(await editor.validateValue!('Changed'),false);assert.equal(saves,0);
 editor.onStart({col:0,row:1} as any);const pending=editor.validateValue!('Changed');current={id:'other-row',revision:7};assert.equal(saves,1);assert.equal(cancelled,0);release({});assert.equal(await pending,false);assert.equal(cancelled,1);assert.deepEqual(requests[0][0],task);assert.equal(requests[0][1].title,'Changed');
 editor.onStart({col:0,row:1} as any);const unloaded=editor.validateValue!('Again');released=true;release({});assert.equal(await unloaded,false);assert.equal(cancelled,1);
});
test('native rejection, uncertain result and missing start context cannot mutate or leak editors',async()=>{
 for(const mode of ['reject','uncertain','same']){let saves=0,cancelled=0;const editor=receiptEditor({onStart:()=>{},onEnd:()=>{},getValue:()=>''},{capture:()=>({task,fields}),save:async()=>{saves++;if(mode==='reject')throw Error('denied');return null;},active:()=>true,cancel:()=>cancelled++,style:()=>{}});
 editor.onStart({col:0,row:1} as any);assert.equal(await editor.validateValue!(mode==='same'?'Title':'Changed'),false);assert.equal(saves,mode==='same'?0:1);assert.equal(cancelled,mode==='same'?1:0);editor.onEnd();assert.equal(await editor.validateValue!('Bad'),false);assert.equal(saves,mode==='same'?0:1);}
});
test('invalid capture exits native editing without creating an input or submitting',async()=>{
 let starts=0,cancels=0,saves=0;const editor=receiptEditor({onStart:()=>starts++,onEnd:()=>{},getValue:()=>''},{capture:()=>null,save:async()=>{saves++;return null;},active:()=>true,cancel:()=>cancels++,style:()=>{}});editor.onStart({col:0,row:1} as any);assert.equal(starts,0);assert.equal(cancels,1);assert.equal(await editor.validateValue!('Bad'),false);assert.equal(saves,0);
});

test('popup receipt matching requires its submitted identity, revision, type, space and normalized content',()=>{
 const id='11111111-1111-4111-8111-111111111111',target={mode:'edit' as const,task:{id,revision:3}},submitted={title:' Title ',text:'Body',date:'',status:'open' as const};
 const receipt:any={id,kind:'todo',draft:{title:'Title',notes:'Body',dueOn:null,status:'open'},source:{id:'22222222-2222-4222-8222-222222222222',system:'website',externalId:id,version:1,asOf:'2026-10-27T00:00:00Z',original:{marker:'personal-manual-v1',spaceId:'fixture-space',type:'todo',input:{}}},revision:4,syncState:'draft',externalStatus:null};
 assert.equal(taskReceiptMatchesSubmission(target,submitted,receipt,'fixture-space'),true);
 for(const changed of [{...receipt,id:'33333333-3333-4333-8333-333333333333'},{...receipt,revision:5},{...receipt,draft:{...receipt.draft,notes:'Different command body'}}])assert.equal(taskReceiptMatchesSubmission(target,submitted,changed,'fixture-space'),false);
 assert.equal(taskReceiptMatchesSubmission(target,null,receipt,'fixture-space'),false);assert.equal(taskReceiptMatchesSubmission(target,submitted,receipt,'different-space'),false);
 assert.equal(taskReceiptMatchesSubmission(target,submitted,{...receipt,kind:'inbox',draft:{title:'Title',text:'Body',occurredOn:null,disposition:'reference'},source:{...receipt.source,original:{...receipt.source.original,type:'journal'}}},'fixture-space'),false);
});

test('native validation failures retain exact text and original revision for correction, then exit only after receipt',async()=>{
 let value=' ',closed=0,attempts:any[]=[];const native={onStart:()=>{},onEnd:()=>{value='';},getValue:()=>value};let accept=false;
 const editor=receiptEditor(native,{capture:()=>({task,fields}),save:async(t,f)=>{attempts.push([t,f]);return accept?{} as any:null;},active:()=>true,cancel:()=>{closed++;editor.onEnd();},style:()=>{}});
 editor.onStart({col:0,row:1} as any);assert.equal(await editor.validateValue!(value),false);assert.equal(value,' ');assert.equal(closed,0);assert.equal(attempts.length,0);
 value='Corrected';assert.equal(await editor.validateValue!(value),false);assert.equal(value,'Corrected');assert.equal(closed,0);assert.deepEqual(attempts[0][0],task);
 accept=true;assert.equal(await editor.validateValue!(value),false);assert.equal(closed,1);assert.deepEqual(attempts[1][0],task);
});
