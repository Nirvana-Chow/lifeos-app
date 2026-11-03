import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
test('finite capture manifest binds anonymous routes viewport theme and public head rather than event SHA',async()=>{
 assert.equal(existsSync('scripts/synthetic-rendered-qualification.ts'),true,'capture manifest helper required');
 const {captureDescriptor,qualificationIdentity,expectedSyntheticCaptures}=await import('../scripts/synthetic-rendered-qualification.ts');
 assert.equal(expectedSyntheticCaptures.length,118);
 const clean={name:'private-finance-360-dark.png',url:'https://review.example.test/personal/finance',width:360,height:844,theme:'dark'};
 assert.equal(captureDescriptor(clean).route,'/personal/finance');
 for(const change of [{name:'../private-finance-360-dark.png'},{url:clean.url+'?secret=value'},{url:'https://user:password@review.example.test/personal/finance'},{width:390},{theme:'light'},{height:0}])assert.throws(()=>captureDescriptor({...clean,...change}),/SYNTHETIC_CAPTURE_DENIED/);
 const env={GITHUB_REPOSITORY:'Nirvana-Chow/lifeos-app',GITHUB_REPOSITORY_ID:'1443243170',SOURCE_SHA:'a'.repeat(40),CI_HEAD_SHA:'a'.repeat(40),CI_EVENT_SHA:'b'.repeat(40),GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1'};
 assert.equal(qualificationIdentity(env,'a'.repeat(40),'fixture-build').sourceSha,'a'.repeat(40));
 for(const change of [{GITHUB_REPOSITORY_ID:'1'},{SOURCE_SHA:'b'.repeat(40)},{CI_HEAD_SHA:'b'.repeat(40)},{GITHUB_RUN_ID:'../private'}])assert.throws(()=>qualificationIdentity({...env,...change},'a'.repeat(40),'fixture-build'),/SYNTHETIC_CAPTURE_DENIED/);
});

test('aborted native test lifecycle refuses late handoff or capture publication',async()=>{
 const {assertFixtureCompletion}=await import('../scripts/synthetic-rendered-qualification.ts');
 const controller=new AbortController();assert.doesNotThrow(()=>assertFixtureCompletion(controller.signal));
 controller.abort();assert.throws(()=>assertFixtureCompletion(controller.signal),/BROWSER_FIXTURE_TIMED_OUT/);
});
