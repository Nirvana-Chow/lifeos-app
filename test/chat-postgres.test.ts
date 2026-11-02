import test from'node:test';import assert from'node:assert/strict';
import{PostgresChatRepository,verifyChatPool}from'../src/chat-candidate/postgres.ts';
import{readChatCandidateFlag}from'../src/chat-candidate/config.ts';
import type{ChatTurn,ChatTransition}from'../src/chat-candidate/contracts.ts';
import type{SqlPool,SqlClient}from'../src/platform/postgres.ts';

const owner='chat-fixture-owner-a',id='81000000-0000-4000-8000-000000000001',digest='a'.repeat(64);
const proposed:ChatTurn={id,ownerId:owner,userText:"  Fictional question\n'); SELECT secret; --  ",assistantText:'',state:'pending',revision:1,createdAt:'2026-10-23T08:00:00.000Z',updatedAt:'2026-10-23T08:00:00.000Z',provenance:{provider:'volcengine-ark',model:'fixture-model',configurationRevision:3,materialRevision:2,mode:'synthetic-sdk-test',dataScope:'current-message-only',sources:'not-connected'},errorCode:null};
const change:ChatTransition={state:'completed',assistantText:'Synthetic answer',errorCode:null,updatedAt:'2026-10-23T08:00:01.000Z'};
const dbRow=(turn:ChatTurn=proposed,storedDigest=digest):Record<string,unknown>=>({id:turn.id,owner_id:turn.ownerId,user_text:turn.userText,assistant_text:turn.assistantText,state:turn.state,revision:turn.revision,created_at:new Date(turn.createdAt),updated_at:new Date(turn.updatedAt),provenance:structuredClone(turn.provenance),error_code:turn.errorCode,digest:storedDigest});
const isRead=(sql:string)=>sql.startsWith('SELECT ')&&sql.includes('FROM lifeos_platform.platform_chat_turn');
function fixture(respond:(sql:string,values:unknown[])=>{rows:Record<string,unknown>[];rowCount:number|null}=()=>({rows:[],rowCount:1})){
 const calls:{sql:string;values:unknown[]}[]=[];let released=0;
 const client:SqlClient={query:async(sql,values=[])=>{calls.push({sql,values});return respond(sql,values);},release(){released++;}};
 const pool:SqlPool={connect:async()=>client};return{pool,calls,get released(){return released;}};
}

test('chat extension is off unless its exact explicit flag is enabled',()=>{
 assert.equal(readChatCandidateFlag({}),false);assert.equal(readChatCandidateFlag({LIFEOS_CHAT_CANDIDATE:'1'}),true);
 for(const value of ['0','true',' 1','', 'yes'])assert.throws(()=>readChatCandidateFlag({LIFEOS_CHAT_CANDIDATE:value}));
});

test('reserve scopes and locks before insert, preserving original input and provenance in parameters',async()=>{
 const f=fixture(),repo=new PostgresChatRepository(f.pool),result=await repo.reserve(owner,proposed,digest);
 assert.equal(result.created,true);assert.deepEqual(result.turn,proposed);
 assert.equal(f.calls[0]?.sql,'BEGIN ISOLATION LEVEL READ COMMITTED');
 assert.deepEqual(f.calls.find(c=>c.sql.includes('set_config'))?.values,[owner]);
 assert.deepEqual(f.calls.find(c=>c.sql.includes('pg_advisory_xact_lock'))?.values,[JSON.stringify(['chat',owner,id])]);
 const read=f.calls.find(c=>isRead(c.sql));assert.ok(read);assert.match(read.sql,/owner_id=\$1 AND id=\$2 FOR UPDATE/);assert.deepEqual(read.values,[owner,id]);
 const write=f.calls.find(c=>c.sql.startsWith('INSERT INTO'));assert.ok(write);assert.match(write.sql,/platform_chat_turn/);
 assert.deepEqual(write.values,[owner,id,digest,proposed.userText,'','pending',1,proposed.createdAt,proposed.updatedAt,JSON.stringify(proposed.provenance),null]);
 assert.equal(f.calls.some(c=>c.sql.includes(proposed.userText)||c.sql.includes(owner)),false);
 assert.equal(f.calls.filter(c=>c.sql.startsWith('INSERT')).length,1);assert.equal(f.calls.at(-1)?.sql,'COMMIT');assert.equal(f.released,1);
});

test('reserve replays pending or terminal by the same identity and digest without overwriting old provenance',async()=>{
 for(const existing of [proposed,{...proposed,...change,revision:2}]){
  const f=fixture(sql=>({rows:isRead(sql)?[dbRow(existing)]:[],rowCount:1}));
  const result=await new PostgresChatRepository(f.pool).reserve(owner,{...proposed,provenance:{...proposed.provenance,configurationRevision:5}},digest);
  assert.equal(result.created,false);assert.deepEqual(result.turn,existing);assert.equal(result.turn.provenance.configurationRevision,3);
  assert.equal(f.calls.some(c=>/^(INSERT|UPDATE)/.test(c.sql)),false);assert.equal(f.calls.at(-1)?.sql,'COMMIT');
 }
});

test('reserve rejects changed digest or original text under an existing turn ID',async()=>{
 for(const [input,hash]of [[proposed,'b'.repeat(64)],[{...proposed,userText:'Different question'},digest]]as const){
  const f=fixture(sql=>({rows:isRead(sql)?[dbRow()]:[],rowCount:1}));
  await assert.rejects(new PostgresChatRepository(f.pool).reserve(owner,input,hash),{code:'CHAT_TURN_CONFLICT'});
  assert.equal(f.calls.some(c=>/^(INSERT|UPDATE)/.test(c.sql)),false);assert.equal(f.calls.at(-1)?.sql,'ROLLBACK');assert.equal(f.released,1);
 }
});

test('reserve rejects forged owner and malformed pending state before any database work',async()=>{
 for(const input of [{...proposed,ownerId:'chat-fixture-owner-b'},{...proposed,assistantText:'invented'},{...proposed,revision:2},{...proposed,provenance:{...proposed.provenance,sources:'invented'}},{...proposed,userText:' '},{...proposed,userText:'x'.repeat(16001)},{...proposed,userText:'bad\0text'},{...proposed,createdAt:'0000-01-01T00:00:00.000Z',updatedAt:'0000-01-01T00:00:00.000Z'},{...proposed,unexpected:'secret'}]){
  const f=fixture();await assert.rejects(new PostgresChatRepository(f.pool).reserve(owner,input as ChatTurn,digest));assert.equal(f.calls.length,0);
 }
 const f=fixture();await assert.rejects(new PostgresChatRepository(f.pool).reserve(owner,proposed,'not-a-digest'));assert.equal(f.calls.length,0);
});

test('get and list bind owner and enforce deterministic bounded reads; foreign or malformed rows fail closed',async()=>{
 const f=fixture(sql=>({rows:isRead(sql)?[dbRow()]:[],rowCount:1})),repo=new PostgresChatRepository(f.pool);
 assert.deepEqual(await repo.get(owner,id),proposed);assert.deepEqual(await repo.list(owner,51),[proposed]);
 const reads=f.calls.filter(c=>isRead(c.sql));assert.match(reads[0].sql,/owner_id=\$1 AND id=\$2/);assert.deepEqual(reads[0].values,[owner,id]);
 assert.match(reads[1].sql,/WHERE owner_id=\$1 ORDER BY created_at DESC,id DESC LIMIT \$2/);assert.deepEqual(reads[1].values,[owner,51]);assert.equal(f.released,2);
 for(const limit of [0,52,Infinity,NaN,1.5])await assert.rejects(repo.list(owner,limit));
 for(const row of [dbRow({...proposed,ownerId:'chat-fixture-owner-b'}),dbRow({...proposed,provenance:{...proposed.provenance,sources:'invented'}as unknown as ChatTurn['provenance']})]){
  const bad=fixture(sql=>({rows:isRead(sql)?[row]:[],rowCount:1})),badRepo=new PostgresChatRepository(bad.pool);
  await assert.rejects(badRepo.get(owner,id));await assert.rejects(badRepo.list(owner,20));assert.equal(bad.calls.at(-1)?.sql,'ROLLBACK');
 }
 const wrong=fixture(sql=>({rows:isRead(sql)?[dbRow({...proposed,id:'81000000-0000-4000-8000-000000000099'})]:[],rowCount:1}));
 await assert.rejects(new PostgresChatRepository(wrong.pool).get(owner,id));
});

test('missing turn remains inaccessible and rejected transitions roll back',async()=>{
 const f=fixture(),repo=new PostgresChatRepository(f.pool);assert.equal(await repo.get(owner,id),null);assert.deepEqual(await repo.list(owner,20),[]);
 await assert.rejects(repo.transition(owner,id,1,change),{code:'CHAT_TURN_NOT_FOUND'});assert.equal(f.calls.at(-1)?.sql,'ROLLBACK');
});

test('transition locks pending, CAS-updates only mutable output fields and returns committed terminal state',async()=>{
 const f=fixture(sql=>({rows:isRead(sql)?[dbRow()]:[],rowCount:1})),repo=new PostgresChatRepository(f.pool);
 const result=await repo.transition(owner,id,1,change);assert.deepEqual(result,{...proposed,...change,revision:2});
 assert.ok(f.calls.some(c=>isRead(c.sql)&&c.sql.includes('FOR UPDATE')));
 const update=f.calls.find(c=>c.sql.startsWith('UPDATE'));assert.ok(update);
 assert.match(update.sql,/SET assistant_text=\$3,state=\$4,revision=\$5,updated_at=\$6,error_code=\$7/);
 assert.match(update.sql,/WHERE owner_id=\$1 AND id=\$2 AND revision=\$8 AND state='pending'/);
 assert.deepEqual(update.values,[owner,id,'Synthetic answer','completed',2,change.updatedAt,null,1]);
 assert.equal(/SET[^]*\b(user_text|provenance|created_at|digest)\s*=/.test(update.sql),false);assert.equal(f.calls.at(-1)?.sql,'COMMIT');
});

test('terminal winner is replayed unchanged after late cancel or completion; no second UPDATE',async()=>{
 for(const state of ['completed','failed','cancelled']as const){
  const existing:ChatTurn={...proposed,...change,state,revision:2,errorCode:state==='completed'?null:'CHAT_INTERRUPTED'};
  const f=fixture(sql=>({rows:isRead(sql)?[dbRow(existing)]:[],rowCount:1}));
  const result=await new PostgresChatRepository(f.pool).transition(owner,id,1,{...change,state:'cancelled',assistantText:'Late different text',errorCode:'CHAT_CANCELLED'});
  assert.deepEqual(result,existing);assert.equal(f.calls.some(c=>c.sql.startsWith('UPDATE')),false);
 }
});

test('revision mismatch and lost CAS cannot silently overwrite pending, and both roll back',async()=>{
 for(const expected of [2,1]){
  const f=fixture(sql=>({rows:isRead(sql)?[dbRow()]:[],rowCount:sql.startsWith('UPDATE')?0:1}));
  await assert.rejects(new PostgresChatRepository(f.pool).transition(owner,id,expected,change),{code:'CHAT_REVISION_CONFLICT'});
  assert.equal(f.calls.at(-1)?.sql,'ROLLBACK');assert.equal(f.released,1);if(expected===2)assert.equal(f.calls.some(c=>c.sql.startsWith('UPDATE')),false);
 }
});

test('transition rejects unbounded output, invalid terminal metadata and timestamp regression',async()=>{
 for(const patch of [{...change,assistantText:'x'.repeat(32001)},{...change,errorCode:'raw provider error with spaces'},{...change,state:'pending'},{...change,provenance:{secret:'not-real'}},{...change,updatedAt:'2026-10-22T08:00:00.000Z'}]){
  const f=fixture(sql=>({rows:isRead(sql)?[dbRow()]:[],rowCount:1}));await assert.rejects(new PostgresChatRepository(f.pool).transition(owner,id,1,patch as ChatTransition),{code:'CHAT_INVALID_TRANSITION'});assert.equal(f.calls.some(c=>c.sql.startsWith('UPDATE')),false);
 }
});

test('chat verifier is read-only and requires restricted core, forced RLS, exact owner policy and minimum column grants',async()=>{
 const core={role:'lifeos_platform_candidate_runtime',superuser:false,create_db:false,create_role:false,bypass_rls:false,memberships:0,owns_objects:0,can_create_schema:false,can_create_database:false,rls_tables:4,forced_tables:4,version:2};
 const extension={version:1,rls_tables:1,forced_tables:1,owner_policies:1,policies:1,required:true,excessive:false};
 const run=(patch:Record<string,unknown>={},corePatch:Record<string,unknown>={})=>{
  const f=fixture(sql=>({rows:[sql.includes('FROM pg_roles')?{...core,...corePatch}:{...extension,...patch}],rowCount:1}));return{f,promise:verifyChatPool(f.pool)};
 };
 const good=run();await good.promise;assert.equal(good.f.calls.length,2);assert.ok(good.f.calls.every(c=>c.sql.startsWith('SELECT ')));assert.equal(good.f.released,2);
 const grants=good.f.calls[1].sql;assert.match(grants,/has_column_privilege/);assert.match(grants,/has_any_column_privilege/);assert.match(grants,/pg_policy/);
 for(const patch of [{version:2},{rls_tables:0},{forced_tables:0},{owner_policies:0},{policies:2},{required:false},{excessive:true}])await assert.rejects(run(patch).promise);
 for(const patch of [{bypass_rls:true},{owns_objects:1},{superuser:true}])await assert.rejects(run({},patch).promise);
});
