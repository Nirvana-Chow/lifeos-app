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

for(const [width,height] of [[1365,900],[360,844],[390,844],[430,844]] as const){
 for(const theme of ['light','dark'] as const){
  test(`settings capture accepts only the canonical general page at ${width}/${theme}`,async()=>{
   const {captureDescriptor}=await import('../scripts/synthetic-rendered-qualification.ts');
   const name=`private-settings-${width}-${theme}.png`;
   assert.deepEqual(captureDescriptor({name,url:'https://review.example.test/personal?page=settings&panel=general',width,height,theme}),{
    name,directory:'owner-personal-browser-screenshots',route:'/personal?page=settings&panel=general',viewport:{width,height},theme,
   });
  });
 }
}

test('every approved private browser capture can enter the finite manifest',async()=>{
 const {captureDescriptor,expectedSyntheticCaptures}=await import('../scripts/synthetic-rendered-qualification.ts');
 // Import only the existing descriptors; fixture/browser functions remain uncalled.
 const {privateCaptureCases,privateOrigin}=await import('./helpers/private-business-browser-fixture.ts');
 assert.equal(privateCaptureCases.length,96);
 assert.equal(expectedSyntheticCaptures.length,118);
 assert.equal(new Set(expectedSyntheticCaptures.map(row=>row.name)).size,118);
 const rejected:string[]=[];
 for(const row of privateCaptureCases){
  try{
   const value=captureDescriptor({name:row.name,url:privateOrigin+row.path,width:row.width,height:row.width===1365?900:844,theme:row.theme});
   assert.equal(value.route,row.path,row.name);
  }catch(error){
   if(!(error instanceof Error)||error.message!=='SYNTHETIC_CAPTURE_DENIED')throw error;
   rejected.push(row.name);
  }
 }
 assert.deepEqual(rejected,[],'approved browser captures must not be rejected by the final descriptor');
});

test('settings capture refuses legacy routes other panels and URL or viewport expansion',async()=>{
 const {captureDescriptor}=await import('../scripts/synthetic-rendered-qualification.ts');
 const clean={name:'private-settings-1365-light.png',url:'https://review.example.test/personal?page=settings&panel=general',width:1365,height:900,theme:'light'};
 for(const url of [
  'https://review.example.test/personal?page=settings',
  'https://review.example.test/personal?modal=settings&panel=general',
  'https://review.example.test/personal?page=settings&panel=security',
  'https://review.example.test/personal?page=settings&panel=api-keys',
  'https://review.example.test/personal?page=settings&panel=topics',
  'https://review.example.test/personal?modal=settings&panel=security',
  'https://review.example.test/personal?modal=settings&panel=api-keys',
  'https://review.example.test/personal?modal=settings&panel=topics',
  'https://review.example.test/personal?modal=settings',
  clean.url+'&extra=value',
  clean.url+'&panel=general',
  'https://review.example.test/personal?page=tasks&modal=settings&panel=general',
  'https://review.example.test/personal?panel=general&modal=settings',
  clean.url+'#fragment',
  'https://user:synthetic-password@review.example.test/personal?page=settings&panel=general',
  'https://other.example.test/personal?page=settings&panel=general',
  'http://review.example.test/personal?page=settings&panel=general',
  'https://review.example.test:14443/personal?page=settings&panel=general',
 ])assert.throws(()=>captureDescriptor({...clean,url}),/^Error: SYNTHETIC_CAPTURE_DENIED$/);
 for(const change of [{name:'../'+clean.name},{name:'private-settings-unknown.png'},{width:390},{height:844},{theme:'dark'}]){
  assert.throws(()=>captureDescriptor({...clean,...change}),/^Error: SYNTHETIC_CAPTURE_DENIED$/);
 }
});

test('aborted native test lifecycle refuses late handoff or capture publication',async()=>{
 const {assertFixtureCompletion}=await import('../scripts/synthetic-rendered-qualification.ts');
 const controller=new AbortController();assert.doesNotThrow(()=>assertFixtureCompletion(controller.signal));
 controller.abort();assert.throws(()=>assertFixtureCompletion(controller.signal),/BROWSER_FIXTURE_TIMED_OUT/);
});
