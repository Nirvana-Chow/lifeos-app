import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import {SyntheticDiaryImport,type AuthorizeDiary,type DiaryReader,type DiaryScope,
  type DiaryStore,type DiaryTransaction,type ImportedDiary} from '../src/import-preview/historical-diary.ts';
import {scope,batch,source} from './helpers/historical-diary-fixture.ts';

const column=(row:unknown,key:string)=>row&&typeof row==='object'?(row as Record<string,unknown>)[key]:undefined;

function database(path:string) {
  const db=new DatabaseSync(path);
  db.exec(`CREATE TABLE IF NOT EXISTS diary (
    owner TEXT NOT NULL, space TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(owner,space,id)
  ); CREATE TABLE IF NOT EXISTS command (
    owner TEXT NOT NULL, space TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(owner,space,key)
  );`);
  return db;
}

class SQLiteDiaryFixture implements DiaryStore {
  interrupt=false;
  loseResponse=false;

  private readonly path:string;

  constructor(path:string) {
    this.path=path;
  }

  private reader(db:DatabaseSync,{ownerId,spaceId}:DiaryScope):DiaryReader {
    return {
      read:async id=>{
        const row=db.prepare('SELECT value FROM diary WHERE owner=? AND space=? AND id=?').get(ownerId,spaceId,id);
        return row?JSON.parse(String(column(row,'value'))):null;
      },
      readCommand:async key=>{
        const row=db.prepare('SELECT value FROM command WHERE owner=? AND space=? AND key=?').get(ownerId,spaceId,key);
        return row?JSON.parse(String(column(row,'value'))):null;
      },
    };
  }

  async read<T>(scope:DiaryScope,run:(reader:DiaryReader)=>Promise<T>) {
    const db=database(this.path);
    try {
      db.exec('BEGIN');
      const result=await run(this.reader(db,scope));
      db.exec('COMMIT');
      return result;
    } finally {
      db.close();
    }
  }

  async transaction<T>(scope:DiaryScope,run:(tx:DiaryTransaction)=>Promise<T>):Promise<T> {
    const db=database(this.path),args=[scope.ownerId,scope.spaceId];
    try {
      db.exec('BEGIN IMMEDIATE');
      let result:T;
      try {
        result=await run({
          ...this.reader(db,scope),
          insert:async record=>{
            db.prepare('INSERT INTO diary VALUES (?,?,?,?)').run(...args,record.id,JSON.stringify(record));
            if (this.interrupt) throw new Error('fixture-interruption-before-commit');
          },
          insertCommand:async (key,command)=>{
            db.prepare('INSERT INTO command VALUES (?,?,?,?)').run(...args,key,JSON.stringify(command));
          },
        });
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      if (this.loseResponse) throw new Error('fixture-response-lost-after-commit');
      return result;
    } finally {
      db.close();
    }
  }
}

const allow:AuthorizeDiary=async (binding,authority)=>{
  if (binding.ownerId!==scope.ownerId || binding.spaceId!==scope.spaceId || authority.namespace!=='fixture-only') throw new Error('fixture-denied');
};
const count=(db:DatabaseSync,table:'diary'|'command')=>column(db.prepare('SELECT count(*) AS n FROM '+table).get(),'n');

test('historical diary previews two new records, a duplicate and a source-version conflict',async t=>{
  const path=await mkdtemp(join(tmpdir(),'lifeos-diary-batch-'));
  t.after(()=>rm(path,{recursive:true,force:true}));
  const file=join(path,'synthetic.sqlite');
  const store=new SQLiteDiaryFixture(file),service=new SyntheticDiaryImport(store,allow);
  const earlier=source('conflicting');
  const initial=batch(earlier);
  const seed=await service.preview(scope,initial);
  await service.apply(scope,initial,{key:'diary-seed-one',planDigest:seed.planDigest,selected:[seed.items[0].id]});

  const first=source('first'),second=source('second'),changed=source('conflicting','v2');
  const packageA=batch(first,second,first,changed);
  const preview=await service.preview(scope,packageA);
  assert.deepEqual(preview.counts,{candidate:2,duplicate:1,conflict:1,invalid:0});
  assert.deepEqual(preview.items.map(row=>row.status),['candidate','candidate','duplicate','conflict']);
  assert.equal(preview.items[3].id,seed.items[0].id);
  assert.notEqual(preview.items[3].sourceDigest,seed.items[0].sourceDigest);
  assert.equal(preview.writesPerformed,0);
  assert.equal(preview.importAvailable,false);
  const command={key:'diary-batch-001',planDigest:preview.planDigest,selected:preview.items.slice(0,2).map(row=>row.id)};
  await assert.rejects(service.apply(scope,batch({...first,body:'Changed after preview'},second,first,changed),command),
    /DIARY_PREVIEW_CHANGED/);
  await assert.rejects(service.apply(scope,packageA,{...command,selected:[preview.items[3].id]}),/DIARY_INVALID_SELECTION/);
  await assert.rejects(service.preview({...scope,spaceId:'foreign-space'},packageA),/fixture-denied/);
  await assert.rejects(service.preview(scope,{...packageA,ownerId:scope.ownerId}),/DIARY_INVALID_FIELDS/);
  await assert.rejects(service.preview(scope,{...packageA,sourceNamespace:'unapproved-source'}),/fixture-denied/);

  store.interrupt=true;
  await assert.rejects(service.apply(scope,packageA,command),/fixture-interruption-before-commit/);
  const fresh=new SyntheticDiaryImport(new SQLiteDiaryFixture(file),allow);
  assert.deepEqual(await fresh.reconcile(scope,packageA,command),{state:'unconfirmed'});
  assert.deepEqual(await fresh.preview(scope,packageA),preview);

  store.interrupt=false;
  store.loseResponse=true;
  await assert.rejects(service.apply(scope,packageA,command),/fixture-response-lost-after-commit/);
  const proof=await fresh.reconcile(scope,packageA,command);
  assert.equal(proof.state,'verified');
  if (proof.state!=='verified') throw new Error('Missing verified receipt');
  assert.equal(proof.receipt.written.length,2);
  assert.deepEqual(await fresh.apply(scope,packageA,command),{replayed:true,writesPerformed:0,receipt:proof.receipt});
  await assert.rejects(fresh.apply(scope,packageA,{...command,selected:command.selected.slice(0,1)}),/DIARY_COMMAND_CONFLICT/);
  assert.deepEqual((await fresh.preview(scope,packageA)).counts,{candidate:0,duplicate:3,conflict:1,invalid:0});

  const check=database(file);
  try {
    assert.equal(count(check,'diary'),3);
    assert.equal(count(check,'command'),2);
    const rows=check.prepare('SELECT value FROM diary').all().map(row=>JSON.parse(String(column(row,'value'))) as ImportedDiary);
    for (const expected of [first,second,earlier]) {
      const stored=rows.find(row=>row.source.originalId===expected.originalId);
      assert.deepEqual(stored?.source,expected);
      assert.equal(stored?.sourceNamespace,'fixture-only');
      assert.equal(stored?.body,expected.body);
      assert.equal(stored?.date,expected.date);
    }
    check.prepare('DELETE FROM diary WHERE id=?').run(command.selected[0]);
  } finally {
    check.close();
  }
  await assert.rejects(fresh.reconcile(scope,packageA,command),/DIARY_READBACK_MISMATCH/);
});

test('preview rejects unsafe paths and calendar rollover, and conflicts every variant of one identity',async t=>{
  const path=await mkdtemp(join(tmpdir(),'lifeos-diary-validation-'));
  t.after(()=>rm(path,{recursive:true,force:true}));
  const service=new SyntheticDiaryImport(new SQLiteDiaryFixture(join(path,'synthetic.sqlite')),allow);
  const one=source('same-identity');
  for (const sourcePath of ['../escape.md','/absolute.md','secret/.key.md','script.sh','C:/host.md']) {
    await assert.rejects(service.preview(scope,batch({...one,sourcePath})),/DIARY_INVALID/);
  }
  await assert.rejects(service.preview(scope,batch({...one,date:'2001-02-29'})),/DIARY_INVALID_DATE/);
  await assert.rejects(service.preview(scope,batch({...one,body:'\ud800'})),/DIARY_INVALID_BODY/);
  const oversized=await service.preview(scope,batch({...one,body:'x'.repeat(16_385)}));
  assert.equal(oversized.items[0].reason,'journal-body-limit');
  assert.equal(oversized.counts.invalid,1);
  const revised={...one,sourcePath:'synthetic/renamed.md',sourceVersion:'v2'};
  const preview=await service.preview(scope,batch(one,one,revised));
  assert.deepEqual(preview.items.map(row=>row.status),['conflict','conflict','conflict']);
  assert.equal(new Set(preview.items.map(row=>row.id)).size,1);

  const original=batch(one);
  const available=await service.preview(scope,original);
  const selected=[available.items[0].id];
  await service.apply(scope,original,{key:'diary-first-commit',planDigest:available.planDigest,selected});
  await assert.rejects(service.apply(scope,original,{key:'diary-stale-plan',planDigest:available.planDigest,selected}),
    /DIARY_PREVIEW_CHANGED/);
});
