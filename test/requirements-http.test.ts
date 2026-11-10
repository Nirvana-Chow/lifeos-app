import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersonalPlatformHandler} from '../src/personal-candidate/runtime-http.ts';
import {MemoryPort} from './helpers/platform.ts';
import {requirements} from '../src/platform/requirements.ts';
const config={ownerId:'requirements-owner',ownerEmail:'fixture@example.test',spaceId:'requirements-space',databaseName:'fixture',baseURL:'https://requirements.example.test',approval:'personal-manual-v1',allowedTypes:['todo','journal'],requirementsEnabled:true} as const;
const fields={title:'Synthetic owner input',body:'Private body',phaseId:requirements().roadmap!.phases[0].id,priority:'P3',plannedStartOn:null,plannedEndOn:null};
function setup(enabled=true){
 const repo=new MemoryPort(),native=repo.transaction.bind(repo);repo.transaction=(owner,key,fn)=>native(owner,key,tx=>fn({...tx,lockRecordIdentity:async()=>{}}));repo.readCurrentSnapshot=async owner=>structuredClone([...repo.rows.values()].filter(r=>r.ownerId===owner));
 let owner:string|null=config.ownerId,writable=true,checks=0;
 const handler=createPersonalPlatformHandler({repository:repo,config:{...config,requirementsEnabled:enabled?true:undefined},sessions:{read:async()=>owner?{userId:owner,email:config.ownerEmail}:null},storageVerified:true,assertWritable:async()=>{checks++;if(!writable)throw Error('closed');}});
 const send=async(path:string,method='GET',body?:unknown,extra:Record<string,string>={})=>{const res=await handler(new Request(config.baseURL+'/api/platform/personal/requirements'+path,{method,headers:{host:'requirements.example.test',origin:config.baseURL,'content-type':'application/json','idempotency-key':'requirements-http-command',...extra},...(body?{body:JSON.stringify(body)}:{})}));return{status:res.status,body:await res.json()};};
 return{repo,send,setOwner:(value:string|null)=>{owner=value;},setWritable:(value:boolean)=>{writable=value;},checks:()=>checks};
}
test('owner requirement create/read/edit/history uses current authorization and same persistent service',async()=>{
 const {send,repo}=setup(),body={spaceId:config.spaceId,confirmed:true,fields};
 assert.equal((await send('/snapshot')).body.total,requirements().requirements.length);
 const created=await send('','POST',body);assert.equal(created.status,201);assert.equal(repo.rows.size,1);
 const id=created.body.entry.id;assert.equal((await send('/'+id)).body.entry.fields.title,fields.title);
 const updated=await send('/'+id,'PATCH',{...body,fields:{...fields,title:'Changed'},expectedRevision:1,baselineBinding:null},{'idempotency-key':'requirements-http-edit'});assert.equal(updated.status,200);assert.equal(updated.body.entry.revision,2);
 const history=await send('/'+id+'/history?limit=1');assert.equal(history.status,200);assert.equal(history.body.items.length,1);assert.equal(history.body.truncated,true);
 assert.equal((await send('/snapshot')).body.total,requirements().requirements.length+1);
});
test('owner requirements deny foreign session, bearer, cross-origin, closed writes and oversized body; module closed by default',async()=>{
 const f=setup(),body={spaceId:config.spaceId,confirmed:true,fields};
 f.setOwner('foreign-owner');assert.equal((await f.send('/snapshot')).status,403);
 f.setOwner(null);assert.equal((await f.send('/snapshot')).status,401);
 f.setOwner(config.ownerId);assert.equal((await f.send('','POST',body,{authorization:'Bearer synthetic'})).status,403);
 assert.equal((await f.send('','POST',body,{origin:'https://foreign.example.test'})).status,403);
 assert.equal((await f.send('','POST',{...body,fields:{...fields,body:'x'.repeat(131073)}})).status,413);
 f.setWritable(false);assert.equal((await f.send('','POST',body)).status,503);assert.equal((await f.send('/snapshot')).status,200);
 assert.equal((await setup(false).send('/snapshot')).status,404);assert.equal(f.repo.rows.size,0);
});
