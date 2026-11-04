import assert from 'node:assert/strict';
import test from 'node:test';
import {createAgentHandler} from '../src/agent-api/http.ts';
import {PersonalService} from '../src/personal-candidate/service.ts';
import {MemoryPort} from './helpers/platform.ts';
import type {AgentScope} from '../src/agent-api/scopes.ts';
import type {Transaction} from '../src/platform/contracts.ts';

const config={ownerId:'organization-owner',ownerEmail:'fixture@example.test',spaceId:'organization-space',databaseName:'fixture',baseURL:'https://organization.example.test',approval:'personal-manual-v1',allowedTypes:['todo','journal','project','domain','topic']} as const;
const all=['todo:read','todo:write','organization:read','organization:write'] as const;
const fields=(type:string,title='Synthetic organization')=>({title,text:'Retain synthetic description',occurredOn:null,personal:type==='project'?{type,stage:'active',purpose:'advance',nextStep:'Synthetic next step',domain:null,topics:[]}:{type}});
function fixture({enabled=true,ready=true,fence=true}={}){
 const repo=new MemoryPort();
 const nativeTransaction=repo.transaction.bind(repo);
 let fences=0,guards=0,verifications=0,legacyFences=0;
 repo.transaction=(owner,key,fn)=>nativeTransaction(owner,key,tx=>fn({...tx,...(fence?{lockAgentGrant:async(binding,scopes)=>{fences++;assert.equal(binding.ownerId,config.ownerId);assert.deepEqual(scopes,['organization:read','organization:write']);return true;}}:{lockAgentTodoWriteGrant:async()=>{legacyFences++;return true;}})} as Transaction));
 const scopes=(key:string):readonly AgentScope[]=>key==='reader'?['organization:read']:key==='todo'?['todo:read','todo:write']:key==='all'?all:['organization:read','organization:write'];
 const grant=(key:string)=>({grantId:key,ownerId:config.ownerId,spaceId:config.spaceId,scopes:scopes(key)});
 const handler=createAgentHandler({config,repository:repo,enabled:true,modules:{organization:enabled,classification:false},fenceWrites:true,
  verify:async key=>{verifications++;return grant(key);},readCurrentGrant:async key=>grant(key),operationAvailable:()=>ready,assertWritable:async()=>{guards++;}} as Parameters<typeof createAgentHandler>[0]);
 const send=async(path:string,method='GET',body?:unknown,key='writer',command=crypto.randomUUID())=>{
  const response=await handler(new Request(config.baseURL+path,{method,headers:{host:'organization.example.test',authorization:'Bearer '+key,'idempotency-key':command,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}));
  return {status:response.status,body:await response.json()};
 };
 return {repo,send,counts:()=>({fences,guards,verifications,legacyFences})};
}

test('organization CRUD shares native writer, typed fields, revisions, source IDs, replay and independent same-name creates',async()=>{
 const {send,repo,counts}=fixture();
 for(const type of ['domain','topic','project']){
  const create=()=>send('/v1/organization/'+type,'POST',{fields:fields(type)},'writer','create-'+type+'-command');
  const first=await create();assert.equal(first.status,201);
  assert.equal(first.body.entry.type,type);assert.equal(first.body.entry.sourceId,repo.rows.get(first.body.entry.id)!.source.id);
  const replay=await create();assert.equal(replay.status,200);assert.equal(replay.body.duplicate,true);assert.equal(replay.body.entry.id,first.body.entry.id);
  assert.equal((await send('/v1/organization/'+type,'POST',{fields:fields(type,'Changed')},'writer','create-'+type+'-command')).status,409);
  const other=await send('/v1/organization/'+type,'POST',{fields:fields(type)});assert.equal(other.status,201);assert.notEqual(other.body.entry.id,first.body.entry.id);
  const path='/v1/organization/'+type+'/'+first.body.entry.id;
  for(const omitted of ['title','text','occurredOn','personal']){
   const partial:Record<string,unknown>=fields(type);delete partial[omitted];
   assert.equal((await send(path,'PATCH',{expectedRevision:1,fields:partial})).status,400);
  }
  assert.equal((await send(path,'PATCH',{expectedRevision:2,fields:fields(type)})).status,409);
  const edit=await send(path,'PATCH',{expectedRevision:1,fields:fields(type,'Edited')});assert.equal(edit.status,200);assert.equal(edit.body.entry.revision,2);
  const current=await send(path);assert.equal(current.body.fields.title,'Edited');assert.equal(current.body.sourceId,first.body.entry.sourceId);
  assert.equal((await send(path,'DELETE')).status,404);
 }
 assert.equal(repo.rows.size,6);assert.equal(repo.historyRows.length,9);assert.equal(repo.receipts.size,9);
 assert.ok(counts().fences>0);
});

test('complete organization snapshot exceeds bounded pages and strips internal evidence while preserving identity',async()=>{
 const {send,repo}=fixture();
 for(let n=0;n<55;n++)assert.equal((await send('/v1/organization/'+['domain','topic','project'][n%3],'POST',{fields:fields(['domain','topic','project'][n%3])})).status,201);
 const service=new PersonalService(repo,config);
 await service.mutate(config.ownerId,'journal',null,{spaceId:config.spaceId,confirmed:true,fields:{title:'Private journal',text:'Never disclose',occurredOn:null}},'synthetic-journal');
 const foreign={...config,ownerId:'foreign-owner'};
 await new PersonalService(repo,foreign).mutate(foreign.ownerId,'domain',null,{spaceId:config.spaceId,confirmed:true,fields:fields('domain','Foreign')},'synthetic-foreign');
 repo.readCurrentSnapshot=async owner=>structuredClone([...repo.rows.values()].filter(row=>row.ownerId===owner));
 const result=await send('/v1/organization/snapshot');assert.equal(result.status,200);
 assert.equal(result.body.scope,'full-current-organization-snapshot');assert.equal(result.body.total,55);assert.equal(result.body.truncated,false);assert.equal(result.body.items.length,55);
 assert.equal(new Set(result.body.items.map((row:{id:string})=>row.id)).size,55);
 for(const row of result.body.items){assert.equal(row.sourceId,repo.rows.get(row.id)!.source.id);assert.deepEqual(Object.keys(row).sort(),['fields','id','revision','sourceId','type']);}
 for(const hidden of ['ownerId','original','Never disclose','Foreign'])assert.equal(JSON.stringify(result.body).includes(hidden),false);
});

test('missing, overflowing and cross-owner snapshots fail closed without any partial body',async()=>{
 const {send,repo}=fixture();
 assert.equal((await send('/v1/organization/snapshot')).status,503);
 const created=await send('/v1/organization/domain','POST',{fields:fields('domain','Private evidence')});assert.equal(created.status,201);
 const row=repo.rows.get(created.body.entry.id)!;
 for(const invalid of [Array.from({length:10001},()=>row),[{...row,ownerId:'foreign'}]]){
  repo.readCurrentSnapshot=async()=>invalid;
  const result=await send('/v1/organization/snapshot');assert.equal(result.status,503);assert.deepEqual(Object.keys(result.body),['error']);
 }
});

test('organization reference type source and revision conflicts leave records history and receipts unchanged',async()=>{
 const {send,repo}=fixture();
 const domain=(await send('/v1/organization/domain','POST',{fields:fields('domain')})).body.entry;
 const reference={id:domain.id,sourceId:domain.sourceId,revision:domain.revision};
 const project=fields('project');
 const valid={...project,personal:{...project.personal,domain:reference}};
 assert.equal((await send('/v1/organization/project','POST',{fields:valid})).status,201);
 for(const link of [{...reference,revision:2},{...reference,sourceId:crypto.randomUUID()}]){
  assert.equal((await send('/v1/organization/project','POST',{fields:{...project,personal:{...project.personal,domain:link}}})).status,409);
 }
 assert.equal((await send('/v1/organization/project','POST',{fields:{...project,personal:{...project.personal,topics:[reference]}}})).status,409);
 assert.equal(repo.rows.size,2);assert.equal(repo.historyRows.length,2);assert.equal(repo.receipts.size,2);
});

test('module flag, readiness and scopes govern organization discovery and execution without write side effects',async()=>{
 for(const options of [{enabled:false},{ready:false},{}]){
  const {send,repo,counts}=fixture(options);
  const catalog=await send('/v2/capabilities');assert.equal(catalog.status,200);
  const org=catalog.body.operations.filter((op:{module:string})=>op.module==='organization');
  assert.equal(org.length,options.enabled===false||options.ready===false?0:4);
  assert.equal(counts().guards,0);assert.equal(counts().fences,0);assert.equal(repo.reads,0);
  assert.equal((await send('/v1/organization/domain','POST',{fields:fields('domain')})).status,options.enabled===false?404:options.ready===false?503:201);
 }
 const {send,repo}=fixture();
 const read=await send('/v2/capabilities','GET',undefined,'reader');assert.equal(read.body.operations.filter((op:{module:string})=>op.module==='organization').length,2);
 assert.equal((await send('/v1/organization/domain','POST',{fields:fields('domain')},'reader')).status,403);
 assert.equal((await send('/v1/organization/snapshot','GET',undefined,'todo')).status,403);
 assert.equal((await send('/v1/organization/domain','POST',{fields:fields('domain'),ownerId:config.ownerId})).status,400);
 for(const extra of ['source','ownerId','spaceId','confirmed','actor'])assert.equal((await send('/v1/organization/domain','POST',{fields:fields('domain'),[extra]:{}})).status,400);
 assert.equal((await send('/v1/organization/journal','POST',{fields:fields('journal')})).status,404);
 assert.equal((await send('/v1/capabilities','GET',undefined,'all')).body.operations.length,6);
 assert.equal((await send('/v1/capabilities','GET',undefined,'reader')).status,403);
 assert.equal(repo.rows.size,0);
 const unfenced=fixture({fence:false});assert.equal((await unfenced.send('/v1/organization/domain','POST',{fields:fields('domain')})).status,503);assert.equal(unfenced.repo.rows.size,0);assert.equal(unfenced.counts().legacyFences,0);
});
