import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryPort} from './helpers/platform.ts';
import {PersonalService} from '../src/personal-candidate/service.ts';
import {makePersonalCommand,PersonalMutationSession} from '../src/personal-candidate/client.ts';
import type {PersonalConfig} from '../src/personal-candidate/config.ts';
const config:PersonalConfig={ownerId:'record-client-owner',ownerEmail:'client@example.invalid',spaceId:'record-client-space',databaseName:'lifeos_platform_test_local',allowedTypes:['journal'],approval:'personal-manual-v1',baseURL:'https://client.example.invalid'};
test('new record client retains the exact command until independent GET and current-owner status succeed',async()=>{
 const repo=new MemoryPort(),service=new PersonalService(repo,config),store=new Map<string,string>(),sent:{key:string|null;body:string}[]=[];let lose=true;
 const session=new PersonalMutationSession({binding:config,verifyReadback:true,storage:{getItem:key=>store.get(key)??null,setItem:(key,value)=>{store.set(key,value);},removeItem:key=>{store.delete(key);}},fetcher:async(input,init)=>{
  const url=String(input);if(init?.method==='POST'){sent.push({key:new Headers(init.headers).get('idempotency-key'),body:String(init.body)});const result=await service.mutate(config.ownerId,'journal',null,JSON.parse(String(init.body)),sent.at(-1)!.key!);return Response.json(result,{status:result.duplicate?200:201});}
  if(url.endsWith('/status'))return Response.json({...config,storageVerified:true});
  if(lose)throw Error('readback disconnected');return Response.json({entry:await service.get(config.ownerId,'journal',url.split('/').at(-1)!)});
 }});
 const command=makePersonalCommand({ownerId:config.ownerId,spaceId:config.spaceId},'journal',null,{title:'Synthetic day',text:'Synthetic content',occurredOn:null},'record-client-retry',true);
 await session.submit(command);assert.equal(session.getSnapshot().phase,'uncertain');assert.equal(store.size,1);assert.equal(repo.rows.size,1);
 lose=false;await session.retry();assert.equal(session.getSnapshot().phase,'saved');assert.equal(store.size,0);assert.deepEqual(sent[0],sent[1]);assert.equal(repo.rows.size,1);
});

test('an exact historical receipt can complete when independent GET observes a legitimate newer revision',async()=>{
 const repo=new MemoryPort(),service=new PersonalService(repo,config),store=new Map<string,string>();let lose=true;
 const binding={ownerId:config.ownerId,spaceId:config.spaceId};
 const session=new PersonalMutationSession({binding,verifyReadback:true,storage:{getItem:key=>store.get(key)??null,setItem:(key,value)=>{store.set(key,value);},removeItem:key=>{store.delete(key);}},fetcher:async(input,init)=>{
  const url=String(input);if(init?.method==='POST'){const result=await service.mutate(config.ownerId,'journal',null,JSON.parse(String(init.body)),new Headers(init.headers).get('idempotency-key')!);if(!result.duplicate)await service.mutate(config.ownerId,'journal',result.entry.id,{spaceId:config.spaceId,confirmed:true,expectedRevision:1,fields:{title:'Later edit',text:'Another authorized edit',occurredOn:null}},'record-other-writer');return Response.json(result,{status:result.duplicate?200:201});}
  if(url.endsWith('/status'))return Response.json({...config,storageVerified:true});
  if(lose)throw Error('readback disconnected');return Response.json({entry:await service.get(config.ownerId,'journal',url.split('/').at(-1)!)});
 }});
 await session.submit(makePersonalCommand(binding,'journal',null,{title:'Original',text:'First authorized input',occurredOn:null},'record-newer-replay',true));assert.equal(session.getSnapshot().phase,'uncertain');
 lose=false;await session.retry();assert.equal(session.getSnapshot().phase,'saved');assert.equal(session.getSnapshot().saved?.revision,1);assert.equal(session.getSnapshot().observed?.revision,2);assert.equal(store.size,0);assert.equal(repo.rows.size,1);
});
