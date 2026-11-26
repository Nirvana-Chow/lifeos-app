import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {randomUUID} from 'node:crypto';
import {PlatformError} from '../src/platform/domain.ts';
import type {SqlPool} from '../src/platform/postgres.ts';
import {handleLearningRequest} from '../src/personal-learning/http.ts';
import {PostgresLearningRepository,verifyLearningPostgres} from '../src/personal-learning/postgres.ts';
import {LearningService} from '../src/personal-learning/service.ts';
import {fixtureForeign,fixtureOwner,learningFixturePool} from './helpers/learning-pg.ts';

test('restricted PostgreSQL and real HTTP serialize reviews and preserve original receipts across lost access', {
  skip:process.env.RUN_LEARNING_PG_TESTS!=='1'&&'Requires the approved disposable learning PostgreSQL fixture',
},async t=>{
  const open=()=>learningFixturePool(process.env.LEARNING_FIXTURE_PG_PORT);
  const pool=open(), readerPool=open();
  t.after(async()=>{await Promise.all([pool.end(),readerPool.end()]);});
  await verifyLearningPostgres(pool as SqlPool);
  await verifyLearningPostgres(readerPool as SqlPool);
  const owner={...fixtureOwner,spaceId:'learning-http-'+randomUUID()};
  const alternate={...owner,spaceId:'learning-other-'+randomUUID()};
  const foreign={...fixtureForeign,spaceId:owner.spaceId};
  let service=new LearningService(new PostgresLearningRepository(pool as SqlPool));
  let origin:string;
  const server=createServer(async (incoming,outgoing)=>{
    try {
      const chunks:Buffer[]=[];
      for await (const chunk of incoming) chunks.push(chunk);
      const method=incoming.method!;
      const request=new Request(origin+incoming.url,{method,headers:incoming.headers as Record<string,string>,
        ...(method==='POST'?{body:Buffer.concat(chunks)}:{})});
      let checks=0;
      const response=await handleLearningRequest(request,{baseURL:origin,service,authorize:async req=>{
        const actor=req.headers.get('x-fixture-actor');
        if(!actor || (req.headers.has('x-deny-after-commit') && ++checks===5)) {
          throw new PlatformError(403,'SYNTHETIC_DENIED','Synthetic access denied');
        }
        return {binding:actor==='other-space'?alternate:actor==='foreign'?foreign:owner,writable:actor!=='readonly'};
      }});
      outgoing.writeHead(response.status,Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      outgoing.writeHead(500).end();
    }
  });
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(async()=>{server.close(); await once(server,'close');});
  origin='http://127.0.0.1:'+(server.address() as AddressInfo).port;
  const endpoint=origin+'/personal/learning/data';
  const read=(actor:string,query='')=>fetch(endpoint+query,{headers:{'x-fixture-actor':actor}});
  const scope=(await (await read('owner')).json()).scope as string;
  const post=(command:unknown,key:string,{actor='owner',denied=false,boundScope=scope}={})=>fetch(endpoint,{
    method:'POST',headers:{origin,'content-type':'application/json','idempotency-key':key,'x-learning-scope':boundScope,
      'x-fixture-actor':actor,...(denied?{'x-deny-after-commit':'1'}:{})},body:JSON.stringify(command),
  });

  const create={kind:'create',confirmed:true,front:'Synthetic durable card',back:'Synthetic durable definition'};
  const created=await Promise.all([post(create,'learning-pg-create'),post(create,'learning-pg-create')]);
  assert.deepEqual(created.map(r=>r.status),[200,200]);
  const [left,right]=await Promise.all(created.map(r=>r.json()));
  assert.deepEqual(left,right);
  assert.equal((await (await read('owner')).json()).cards.length,1);
  assert.equal((await post({...create,back:'Mismatch'},'learning-pg-create')).status,409);
  const command={kind:'review',confirmed:true,cardId:left.cardId,cardRevision:1,previousId:null,rating:'recalled'};
  assert.equal((await post({...command,cardRevision:2},'learning-pg-wrong-version')).status,409);
  const first=await Promise.all([
    post(command,'learning-pg-review'),
    post(command,'learning-pg-review'),
    post({...command,rating:'again'},'learning-pg-competing'),
  ]);
  assert.ok(first[0].status===200 || first[0].status===409);
  assert.equal(first[0].status,first[1].status);
  assert.notEqual(first[0].status,first[2].status);
  const firstReplies=await Promise.all(first.map(r=>r.json()));
  assert.deepEqual(firstReplies[0],firstReplies[1]);
  const winning=first[0].status===200?firstReplies[0]:firstReplies[2];
  assert.ok(winning.id);
  const query='?card='+left.cardId+'&review=';
  assert.equal((await read('owner',query+winning.id)).status,200);
  assert.equal((await post({...command,previousId:winning.id},'learning-pg-lost',{denied:true})).status,403);

  // A fresh restricted pool performs the independent post-refresh query and exact replay.
  let fenced=false;
  service=new LearningService(new PostgresLearningRepository(readerPool as SqlPool,async(client,binding)=>{
    const {rows}=await client.query("SELECT current_setting('lifeos.owner_id') AS owner,current_setting('lifeos.learning_space_id') AS space");
    assert.deepEqual(rows[0],{owner:binding.ownerId,space:binding.spaceId});
    if(fenced)throw new PlatformError(403,'SYNTHETIC_FENCE','Synthetic transaction permission withdrawn');
  }));
  fenced=true;
  assert.equal((await post({...command,previousId:winning.id},'learning-pg-lost')).status,403);
  fenced=false;
  const refreshed=await (await read('owner','?card='+left.cardId)).json();
  assert.equal(refreshed.history.length,2);
  assert.equal(refreshed.history[0].id,winning.id);
  const latest=refreshed.history[1];
  assert.equal((await read('owner',query+latest.id)).status,200);
  assert.equal((await post({...command,previousId:winning.id},'learning-pg-lost',{actor:'readonly'})).status,403);
  for(const actor of ['foreign','other-space']){
    assert.equal((await read(actor,query+latest.id)).status,404);
    assert.equal((await post({...command,previousId:winning.id},'learning-pg-lost',{actor})).status,403);
    const theirScope=(await (await read(actor)).json()).scope;
    assert.equal((await post({...command,previousId:winning.id},'learning-pg-lost',{actor,boundScope:theirScope})).status,404);
  }
  const replay=await post({...command,previousId:winning.id},'learning-pg-lost');
  assert.equal(replay.status,200);
  assert.deepEqual(await replay.json(),{kind:'review',id:latest.id,cardId:left.cardId});
  assert.deepEqual(await (await read('owner','?card='+left.cardId)).json(),refreshed);

  const runtime=await pool.connect();
  try {
    const counts=async()=>{
      const visible=[];
      for(const table of ['learning_card','learning_review','learning_command']){
        visible.push((await runtime.query('SELECT * FROM lifeos_platform.'+table)).rowCount);
      }
      return visible;
    };
    const bind=(binding:{ownerId:string;spaceId:string})=>runtime.query(
      "SELECT set_config('lifeos.owner_id',$1,false),set_config('lifeos.learning_space_id',$2,false)",
      [binding.ownerId,binding.spaceId],
    );
    assert.deepEqual(await counts(),[0,0,0],'RLS requires verified binding');
    await bind({...owner,spaceId:''});
    assert.deepEqual(await counts(),[0,0,0],'owner alone cannot see any learning row');
    await bind(alternate);
    assert.deepEqual(await counts(),[0,0,0],'same owner with another workspace is isolated');
    await bind(foreign);
    assert.deepEqual(await counts(),[0,0,0],'same workspace with another owner is isolated');
    await bind(owner);
    assert.deepEqual(await counts(),[1,2,3]);
    for(const other of [alternate,foreign]){
      const args=[other.ownerId,other.spaceId];
      const denied={code:'42501',message:/row-level security/};
      await assert.rejects(runtime.query(`INSERT INTO lifeos_platform.learning_card
        (owner_id,space_id,id,revision,front,back,created_at) VALUES($1,$2,$3,1,'synthetic','synthetic',now())`,
      [...args,randomUUID()]),denied);
      await assert.rejects(runtime.query(`INSERT INTO lifeos_platform.learning_review
        (owner_id,space_id,id,card_id,card_revision,sequence,previous_id,rating,reviewed_at,schedule_version)
        VALUES($1,$2,$3,$4,1,3,$5,'again',now(),'recall-ladder-v1')`,[...args,randomUUID(),left.cardId,latest.id]),denied);
      await assert.rejects(runtime.query(`INSERT INTO lifeos_platform.learning_command
        (owner_id,space_id,command_key,digest,card_id) VALUES($1,$2,'learning-pg-raw-denied',$3,$4)`,
      [...args,'a'.repeat(64),left.cardId]),denied);
    }
    await assert.rejects(runtime.query('UPDATE lifeos_platform.learning_review SET rating=$1',['again']),{code:'42501'});
    await assert.rejects(runtime.query('DELETE FROM lifeos_platform.learning_command'),{code:'42501'});
  } finally {runtime.release(true);}
});
