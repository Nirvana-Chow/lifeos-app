import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {on} from 'node:events';
import {cp,mkdir,mkdtemp,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {chromium,expect,type Browser,type BrowserServer} from '@playwright/test';
import {requirements} from '../src/platform/requirements.ts';
import {requirementBinding,type RequirementsSnapshot} from '../src/requirements-candidate/service.ts';
import {cleanupAuthThemeFixture,trackAuthThemeProcess,type FixtureProcess} from './helpers/auth-theme-fixture-lifecycle.ts';

const baseline=requirements();
const states=['done','planned','in_progress','blocked','awaiting_review',null] as const;
const items=states.map((state,index)=>{
 const requirement={...baseline.requirements[index],title:'合成需求 '+(state??'未标记')};
 return {id:requirement.id,requirement,sourceId:null,revision:0,baselineConflict:false,baselineBinding:requirementBinding(baseline,requirement.id),
  fields:{title:requirement.title,body:'合成说明',phaseId:requirement.roadmap!.phaseId,priority:requirement.roadmap!.priority,plannedStartOn:null,plannedEndOn:null,
   ...(state?{workflow:{state,purpose:'合成用途',nextStep:'合成下一步'}}:{})}};
});
const snapshot:RequirementsSnapshot={scope:'full-current-requirements-snapshot',total:items.length,truncated:false,observedAt:'2026-11-26T00:00:00Z',baseline,items};

test('OPT-IN native requirements route shows complete owner counts, filters and existing detail', {
 skip:process.env.RUN_REQUIREMENTS_SUMMARY_BROWSER_TESTS!=='1'&&'Requires isolated Next and Chromium',timeout:150_000,
},async t=>{
 const source=resolve(import.meta.dirname,'..'),root=await mkdtemp(join(tmpdir(),'lifeos-auth-theme-requirements-summary-'));
 let server:FixtureProcess|undefined,browserProcess:FixtureProcess|undefined,browser:Browser|undefined,browserServer:BrowserServer|undefined;
 t.after(()=>cleanupAuthThemeFixture({root,server,browserProcess,browser,browserServer}));
 await mkdir(join(root,'app/personal'),{recursive:true});
 await Promise.all([
  ...['layout.tsx','globals.css','theme.css','personal/page.tsx'].map(file=>cp(join(source,'app',file),join(root,'app',file))),
  cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),
  cp(join(source,'src'),join(root,'src'),{recursive:true}),
  symlink(join(source,'node_modules'),join(root,'node_modules')),
  symlink(join(source,'components'),join(root,'components')),
 ]);
 await writeFile(join(root,'next.config.mjs'),'export default {devIndicators:false};\n');
 await writeFile(join(root,'src/platform/runtime.ts'),'export const readPlatformPagePrincipal=async()=>({id:"synthetic-owner"});export const readPlatformPasswordCapability=async()=>false;\n');
 const child=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{
  cwd:root,detached:true,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe'],
 });
 server=trackAuthThemeProcess(child,true);
 let origin='',output='';
 for await(const [chunk] of on(child.stdout,'data',{signal:AbortSignal.timeout(30000)})){
  output=(output+String(chunk)).slice(-4000);
  const match=output.match(/Local:\s+(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
  if(match&&/Ready in\b/.test(output)){origin=match;break;}
 }
 assert.ok(origin);
 browserServer=await chromium.launchServer({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});
 browserProcess=trackAuthThemeProcess(browserServer.process());
 browser=await chromium.connect(browserServer.wsEndpoint());
 for(const width of [1365,390]){
  const page=await browser.newPage({viewport:{width,height:844},colorScheme:width===390?'dark':'light'});
  const errors:string[]=[],writes:string[]=[],outside:string[]=[],details:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  let mode:'full'|'empty'|'error'|'partial'='full';
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url()),path=url.pathname;
   if(url.origin!==origin){outside.push(url.origin);return route.abort();}
   if(!path.startsWith('/api/'))return route.continue();
   if(req.method()!=='GET'){writes.push(path);return route.fulfill({status:405});}
   if(path.endsWith('/availability'))return route.fulfill({json:{configured:true,loginAllowed:true,transport:'ssh-loopback',origin}});
   if(path.endsWith('/status'))return route.fulfill({json:{scope:'personal-manual-candidate',ownerId:'synthetic-owner',spaceId:'synthetic-space',storageVerified:true,writable:true,requirementsEnabled:true,allowedTypes:['todo']}});
   if(path.endsWith('/overview'))return route.fulfill({json:{scope:'full-current-snapshot',truncated:false,total:0,items:[],observedAt:snapshot.observedAt,today:url.searchParams.get('today')}});
   if(path.endsWith('/requirements/snapshot')){
    if(mode==='error')return route.fulfill({status:503,json:{}});
    return route.fulfill({json:mode==='empty'?{...snapshot,total:0,items:[]}:mode==='partial'?{...snapshot,truncated:true}:snapshot});
   }
   const entry=items.find(item=>path.endsWith('/requirements/'+item.id));
   if(entry){details.push(entry.id);return route.fulfill({json:{entry}});}
   return route.fulfill({status:404,json:{}});
  });
  await page.goto(origin+'/personal?page=requirements',{waitUntil:'networkidle',timeout:60000});
  const pool=page.getByRole('region',{name:'需求池',exact:true});
  const counts=pool.getByRole('group',{name:'需求统计'});
  const all=counts.getByRole('button',{name:'总需求 6',exact:true});
  await expect(all).toBeVisible();
  await expect(all).toHaveAttribute('aria-pressed','true');
  const list=pool.getByRole('list',{name:'需求清单'});
  await expect(list.getByRole('listitem')).toHaveCount(6);
  await expect(pool.getByRole('group',{name:'需求视图'})).toHaveCount(0);
  await expect(pool.getByLabel('阶段',{exact:true})).toHaveCount(0);
  await counts.getByRole('button',{name:'已完成 1',exact:true}).click();
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await list.getByRole('button',{name:'合成需求 done',exact:true}).click();
  const detail=page.getByRole('dialog');
  await expect(detail.getByRole('textbox',{name:'需求标题',exact:true})).toHaveValue('合成需求 done');
  await expect(detail.getByRole('button',{name:'保存需求',exact:true})).toBeEnabled();
  assert.ok(details.includes(items[0].id));
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);
  await counts.getByRole('button',{name:'未完成 5',exact:true}).click();
  await expect(list.getByRole('listitem')).toHaveCount(5);
  await expect(list.getByRole('button',{name:'合成需求 未标记',exact:true})).toBeVisible();
  await all.click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(process.env.LIFEOS_REQUIREMENTS_EVIDENCE)await page.screenshot({path:join(process.env.LIFEOS_REQUIREMENTS_EVIDENCE,'requirements-'+width+'.png'),animations:'disabled'});
  for(const next of ['error','partial'] as const){
   mode=next;
   await pool.getByRole('button',{name:'刷新需求',exact:true}).click();
   await expect(pool.getByText('需求读取暂不可用，当前内容尚未刷新。',{exact:true})).toBeVisible();
   await expect(counts).toHaveCount(0);
   await expect(list).toHaveCount(0);
   mode='full';
   await pool.getByRole('button',{name:'刷新需求',exact:true}).click();
   await expect(all).toBeVisible();
  }
  mode='empty';
  await pool.getByRole('button',{name:'刷新需求',exact:true}).click();
  for(const label of ['总需求','已完成','未完成'])await expect(counts.getByRole('button',{name:label+' 0',exact:true})).toBeVisible();
  await expect(pool.getByText('暂无需求。',{exact:true})).toBeVisible();
  assert.deepEqual(errors,[]);
  assert.deepEqual(writes,[]);
  assert.deepEqual(outside,[]);
  await page.close();
 }
});
