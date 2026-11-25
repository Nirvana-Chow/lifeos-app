import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp,mkdir,mkdtemp,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium,expect,type Browser,type BrowserServer} from '@playwright/test';
import {readyHeading,assertPrivateFixtureNavigation} from './helpers/private-business-browser-fixture.ts';
import {cleanupAuthThemeFixture,trackAuthThemeProcess,type FixtureProcess} from './helpers/auth-theme-fixture-lifecycle.ts';
import {applePreviewPath} from '../src/calendar-candidate/apple-preview-http.ts';
import {createPersonalPlatformHandler} from '../src/personal-candidate/runtime-http.ts';
import {MemoryPort} from './helpers/platform.ts';

test('OPT-IN private route oracle accepts native closed surfaces and only the advertised owner links',{
 skip:process.env.RUN_PRIVATE_NATIVE_SURFACE_BROWSER_TESTS!=='1'&&'Requires disposable read-only Next/Chrome fixture',timeout:120000,
},async t=>{
 const source=resolve(import.meta.dirname,'..'),root=await mkdtemp(join(tmpdir(),'lifeos-auth-theme-private-native-'));
 let browser:Browser|undefined,browserServer:BrowserServer|undefined,browserProcess:FixtureProcess|undefined,server:FixtureProcess|undefined;
 t.after(()=>cleanupAuthThemeFixture({root,browser,browserServer,browserProcess,server}));
 await mkdir(join(root,'app','[[...section]]'),{recursive:true});
 await Promise.all([cp(join(source,'src'),join(root,'src'),{recursive:true}),...['layout.tsx','globals.css','theme.css'].map(name=>cp(join(source,'app',name),join(root,'app',name))),cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),symlink(join(source,'node_modules'),join(root,'node_modules')),symlink(join(source,'components'),join(root,'components'))]);
 await writeFile(join(root,'app','[[...section]]','page.tsx'),`'use client';
import {usePathname} from 'next/navigation';
import {LifeOSWorkspace} from '../../src/ui-review/workspace';
import {PersonalRecordPage} from '../../src/personal-candidate/record-page';
import {PersonalCalendarPage} from '../../src/calendar-candidate/personal-page';
import {PersonalFinancePage} from '../../src/personal-finance/page';
export default function Page(){const path=usePathname();if(path.endsWith('/health'))return <PersonalRecordPage type="health"/>;if(path.endsWith('/people'))return <PersonalRecordPage type="person"/>;if(path.endsWith('/schedule'))return <PersonalCalendarPage/>;if(path.endsWith('/finance'))return <PersonalFinancePage/>;return <LifeOSWorkspace state={{status:'ready',data:{tasks:[],projects:[],areas:[],topics:[],today:'2030-11-05',asOf:'2030-11-05T00:00:00Z',coverage:'complete'}}} access={{authenticated:true,writable:true,loginAllowed:true,allowedTypes:['todo','journal','project','domain','topic']}} onCreateTask={()=>true} viewPreferenceScope={JSON.stringify(['personal-review-user','personal-review-space'])}/>;}`);
 const child=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{cwd:root,detached:true,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});server=trackAuthThemeProcess(child,true);
 let output='';const collect=(chunk:Buffer)=>{output=(output+String(chunk)).slice(-3000);};child.stdout.on('data',collect);child.stderr.on('data',collect);
 const origin=await new Promise<string>((accept,reject)=>{const timer=setTimeout(()=>reject(Error('fixture-start-timeout')),30000);const check=()=>{const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);child.stdout.off('data',check);accept(match[0]);}};child.stdout.on('data',check);child.once('exit',()=>{clearTimeout(timer);reject(Error('fixture-start-exit'));});check();});
 browserServer=await chromium.launchServer({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});browserProcess=trackAuthThemeProcess(browserServer.process());browser=await chromium.connect(browserServer.wsEndpoint());
 for(const [width,theme] of [[1365,'light'],[390,'dark']] as const){
  const page=await browser.newPage({viewport:{width,height:900},colorScheme:theme}),requests:string[]=[],errors:string[]=[];
  page.setDefaultTimeout(5000);page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/platform/**',async route=>{
   const request=route.request(),path=new URL(request.url()).pathname;requests.push(request.method()+' '+path);
   if(request.method()!=='GET')return route.abort();
   const body=path==='/api/platform/personal/status'?{scope:'personal-manual-candidate',ownerId:'personal-review-user',spaceId:'personal-review-space',storageVerified:true,storageReviewEnabled:true,writable:true,allowedTypes:['todo','journal','project','domain','topic']}:path==='/api/platform/personal/finance/status'?{scope:'personal-finance-v1',configured:false,writable:false}:path==='/api/platform/personal/calendar/status'?{scope:'personal-calendar-v1',configured:false,writable:false}:null;
   if(!body)return route.abort();
   await route.fulfill({status:200,headers:{'cache-control':'private, no-store'},json:body});
  });
  await page.goto(origin+'/personal',{waitUntil:'domcontentloaded',timeout:60000});await readyHeading(page,'总览');
  // This synthetic overview is server-rendered ready, unlike the connected
  // recovery page. Wait for its status-driven module before opening navigation.
  await expect(page.locator('header nav[aria-label="切换模块"] button').filter({hasText:/^生活与关系$/})).toHaveCount(1);
  if(width===390)await page.getByRole('button',{name:'打开导航',exact:true}).click();
  await assertPrivateFixtureNavigation(page);
  for(const [path,heading] of [['health','健康'],['people','人物'],['finance','财务'],['schedule','日程']] as const){
   await page.goto(origin+'/personal/'+path,{waitUntil:'domcontentloaded'});await readyHeading(page,heading);
   await page.reload({waitUntil:'domcontentloaded'});await readyHeading(page,heading);
  }
  assert.deepEqual(errors,[]);assert.ok(requests.length>0);assert.ok(requests.every(value=>value.startsWith('GET ')));
  assert.ok(requests.every(value=>value.endsWith('/status')),'closed surfaces must not request business snapshots');
  const ownerId='personal-review-user',spaceId='personal-review-space',ownerEmail='synthetic@example.test';
  const sourcePin={accountId:'synthetic-account',calendarId:'ordinary',identityEpoch:'one'};
  const repository=new MemoryPort();
  let connected=false,reads=0,writes=0;
  const handler=createPersonalPlatformHandler({repository,storageVerified:true,
   config:{ownerId,spaceId,ownerEmail,databaseName:'synthetic',baseURL:origin,allowedTypes:['todo'],approval:'personal-manual-v1',calendarEnabled:true},
   sessions:{read:async()=>({userId:ownerId,email:ownerEmail})},assertWritable:async()=>{writes++;throw Error('read-only fixture');},
   appleCalendarPreview:{catalog:async()=>connected?{status:'ready',calendars:[
    {id:'ordinary',label:'合成许可日历',source:sourcePin,kind:'calendar',authorized:true,readable:true},
    {id:'overlay',label:'合成叠加日历',source:{...sourcePin,calendarId:'overlay'},kind:'automatic-overlay',authorized:true,readable:true},
   ]}:{status:'not-connected'},read:async(_binding,source,window)=>{reads++;return {snapshots:[{
    source,coverageId:window.coverageId,complete:true,events:[{seriesId:'test',sourceItemId:'one',title:'合成春季日程',
     original:{kind:'single'},schedule:{kind:'all-day',startDate:'2030-11-05',endDate:'2030-11-06'}}],
   }]};}},
  });
  await page.route('**'+applePreviewPath+'*', async route=>{
   const request=route.request();
   assert.equal(request.method(),'GET');
   const result=await handler(new Request(request.url(),{headers:{host:new URL(origin).host,'sec-fetch-site':'same-origin'}}));
   await route.fulfill({status:result.status,headers:Object.fromEntries(result.headers),body:await result.text()});
  });
  const toggle=page.getByText('Apple 日历预演',{exact:true});
  await toggle.click();
  await expect(page.getByText('未连接 Apple 日历。当前没有可用的只读连接。')).toBeVisible();
  await expect(page.getByRole('button',{name:'查重预览'})).toHaveCount(0);
  connected=true;
  const ready=page.waitForResponse(response=>new URL(response.url()).pathname===applePreviewPath);
  await page.getByRole('button',{name:'重新核对连接'}).click();
  assert.deepEqual(await (await ready).json(),{status:'ready',calendars:[{id:'ordinary',label:'合成许可日历'}]});
  await page.getByLabel('Apple 日历',{exact:true}).selectOption('ordinary');
  await expect(page.getByRole('option',{name:'合成叠加日历'})).toHaveCount(0);
  await page.getByLabel('开始日期',{exact:true}).fill('2030-11-05');
  await page.getByLabel('结束日期（不含）',{exact:true}).fill('2030-11-07');
  await page.getByLabel('预演时区',{exact:true}).fill('Asia/Tokyo');
  await page.getByRole('button',{name:'查重预览'}).click();
  await expect(page.getByRole('region',{name:'Apple 日历预演结果'})).toContainText('合成春季日程');
  await expect(page.getByRole('region',{name:'Apple 日历预演结果'})).toContainText('缺少可核实的已有记录基线');
  connected=false;
  await page.getByRole('button',{name:'查重预览'}).click();
  await expect(page.getByText('当前会话或读取授权无法核对，请重新读取连接状态。')).toBeVisible();
  await expect(page.getByRole('region',{name:'Apple 日历预演结果'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'新建日程'})).toBeDisabled();
  assert.deepEqual(errors,[]);assert.equal(reads,1);assert.equal(writes,0);assert.equal(repository.rows.size,0);
  console.log('PRIVATE_NATIVE_SURFACES '+JSON.stringify({width,theme,surfaces:4,readOnly:true}));await page.close();
 }
});
