import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {Pool} from 'pg';
import {PostgresPlatformRepository,verifyRestrictedPool,type SqlPool} from '../src/platform/postgres.ts';
import {createPersonalPlatformHandler} from '../src/personal-candidate/runtime-http.ts';
import {readJournalHistory} from '../src/personal-journal/history.ts';
import {loadRecentMemos,recentMemosPath} from '../src/personal-journal/recent-memos.ts';
import {journalFixture,journalStatus,journalWithTopic,topicFixture} from './helpers/journal-history.ts';

test('OPT-IN restricted PostgreSQL recent memos match the #164 sources and rank; route stays bounded and private',{
 skip:process.env.RUN_RECENT_MEMOS_POSTGRES!=='1'&&'Requires a fresh disposable PostgreSQL 17 loopback fixture',timeout:30_000,
},async()=>{
 const port=Number(process.env.LIFEOS_RECENT_MEMOS_FIXTURE_PORT);
 assert.ok(Number.isInteger(port)&&port>=1024&&port<=65535);
 const database='lifeos_platform_test_local',runtimeRole='lifeos_platform_candidate_runtime';
 const options={host:'127.0.0.1',database,port,max:1,statement_timeout:5000};
 const admin=new Pool({...options,user:'postgres',password:'recent-memos-fixture-admin'});
 const runtime=new Pool({...options,user:runtimeRole,password:'recent-memos-fixture-runtime'});
 const {ownerId,spaceId}=journalStatus,foreign='recent-memos-other-owner',baseURL='https://recent-memos.example.test';
 const config={ownerId,spaceId,ownerEmail:'synthetic@example.test',databaseName:database,baseURL,approval:'personal-manual-v1',allowedTypes:['journal','topic'] as const} as const;
 try{
  const guard=(await admin.query("SELECT current_database() AS db,current_user AS role,to_regnamespace('lifeos_platform') IS NULL AS fresh,current_setting('server_version_num')::int/10000 AS version")).rows[0];
  assert.deepEqual(guard,{db:database,role:'postgres',fresh:true,version:17});
  await admin.query("CREATE ROLE lifeos_platform_candidate_runtime LOGIN PASSWORD 'recent-memos-fixture-runtime' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; REVOKE CREATE ON SCHEMA public FROM PUBLIC");
  for(const file of ['0001_platform_candidate.sql','0002_platform_inbox.sql'])await admin.query(readFileSync(new URL('../db/'+file,import.meta.url),'utf8'));
  await verifyRestrictedPool(runtime as SqlPool);
  for(const id of [ownerId,foreign])await admin.query('INSERT INTO lifeos_platform.platform_user(id,name,email) VALUES($1,$1,$2)',[id,id+'@example.test']);
  const topic=topicFixture(500,'思考'),formal=topicFixture(501,'正式日记');
  const stale={...topic,revision:2};
  const entries=Array.from({length:216},(_,index)=>{
   const text=Array.from({length:70},(_,line)=>`${index}-${line} 合成记录用于同源字节比较`).join('\n');
   const entry={...journalFixture(index+1,index%2===0?'2024-01-02':null,text),
    createdAt:new Date(Date.UTC(2026,10,26,0,Math.floor(index/2))).toISOString(),updatedAt:'2026-11-30T00:00:00.000Z'};
   if(index<205)return entry;
   if(index===215)return journalWithTopic(entry,stale);
   if(index===214)return journalWithTopic(entry,formal);
   return journalWithTopic(entry,topic);
  });
  const seed=async(id:string,entry:ReturnType<typeof journalFixture>)=>{
   await admin.query("INSERT INTO lifeos_platform.platform_source(owner_id,id,system,external_id,version,as_of,original) VALUES($1,$2,'website',$3,1,$4,$5)",[id,entry.source.id,entry.id,entry.source.asOf,entry.source.original]);
   await admin.query("INSERT INTO lifeos_platform.platform_record(owner_id,id,kind,source_id,draft,revision,created_at,updated_at) VALUES($1,$2,'inbox',$3,$4,$5,$6,$7)",[id,entry.id,entry.source.id,entry.draft,entry.revision,entry.createdAt,entry.updatedAt]);
  };
  await admin.query('BEGIN');
  try{
   for(const row of [topic,formal,...entries])await seed(ownerId,row);
   await seed(foreign,topic);
   await seed(foreign,journalWithTopic({...journalFixture(800,null,'Foreign synthetic memo'),createdAt:'2027-01-01T00:00:00.000Z'},topic));
   await admin.query('COMMIT');
  }catch(error){await admin.query('ROLLBACK');throw error;}
  const repository=new PostgresPlatformRepository(runtime as SqlPool);
  let sessionReads=0,failAfterRead=false;
  const handler=createPersonalPlatformHandler({config,repository,storageVerified:true,
   sessions:{read:async()=>++sessionReads>1&&failAfterRead?null:{userId:ownerId,email:config.ownerEmail}},assertWritable:async()=>{throw Error('Read only');}});
  const fetcher=async(input:RequestInfo|URL,init?:RequestInit)=>handler(new Request(new URL(String(input),baseURL),{...init,headers:{host:new URL(baseURL).host,...init?.headers}}));
  const measure=async<T>(fn:(fetcher:typeof globalThis.fetch)=>Promise<T>)=>{
   const bodies:Promise<ArrayBuffer>[]=[];
   const start=performance.now();
   const result=await fn(async(input,init)=>{
    const response=await fetcher(input,init);
    bodies.push(response.clone().arrayBuffer());
    return response;
   });
   const availableMs=performance.now()-start;
   const payloads=(await Promise.all(bodies)).map(value=>Buffer.from(value));
   return {result,stats:{requests:payloads.length,rawBytes:payloads.reduce((sum,body)=>sum+body.length,0),
    gzipBytes:payloads.reduce((sum,body)=>sum+gzipSync(body).length,0),availableMs:Math.round(availableMs*10)/10}};
  };
  const oldLoad=(fetch:typeof globalThis.fetch)=>readJournalHistory(fetch,{includeRecordedTimes:true});
  const narrowLoad=(fetch:typeof globalThis.fetch)=>loadRecentMemos(fetch,JSON.stringify([ownerId,spaceId]));
  // Warm both paths, then alternate their order to avoid measuring only the
  // first connection or SQL plan on one side.
  await measure(oldLoad);await measure(narrowLoad);
  const oldSamples=[],narrowSamples=[];
  for(let sample=0;sample<5;sample++){
   if(sample%2===0){oldSamples.push(await measure(oldLoad));narrowSamples.push(await measure(narrowLoad));}
   else{narrowSamples.push(await measure(narrowLoad));oldSamples.push(await measure(oldLoad));}
  }
  const middle=<T extends {stats:{availableMs:number}}>(samples:T[])=>samples.toSorted((a,b)=>a.stats.availableMs-b.stats.availableMs)[2];
  const old=middle(oldSamples),next=middle(narrowSamples);
  assert.equal(old.result.history.rows.length,216);
  const expected=old.result.sources.memos.rows.toSorted((a,b)=>
   Date.parse(old.result.recordedAtById!.get(b.id)!)-Date.parse(old.result.recordedAtById!.get(a.id)!)||b.id.localeCompare(a.id)).slice(0,5);
  assert.deepEqual(next.result.rows.map(({recordedAt,...row})=>({...row,recordedAt:new Date(recordedAt).toISOString()})),
   expected.map(({id,title,text,occurredOn,href})=>({id,title,text,occurredOn,href,recordedAt:old.result.recordedAtById!.get(id)!})));
  assert.deepEqual(Object.keys(next.result.rows[0]).sort(),['href','id','occurredOn','recordedAt','text','title']);
  assert.equal(next.stats.requests,1);
  assert.ok(next.stats.rawBytes<old.stats.rawBytes/20);
  const noTopic=await repository.readRecentMemos(ownerId,spaceId,false);
  assert.deepEqual(noTopic,{rows:[],classificationPending:true});
  assert.deepEqual(await repository.readRecentMemos(ownerId,'wrong-space',true),{rows:[],classificationPending:false});
  assert.equal((await fetcher(recentMemosPath+'?limit=99')).status,400);
  assert.equal((await fetcher(recentMemosPath,{headers:{authorization:'Bearer synthetic'}})).status,403);
  assert.equal((await fetcher(recentMemosPath,{headers:{'sec-fetch-site':'cross-site'}})).status,403);
  console.log('RECENT_MEMOS_PG '+JSON.stringify({journalRows:entries.length,visible:next.result.rows.length,old:old.stats,narrow:next.stats}));
  const boundary=Array.from({length:6},(_,index)=>journalWithTopic({
   ...journalFixture(901+index,null),
   createdAt:'2027-01-01T00:00:00.000'+[900,200,300,400,500,600][index]+'Z',
  },topic));
  for(const row of boundary)await seed(ownerId,row);
  const readIds=(rows:{id:string}[])=>rows.map(row=>Number(row.id.slice(-3))-900);
  const previous=await oldLoad(fetcher);
  const previousIds=readIds(previous.sources.memos.rows.toSorted((a,b)=>
   Date.parse(previous.recordedAtById!.get(b.id)!)-Date.parse(previous.recordedAtById!.get(a.id)!)||b.id.localeCompare(a.id)).slice(0,5));
  assert.deepEqual(previousIds,[6,5,4,3,2]);
  assert.deepEqual(readIds((await narrowLoad(fetcher)).rows),previousIds,'same millisecond must rank by descending ID');

  // These rows pass the SQL pin prefilter, but the native validator rejects
  // them. Each consumes a candidate slot and forces the next keyset page.
  const rejectDraft=async(id:string)=>admin.query(
   "UPDATE lifeos_platform.platform_record SET draft=jsonb_set(draft,'{text}',to_jsonb(''::text)) WHERE owner_id=$1 AND id=$2",[ownerId,id]);
  for(const index of [0,1]){
   const bad=journalWithTopic({...journalFixture(907+index,null),createdAt:'2027-01-01T00:00:00.000100Z'},topic);
   await seed(ownerId,bad);await rejectDraft(bad.id);
  }
  const pages:number[][]=[];
  const pagingPool={connect:async()=>{
   const client=await runtime.connect();
   return {release:()=>client.release(),query:async(sql:string,params?:unknown[])=>{
    const result=await client.query(sql,params);
    if(sql.includes('AS "recordedAt"'))pages.push(readIds(result.rows));
    return result;
   }};
  }};
  const paged=new PostgresPlatformRepository(pagingPool);
  const sameBucket=await paged.readRecentMemos(ownerId,spaceId,true);
  assert.deepEqual(readIds(sameBucket.rows),[6,5,4,3,2]);
  assert.deepEqual(pages,[[8,7,6,5,4],[3,2]]);
  assert.ok(sameBucket.rows.every(row=>row.recordedAt==='2027-01-01T00:00:00.000Z'));
  pages.length=0;
  await rejectDraft(boundary[1].id);await rejectDraft(boundary[2].id);
  const nextBucket=await paged.readRecentMemos(ownerId,spaceId,true);
  assert.deepEqual(readIds(nextBucket.rows),[6,5,4,1,214-900]);
  assert.deepEqual(pages,[[8,7,6,5,4],[3,2],[1,214-900]]);
  assert.equal(new Set(pages.flat()).size,pages.flat().length);
  console.log('RECENT_MEMOS_MS '+JSON.stringify({sameMillisecond:previousIds,crossingPages:pages}));
  sessionReads=0;failAfterRead=true;
  assert.equal((await fetcher(recentMemosPath)).status,401);

 }finally{await Promise.all([admin.end(),runtime.end()]);}
});
