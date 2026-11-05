import {PersonalService} from '../src/personal-candidate/service.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryPort} from './helpers/platform.ts';
import {createAgentHandler} from '../src/agent-api/http.ts';
import {agentOperationAvailable} from '../src/agent-api/runtime.ts';
import {readAgentBusinessModules} from '../src/agent-api/config.ts';
import {emptyMediaPersonal} from '../src/personal-media/domain.ts';
import {emptyCareerPersonal} from '../src/personal-career/domain.ts';
import {emptyPortfolioPersonal} from '../src/personal-portfolio/model.ts';

const config={ownerId:'synthetic-three-agent',ownerEmail:'agent@example.test',spaceId:'synthetic-three-space',databaseName:'fixture',approval:'personal-manual-v1',baseURL:'https://agent-three.example.test',allowedTypes:['todo','journal','project','domain','topic'],mediaEnabled:true,careerEnabled:true,portfolioEnabled:true,businessWriteMode:'owner-managed'} as const;
const fields=(personal:unknown)=>({title:'Synthetic Agent record',text:'Explicit synthetic source',occurredOn:null,personal});
const modules={organization:false,classification:false,personalRecords:true,businessDataPolicy:true};
function setup({enabled=true,policy=true,ready=true,flags={},readOnly=false}:{enabled?:boolean;policy?:boolean;ready?:boolean;flags?:Record<string,unknown>;readOnly?:boolean}={}){
 const repo=new MemoryPort(),native=repo.transaction.bind(repo);repo.readCurrentSnapshot=async owner=>structuredClone([...repo.rows.values()].filter(row=>row.ownerId===owner));
 repo.transaction=(owner,key,fn)=>native(owner,key,tx=>fn({...tx,lockAgentGrant:async(binding,scopes)=>{assert.equal(binding.businessDataPolicy,'all-personal-business-v1');assert.ok(['createMedia','updateMedia','createCareer','updateCareer','createPortfolio','updatePortfolio'].includes(binding.operationId!));assert.ok([['media:read','media:write'],['career:read','career:write'],['portfolio:read','portfolio:write']].some(expected=>JSON.stringify(expected)===JSON.stringify(scopes)));return true;}}));
 const grant={grantId:'synthetic-three-grant',ownerId:config.ownerId,spaceId:config.spaceId,scopes:policy&&readOnly?['media:read','career:read','portfolio:read']:policy?['media:read','media:write','career:read','career:write','portfolio:read','portfolio:write']:['todo:read','todo:write'],...(policy?{businessDataPolicy:'all-personal-business-v1',allowedOperationIds:readOnly?['snapshotMedia','getMedia','snapshotCareer','getCareer','snapshotPortfolio','getPortfolio']:['snapshotMedia','getMedia','createMedia','updateMedia','snapshotCareer','getCareer','createCareer','updateCareer','snapshotPortfolio','getPortfolio','createPortfolio','updatePortfolio']}:{})};
 const handler=createAgentHandler({enabled:true,modules:{...modules,personalRecords:enabled,businessDataPolicy:policy},config:{...config,...flags},repository:repo,fenceWrites:true,verify:async()=>grant,readCurrentGrant:async()=>grant,operationAvailable:()=>ready,assertWritable:async()=>{}} as unknown as Parameters<typeof createAgentHandler>[0]);
 const send=async(path:string,method='GET',body?:unknown,key=crypto.randomUUID())=>{const response=await handler(new Request(config.baseURL+path,{method,headers:{host:'agent-three.example.test',authorization:'Bearer synthetic-token','idempotency-key':key,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}));return{status:response.status,body:await response.json()};};return{repo,send};
}
test('three new Agent modules advertise only exact policy-scoped ready native operations and preserve legacy Todo tuples',async()=>{
 for(const [options,want] of [[{},12],[{enabled:false},0],[{policy:false},0],[{ready:false},0],[{flags:{mediaEnabled:undefined}},8]] as const){const {send}=setup(options),catalog=await send('/v2/capabilities');assert.equal(catalog.status,200);assert.equal(catalog.body.operations.filter((op:{module:string})=>['media','career','portfolio'].includes(op.module)).length,want);}
 const {send}=setup({policy:false}),legacy=await send('/v1/capabilities');assert.equal(legacy.status,200);assert.equal(legacy.body.operations.length,6);assert.deepEqual(legacy.body.operations.filter((op:{id:string})=>['createTodo','updateTodo'].includes(op.id)).map((op:{scope:string})=>op.scope),['todo:write','todo:write']);
 const permit=readAgentBusinessModules({LIFEOS_AGENT_PERSONAL_RECORDS:'personal-records-v1',LIFEOS_AGENT_ALL_BUSINESS_DATA:'all-personal-business-v1'},config);
 for(const id of ['snapshotMedia','getCareer','createPortfolio']){assert.equal(agentOperationAvailable(id,config,true,permit),true);assert.equal(agentOperationAvailable(id,config,false,permit),false);assert.equal(agentOperationAvailable(id,config,true,{...permit,personalRecords:false}),false);}
});
test('three Agent record types create edit and independently read their native fields with CAS and replay',async()=>{
 const {repo,send}=setup();
 for(const [type,personal] of [['media',emptyMediaPersonal('series')],['career',emptyCareerPersonal('employment')],['portfolio',emptyPortfolioPersonal('investment')]] as const){
  const first=await send('/v1/records/'+type,'POST',{fields:fields(personal)},'synthetic-agent-'+type);assert.equal(first.status,201,type);const id=first.body.entry.id,path='/v1/records/'+type+'/'+id;
  assert.equal((await send('/v1/records/'+type,'POST',{fields:fields(personal)},'synthetic-agent-'+type)).body.duplicate,true);assert.equal((await send(path)).body.entry.type,type);
  const changed=await send(path,'PATCH',{fields:{...first.body.entry.fields,text:'Revised by scoped Agent'},expectedRevision:1});assert.equal(changed.status,200,type);assert.equal(changed.body.entry.revision,2);assert.equal(changed.body.entry.sourceId,first.body.entry.sourceId);assert.equal((await send(path)).body.entry.fields.text,'Revised by scoped Agent');
  assert.equal((await send('/v1/records/'+type+'/snapshot')).body.total,1);assert.equal((await send(path,'PATCH',{fields:fields(personal),expectedRevision:1})).status,409);
  assert.equal((await send('/v1/records/'+type,'POST',{fields:fields(personal),ownerId:config.ownerId})).status,400);
 }
 assert.equal(repo.rows.size,3);
});
test('three Agent routes deny old grants closed native module or missing SQL readiness without any write',async()=>{
 for(const type of ['media','career','portfolio']){
  for(const [options,want] of [[{policy:false},404],[{enabled:false},404],[{ready:false},503],[{flags:{[type+'Enabled']:undefined}},404]] as const){
   const {repo,send}=setup(options),personal=type==='media'?emptyMediaPersonal():type==='career'?emptyCareerPersonal():emptyPortfolioPersonal('account');assert.equal((await send('/v1/records/'+type,'POST',{fields:fields(personal)})).status,want);assert.equal(repo.rows.size,0);assert.equal(repo.receipts.size,0);
  }
 }
});

test('read-only three-business operation grants can read each native record and cannot advertise or execute writes',async()=>{
 const {repo,send}=setup({readOnly:true}),service=new PersonalService(repo,config);
 for(const [type,personal]of [['media',emptyMediaPersonal()],['career',emptyCareerPersonal()],['portfolio',emptyPortfolioPersonal('account')]] as const){
  const saved=(await service.mutate(config.ownerId,type,null,{spaceId:config.spaceId,confirmed:true,fields:fields(personal)},'synthetic-reader-seed-'+type)).entry;
  assert.equal((await send('/v1/records/'+type+'/'+saved.id)).status,200);assert.equal((await send('/v1/records/'+type+'/snapshot')).body.total,1);
  assert.equal((await send('/v1/records/'+type,'POST',{fields:fields(personal)})).status,403);
 }
 const catalog=await send('/v2/capabilities');assert.equal(catalog.body.operations.filter((op:{module:string})=>['media','career','portfolio'].includes(op.module)).length,6);assert.equal(catalog.body.operations.some((op:{method:string})=>op.method==='POST'||op.method==='PATCH'),false);assert.equal(repo.rows.size,3);
});
