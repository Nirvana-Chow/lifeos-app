import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryPort} from './helpers/platform.ts';
import {PersonalService} from '../src/personal-candidate/service.ts';
import type {Transaction,StoredEntry} from '../src/platform/contracts.ts';

const A='00000000-0000-4000-8000-000000000001', Z='ffffffff-ffff-4fff-bfff-ffffffffffff';
const T='77777777-7777-4777-8777-777777777777';
const config={ownerId:'lock-owner',ownerEmail:'fixture@example.test',spaceId:'lock-space',databaseName:'fixture',baseURL:'https://fixture.example.test',approval:'personal-manual-v1',allowedTypes:['todo','journal','project','domain','topic']} as const;
const fields=(type:'project'|'domain')=>({title:'Synthetic '+type,text:'',occurredOn:null,personal:type==='project'?{type,stage:'active',purpose:null,nextStep:'',domain:null,topics:[]}:{type}});
const body=(fields:unknown,expectedRevision?:number)=>({spaceId:config.spaceId,confirmed:true,fields,...(expectedRevision?{expectedRevision}:{})});
class ObservedPort extends MemoryPort {
 locks:{kind:string;id:string}[]=[];
 override transaction<R>(owner:string,key:string,fn:(tx:Transaction)=>Promise<R>) {
  return super.transaction(owner,key,tx=>fn({...tx,get:async(kind,id)=>{this.locks.push({kind,id});return tx.get(kind,id);}}));
 }
}
async function setup(){
 const repo=new ObservedPort(),service=new PersonalService(repo,config);
 const put=async(type:'domain'|'project'|'todo',id:string)=>{
  const draft=type==='todo'?{title:'Synthetic todo'}:fields(type);
  const created=await service.mutate(config.ownerId,type,null,body(draft),'seed-'+type+'-record');
  const row=repo.rows.get(created.entry.id)!;repo.rows.delete(row.id);row.id=id;row.source.externalId=id;repo.rows.set(id,row);return row;
 };
 const domain=await put('domain',A),project=await put('project',Z),todo=await put('todo',T);
 repo.locks=[];return {repo,service,domain,project,todo};
}
const ref=(entry:StoredEntry)=>({id:entry.id,sourceId:entry.source.id,revision:entry.revision});

test('project update collects its own Z and domain A before acquiring records, eliminating the reverse order',async()=>{
 const {repo,service,domain}=await setup();
 const f=fields('project');
 await service.mutate(config.ownerId,'project',Z,body({...f,personal:{...f.personal,domain:ref(domain)}},1),'project-lock-order');
 assert.deepEqual(repo.locks,[{kind:'inbox',id:A},{kind:'inbox',id:Z}]);
 assert.equal(repo.rows.get(Z)!.revision,2);
});

test('todo update locks physical todo before all inbox targets, independent of logical reference order',async()=>{
 const {repo,service,domain,project}=await setup();
 await service.mutate(config.ownerId,'todo',T,body({title:'Synthetic todo',personal:{project:ref(project),domain:ref(domain),topics:[]}},1),'todo-lock-order');
 assert.deepEqual(repo.locks,[{kind:'todo',id:T},{kind:'inbox',id:A},{kind:'inbox',id:Z}]);
});

test('wrong logical types sharing one inbox UUID acquire one physical lock and reject without writing',async()=>{
 const {repo,service,project}=await setup();
 const before={rows:structuredClone(repo.rows),history:structuredClone(repo.historyRows),receipts:structuredClone(repo.receipts)};
 await assert.rejects(service.mutate(config.ownerId,'project',Z,body({...fields('project'),personal:{...fields('project').personal,domain:ref(project)}},1),'wrong-self-reference'),{code:'REFERENCE_CONFLICT'});
 assert.deepEqual(repo.locks,[{kind:'inbox',id:Z}]);
 assert.deepEqual(repo.rows,before.rows);assert.deepEqual(repo.historyRows,before.history);assert.deepEqual(repo.receipts,before.receipts);
});

test('physical lock helper deduplicates normalized UUIDs per kind and validates the full set before taking any lock',async()=>{
 const {personalRecordLockOrder,lockPersonalRecords}=await import('../src/personal-candidate/personal-record-locks.ts');
 const values=[{kind:'inbox',id:Z},{kind:'todo',id:Z},{kind:'inbox',id:A},{kind:'inbox',id:Z.toUpperCase()},{kind:'todo',id:A}] as const;
 assert.deepEqual(personalRecordLockOrder(values),[{kind:'todo',id:A},{kind:'todo',id:Z},{kind:'inbox',id:A},{kind:'inbox',id:Z}]);
 const {repo}=await setup();
 await repo.transaction(config.ownerId,'helper-map-command',async tx=>{
  const locked=await lockPersonalRecords(tx,values);
  assert.equal(locked.size,4);assert.equal(locked.get(JSON.stringify(['todo',Z])),null);
  assert.equal(locked.get(JSON.stringify(['inbox',Z]))?.id,Z);
 });
 repo.locks=[];
 await assert.rejects(repo.transaction(config.ownerId,'helper-invalid-command',tx=>lockPersonalRecords(tx,[{kind:'inbox',id:A},{kind:'inbox',id:'invalid'}])),{code:'INVALID_ID'});
 assert.deepEqual(repo.locks,[]);
});
