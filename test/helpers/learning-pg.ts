import {Pool} from 'pg';

export const fixtureOwner = {ownerId:'learning-fixture-owner',spaceId:'learning-fixture-space'};
export const fixtureForeign = {...fixtureOwner,ownerId:'learning-fixture-foreign'};
export function learningFixturePool(rawPort: string | undefined) {
  if (!rawPort || !/^\d{4,5}$/.test(rawPort) || Number(rawPort)<1024 || Number(rawPort)>65535) {
    throw new Error('Approved disposable learning PostgreSQL port required');
  }
  return new Pool({
    host:'127.0.0.1',port:Number(rawPort),database:'lifeos_platform_test_learning',
    user:'lifeos_platform_candidate_runtime',password:'fixture-ci-runtime-never-live',
    max:6,connectionTimeoutMillis:4000,statement_timeout:5000,
  });
}
