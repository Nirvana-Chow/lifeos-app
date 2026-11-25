import assert from 'node:assert/strict';
import test from 'node:test';
import {projectRelatedCalendarEvents} from '../src/personal-people/calendar-links.ts';
import {emptyPersonPersonal} from '../src/personal-people/model.ts';
import {projectPeopleEntries} from '../src/personal-people/projection.ts';
import {PersonalService} from '../src/personal-candidate/service.ts';
import type {PersonalConfig} from '../src/personal-candidate/config.ts';
import {MemoryPort} from './helpers/platform.ts';

test('confirmed visit tolerates a newer revision of the same person and rejects source or coverage drift',async()=>{
 const config:PersonalConfig={ownerId:'calendar-linked-owner',ownerEmail:'fixture@example.invalid',spaceId:'calendar-linked-space',databaseName:'lifeos_platform_test_local',allowedTypes:['todo','journal'],approval:'personal-manual-v1',baseURL:'https://fixture.example.invalid',peopleEnabled:true,calendarEnabled:true};
 const repo=new MemoryPort();
 repo.readCurrentSnapshot=async owner=>[...repo.rows.values()].filter(row=>row.ownerId===owner);
 const service=new PersonalService(repo,config);
 const save=(type:'person'|'calendar',id:string|null,fields:unknown,key:string,expectedRevision?:number)=>
  service.mutate(config.ownerId,type,id,{spaceId:config.spaceId,confirmed:true,fields,...(id?{expectedRevision}:{})},key);
 const profile={title:'Synthetic namesake',text:'',occurredOn:null,personal:emptyPersonPersonal()};
 const [{entry:person},{entry:decoy}]=await Promise.all([
  save('person',null,profile,'calendar-profile-fixture'),save('person',null,profile,'calendar-decoy-fixture'),
 ]);
 const pin={id:person.id,sourceId:person.source.id,revision:person.revision};
 const {entry:visit}=await save('calendar',null,{title:'Synthetic visit',text:'Synthetic original only',occurredOn:null,personal:{
  type:'calendar',schemaVersion:1,calendarKind:'event',schedule:{kind:'all-day',startDate:'2031-05-03',endDate:'2031-05-04'},
  links:{project:null,domain:null,people:[pin]},
 }},'calendar-visit-fixture');
 const {entry:newPerson}=await save('person',person.id,{...profile,text:'New synthetic revision'},'calendar-profile-update',person.revision);
 const profiles=projectPeopleEntries([newPerson,decoy],config.spaceId);
 const snapshot=await service.overview(config.ownerId,'2031-05-03');
 const result=projectRelatedCalendarEvents(snapshot,profiles,config.spaceId);
 assert.deepEqual(result?.get(person.id),[{id:visit.id,title:'Synthetic visit',date:'2031-05-03'}]);
 assert.equal(result?.has(decoy.id),false);
 assert.equal(projectRelatedCalendarEvents(snapshot,profiles.map(row=>({...row,sourceId:decoy.source.id})),config.spaceId)?.size,0);
 assert.equal(projectRelatedCalendarEvents(snapshot,profiles.map(row=>({...row,revision:0})),config.spaceId)?.size,0);
 assert.equal(projectRelatedCalendarEvents(snapshot,profiles,'foreign-space'),null);
 assert.equal(projectRelatedCalendarEvents({...snapshot,truncated:true},profiles,config.spaceId),null);
});
