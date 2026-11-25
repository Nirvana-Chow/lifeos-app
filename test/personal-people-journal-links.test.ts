import assert from 'node:assert/strict';
import test from 'node:test';
import {projectRelatedJournals,readLinkedPerson,relatedJournalHref} from '../src/personal-people/journal-links.ts';
import {emptyPersonPersonal} from '../src/personal-people/model.ts';
import {projectPeopleEntries} from '../src/personal-people/projection.ts';
import {PersonalService} from '../src/personal-candidate/service.ts';
import type {PersonalConfig} from '../src/personal-candidate/config.ts';
import {MemoryPort} from './helpers/platform.ts';

const config:PersonalConfig={ownerId:'synthetic-linked-owner',ownerEmail:'fixture@example.invalid',spaceId:'synthetic-linked-space',databaseName:'lifeos_platform_test_local',allowedTypes:['todo','journal'],approval:'personal-manual-v1',baseURL:'https://fixture.example.invalid',peopleEnabled:true};

test('one verified current journal links by person and source IDs, never by same name or copied text',async()=>{
 const repo=new MemoryPort();
 repo.readCurrentSnapshot=async owner=>[...repo.rows.values()].filter(row=>row.ownerId===owner);
 const service=new PersonalService(repo,config);
 const fields={title:'Synthetic namesake',text:'',occurredOn:null,personal:emptyPersonPersonal()};
 const save=(ordinal:number)=>service.mutate(config.ownerId,'person',null,{spaceId:config.spaceId,confirmed:true,fields},'link-person-fixture-'+ordinal);
 const [first,second,third]=await Promise.all([save(1),save(2),save(3)]);
 const pin=({entry}:typeof first)=>({id:entry.id,sourceId:entry.source.id,revision:entry.revision});
 const pins=[pin(first),pin(second)];
 const journal=(await service.mutate(config.ownerId,'journal',null,{spaceId:config.spaceId,confirmed:true,fields:{
  title:'Synthetic shared record',text:'Synthetic original stays at source',occurredOn:'2030-01-01',
  personal:{type:'journal',links:{project:null,domain:null,topics:[],people:pins}},
 }},'linked-journal-fixture')).entry;
 const changed=(await service.mutate(config.ownerId,'person',first.entry.id,{spaceId:config.spaceId,confirmed:true,expectedRevision:1,fields:{...fields,title:'Synthetic renamed person'}},'link-person-rename')).entry;
 const people=projectPeopleEntries([changed,second.entry,third.entry],config.spaceId);
 const snapshot=await service.overview(config.ownerId,'2030-01-01');
 const linked=projectRelatedJournals(snapshot,people,config.spaceId)!;
 assert.deepEqual(linked.get(first.entry.id),[{id:journal.id,title:'Synthetic shared record',occurredOn:'2030-01-01'}]);
 assert.strictEqual(linked.get(first.entry.id)![0],linked.get(second.entry.id)![0]);
 assert.equal(linked.has(third.entry.id),false);
 assert.equal(relatedJournalHref(journal.id,first.entry.id),'/personal/journal?record='+journal.id+'&person='+first.entry.id);
 assert.equal(projectRelatedJournals({...snapshot,truncated:true},people,config.spaceId),null);
 assert.equal(projectRelatedJournals(snapshot,people,'foreign-space'),null);
 const mismatched=people.map(person=>person.id===first.entry.id?{...person,sourceId:second.entry.source.id}:person);
 assert.equal(projectRelatedJournals(snapshot,mismatched,config.spaceId)?.has(first.entry.id),false);

 const status={...config,storageVerified:true};
 const lookup=(entry:unknown,ownerId=config.ownerId):typeof fetch=>async input=>
  Response.json(String(input).endsWith('/status')?{...status,ownerId}:{entry});
 assert.equal(await readLinkedPerson(pins[0],config,lookup(changed)),true);
 assert.equal(await readLinkedPerson(pins[0],config,lookup(third.entry)),false);
 assert.equal(await readLinkedPerson(pins[0],config,lookup(changed,'foreign-owner')),false);
});
