import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequirementEventHandler} from '../src/requirement-events/http.ts';
import {claimsPath,streamPath,type EventActor} from '../src/requirement-events/contracts.ts';
const origin='https://lifeos.nirvanachow.com',actor={kind:'agent-grant',ownerId:'synthetic-owner',spaceId:'synthetic-space',grantId:'synthetic-grant',scopes:['requirements:read','requirements:write']} as unknown as EventActor;
const request=(path=streamPath,headers:Record<string,string>={},method='GET',body?:unknown)=>new Request(origin+path,{method,headers:{host:'lifeos.nirvanachow.com',authorization:'Bearer synthetic-event-key',accept:'text/event-stream',...(body?{'content-type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
test('event HTTP is closed by default and rejects host/path/query/auth before touching the event store',async()=>{
 let calls=0;const options={origin,authorize:async()=>{calls++;return{actor,current:async()=>{}};},events:{batch:async()=>{throw Error('unexpected');}} as never,requirements:{} as never,wait:async()=>{}};
 assert.equal((await createRequirementEventHandler(options)(request())).status,404);
 const handler=createRequirementEventHandler({...options,enabled:true});
 for(const r of [request(streamPath,{host:'evil.invalid'}),request(streamPath+'?cursor=0'),request(streamPath+'/extra'),request(streamPath,{authorization:'',cookie:'owner-session'})])assert.ok([401,403,404].includes((await handler(r)).status));
 assert.equal(calls,0);
});
test('stream persists replay cursor frames but heartbeats do not advertise executable work; revocation stops delivery',async()=>{
 let current=true,batches=0,waits=0;const abort=new AbortController();
 const handler=createRequirementEventHandler({enabled:true,origin,authorize:async()=>({actor,current:async()=>{if(!current)throw Error('revoked');}}),events:{batch:async(_a:unknown,cursor:string)=>{assert.equal(cursor,'7');batches++;return{events:[],cursor:'7',reset:false,ready:[],readyTruncated:false};}} as never,requirements:{} as never,wait:async()=>{waits++;current=false;}});
 const r=request(streamPath,{'last-event-id':'7'});const response=await handler(new Request(r,{signal:abort.signal}));assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'text/event-stream');
 const text=await response.text();assert.equal(batches,1);assert.equal(waits,1);assert.match(text,/: keepalive/);assert.doesNotMatch(text,/synthetic-event-key|ownerId|spaceId|requirement-work/);
});
test('invalid cursor, method and owner/space payload cannot initiate a write',async()=>{
 let writes=0;const handler=createRequirementEventHandler({enabled:true,origin,authorize:async()=>({actor,current:async()=>{}}),events:{claim:async()=>{writes++;}} as never,requirements:{} as never});
 assert.equal((await handler(request(streamPath,{'last-event-id':'-1'}))).status,400);
 assert.equal((await handler(request(streamPath,{},'POST',{}))).status,405);
 const response=await handler(request(claimsPath,{'idempotency-key':'claim-synthetic-001'},'POST',{requirementId:'LO-REQ-001',workDigest:'a'.repeat(64),holderId:'synthetic-mac',ownerId:'forged'}));assert.equal(response.status,400);assert.equal(writes,0);
});

test('aborting an unread stream proactively releases its notification connection',async()=>{
 let closed=0;const abort=new AbortController();const handler=createRequirementEventHandler({enabled:true,origin,authorize:async()=>({actor,current:async()=>{}}),events:{batch:async()=>({cursor:'0',events:[],ready:[],reset:false,readyTruncated:false})} as never,requirements:{} as never,openNotifications:async()=>({wait:async()=>new Promise<void>(()=>{}),close:async()=>{closed++;}})});
 const r=await handler(new Request(request(),{signal:abort.signal})),reader=r.body!.getReader();await reader.read();abort.abort();await new Promise(resolve=>setImmediate(resolve));try{assert.equal(closed,1);}finally{await reader.cancel();}
});

test('revocation releases an unread notification connection within the bounded authorization interval',async t=>{
 t.mock.timers.enable({apis:['setInterval']});let allowed=true,closed=0;
 const handler=createRequirementEventHandler({enabled:true,origin,authorize:async()=>({actor,current:async()=>{if(!allowed)throw Error('revoked');}}),events:{batch:async()=>({cursor:'0',events:[],ready:[],reset:false,readyTruncated:false})} as never,requirements:{} as never,openNotifications:async()=>({wait:async()=>new Promise<void>(()=>{}),close:async()=>{closed++;}})});
 const response=await handler(request()),reader=response.body!.getReader();await reader.read();allowed=false;t.mock.timers.tick(15000);await new Promise(resolve=>setImmediate(resolve));try{assert.equal(closed,1);}finally{await reader.cancel();}
});
