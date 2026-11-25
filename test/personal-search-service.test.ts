import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryPort} from './helpers/platform.ts';
import {PersonalService} from '../src/personal-candidate/service.ts';
import {handlePersonalRequest} from '../src/personal-candidate/http.ts';
import type {PersonalConfig} from '../src/personal-candidate/config.ts';
const config:PersonalConfig={ownerId:'search-synthetic-owner',ownerEmail:'search@example.invalid',spaceId:'search-synthetic-space',databaseName:'lifeos_platform_test_local',allowedTypes:['todo','journal','project','domain','topic'],approval:'personal-manual-v1',baseURL:'https://search.example.invalid'};
async function setup(){const repo=new MemoryPort();repo.readCurrentSnapshot=async owner=>structuredClone([...repo.rows.values()].filter(row=>row.ownerId===owner));const service=new PersonalService(repo,config);const task=(await service.mutate(config.ownerId,'todo',null,{spaceId:config.spaceId,confirmed:true,fields:{title:'Alpha task',notes:'Body needle at the end',dueOn:null,status:'open'}},'search-fixture-task')).entry;await service.mutate(config.ownerId,'journal',null,{spaceId:config.spaceId,confirmed:true,fields:{title:'Beta journal',text:'A dated account',occurredOn:'2026-11-13'}},'search-fixture-journal');return{repo,service,task};}
test('search matches title and prose without matching serialized metadata or stable IDs',async()=>{const{service,task}=await setup();assert.equal((await service.search(config.ownerId,'alpha')).items[0].id,task.id);assert.equal((await service.search(config.ownerId,'NEEDLE')).items[0].id,task.id);for(const query of ['open','dueOn','notes',task.id,'personal-manual-v1'])assert.equal((await service.search(config.ownerId,query)).items.length,0,query);});
test('search describes exact authorized snapshot and preserves unknown dates and stable sources',async()=>{const{repo,service,task}=await setup();const snapshot=JSON.stringify([...repo.rows.values()]);const value=await service.search(config.ownerId,'');assert.deepEqual(value.coverage,{types:['todo','journal','project','domain','topic'],scanned:2,matched:2});const found=value.items.find(entry=>entry.id===task.id)!;assert.equal(found.source.id,task.source.id);assert.equal('dueOn'in found.draft&&found.draft.dueOn,null);assert.equal(JSON.stringify([...repo.rows.values()]),snapshot);const restricted=new PersonalService(repo,{...config,allowedTypes:['todo']});assert.deepEqual((await restricted.search(config.ownerId,'')).coverage,{types:['todo'],scanned:1,matched:1});const empty=new MemoryPort();empty.readCurrentSnapshot=async()=>[];assert.deepEqual((await new PersonalService(empty,config).search(config.ownerId,'nothing')).coverage,{types:['todo','journal','project','domain','topic'],scanned:0,matched:0});});
test('search HTTP remains GET only and no-store, rechecks owner after the read, and fails closed on missing full snapshot',async()=>{const{service,repo}=await setup();const request=(method='GET')=>new Request(config.baseURL+'/api/platform/personal/search?q=needle',{method,headers:{host:new URL(config.baseURL).host}});let writes=0,checks=0;const guards={assertOwner:async()=>{checks++;},assertWritable:async()=>{writes++;}};const response=await handlePersonalRequest(request(),config.ownerId,config.baseURL,service,guards);assert.equal(response?.status,200);assert.equal(response?.headers.get('cache-control'),'private, no-store');assert.equal(checks,2);assert.equal(writes,0);assert.equal((await handlePersonalRequest(request('POST'),config.ownerId,config.baseURL,service,guards))?.status,405);checks=0;await assert.rejects(handlePersonalRequest(request(),config.ownerId,config.baseURL,service,{...guards,assertOwner:async()=>{if(++checks===2)throw Error('revoked');}}),/revoked/);repo.readCurrentSnapshot=undefined;await assert.rejects(service.search(config.ownerId,'needle'),{code:'PERSONAL_SNAPSHOT_UNAVAILABLE'});await assert.rejects(service.search('foreign-owner','needle'),{code:'OWNER_ONLY'});});
test('search orders newest edited records first without changing the stored snapshot',async()=>{const{service,repo,task}=await setup();const row=repo.rows.get(task.id)!;repo.rows.delete(task.id);repo.rows.set(task.id,row);row.updatedAt='2026-11-14T00:00:00.000Z';const journal=[...repo.rows.values()].find(entry=>entry.id!==task.id)!;journal.updatedAt='2026-11-13T00:00:00.000Z';assert.equal((await service.search(config.ownerId,'')).items[0].id,task.id);row.updatedAt=journal.updatedAt;row.createdAt='2026-11-12T00:00:00.000Z';journal.createdAt='2026-11-13T00:00:00.000Z';assert.equal((await service.search(config.ownerId,'')).items[0].id,journal.id);});

test('personal search applies inclusive cross-year Shanghai dates without dropping unknown dates from unfiltered search', async () => {
 const {repo} = await setup();
 const service = new PersonalService(repo, {...config, calendarEnabled: true});
 const create = async (type: 'journal'|'calendar', fields: object, key: string) =>
  (await service.mutate(config.ownerId, type, null, {spaceId: config.spaceId, confirmed: true, fields}, key)).entry;
 const december = await create('journal', {title: 'Boundary December', text: 'Boundary', occurredOn: '2025-12-31'}, 'search-date-december');
 const january = await create('journal', {title: 'Boundary January', text: 'Boundary', occurredOn: '2026-01-01'}, 'search-date-january');
 const unknown = await create('journal', {title: 'Boundary unknown', text: 'Boundary', occurredOn: null}, 'search-date-unknown');
 const timed = await create('calendar', {title: 'Boundary timed', text: 'Boundary', occurredOn: null,
  personal: {type: 'calendar', schemaVersion: 1, calendarKind: 'event', links: {project: null, domain: null, people: []},
   schedule: {kind: 'timed', startAt: '2025-12-31T16:00:00Z', endAt: '2025-12-31T17:00:00Z', timeZone: 'UTC'}}}, 'search-date-shanghai');
 const send = (params: string) => handlePersonalRequest(
  new Request(config.baseURL + '/api/platform/personal/search?' + params, {headers: {host: new URL(config.baseURL).host}}),
  config.ownerId, config.baseURL, service,
  {assertOwner: async () => {}, assertWritable: async () => {throw Error('read only');}},
 );
 const otherConfig = {...config, ownerId: 'search-date-other-owner', ownerEmail: 'other@example.invalid'};
 const other = await new PersonalService(repo,otherConfig).mutate(otherConfig.ownerId,'journal',null,{
  spaceId: config.spaceId, confirmed: true, fields: {title: 'Boundary foreign', text: 'Boundary', occurredOn: '2026-01-01'},
 },'search-date-foreign');
 const anotherSpace = {...config, spaceId: 'search-date-other-space'};
 await new PersonalService(repo,anotherSpace).mutate(config.ownerId,'journal',null,{
  spaceId: anotherSpace.spaceId, confirmed: true, fields: {title: 'Boundary other space', text: 'Boundary', occurredOn: '2026-01-01'},
 },'search-date-other-space');

 const range = await send('q=boundary&from=2025-12-31&to=2026-01-01');
 assert.ok(range);
 assert.equal(range.status, 200);
 assert.equal(range.headers.get('cache-control'), 'private, no-store');
 const value = await range.json();
 assert.equal(value.from, '2025-12-31');
 assert.equal(value.to, '2026-01-01');
 assert.deepEqual(new Set(value.items.map((entry: {id: string}) => entry.id)), new Set([december.id, january.id, timed.id]));
 assert.equal(value.coverage.scanned, 6);
 assert.equal(value.coverage.matched, 3);

 const from = await send('q=boundary&from=2026-01-01&to=');
 assert.ok(from);
 assert.equal(from.status, 200);
 assert.deepEqual(new Set((await from.json()).items.map((entry: {id: string}) => entry.id)), new Set([january.id, timed.id]));
 const to = await send('q=boundary&to=2025-12-31');
 assert.ok(to);
 assert.equal(to.status, 200);
 assert.deepEqual((await to.json()).items.map((entry: {id: string}) => entry.id), [december.id]);
 const original = await send('q=boundary');
 assert.ok(original);
 assert.equal(original.status, 200);
 const unfiltered = await original.json();
 assert.equal(Object.hasOwn(unfiltered, 'from'), false);
 assert.ok(unfiltered.items.some((entry: {id: string}) => entry.id === unknown.id));
 for (const params of ['from=2026-02-30', 'from=2026-01-01&to=2025-12-31', 'to=2026-01-01&to=2026-01-01']) {
  await assert.rejects(send('q=boundary&' + params), {status: 400});
 }
 repo.rows.delete(january.id);
 for (const id of [january.id, other.entry.id, '11111111-1111-4111-8111-111111111111']) {
  await assert.rejects(handlePersonalRequest(
   new Request(config.baseURL + '/api/platform/personal/journal/' + id,{headers:{host:new URL(config.baseURL).host}}),
   config.ownerId,config.baseURL,service,{assertOwner:async()=>{},assertWritable:async()=>{throw Error('read only');}},
  ),{status:404,code:'NOT_FOUND',message:'没有可访问的本人记录。'});
 }
});
