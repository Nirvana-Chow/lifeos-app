import assert from 'node:assert/strict';
import test from 'node:test';
import {createAgentHandler} from '../src/agent-api/http.ts';
import {validateLocalArguments} from '../src/mcp-candidate/client.ts';
import {MemoryPort} from './helpers/platform.ts';

const origin = 'https://cooking-agent.example.invalid';
const config = {
 ownerId:'synthetic-cooking-agent', ownerEmail:'fixture@example.invalid', spaceId:'synthetic-cooking-space',
 baseURL:origin, databaseName:'fixture', approval:'personal-manual-v1', allowedTypes:['todo','journal'],
 cookingEnabled:true,
} as const;
const operations = ['snapshotCooking','getCooking','createCooking','updateCooking'];
const fields = {title:'合成炒饭', text:'', occurredOn:'2030-01-02', personal:{type:'cooking',schemaVersion:1,recipe:null}};
function setup(options:{enabled?:boolean;legacy?:boolean;readiness?:boolean;readOnly?:boolean} = {}) {
 const repository = new MemoryPort();
 repository.readCurrentSnapshot = async owner => structuredClone([...repository.rows.values()].filter(row => row.ownerId === owner));
 const transact = repository.transaction.bind(repository);
 const checked:string[] = [];
 repository.transaction = (owner,key,run) => transact(owner,key,tx => run({...tx, lockAgentGrant:async (binding,scopes) => {
  assert.equal(binding.businessDataPolicy,'all-personal-business-v1');
  assert.deepEqual(scopes,['cooking:read','cooking:write']);
  assert.ok(binding.operationId === 'createCooking' || binding.operationId === 'updateCooking');
  checked.push(binding.operationId);
  return true;
 }}));
 const grant = {
  ownerId:config.ownerId, spaceId:config.spaceId, grantId:'synthetic-cooking-grant',
  ...(options.legacy ? {scopes:['todo:read','todo:write'] as const} : {
   scopes:options.readOnly?['cooking:read'] as const:['cooking:read','cooking:write'] as const,
   businessDataPolicy:'all-personal-business-v1' as const,
   allowedOperationIds:options.readOnly?operations.slice(0,2):operations,
  }),
 };
 const handler = createAgentHandler({
  enabled:true, modules:{organization:false,classification:false,personalRecords:true,businessDataPolicy:true},
  config:{...config,cookingEnabled:options.enabled===false?undefined:true} as typeof config,
  repository, fenceWrites:true, verify:async()=>grant, readCurrentGrant:async()=>grant,
  operationAvailable:()=>options.readiness!==false, assertWritable:async()=>{},
 });
 const send = async (path:string,method='GET',body?:unknown,key='synthetic-cooking-command') => {
  const response = await handler(new Request(origin+path,{
   method, headers:{host:new URL(origin).host,authorization:'Bearer synthetic-fixture','idempotency-key':key,'content-type':'application/json'},
   body:body===undefined?undefined:JSON.stringify(body),
  }));
  return {status:response.status,body:await response.json()};
 };
 return {send,repository,checked};
}

test('cooking discovery requires the native gate, operation readiness and a matching business grant',async()=>{
 const cases = [
  [{},operations,null],
  [{enabled:false},[],404],
  [{readiness:false},[],503],
  [{legacy:true},[],403],
  [{readOnly:true},operations.slice(0,2),403],
 ] as const;
 for (const [options,wanted,denial] of cases) {
  const {send,repository}=setup(options);
  const catalog=await send('/v2/capabilities');
  assert.equal(catalog.status,200);
  assert.deepEqual(catalog.body.operations.filter((op:{module:string})=>op.module==='cooking').map((op:{id:string})=>op.id),wanted);
  if (denial!==null) {
   assert.equal((await send('/v1/records/cooking','POST',{fields})).status,denial);
   assert.equal(repository.rows.size,0);
  }
 }
});

test('the reviewed MCP contract accepts a complete cooking entry with empty notes and rejects invalid structure',()=>{
 const args={fields,idempotencyKey:'synthetic-cooking-mcp'};
 assert.deepEqual(validateLocalArguments('createCooking',args).parsed.body,{fields});
 for (const input of [
  {...fields,occurredOn:null},
  {...fields,personal:{...fields.personal,photos:[]}},
  {...fields,personal:{...fields.personal,recipe:{id:'abc',sourceUrl:'https://example.invalid'}}},
 ]) assert.throws(()=>validateLocalArguments('createCooking',{...args,fields:input}));
});

test('cooking uses the native writer and transaction grant fence, with exact retry and independent readback',async()=>{
 const {send,repository,checked}=setup();
 const saved=await send('/v1/records/cooking','POST',{fields});
 assert.equal(saved.status,201);
 assert.equal(saved.body.entry.type,'cooking');
 assert.deepEqual(saved.body.entry.fields,fields);
 const detail='/v1/records/cooking/'+saved.body.entry.id;
 assert.deepEqual((await send(detail)).body.entry,saved.body.entry);
 assert.equal((await send('/v1/records/cooking','POST',{fields})).body.duplicate,true);
 assert.equal((await send('/v1/records/cooking/snapshot')).body.total,1);
 const next={...fields,text:'下一次少放一点盐'};
 assert.equal((await send(detail,'PATCH',{fields:next,expectedRevision:1},'synthetic-cooking-edit')).status,200);
 assert.deepEqual((await send(detail)).body.entry.fields,next);
 assert.equal((await send(detail,'PATCH',{fields:next,expectedRevision:1},'synthetic-cooking-conflict')).status,409);
 assert.equal(repository.rows.size,1);
 assert.ok(checked.includes('createCooking') && checked.includes('updateCooking'));
});
