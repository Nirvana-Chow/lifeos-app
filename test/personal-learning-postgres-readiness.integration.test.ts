import test from 'node:test';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import type {SqlPool} from '../src/platform/postgres.ts';
import {verifyLearningPostgres} from '../src/personal-learning/postgres.ts';
import {fixtureForeign, fixtureOwner, learningFixturePool} from './helpers/learning-pg.ts';

// This deliberately changes policy metadata on the disposable, approved fixture only.
test('PostgreSQL vocabulary readiness rejects policy drift on the migrated fixture', {
  skip:process.env.RUN_LEARNING_PG_READINESS_TESTS!=='1'&&'Requires an approved disposable learning PostgreSQL fixture for policy DDL',
}, async t=>{
  const port=process.env.LEARNING_FIXTURE_PG_PORT;
  const runtime=learningFixturePool(port);
  const admin=new Pool({
    host:'127.0.0.1',port:Number(port),database:'lifeos_platform_test_learning',user:'postgres',
    password:'fixture-ci-admin-never-live',max:1,connectionTimeoutMillis:4000,statement_timeout:5000,
  });
  t.after(async()=>{await Promise.all([runtime.end(),admin.end()]);});
  const identity=await admin.query(`SELECT current_database() AS database,current_user AS role,
    (SELECT count(*)::int FROM lifeos_platform.platform_user
      WHERE (id=$1 AND email='learning-owner@example.test')
         OR (id=$2 AND email='learning-foreign@example.test')) AS fixture_users`,[fixtureOwner.ownerId,fixtureForeign.ownerId]);
  assert.deepEqual(identity.rows,[{database:'lifeos_platform_test_learning',role:'postgres',fixture_users:2}]);
  const ready=()=>verifyLearningPostgres(runtime as SqlPool);
  await ready();

  const owner="owner_id=current_setting('lifeos.owner_id',true)";
  const space="space_id=current_setting('lifeos.learning_space_id',true)";
  const scope=owner+' AND '+space;
  const cases=[
    {name:'missing card policy',table:'learning_card',replacement:''},
    {name:'owner-only row visibility on reviews',table:'learning_review',replacement:`USING(${owner}) WITH CHECK(${scope})`},
    {name:'missing owner in command write check',table:'learning_command',replacement:`USING(${scope}) WITH CHECK(${space})`},
    {name:'missing explicit write check',table:'learning_review',replacement:`USING(${scope})`},
    {name:'broader visibility condition',table:'learning_card',replacement:`USING(${owner} OR ${space}) WITH CHECK(${scope})`},
    {name:'role drift',table:'learning_command',replacement:`TO lifeos_platform_candidate_runtime USING(${scope}) WITH CHECK(${scope})`},
    {name:'extra permissive visibility policy',table:'learning_review',extra:true,replacement:'USING(true)'},
  ] as const;
  for(const variant of cases) {
    await t.test(variant.name,async()=>{
      const {table,replacement}=variant;
      const qualified='lifeos_platform.'+table, policy=table+'_scope';
      const drop=`DROP POLICY ${policy} ON ${qualified}`;
      const create=(clauses:string)=>`CREATE POLICY ${policy} ON ${qualified} ${clauses}`;
      const extra='extra_fixture_scope';
      if ('extra' in variant) {
        await admin.query(`CREATE POLICY ${extra} ON ${qualified} ${replacement}`);
      } else {
        await admin.query(drop+(replacement?';'+create(replacement):''));
      }
      try {
        await assert.rejects(ready(),{message:'Restricted vocabulary PostgreSQL schema required'});
      } finally {
        await admin.query('extra' in variant?`DROP POLICY ${extra} ON ${qualified}`:
          (replacement?drop+';':'')+create(`USING(${scope}) WITH CHECK(${scope})`));
      }
      await ready();
    });
  }
});
