import test from 'node:test';
import assert from 'node:assert/strict';
import type {TrustedActor} from '../src/agent-authority/contracts.ts';
import {fixture} from './helpers/classification-service-fixture.ts';
const config={ownerId:'fixture-owner',spaceId:'fixture-space'};

const body=(p:{planId:string;digest:string})=>({planId:p.planId,digest:p.digest,confirmed:true});
const status=(n:number)=>(e:unknown)=>!!e&&typeof e==='object'&&'status'in e&&e.status===n;
test('read-only producer previews without business write permission and preview writes only immutable plan',async()=>{const f=await fixture();f.setWritable(false);const prior=structuredClone(f.port.rows),hist=f.port.historyRows.length;const p=await f.service.preview(f.agent,{changes:f.changes});assert.equal(p.changes.length,2);assert.equal(f.port.plans.size,1);assert.deepEqual(f.port.rows,prior);assert.equal(f.port.historyRows.length,hist);assert.equal(f.port.classificationReceipts.size,0);});
test('owner commits a read-only producer plan without widening grant; API commit remains denied',async()=>{const f=await fixture(),p=await f.service.preview(f.agent,{changes:f.changes});await f.service.approve(f.owner,body(p));await assert.rejects(f.service.commit(f.agent,body(p),'api-no-write'),status(403));const result=await f.service.commit(f.owner,body(p),'owner-command');assert.equal(result.entries.length,2);for(const old of f.todos){const current=f.port.rows.get(old.id)!;assert.equal(current.revision,2);assert.deepEqual({...current,draft:old.draft,revision:old.revision,updatedAt:old.updatedAt},{...old,ownerId:config.ownerId});assert.deepEqual({...current.draft,personal:undefined},{...old.draft,personal:undefined});}await assert.rejects(f.service.commit(f.agent,body(p),'owner-command'),status(403));});
test('last change conflict rolls back every record history and receipt',async()=>{const f=await fixture(),p=await f.service.preview(f.agent,{changes:f.changes});await f.service.approve(f.owner,body(p));f.port.rows.get(f.todos[1].id)!.revision++;const prior=structuredClone(f.port.rows),hist=f.port.historyRows.length;await assert.rejects(f.service.commit(f.owner,body(p),'last-conflict'),status(409));assert.deepEqual(f.port.rows,prior);assert.equal(f.port.historyRows.length,hist);assert.equal(f.port.classificationReceipts.size,0);});
test('agent cannot self approve and run cannot approve or commit even a replay',async()=>{const f=await fixture(true),p=await f.service.preview(f.agent,{changes:f.changes});await assert.rejects(f.service.approve(f.agent,body(p)),status(403));await f.service.approve(f.owner,body(p));await f.service.commit(f.agent,body(p),'run-command');const run={kind:'run-capability',ownerId:config.ownerId,spaceId:config.spaceId,runId:'run',capabilityRef:'ref'} as TrustedActor;for(const actor of [run,{...f.owner} as TrustedActor]){await assert.rejects(f.service.commit(actor,body(p),'run-command'),status(403));await assert.rejects(f.service.approve(actor,body(p)),status(403));}});
test('owner approval cannot bypass producer revocation, lost read scopes, policy or producer revision',async()=>{for(const mutate of [(f:Awaited<ReturnType<typeof fixture>>)=>f.setActive(false),(f:Awaited<ReturnType<typeof fixture>>)=>f.setScopes(['todo:read']),(f:Awaited<ReturnType<typeof fixture>>)=>f.setRevision('grant-v2'),(f:Awaited<ReturnType<typeof fixture>>)=>f.setPolicy('policy-v2')]){const f=await fixture(),p=await f.service.preview(f.agent,{changes:f.changes});await f.service.approve(f.owner,body(p));mutate(f);const prior=structuredClone(f.port.rows);await assert.rejects(f.service.commit(f.owner,body(p),'revoked-command'));assert.deepEqual(f.port.rows,prior);assert.equal(f.port.classificationReceipts.size,0);}});
test('receipt replay after expiry and subsequent edit is historical across owner and API; altered body conflicts before lookup',async()=>{const f=await fixture(true),p=await f.service.preview(f.agent,{changes:f.changes});await f.service.approve(f.owner,body(p));const result=await f.service.commit(f.owner,body(p),'same-command');f.port.rows.get(f.todos[0].id)!.revision++;f.setNow(Date.parse(p.expiresAt)+1);const count=f.port.historyRows.length;assert.deepEqual(await f.service.commit(f.agent,body(p),'same-command'),{...result,duplicate:true});assert.equal(f.port.historyRows.length,count);await assert.rejects(f.service.commit(f.owner,{...body(p),planId:'00000000-0000-4000-8000-000000000099'},'same-command'),status(409));f.setActive(false);await assert.rejects(f.service.commit(f.owner,body(p),'same-command'),status(403));});
test('no-op null plan is consumed once with zero history and distinct commands conflict',async()=>{const f=await fixture(),changes=f.changes.map(c=>({...c,after:{project:null,domain:null,topics:[]}})),p=await f.service.preview(f.agent,{changes});await f.service.approve(f.owner,body(p));const hist=f.port.historyRows.length;const result=await f.service.commit(f.owner,body(p),'noop-command-a');assert.equal(f.port.historyRows.length,hist);assert.ok(result.entries.every(e=>e.personal===null&&e.revision===1));await assert.rejects(f.service.commit(f.owner,body(p),'noop-command-b'),status(409));});
test('expired plan, current owner session and owner write permission fail closed',async()=>{for(const change of [(f:Awaited<ReturnType<typeof fixture>>,expiry:string)=>f.setNow(Date.parse(expiry)+1),(f:Awaited<ReturnType<typeof fixture>>)=>f.setSession(false),(f:Awaited<ReturnType<typeof fixture>>)=>f.setWritable(false)]){const f=await fixture(),p=await f.service.preview(f.agent,{changes:f.changes});await f.service.approve(f.owner,body(p));change(f,p.expiresAt);await assert.rejects(f.service.commit(f.owner,body(p),'closed-command'));assert.equal(f.port.classificationReceipts.size,0);}});

test('preview rejects before/source/type/revision substitutions and max revision without partial storage',async()=>{for(const mutate of [(f:Awaited<ReturnType<typeof fixture>>)=>({...f.changes[0],before:{project:null,domain:null,topics:[]}}),(f:Awaited<ReturnType<typeof fixture>>)=>({...f.changes[0],todo:{...f.changes[0].todo,sourceId:f.project.id}}),(f:Awaited<ReturnType<typeof fixture>>)=>({...f.changes[0],after:{...f.changes[0].after,domain:f.changes[0].after.project}}),(f:Awaited<ReturnType<typeof fixture>>)=>({...f.changes[0],after:{...f.changes[0].after,project:{...f.changes[0].after.project,revision:2}}})]){const f=await fixture();await assert.rejects(f.service.preview(f.agent,{changes:[mutate(f)]}),status(409));assert.equal(f.port.plans.size,0);}const f=await fixture();f.port.rows.get(f.todos[0].id)!.revision=2147483647;await assert.rejects(f.service.preview(f.agent,{changes:[{...f.changes[0],todo:{...f.changes[0].todo,expectedRevision:2147483647}}]}),status(409));});
test('private owner policy accepts only branded current owner and finite server-owned operation IDs',async()=>{const f=await fixture();await f.authority.assertCurrentAuthority(f.owner,'reviewTodoClassification');await f.authority.assertCurrentAuthority(f.owner,'approveTodoClassification');for(const id of ['approveTodoClassification','reviewTodoClassification','previewSelectionTodoClassification'])await assert.rejects(f.authority.assertCurrentAuthority(f.agent,id));await assert.rejects(f.authority.assertCurrentAuthority(f.owner,'unknownPrivateOperation'));await assert.rejects(f.authority.assertCurrentAuthority({...f.owner},'approveTodoClassification'));});

test('owner authority lost between writes rolls back first row and all histories',async()=>{const f=await fixture(),p=await f.service.preview(f.agent,{changes:f.changes});await f.service.approve(f.owner,body(p));const before=structuredClone(f.port.rows),history=f.port.historyRows.length,original=f.port.classificationTransaction.bind(f.port);f.port.classificationTransaction=(owner,space,key,fn)=>original(owner,space,key,tx=>fn({...tx,write:async(entry,raw,create)=>{await tx.write(entry,raw,create);f.setSession(false);}}));await assert.rejects(f.service.commit(f.owner,body(p),'late-revoke-command'),status(403));assert.deepEqual(f.port.rows,before);assert.equal(f.port.historyRows.length,history);assert.equal(f.port.classificationReceipts.size,0);});
test('approval digest, policy and producer binding substitution never writes business data',async()=>{for(const patch of [{bindingsDigest:'b'.repeat(64)},{policyRevision:'other-policy'},{producerAuthorizationRevision:'c'.repeat(64)}]){const f=await fixture(),p=await f.service.preview(f.agent,{changes:f.changes});await f.service.approve(f.owner,body(p));const key=JSON.stringify([config.ownerId,config.spaceId,p.planId]);f.port.approvals.set(key,{...f.port.approvals.get(key)!,...patch});const before=structuredClone(f.port.rows);await assert.rejects(f.service.commit(f.owner,body(p),'approval-invalid'));assert.deepEqual(f.port.rows,before);assert.equal(f.port.classificationReceipts.size,0);}});
test('100 distinct no-op entries qualify and 101 never produces a plan',async()=>{const f=await fixture();const original=f.port.rows.get(f.todos[0].id)!;const changes=Array.from({length:100},(_,i)=>{const id=`00000000-0000-4000-8000-${String(i+1000).padStart(12,'0')}`,row=structuredClone(original);row.id=id;row.source.id=id;row.source.externalId=id;f.port.rows.set(id,row);return{todo:{id,sourceId:id,expectedRevision:1},before:null,after:{project:null,domain:null,topics:[]}};});const p=await f.service.preview(f.agent,{changes});assert.equal(p.unchangedIds.length,100);const selected=await f.service.previewSelection(f.owner,p.planId,{selectedTodoIds:changes.map(c=>c.todo.id).reverse()});assert.equal(selected.changes.length,100);assert.deepEqual(selected.changes,p.changes);await assert.rejects(f.service.preview(f.agent,{changes:[...changes,changes[0]]}),status(400));assert.equal(f.port.plans.size,2);});

for(const action of ['approve','commit'] as const)test('plan expiry reached while acquiring physical locks rejects '+action+' before writes',async()=>{const f=await fixture(),p=await f.service.preview(f.agent,{changes:f.changes});if(action==='commit')await f.service.approve(f.owner,body(p));const original=f.port.classificationTransaction.bind(f.port);f.port.classificationTransaction=(owner,space,key,fn)=>original(owner,space,key,tx=>fn({...tx,get:async(kind,id)=>{const row=await tx.get(kind,id);f.setNow(Date.parse(p.expiresAt)+1);return row;}}));const before=structuredClone(f.port.rows);await assert.rejects(action==='approve'?f.service.approve(f.owner,body(p)):f.service.commit(f.owner,body(p),'lock-expiry-command'),status(409));assert.deepEqual(f.port.rows,before);assert.equal(f.port.classificationReceipts.size,0);if(action==='approve')assert.equal(f.port.approvals.size,0);});

for(const revoked of [true,false])test('repeated approval after plan-lock wait '+(revoked?'rejects a revoked owner session':'returns the original approval for a current owner'),async()=>{
 const f=await fixture(),p=await f.service.preview(f.agent,{changes:f.changes}),approval=await f.service.approve(f.owner,body(p));
 const before={approvals:structuredClone(f.port.approvals),rows:structuredClone(f.port.rows),history:structuredClone(f.port.historyRows),receipts:structuredClone(f.port.classificationReceipts)};
 let entered!:()=>void,release!:()=>void;const waiting=new Promise<void>(resolve=>{entered=resolve;}),resume=new Promise<void>(resolve=>{release=resolve;});
 const original=f.port.classificationTransaction.bind(f.port);
 f.port.classificationTransaction=(owner,space,key,fn)=>original(owner,space,key,tx=>fn({...tx,lockClassificationPlan:async id=>{await tx.lockClassificationPlan(id);entered();await resume;}}));
 const work=f.service.approve(f.owner,body(p));
 try{
  await Promise.race([waiting,work.then(()=>assert.fail('Approval bypassed the plan-lock barrier'))]);if(revoked)f.setSession(false);release();
  if(revoked)await assert.rejects(work,status(403));else assert.deepEqual(await work,approval);
  assert.deepEqual({approvals:f.port.approvals,rows:f.port.rows,history:f.port.historyRows,receipts:f.port.classificationReceipts},before);
 }finally{release();await work.catch(()=>{});f.port.classificationTransaction=original;}
});

import type {InboxDraft} from '../src/platform/domain.ts';
import {classificationPlanDigest} from '../src/personal-candidate/classification-contracts.ts';
import type {ClassificationChange} from '../src/personal-candidate/classification-contracts.ts';
const emptyRelations={project:null,domain:null,topics:[]};
async function historical(){
 const f=await fixture(),initial=await f.service.preview(f.agent,{changes:f.changes});
 await f.service.approve(f.owner,body(initial));await f.service.commit(f.owner,body(initial),'historical-setup');
 const project=(await f.personal.mutate(config.ownerId,'project',f.project.id,{spaceId:config.spaceId,confirmed:true,expectedRevision:1,fields:{title:'Updated project',text:'',occurredOn:null,personal:(f.project.draft as InboxDraft).personal}},'historical-edit')).entry;
 const changes:ClassificationChange[]=f.changes.map(c=>({...c,todo:{...c.todo,expectedRevision:2},before:c.after,after:emptyRelations}));
 return{...f,changes,updatedProject:project};
}
for(const mode of ['refresh','remove','replace'] as const)test('historical before remains truthful while preview can '+mode+' an updated target',async()=>{
 const f=await historical();let after=emptyRelations as ClassificationChange['after'];
 if(mode==='refresh')after={...emptyRelations,project:{id:f.project.id,sourceId:f.project.source.id,revision:2}};
 if(mode==='replace'){const p=(await f.personal.mutate(config.ownerId,'project',null,{spaceId:config.spaceId,confirmed:true,fields:{title:'Replacement',text:'',occurredOn:null,personal:(f.project.draft as InboxDraft).personal}},'replacement-project')).entry;after={...emptyRelations,project:{id:p.id,sourceId:p.source.id,revision:1}};}
 const before=structuredClone(f.port.rows),history=f.port.historyRows.length;
 const p=await f.service.preview(f.agent,{changes:f.changes.map(c=>({...c,after}))});
 assert.equal(p.changes[0].before!.project!.revision,1);assert.match([...f.port.plans.values()].find(v=>v.preview.planId===p.planId)!.referenceObservationDigest!,/^[a-f0-9]{64}$/);
 assert.deepEqual(f.port.rows,before);assert.equal(f.port.historyRows.length,history);
 await f.service.approve(f.owner,body(p));const result=await f.service.commit(f.owner,body(p),'historical-'+mode);assert.equal(result.entries[0].revision,3);assert.deepEqual(result.entries[0].personal,after);
});
for(const action of ['approve','commit'] as const)test('before-only target edit after preview rejects '+action+' with no partial effects',async()=>{
 const f=await historical(),p=await f.service.preview(f.agent,{changes:f.changes});if(action==='commit')await f.service.approve(f.owner,body(p));
 await f.personal.mutate(config.ownerId,'project',f.project.id,{spaceId:config.spaceId,confirmed:true,expectedRevision:2,fields:{title:'Later edit',text:'',occurredOn:null,personal:(f.updatedProject.draft as InboxDraft).personal}},'historical-later');
 const before=structuredClone(f.port.rows),history=f.port.historyRows.length,receipts=f.port.classificationReceipts.size;
 await assert.rejects(action==='approve'?f.service.approve(f.owner,body(p)):f.service.commit(f.owner,body(p),'observation-conflict'),status(409));
 assert.deepEqual(f.port.rows,before);assert.equal(f.port.historyRows.length,history);assert.equal(f.port.classificationReceipts.size,receipts);assert.equal((await f.service.review(f.owner,p.planId)).stale,true);
});
test('historical before never relaxes current after or target owner/type/source/existence/ahead checks',async()=>{
 for(const bad of ['after-old','after-ahead','source','type','foreign','space','missing','before-ahead']){
  const f=await historical(),changes=structuredClone(f.changes),target=f.port.rows.get(f.project.id)!;
  if(bad==='after-old'||bad==='after-ahead')changes[0]={...changes[0],after:{...emptyRelations,project:{id:f.project.id,sourceId:f.project.source.id,revision:bad==='after-old'?1:3}}};
  if(bad==='source')target.source.id=f.todos[0].source.id;
  if(bad==='type')(target.source.original as {type:string}).type='domain';
  if(bad==='foreign')target.ownerId='foreign-owner';
  if(bad==='space')(target.source.original as {spaceId:string}).spaceId='other-space';
  if(bad==='missing')f.port.rows.delete(target.id);
  if(bad==='before-ahead'){const ahead={...changes[0].before!,project:{...changes[0].before!.project!,revision:3}};changes[0]={...changes[0],before:ahead};(f.port.rows.get(f.todos[0].id)!.draft as import('../src/platform/domain.ts').TodoDraft).personal=ahead;}
  const plans=f.port.plans.size;await assert.rejects(f.service.preview(f.agent,{changes}),status(409));assert.equal(f.port.plans.size,plans);
 }
});
test('legacy plan without observations keeps strict target equality and tampering never grants approval',async()=>{
 for(const mode of ['legacy','observation','digest']){const f=await historical(),p=await f.service.preview(f.agent,{changes:f.changes}),key=JSON.stringify([config.ownerId,config.spaceId,p.planId]),stored=structuredClone(f.port.plans.get(key)!);
  if(mode==='legacy')delete (stored as {referenceObservationDigest?:string}).referenceObservationDigest;else (stored as {referenceObservationDigest:string}).referenceObservationDigest='b'.repeat(64);
  if(mode!=='digest')(stored.preview as {digest:string}).digest=classificationPlanDigest(stored);
  f.port.plans.set(key,stored);const approvals=f.port.approvals.size;await assert.rejects(f.service.approve(f.owner,body(stored.preview)));assert.equal(f.port.approvals.size,approvals);
 }
});
test('read-only review restores validated historical receipt with writes disabled after expiry edits and policy change',async()=>{
 const f=await fixture(),p=await f.service.preview(f.agent,{changes:f.changes});assert.equal((await f.service.review(f.owner,p.planId)).receipt,null);
 await f.service.approve(f.owner,body(p));const result=await f.service.commit(f.owner,body(p),'review-receipt');
 await f.personal.mutate(config.ownerId,'todo',f.todos[0].id,{spaceId:config.spaceId,confirmed:true,expectedRevision:2,fields:{...f.todos[0].draft,title:'Later title',personal:f.changes[0].after}},'review-later-edit');
 f.setWritable(false);f.setNow(Date.parse(p.expiresAt)+1);f.setPolicy('changed-policy');const before=structuredClone(f.port.rows),history=f.port.historyRows.length;
 const review=await f.service.review(f.owner,p.planId);assert.equal(review.committed,true);assert.equal(review.stale,true);assert.deepEqual(review.receipt,result);assert.equal(review.labels.todos.find(t=>t.id===f.todos[0].id)!.title,'Later title');assert.deepEqual(f.port.rows,before);assert.equal(f.port.historyRows.length,history);
 for(const mutate of [()=>f.setActive(false),()=>{f.setActive(true);f.setScopes(['todo:read']);},()=>{f.setScopes(['todo:read','organization:read']);f.setSession(false);}]){mutate();await assert.rejects(f.service.review(f.owner,p.planId),status(403));}
});
test('review rejects corrupt DAO receipt instead of returning committed or unchecked historical data',async()=>{
 const f=await fixture(),p=await f.service.preview(f.agent,{changes:f.changes});await f.service.approve(f.owner,body(p));await f.service.commit(f.owner,body(p),'corrupt-receipt');
 const receipt=structuredClone([...f.port.classificationReceipts.values()][0]);(receipt.result.entries[0] as {revision:number}).revision=88;
 const original=f.port.classificationTransaction.bind(f.port);f.port.classificationTransaction=(o,s,k,fn)=>original(o,s,k,tx=>fn({...tx,classificationPlanReceipt:async()=>receipt}));
 await assert.rejects(f.service.review(f.owner,p.planId),status(400));
});
test('selection keeps original producer expiry snapshot and base order without writing business or granting approval',async()=>{
 const f=await fixture(),p=await f.service.preview(f.agent,{changes:f.changes});f.setNow(Date.parse(p.expiresAt)-1000);f.setWritable(false);
 const before=structuredClone(f.port.rows),history=f.port.historyRows.length;
 const selected=await f.service.previewSelection(f.owner,p.planId,{selectedTodoIds:[f.todos[1].id,f.todos[0].id]});assert.deepEqual(selected.changes,p.changes);assert.equal(selected.expiresAt,p.expiresAt);assert.notEqual(selected.planId,p.planId);assert.notEqual(selected.digest,p.digest);
 const old=[...f.port.plans.values()].find(v=>v.preview.planId===p.planId)!,derived=[...f.port.plans.values()].find(v=>v.preview.planId===selected.planId)!;
 for(const key of ['grantId','producerAuthorizationRevision','policyRevision'] as const)assert.equal(derived[key],old[key]);assert.equal(f.port.approvals.size,0);assert.deepEqual(f.port.rows,before);assert.equal(f.port.historyRows.length,history);
 const subset=await f.service.previewSelection(f.owner,p.planId,{selectedTodoIds:[f.todos[1].id]});assert.deepEqual(subset.changes,[p.changes[1]]);assert.notEqual([...f.port.plans.values()].find(v=>v.preview.planId===subset.planId)!.referenceObservationDigest,old.referenceObservationDigest);
});
test('selection rejects malformed inputs, extra fields and non-owner actors',async()=>{
 const f=await fixture(),p=await f.service.preview(f.agent,{changes:f.changes});
 for(const input of [{selectedTodoIds:[]},{selectedTodoIds:Array(101).fill(f.todos[0].id)},{selectedTodoIds:[f.todos[0].id,f.todos[0].id]},{selectedTodoIds:['bad']},{selectedTodoIds:[f.project.id]},{selectedTodoIds:[f.todos[0].id],changes:f.changes},{selectedTodoIds:[f.todos[0].id],referenceObservationDigest:'a'.repeat(64)}])await assert.rejects(f.service.previewSelection(f.owner,p.planId,input),status(400));
 await assert.rejects(f.service.previewSelection(f.agent,p.planId,{selectedTodoIds:[f.todos[0].id]}),status(403));assert.equal(f.port.plans.size,1);
});
for(const invalid of ['unselected','approved','consumed','expired','revoked','policy','producer','run'])test('selection refuses '+invalid+' base rather than refreshing or elevating it',async()=>{
 const f=await fixture(),p=await f.service.preview(f.agent,{changes:f.changes});
 if(invalid==='unselected')f.port.rows.get(f.todos[1].id)!.revision++;
 if(invalid==='approved'||invalid==='consumed')await f.service.approve(f.owner,body(p));
 if(invalid==='consumed')await f.service.commit(f.owner,body(p),'subset-consumed');
 if(invalid==='expired')f.setNow(Date.parse(p.expiresAt));if(invalid==='revoked')f.setActive(false);if(invalid==='policy')f.setPolicy('other-policy');if(invalid==='producer')f.setRevision('b'.repeat(64));
 if(invalid==='run'){const key=JSON.stringify([config.ownerId,config.spaceId,p.planId]),stored={...f.port.plans.get(key)!,runProvenance:{runId:'run',capabilityRef:'cap'}};stored.preview={...stored.preview,digest:classificationPlanDigest(stored)};f.port.plans.set(key,stored);}
 const rows=structuredClone(f.port.rows),history=f.port.historyRows.length,plans=f.port.plans.size;await assert.rejects(f.service.previewSelection(f.owner,p.planId,{selectedTodoIds:[f.todos[0].id]}));assert.equal(f.port.plans.size,plans);assert.deepEqual(f.port.rows,rows);assert.equal(f.port.historyRows.length,history);
});
for(const operation of ['review','selection'] as const)test(operation+' rechecks owner MFA after a plan-lock wait',async()=>{
 const f=await fixture(),p=await f.service.preview(f.agent,{changes:f.changes}),original=f.port.classificationTransaction.bind(f.port);f.port.classificationTransaction=(o,s,k,fn)=>original(o,s,k,tx=>fn({...tx,lockClassificationPlan:async id=>{await tx.lockClassificationPlan(id);f.setSession(false);}}));
 await assert.rejects(operation==='review'?f.service.review(f.owner,p.planId):f.service.previewSelection(f.owner,p.planId,{selectedTodoIds:[f.todos[0].id]}),status(403));assert.equal(f.port.plans.size,1);
});

test('observation canonical input deduplicates shared targets and uses physical order independent of change order',async()=>{
 const f=await fixture(),id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 for(const [old,n,source] of [[f.todos[0],1,4],[f.todos[1],2,5],[f.project,3,6]] as const){const row=structuredClone(f.port.rows.get(old.id)!);row.id=id(n);row.source.id=id(source);row.source.externalId=row.id;f.port.rows.set(row.id,row);}
 const changes=[2,1].map(n=>({todo:{id:id(n),sourceId:id(n+3),expectedRevision:1},before:null,after:{project:{id:id(3),sourceId:id(6),revision:1},domain:null,topics:[]}}));
 const p=await f.service.preview(f.agent,{changes}),plan=[...f.port.plans.values()].find(v=>v.preview.planId===p.planId)!;
 // Independently calculated SHA256 of the fixed v1 canonical input, not a call to the implementation's digest helper.
 assert.equal(plan.referenceObservationDigest,'278535cd2ce6b31b571f007fd51add276134092af17703ce3b02d6f084f8f0ab');
 const reverse=await f.service.preview(f.agent,{changes:[...changes].reverse()});assert.equal([...f.port.plans.values()].find(v=>v.preview.planId===reverse.planId)!.referenceObservationDigest,plan.referenceObservationDigest);
});
test('selection validates unselected before-only targets and never upgrades a stale legacy base',async()=>{
 for(const legacy of [false,true]){const f=await historical(),changes=[{...f.changes[0],before:null,todo:{...f.changes[0].todo,expectedRevision:1}},f.changes[1]];
  // Selected entry has no dependency on project; only the unselected entry observes it.
  const row=f.port.rows.get(f.todos[0].id)!;row.revision=1;delete (row.draft as import('../src/platform/domain.ts').TodoDraft).personal;
  const p=await f.service.preview(f.agent,{changes}),key=JSON.stringify([config.ownerId,config.spaceId,p.planId]);
  if(legacy){const stored=structuredClone(f.port.plans.get(key)!);delete (stored as {referenceObservationDigest?:string}).referenceObservationDigest;(stored.preview as {digest:string}).digest=classificationPlanDigest(stored);f.port.plans.set(key,stored);}else await f.personal.mutate(config.ownerId,'project',f.project.id,{spaceId:config.spaceId,confirmed:true,expectedRevision:2,fields:{title:'Unselected dependency changed',text:'',occurredOn:null,personal:(f.project.draft as InboxDraft).personal}},'unselected-project-edit');
  const plans=f.port.plans.size;await assert.rejects(f.service.previewSelection(f.owner,p.planId,{selectedTodoIds:[f.todos[0].id]}),status(409));assert.equal(f.port.plans.size,plans);
 }
});
test('selection rechecks expiry after records and approved or expired base wins before unknown member validation',async()=>{
 for(const reason of ['lock-expiry','approved','expired']){const f=await fixture(),p=await f.service.preview(f.agent,{changes:f.changes});
  if(reason==='approved')await f.service.approve(f.owner,body(p));if(reason==='expired')f.setNow(Date.parse(p.expiresAt));
  if(reason==='lock-expiry'){const original=f.port.classificationTransaction.bind(f.port);f.port.classificationTransaction=(o,s,k,fn)=>original(o,s,k,tx=>fn({...tx,get:async(kind,id)=>{const row=await tx.get(kind,id);f.setNow(Date.parse(p.expiresAt));return row;}}));}
  await assert.rejects(f.service.previewSelection(f.owner,p.planId,{selectedTodoIds:[reason==='lock-expiry'?f.todos[0].id:f.project.id]}),status(409));assert.equal(f.port.plans.size,1);
 }
});
test('memory plan receipt DAO filters both owner and space and review committed follows only the validated receipt',async()=>{
 const f=await fixture(),p=await f.service.preview(f.agent,{changes:f.changes});await f.service.approve(f.owner,body(p));const result=await f.service.commit(f.owner,body(p),'scoped-receipt');
 for(const [owner,space] of [['foreign-owner',config.spaceId],[config.ownerId,'foreign-space']])await f.port.classificationTransaction(owner,space,'scoped-read',async tx=>assert.equal(await tx.classificationPlanReceipt(p.planId),null));
 const original=f.port.classificationTransaction.bind(f.port);f.port.classificationTransaction=(o,s,k,fn)=>original(o,s,k,tx=>fn({...tx,classificationPlanCommitted:async()=>false}));const review=await f.service.review(f.owner,p.planId);assert.equal(review.committed,true);assert.deepEqual(review.receipt,result);
});
