import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {cp,mkdir,mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {chromium,expect} from '@playwright/test';
import {requirements,type Requirement} from '../src/platform/requirements.ts';

test('owner overview uses verified requirement delivery evidence and opens the canonical pool',{
 skip:process.env.RUN_REQUIREMENT_PROGRESS_CARD_BROWSER_TESTS!=='1'&&'Requires isolated Next and Chromium',timeout:180000,
},async t=>{
 const source=resolve(import.meta.dirname,'..'),root=await mkdtemp(join(tmpdir(),'lifeos-requirement-overview-'));
 await mkdir(join(root,'app','personal'),{recursive:true});
 await Promise.all([cp(join(source,'src'),join(root,'src'),{recursive:true}),
  ...['layout.tsx','globals.css','theme.css'].map(name=>cp(join(source,'app',name),join(root,'app',name))),
  cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),
  symlink(join(source,'node_modules'),join(root,'node_modules')),symlink(join(source,'components'),join(root,'components'))]);
 await writeFile(join(root,'app','personal','page.tsx'),`import {LifeOSWorkspace} from '../../src/ui-review/workspace';
 import {readWorkspaceLocation} from '../../src/workbench/private-navigation';
 export default async function Page({searchParams}:{searchParams:Promise<{guest?:string;page?:string}>}){
  const query=await searchParams;const owner=!query.guest;const location=readWorkspaceLocation(query);
  return <LifeOSWorkspace syncUrl initialPage={location.page} initialSettingsPanel={location.panel} state={{status:'ready',data:{tasks:[],projects:[],areas:[],today:'2026-11-25',asOf:'2026-11-25T00:00:00Z',coverage:'complete'}}}
  access={{authenticated:owner,writable:false,loginAllowed:true}} viewPreferenceScope={owner?JSON.stringify(['overview-owner','overview-space']):null}/>;
 }`);
 const child=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{
  cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe'],
 });
 const stopped=once(child,'exit');
 t.after(async()=>{child.kill('SIGTERM');await stopped;await rm(root,{recursive:true,force:true});});
 let output='';const collect=(chunk:Buffer)=>{output=(output+String(chunk)).slice(-4000);};
 child.stdout.on('data',collect);child.stderr.on('data',collect);
 const origin=await new Promise<string>((accept,reject)=>{
  const timer=setTimeout(()=>reject(Error('Fixture startup timeout '+output)),30000);
  child.once('exit',()=>{clearTimeout(timer);reject(Error('Fixture exited '+output));});
  child.stdout.on('data',()=>{
   const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);
   if(match){clearTimeout(timer);accept(match[0]);}
  });
 });
 const browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});
 t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 const baseline=requirements(), sha='a'.repeat(40), commit='https://github.com/Nirvana-Chow/lifeos-app/commit/'+sha;
 const merged={scope:'delivery-merged',ref:commit,at:'2026-11-22T00:00:00Z'};
 const production={scope:'delivery-production-verified',ref:commit,at:'2026-11-23T00:00:00Z',
  resultHref:'https://lifeos.nirvanachow.com/personal?page=projects',
  verificationHref:`https://github.com/Nirvana-Chow/lifeos-app/blob/${sha}/docs/verification/fixture.md`};
 const specs=[
  ['planned',[]],['in_progress',[]],['planned',[merged]],['done',[merged,production]],['blocked',[]],['done',[]],
 ] as const;
 const items=specs.map(([state,evidence],index)=>{
  const id=`11111111-1111-4111-8111-${String(index+1).padStart(12,'0')}`;
  const title='Synthetic private requirement '+index;
  const requirement:Requirement={...baseline.requirements[0],id,title,status:'not_started',
   roadmap:undefined,evidence:[...evidence]};
  return {id,revision:1,sourceId:id,baselineBinding:null,baselineConflict:false,requirement,
   fields:{title,body:'',phaseId:baseline.roadmap!.phases[0].id,priority:'P2',plannedStartOn:null,plannedEndOn:null,
    workflow:{state,purpose:'',nextStep:''}}};
 });
 let mode:'ok'|'truncated'|'wrong-space'|'denied'='ok', reads=0;
 await page.route('**/api/platform/**',route=>{
  assert.equal(route.request().method(),'GET');
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/requirements/snapshot')){
   reads++;
   if(mode==='denied')return route.fulfill({status:403,json:{}});
   return route.fulfill({json:{scope:'full-current-requirements-snapshot',items,total:items.length,
    truncated:mode==='truncated',observedAt:'2026-11-25T00:00:00Z',baseline}});
  }
  return route.fulfill({json:{scope:'personal-manual-candidate',ownerId:'overview-owner',
   spaceId:mode==='wrong-space'?'another-space':'overview-space',requirementsEnabled:true,writable:false}});
 });
 await page.goto(origin+'/personal',{waitUntil:'domcontentloaded',timeout:70000});
 const card=page.getByRole('region',{name:'需求进度',exact:true});
 const count=(label:string)=>card.locator('dl > div').filter({has:page.getByText(label,{exact:true})}).locator('dd');
 for(const [label,value] of [['未开始','1'],['进行中','2'],['待上线验收','1'],['已上线','1'],['其中受阻','1'],['待核实','1']]){
  await expect(count(label)).toHaveText(value);
 }
 await expect(card.locator('time')).toHaveAttribute('datetime','2026-11-25T00:00:00Z');
 await expect(card.locator('time')).toContainText('08:00');
 await expect(card.getByText('Synthetic private requirement',{exact:false})).toHaveCount(0);
 assert.ok(await card.evaluate(el=>el.scrollWidth<=el.clientWidth));
 if(process.env.LIFEOS_PROGRESS_CARD_SCREENSHOT)await card.screenshot({path:process.env.LIFEOS_PROGRESS_CARD_SCREENSHOT});
 for(const invalid of ['truncated','wrong-space','denied'] as const){
  const before=reads;mode=invalid;
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(card.getByText('需求进度暂不可用')).toBeVisible();
  await expect(card.locator('dd')).toHaveCount(0);
  if(invalid==='wrong-space')assert.equal(reads,before);
 }
 mode='ok';
 await card.getByRole('button',{name:'查看全部需求'}).click();
 await expect(page).toHaveURL(/\/personal\?page=requirements$/);
 await expect(page.locator('[data-requirements-page]')).toBeVisible();
 await page.goto(origin+'/personal?page=projects',{waitUntil:'domcontentloaded'});
 await expect(page.getByRole('heading',{name:'项目',level:1,exact:true})).toBeVisible();
 await page.getByRole('button',{name:'设置',exact:true}).click();
 const product=page.getByRole('navigation',{name:'设置分类'}).getByRole('group',{name:'产品',exact:true});
 await product.getByRole('button',{name:'需求池',exact:true}).click();
 await expect(page).toHaveURL(/\/personal\?page=requirements$/);
 await expect(page.locator('[data-requirements-page]')).toBeVisible();

 const before=reads;
 await page.goto(origin+'/personal?guest=1',{waitUntil:'domcontentloaded',timeout:70000});
 await expect(card).toHaveCount(0);
 assert.equal(reads,before);
});
