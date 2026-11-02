import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceStatusReader} from '../src/workbench/status-reader.ts';

const review=()=>Response.json({scope:'isolated-synthetic-review',personalAccountReady:false,personalDataAuthorized:false,storage:{restrictedRoleVerified:true,schemaVersion:2}});
test('authentication refresh replaces a prior connected review state with signed out',async()=>{
 const states:any[]=[];let signedIn=true;
 const reader=createWorkspaceStatusReader(async()=>signedIn?review():new Response(null,{status:401}),value=>states.push(value));
 await reader.refresh();assert.equal(states.at(-1).storageConnected,true);
 signedIn=false;await reader.refresh();
 assert.equal(states.at(-1).state,'not-signed-in');assert.equal(states.at(-1).storageConnected,false);
 assert.equal(states.at(-1).personalAccountReady,false);
});
test('a late authenticated status cannot overwrite a newer signed-out refresh',async()=>{
 let resolveOld!:(response:Response)=>void;let calls=0;const states:any[]=[];
 const reader=createWorkspaceStatusReader(()=>++calls===1?new Promise<Response>(resolve=>{resolveOld=resolve;}):Promise.resolve(new Response(null,{status:401})),value=>states.push(value));
 const old=reader.refresh();await reader.refresh();resolveOld(review());await old;
 assert.equal(states.at(-1).state,'not-signed-in');assert.equal(states.at(-1).storageConnected,false);
});
test('a disposed reader never publishes a late response and failures are explicit',async()=>{
 const states:any[]=[];const reader=createWorkspaceStatusReader(async()=>{throw Error('offline');},value=>states.push(value));
 await reader.refresh();assert.equal(states.at(-1).state,'unavailable');
 let resolve!:(r:Response)=>void;const second=createWorkspaceStatusReader(()=>new Promise<Response>(r=>{resolve=r;}),value=>states.push(value));
 const pending=second.refresh();second.dispose();const before=states.length;resolve(review());await pending;
 assert.equal(states.length,before);
});
test('calendar readiness requires the optional adapter and its verified role, separately from core storage',async()=>{
 for(const [extension,expected]of [[undefined,false],[{configured:true,restrictedRoleVerified:false},false],[{configured:false,restrictedRoleVerified:true},false],[{configured:true,restrictedRoleVerified:true},true]] as const){
  const states:any[]=[];const reader=createWorkspaceStatusReader(async()=>Response.json({scope:'isolated-synthetic-review',personalAccountReady:false,personalDataAuthorized:false,storage:{restrictedRoleVerified:true,schemaVersion:2},extensions:{calendar:extension}}),v=>states.push(v));
  await reader.refresh();assert.equal(states.at(-1).storageConnected,true);assert.equal(states.at(-1).calendarConnected,expected);
 }
});
