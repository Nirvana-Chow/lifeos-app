import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentHandler} from '../src/agent-api/http.ts';
import {createKeyIssuer} from '../src/agent-api/key-issuer.ts';
import {requirements} from '../src/platform/requirements.ts';
import {MemoryPort} from './helpers/platform.ts';
const config={ownerId:'requirements-owner',ownerEmail:'fixture@example.test',spaceId:'requirements-space',databaseName:'fixture',baseURL:'https://requirements.example.test',approval:'personal-manual-v1',allowedTypes:['todo','journal','project','domain','topic'],requirementsEnabled:true} as const;
const fields={title:'Synthetic API input',body:'Preserve <script> as data',phaseId:requirements().roadmap!.phases[0].id,priority:'P3',plannedStartOn:null,plannedEndOn:null};
function fixture(enabled=true,ready=true){
 const repo=new MemoryPort(),native=repo.transaction.bind(repo);let fences=0;
 repo.transaction=(owner,key,fn)=>native(owner,key,tx=>fn({...tx,lockRecordIdentity:async()=>{},lockAgentGrant:async(_,scopes)=>{fences++;assert.deepEqual(scopes,['requirements:read','requirements:write']);return true;}}));repo.readCurrentSnapshot=async owner=>structuredClone([...repo.rows.values()].filter(r=>r.ownerId===owner));
 const grant=(key:string)=>({grantId:key,ownerId:config.ownerId,spaceId:config.spaceId,scopes:key==='reader'?['requirements:read']:key==='todo'?['todo:read','todo:write']:['requirements:read','requirements:write']});
 const handler=createAgentHandler({config,repository:repo,enabled:true,modules:{organization:true,classification:false,requirements:enabled},fenceWrites:true,verify:async key=>grant(key),readCurrentGrant:async key=>grant(key),operationAvailable:()=>ready,assertWritable:async()=>{}} as Parameters<typeof createAgentHandler>[0]);
 const send=async(path:string,method='GET',body?:unknown,key='writer',command='requirements-api-command')=>{const res=await handler(new Request(config.baseURL+path,{method,headers:{host:'requirements.example.test',authorization:'Bearer '+key,'content-type':'application/json','idempotency-key':command},...(body?{body:JSON.stringify(body)}:{})}));return{status:res.status,body:await res.json()};};return{repo,send,fences:()=>fences};
}
test('requirement API shares owner service and requires independent scopes, full fields, fence, readback and exact replay',async()=>{
 const {repo,send,fences}=fixture();
 assert.equal((await send('/v1/requirements/snapshot')).body.total,34);
 const first=await send('/v1/requirements','POST',{fields});assert.equal(first.status,201);assert.equal(fences(),1);
 const id=first.body.entry.id,replay=await send('/v1/requirements','POST',{fields});assert.equal(replay.status,200);assert.equal(replay.body.duplicate,true);
 const edited=await send('/v1/requirements/'+id,'PATCH',{fields:{...fields,priority:'P1'},expectedRevision:1,baselineBinding:null},'writer','requirements-api-edit');assert.equal(edited.status,200);assert.equal(edited.body.entry.revision,2);
 assert.equal((await send('/v1/requirements/'+id)).body.entry.fields.priority,'P1');assert.equal(repo.rows.size,1);
 assert.equal((await send('/v1/requirements','POST',{fields},'reader')).status,403);
 assert.equal((await send('/v1/requirements/snapshot','GET',undefined,'todo')).status,403);
 assert.equal((await send('/v1/requirements','POST',{fields,acceptance:{}},'writer','requirements-api-forged')).status,400);
});
test('requirements discovery is absent when module/readiness closed; legacy catalog remains todo only',async()=>{
 for(const [enabled,ready] of [[false,true],[true,false],[true,true]]){
  const {send}=fixture(enabled,ready);const catalog=await send('/v2/capabilities');assert.equal(catalog.status,200);
  assert.equal(catalog.body.operations.filter((x:{module:string})=>x.module==='requirements').length,enabled&&ready?4:0);
  assert.equal((await send('/v1/requirements/snapshot')).status,!enabled?404:!ready?503:200);
 }
 const {send}=fixture();const reader=await send('/v2/capabilities','GET',undefined,'reader');assert.equal(reader.body.operations.filter((x:{module:string})=>x.module==='requirements').length,2);
 const legacy=await send('/v1/capabilities','GET',undefined,'todo');assert.equal(legacy.body.operations.length,6);assert.equal(legacy.body.operations.some((x:{path:string})=>x.path.includes('requirements')),false);
});
test('legacy and organization issuer modes cannot advertise, create or replace with future requirements scopes',async()=>{
 const scopes=['requirements:read','requirements:write'],deps={authenticate:async()=>true,list:async()=>({keys:[]}),issue:async()=>{throw Error('must not issue');},revoke:async()=>true,setScopes:async()=>{throw Error('must not escalate');}};
 for(const mode of [undefined,'organization-v1'] as const){
  const issuer=createKeyIssuer(deps,Date.now,mode),list=await issuer('list','synthetic-cookie',{});
  assert.equal(JSON.stringify(list.body).includes('requirements:'),false);
  assert.equal((await issuer('create','synthetic-cookie',{name:'Synthetic',scopes,expiresInDays:7})).status,400);
  assert.equal((await issuer('setScopes','synthetic-cookie',{id:'synthetic-grant',expectedGrantDigest:'a'.repeat(64),scopes})).status,mode?400:503);
 }
});

test('requirements runtime flags and native readiness are independent of legacy modules and default closed',async()=>{
 const {readAgentBusinessModules}=await import('../src/agent-api/config.ts'),{agentOperationAvailable,verifyAgentRequirementsReadiness}=await import('../src/agent-api/runtime.ts');
 assert.deepEqual(readAgentBusinessModules({},config),{organization:false,classification:false});
 assert.throws(()=>readAgentBusinessModules({LIFEOS_AGENT_REQUIREMENTS:'requirements-v1'},{...config,requirementsEnabled:undefined}));
 assert.throws(()=>readAgentBusinessModules({LIFEOS_AGENT_REQUIREMENTS:'1'},config));
 assert.equal(readAgentBusinessModules({LIFEOS_AGENT_REQUIREMENTS:'requirements-v1'},config).requirements,true);
 assert.equal(agentOperationAvailable('snapshotRequirements',config,true),false);
 assert.equal(agentOperationAvailable('snapshotRequirements',config,false,{organization:false,classification:false,requirements:true}),false);
 assert.equal(agentOperationAvailable('snapshotRequirements',config,true,{organization:false,classification:false,requirements:true}),true);
 for(const marker of [{version:false,language:true,marker_safe:true},{version:true,language:false,marker_safe:true},{version:true,language:true,marker_safe:false}]){
  let calls=0;await assert.rejects(verifyAgentRequirementsReadiness({query:async()=>({rows:[++calls===1?{all:true}:{...marker,can_validate:false}]})}),{code:'AGENT_REQUIREMENTS_UNAVAILABLE'});
 }
});
test('new issuer mode explicitly advertises and issues requirements scopes without granting anything implicitly',async()=>{
 let received:unknown;
 const issuer=createKeyIssuer({authenticate:async()=>true,list:async()=>({keys:[]}),issue:async input=>{received=input;return{key:'synthetic-only',grant:{id:'synthetic-grant',name:input.name,scopes:input.scopes,createdAt:new Date().toISOString(),expiresAt:null,status:'active'}};},revoke:async()=>true},Date.now,'requirements-v1');
 assert.equal(JSON.stringify((await issuer('list','synthetic-cookie',{})).body).includes('requirements:read'),true);
 const result=await issuer('create','synthetic-cookie',{name:'Synthetic',scopes:['requirements:read'],expiresInDays:7});assert.equal(result.status,201);assert.deepEqual((received as {scopes:string[]}).scopes,['requirements:read']);
});

test('readiness exact function digests match proposed0014 while runtime receives no validator EXECUTE',async()=>{
 const {readFile}=await import('node:fs/promises'),{createHash}=await import('node:crypto'),{requirementsGrantSourceDigests,verifyAgentRequirementsReadiness}=await import('../src/agent-api/runtime.ts');
 const sql=await readFile('db/0014_requirements_agent_grants.proposed.sql','utf8');
 for(const [fn,expected]of [['valid_business_permissions',requirementsGrantSourceDigests.permissions],['assert_business_grant',requirementsGrantSourceDigests.fence]]){
  const body=new RegExp('CREATE OR REPLACE FUNCTION lifeos_agent\\.'+fn+'\\(.*?AS \\$\\$(.*?)\\$\\$;','s').exec(sql)![1];assert.equal(createHash('sha256').update(body).digest('hex'),expected);
 }
 let calls=0;await verifyAgentRequirementsReadiness({query:async()=>({rows:[++calls===1?{all:true}:{version:true,language_source:true,fence_source:true,marker_safe:true,can_validate:false}]})});assert.equal(calls,2);
 for(const key of ['language_source','fence_source']){let count=0;await assert.rejects(verifyAgentRequirementsReadiness({query:async()=>({rows:[++count===1?{all:true}:{version:true,language_source:true,fence_source:true,marker_safe:true,can_validate:false,[key]:false}]})}),{code:'AGENT_REQUIREMENTS_UNAVAILABLE'});}
});
