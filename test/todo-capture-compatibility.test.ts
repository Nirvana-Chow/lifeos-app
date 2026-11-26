import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,rm,symlink,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import {MemoryPort} from './helpers/platform.ts';
import {seedTodoCapture} from './helpers/todo-capture-fixture.ts';
import {editorFromEntry} from '../src/personal-candidate/editor.ts';
import {PersonalService} from '../src/personal-candidate/service.ts';
import {searchRow} from '../src/personal-search/model.ts';
import {todoCaptureSource} from '../src/personal-candidate/todo-capture.ts';

const ownerId='fixture-capture-review-owner',spaceId='fixture-capture-review-space';
const config={ownerId,spaceId,ownerEmail:'capture@example.invalid',baseURL:'https://capture.example.invalid',
 databaseName:'fixture',allowedTypes:['todo'],approval:'personal-manual-v1'} as const;
const fields={title:'Synthetic reviewed todo',notes:'',dueOn:null,status:'open'};
const raw={spaceId,confirmed:true,fields};
const originalLine='  未发布的合成原始行  ';
function fixture(){
 const repo=new MemoryPort();
 repo.readCurrentSnapshot=async owner=>[...repo.rows.values()].filter(row=>row.ownerId===owner);
 return repo;
}

test('compatibility reader accepts each reviewed source, withholds fresh writes and preserves exact replay',async()=>{
 const repo=fixture(),service=new PersonalService(repo,config);
 const cases=[{}, {originalLine}, {channel:'owner-web',expression:'written'}, {channel:'agent-api'},
  {originalLine,channel:'owner-web',expression:'spoken'}] as const;
 for(const [index,evidence] of cases.entries()){
  const key='capture-reviewed-'+index;
  const stored=await seedTodoCapture(repo,ownerId,spaceId,key,fields,evidence);
  const entry=await service.get(ownerId,'todo',stored.id);
  assert.equal(editorFromEntry(entry,spaceId).fields.title,fields.title);
  assert.equal(searchRow(entry,spaceId,fields.title).title,fields.title);
  assert.doesNotMatch(JSON.stringify(searchRow(entry,spaceId,fields.title)),/未发布的合成原始行/);
  assert.equal(todoCaptureSource(entry,spaceId)?.originalLine,'originalLine'in evidence?originalLine:undefined);
  assert.equal((await service.history(ownerId,'todo',entry.id)).items[0]?.source.id,entry.source.id);
  const input=structuredClone((stored.source.original as {input:unknown}).input);
  const retry=await service.mutate(ownerId,'todo',null,input,key,undefined,undefined,'channel'in evidence?evidence.channel:'owner-web');
  assert.equal(retry.duplicate,true);assert.equal(retry.entry.id,entry.id);
 }
 for(const [index,body] of [{originalLine},{expression:'written'},{originalLine,expression:'spoken'}].entries()){
  await assert.rejects(service.mutate(ownerId,'todo',null,{...raw,...body},'capture-closed-'+index,undefined,undefined,'owner-web'),
   {code:'TODO_CAPTURE_WRITE_DISABLED'});
 }
 assert.equal(repo.rows.size,cases.length);assert.equal(repo.receipts.size,cases.length);
 assert.equal(repo.events.length,cases.length);
 const malformed=await seedTodoCapture(repo,ownerId,spaceId,'capture-malformed',fields,{expression:'written'});
 await assert.rejects(service.get(ownerId,'todo',malformed.id),{status:404});
 assert.equal((await service.search(ownerId,'Synthetic reviewed')).items.length,cases.length);
 await assert.rejects(service.get('fixture-capture-other','todo',malformed.id),{status:403});
 const fresh=(await service.mutate(ownerId,'todo',null,raw,'capture-legacy-new')).entry;
 assert.deepEqual(fresh.source.original,{marker:'personal-manual-v1',spaceId,type:'todo',input:raw});
});

test('OPT-IN actual frozen writers and readers establish rollback boundaries',{
 skip:process.env.RUN_TODO_CAPTURE_FROZEN_MATRIX!=='1'&&'Requires all reviewed Git objects locally',timeout:30000,
},async()=>{
 const root=await mkdtemp(join(tmpdir(),'lifeos-capture-frozen-'));
 const repo=fixture(),stage=new PersonalService(repo,config);
 const versions=[
  ['base','1cba0e7b18d0abd977b71cde162f27691126999d'],
  ['218','f54a012e01169b441be8d86edc6327f5c91fd295'],
  ['231','50f2a33471655a70e80d71321e6ecd56ced8f35f'],
 ] as const;
 try{
  const readers=new Map<string,PersonalService>([['reader-first',stage]]);
  for(const [name,sha] of versions){
   const directory=join(root,name);
   await mkdir(directory);
   const tree=execFileSync('git',['archive','--format=tar',sha,'src'],{maxBuffer:32*1024*1024});
   execFileSync('tar',['-x','-C',directory],{input:tree});
   await symlink(join(process.cwd(),'node_modules'),join(directory,'node_modules'));
   const module=await import(pathToFileURL(join(directory,'src/personal-candidate/service.ts')).href);
   readers.set(name,new module.PersonalService(repo,config));
  }
  const legacy=await readers.get('base')!.mutate(ownerId,'todo',null,raw,'capture-matrix-legacy');
  const provenance=await readers.get('218')!.mutate(ownerId,'todo',null,{...raw,expression:'written'},'capture-matrix-218',undefined,undefined,'owner-web');
  const batch=await readers.get('231')!.mutate(ownerId,'todo',null,{...raw,originalLine},'capture-matrix-231');
  const readerStage=await stage.mutate(ownerId,'todo',null,raw,'capture-matrix-reader-stage');
  const combined=await seedTodoCapture(repo,ownerId,spaceId,'capture-matrix-combined',fields,{originalLine,channel:'owner-web',expression:'written'});
  const records=[legacy.entry.id,provenance.entry.id,batch.entry.id,readerStage.entry.id,combined.id];
  const expected:Record<string,number[]>={
   base:[200,404,404,200,404],
   '218':[200,200,404,200,404],
   '231':[200,404,200,200,404],
   'reader-first':[200,200,200,200,200],
  };
  const observed:Record<string,number[]>={};
  for(const [name,reader] of readers){
   observed[name]=await Promise.all(records.map(async id=>{
    try{
     assert.equal((await reader.get(ownerId,'todo',id)).id,id);
     assert.equal((await reader.history(ownerId,'todo',id)).items[0]?.id,id);
     return 200;
    }catch(error){
     if(error&&typeof error==='object'&&'status'in error&&error.status===404)return 404;
     throw error;
    }
   }));
   assert.deepEqual(observed[name],expected[name],name);
  }
  assert.equal((await stage.mutate(ownerId,'todo',null,{...raw,expression:'written'},'capture-matrix-218',undefined,undefined,'owner-web')).entry.id,provenance.entry.id);
  assert.equal((await stage.mutate(ownerId,'todo',null,{...raw,originalLine},'capture-matrix-231',undefined,undefined,'owner-web')).entry.id,batch.entry.id);
  assert.equal((await readers.get('base')!.mutate(ownerId,'todo',null,raw,'capture-matrix-reader-stage')).entry.id,readerStage.entry.id);
  assert.equal(repo.rows.size,5);assert.equal(repo.events.length,5);
  console.log('TODO_CAPTURE_FROZEN_MATRIX '+JSON.stringify({columns:['legacy','218-written','231-originalLine','reader-stage-write','combined'],reads:observed,preexistingReceipts:true}));
 }finally{await rm(root,{recursive:true,force:true});}
});
