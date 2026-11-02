import test from 'node:test';import assert from 'node:assert/strict';
import {MemoryPort} from './helpers/platform.ts';import {PersonalService} from '../src/personal-candidate/service.ts';
import type {PersonalConfig} from '../src/personal-candidate/config.ts';
const config={ownerId:'synthetic-owner-ab',ownerEmail:'synthetic@example.test',spaceId:'synthetic-space-ab',databaseName:'lifeos_platform_test_local',allowedTypes:['todo','journal','project','domain','topic'],approval:'personal-manual-ab-v1',baseURL:'https://personal.example.invalid'} as unknown as PersonalConfig;
const body=(fields:unknown)=>({spaceId:config.spaceId,confirmed:true,fields});
const obj=(type:string,title:string)=>({title,text:'Synthetic description',occurredOn:null,personal:type==='project'?{type,stage:'active',purpose:'advance',nextStep:'Synthetic next step',domain:null,topics:[]}:{type}});
const ref=(entry:any)=>({id:entry.id,sourceId:entry.source.id,revision:entry.revision});
const setup=()=>{const repo=new MemoryPort();repo.readCurrentSnapshot=async owner=>[...repo.rows.values()].filter(r=>r.ownerId===owner).map(r=>structuredClone(r));return{repo,s:new PersonalService(repo,config)};};
test('personal project/domain/topic persistence, references, source revisions, summary and search share IDs',async()=>{
 const{repo,s}=setup(),owner=config.ownerId;
 const d=(await s.mutate(owner,'domain' as never,null,body(obj('domain','Synthetic health')),'ab-domain-create')).entry;
 const p=(await s.mutate(owner,'project' as never,null,body({...obj('project','Synthetic project'),personal:{...obj('project','').personal,domain:ref(d)}}),'ab-project-create')).entry;
 const t=(await s.mutate(owner,'todo',null,body({title:'Synthetic task',notes:'manual',dueOn:null,status:'open',personal:{project:ref(p),domain:ref(d),topics:[]}}),'ab-task-create')).entry;
 assert.equal((await s.get(owner,'project' as never,p.id)).id,p.id);
 assert.equal((await s.list(owner)).items.length,3);
 const direct=await s.mutate(owner,'todo',null,body({title:'Synthetic direct',personal:{project:null,domain:ref(d),topics:[]}}),'ab-direct-create');assert.ok(direct.entry.id);
 const overview=await s.overview(owner,'2026-10-27');assert.equal(overview.counts.open,2);assert.equal(overview.projects[0].id,p.id);assert.equal(overview.total,4);
 assert.equal((await s.search(owner,'Synthetic project')).items[0].id,p.id);
 await s.mutate(owner,'project' as never,p.id,{...body(obj('project','Synthetic changed')),expectedRevision:1},'ab-project-update');
 const state=await s.referenceStates(owner,t.id);assert.equal(state[0].status,'updated');assert.equal(state[0].link.revision,1);assert.equal(state[0].current?.revision,2);
 assert.equal(repo.rows.size,4);assert.equal(repo.historyRows.length,5);
});
test('foreign, synthetic, wrong type and stale references fail atomically; legacy scope does not expand',async()=>{
 const{repo,s}=setup(),owner=config.ownerId;
 const p=(await s.mutate(owner,'project' as never,null,body(obj('project','Synthetic project')),'ab-project-create')).entry;
 const fields={title:'Synthetic task',personal:{project:ref(p),domain:null,topics:[]}};
 for(const link of [{...ref(p),revision:2},{...ref(p),sourceId:crypto.randomUUID()}])await assert.rejects(s.mutate(owner,'todo',null,body({...fields,personal:{...fields.personal,project:link}}),'ab-invalid-'+link.revision),{code:'REFERENCE_CONFLICT'});
 await assert.rejects(s.mutate(owner,'todo',null,body({...fields,personal:{project:null,domain:ref(p),topics:[]}}),'ab-wrong-type'),{code:'REFERENCE_CONFLICT'});
 repo.rows.get(p.id)!.ownerId='foreign-owner';await assert.rejects(s.mutate(owner,'todo',null,body(fields),'ab-foreign-ref'),{code:'REFERENCE_CONFLICT'});assert.equal(repo.rows.size,1);assert.equal(repo.receipts.size,1);
 const legacy=new PersonalService(repo,{...config,allowedTypes:['todo','journal'],approval:'personal-manual-v1'} as PersonalConfig);await assert.rejects(legacy.mutate(owner,'project' as never,null,body(obj('project','Denied')),'ab-legacy-denied'),{code:'PERSONAL_TYPE_DENIED'});
});
test('project retry is idempotent, versions conflict and aborted guard rolls back',async()=>{
 const{repo,s}=setup(),owner=config.ownerId,b=body(obj('project','Synthetic project'));
 const first=await s.mutate(owner,'project' as never,null,b,'ab-project-create');assert.equal((await s.mutate(owner,'project' as never,null,b,'ab-project-create')).duplicate,true);
 const edit={...b,expectedRevision:1};await s.mutate(owner,'project' as never,first.entry.id,edit,'ab-project-edit');await assert.rejects(s.mutate(owner,'project' as never,first.entry.id,edit,'ab-project-stale'),{code:'REVISION_CONFLICT'});
 let n=0;await assert.rejects(s.mutate(owner,'topic' as never,null,body(obj('topic','Synthetic question')),'ab-topic-guard',async()=>{if(++n===3)throw Error('revoked');}));assert.equal(repo.rows.size,1);assert.equal(repo.historyRows.length,2);
});

test('project client command and editor preserve typed fields for retry and detail',async()=>{
 const {makePersonalCommand}=await import('../src/personal-candidate/client.ts'),{editorFromCommand,editorFromEntry}=await import('../src/personal-candidate/editor.ts');
 const fields=obj('project','Synthetic UI project');const command=makePersonalCommand({ownerId:config.ownerId,spaceId:config.spaceId},'project' as never,null,fields as never,'ab-ui-project',true);assert.equal(editorFromCommand(command).type,'project');
 const{s}=setup(),result=await s.mutate(config.ownerId,'project' as never,null,command.body,command.key);const view=editorFromEntry(result.entry,config.spaceId);assert.equal(view.type,'project');assert.deepEqual(view.fields.personal,fields.personal);
});
