import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

const helperSource=readFileSync('test/helpers/task-grid-performance-fixture.ts','utf8');
const producer=resolve('scripts/attach-vtable-benchmark.py');
const ownerSource="import {verifyPersonalWorkspace} from './helpers/personal-workspace-browser-fixture.ts';\nasync function fixture(){let stage='setup';try{} }catch(error){const name=error instanceof Error;}}\n";
function fixture(helper=helperSource){
 const root=mkdtempSync(join(tmpdir(),'lifeos-vtable-projection-')),target=join(root,'baseline'),candidate=join(root,'candidate');
 for(const path of [join(target,'test/helpers'),join(target,'app'),join(candidate,'test/helpers')])mkdirSync(path,{recursive:true});
 const app='export default function FrozenApplication(){return null;}\n',lock='synthetic-frozen-lock\n';
 writeFileSync(join(target,'app/page.tsx'),app);writeFileSync(join(target,'package-lock.json'),lock);
 writeFileSync(join(target,'test/owner-recovery-browser.integration.test.ts'),ownerSource);
 writeFileSync(join(candidate,'test/helpers/task-grid-performance-fixture.ts'),helper);
 return {root,target,candidate,app,lock,run:()=>spawnSync('python3',[producer,target,candidate],{encoding:'utf8',timeout:5000}),generated:()=>readFileSync(join(target,'test/helpers/task-grid-performance-fixture.ts'),'utf8')};
}
test('historical probe projection is closed over legacy selectors and preserves frozen application and sampling guards',()=>{
 const f=fixture();try{
  const result=f.run();assert.equal(result.status,0,result.stderr);const generated=f.generated();
  assert.doesNotMatch(generated,/\b(?:taskGridRoot|requireTaskGrid)\b|列设置/);
  for(const marker of ['.lo-screen-reader-table tbody tr','.lo-vtable canvas','getImageData','emptyCanvas','snapshot.total,rows+3','assert.deepEqual(snapshot.items.find','i<3','raw[mode].push','width:1365','width:390'])assert.ok(generated.includes(marker),marker);
  const owner=readFileSync(join(f.target,'test/owner-recovery-browser.integration.test.ts'),'utf8');
  assert.ok(owner.includes('measureTaskGrid(fixture,100),...await measureTaskGrid(fixture,1000,100)'));
  assert.equal(readFileSync(join(f.target,'app/page.tsx'),'utf8'),f.app);assert.equal(readFileSync(join(f.target,'package-lock.json'),'utf8'),f.lock);
  assert.equal(readFileSync(join(f.candidate,'test/helpers/task-grid-performance-fixture.ts'),'utf8'),helperSource);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('actual projected first sample reaches the legacy count boundary without a missing modern dependency',async()=>{
 const f=fixture();try{
  assert.equal(f.run().status,0);const stop=Error('synthetic-first-legacy-boundary'),trace:string[]=[];let count=3,closed=0;
  const entries=[{id:'synthetic-domain'},{id:'synthetic-project'},{id:'synthetic-todo'}];
  const page={url:()=> 'https://review.example.test',evaluate:async(_fn:unknown,arg:unknown)=>{
   if(typeof arg==='string')return {ok:true,cache:'private, no-store',body:{total:count,truncated:false,items:entries}};
   if(arg&&typeof arg==='object'&&'rows'in arg){count=Number(arg.rows)+3;return true;}
   throw Error('Unexpected synthetic page boundary');
  }};
  const tab={goto:async()=>trace.push('goto'),locator:(selector:string)=>{trace.push(selector);return {selector};}};
  const sample={addCookies:async()=>{},addInitScript:async()=>{},newPage:async()=>tab,close:async()=>{closed++;}};
  const imports:Record<string,unknown>={'node:assert/strict':assert,'@playwright/test':{expect:(node:{selector:string})=>({toHaveAttribute:async()=>{},toHaveText:async()=>{assert.equal(node.selector,'.lo-result-count');throw stop;}})},'../../src/workbench/theme.ts':{themeStorageKey:'synthetic-theme'}};
  const module={exports:{} as {measureTaskGrid:(fixture:unknown,rows:number)=>Promise<unknown>}};
  const code=ts.transpileModule(f.generated(),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(code,{module,exports:module.exports,URL,require:(name:string)=>{assert.ok(name in imports,name);return imports[name];}},{timeout:1000});
  await assert.rejects(()=>module.exports.measureTaskGrid({browser:{newContext:async()=>sample},context:{cookies:async()=>[]},page,entries},100),error=>error===stop);
  assert.deepEqual(trace,['goto','html','.lo-result-count']);assert.equal(closed,1);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});

for(const mode of ['duplicate-modern-block','unprojected-modern-symbol'] as const)test('legacy projection rejects '+mode+' before writing a probe',()=>{
 const begin=helperSource.indexOf('          // The A/B comparison intentionally'),end=helperSource.indexOf('          const count=tab.locator',begin);
 assert.ok(begin>=0&&end>begin);
 const changed=mode==='duplicate-modern-block'?helperSource.slice(0,begin)+helperSource.slice(begin,end)+helperSource.slice(begin):helperSource+'\nconst unexpected=taskGridRoot;\n';
 const f=fixture(changed);try{
  const result=f.run();assert.notEqual(result.status,0);
  assert.equal(existsSync(join(f.target,'test/helpers/task-grid-performance-fixture.ts')),false);
  assert.equal(readFileSync(join(f.target,'test/owner-recovery-browser.integration.test.ts'),'utf8'),ownerSource);
  assert.equal(readFileSync(join(f.target,'app/page.tsx'),'utf8'),f.app);assert.equal(readFileSync(join(f.target,'package-lock.json'),'utf8'),f.lock);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
