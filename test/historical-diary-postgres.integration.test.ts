import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {Pool} from 'pg';
import {SyntheticDiaryImport,type AuthorizeDiary} from '../src/import-preview/historical-diary.ts';
import {createPersonalPlatformHandler} from '../src/personal-candidate/runtime-http.ts';
import {readJournalHistory} from '../src/personal-journal/history.ts';
import type {PublicEntry} from '../src/platform/contracts.ts';
import {PostgresPlatformRepository,verifyRestrictedPool,type SqlPool} from '../src/platform/postgres.ts';
import {journalQualificationStore} from './helpers/historical-diary-postgres.ts';
import {scope,batch,source} from './helpers/historical-diary-fixture.ts';

test('OPT-IN historical journal migration uses the restricted native journal and command repository',{
 skip:process.env.RUN_HISTORICAL_DIARY_PG!=='1'&&'Requires a fresh synthetic loopback PostgreSQL 17',
 timeout:30_000,
},async()=>{
 const port=Number(process.env.LIFEOS_HISTORICAL_DIARY_FIXTURE_PORT);
 assert.ok(Number.isInteger(port)&&port>=1024&&port<=65535);
 const database='lifeos_platform_test_local',role='lifeos_platform_candidate_runtime';
 const options={host:'127.0.0.1',database,port,max:2,statement_timeout:5000};
 const admin=new Pool({...options,user:'postgres',password:'fixture-journal-local-admin'});
 const writer=new Pool({...options,user:role,password:'fixture-journal-local-runtime'});
 const reader=new Pool({...options,user:role,password:'fixture-journal-local-runtime'});
 const foreign='synthetic-foreign',baseURL='https://diary-fixture.example.test',email='diary-owner@example.test';
 const config={...scope,ownerEmail:email,baseURL,databaseName:database,allowedTypes:['journal'],approval:'personal-manual-v1'} as const;
 try{
  const current=(await admin.query("SELECT current_database() db,current_user role,to_regnamespace('lifeos_platform') IS NULL fresh,current_setting('server_version_num')::int/10000 version")).rows[0];
  assert.deepEqual(current,{db:database,role:'postgres',fresh:true,version:17});
  await admin.query("CREATE ROLE lifeos_platform_candidate_runtime LOGIN PASSWORD 'fixture-journal-local-runtime' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; REVOKE CREATE ON SCHEMA public FROM PUBLIC");
  for(const file of ['0001_platform_candidate.sql','0002_platform_inbox.sql'])await admin.query(readFileSync(new URL('../db/'+file,import.meta.url),'utf8'));
  for(const pool of [writer,reader])await verifyRestrictedPool(pool as SqlPool);
  for(const [id,address] of [[scope.ownerId,email],[foreign,'foreign@example.test']])
   await admin.query('INSERT INTO lifeos_platform.platform_user(id,name,email) VALUES($1,$1,$2)',[id,address]);

  const writeRepository=new PostgresPlatformRepository(writer as SqlPool,true);
  const readRepository=new PostgresPlatformRepository(reader as SqlPool,true);
  let active=true,permitted=false;
  const approved=new Set<string>();
  const handler=createPersonalPlatformHandler({
   repository:readRepository,config,storageVerified:true,
   sessions:{read:async headers=>!active?null:headers.get('x-synthetic-identity')==='foreign'?
    {userId:foreign,email:'foreign@example.test'}:{userId:scope.ownerId,email}},
   assertWritable:async()=>{if(!permitted)throw Error('DIARY_FIXTURE_WRITE_CLOSED');},
  });
  const fetcher:typeof fetch=async(input,init)=>handler(new Request(new URL(String(input),baseURL),{...init,headers:{host:'diary-fixture.example.test',...init?.headers}}));
  const readJournal=async(id:string):Promise<PublicEntry|null>=>{
   const response=await fetcher('/api/platform/personal/journal/'+id);
   assert.match(response.headers.get('cache-control')??'',/no-store/);
   if(response.status===404)return null;
   assert.equal(response.status,200);
   return (await response.json()).entry;
  };
  const authorize:AuthorizeDiary=async(binding,authority,action)=>{
   if(binding.ownerId!==scope.ownerId||binding.spaceId!==scope.spaceId||authority.namespace!=='fixture-only')throw Error('DIARY_FIXTURE_BINDING_DENIED');
   const response=await fetcher('/api/platform/personal/status');
   if(!response.ok)throw Error('DIARY_FIXTURE_SESSION_DENIED');
   const status=await response.json();
   if(status.ownerId!==binding.ownerId||status.spaceId!==binding.spaceId||status.storageVerified!==true||
      !status.allowedTypes.includes('journal')||action!=='preview'&&!approved.has(authority.packageDigest)||
      action==='apply'&&status.writable!==true)throw Error('DIARY_FIXTURE_WRITE_CLOSED');
  };
  const importer=(key?:string,faults?:{interrupt?:boolean;loseResponse?:boolean},repository=writeRepository)=>
   new SyntheticDiaryImport(journalQualificationStore(repository,scope,readJournal,key,faults),authorize);
  const command=(key:string,preview:Awaited<ReturnType<SyntheticDiaryImport['preview']>>)=>({
   key,planDigest:preview.planDigest,selected:preview.items.filter(row=>row.status==='candidate').map(row=>row.id),
  });

  const previous=source('conflicting'),seed=batch(previous),seedPlan=await importer().preview(scope,seed);
  const seedCommand=command('diary-seed-one',seedPlan);
  await assert.rejects(importer(seedCommand.key).apply(scope,seed,seedCommand),/DIARY_FIXTURE_WRITE_CLOSED/);
  permitted=true;
  await assert.rejects(importer(seedCommand.key).apply(scope,seed,seedCommand),/DIARY_FIXTURE_WRITE_CLOSED/);
  approved.add(seedPlan.packageDigest);
  await importer(seedCommand.key).apply(scope,seed,seedCommand);

  const first=source('first'),second=source('second'),input=batch(first,second,first,source('conflicting','v2'));
  const plan=await importer().preview(scope,input),review=command('diary-batch-001',plan);
  approved.add(plan.packageDigest);
  assert.deepEqual(plan.counts,{candidate:2,duplicate:1,conflict:1,invalid:0});
  assert.equal(plan.importAvailable,false);
  await assert.rejects(importer().preview({...scope,spaceId:'foreign-space'},input),/DIARY_FIXTURE_BINDING_DENIED/);
  await assert.rejects(importer(review.key).apply(scope,input,{...review,selected:[plan.items[3].id]}),/DIARY_INVALID_SELECTION/);
  // Normal journal HTTP cannot supply import provenance with ordinary write authority.
  const unapproved=await fetcher('/api/platform/personal/journal',{method:'POST',headers:{'content-type':'application/json',origin:baseURL,'idempotency-key':'fixture-ordinary-rejected'},body:JSON.stringify({
   spaceId:scope.spaceId,confirmed:true,fields:{title:'synthetic',text:'body',occurredOn:first.date},historicalDiary:first,
  })});
  assert.equal(unapproved.status,400);

  await assert.rejects(importer(review.key,{interrupt:true}).apply(scope,input,review),/DIARY_FIXTURE_INTERRUPTED/);
  const independent=importer(review.key,undefined,readRepository);
  assert.deepEqual(await independent.reconcile(scope,input,review),{state:'unconfirmed'});
  for(const id of review.selected)assert.equal(await readJournal(id),null);
  await assert.rejects(importer(review.key,{loseResponse:true}).apply(scope,input,review),/DIARY_FIXTURE_RESPONSE_LOST/);
  const proof=await independent.reconcile(scope,input,review);
  assert.equal(proof.state,'verified');
  if(proof.state!=='verified')throw Error('DIARY_FIXTURE_UNVERIFIED');
  assert.deepEqual(await independent.apply(scope,input,review),{replayed:true,writesPerformed:0,receipt:proof.receipt});
  await assert.rejects(independent.apply(scope,input,{...review,selected:review.selected.slice(0,1)}),/DIARY_COMMAND_CONFLICT/);
  const newKey='diary-other-key';
  await assert.rejects(importer(newKey).apply(scope,input,{...review,key:newKey}),/DIARY_PREVIEW_CHANGED/);
  assert.deepEqual((await importer().preview(scope,input)).counts,{candidate:0,duplicate:3,conflict:1,invalid:0});

  for(const original of [previous,first,second]){
   const item=original===previous?seedPlan.items[0]:plan.items.find(row=>row.originalId===original.originalId)!;
   const entry=await readJournal(item.id);
   assert.equal(entry?.source.id,item.id);
   assert.equal(entry?.revision,1);
   assert.equal((await fetcher('/api/platform/personal/journal/'+item.id+'/history')).status,200);
   assert.deepEqual((entry?.source.original as {historicalDiary:unknown}).historicalDiary,{namespace:'fixture-only',source:original,sourceDigest:item.sourceDigest});
   assert.equal((await fetcher('/api/platform/personal/journal/'+item.id,{headers:{'x-synthetic-identity':'foreign'}})).status,403);
   assert.equal(await readRepository.get(foreign,'inbox',item.id),null);
  }
  const view=await readJournalHistory(fetcher);
  assert.deepEqual(view.history.rows.map(row=>row.text).sort(),[first.body,second.body,previous.body].sort());
  for(const table of ['platform_source','platform_record','platform_history','platform_command']){
   assert.equal((await reader.query('SELECT COUNT(*)::int AS n FROM lifeos_platform.'+table)).rows[0].n,0,'Unscoped reads obey RLS');
  }
  const client=await reader.connect();
  try{
   await client.query('BEGIN READ ONLY');
   await client.query("SELECT set_config('lifeos.owner_id',$1,true)",[scope.ownerId]);
   for(const [table,count] of [['platform_source',3],['platform_record',3],['platform_history',3],['platform_command',2]] as const){
    assert.equal((await client.query('SELECT COUNT(*)::int AS n FROM lifeos_platform.'+table)).rows[0].n,count);
   }
  }finally{await client.query('ROLLBACK');client.release();}
  active=false;
  await assert.rejects(independent.reconcile(scope,input,review),/DIARY_FIXTURE_SESSION_DENIED/);
  console.log('HISTORICAL_DIARY_PG_PASS 2 native writes, 1 seed, same-key recovery, exact sources, zero replay writes');
 }finally{await Promise.all([reader.end(),writer.end(),admin.end()]);}
});
