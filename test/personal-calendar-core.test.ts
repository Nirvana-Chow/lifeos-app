import test from 'node:test';
import assert from 'node:assert/strict';
import type {CalendarPersonalFields} from '../src/calendar-candidate/personal-domain.ts';
import {PersonalService} from '../src/personal-candidate/service.ts';
import {PersonalCalendarService} from '../src/calendar-candidate/personal-service.ts';
import {createPersonalPlatformHandler} from '../src/personal-candidate/runtime-http.ts';
import {MemoryPort} from './helpers/platform.ts';
const config={ownerId:'calendar-core-owner',ownerEmail:'fixture@example.test',spaceId:'calendar-core-space',databaseName:'fixture',baseURL:'https://calendar.example.test',approval:'personal-manual-v1',allowedTypes:['todo','journal','project','domain','topic'],calendarEnabled:true} as const;
const fields:CalendarPersonalFields={title:'Synthetic calendar',text:'Preserve long notes',occurredOn:null,personal:{type:'calendar',schemaVersion:1,links:{project:null,domain:null,people:[]},calendarKind:'event',schedule:null}};
const input=(value:CalendarPersonalFields=fields)=>({spaceId:config.spaceId,confirmed:true,fields:value});
function setup(){const repo=new MemoryPort();repo.readCurrentSnapshot=async owner=>structuredClone([...repo.rows.values()].filter(r=>r.ownerId===owner));const personal=new PersonalService(repo,config);return{repo,personal,calendar:new PersonalCalendarService(personal,{ownerId:config.ownerId,spaceId:config.spaceId,enabled:true,writable:true})};}
test('one calendar flag enables existing inbox writer without adding allowedTypes or affecting requirement rows',async()=>{
 const {repo,personal,calendar}=setup();const first=await calendar.mutate(config.ownerId,null,input(),'calendar-core-create');assert.equal(first.entry.fields.personal.type,'calendar');assert.equal(repo.rows.size,1);
 const reload=new PersonalCalendarService(new PersonalService(repo,config),{ownerId:config.ownerId,spaceId:config.spaceId,enabled:true,writable:true});assert.equal((await reload.get(config.ownerId,first.entry.id)).fields.text,fields.text);
 assert.equal((await reload.mutate(config.ownerId,first.entry.id,{...input({...fields,title:'Edited'}),expectedRevision:1},'calendar-core-edit')).entry.revision,2);
 assert.equal((await calendar.mutate(config.ownerId,null,input(),'calendar-core-create')).duplicate,true);assert.equal((await calendar.history(config.ownerId,first.entry.id)).entries.length,2);
 await assert.rejects(new PersonalService(repo,{...config,calendarEnabled:undefined}).get(config.ownerId,'calendar',first.entry.id),{code:'PERSONAL_TYPE_DENIED'});
 assert.equal((await personal.currentSnapshot(config.ownerId)).length,1);assert.deepEqual(config.allowedTypes,['todo','journal','project','domain','topic']);
});
test('calendar relations share same-owner source/version locks and reject unsupported people without partial writes',async()=>{
 const {repo,personal,calendar}=setup();const project=await personal.mutate(config.ownerId,'project',null,{spaceId:config.spaceId,confirmed:true,fields:{title:'Synthetic project',text:'',occurredOn:null,personal:{type:'project',stage:'active',purpose:null,nextStep:'',domain:null,topics:[]}}},'calendar-core-project');
 const pin={id:project.entry.id,sourceId:project.entry.source.id,revision:1},linked={...fields,personal:{...fields.personal,links:{project:pin,domain:null,people:[]}}};assert.equal((await calendar.mutate(config.ownerId,null,input(linked),'calendar-core-linked')).entry.fields.personal.links.project!.id,pin.id);
 for(const links of [{project:{...pin,revision:2},domain:null,people:[]},{project:null,domain:pin,people:[]},{project:null,domain:null,people:[pin]}])await assert.rejects(calendar.mutate(config.ownerId,null,input({...fields,personal:{...fields.personal,links}}),'calendar-core-invalid-'+crypto.randomUUID()),{code:'REFERENCE_CONFLICT'});
 assert.equal(repo.rows.size,2);assert.equal(repo.historyRows.length,2);
});
test('owner calendar route defaults closed, requires current owner/origin/write permit, exposes private reads and actual CAS',async()=>{
 const {repo}=setup();let owner:string|null=config.ownerId,writable=true;const build=(enabled:boolean)=>createPersonalPlatformHandler({repository:repo,config:{...config,calendarEnabled:enabled?true:undefined},storageVerified:true,sessions:{read:async()=>owner?{userId:owner,email:config.ownerEmail}:null},assertWritable:async()=>{if(!writable)throw Error('closed');}});
 const send=async(path:string,method='GET',body?:unknown,headers:Record<string,string>={},enabled=true)=>{const res=await build(enabled)(new Request(config.baseURL+'/api/platform/personal/calendar'+path,{method,headers:{host:'calendar.example.test',origin:config.baseURL,'content-type':'application/json','idempotency-key':'calendar-core-http',...headers},...(body?{body:JSON.stringify(body)}:{})}));return{status:res.status,body:await res.json()};};
 assert.equal((await send('/status','GET',undefined,{},false)).body.configured,false);assert.equal((await send('/status')).body.writable,true);
 const created=await send('','POST',input());assert.equal(created.status,201);const id=created.body.entry.id;assert.equal((await send('/'+id)).status,200);
 assert.equal((await send('/'+id,'PATCH',{...input(),expectedRevision:2},{'idempotency-key':'calendar-http-stale'})).status,409);
 assert.equal((await send('','POST',input(),{origin:'https://foreign.example.test'})).status,403);assert.equal((await send('/references','GET',undefined,{authorization:'Bearer synthetic'})).status,403);
 owner='foreign-owner';assert.equal((await send('/status')).status,403);owner=null;assert.equal((await send('/status')).status,401);owner=config.ownerId;writable=false;assert.equal((await send('/status')).body.writable,false);assert.equal((await send('','POST',input(),{'idempotency-key':'calendar-http-locked'})).status,403);assert.equal(repo.rows.size,1);
});
test('calendar history uses the actual record boundary and never calls missing native revisions complete',async()=>{
 const {repo,calendar}=setup(),created=await calendar.mutate(config.ownerId,null,input(),'calendar-core-history');const row=repo.rows.get(created.entry.id)!;row.revision=105;repo.historyRows=Array.from({length:105},(_,i)=>({...structuredClone(row),revision:i+1}));
 const bounded=await calendar.history(config.ownerId,row.id);assert.equal(bounded.entries.length,100);assert.equal(bounded.truncated,true);assert.equal(bounded.complete,false);
 repo.historyRows=[];await assert.rejects(calendar.history(config.ownerId,row.id),{code:'CALENDAR_HISTORY_UNAVAILABLE'});
});
test('owner calendar flag is strict and leaves the approved five generic allowedTypes unchanged',async()=>{
 const {readPersonalConfig}=await import('../src/personal-candidate/config.ts');const platform={ownerId:config.ownerId,ownerEmail:config.ownerEmail,baseURL:config.baseURL,databaseURL:'postgresql://lifeos_platform_candidate_runtime:synthetic-only@127.0.0.1:55432/lifeos_platform_test_local'};
 const env={LIFEOS_PERSONAL_ENABLED:'1',LIFEOS_PERSONAL_APPROVED:'personal-manual-v1',LIFEOS_PERSONAL_OWNER_ID:config.ownerId,LIFEOS_PERSONAL_OWNER_EMAIL:config.ownerEmail,LIFEOS_PERSONAL_SPACE_ID:config.spaceId,LIFEOS_PERSONAL_DATABASE_NAME:'lifeos_platform_test_local',LIFEOS_PERSONAL_ALLOWED_TYPES:'todo,journal,project,domain,topic',LIFEOS_PERSONAL_B_CANDIDATE:'project-domain-v1'};
 assert.equal(readPersonalConfig(env,platform)!.calendarEnabled,undefined);assert.throws(()=>readPersonalConfig({...env,LIFEOS_PERSONAL_CALENDAR:'1'},platform));const enabled=readPersonalConfig({...env,LIFEOS_PERSONAL_CALENDAR:'personal-calendar-v1'},platform)!;assert.equal(enabled.calendarEnabled,true);assert.deepEqual(enabled.allowedTypes,config.allowedTypes);
});
test('calendar records preserve the main overview and generic editor contracts',async()=>{
 const {personal,calendar}=setup();const created=await calendar.mutate(config.ownerId,null,input(),'calendar-overview-create');
 const {workspaceData}=await import('../src/personal-candidate/workspace-data.ts');
 const overview=await personal.overview(config.ownerId,'2030-11-05');const projected=workspaceData(overview,config.spaceId,'2030-11-05');
 assert.equal(projected.entries[0].id,created.entry.id);assert.equal(projected.data.tasks.length,0);
 assert.deepEqual(overview.counts,{open:0,done:0,cancelled:0,overdue:0});
});
test('owner calendar remains unavailable with unverified storage and rejects bearer authority',async()=>{
 const {repo}=setup();const handler=createPersonalPlatformHandler({repository:repo,config,storageVerified:false,sessions:{read:async()=>({userId:config.ownerId,email:config.ownerEmail})},assertWritable:async()=>{}});
 const request=(headers:Record<string,string>={})=>new Request(config.baseURL+'/api/platform/personal/calendar/status',{headers:{host:'calendar.example.test',...headers}});
 assert.equal((await (await handler(request())).json()).configured,false);
 assert.equal((await handler(request({authorization:'Bearer synthetic-not-owner-authority'}))).status,403);
 assert.equal(repo.rows.size,0);
});
test('current owner write authority is rechecked inside the shared calendar transaction',async()=>{
 const {repo,calendar}=setup();let calls=0;
 await assert.rejects(calendar.mutate(config.ownerId,null,input(),'calendar-revoked-before-commit',async()=>{if(++calls===3)throw Error('synthetic revoked owner permit');}),/revoked owner permit/);
 assert.ok(calls>=3);assert.equal(repo.rows.size,0);assert.equal(repo.historyRows.length,0);assert.equal(repo.receipts.size,0);
});
