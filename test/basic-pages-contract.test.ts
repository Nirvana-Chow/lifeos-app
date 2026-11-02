import test from 'node:test';import assert from 'node:assert/strict';import{existsSync}from'node:fs';
const path=new URL('../src/workbench/draft-contract.ts',import.meta.url);
test('basic business drafts have a local contract independent of a connected workspace',async()=>{
 assert.ok(existsSync(path),'Missing local business draft contract');
 const m=await import(path.href);const blank=m.emptyDraft('todo');assert.equal(blank.title,'');assert.equal(blank.dueOn,'');assert.throws(()=>m.inspectDraft('todo',blank));
 assert.equal(m.inspectDraft('todo',{...blank,title:'Synthetic title',status:'open'}).title,'Synthetic title');
});

test('drafts preserve unknown dates and validate existing domain contracts without synthetic personal defaults',async()=>{
 const m=await import(path.href);const fixtures:Record<string,Record<string,string>>={journal:{title:'Synthetic',text:'Synthetic original'},mood:{title:'Synthetic',label:'Self reported'},learning:{title:'Synthetic',topic:'Synthetic topic',status:'planned'},career:{title:'Synthetic',evidence:'Synthetic proof'},project:{title:'Synthetic',stage:'planned',completion:'not-complete',testing:'not-run'},article:{title:'Synthetic',attribution:'original'},resource:{title:'Synthetic',url:'https://example.invalid/reference'},training:{title:'Synthetic'}};
 for(const[k,v]of Object.entries(fixtures)){const values={...m.emptyDraft(k),...v};assert.equal(values.occurredOn,'');const checked=m.inspectDraft(k,values);assert.equal(checked.occurredOn,null);assert.equal(checked.title,'Synthetic');if(k==='training')assert.deepEqual(checked.record.sets,[]);}
});
test('finance uses exact existing decimal parsing and requires paired transfer accounts and refund identity',async()=>{
 const m=await import(path.href),base={...m.emptyDraft('finance'),kind:'expense',amount:'1.10',occurredOn:'2026-10-24'};assert.equal(m.inspectDraft('finance',base).amountMinor,110);assert.throws(()=>m.inspectDraft('finance',{...base,amount:'0.001'}));assert.throws(()=>m.inspectDraft('finance',{...base,kind:'transfer'}));assert.throws(()=>m.inspectDraft('finance',{...base,kind:'refund'}));assert.throws(()=>m.inspectDraft('finance',{...base,currency:'USD'}));assert.equal(m.inspectDraft('finance',{...base,kind:'transfer',fromAccountRef:'fixture-a',toAccountRef:'fixture-b'}).kind,'transfer');
});
test('calendar retains exclusive all-day end and validates offset and zone rather than inventing times',async()=>{
 const m=await import(path.href),base={...m.emptyDraft('calendar'),title:'Synthetic',scheduleKind:'all-day',startDate:'2026-10-24',endDate:'2026-10-25'};assert.equal(m.inspectDraft('calendar',base).schedule.endDate,'2026-10-25');assert.throws(()=>m.inspectDraft('calendar',{...base,endDate:base.startDate}));assert.throws(()=>m.inspectDraft('calendar',{...base,scheduleKind:'timed',startAt:'2026-10-24T10:00',endAt:'2026-10-24T11:00',timeZone:'Asia/Shanghai'}));assert.equal(m.inspectDraft('calendar',{...base,scheduleKind:'timed',startAt:'2026-10-24T10:00+08:00',endAt:'2026-10-24T11:00+08:00',timeZone:'Asia/Shanghai'}).schedule.kind,'timed');
});
test('training requires a real unit for an entered measurement, preserves unknown values and bounds rows',async()=>{
 const m=await import(path.href),base={...m.emptyDraft('training'),title:'Synthetic'},row={...m.emptyTrainingRow(),weight:'10'};assert.throws(()=>m.inspectDraft('training',base,[row]));const result=m.inspectDraft('training',base,[{...row,weightUnit:'lb'}]);assert.deepEqual(result.record.sets,[{reps:null,weight:{value:10,unit:'lb'},duration:null}]);assert.throws(()=>m.inspectDraft('training',base,[{...row,weight:'',reps:'1.5'}]));assert.throws(()=>m.inspectDraft('training',base,Array.from({length:51},m.emptyTrainingRow)));
});
test('project claims require evidence and AI draft config cannot change provider or consume a key',async()=>{
 const m=await import(path.href),base={...m.emptyDraft('project'),title:'Synthetic',stage:'active',completion:'complete',testing:'not-run'};assert.throws(()=>m.inspectDraft('project',base));assert.equal(m.inspectDraft('project',{...base,completionEvidence:'Self-reported synthetic evidence'}).record.review.decision,'pending');assert.throws(()=>m.inspectDraft('ai',{...m.emptyDraft('ai'),model:'invalid model'}));const result=m.inspectDraft('ai',{...m.emptyDraft('ai'),model:'synthetic-model',budget:'1.20'});assert.equal(result.monthlyBudgetMinor,120);assert.equal(result.provider,'volcengine-ark');assert.equal('secret'in result,false);
});

test('finance preview cannot accept an account the existing DTO would discard',async()=>{
 const m=await import(path.href),base={...m.emptyDraft('finance'),kind:'expense',amount:'1.00',occurredOn:'2026-10-24'};
 assert.throws(()=>m.inspectDraft('finance',{...base,toAccountRef:'fixture-hidden'}));
 assert.throws(()=>m.inspectDraft('finance',{...base,kind:'income',fromAccountRef:'fixture-hidden'}));
 assert.deepEqual(m.draftFields('finance',base).filter((f:any)=>f.name.endsWith('AccountRef')).map((f:any)=>f.name),['fromAccountRef']);
});
