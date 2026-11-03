import test from'node:test';import assert from'node:assert/strict';import{randomUUID}from'node:crypto';import{DraftService}from'../src/platform/service.ts';import{PostgresPlatformRepository,verifyRestrictedPool,type SqlPool}from'../src/platform/postgres.ts';import{validateAcceptanceEnvironment,acceptancePasswords,acceptancePool}from'./helpers/platform-pg.ts';
import {createPlatformAuth,readOwnerPrincipal} from '../src/platform/auth.ts';
import {syntheticIdentities} from '../src/platform/synthetic-bootstrap.ts';
import{requirements}from'../src/platform/requirements.ts';
test('OPT-IN exact configured Next HTTP + Auth + PG todo/finance/ownership acceptance; retains all synthetic records',{skip:process.env.RUN_PLATFORM_NETWORK_TESTS==='1'?false:'No approved configured Next+PG target/FD3; not executed',timeout:90000},async t=>{
 const config=validateAcceptanceEnvironment(process.env,process.execArgv),passwords=acceptancePasswords(),pool=acceptancePool(config.databaseURL),batch='fixture-network-'+randomUUID();let cookie='';const ids:string[]=[];
 const send=async(path:string,method='GET',body?:unknown,key?:string,withCookie=true,sessionCookie=cookie)=>{
  const response=await fetch(config.baseURL+'/api/platform/'+path,{method,signal:AbortSignal.timeout(8000),headers:{origin:config.baseURL,...(body===undefined?{}:{'content-type':'application/json'}),...(key?{'idempotency-key':key}:{}),...(withCookie&&sessionCookie?{cookie:sessionCookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:response.status,body:await response.json()};
 };
 try{
  await verifyRestrictedPool(pool as SqlPool);const service=new DraftService(new PostgresPlatformRepository(pool as SqlPool));
  assert.equal((await send('todos','GET',undefined,undefined,false)).status,401,'unconfigured503 is a failure, not business acceptance');const signed=await fetch(config.baseURL+'/api/platform/auth/sign-in/email',{method:'POST',signal:AbortSignal.timeout(8000),headers:{origin:config.baseURL,'content-type':'application/json'},body:JSON.stringify({email:config.ownerEmail,password:passwords.ownerA,rememberMe:false})});assert.equal(signed.status,200,'owner login; respect the60second rate window between acceptance runs');
  cookie=signed.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');assert.ok(cookie.length>0);assert.equal((await send('requirements')).body.baseline.baselineVersion,requirements().baselineVersion,'HTTP must serve the committed requirement baseline');
  const todo=await send('todos','POST',{title:batch,notes:'Synthetic HTTP acceptance only'},batch+'-todo');assert.equal(todo.status,201);const id=todo.body.entry.id;ids.push(id);const direct=await service.get(config.ownerId,'todo',id);assert.equal(direct.source.id,todo.body.entry.source.id,'HTTP and direct PG must address the same stored object');
  assert.equal((await send('todos','POST',{title:batch,notes:'Synthetic HTTP acceptance only'},batch+'-todo')).body.duplicate,true);assert.equal((await send('todos','POST',{title:batch+' changed'},batch+'-todo')).status,409);
  const pin = {type:'todo',id,sourceId:direct.source.id,revision:1};
  const project = await send('records/project','POST',{
    title:'Synthetic linked project',text:'Cross-module source acceptance',occurredOn:null,
    confirmed:true,syntheticOnly:true,
    record:{type:'project',syntheticOnly:true,stage:'active',nextStep:'Review the pinned task',
      completion:{selfReported:true,status:'not-complete',evidence:null},
      testing:{manuallyRecorded:true,outcome:'not-run',evidence:null},
      review:{decision:'pending',evidence:null},links:[pin]},
  },batch+'-project');
  assert.equal(project.status,201);
  const projectPath = 'records/project/' + project.body.entry.id;
  ids.push(project.body.entry.id);
  const review = {expectedRevision:1,decision:'accepted',evidence:'Synthetic network review',confirmed:true,syntheticOnly:true};
  assert.equal((await send(projectPath+'/review','POST',review,batch+'-review')).status,200);
  const recapPath = projectPath+'/recap?includeSynthetic=true';
  const initialRecap = await send(recapPath);
  assert.equal(initialRecap.status,200);
  assert.equal(initialRecap.body.reviewApplicable,true);
  const patched=await send('todos/'+id,'PATCH',{expectedRevision:1,status:'done'},batch+'-todo-edit');assert.equal(patched.status,200);assert.equal(patched.body.entry.revision,2);assert.equal((await send('todos/'+id,'PATCH',{expectedRevision:1,title:'stale'},batch+'-stale')).status,409);assert.equal((await send('todos/'+id)).body.entry.source.original.title,batch);
  assert.equal((await send('todos','POST',{title:batch,ownerId:'fixture-owner-b'},batch+'-forged')).status,400);assert.equal((await send('todos','POST',{title:batch,dueOn:'2026-02-30'},batch+'-date')).status,400);
  const foreignIdentity = syntheticIdentities[1];
  const foreign = await service.mutate(foreignIdentity.id, 'todo', null, {title: batch + ' secondary synthetic owner'}, batch + '-foreign');
  const foreignId = foreign.entry.id;
  ids.push(foreignId);
  const missingId = randomUUID();

  const deniedRead = await send('todos/' + foreignId);
  assert.equal(deniedRead.status, 404);
  assert.deepEqual(deniedRead, await send('todos/' + missingId));
  assert.ok(!(await send('todos')).body.items.some((entry: {id: string}) => entry.id === foreignId));
  const forbiddenEdit = {expectedRevision: 1, title: 'forbidden'};
  const deniedEdit = await send('todos/' + foreignId, 'PATCH', forbiddenEdit, batch + '-forbidden');
  assert.equal(deniedEdit.status, 404);
  assert.deepEqual(deniedEdit, await send('todos/' + missingId, 'PATCH', forbiddenEdit, batch + '-missing'));
  assert.deepEqual(await service.get(foreignIdentity.id, 'todo', foreignId), foreign.entry);

  const search = 'search/page?' + new URLSearchParams({q: batch, type: 'todo', includeSynthetic: 'true'});
  const source = (recordId: string) => 'search/source/todo/' + recordId + '?includeSynthetic=true';
  assert.equal((await send(search, 'GET', undefined, undefined, false)).status, 401);
  assert.equal((await send(source(id), 'GET', undefined, undefined, false)).status, 401);
  const matches = await send(search);
  assert.equal(matches.status, 200);
  assert.deepEqual(matches.body.items.map((entry: {id: string}) => entry.id), [id]);
  const ownSource = await send(source(id));
  assert.equal(ownSource.status, 200);
  assert.equal(ownSource.body.current.sourceId, direct.source.id);
  const corrected = await send('todos/'+id,'PATCH',{expectedRevision:2,notes:'Second synthetic correction'},batch+'-correct-again');
  assert.equal(corrected.status,200);
  assert.equal(corrected.body.entry.revision,3);
  const timeline = await send('timeline/page?includeSynthetic=true&axis=changed&timeZone=UTC');
  assert.equal(timeline.status,200);
  const events = timeline.body.items.filter((event: {id:string}) => event.id === id);
  assert.deepEqual(events.map(({sourceId,revision,currentRevision}: {sourceId:string;revision:number;currentRevision:number}) =>
    ({sourceId,revision,currentRevision})), [
    {sourceId:pin.sourceId,revision:3,currentRevision:3},
    {sourceId:pin.sourceId,revision:2,currentRevision:3},
  ]);
  const correctedSource = await send(source(id));
  assert.equal(correctedSource.status,200);
  assert.equal(correctedSource.body.current.id,id);
  assert.equal(correctedSource.body.current.sourceId,pin.sourceId);
  assert.equal(correctedSource.body.current.revision,3);
  assert.equal(correctedSource.body.original.title,batch);
  assert.equal(correctedSource.body.original.revision,1);
  assert.deepEqual(correctedSource.body.history.map((event: {revision:number}) => event.revision),[3,2,1]);
  const staleRecap = await send(recapPath);
  assert.equal(staleRecap.status,200);
  assert.equal(staleRecap.body.reviewApplicable,false);
  assert.equal(staleRecap.body.reviewApplicability,'stale-links');
  assert.deepEqual(staleRecap.body.project.draft.record.links,[pin]);
  assert.deepEqual(staleRecap.body.project.source.original.record.links,[pin]);
  assert.equal((await send(projectPath+'/review','POST',{...review,expectedRevision:2},batch+'-stale-review')).status,409);
  t.diagnostic('Cross-module source, timeline revision, and stale project recap verified over Next HTTP and PostgreSQL.');
  const foreignSource = await send(source(foreignId));
  assert.equal(foreignSource.status, 404);
  assert.deepEqual(foreignSource, await send(source(missingId)));

  // Sign B in separately so A's real Next sign-in rate-limit sequence is preserved.
  const foreignConfig = {...config, ownerId: foreignIdentity.id, ownerEmail: foreignIdentity.email};
  const foreignAuth = createPlatformAuth(foreignConfig, pool);
  const foreignLogin = await foreignAuth.handler(new Request(config.baseURL + '/api/platform/auth/sign-in/email', {
    method: 'POST',
    headers: {origin: config.baseURL, 'content-type': 'application/json', 'x-platform-client': '127.0.0.2'},
    body: JSON.stringify({email: foreignIdentity.email, password: passwords.ownerB, rememberMe: false}),
  }));
  assert.equal(foreignLogin.status, 200);
  const foreignCookie = foreignLogin.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  assert.equal((await readOwnerPrincipal(foreignAuth, foreignConfig, new Headers({cookie: foreignCookie})))?.userId, foreignIdentity.id);
  for (const route of [search, source(id)]) {
    const denied = await send(route, 'GET', undefined, undefined, true, foreignCookie);
    assert.equal(denied.status, 401);
    assert.deepEqual(denied, await send(route, 'GET', undefined, undefined, false));
  }
  t.diagnostic('Synthetic cross-account search and source isolation verified over Next HTTP and PostgreSQL.');
  const draft={kind:'expense',amountMinor:1200,currency:'CNY',occurredOn:'2026-10-22',fromAccountRef:'fixture-wallet',notes:batch};const expense=await send('finance','POST',draft,batch+'-expense');assert.equal(expense.status,201);const expenseId=expense.body.entry.id;ids.push(expenseId);
  const refund=await send('finance','POST',{...draft,kind:'refund',amountMinor:300,originalEntryId:expenseId},batch+'-refund');assert.equal(refund.status,201);ids.push(refund.body.entry.id);assert.equal((await send('finance/'+expenseId,'PATCH',{expectedRevision:1,kind:'income'},batch+'-invalid-source')).status,409);
  assert.equal((await send('finance','POST',{...draft,amountMinor:1.5},batch+'-fraction')).status,400);assert.equal((await send('finance','POST',{...draft,kind:'transfer',toAccountRef:'fixture-wallet'},batch+'-same-account')).status,400);
  for(const kind of ['income','transfer','repayment']){const entry=await send('finance','POST',{...draft,kind,toAccountRef:'fixture-savings'},batch+'-'+kind);assert.equal(entry.status,201);assert.equal(entry.body.entry.draft.kind,kind);ids.push(entry.body.entry.id);}
  const foreignExpense=await service.mutate('fixture-owner-b','finance',null,draft,batch+'-foreign-expense');ids.push(foreignExpense.entry.id);assert.equal((await send('finance/'+foreignExpense.entry.id)).status,404);assert.ok(!(await send('finance')).body.items.some((entry:{id:string})=>entry.id===foreignExpense.entry.id));assert.equal((await send('finance','POST',{...draft,kind:'refund',originalEntryId:foreignExpense.entry.id},batch+'-foreign-refund')).status,404);
  assert.equal((await send('finance','POST',draft,batch+'-expense')).body.duplicate,true);const financeEdit=await send('finance/'+expenseId,'PATCH',{expectedRevision:1,notes:batch+' reviewed'},batch+'-finance-edit');assert.equal(financeEdit.status,200);assert.equal((await service.get(config.ownerId,'finance',expenseId)).revision,2);assert.equal((await send('finance','DELETE')).status,405);
  const inboxDraft={title:batch+' inbox',text:'Fictional incoming note only',occurredOn:null,disposition:'pending'};const incoming=await send('inbox','POST',inboxDraft,batch+'-inbox');assert.equal(incoming.status,201);const inboxId=incoming.body.entry.id;ids.push(inboxId);const conversion=await send('inbox/'+inboxId+'/to-todo','POST',{expectedRevision:1},batch+'-convert');assert.equal(conversion.status,201);assert.equal(conversion.body.entry.inboxId,inboxId);ids.push(conversion.body.entry.id);assert.equal((await send('inbox/'+inboxId+'/to-todo','POST',{expectedRevision:1},batch+'-convert')).body.duplicate,true);assert.equal((await send('inbox/'+inboxId+'/to-todo','POST',{expectedRevision:2},batch+'-convert-again')).status,409);assert.equal((await service.get(config.ownerId,'inbox',inboxId)).revision,2);assert.equal((await send('inbox/'+inboxId,'PATCH',{expectedRevision:2,text:'Later correction'},batch+'-inbox-edit')).status,200);assert.equal((await send('todos/'+conversion.body.entry.id)).body.entry.draft.notes,inboxDraft.text);const history=await send('inbox/'+inboxId+'/history');assert.equal(history.status,200);assert.deepEqual(history.body.history.map((e:{revision:number})=>e.revision),[3,2,1]);assert.ok(history.body.history.every((e:Record<string,unknown>)=>!('ownerId'in e)));const reference=await send('inbox','POST',{...inboxDraft,disposition:'no_action'},batch+'-reference');assert.equal(reference.status,201);assert.equal((await send('inbox/'+reference.body.entry.id+'/to-todo','POST',{expectedRevision:1},batch+'-no-action')).status,409);const foreignInbox=await service.mutate('fixture-owner-b','inbox',null,inboxDraft,batch+'-foreign-inbox');assert.equal((await send('inbox/'+foreignInbox.entry.id)).status,404);assert.equal((await send('inbox/'+foreignInbox.entry.id+'/to-todo','POST',{expectedRevision:1},batch+'-foreign-convert')).status,404);
  const exported=await send('export');assert.equal(exported.status,200);assert.equal(exported.body.format,'lifeos.review.export.v2');assert.ok(exported.body.entries.some((e:{id:string})=>e.id===inboxId));assert.ok(!exported.body.entries.some((e:{id:string})=>e.id===foreign.entry.id||e.id===foreignInbox.entry.id));assert.ok(exported.body.entries.every((e:Record<string,unknown>)=>!('ownerId'in e)));
  assert.equal((await send('auth/sign-out','POST',{})).status,200);assert.equal((await send('todos')).status,401);
  const loginAttempt=(password:string)=>fetch(config.baseURL+'/api/platform/auth/sign-in/email',{method:'POST',signal:AbortSignal.timeout(8000),headers:{origin:config.baseURL,'content-type':'application/json'},body:JSON.stringify({email:config.ownerEmail,password,rememberMe:false})});
  for(let i=0;i<2;i++){const bad=await loginAttempt('wrong-synthetic-password');assert.equal(bad.status,401);await bad.arrayBuffer();}
  const limited=await loginAttempt('wrong-synthetic-password');assert.equal(limited.status,429,'fourth actual Next HTTP attempt is limited');await limited.arrayBuffer();
  const counters=await pool.query('SELECT count FROM lifeos_platform.platform_rate_limit WHERE key LIKE $1 AND count >= 3',['%sign-in/email%']);assert.ok(counters.rowCount&&counters.rowCount>0,'the limited route has a persisted PG counter');
  t.diagnostic('Actual Next HTTP429 and PG counter verified; waiting for the natural rate window, without counter reset.');
  await new Promise(resolve=>setTimeout(resolve,31000));await new Promise(resolve=>setTimeout(resolve,30000));
  const recovered=await loginAttempt(passwords.ownerA);assert.equal(recovered.status,200,'natural window permits login again');const recoveredCookie=recovered.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');await recovered.arrayBuffer();cookie=recoveredCookie;assert.equal((await send('auth/sign-out','POST',{})).status,200);
  t.diagnostic('Actual rate-limit recovery passed; no PG/process restart or backup/restore claimed.');t.diagnostic(JSON.stringify({batch,syntheticRecordIds:ids,recordsRetained:true,processRestartTested:false,databaseRestartTested:false,backupRestoreTested:false}));
 }finally{await pool.end();}
});
